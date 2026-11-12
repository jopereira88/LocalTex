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

__version__ = "1.2.0"

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


# ---------------------------------------------------------------------- i18n

# A interface pode estar em portugues (texto de origem) ou ingles. O browser indica a
# lingua no cabecalho X-LocalTeX-Lang e as mensagens "error"/"message" das respostas sao
# traduzidas a saida. Chaves: texto portugues exato; %s/%d marcam valores variaveis.
MESSAGES_EN = {
    "Nome de projeto inválido.": "Invalid project name.",
    "Projeto não encontrado.": "Project not found.",
    "Caminho inválido.": "Invalid path.",
    "Caminho fora do projeto.": "Path outside the project.",
    "O ficheiro não é um .zip válido.": "The file is not a valid .zip.",
    "Arquivo demasiado grande.": "Archive too large.",
    "Ficheiro principal não encontrado: %s": "Main file not found: %s",
    "O motor «%s» não foi encontrado. Indique a pasta da distribuição TeX com --texbin (ver README).":
        "The «%s» engine was not found. Point to your TeX distribution folder with --texbin (see README).",
    "Compilação interrompida: excedeu %d s.": "Compilation stopped: exceeded %d s.",
    "A compilação falhou (código %s). Fim da saída:\n%s": "Compilation failed (code %s). End of output:\n%s",
    "%s (em %s, linha %s)": "%s (in %s, line %s)",
    " (%s, linha %s)": " (%s, line %s)",
    "Caracteres sem glifo na fonte %s: %s": "Characters with no glyph in font %s: %s",
    "DOI inválido (deve começar por 10.).": "Invalid DOI (must start with 10.).",
    "Modo offline: não é possível consultar o DOI.": "Offline mode: cannot look up the DOI.",
    "DOI não encontrado.": "DOI not found.",
    "doi.org respondeu %s.": "doi.org answered %s.",
    "Não foi possível contactar doi.org: %s": "Could not reach doi.org: %s",
    "doi.org não devolveu BibTeX.": "doi.org did not return BibTeX.",
    "Entrada BibTeX inválida.": "Invalid BibTeX entry.",
    "O git não está instalado nesta máquina.": "git is not installed on this machine.",
    "O git demorou demasiado (rede ou autenticação?).": "git took too long (network or authentication?).",
    "Sem credenciais para este repositório. Configure uma chave SSH ou um credential helper na "
    "máquina onde corre o LocalTeX, ou use um URL com token (https://TOKEN@github.com/utilizador/repo.git).":
        "No credentials for this repository. Set up an SSH key or a credential helper on the machine "
        "running LocalTeX, or use a URL with a token (https://TOKEN@github.com/user/repo.git).",
    "Indique o seu nome e e-mail no painel Git.": "Enter your name and e-mail in the Git panel.",
    "O repositório remoto tem alterações que ainda não tem. Faça «Receber» primeiro.":
        "The remote repository has changes you don't have yet. Use «Pull» first.",
    "Repositório não encontrado (endereço errado ou sem acesso).":
        "Repository not found (wrong address or no access).",
    "Endereço Git inválido (use https://… ou git@servidor:utilizador/repo.git).":
        "Invalid Git address (use https://… or git@server:user/repo.git).",
    "Nome de ramo inválido.": "Invalid branch name.",
    "Indique um nome e um e-mail válidos.": "Enter a valid name and e-mail.",
    "Este projeto não tem repositório remoto (origin).": "This project has no remote repository (origin).",
    "O remoto ainda não tem o ramo «%s»; nada para receber.":
        "The remote doesn't have branch «%s» yet; nothing to pull.",
    "Não foi possível juntar as alterações automaticamente (há conflitos com as suas). Nada foi alterado.":
        "Could not merge the changes automatically (they conflict with yours). Nothing was changed.",
    "Atualizado. Última versão: %s": "Up to date. Latest version: %s",
    "Versão guardada localmente, mas o projeto não tem repositório remoto para onde enviar.":
        "Version saved locally, but the project has no remote repository to push to.",
    "Ficheiro demasiado grande.": "File too large.",
    "JSON inválido.": "Invalid JSON.",
    "Origem não permitida.": "Origin not allowed.",
    "Método não suportado.": "Method not supported.",
    "Biblioteca indisponível.": "Library unavailable.",
    "Não encontrado.": "Not found.",
    "Já existe um projeto com esse nome.": "A project with that name already exists.",
    "Rota desconhecida.": "Unknown route.",
    "Ficheiro não encontrado.": "File not found.",
    "Já existe uma pasta com esse nome.": "A folder with that name already exists.",
    "Origem não encontrada.": "Source not found.",
    "O destino já existe.": "The destination already exists.",
    "O projeto não tem nenhum ficheiro .tex.": "The project has no .tex file.",
    "Já existe uma compilação em curso neste projeto.": "A compilation is already running for this project.",
    "Já existe uma operação Git em curso neste projeto.": "A Git operation is already running for this project.",
    "Erro interno: %s": "Internal error: %s",
    "Língua de verificação desconhecida: %s": "Unknown spellcheck language: %s",
    "Não foi possível obter o dicionário %s (sem Internet?).":
        "Could not get the %s dictionary (no Internet?).",
}
TRANSLATIONS = {"en": MESSAGES_EN}
REQ = threading.local()


