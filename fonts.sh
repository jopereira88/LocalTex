#!/usr/bin/env bash
# LocalTeX - make the Microsoft fonts that Overleaf/Word projects ask for work with
# fontspec (\setmainfont{Arial}, ...) in XeLaTeX and LuaLaTeX.
#
#   ./fonts.sh             # set up what is missing (may use sudo to install cabextract)
#   ./fonts.sh --no-sudo   # never call sudo (used by server.py at startup)
#   ./fonts.sh --check     # only report; exit 1 if a font is missing
#   ./fonts.sh --quiet     # print only changes and problems
#
# Fonts: Times New Roman, Arial (regular/bold/italic, Black, Narrow), Calibri, Helvetica,
# Comic Sans MS.
#   WSL         -> Windows fonts (C:\Windows\Fonts and the per-user font folder) are
#                  exposed to fontconfig/luaotfload; nothing is copied.
#   Pure Linux  -> Microsoft's "Core fonts for the web" (Times New Roman, Arial, Arial Black,
#                  Comic Sans MS) are downloaded from SourceForge, checked against pinned
#                  SHA-256 sums (the same ones Debian's ttf-mscorefonts-installer uses) and
#                  installed in ~/.local/share/fonts (or /usr/local/share/fonts as root).
#                  They are distributed under Microsoft's EULA:
#                  https://corefonts.sourceforge.net/eula.htm
#   Fonts with no free download (Calibri, Arial Narrow, Helvetica) get a fontspec alias
#   (<Name>.fontspec in TEXMFHOME) pointing at a metric-compatible font from TeX Live:
#   Calibri -> Carlito, Arial Narrow -> TeX Gyre Heros Cn, Helvetica -> TeX Gyre Heros.
#   An alias is written only while the real font is missing and removed once it exists.
# Safe to re-run; when everything is in place it changes nothing.
set -uo pipefail

SUDO_OK=1; CHECK=0; QUIET=0
for a in "$@"; do
    case "$a" in
        --no-sudo) SUDO_OK=0 ;;
        --check)   CHECK=1 ;;
        --quiet)   QUIET=1 ;;
        -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $a" >&2; exit 2 ;;
    esac
done

log()  { [ "$QUIET" = 1 ] || printf '\033[1;34m==>\033[0m %s\n' "$*"; }
note() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }

[ "$(uname -s)" = Linux ] || { warn "fonts.sh is for Linux/WSL"; exit 0; }

FAMILIES=("Times New Roman" "Arial" "Arial Black" "Arial Narrow" "Calibri" "Helvetica" "Comic Sans MS")

# Microsoft core fonts: archive -> SHA-256 (Debian msttcorefonts 3.8.1, cabfiles.sha256sums).
COREFONTS_MIRROR="${LOCALTEX_COREFONTS_MIRROR:-https://downloads.sourceforge.net/corefonts}"
declare -A CORE_SHA=(
    [times32.exe]=db56595ec6ef5d3de5c24994f001f03b2a13e37cee27bc25c58f6f43e8f807ab
    [arial32.exe]=85297a4d146e9c87ac6f74822734bdee5f4b2a722d7eaa584b7f2cbf76f478f6
    [arialb32.exe]=a425f0ffb6a1a5ede5b979ed6177f4f4f4fdef6ae7c302a7b7720ef332fec0a8
    [comic32.exe]=9c6df3feefde26d4e41d4a4fe5db2a89f9123a772594d7f59afd062625cd204e
)
declare -A CORE_ARCHIVE=(
    ["Times New Roman"]=times32.exe ["Arial"]=arial32.exe
    ["Arial Black"]=arialb32.exe ["Comic Sans MS"]=comic32.exe
)

