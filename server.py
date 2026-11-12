#!/usr/bin/env python3
"""LocalTeX - editor e compilador LaTeX (LuaLaTeX / XeLaTeX / pdfLaTeX) no browser.

Um unico ficheiro, apenas biblioteca-padrao do Python 3.8+.
Uso:  python server.py [--host 127.0.0.1] [--port 8765] [--texbin PASTA] [--password X]
"""
import argparse
import base64
import hmac
import io
import json
import mimetypes
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

__version__ = "1.1.0"

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
SETTINGS_FILE = ".localtex.json"
MAX_BODY = 600 * 1024 * 1024
MAX_UNZIPPED = 1024 * 1024 * 1024

ENGINES = {"lualatex": "-lualatex", "xelatex": "-xelatex", "pdflatex": "-pdf"}

AUX_EXT = {
    "aux", "log", "fls", "fdb_latexmk", "out", "toc", "lof", "lot", "lol", "loa",
    "bbl", "blg", "bcf", "nav", "snm", "vrb", "idx", "ind", "ilg", "glo", "gls",
    "glg", "acn", "acr", "alg", "ist", "xdv", "thm", "maf", "mtc", "mtc0", "tdo",
    "listing", "auxlock", "pyg", "upa", "upb", "brf", "spl", "ent", "lg", "4ct", "4tc",
}
AUX_SUFFIX = (".synctex.gz", ".synctex(busy)", ".run.xml", "-blx.bib", ".synctex")
SKIP_DIRS = {".git", "__MACOSX", ".svn", ".hg"}

# Bibliotecas do editor/visualizador: descarregadas na 1.a utilizacao e guardadas
# em static/vendor (depois disso funciona sem Internet).
CDN = "https://cdn.jsdelivr.net/npm/"
CM = "codemirror@5.65.16/"
PJ = "pdfjs-dist@6.2.108/legacy/build/"
VENDOR = {
    "codemirror/codemirror.js": CM + "lib/codemirror.js",
    "codemirror/codemirror.css": CM + "lib/codemirror.css",
    "codemirror/stex.js": CM + "mode/stex/stex.js",
    "codemirror/matchbrackets.js": CM + "addon/edit/matchbrackets.js",
    "codemirror/closebrackets.js": CM + "addon/edit/closebrackets.js",
    "codemirror/searchcursor.js": CM + "addon/search/searchcursor.js",
    "codemirror/search.js": CM + "addon/search/search.js",
    "codemirror/dialog.js": CM + "addon/dialog/dialog.js",
    "codemirror/dialog.css": CM + "addon/dialog/dialog.css",
    "codemirror/active-line.js": CM + "addon/selection/active-line.js",
    "codemirror/comment.js": CM + "addon/comment/comment.js",
    "codemirror/show-hint.js": CM + "addon/hint/show-hint.js",
    "codemirror/show-hint.css": CM + "addon/hint/show-hint.css",
    "pdfjs/pdf.min.mjs": PJ + "pdf.min.mjs",
    "pdfjs/pdf.worker.min.mjs": PJ + "pdf.worker.min.mjs",
}

TEMPLATE = r"""% !TEX program = lualatex
\documentclass[11pt,a4paper]{article}

\usepackage{fontspec}          % fontes OpenType/TrueType (LuaLaTeX e XeLaTeX)
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}

\title{Novo documento}
\author{}
\date{\today}

\begin{document}
\maketitle

\section{Introdução}
Escreva aqui. Compile com \textbf{Ctrl+Enter}.

\[
  e^{i\pi} + 1 = 0
\]

\end{document}
"""

CFG = argparse.Namespace()
LOCKS = {}
LOCKS_GUARD = threading.Lock()


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


# ----------------------------------------------------------------- TeX lookup

def find_texbin(explicit):
    """Procura uma distribuicao TeX: --texbin, pasta portatil ao lado, ou PATH."""
    exe = ".exe" if os.name == "nt" else ""
    cands = []
    if explicit:
        cands.append(Path(explicit))
    if os.environ.get("LOCALTEX_TEXBIN"):
        cands.append(Path(os.environ["LOCALTEX_TEXBIN"]))
    for base in (ROOT, ROOT.parent):
        for pat in ("texlive/bin/*", "texlive/*/bin/*", "TinyTeX/bin/*", "tinytex/bin/*",
                    "texmfs/install/miktex/bin/*", "miktex/texmfs/install/miktex/bin/*",
                    "tex/bin/*"):
            cands.extend(sorted(base.glob(pat)))
    for c in cands:
        if c.is_dir() and any((c / (e + exe)).exists() for e in ENGINES):
            return str(c)
        if c.is_dir() and explicit and str(c) == str(Path(explicit)):
            return str(c)
    return None


def tex_env():
    env = dict(os.environ)
    if CFG.texbin:
        env["PATH"] = CFG.texbin + os.pathsep + env.get("PATH", "")
    env.setdefault("max_print_line", "1000")  # linhas do log sem quebra aos 79 col.
    env.setdefault("error_line", "254")
    env.setdefault("half_error_line", "238")
    return env


def which(name):
    return shutil.which(name, path=tex_env()["PATH"])


# ------------------------------------------------------------------ projects

NAME_RE = re.compile(r"^[^\W_][\w .\-()]{0,79}$", re.UNICODE)


def project_dir(name, must_exist=True):
    if not NAME_RE.match(name or "") or name.endswith((".", " ")):
        raise ApiError(400, "Nome de projeto inválido.")
    p = CFG.projects / name
    if must_exist and not p.is_dir():
        raise ApiError(404, "Projeto não encontrado.")
    return p