def _compile_messages(table):
    out = []
    for pt, tr in sorted(table.items(), key=lambda kv: -len(kv[0])):
        if "%" not in pt:
            out.append((None, pt, tr))
            continue
        parts = re.split(r"%[sd]", pt)
        pat = "".join(re.escape(x) + ("(.*?)" if i < len(parts) - 1 else "")
                      for i, x in enumerate(parts))
        if pt.endswith(("%s", "%d")):
            pat = pat[:-len("(.*?)")] + "(.*)"
        out.append((re.compile(pat, re.S), pt, re.sub(r"%[sd]", "%s", tr)))
    return out


COMPILED = {lang: _compile_messages(t) for lang, t in TRANSLATIONS.items()}


def localize(text, lang=None):
    """Traduz as partes de uma mensagem que correspondem a textos conhecidos."""
    lang = lang or getattr(REQ, "lang", "pt")
    if lang not in COMPILED or not isinstance(text, str):
        return text
    for rx, pt, tr in COMPILED[lang]:
        if rx is None:
            if pt in text:
                text = text.replace(pt, tr)
        elif rx.search(text):
            text = rx.sub(lambda m: tr % m.groups(), text, count=1)
    return text


def localize_json(obj):
    if isinstance(obj, dict):
        return {k: (localize(v) if k in ("error", "message") else localize_json(v))
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [localize_json(v) for v in obj]
    return obj


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
        # o latexmk recusa-se a recompilar se se lembrar de erros de uma execucao anterior
        # ("Nothing to do ... gave an error in previous invocation"); forca com -g para
        # que os erros reais voltem a aparecer no log.
        if rc != 0 and not timed_out and "previous invocation" in transcript[-1]:
            rc = step([latexmk, "-g", ENGINES[engine]] + opts + [main.name])
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
    blg = cwd / (stem + ".blg")
    if blg.exists() and blg.stat().st_mtime >= started - 2:
        issues = parse_blg(blg.read_text("utf-8", "replace"), proj, cwd) + issues
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


BLG_LOC_RE = re.compile(r"-+line (\d+) of file (\S+)")


def parse_blg(text, proj, cwd):
    """Erros e avisos do BibTeX/biber (.blg) como problemas clicaveis."""
    issues, root = [], proj.resolve()

    def rel(name):
        try:
            p = (cwd / name).resolve()
            return p.relative_to(root).as_posix() if p.is_file() else None
        except (OSError, ValueError):
            return None

    lines = text.splitlines()
    for i, ln in enumerate(lines):
        m = re.match(r"^\[\d+\] .*?> (ERROR|WARN) - (.*)$", ln)  # biber
        if m:
            msg = "biber: " + m.group(2)
            fm = re.search(r"(\S+\.bib)', line (\d+)|in file '?([^',]+\.bib)'?.*?line (\d+)", msg)
            f = rel(fm.group(1) or fm.group(3)) if fm else None
            line = int(fm.group(2) or fm.group(4)) if fm and f else None
            issues.append({"level": "error" if m.group(1) == "ERROR" else "warning",
                           "file": f, "line": line, "message": msg})
            continue
        lm = BLG_LOC_RE.search(ln)  # bibtex: "Repeated entry---line 390 of file x.bib"
        if lm:
            msg = ln[:lm.start()].strip() or (lines[i - 1].strip() if i else "")
            ctx = [x.strip() for x in lines[i + 1:i + 3] if x.startswith(" :")]
            if ctx:
                msg += "\n" + "\n".join(ctx)
            f = rel(lm.group(2))
            issues.append({"level": "error", "file": f, "line": int(lm.group(1)) if f else None,
                           "message": "BibTeX: " + msg + ("" if f else " (%s, linha %s)"
                                                          % (lm.group(2), lm.group(1)))})
        elif ln.startswith("Warning--"):
            issues.append({"level": "warning", "file": None, "line": None,
                           "message": "BibTeX: " + ln[9:].strip()})
        elif re.match(r"^I (couldn't open|found no)", ln):
            issues.append({"level": "error", "file": None, "line": None,
                           "message": "BibTeX: " + ln.strip()})
    return issues[:200]


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
            add("warning", "Caracteres sem glifo na fonte %s: %s" % (
                font, " ".join(chars[:40]) + (" …" if len(chars) > 40 else "")))
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


# ----------------------------------------------------------------------- git

# Usa o git do sistema e as credenciais ja configuradas na maquina (credential helper,
# chave SSH, ou um token no URL). Nunca pede nada no terminal: falha com mensagem clara.
GIT_URL_RE = re.compile(r"^(?:https?://|ssh://|git://)[^\s]+$|^[\w.\-]+@[\w.\-]+:[^\s]+$")
GIT_EXCLUDE_MARK = "# LocalTeX: ficheiros auxiliares"


def git_env():
    env = dict(os.environ)
    env.update({"GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never", "LC_ALL": "C",
                "GIT_SSH_COMMAND": env.get("GIT_SSH_COMMAND", "ssh -o BatchMode=yes"),
                # nunca subir ate a pasta-mae (o proprio LocalTeX pode ser um repositorio)
                "GIT_CEILING_DIRECTORIES": str(CFG.projects)})
    return env


def git(cwd, *args, check=True, timeout=180):
    exe = shutil.which("git")
    if not exe:
        raise ApiError(400, "O git não está instalado nesta máquina.")
    try:
        p = subprocess.run([exe] + list(args), cwd=str(cwd), env=git_env(),
                           stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise ApiError(504, "O git demorou demasiado (rede ou autenticação?).")
    out = (p.stdout + p.stderr).decode("utf-8", "replace").strip()
    if check and p.returncode != 0:
        raise ApiError(400, git_explain(out))
    return p.returncode, out


def git_explain(out):
    low = out.lower()
    hint = ""
    if "could not read username" in low or "authentication failed" in low \
            or "permission denied (publickey)" in low or "terminal prompts disabled" in low:
        hint = ("\n\nSem credenciais para este repositório. Configure uma chave SSH ou um "
                "credential helper na máquina onde corre o LocalTeX, ou use um URL com token "
                "(https://TOKEN@github.com/utilizador/repo.git).")
    elif "please tell me who you are" in low or "empty ident" in low:
        hint = "\n\nIndique o seu nome e e-mail no painel Git."
    elif "non-fast-forward" in low or "fetch first" in low or "rejected" in low:
        hint = "\n\nO repositório remoto tem alterações que ainda não tem. Faça «Receber» primeiro."
    elif "repository not found" in low or "does not appear to be a git repository" in low:
        hint = "\n\nRepositório não encontrado (endereço errado ou sem acesso)."
    return redact(out[-3000:]) + hint


def redact(text):
    return re.sub(r"(https?://)[^/@\s]+@", r"\1***@", text or "")


def check_git_url(url):
    url = (url or "").strip()
    if not GIT_URL_RE.match(url) or url.startswith("-"):
        raise ApiError(400, "Endereço Git inválido (use https://… ou git@servidor:utilizador/repo.git).")
    return url


def git_prepare(proj):
    """Exclui os auxiliares do LaTeX e o PDF do documento principal via .git/info/exclude
    (nao mexe no .gitignore do repositorio; ficheiros ja seguidos pelo git nao sao afetados,
    e os PDF usados como figuras continuam a entrar)."""
    ex = proj / ".git" / "info" / "exclude"
    try:
        old = ex.read_text("utf-8") if ex.exists() else ""
        want = []
        if GIT_EXCLUDE_MARK not in old:
            want = [GIT_EXCLUDE_MARK] + ["*." + e for e in sorted(AUX_EXT)] + \
                ["*" + x for x in AUX_SUFFIX] + [SETTINGS_FILE, "*.~tmp", "_minted*/"]
        main = guess_main(proj, load_settings(proj))
        if main:
            pdf = "/" + re.sub(r"\.tex$", ".pdf", main, flags=re.I)
            if pdf not in old.splitlines():
                want.append(pdf)
        if want:
            ex.parent.mkdir(parents=True, exist_ok=True)
            sep = "\n" if old and not old.endswith("\n") else ""
            ex.write_text(old + sep + "\n".join(want) + "\n", "utf-8")
    except OSError:
        pass


def is_repo(proj):
    return (proj / ".git").exists()


def git_clone(url, proj, branch=None):
    url = check_git_url(url)
    args = ["clone", "--quiet"]
    if branch:
        if not re.match(r"^[\w./\-]+$", branch) or branch.startswith("-"):
            raise ApiError(400, "Nome de ramo inválido.")
        args += ["--branch", branch]
    try:
        git(CFG.projects, *args, "--", url, proj.name, timeout=600)
    except Exception:
        shutil.rmtree(proj, ignore_errors=True)
        raise
    git_prepare(proj)


def git_status(proj):
    if not is_repo(proj):
        return {"repo": False, "git": bool(shutil.which("git"))}
    git_prepare(proj)
    _, out = git(proj, "status", "--porcelain=v1", "-b", "-uall")
    lines = out.splitlines()
    head = lines[0][3:] if lines and lines[0].startswith("## ") else ""
    m = re.match(r"(?:No commits yet on |Initial commit on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?", head)
    info = {"repo": True, "branch": m.group(1) if m else head, "upstream": m.group(2) if m else None,
            "ahead": 0, "behind": 0, "changes": []}
    if m and m.group(3):
        for part in m.group(3).split(","):
            k, _, v = part.strip().partition(" ")
            if k in ("ahead", "behind") and v.isdigit():
                info[k] = int(v)
    labels = {"M": "alterado", "A": "novo", "D": "apagado", "R": "renomeado", "?": "novo",
              "U": "conflito", "C": "copiado"}
    for ln in lines[1:]:
        xy, path = ln[:2], ln[3:]
        code = "U" if "U" in xy or xy in ("AA", "DD") else (xy.strip() or "M")[0]
        info["changes"].append({"path": path.split(" -> ")[-1].strip('"'),
                                "state": labels.get(code, code)})
    _, remote = git(proj, "remote", "get-url", "origin", check=False)
    info["remote"] = redact(remote) if remote and "error" not in remote.lower() \
        and "no such remote" not in remote.lower() else None
    _, name = git(proj, "config", "user.name", check=False)
    _, email = git(proj, "config", "user.email", check=False)
    info["identity"] = {"name": name, "email": email} if name and email else None
    _, last = git(proj, "log", "-1", "--format=%h %s (%cr)", check=False)
    info["last"] = last if last and not last.startswith("fatal") else None
    return info


def git_init(proj, url):
    if not is_repo(proj):
        git(proj, "init", "--quiet")
        _, cur = git(proj, "symbolic-ref", "--short", "HEAD", check=False)
        if cur == "master":
            git(proj, "symbolic-ref", "HEAD", "refs/heads/main")
    git_prepare(proj)
    if url:
        url = check_git_url(url)
        rc, _ = git(proj, "remote", "get-url", "origin", check=False)
        git(proj, "remote", "set-url" if rc == 0 else "add", "origin", url)


def git_identity(proj, name, email):
    name, email = (name or "").strip(), (email or "").strip()
    if not name or "@" not in email or "\n" in name + email:
        raise ApiError(400, "Indique um nome e um e-mail válidos.")
    git(proj, "config", "user.name", name)
    git(proj, "config", "user.email", email)


def git_pull(proj):
    st = git_status(proj)
    if not st.get("remote"):
        raise ApiError(400, "Este projeto não tem repositório remoto (origin).")
    git(proj, "fetch", "--quiet", "origin", timeout=600)
    if not st.get("upstream"):
        rc, _ = git(proj, "rev-parse", "--verify", "--quiet", "origin/" + st["branch"], check=False)
        if rc != 0:
            return {"message": "O remoto ainda não tem o ramo «%s»; nada para receber." % st["branch"]}
        git(proj, "branch", "--set-upstream-to=origin/" + st["branch"], check=False)
    rc, out = git(proj, "pull", "--rebase", "--autostash", "--quiet", check=False, timeout=600)
    if rc != 0:
        git(proj, "rebase", "--abort", check=False)
        raise ApiError(409, "Não foi possível juntar as alterações automaticamente (há conflitos "
                            "com as suas). Nada foi alterado.\n\n" + git_explain(out))
    _, after = git(proj, "log", "-1", "--format=%h %s", check=False)
    return {"message": "Atualizado. Última versão: " + after}


def git_commit(proj, message, push):
    message = (message or "").strip() or "Alterações feitas no LocalTeX"
    git_prepare(proj)
    git(proj, "add", "-A")
    rc, _ = git(proj, "diff", "--cached", "--quiet", check=False)
    committed = False
    if rc != 0:
        git(proj, "commit", "--quiet", "-m", message)
        committed = True
    pushed = False
    if push:
        st = git_status(proj)
        if not st.get("remote"):
            raise ApiError(400, "Versão guardada localmente, mas o projeto não tem repositório "
                                "remoto para onde enviar.")
        if st.get("upstream"):
            git(proj, "push", "--quiet", timeout=600)
        else:
            git(proj, "push", "--quiet", "-u", "origin", "HEAD", timeout=600)
        pushed = True
    return {"committed": committed, "pushed": pushed}


# ------------------------------------------------------------------- symbols

LABEL_RE = re.compile(r"\\label\s*\{([^}]+)\}")
NEWCMD_RE = re.compile(r"\\(?:re)?newcommand\*?\s*\{?\s*\\([a-zA-Z@]+)\s*\}?\s*(?:\[(\d)\])?"
                       r"|\\(?:DeclareMathOperator|DeclareRobustCommand)\*?\s*\{?\s*\\([a-zA-Z@]+)"
                       r"|\\def\s*\\([a-zA-Z@]+)")
NEWENV_RE = re.compile(r"\\(?:re)?newenvironment\*?\s*\{([^}]+)\}|\\newtheorem\*?\s*\{([^}]+)\}")


def project_symbols(proj):
    """Rotulos (\\label), comandos e ambientes definidos no projeto, para autocompletar."""
    labels, cmds, envs = [], {}, set()
    for rel in project_files(proj, (".tex", ".sty", ".cls")):
        try:
            lines = (proj / rel).read_text("utf-8", "replace").splitlines()
        except OSError:
            continue
        for n, ln in enumerate(lines, 1):
            ln = COMMENT_RE.sub("", ln)
            for m in LABEL_RE.finditer(ln):
                labels.append({"key": m.group(1).strip(), "file": rel, "line": n,
                               "context": ln.strip()[:120]})
            for m in NEWCMD_RE.finditer(ln):
                name = m.group(1) or m.group(3) or m.group(4)
                cmds.setdefault(name, int(m.group(2) or 0))
            for m in NEWENV_RE.finditer(ln):
                envs.add((m.group(1) or m.group(2)).strip())
        if len(labels) > 5000:
            break
    return {"labels": labels, "commands": [{"name": k, "args": v} for k, v in sorted(cmds.items())],
            "environments": sorted(envs)}


# ------------------------------------------------------------------- spelling

# Verificador ortografico proprio, compativel com os dicionarios Hunspell (.aff/.dic):
# em vez de gerar todas as formas das palavras (milhoes, em portugues), retira prefixos e
# sufixos a palavra ate chegar a um radical do dicionario, como faz o Hunspell. Carrega em
# menos de um segundo e nao precisa de nada instalado. Os dicionarios sao descarregados na
# primeira utilizacao (como as bibliotecas do editor) ou lidos de /usr/share/hunspell.
SPELL_LANGS = {
    "pt_PT": ("Português (Portugal)", "dictionary-pt-pt@2.0.0"),
    "en_GB": ("English (UK)", "dictionary-en-gb@3.0.0"),
    "en_US": ("English (US)", "dictionary-en@4.0.0"),
}
SYSTEM_DICT_DIRS = ("/usr/share/hunspell", "/usr/share/myspell", "/usr/share/myspell/dicts")
SPELLERS = {}
SPELLERS_GUARD = threading.Lock()


class Speller:
    def __init__(self, aff_text, dic_text):
        self.sfx, self.pfx = {}, {}          # add -> [(flag, strip, cond_re, cross)]
        self.rep, self.maps, self.try_chars = [], [], ""
        self.nosuggest, self.onlycompound, self.forbidden = None, None, None
        groups = {}
        for raw in aff_text.splitlines():
            parts = raw.split()
            if not parts or parts[0].startswith("#"):
                continue
            key = parts[0]
            if key in ("SFX", "PFX") and len(parts) >= 4:
                flag = parts[1]
                if flag not in groups.get(key, {}):  # cabecalho: SFX flag cross N
                    groups.setdefault(key, {})[flag] = parts[2] == "Y"
                    continue
                strip = "" if parts[2] == "0" else parts[2]
                add = parts[3].split("/")[0]
                add = "" if add == "0" else add
                cond = parts[4] if len(parts) > 4 else "."
                try:
                    rx = re.compile(("(?:%s)$" if key == "SFX" else "^(?:%s)") % cond)
                except re.error:
                    continue
                table = self.sfx if key == "SFX" else self.pfx
                table.setdefault(add, []).append((flag, strip, rx, groups[key][flag]))
            elif key == "REP" and len(parts) == 3:
                self.rep.append((parts[1].replace("_", " "), parts[2].replace("_", " ")))
            elif key == "MAP" and len(parts) == 2 and not parts[1].isdigit():
                self.maps.append(re.findall(r"\([^)]*\)|.", parts[1]))
            elif key == "TRY" and len(parts) == 2:
                self.try_chars = parts[1]
            elif key == "NOSUGGEST" and len(parts) == 2:
                self.nosuggest = parts[1]
            elif key == "ONLYINCOMPOUND" and len(parts) == 2:
                self.onlycompound = parts[1]
            elif key == "FORBIDDENWORD" and len(parts) == 2:
                self.forbidden = parts[1]
        self.words = {}
        for i, line in enumerate(dic_text.splitlines()):
            if i == 0 and line.strip().isdigit():
                continue
            entry = line.split("\t")[0].split(" ")[0].strip()
            if not entry:
                continue
            word, _, flags = entry.partition("/")
            if word:
                self.words[word] = self.words.get(word, "") + flags
        self.sfx_max = max((len(a) for a in self.sfx), default=0)
        self.pfx_max = max((len(a) for a in self.pfx), default=0)

    # -- verificacao
    def _root(self, stem, flag):
        f = self.words.get(stem)
        return f is not None and flag in f and not (self.forbidden and self.forbidden in f)

    def _suffixed(self, w, need=None):
        """w = radical + sufixo? (need: o radical tem de ter tambem esta flag de prefixo)"""
        n = len(w)
        for k in range(max(0, n - self.sfx_max), n + 1):
            for flag, strip, rx, cross in self.sfx.get(w[k:], ()):
                stem = w[:k] + strip
                if not stem or not rx.search(stem):
                    continue
                if need is None and self._root(stem, flag):
                    return True
                if need is not None and cross and self._root(stem, flag) and need in self.words[stem]:
                    return True
        return False

    def _lookup(self, w):
        f = self.words.get(w)
        if f is not None:
            bad = (self.onlycompound and self.onlycompound in f) or (self.forbidden and self.forbidden in f)
            if not bad:
                return True
        if self._suffixed(w):
            return True
        for k in range(0, min(len(w), self.pfx_max) + 1):
            for flag, strip, rx, cross in self.pfx.get(w[:k], ()):
                stem = strip + w[k:]
                if not stem or not rx.search(stem):
                    continue
                if self._root(stem, flag):
                    return True
                if cross and self._suffixed(stem, need=flag):
                    return True
        return False

    def check(self, w):
        w = w.replace("’", "'")
        if self._lookup(w):
            return True
        if w[:1].isupper():
            low = w[:1].lower() + w[1:]
            if self._lookup(low) or (w.isupper() and (self._lookup(w.lower())
                                                       or self._lookup(w[:1] + w[1:].lower()))):
                return True
            if w[1:].islower() is False and self._lookup(w.lower()):
                return True
        if "-" in w.strip("-"):
            return all(self.check(p) for p in w.split("-") if p)
        return False

    # -- sugestoes
    def suggest(self, w, limit=8):
        w = w.replace("’", "'")
        cap = w[:1].isupper() and not w.isupper()
        base = w[:1].lower() + w[1:] if cap else w
        out, seen = [], {base}

        def ok(c):
            if c in seen or not c:
                return
            seen.add(c)
            if " " in c:
                if all(self.check(p) for p in c.split(" ")):
                    out.append(c)
            elif self.check(c):
                f = self.words.get(c, "")
                if not (self.nosuggest and self.nosuggest in f):
                    out.append(c)
        for a, b in self.rep:                       # erros tipicos da lingua
            i = base.find(a)
            while i >= 0:
                ok(base[:i] + b + base[i + len(a):])
                i = base.find(a, i + 1)
        for group in self.maps:                     # acentos e letras equivalentes
            for i, ch in enumerate(base):
                if ch in group:
                    for alt in group:
                        if alt != ch and len(alt) == 1:
                            ok(base[:i] + alt + base[i + 1:])
        letters = self.try_chars or "abcdefghijklmnopqrstuvwxyz"
        n = len(base)
        for i in range(n - 1):                      # letras trocadas
            ok(base[:i] + base[i + 1] + base[i] + base[i + 2:])
        for i in range(n):                          # letra a mais
            ok(base[:i] + base[i + 1:])
        for i in range(n):                          # letra errada
            for c in letters:
                if c != base[i] and c.islower() == base[i].islower():
                    ok(base[:i] + c + base[i + 1:])
        for i in range(n + 1):                      # letra em falta
            for c in letters:
                if c.islower():
                    ok(base[:i] + c + base[i:])
        for i in range(1, n):                       # duas palavras coladas
            ok(base[:i] + " " + base[i:])
        if len(out) < 3:                            # acento + outro erro
            for group in self.maps:
                for i, ch in enumerate(base):
                    if ch in group:
                        for alt in group:
                            if alt != ch and len(alt) == 1:
                                v = base[:i] + alt + base[i + 1:]
                                for j in range(len(v) + 1):
                                    for c in letters[:20]:
                                        if c.islower():
                                            ok(v[:j] + c + v[j:])
                                for j in range(len(v)):
                                    ok(v[:j] + v[j + 1:])
        res = out[:limit]
        return [r[:1].upper() + r[1:] for r in res] if cap else res


def dict_files(lang):
    """Caminhos (.aff, .dic): do sistema, ou da pasta dictionaries/ (descarrega se faltar)."""
    for d in SYSTEM_DICT_DIRS:
        aff, dic = Path(d) / (lang + ".aff"), Path(d) / (lang + ".dic")
        if aff.is_file() and dic.is_file():
            return aff, dic
    base = ROOT / "dictionaries"
    aff, dic = base / (lang + ".aff"), base / (lang + ".dic")
    if aff.is_file() and dic.is_file():
        return aff, dic
    if CFG.offline:
        return None
    pkg = SPELL_LANGS[lang][1]
    try:
        base.mkdir(parents=True, exist_ok=True)
        for ext, dest in (("aff", aff), ("dic", dic)):
            req = urllib.request.Request(CDN + pkg + "/index." + ext, headers={"User-Agent": "LocalTeX"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            tmp = dest.with_suffix(".part")
            tmp.write_bytes(data)
            tmp.replace(dest)
        return aff, dic
    except Exception:
        return None


def speller(lang):
    if lang not in SPELL_LANGS:
        raise ApiError(400, "Língua de verificação desconhecida: %s" % lang)
    with SPELLERS_GUARD:
        sp = SPELLERS.get(lang)
        if sp is None:
            files = dict_files(lang)
            if not files:
                raise ApiError(503, "Não foi possível obter o dicionário %s (sem Internet?)." % lang)
            enc_ = "utf-8"
            head = files[0].read_bytes()[:4000].decode("latin-1")
            m = re.search(r"^SET\s+(\S+)", head, re.M)
            if m and m.group(1).upper() not in ("UTF-8", "UTF8"):
                enc_ = {"ISO8859-1": "latin-1", "ISO8859-15": "iso8859-15"}.get(m.group(1).upper(), "latin-1")
            sp = Speller(files[0].read_text(enc_, "replace"), files[1].read_text(enc_, "replace"))
            SPELLERS[lang] = sp
    return sp


def spell_check_words(lang, words):
    sp = speller(lang)
    wrong = []
    for w in words[:20000]:
        if isinstance(w, str) and 1 < len(w) <= 60 and not sp.check(w):
            wrong.append(w)
    return wrong


BABEL_LANGS = {"portuguese": "pt_PT", "portuges": "pt_PT", "portugues": "pt_PT",
               "british": "en_GB", "ukenglish": "en_GB", "english": "en_US",
               "american": "en_US", "usenglish": "en_US", "brazil": "pt_PT", "brazilian": "pt_PT"}


def guess_spell_lang(proj, main):
    """Lingua a partir do babel/polyglossia do ficheiro principal (a ultima opcao manda)."""
    try:
        head = COMMENT_RE.sub("", (proj / main).read_text("utf-8", "replace")[:30000])
    except (OSError, TypeError):
        return None
    m = re.search(r"\\usepackage\s*\[([^\]]*)\]\s*\{babel\}", head)
    if m:
        opts = [o.strip().lower() for o in m.group(1).split(",") if o.strip()]
        main_opt = next((o.split("=")[1] for o in opts if o.startswith("main=")), None)
        for o in ([main_opt] if main_opt else []) + opts[::-1]:
            if o in BABEL_LANGS:
                return BABEL_LANGS[o]
    m = re.search(r"\\setmainlanguage\s*(?:\[([^\]]*)\])?\s*\{(\w+)\}", head)
    if m:
        lang, opt = m.group(2).lower(), (m.group(1) or "").lower()
        if lang == "english":
            return "en_GB" if "british" in opt or "uk" in opt else "en_US"
        return BABEL_LANGS.get(lang)
    return None


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
        if getattr(REQ, "lang", "pt") != "pt":
            obj = localize_json(obj)
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
        lang = (self.headers.get("X-LocalTeX-Lang") or "pt").strip().lower()[:5]
        REQ.lang = lang if lang in TRANSLATIONS else "pt"
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
                "projectsDir": str(CFG.projects), "git": bool(shutil.which("git")),
            "version": __version__,
            })
        if parts == ["spell"] and m == "GET":
            return self.send_json({k: v[0] for k, v in SPELL_LANGS.items()})
        if parts == ["spell"] and m == "POST":
            b = self.json_body()
            return self.send_json({"wrong": spell_check_words(b.get("lang"), list(b.get("words") or []))})
        if parts == ["spell", "suggest"] and m == "POST":
            b = self.json_body()
            w = str(b.get("word") or "")[:60]
            return self.send_json({"suggestions": speller(b.get("lang")).suggest(w) if w else []})
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
            if b.get("git"):
                git_clone(b["git"], proj, (b.get("branch") or "").strip() or None)
                return self.send_json({"name": proj.name})
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
                                   "magic": magic_engine(proj / main) if main else None,
                                   "spellGuess": guess_spell_lang(proj, main) if main else None})
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
            if b.get("spellLang") in list(SPELL_LANGS) + ["auto", "off"]:
                s["spellLang"] = b["spellLang"]
            if isinstance(b.get("words"), list):
                s["words"] = sorted({w.strip() for w in b["words"]
                                     if isinstance(w, str) and 0 < len(w.strip()) <= 60})[:5000]
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
        if action == "symbols" and m == "GET":
            return self.send_json(project_symbols(proj))
        if action == "git":
            sub = rest[1] if len(rest) > 1 else ""
            if sub == "" and m == "GET":
                return self.send_json(git_status(proj))
            if m != "POST":
                raise ApiError(405, "Método não suportado.")
            b = self.json_body()
            with LOCKS_GUARD:
                lock = LOCKS.setdefault("git:" + proj.name, threading.Lock())
            if not lock.acquire(blocking=False):
                raise ApiError(409, "Já existe uma operação Git em curso neste projeto.")
            try:
                if sub == "init":
                    git_init(proj, (b.get("url") or "").strip() or None)
                    res = {}
                elif sub == "identity":
                    git_identity(proj, b.get("name"), b.get("email"))
                    res = {}
                elif sub == "pull":
                    res = git_pull(proj)
                elif sub == "commit":
                    res = git_commit(proj, b.get("message"), bool(b.get("push")))
                else:
                    raise ApiError(404, "Rota desconhecida.")
            finally:
                lock.release()
            res["status"] = git_status(proj)
            return self.send_json(res)
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
        dicts = sum(1 for lang in SPELL_LANGS if dict_files(lang))
        print("Dicionários ortográficos: %d/%d" % (dicts, len(SPELL_LANGS)))
        return 0 if ok == len(VENDOR) and dicts == len(SPELL_LANGS) else 1

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
