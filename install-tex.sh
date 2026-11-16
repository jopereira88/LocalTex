#!/usr/bin/env bash
# LocalTeX - install a TeX distribution on Linux / WSL and put it on the PATH.
#
#   ./install-tex.sh                    # TeX Live (upstream) in ~/texlive, scheme-full, no docs
#   ./install-tex.sh --scheme medium    # smaller: medium scheme + what LocalTeX needs
#   ./install-tex.sh --apt              # Ubuntu/Debian packages instead (needs sudo, older TeX Live)
#   ./install-tex.sh --prefix /opt/texlive --mirror https://ftp.example.org/CTAN
#
# Upstream mode installs as the current user (no sudo for TeX itself) and adds
# <prefix>/bin/<arch> to ~/.profile and ~/.bashrc. Safe to re-run: an existing
# install is updated with tlmgr and the missing packages are added.
set -euo pipefail

MODE=upstream
SCHEME=full
PREFIX="$HOME/texlive"
MIRROR="https://mirror.ctan.org/systems/texlive/tlnet"
WITH_DOCS=0

# Packages LocalTeX relies on (engines, latexmk, bibliographies, word count, languages).
EXTRA_PKGS=(collection-luatex collection-xetex collection-latexextra collection-bibtexextra
            collection-fontsrecommended collection-mathscience collection-langportuguese
            collection-langenglish latexmk biber texcount synctex)

APT_PKGS=(texlive-latex-extra texlive-luatex texlive-xetex texlive-fonts-recommended
          texlive-fonts-extra texlive-bibtex-extra texlive-science texlive-extra-utils
          texlive-lang-portuguese texlive-lang-english biber latexmk fontconfig)

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
log()   { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die()   { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --apt)       MODE=apt ;;
        --scheme)    SCHEME="${2:?}"; shift ;;
        --prefix)    PREFIX="${2:?}"; shift ;;
        --mirror)    MIRROR="${2%/}"; shift; case "$MIRROR" in */tlnet) ;; *) MIRROR="$MIRROR/systems/texlive/tlnet" ;; esac ;;
        --with-docs) WITH_DOCS=1 ;;
        -h|--help)   usage ;;
        *)           echo "unknown option: $1" >&2; usage 1 ;;
    esac
    shift
done
case "$SCHEME" in full|medium|small|basic|minimal) ;; *) die "--scheme must be full, medium, small, basic or minimal" ;; esac

# ---------------------------------------------------------------- apt mode
if [ "$MODE" = apt ]; then
    command -v apt-get >/dev/null || die "apt-get not found; use the default (upstream) mode"
    if [ "$SCHEME" = full ]; then APT_PKGS=(texlive-full biber latexmk); fi
    log "Installing with apt: ${APT_PKGS[*]}"
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${APT_PKGS[@]}"
    log "Done. Binaries are in /usr/bin (already on the PATH)."
    lualatex --version | head -1
    exit 0
fi

# ---------------------------------------------------------------- upstream mode
[ "$(uname -s)" = Linux ] || die "this script is for Linux/WSL; on macOS install MacTeX (https://tug.org/mactex/)"
case "$(uname -m)" in
    x86_64|amd64)  ARCH=x86_64-linux ;;
    aarch64|arm64) ARCH=aarch64-linux ;;
    *) die "unsupported architecture $(uname -m); try --apt" ;;
esac
BIN="$PREFIX/bin/$ARCH"