def safe_path(proj, rel):
    rel = (rel or "").replace("\\", "/").strip("/")
    if not rel or "\0" in rel:
        raise ApiError(400, "Caminho inválido.")
    parts = rel.split("/")
    if any(s in ("", ".", "..") for s in parts):
        raise ApiError(400, "Caminho inválido.")
    target = (proj / rel).resolve()
    root = proj.resolve()
    if root != target and root not in target.parents:
        raise ApiError(400, "Caminho fora do projeto.")
    return target


def is_aux(name):
    low = name.lower()
    if low.endswith(AUX_SUFFIX):
        return True
    return "." in low and low.rsplit(".", 1)[1] in AUX_EXT


def list_tree(proj):
    out = []
    for dirpath, dirnames, filenames in os.walk(proj):
        dirnames[:] = sorted(d for d in dirnames
                             if d not in SKIP_DIRS and not d.startswith("_minted"))
        rel_dir = Path(dirpath).relative_to(proj).as_posix()
        if rel_dir != ".":
            out.append({"path": rel_dir, "dir": True})
        for fn in sorted(filenames):
            if fn == SETTINGS_FILE or is_aux(fn) or fn == ".DS_Store":
                continue
            fp = Path(dirpath) / fn
            rel = fp.relative_to(proj).as_posix()
            try:
                size = fp.stat().st_size
            except OSError:
                continue
            out.append({"path": rel, "dir": False, "size": size})
        if len(out) > 8000:
            break
    return out


def load_settings(proj):
    s = {"main": None, "engine": "auto", "shellEscape": False}
    try:
        s.update(json.loads((proj / SETTINGS_FILE).read_text("utf-8")))
    except (OSError, ValueError):
        pass
    return s


def save_settings(proj, s):
    (proj / SETTINGS_FILE).write_text(json.dumps(s, indent=1), "utf-8")


def guess_main(proj, settings):
    m = settings.get("main")
    if m and (proj / m).is_file():
        return m
    if (proj / "main.tex").is_file():
        return "main.tex"
    cands = sorted(proj.glob("*.tex")) + sorted(proj.glob("*/*.tex"))
    for c in cands:
        try:
            if "\\documentclass" in c.read_text("utf-8", "replace")[:20000]:
                return c.relative_to(proj).as_posix()
        except OSError:
            pass
    return cands[0].relative_to(proj).as_posix() if cands else None


MAGIC_RE = re.compile(r"^\s*%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(\w+)", re.I | re.M)


def magic_engine(path):
    try:
        head = "".join(path.open("r", encoding="utf-8", errors="replace").readlines()[:30])
    except OSError:
        return None
    m = MAGIC_RE.search(head)
    if m and m.group(1).lower() in ENGINES:
        return m.group(1).lower()
    return None


def import_zip(data, proj):
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ApiError(400, "O ficheiro não é um .zip válido.")
    infos = [i for i in zf.infolist()
             if not i.is_dir() and not i.filename.startswith("__MACOSX/")]
    if sum(i.file_size for i in infos) > MAX_UNZIPPED:
        raise ApiError(400, "Arquivo demasiado grande.")
    names = [i.filename.replace("\\", "/").lstrip("/") for i in infos]
    # se tudo estiver dentro de uma unica pasta de topo, retira-a
    tops = {n.split("/", 1)[0] for n in names}
    strip = len(tops) == 1 and all("/" in n for n in names)
    proj.mkdir(parents=True)
    for info, name in zip(infos, names):
        if strip:
            name = name.split("/", 1)[1]
        try:
            target = safe_path(proj, name)
        except ApiError:
            continue  # entrada maliciosa ou invalida (..)
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as dst:
            shutil.copyfileobj(src, dst)


def export_zip(proj):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in list_tree(proj):
            if not item["dir"]:
                zf.write(proj / item["path"], item["path"])
    return buf.getvalue()


def clean_aux(proj):
    n = 0
    for dirpath, dirnames, filenames in os.walk(proj):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        names = set(filenames)
        for fn in filenames:
            if not is_aux(fn):
                continue
            if fn.lower().endswith(".bbl"):
                stem = fn[:-4]
                if not ({stem + ".bcf", stem + ".blg"} & names):
                    continue  # .bbl possivelmente fornecido pelo utilizador
            try:
                os.remove(os.path.join(dirpath, fn))
                n += 1
            except OSError:
                pass
    return n


# ------------------------------------------------------------------- compile

def kill_tree(proc):
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except (OSError, ProcessLookupError):
        try:
            proc.kill()
        except OSError:
            pass