# Fallback aliases: family -> "Free family|regular|bold|italic|bolditalic" (files in TeX Live).
declare -A ALIAS=(
    ["Calibri"]="Carlito|Carlito-Regular.ttf|Carlito-Bold.ttf|Carlito-Italic.ttf|Carlito-BoldItalic.ttf"
    ["Helvetica"]="TeX Gyre Heros|texgyreheros-regular.otf|texgyreheros-bold.otf|texgyreheros-italic.otf|texgyreheros-bolditalic.otf"
    ["Arial Narrow"]="TeX Gyre Heros Cn|texgyreheroscn-regular.otf|texgyreheroscn-bold.otf|texgyreheroscn-italic.otf|texgyreheroscn-bolditalic.otf"
    # used only if the Microsoft download is impossible (offline, no extractor)
    ["Arial"]="TeX Gyre Heros|texgyreheros-regular.otf|texgyreheros-bold.otf|texgyreheros-italic.otf|texgyreheros-bolditalic.otf"
    ["Times New Roman"]="TeX Gyre Termes|texgyretermes-regular.otf|texgyretermes-bold.otf|texgyretermes-italic.otf|texgyretermes-bolditalic.otf"
)

CHANGED=0
is_wsl() { [ -z "${LOCALTEX_FONTS_NO_WSL:-}" ] || return 1; [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; }
have_font() { command -v fc-list >/dev/null && fc-list -q ":family=$1"; }
font_file() { fc-list -f '%{file}\n' ":family=$1" 2>/dev/null | head -1; }
as_root() {
    if [ "$(id -u)" = 0 ]; then "$@"
    elif [ "$SUDO_OK" = 1 ] && command -v sudo >/dev/null; then sudo "$@"
    else return 1; fi
}
pkg_install() {   # pkg_install <package>...  (best effort, any common distro)
    if   command -v apt-get >/dev/null; then as_root apt-get update -qq && as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
    elif command -v dnf     >/dev/null; then as_root dnf install -y "$@"
    elif command -v yum     >/dev/null; then as_root yum install -y "$@"
    elif command -v zypper  >/dev/null; then as_root zypper --non-interactive install "$@"
    elif command -v pacman  >/dev/null; then as_root pacman -S --needed --noconfirm "$@"
    elif command -v apk     >/dev/null; then as_root apk add "$@"
    else return 1; fi
}
TEXMFHOME_DIR="$(kpsewhich -var-value TEXMFHOME 2>/dev/null || true)"
ALIAS_DIR="${TEXMFHOME_DIR:+$TEXMFHOME_DIR/tex/latex/localtex-fonts}"
alias_file() { printf '%s/%s.fontspec' "$ALIAS_DIR" "${1// /}"; }   # fontspec drops the spaces

# ------------------------------------------------------------------ report only
if [ "$CHECK" = 1 ]; then
    miss=0
    for f in "${FAMILIES[@]}"; do
        if have_font "$f"; then printf '  %-16s %s\n' "$f" "$(font_file "$f")"
        elif [ -n "$ALIAS_DIR" ] && [ -f "$(alias_file "$f")" ]; then printf '  %-16s alias -> %s\n' "$f" "${ALIAS[$f]%%|*}"
        else printf '  %-16s MISSING\n' "$f"; miss=1; fi
    done
    exit "$miss"
fi

# ------------------------------------------------------------------ fontconfig
if ! command -v fc-list >/dev/null; then
    log "Installing fontconfig"
    pkg_install fontconfig >/dev/null 2>&1 || warn "fontconfig is not installed and could not be installed"
fi
CONFD="$HOME/.config/fontconfig/conf.d"

# ------------------------------------------------------------------ LocalTeX fonts/ folder
# Drop any .ttf/.otf/.ttc into <LocalTeX>/fonts (e.g. ARIALN*.TTF for Arial Narrow); it is
# registered with fontconfig/luaotfload and wins over the aliases below.
FONTS_DIR="${LOCALTEX_FONTS_DIR:-$(cd "$(dirname "$0")" && pwd)/fonts}"
mkdir -p "$FONTS_DIR" 2>/dev/null
if [ -d "$FONTS_DIR" ]; then
    conf="$CONFD/11-localtex-fonts.conf"
    new="$(printf '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<!-- LocalTeX (fonts.sh): fonts added by hand to the LocalTeX fonts folder -->\n<fontconfig>\n  <dir>%s</dir>\n</fontconfig>' "$FONTS_DIR")"
    if [ "$(cat "$conf" 2>/dev/null)" != "$new" ]; then
        mkdir -p "$CONFD" && printf '%s\n' "$new" > "$conf"
        log "Fonts folder registered: $FONTS_DIR"
    fi
    # fingerprint of the folder: rebuild the caches only when files were added/changed/removed
    stamp="$FONTS_DIR/.localtex-stamp"
    print="$(find "$FONTS_DIR" -type f \( -iname '*.ttf' -o -iname '*.otf' -o -iname '*.ttc' \) -printf '%P %s %T@\n' 2>/dev/null | sort | sha256sum | cut -d' ' -f1)"
    if [ "$(cat "$stamp" 2>/dev/null)" != "$print" ]; then
        n="$(find "$FONTS_DIR" -type f \( -iname '*.ttf' -o -iname '*.otf' -o -iname '*.ttc' \) | wc -l)"
        if [ "$n" -gt 0 ] || [ -f "$stamp" ]; then note "Fonts folder changed ($n font files in $FONTS_DIR)"; fi
        fc-cache -f "$FONTS_DIR" >/dev/null 2>&1 || true
        printf '%s\n' "$print" > "$stamp"
        CHANGED=1
    fi
fi

# ------------------------------------------------------------------ WSL: expose Windows fonts
if is_wsl; then
    dirs=()
    for d in /mnt/*/Windows/Fonts /mnt/*/Users/*/AppData/Local/Microsoft/Windows/Fonts; do
        [ -d "$d" ] && [ -r "$d" ] && dirs+=("$d")
    done
    if [ ${#dirs[@]} -gt 0 ]; then
        conf="$CONFD/10-windows-fonts.conf"
        new="$(printf '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<!-- LocalTeX (fonts.sh): Windows fonts, used in place without copying -->\n<fontconfig>\n'
               printf '  <dir>%s</dir>\n' "${dirs[@]}"; printf '</fontconfig>')"
        if [ "$(cat "$conf" 2>/dev/null)" != "$new" ]; then
            mkdir -p "$CONFD" && printf '%s\n' "$new" > "$conf"
            note "WSL: Windows fonts exposed to fontconfig (${dirs[*]})"
            fc-cache -f >/dev/null 2>&1 || true
            CHANGED=1
        fi
    else
        warn "WSL detected but no Windows font folder is mounted under /mnt; installing fonts as on Linux"
    fi
fi

# ------------------------------------------------------------------ Linux: Microsoft core fonts
need=()
for f in "${!CORE_ARCHIVE[@]}"; do have_font "$f" || need+=("${CORE_ARCHIVE[$f]}"); done
if [ ${#need[@]} -gt 0 ]; then
    extractor=""
    find_extractor() {
        if   command -v cabextract >/dev/null; then extractor=cabextract
        elif command -v bsdtar     >/dev/null; then extractor=bsdtar
        elif command -v 7z         >/dev/null; then extractor=7z
        fi
    }
    find_extractor
    if [ -z "$extractor" ]; then
        log "Installing cabextract (needed to unpack the Microsoft font archives)"
        pkg_install cabextract >/dev/null 2>&1 && find_extractor
    fi
    if [ -z "$extractor" ]; then
        warn "cannot unpack the Microsoft fonts: install cabextract and run ./fonts.sh"
    elif ! command -v curl >/dev/null && ! command -v wget >/dev/null; then
        warn "cannot download the Microsoft fonts: install curl or wget"
    else
        if [ "$(id -u)" = 0 ]; then dest=/usr/local/share/fonts/ms-core
        else dest="${XDG_DATA_HOME:-$HOME/.local/share}/fonts/ms-core"; fi
        work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
        mkdir -p "$dest" "$work/x"
        note "Installing Microsoft core fonts into $dest (Microsoft EULA: https://corefonts.sourceforge.net/eula.htm)"
        for arc in $(printf '%s\n' "${need[@]}" | sort -u); do
            url="$COREFONTS_MIRROR/$arc"
            if command -v curl >/dev/null; then curl -fsSL --retry 2 -o "$work/$arc" "$url"
            else wget -q -O "$work/$arc" "$url"; fi || { warn "download failed: $url"; continue; }
            if [ "$(sha256sum "$work/$arc" | cut -d' ' -f1)" != "${CORE_SHA[$arc]}" ]; then
                warn "checksum mismatch for $arc; not installed"; continue
            fi
            rm -rf "$work/x"; mkdir "$work/x"
            case "$extractor" in
                cabextract) cabextract -q -L -d "$work/x" "$work/$arc" >/dev/null 2>&1 ;;
                bsdtar)     bsdtar -xf "$work/$arc" -C "$work/x" 2>/dev/null ;;
                7z)         7z x -y -o"$work/x" "$work/$arc" >/dev/null 2>&1 ;;
            esac
            n=0
            for ttf in "$work"/x/*.[tT][tT][fF]; do
                [ -f "$ttf" ] || continue
                b="$(basename "$ttf" | tr '[:upper:]' '[:lower:]')"
                install -m 0644 "$ttf" "$dest/$b" && n=$((n + 1))
            done
            [ "$n" -gt 0 ] && { note "  $arc: $n fonts"; CHANGED=1; } || warn "nothing extracted from $arc"
        done
        [ "$CHANGED" = 1 ] && fc-cache -f "$dest" >/dev/null 2>&1
    fi
fi

# ------------------------------------------------------------------ fontspec aliases
if [ -z "$ALIAS_DIR" ]; then
    warn "kpsewhich not found (TeX not on the PATH?); skipping the Calibri/Helvetica/Arial Narrow aliases"
else
    # Carlito comes with TeX Live scheme-full; add it to smaller installs when possible.
    if ! kpsewhich Carlito-Regular.ttf >/dev/null 2>&1 && ! have_font Calibri; then
        if command -v tlmgr >/dev/null && [ -w "$(kpsewhich -var-value TEXMFDIST)" ]; then
            log "Installing Carlito (Calibri-compatible) with tlmgr"; tlmgr install carlito >/dev/null 2>&1
        else
            pkg_install fonts-crosextra-carlito >/dev/null 2>&1 || pkg_install google-carlito-fonts >/dev/null 2>&1 || true
            fc-cache -f >/dev/null 2>&1 || true
        fi
    fi
    for f in "${!ALIAS[@]}"; do
        file="$(alias_file "$f")"
        if have_font "$f"; then
            [ -f "$file" ] && { rm -f "$file"; note "$f is installed; alias removed"; CHANGED=1; }
            continue
        fi
        IFS='|' read -r fam up bd it bi <<<"${ALIAS[$f]}"
        if ! kpsewhich "$up" >/dev/null 2>&1 && ! have_font "$fam"; then
            continue   # substitute not available either; reported below
        fi
        body="% LocalTeX (fonts.sh): \"$f\" is not installed; $fam has the same metrics.
% Deleted automatically once the real font is installed.
\\defaultfontfeatures[$f]{UprightFont=$up, BoldFont=$bd, ItalicFont=$it, BoldItalicFont=$bi}"
        if [ "$(cat "$file" 2>/dev/null)" != "$body" ]; then
            mkdir -p "$ALIAS_DIR" && printf '%s\n' "$body" > "$file"
            note "$f -> $fam (fontspec alias)"; CHANGED=1
        fi
    done
fi

# ------------------------------------------------------------------ LuaLaTeX font database
if [ "$CHANGED" = 1 ] && command -v luaotfload-tool >/dev/null; then
    log "Updating the LuaLaTeX font database"
    luaotfload-tool --update --force >/dev/null 2>&1 || warn "luaotfload-tool --update failed"
fi

# ------------------------------------------------------------------ summary
miss=()
for f in "${FAMILIES[@]}"; do
    if have_font "$f"; then src="$(font_file "$f")"
    elif [ -n "$ALIAS_DIR" ] && [ -f "$(alias_file "$f")" ]; then src="alias -> ${ALIAS[$f]%%|*}"
    else src="MISSING"; miss+=("$f"); fi
    [ "$QUIET" = 1 ] && [ "$src" != MISSING ] || printf '  %-16s %s\n' "$f" "$src"
done
if [ ${#miss[@]} -gt 0 ]; then
    warn "still missing: ${miss[*]} (run ./fonts.sh in a terminal; it may need sudo for cabextract)"
    exit 1
fi
exit 0