# Prerequisites: install-tl needs perl, wget/curl, tar; fontconfig lets XeTeX/LuaTeX find system fonts.
missing=()
command -v perl >/dev/null || missing+=(perl)
command -v wget >/dev/null || command -v curl >/dev/null || missing+=(wget)
command -v tar  >/dev/null || missing+=(tar)
command -v fc-cache >/dev/null || missing+=(fontconfig)
perl -MDigest::MD5 -e1 2>/dev/null || missing+=(perl-modules)
if [ ${#missing[@]} -gt 0 ]; then
    command -v apt-get >/dev/null || die "please install: ${missing[*]}"
    log "Installing prerequisites with apt (sudo): ${missing[*]}"
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}" ca-certificates
fi

fetch() { if command -v wget >/dev/null; then wget -q --show-progress -O "$2" "$1"; else curl -fL# -o "$2" "$1"; fi; }

if [ -x "$BIN/tlmgr" ]; then
    log "TeX Live already in $PREFIX; updating"
    "$BIN/tlmgr" option repository "$MIRROR" >/dev/null
    "$BIN/tlmgr" update --self --all || log "tlmgr update failed (a new TeX Live year may need a fresh install)"
else
    [ -e "$PREFIX" ] && [ -n "$(ls -A "$PREFIX" 2>/dev/null)" ] && die "$PREFIX exists and is not a TeX Live install; choose another --prefix"
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' EXIT
    log "Downloading the TeX Live installer from $MIRROR"
    fetch "$MIRROR/install-tl-unx.tar.gz" "$work/install-tl-unx.tar.gz"
    mkdir "$work/inst"
    tar -xzf "$work/install-tl-unx.tar.gz" -C "$work/inst" --strip-components=1

    cat > "$work/texlive.profile" <<EOF
selected_scheme scheme-$SCHEME
TEXDIR $PREFIX
TEXMFLOCAL $PREFIX/texmf-local
TEXMFSYSVAR $PREFIX/texmf-var
TEXMFSYSCONFIG $PREFIX/texmf-config
TEXMFHOME ~/texmf
TEXMFVAR ~/.texlive/texmf-var
TEXMFCONFIG ~/.texlive/texmf-config
binary_$ARCH 1
instopt_adjustpath 0
instopt_adjustrepo 1
instopt_letter 0
instopt_write18_restricted 1
tlpdbopt_autobackup 1
tlpdbopt_install_docfiles $WITH_DOCS
tlpdbopt_install_srcfiles $WITH_DOCS
EOF
    case "$SCHEME" in full) size="~5 GB" ;; medium) size="~1.5 GB" ;; *) size="<1 GB" ;; esac
    log "Installing scheme-$SCHEME into $PREFIX ($size, this can take a while)"
    mkdir -p "$PREFIX"
    perl "$work/inst/install-tl" --no-interaction --profile "$work/texlive.profile" --location "$MIRROR"
fi

if [ "$SCHEME" != full ]; then
    log "Adding the packages LocalTeX needs"
    "$BIN/tlmgr" install "${EXTRA_PKGS[@]}"
fi

# ---------------------------------------------------------------- PATH
MARK="# >>> LocalTeX: TeX Live >>>"
block() {
    cat <<EOF
$MARK
case ":\$PATH:" in *":$BIN:"*) ;; *) export PATH="$BIN:\$PATH" ;; esac
export MANPATH="$PREFIX/texmf-dist/doc/man:\${MANPATH:-}"
export INFOPATH="$PREFIX/texmf-dist/doc/info:\${INFOPATH:-}"
# <<< LocalTeX: TeX Live <<<
EOF
}
for rc in "$HOME/.profile" "$HOME/.bashrc" ${ZDOTDIR:+"$ZDOTDIR/.zshrc"} "$HOME/.zshrc"; do
    case "$rc" in */.zshrc) [ -f "$rc" ] || continue ;; esac
    touch "$rc"
    if grep -qF "$MARK" "$rc"; then
        # replace the old block (prefix may have changed)
        sed -i "/^$MARK\$/,/^# <<< LocalTeX: TeX Live <<<\$/d" "$rc"
    fi
    printf '\n%s\n' "$(block)" >> "$rc"
    log "PATH set in $rc"
done
export PATH="$BIN:$PATH"

# System fonts for XeLaTeX/LuaLaTeX (fontspec), incl. the TeX Live OpenType fonts.
if command -v fc-cache >/dev/null; then
    mkdir -p "$HOME/.config/fontconfig/conf.d"
    cat > "$HOME/.config/fontconfig/conf.d/09-texlive.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>$PREFIX/texmf-dist/fonts/opentype</dir>
  <dir>$PREFIX/texmf-dist/fonts/truetype</dir>
</fontconfig>
EOF
    log "Refreshing the font cache"
    fc-cache -f >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------- check
log "Checking the tools LocalTeX uses"
ok=1
for t in lualatex xelatex pdflatex latexmk bibtex biber kpsewhich synctex texcount; do
    if p="$(command -v "$t")"; then printf '  %-10s %s\n' "$t" "$p"; else printf '  %-10s MISSING\n' "$t"; ok=0; fi
done
log "Building the LuaLaTeX font cache with a test document"
t="$(mktemp -d)"
cat > "$t/test.tex" <<'EOF'
\documentclass{article}
\usepackage{fontspec}
\begin{document}
Olá, LocalTeX! $e^{i\pi}+1=0$
\end{document}
EOF
if (cd "$t" && latexmk -lualatex -interaction=nonstopmode -silent test.tex >/dev/null 2>&1); then
    echo "  lualatex test: OK"
else
    echo "  lualatex test: FAILED (see $t/test.log)"; ok=0
fi
[ "$ok" = 1 ] && rm -rf "$t"

echo
log "TeX Live is in $BIN"
echo "    Open a new terminal (or run: source ~/.profile) to get it on the PATH,"
echo "    then start LocalTeX with ./start.sh"
[ "$ok" = 1 ] || exit 1