def run_cmd(cmd, cwd, deadline):
    kw = dict(cwd=str(cwd), env=tex_env(), stdin=subprocess.DEVNULL,
              stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if os.name == "nt":
        kw["creationflags"] = 0x00000200 | 0x08000000  # NEW_PROCESS_GROUP | NO_WINDOW
    else:
        kw["start_new_session"] = True
    try:
        proc = subprocess.Popen(cmd, **kw)
    except OSError as e:
        return 127, "Não foi possível executar %s: %s\n" % (cmd[0], e), False
    try:
        out, _ = proc.communicate(timeout=max(1, deadline - time.time()))
        timed_out = False
    except subprocess.TimeoutExpired:
        kill_tree(proc)
        out, _ = proc.communicate()
        timed_out = True
    return proc.returncode, out.decode("utf-8", "replace"), timed_out


RERUN_RE = re.compile(r"Rerun to get|Please rerun LaTeX|Label\(s\) may have changed|"
                      r"rerunfilecheck Warning|Please \(re\)run", re.I)


def compile_project(proj, main_rel, engine, shell_escape):
    main = safe_path(proj, main_rel)
    if not main.is_file():
        raise ApiError(400, "Ficheiro principal não encontrado: %s" % main_rel)
    eng_path = which(engine)
    if not eng_path:
        raise ApiError(400, "O motor «%s» não foi encontrado. Indique a pasta da "
                            "distribuição TeX com --texbin (ver README)." % engine)
    cwd, stem = main.parent, main.stem
    pdf, log = cwd / (stem + ".pdf"), cwd / (stem + ".log")
    started = time.time()
    deadline = started + CFG.timeout
    opts = ["-interaction=nonstopmode", "-file-line-error", "-synctex=1",
            "-shell-escape" if shell_escape else "-no-shell-escape"]
    transcript, timed_out = [], False
    latexmk = which("latexmk") if not CFG.no_latexmk else None

    def step(cmd):
        nonlocal timed_out
        transcript.append("$ " + " ".join(os.path.basename(cmd[0:1][0]) if i == 0 else c
                                           for i, c in enumerate(cmd)))
        rc, out, to = run_cmd(cmd, cwd, deadline)
        transcript.append(out)
        timed_out = timed_out or to
        return rc

    if latexmk:
        rc = step([latexmk, ENGINES[engine]] + opts + [main.name])
        tool = "latexmk"
    else:
        tool = "sequência interna (latexmk indisponível)"
        base = [eng_path] + opts + [main.name]
        rc = step(base)
        bib_ran = False
        aux = cwd / (stem + ".aux")
        if not timed_out and (cwd / (stem + ".bcf")).exists() and which("biber"):
            step([which("biber"), stem])
            bib_ran = True
        elif not timed_out and aux.exists() and which("bibtex") and \
                "\\bibdata" in aux.read_text("utf-8", "replace"):
            step([which("bibtex"), stem])
            bib_ran = True
        if not timed_out and (cwd / (stem + ".idx")).exists() and which("makeindex"):
            step([which("makeindex"), stem + ".idx"])
            bib_ran = True
        runs, again = 1, bib_ran or _log_wants_rerun(log)
        while again and runs < 5 and not timed_out:
            rc = step(base)
            runs += 1
            again = (bib_ran and runs == 2) or _log_wants_rerun(log)

    xdv = cwd / (stem + ".xdv")
    if engine == "xelatex" and rc != 0 and not timed_out and which("xdvipdfmx") \
            and xdv.exists() and xdv.stat().st_mtime >= started - 2 \
            and not (pdf.exists() and pdf.stat().st_mtime >= started - 2):
        run_cmd([which("xdvipdfmx"), "-q", "-E", "-o", pdf.name, xdv.name], cwd, deadline)

    log_text = ""
    if log.exists() and log.stat().st_mtime >= started - 2:
        log_text = log.read_text("utf-8", "replace")
    issues = parse_log(log_text, proj, cwd)
    if timed_out:
        issues.insert(0, {"level": "error", "file": None, "line": None,
                          "message": "Compilação interrompida: excedeu %d s." % CFG.timeout})
    pdf_ok = pdf.exists() and pdf.stat().st_mtime >= started - 2
    n_err = sum(1 for i in issues if i["level"] == "error")
    if rc != 0 and n_err == 0:
        tail = "\n".join(transcript)[-1500:]
        issues.insert(0, {"level": "error", "file": None, "line": None,
                          "message": "A compilação falhou (código %s). Fim da saída:\n%s"
                                     % (rc, tail)})
        n_err = 1
    return {
        "ok": rc == 0 and pdf_ok and not timed_out,
        "pdf": pdf.relative_to(proj).as_posix() if pdf.exists() else None,
        "pdfUpdated": pdf_ok,
        "engine": engine, "tool": tool, "main": main_rel,
        "duration": round(time.time() - started, 1),
        "issues": issues,
        "log": log_text[-400000:],
        "output": "\n".join(transcript)[-200000:],
    }


def _log_wants_rerun(log):
    try:
        return bool(RERUN_RE.search(log.read_text("utf-8", "replace")))
    except OSError:
        return False


FLE_RE = re.compile(r"^((?:[A-Za-z]:)?[^:\n]+?):(\d+): (.+)$")
WARN_RE = re.compile(r"^(?:LaTeX|Package|Class|pdfTeX|LuaTeX|Module)\b.*?[Ww]arning:? (.*)$")
BOX_RE = re.compile(r"^((?:Over|Under)full \\[hv]box .*?) (?:in paragraph )?at lines (\d+)--\d+")
MISSCHAR_RE = re.compile(r"^Missing character: There is no (.+?) in font (.+?)!?$")
PAREN_RE = re.compile(r"\((?:((?:[A-Za-z]:)?[^\s(){}\"]+))?|\)")
LINE_RE = re.compile(r"on input line (\d+)")


def parse_log(text, proj, cwd):
    issues, seen = [], set()
    lines = text.splitlines()
    n = len(lines)
    root = proj.resolve()

    def add(level, message, file=None, line=None):
        key = (level, message, file, line)
        if key in seen or len(issues) >= 400:
            return
        seen.add(key)
        issues.append({"level": level, "file": file, "line": line, "message": message})

    def locate(raw):
        """Converte o caminho do log num caminho relativo ao projeto (ou None)."""
        try:
            p = Path(raw)
            p = (p if p.is_absolute() else cwd / p).resolve()
            if root in p.parents and p.is_file():
                return p.relative_to(root).as_posix(), True
            return p.name, False
        except (OSError, ValueError):
            return raw, False

    # ficheiro "aberto" no inicio de cada linha, seguindo os parenteses do log
    file_at, stack, known = [], [], {}
    for ln in lines:
        cur = next((f for f in reversed(stack) if f), None)
        file_at.append(cur)
        for pm in PAREN_RE.finditer(ln):
            if pm.group(0) == ")":
                if stack:
                    stack.pop()
                continue
            cand = pm.group(1)
            if cand and "." in cand and cand not in known:
                f, inside = locate(cand)
                known[cand] = f if inside else None
            stack.append(known.get(cand) if cand else None)
    missing = {}

    i = 0
    while i < n:
        ln = lines[i]
        m = FLE_RE.match(ln)
        if m and not ln.startswith(("(", ")", "[", "<")):
            f, inside = locate(m.group(1))
            msg = m.group(3)
            # contexto: linhas seguintes ate a linha "l.NN ..."
            extra, j = [], i + 1
            while j < n and j < i + 12 and len(extra) < 6:
                s = lines[j]
                if s.startswith("l.") and re.match(r"l\.\d+", s):
                    extra.append(s)
                    break
                if FLE_RE.match(s) or s.startswith("!"):
                    break
                if s.strip() and not s.startswith(("See the", "Type  H", " ...")):
                    extra.append(s.rstrip())
                j += 1
            if extra:
                msg += "\n" + "\n".join(extra)
            if inside:
                add("error", msg, f, int(m.group(2)))
            else:
                add("error", "%s (em %s, linha %s)" % (msg, f, m.group(2)))
            i += 1
            continue
        if ln.startswith("! "):
            msg, line_no = ln[2:], None
            for j in range(i + 1, min(n, i + 12)):
                mm = re.match(r"l\.(\d+)", lines[j])
                if mm:
                    line_no = int(mm.group(1))
                    break
            if not msg.startswith("==> Fatal error"):
                add("error", msg, None, line_no)
            i += 1
            continue
        m = WARN_RE.match(ln)
        if m:
            parts, j = [ln], i + 1
            while j < n and lines[j].strip() and j < i + 8 and \
                    (lines[j].startswith(("(", " ")) or not WARN_RE.match(lines[j])):
                if FLE_RE.match(lines[j]) or lines[j].startswith(("!", "[", ")")):
                    break
                parts.append(re.sub(r"^\(\S+\)\s+", "", lines[j]).strip())
                j += 1
            msg = " ".join(parts)
            lm = LINE_RE.search(msg)
            add("warning", msg, file_at[i] if lm else None, int(lm.group(1)) if lm else None)
            i = j
            continue
        m = MISSCHAR_RE.match(ln)
        if m:
            chars = missing.setdefault(m.group(2)[:80], [])
            ch = m.group(1).split(" (")[0]
            if ch not in chars:
                chars.append(ch)
            i += 1
            continue
        m = BOX_RE.match(ln)
        if m:
            add("box", m.group(1), file_at[i], int(m.group(2)))
        i += 1
    for font, chars in missing.items():
        if font != "nullfont":
            add("warning", "Caracteres sem glifo na fonte %s: %s%s" % (
                font, " ".join(chars[:40]), " …" if len(chars) > 40 else ""))
    order = {"error": 0, "warning": 1, "box": 2}
    issues.sort(key=lambda x: order[x["level"]])
    return issues


# -------------------------------------------------------------- bibliography

BIB_FIELDS = ("author", "editor", "title", "year", "date", "journal", "journaltitle",
              "booktitle", "publisher", "doi", "url")
CITE_RE = re.compile(r"\\(?![a-zA-Z]*style)(?:[a-zA-Z]*cite[a-zA-Z]*)\*?"
                     r"(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]*)\}")
BIBRES_RE = re.compile(r"\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}")
COMMENT_RE = re.compile(r"(?<!\\)%.*")


def _bib_value(s, i):
    """Le um valor BibTeX a partir de s[i]; devolve (texto, posicao_seguinte)."""
    out = []
    while i < len(s):
        while i < len(s) and s[i] in " \t\r\n":
            i += 1
        if i >= len(s):
            break
        c = s[i]
        if c == "{":
            depth, j = 1, i + 1
            while j < len(s) and depth:
                depth += {"{": 1, "}": -1}.get(s[j], 0)
                j += 1
            out.append(s[i + 1:j - 1])
            i = j
        elif c == '"':
            depth, j = 0, i + 1
            while j < len(s) and not (s[j] == '"' and depth == 0):
                depth += {"{": 1, "}": -1}.get(s[j], 0)
                j += 1
            out.append(s[i + 1:j])
            i = j + 1
        else:
            m = re.match(r"[^,#}\s]+", s[i:])
            if not m:
                break
            out.append(m.group(0))
            i += len(m.group(0))
        while i < len(s) and s[i] in " \t\r\n":
            i += 1
        if i < len(s) and s[i] == "#":
            i += 1
            continue
        break
    return "".join(out), i


def _bib_clean(v):
    v = re.sub(r"\\[a-zA-Z]+\s*|[{}\\]", "", v)
    return re.sub(r"\s+", " ", v).strip()


def parse_bib(text):
    """Analisador tolerante de BibTeX: devolve [{key, type, line, campos...}]."""
    entries = []
    for m in re.finditer(r"@\s*(\w+)\s*[{(]", text):
        typ = m.group(1).lower()
        if typ in ("comment", "string", "preamble"):
            continue
        i = m.end()
        km = re.match(r"\s*([^,\s{}()]+)\s*,", text[i:])
        if not km:
            continue
        e = {"key": km.group(1), "type": typ, "line": text.count("\n", 0, m.start()) + 1}
        i += km.end()
        while i < len(text):
            fm = re.match(r"\s*([\w\-:.]+)\s*=\s*", text[i:])
            if not fm:
                break
            name = fm.group(1).lower()
            val, i = _bib_value(text, i + fm.end())
            if name in BIB_FIELDS:
                e[name] = _bib_clean(val)[:400]
            while i < len(text) and text[i] in " \t\r\n,":
                i += 1
            if i < len(text) and text[i] in "})":
                break
        if "year" not in e and e.get("date"):
            e["year"] = e["date"][:4]
        entries.append(e)
    return entries


def project_files(proj, ext):
    return [i["path"] for i in list_tree(proj) if not i["dir"] and i["path"].lower().endswith(ext)]


def bib_info(proj):
    """Entradas de todos os .bib do projeto e citacoes sem entrada correspondente."""
    entries, dup = [], []
    keys = {}
    for rel in project_files(proj, ".bib"):
        try:
            text = (proj / rel).read_text("utf-8", "replace")
        except OSError:
            continue
        for e in parse_bib(text):
            e["file"] = rel
            if e["key"] in keys:
                dup.append({"key": e["key"], "file": rel, "line": e["line"]})
            keys[e["key"]] = e
            entries.append(e)
    missing, cited, resources = [], {}, []
    for rel in project_files(proj, ".tex"):
        try:
            lines = (proj / rel).read_text("utf-8", "replace").splitlines()
        except OSError:
            continue
        for n, ln in enumerate(lines, 1):
            ln = COMMENT_RE.sub("", ln)
            for m in BIBRES_RE.finditer(ln):
                resources += [(rel, r.strip()) for r in m.group(1).split(",") if r.strip()]
            for m in CITE_RE.finditer(ln):
                for k in (k.strip() for k in m.group(1).split(",")):
                    if not k or k == "*":
                        continue
                    cited[k] = cited.get(k, 0) + 1
                    if k not in keys:
                        missing.append({"key": k, "file": rel, "line": n})
    bad_res = []
    for rel, r in resources:
        name = r if r.lower().endswith(".bib") else r + ".bib"
        if any((b / name).is_file() for b in ((proj / rel).parent, proj)):
            continue
        found, kpse = b"", which("kpsewhich")
        if kpse:  # pode estar instalado na distribuicao TeX
            try:
                found = subprocess.run([kpse, name], capture_output=True,
                                       env=tex_env(), timeout=10).stdout.strip()
            except (OSError, subprocess.SubprocessError):
                pass
        if not found:
            bad_res.append({"file": rel, "resource": name})
    for e in entries:
        e["cited"] = cited.get(e["key"], 0)
    return {"entries": entries, "missing": missing, "duplicates": dup,
            "missingResources": bad_res}


DOI_RE = re.compile(r"(10\.\d{4,9}/\S+)")


def fetch_doi(doi):
    m = DOI_RE.search(unquote(doi or "").strip())
    if not m:
        raise ApiError(400, "DOI inválido (deve começar por 10.).")
    if CFG.offline:
        raise ApiError(400, "Modo offline: não é possível consultar o DOI.")
    doi = m.group(1).rstrip(".,;")
    req = urllib.request.Request("https://doi.org/" + urllib.request.quote(doi, safe="/:;()._-"),
                                 headers={"Accept": "application/x-bibtex; charset=utf-8",
                                          "User-Agent": "LocalTeX"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            text = r.read().decode("utf-8", "replace").strip()
    except urllib.error.HTTPError as e:
        raise ApiError(404 if e.code == 404 else 502,
                       "DOI não encontrado." if e.code == 404 else "doi.org respondeu %s." % e.code)
    except Exception as e:  # sem rede, proxy...
        raise ApiError(502, "Não foi possível contactar doi.org: %s" % e)
    if not text.startswith("@"):
        raise ApiError(502, "doi.org não devolveu BibTeX.")
    return text


def format_bib_entry(text):
    """Passa uma entrada numa so linha (como a do doi.org) para um campo por linha."""
    head, sep, body = text.partition(",")
    if not sep or not body.rstrip().endswith(("}", ")")):
        return text
    body = body.rstrip()[:-1]
    fields, depth, cur, quote = [], 0, "", False
    for c in body:
        if c == '"' and depth == 0:
            quote = not quote
        depth += {"{": 1, "}": -1}.get(c, 0)
        if c == "," and depth == 0 and not quote:
            fields.append(cur.strip())
            cur = ""
        else:
            cur += c
    fields.append(cur.strip())
    fields = [f for f in fields if f]
    out = []
    for f in fields:
        k, eq, v = f.partition("=")
        out.append("  %s = %s" % (k.strip().lower(), v.strip()) if eq else "  " + f)
    return head.strip() + ",\n" + ",\n".join(out) + "\n}"


def add_bib_entry(proj, bibtex, target):
    """Acrescenta uma entrada a um .bib; renomeia a chave se ja existir."""
    entries = parse_bib(bibtex)
    if not entries:
        raise ApiError(400, "Entrada BibTeX inválida.")
    e = entries[0]
    existing = {x["key"]: x for x in bib_info(proj)["entries"]}
    doi = (e.get("doi") or "").lower()
    for x in existing.values():
        if doi and (x.get("doi") or "").lower() == doi:
            return {"key": x["key"], "file": x["file"], "existed": True}
    key = e["key"]
    # chave legivel: ApelidoAno (como no resto do projeto)
    if re.search(r"^\d|^10\.|_\d{4}$", key) or len(key) > 40:
        surname = re.split(r"\s+and\s+", e.get("author", "") or "x")[0]
        surname = surname.split(",")[0].split()[-1] if surname.strip() else "ref"
        key = re.sub(r"[^A-Za-z0-9]", "", surname) + (e.get("year") or "")
    base, n = key, 0
    while key in existing:
        n += 1
        key = base + "abcdefghijklmnopqrstuvwxyz"[(n - 1) % 26] * (1 + (n - 1) // 26)
    bibtex = re.sub(r"^(@\s*\w+\s*[{(]\s*)[^,\s]+", lambda m: m.group(1) + key, bibtex.strip(), 1)
    if "\n" not in bibtex:
        bibtex = format_bib_entry(bibtex)
    bibs = project_files(proj, ".bib")
    rel = target if target in bibs else (bibs[0] if bibs else "references.bib")
    fp = safe_path(proj, rel)
    old = fp.read_text("utf-8", "replace") if fp.exists() else ""
    sep = "" if not old or old.endswith("\n\n") else ("\n" if old.endswith("\n") else "\n\n")
    fp.write_text(old + sep + bibtex + "\n", "utf-8")
    return {"key": key, "file": rel, "existed": False, "created": not old}


# ----------------------------------------------------------------- wordcount

TC_FIELDS = {"Words in text": "text", "Words in headers": "headers",
             "Words outside text (captions, etc.)": "captions", "Number of headers": "nheaders",
             "Number of floats/tables/figures": "floats", "Number of math inlines": "mathInline",
             "Number of math displayed": "mathDisplay", "Files": "files"}
SKIP_ENVS = ("equation", "align", "gather", "multline", "eqnarray", "displaymath", "math",
             "verbatim", "lstlisting", "minted", "tikzpicture", "comment", "filecontents")
INPUT_RE = re.compile(r"\\(?:input|include|subfile)\s*\{([^}]+)\}")


def _strip_tex(text):
    text = COMMENT_RE.sub("", text)
    text = re.sub(r"\\begin\{(%s)\*?\}.*?\\end\{\1\*?\}" % "|".join(SKIP_ENVS), " ", text, flags=re.S)
    text = re.sub(r"\$\$.*?\$\$|\\\[.*?\\\]|\$[^$]*\$|\\\(.*?\\\)", " ", text, flags=re.S)
    text = re.sub(r"\\(?:begin|end|label|ref|eqref|cref|Cref|pageref|cite[a-z]*|usepackage|"
                  r"documentclass|includegraphics|input|include|bibliography[a-z]*|url|"
                  r"addbibresource|newcommand|renewcommand|setlength|setcounter|"
                  r"autoref|vspace|hspace)\*?(?:\[[^\]]*\])*(?:\{[^}]*\})?", " ", text)
    text = re.sub(r"\\[a-zA-Z@]+\*?|\\.|[{}\[\]~&#^_]", " ", text)
    return text


def count_words(text):
    return len(re.findall(r"[^\W\d_](?:[\w'’\-]*\w)?|\d+(?:[.,]\d+)*", _strip_tex(text)))


def wordcount(proj, main_rel):
    main = safe_path(proj, main_rel)
    tc = which("texcount")
    if tc:
        rc, out, _ = run_cmd([tc, "-inc", "-total", "-utf8", "-nocol", main.name],
                             main.parent, time.time() + 60)
        res = {}
        for ln in out.splitlines():
            k, _, v = ln.partition(":")
            if k.strip() in TC_FIELDS and v.strip().isdigit():
                res[TC_FIELDS[k.strip()]] = int(v)
        if "text" in res:
            res["total"] = res["text"] + res.get("headers", 0) + res.get("captions", 0)
            res["tool"] = "texcount"
            return res
    # alternativa aproximada: segue \input/\include a partir do principal
    seen, total = set(), 0

    def walk(fp, depth):
        nonlocal total
        if depth > 20 or fp in seen or not fp.is_file():
            return
        seen.add(fp)
        text = fp.read_text("utf-8", "replace")
        body = text.split("\\begin{document}", 1)[1] if "\\begin{document}" in text else text
        total += count_words(body)
        for m in INPUT_RE.finditer(COMMENT_RE.sub("", text)):
            name = m.group(1).strip()
            for cand in (proj / name, main.parent / name):
                for c in (cand, cand.with_name(cand.name + ".tex")):
                    if c.is_file():
                        walk(c.resolve(), depth + 1)
                        break
    walk(main.resolve(), 0)
    return {"total": total, "files": len(seen), "tool": "aproximado"}


# -------------------------------------------------------------------- vendor

def vendor_file(rel, quiet=True):
    """Devolve o caminho local de uma biblioteca; descarrega-a se faltar."""
    if rel not in VENDOR:
        return None
    dest = STATIC / "vendor" / rel
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    if CFG.offline:
        return None
    try:
        req = urllib.request.Request(CDN + VENDOR[rel], headers={"User-Agent": "LocalTeX"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(dest)
        return dest
    except Exception as e:  # sem rede, proxy, etc. -> a interface usa alternativas
        if not quiet:
            print("  falhou %s: %s" % (rel, e))
        return None


# ---------------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "LocalTeX/" + __version__

    def log_message(self, fmt, *args):
        if CFG.verbose:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -- helpers
    def send_bytes(self, data, ctype="application/octet-stream", status=200, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def send_json(self, obj, status=200):
        self.send_bytes(json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8", status)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ApiError(413, "Ficheiro demasiado grande.")
        return self.rfile.read(n) if n else b""

    def json_body(self):
        raw = self.body()
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            raise ApiError(400, "JSON inválido.")

    def authorized(self):
        if not CFG.password:
            return True
        h = self.headers.get("Authorization", "")
        if h.startswith("Basic "):
            try:
                pw = base64.b64decode(h[6:]).decode("utf-8", "replace").split(":", 1)[1]
                return hmac.compare_digest(pw.encode(), CFG.password.encode())
            except (ValueError, IndexError):
                pass
        return False

    def same_origin(self):
        origin = self.headers.get("Origin")
        if not origin or self.command in ("GET", "HEAD"):
            return True
        return urlsplit(origin).netloc == self.headers.get("Host")

    def dispatch(self):
        try:
            if not self.authorized():
                self.send_bytes(b"Autenticacao necessaria.", "text/plain", 401,
                                {"WWW-Authenticate": 'Basic realm="LocalTeX"'})
                return
            if not self.same_origin():
                raise ApiError(403, "Origem não permitida.")
            url = urlsplit(self.path)
            parts = [unquote(p) for p in url.path.split("/") if p]
            q = {k: v[0] for k, v in parse_qs(url.query).items()}
            if parts[:1] == ["api"]:
                self.api(parts[1:], q)
            elif self.command in ("GET", "HEAD"):
                self.static(parts)
            else:
                raise ApiError(405, "Método não suportado.")
        except ApiError as e:
            self.drain()
            self.send_json({"error": e.message}, e.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # noqa
            if CFG.verbose:
                import traceback
                traceback.print_exc()
            try:
                self.send_json({"error": "Erro interno: %s" % e}, 500)
            except OSError:
                pass

    def drain(self):
        """Em caso de erro antes de ler o corpo, fecha a ligacao."""
        self.close_connection = True

    do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = dispatch

    # -- static files
    def static(self, parts):
        if parts[:1] == ["vendor"]:
            fp = vendor_file("/".join(parts[1:]))
            if not fp:
                raise ApiError(404, "Biblioteca indisponível.")
        else:
            rel = "/".join(parts) or "index.html"
            fp = (STATIC / rel).resolve()
            if STATIC.resolve() not in fp.parents or not fp.is_file():
                raise ApiError(404, "Não encontrado.")
        ctype = {".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css",
                 ".html": "text/html"}.get(fp.suffix) or mimetypes.guess_type(fp.name)[0] \
            or "application/octet-stream"
        if ctype.startswith("text/"):
            ctype += "; charset=utf-8"
        self.send_bytes(fp.read_bytes(), ctype)

    # -- API
    def api(self, parts, q):
        m = self.command
        if parts == ["status"] and m == "GET":
            return self.send_json({
                "texbin": CFG.texbin,
                "engines": {e: bool(which(e)) for e in ENGINES},
                "latexmk": bool(which("latexmk")) and not CFG.no_latexmk,
                "biber": bool(which("biber")), "bibtex": bool(which("bibtex")),
                "projectsDir": str(CFG.projects),
            })
        if parts == ["projects"] and m == "GET":
            items = []
            for d in sorted(CFG.projects.iterdir(), key=lambda p: p.name.lower()):
                if d.is_dir() and not d.name.startswith("."):
                    items.append({"name": d.name, "mtime": d.stat().st_mtime})
            return self.send_json(items)
        if parts == ["projects"] and m == "POST":
            if q.get("import"):
                proj = project_dir(q["import"], must_exist=False)
                if proj.exists():
                    raise ApiError(409, "Já existe um projeto com esse nome.")
                data = self.body()
                try:
                    import_zip(data, proj)
                except Exception:
                    shutil.rmtree(proj, ignore_errors=True)
                    raise
                return self.send_json({"name": proj.name})
            b = self.json_body()
            proj = project_dir(b.get("name", "").strip(), must_exist=False)
            if proj.exists():
                raise ApiError(409, "Já existe um projeto com esse nome.")
            proj.mkdir(parents=True)
            if b.get("template", True):
                (proj / "main.tex").write_bytes(TEMPLATE.encode("utf-8"))
            return self.send_json({"name": proj.name})
        if len(parts) >= 2 and parts[0] == "projects":
            return self.project_api(project_dir(parts[1]), parts[2:], q)
        raise ApiError(404, "Rota desconhecida.")

    def project_api(self, proj, rest, q):
        m = self.command
        action = rest[0] if rest else ""
        if not rest and m == "DELETE":
            shutil.rmtree(proj)
            return self.send_json({"ok": True})
        if action == "tree" and m == "GET":
            s = load_settings(proj)
            main = guess_main(proj, s)
            return self.send_json({"files": list_tree(proj), "settings": s, "main": main,
                                   "magic": magic_engine(proj / main) if main else None})
        if action == "file":
            fp = safe_path(proj, q.get("path"))
            if m in ("GET", "HEAD"):
                if not fp.is_file():
                    raise ApiError(404, "Ficheiro não encontrado.")
                ctype = mimetypes.guess_type(fp.name)[0] or "application/octet-stream"
                if ctype in ("text/html", "image/svg+xml", "application/xhtml+xml") \
                        or ctype.endswith("javascript"):
                    ctype = "text/plain"  # nunca executar conteudo do projeto
                hdr = {}
                if q.get("download"):
                    hdr["Content-Disposition"] = 'attachment; filename="%s"' % \
                        fp.name.encode("ascii", "replace").decode().replace('"', "")
                return self.send_bytes(fp.read_bytes(), ctype, headers=hdr)
            if m == "PUT":
                data = self.body()
                if fp.is_dir():
                    raise ApiError(400, "Já existe uma pasta com esse nome.")
                fp.parent.mkdir(parents=True, exist_ok=True)
                tmp = fp.with_name(fp.name + ".~tmp")
                tmp.write_bytes(data)
                tmp.replace(fp)
                return self.send_json({"ok": True, "size": len(data)})
            if m == "DELETE":
                if fp.is_dir():
                    shutil.rmtree(fp)
                elif fp.exists():
                    fp.unlink()
                return self.send_json({"ok": True})
        if action == "mkdir" and m == "POST":
            safe_path(proj, self.json_body().get("path")).mkdir(parents=True, exist_ok=True)
            return self.send_json({"ok": True})
        if action == "rename" and m == "POST":
            b = self.json_body()
            src, dst = safe_path(proj, b.get("from")), safe_path(proj, b.get("to"))
            if not src.exists():
                raise ApiError(404, "Origem não encontrada.")
            if dst.exists():
                raise ApiError(409, "O destino já existe.")
            dst.parent.mkdir(parents=True, exist_ok=True)
            src.rename(dst)
            s = load_settings(proj)
            if s.get("main") == b.get("from"):
                s["main"] = dst.relative_to(proj.resolve()).as_posix()
                save_settings(proj, s)
            return self.send_json({"ok": True})
        if action == "settings" and m == "PUT":
            b, s = self.json_body(), load_settings(proj)
            if "main" in b:
                s["main"] = safe_path(proj, b["main"]).relative_to(proj.resolve()).as_posix() \
                    if b["main"] else None
            if b.get("engine") in list(ENGINES) + ["auto"]:
                s["engine"] = b["engine"]
            if "shellEscape" in b:
                s["shellEscape"] = bool(b["shellEscape"]) and CFG.allow_shell_escape
            save_settings(proj, s)
            return self.send_json(s)
        if action == "compile" and m == "POST":
            self.body()
            s = load_settings(proj)
            main = guess_main(proj, s)
            if not main:
                raise ApiError(400, "O projeto não tem nenhum ficheiro .tex.")
            engine = s.get("engine", "auto")
            if engine not in ENGINES:
                engine = magic_engine(proj / main) or "lualatex"
            with LOCKS_GUARD:
                lock = LOCKS.setdefault(proj.name, threading.Lock())
            if not lock.acquire(blocking=False):
                raise ApiError(409, "Já existe uma compilação em curso neste projeto.")
            try:
                res = compile_project(proj, main, engine,
                                      bool(s.get("shellEscape")) and CFG.allow_shell_escape)
            finally:
                lock.release()
            return self.send_json(res)
        if action == "bib" and len(rest) == 1 and m == "GET":
            return self.send_json(bib_info(proj))
        if action == "bib" and rest[1:] == ["add"] and m == "POST":
            b = self.json_body()
            text = (b.get("bibtex") or "").strip() or fetch_doi(b.get("doi"))
            return self.send_json(add_bib_entry(proj, text, b.get("file")))
        if action == "wordcount" and m == "GET":
            main = q.get("path") or guess_main(proj, load_settings(proj))
            if not main:
                raise ApiError(400, "O projeto não tem nenhum ficheiro .tex.")
            return self.send_json(wordcount(proj, main))
        if action == "clean" and m == "POST":
            self.body()
            return self.send_json({"removed": clean_aux(proj)})
        if action == "zip" and m == "GET":
            name = proj.name.encode("ascii", "replace").decode().replace('"', "")
            return self.send_bytes(export_zip(proj), "application/zip", headers={
                "Content-Disposition": 'attachment; filename="%s.zip"' % name})
        raise ApiError(404, "Rota desconhecida.")


# ---------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="LocalTeX - LaTeX no browser, sem instalação.")
    ap.add_argument("--host", default="127.0.0.1",
                    help="endereço de escuta (0.0.0.0 para modo servidor)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--projects", default=str(ROOT / "projects"), help="pasta dos projetos")
    ap.add_argument("--texbin", help="pasta com lualatex/xelatex (se não estiver no PATH)")
    ap.add_argument("--password", default=os.environ.get("LOCALTEX_PASSWORD"),
                    help="exige esta palavra-passe (recomendado em modo servidor)")
    ap.add_argument("--timeout", type=int, default=300, help="limite por compilação (s)")
    ap.add_argument("--allow-shell-escape", action="store_true",
                    help="permite ativar -shell-escape por projeto (minted, etc.)")
    ap.add_argument("--no-latexmk", action="store_true", help="não usar latexmk")
    ap.add_argument("--offline", action="store_true",
                    help="não tentar descarregar as bibliotecas do editor")
    ap.add_argument("--fetch-vendor", action="store_true",
                    help="descarrega as bibliotecas do editor para uso offline e sai")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--version", action="version", version="LocalTeX " + __version__)
    ap.parse_args(namespace=CFG)

    CFG.projects = Path(CFG.projects).resolve()
    CFG.projects.mkdir(parents=True, exist_ok=True)
    CFG.texbin = find_texbin(CFG.texbin)

    if CFG.fetch_vendor:
        ok = sum(1 for rel in VENDOR if vendor_file(rel, quiet=False))
        print("Bibliotecas disponíveis localmente: %d/%d" % (ok, len(VENDOR)))
        return 0 if ok == len(VENDOR) else 1

    if CFG.host not in ("127.0.0.1", "localhost", "::1") and not CFG.password:
        print("AVISO: a escutar em %s sem --password; qualquer pessoa na rede pode "
              "ler e alterar os projetos." % CFG.host)

    httpd = ThreadingHTTPServer((CFG.host, CFG.port), Handler)
    httpd.daemon_threads = True
    shown = "localhost" if CFG.host in ("127.0.0.1", "0.0.0.0") else CFG.host
    url = "http://%s:%d/" % (shown, CFG.port)
    print("LocalTeX em %s" % url)
    print("  projetos: %s" % CFG.projects)
    print("  TeX:      %s" % (CFG.texbin or "PATH do sistema"))
    for e in ENGINES:
        print("  %-9s %s" % (e, which(e) or "NÃO ENCONTRADO"))
    print("  latexmk   %s" % (which("latexmk") or "não encontrado (uso sequência interna)"))
    print("Ctrl+C para terminar.")
    if not CFG.no_browser and CFG.host in ("127.0.0.1", "localhost"):
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nA terminar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
