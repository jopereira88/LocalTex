(() => {
'use strict';

const $ = id => document.getElementById(id);
const t = (s, v) => (window.I18N ? window.I18N.t(s, v) : s);
const lang = () => (window.I18N ? window.I18N.lang : 'pt');
const enc = encodeURIComponent;
const S = {
  project: null, files: [], settings: {}, main: null, magic: null,
  path: null, dir: '', dirty: false, binary: false,
  compiling: false, pending: false, issues: [], saveTimer: null, collapsed: new Set(),
};
const P = () => '/api/projects/' + enc(S.project);
const fileUrl = path => P() + '/file?path=' + enc(path);
const TEXT_MODES = /\.(tex|sty|cls|ltx|def|cfg|clo|ldf|bbx|cbx|lbx|dtx|ins|tikz|pgf|bib)$/i;
const BINARY = /\.(pdf|png|jpe?g|gif|bmp|eps|ps|ttf|otf|ttc|woff2?|zip|gz|xz|ico|mp4|xlsx?|docx?)$/i;
const ENGINE_NAMES = { lualatex: 'LuaLaTeX', xelatex: 'XeLaTeX', pdflatex: 'pdfLaTeX' };

async function api(method, url, body, raw) {
  const init = { method, headers: { 'X-LocalTeX-Lang': lang() } };
  if (body !== undefined) {
    if (typeof body === 'string' || body instanceof Blob || body instanceof ArrayBuffer) {
      init.body = body;
      init.headers['Content-Type'] = 'application/octet-stream';
    } else {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
  }
  const r = await fetch(url, init);
  if (!r.ok) {
    let msg = r.status + ' ' + r.statusText;
    try { msg = (await r.json()).error || msg; } catch (e) { /* resposta sem JSON */ }
    throw new Error(msg);
  }
  return raw ? r : r.json();
}

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
}
const dirname = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* indisponivel */ } },
};

// Area de transferencia: navigator.clipboard so existe em HTTPS/localhost; em modo
// servidor por HTTP simples usa-se o metodo antigo (textarea + execCommand).
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* tenta a alternativa */ }
  const ta = el('textarea', { style: 'position:fixed;top:-1000px;opacity:0', readonly: '' });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}
async function copyWithFeedback(text, btn) {
  const ok = await copyText(text);
  if (btn) {
    const old = btn.textContent;
    btn.textContent = ok ? t('Copiado ✓') : t('Falhou');
    setTimeout(() => { btn.textContent = old; }, 1200);
  }
  if (!ok) prompt(t('Copie manualmente (Ctrl+C):'), text);
}
// Mensagem de erro limpa para pesquisa na web: sem caminhos, numeros de linha nem contexto.
function searchQuery(msg) {
  let q = String(msg).split('\n')[0]
    .replace(/\s*\((?:em|in) [^)]*, (?:linha|line) \d+\)/, '')
    .replace(/(?:[A-Za-z]:)?[\w./\\-]+\.(?:tex|sty|cls|bib|bst|aux|ltx|def):\d+:?/g, '')
    .replace(/on input line \d+\.?/g, '').replace(/\bon page \d+\b/g, '')
    .replace(/`[^']{1,60}'/g, m => (/cite|ref/i.test(msg) ? '' : m))
    .replace(/\s+/g, ' ').trim();
  if (q.length > 160) q = q.slice(0, 160);
  return /latex|tex\b/i.test(q) ? q : 'LaTeX ' + q;
}
const searchUrl = msg => 'https://www.google.com/search?q=' + enc(searchQuery(msg));
const LEVELS = { error: 'Erro', warning: 'Aviso', box: 'Caixa' };
const issueText = it => (it.file ? it.file + ':' + (it.line || '') + ': ' : it.line ? t('linha {n}', { n: it.line }) + ': ' : '')
  + (LEVELS[it.level] ? t(LEVELS[it.level]) : it.level) + ': ' + it.message;

/* ------------------------------------------------------------------ editor */
const Ed = {
  cm: null, ta: null, silent: false,
  init() {
    const host = $('editor');
    if (window.CodeMirror) {
      this.cm = window.CodeMirror(host, {
        lineNumbers: true, lineWrapping: true, mode: 'stex', indentUnit: 2, tabSize: 2,
        matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true,
        extraKeys: {
          'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment',
          Tab: cm => (cm.somethingSelected() ? cm.indentSelection('add')
            : cm.replaceSelection('  ', 'end')),
          'Shift-Tab': cm => cm.indentSelection('subtract'),
          'Ctrl-Space': cm => Complete.show(cm, true),
        },
      });
      this.cm.on('change', () => { if (!this.silent) onEdit(); });
      this.cm.on('inputRead', (cm, change) => Complete.onInput(cm, change));
      this.cm.on('cursorActivity', () => WC.schedule());
      this.cm.on('changes', () => { if (!this.silent) Spell.schedule(); });
      this.cm.on('viewportChange', () => Spell.schedule(150));
      this.cm.getWrapperElement().addEventListener('contextmenu', ev => Spell.menu(ev));
    } else {
      this.ta = el('textarea', { class: 'plain', spellcheck: 'false', wrap: 'soft' });
      this.ta.addEventListener('input', () => { if (!this.silent) onEdit(); });
      host.append(this.ta);
    }
  },
  set(text, path) {
    this.silent = true;
    if (this.cm) {
      this.cm.swapDoc(window.CodeMirror.Doc(text, TEXT_MODES.test(path || '') ? 'stex' : null));
      this.cm.refresh();
    } else this.ta.value = text;
    this.silent = false;
  },
  get() { return this.cm ? this.cm.getValue() : this.ta.value; },
  focus() { (this.cm || this.ta).focus(); },
  refresh() { if (this.cm) this.cm.refresh(); },
  goto(line) {
    line = Math.max(0, (line | 0) - 1);
    if (this.cm) {
      const cm = this.cm;
      line = Math.min(line, cm.lineCount() - 1);
      cm.setCursor({ line, ch: 0 });
      cm.scrollIntoView({ line, ch: 0 }, cm.getScrollInfo().clientHeight / 3);
      cm.addLineClass(line, 'background', 'line-flash');
      setTimeout(() => cm.removeLineClass(line, 'background', 'line-flash'), 1200);
      cm.focus();
    } else {
      const lines = this.ta.value.split('\n');
      const pos = lines.slice(0, line).reduce((a, l) => a + l.length + 1, 0);
      this.ta.focus();
      this.ta.setSelectionRange(pos, pos + (lines[line] || '').length);
    }
  },
};

function setSaveState(t) { $('savestate').textContent = t; }

function onEdit() {
  S.dirty = true;
  WC.schedule();
  setSaveState(t('por guardar'));
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => {
    save().then(() => { if ($('auto').checked) compile(); }).catch(() => {});
  }, 1200);
}

async function save() {
  clearTimeout(S.saveTimer);
  if (!S.dirty || S.binary || !S.path || !S.project) return;
  const path = S.path, text = Ed.get();
  S.dirty = false;
  setSaveState(t('a guardar…'));
  try {
    await api('PUT', fileUrl(path), text);
    if (!S.dirty) setSaveState(t('guardado'));
    if (/\.(tex|bib|ltx)$/i.test(path)) Bib.load();
    if (/\.(tex|ltx|sty|cls)$/i.test(path)) Sym.load();
    if (Git.st && Git.st.repo) Git.refresh();
  } catch (e) {
    S.dirty = true;
    setSaveState(t('erro ao guardar: {e}', { e: e.message }));
    throw e;
  }
}

/* ---------------------------------------------------------------- projects */
async function loadProjects(select) {
  const list = await api('GET', '/api/projects');
  const sel = $('project');
  sel.replaceChildren();
  if (!list.length) sel.append(el('option', { value: '' }, t('(sem projetos)')));
  for (const p of list) sel.append(el('option', { value: p.name }, p.name));
  const names = list.map(p => p.name);
  const want = [select, decodeURIComponent(location.hash.slice(1)), store.get('localtex.project')]
    .find(n => n && names.includes(n)) || names[0] || null;
  if (want) { sel.value = want; await openProject(want); } else closeProject();
}

function closeProject() {
  S.project = null; S.files = []; S.path = null; S.dirty = false;
  $('tree').replaceChildren(el('p', { class: 'empty' }, t('Crie ou importe um projeto.')));
  $('filename').textContent = '—';
  Ed.set('', '');
  Pdf.clear();
  Bib.data = { entries: [], missing: [], duplicates: [], missingResources: [] };
  $('refs-count').textContent = '';
  Sym.data = { labels: [], commands: [], environments: [] };
  Git.st = null; Git.badge();
  Spell.clear(); Spell.renderSelect();
  WC.update();
}

async function openProject(name) {
  try { await save(); } catch (e) { /* segue */ }
  S.project = name; S.path = null; S.dirty = false; S.dir = ''; S.collapsed = new Set();
  store.set('localtex.project', name);
  history.replaceState(null, '', '#' + enc(name));
  document.title = name + ' — LocalTeX';
  showIssues([]); $('log').textContent = ''; setStatus('');
  Pdf.clear();
  await refreshTree();
  Bib.load(); Sym.load(); Git.st = null; Git.refresh();
  const first = S.main || (S.files.find(f => !f.dir && TEXT_MODES.test(f.path)) || {}).path;
  if (first) await openFile(first); else { $('filename').textContent = '—'; Ed.set('', ''); }
  const pdf = S.main && S.main.replace(/\.[^./]+$/, '') + '.pdf';
  if (pdf && S.files.some(f => f.path === pdf)) Pdf.show(pdf);
}

async function refreshTree() {
  const t = await api('GET', P() + '/tree');
  S.files = t.files; S.settings = t.settings; S.main = t.main; S.magic = t.magic; S.spellGuess = t.spellGuess;
  $('engine').value = t.settings.engine || 'auto';
  $('engine').options[0].textContent = 'Auto → ' + ENGINE_NAMES[t.magic || 'lualatex'];
  renderTree();
}

/* -------------------------------------------------------------------- tree */
function renderTree() {
  const tree = $('tree');
  tree.replaceChildren();
  if (!S.files.length) tree.append(el('p', { class: 'empty' }, t('Projeto vazio.')));
  const hidden = p => [...S.collapsed].some(c => p.startsWith(c + '/'));
  for (const f of S.files) {
    if (hidden(f.path)) continue;
    const name = f.path.split('/').pop();
    const depth = f.path.split('/').length - 1;
    const act = el('span', { class: 'act' });
    const stop = fn => ev => { ev.stopPropagation(); fn(); };
    if (!f.dir && /\.tex$/i.test(name) && f.path !== S.main) {
      act.append(el('button', { title: t('Definir como ficheiro principal'), onclick: stop(() => setMain(f.path)) }, '☆'));
    }
    act.append(
      el('button', { title: t('Renomear / mover'), onclick: stop(() => renameItem(f.path)) }, '✎'),
      el('button', { title: t('Eliminar'), onclick: stop(() => deleteItem(f)) }, '✕'));
    const row = el('div', {
      class: 'row' + (f.dir ? ' dir' : '') + (f.path === S.path ? ' on' : '')
        + (f.dir && f.path === S.dir ? ' target' : ''),
      style: 'padding-left:' + (8 + depth * 14) + 'px', title: f.path,
      onclick: () => {
        if (f.dir) {
          if (S.collapsed.has(f.path)) S.collapsed.delete(f.path); else S.collapsed.add(f.path);
          S.dir = f.path;
          renderTree();
        } else openFile(f.path).catch(alertErr);
      },
    },
    el('span', { class: 'twist' }, f.dir ? (S.collapsed.has(f.path) ? '▸' : '▾') : ''),
    el('span', { class: 'name' }, name),
    f.path === S.main ? el('span', { class: 'main-mark', title: t('Ficheiro principal') }, '★') : null,
    act);
    tree.append(row);
  }
}

async function openFile(path, line) {
  if (path === S.path) { if (line) Ed.goto(line); return; }
  await save();
  const r = await api('GET', fileUrl(path), undefined, true);
  const buf = await r.arrayBuffer();
  let text = null;
  if (buf.byteLength < 3e6 && !BINARY.test(path)) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = null; }
  }
  S.path = path; S.dirty = false; S.binary = text === null; S.dir = dirname(path);
  $('filename').textContent = path;
  setSaveState('');
  $('editor').hidden = S.binary;
  $('binary').hidden = !S.binary;
  if (S.binary) showBinary(path, buf.byteLength);
  else { Ed.set(text, path); if (line) Ed.goto(line); else Ed.focus(); }
  renderTree();
  WC.update();
  Spell.clear(); Spell.schedule(50);
}

function showBinary(path, size) {
  const box = $('binary');
  box.replaceChildren();
  if (/\.(png|jpe?g|gif|bmp|ico)$/i.test(path)) box.append(el('img', { src: fileUrl(path), alt: path }));
  box.append(el('p', null, t('{path} — {kb} kB', { path, kb: (size / 1024).toFixed(1) })
    + (BINARY.test(path) ? '' : t(' (não é texto UTF-8, não pode ser editado aqui)'))));
  box.append(el('a', { class: 'btn', href: fileUrl(path) + '&download=1' }, t('Descarregar')));
  if (/\.pdf$/i.test(path)) {
    box.append(' ', el('button', { onclick: () => Pdf.show(path) }, t('Ver no painel PDF')));
  }
}

const alertErr = e => alert(e.message || e);

async function setMain(path) {
  await api('PUT', P() + '/settings', { main: path });
  await refreshTree();
}

async function newFile() {
  if (!S.project) return;
  const name = prompt(t('Nome do novo ficheiro (pode incluir pastas):'), (S.dir ? S.dir + '/' : '') + t('novo.tex'));
  if (!name) return;
  if (S.files.some(f => f.path === name)) return alert(t('Já existe.'));
  await api('PUT', fileUrl(name), '');
  await refreshTree();
  await openFile(name);
}

async function newDir() {
  if (!S.project) return;
  const name = prompt(t('Nome da nova pasta:'), (S.dir ? S.dir + '/' : '') + t('figuras'));
  if (!name) return;
  await api('POST', P() + '/mkdir', { path: name });
  S.dir = name.replace(/\/+$/, '');
  await refreshTree();
}

async function renameItem(path) {
  const to = prompt(t('Novo nome/caminho:'), path);
  if (!to || to === path) return;
  if (S.path && (S.path === path || S.path.startsWith(path + '/'))) await save();
  await api('POST', P() + '/rename', { from: path, to });
  if (S.path === path) S.path = to;
  else if (S.path && S.path.startsWith(path + '/')) S.path = to + S.path.slice(path.length);
  $('filename').textContent = S.path || '—';
  await refreshTree();
}

async function deleteItem(f) {
  if (!confirm(t(f.dir ? 'Eliminar a pasta e todo o conteúdo de «{p}»?' : 'Eliminar «{p}»?', { p: f.path }))) return;
  const current = S.path && (S.path === f.path || S.path.startsWith(f.path + '/'));
  if (current) { clearTimeout(S.saveTimer); S.dirty = false; }
  await api('DELETE', fileUrl(f.path));
  if (current) { S.path = null; $('filename').textContent = '—'; Ed.set('', ''); setSaveState(''); }
  if (S.dir === f.path || S.dir.startsWith(f.path + '/')) S.dir = '';
  await refreshTree();
}

async function uploadFiles(files, dir) {
  if (!S.project || !files.length) return;
  dir = dir == null ? S.dir : dir;
  setStatus(t('A carregar {n} ficheiro(s)…', { n: files.length }));
  try {
    for (const f of files) await api('PUT', fileUrl((dir ? dir + '/' : '') + f.name), f);
    setStatus(t('{n} ficheiro(s) carregado(s)', { n: files.length }), 'ok');
  } catch (e) { setStatus(t('Falha no carregamento'), 'bad'); alertErr(e); }
  await refreshTree();
}

/* ----------------------------------------------------------------- compile */
function setStatus(text, cls) {
  const s = $('status');
  s.textContent = text;
  s.className = 'status' + (cls ? ' ' + cls : '');
}

async function compile() {
  if (!S.project) return;
  if (S.compiling) { S.pending = true; return; }
  S.compiling = true;
  $('btn-compile').disabled = true;
  setStatus(t('A compilar…'));
  const t0 = Date.now();
  const tick = setInterval(() => setStatus(t('A compilar… {s} s', { s: Math.round((Date.now() - t0) / 1000) })), 1000);
  try {
    await save();
    showResult(await api('POST', P() + '/compile', {}));
  } catch (e) {
    setStatus(t('✗ falhou'), 'bad');
    showIssues([{ level: 'error', message: e.message }]);
  } finally {
    clearInterval(tick);
    S.compiling = false;
    $('btn-compile').disabled = false;
    if (S.pending) { S.pending = false; compile(); }
  }
}

function showResult(res) {
  const errs = res.issues.filter(i => i.level === 'error').length;
  const warns = res.issues.filter(i => i.level === 'warning').length;
  const eng = ENGINE_NAMES[res.engine] || res.engine;
  if (res.ok) setStatus('✓ ' + eng + ' · ' + res.duration + ' s' + (warns ? t(' · {n} aviso(s)', { n: warns }) : ''), 'ok');
  else setStatus(t('✗ {n} erro(s) · {eng}', { n: errs || 1, eng }), 'bad');
  showIssues(res.issues);
  $('log').textContent = res.log || res.output || '';
  if (!res.ok) { $('bottom').classList.remove('closed'); selectTab('issues'); }
  if (res.pdf && (res.pdfUpdated || !Pdf.path)) Pdf.show(res.pdf);
  refreshTree().catch(() => {});
}

function showIssues(issues) {
  S.issues = issues;
  const box = $('issues');
  box.replaceChildren();
  const errs = issues.filter(i => i.level === 'error').length;
  $('issue-count').textContent = !issues.length ? '' : errs ? t('({e} erro(s), {n} no total)', { e: errs, n: issues.length }) : t('({n} no total)', { n: issues.length });
  if (!issues.length) { box.append(el('p', { class: 'empty' }, t('Sem problemas a assinalar.'))); return; }
  const texFiles = S.files.filter(f => !f.dir && /\.tex$/i.test(f.path));
  for (const it of issues) {
    const file = it.file || (it.line && texFiles.length === 1 ? texFiles[0].path : null);
    const where = (it.file || '') + (it.line ? (it.file ? ':' + it.line : t('linha {n}', { n: it.line })) : '');
    const stop = ev => ev.stopPropagation();
    const copyBtn = el('button', {
      title: t('Copiar esta mensagem'), onclick: ev => { stop(ev); copyWithFeedback(issueText(it), ev.currentTarget); },
    }, t('Copiar'));
    box.append(el('div', {
      class: 'issue ' + it.level + (file ? ' link' : ''),
      // so salta para a linha se o utilizador nao estiver a selecionar texto
      onclick: file ? () => { if (!String(getSelection())) openFile(file, it.line).catch(alertErr); } : null,
    },
    el('span', { class: 'lvl' }, LEVELS[it.level] ? t(LEVELS[it.level]) : it.level),
    el('span', null, where ? el('div', { class: 'where' }, where) : null, el('div', { class: 'msg' }, it.message)),
    el('span', { class: 'issue-act' }, copyBtn,
      el('a', { class: 'btn', href: searchUrl(it.message), target: '_blank', rel: 'noopener noreferrer',
        title: t('Pesquisar na web: {q}', { q: searchQuery(it.message) }), onclick: stop }, t('Pesquisar ↗')))));
  }
}

function selectTab(which) {
  for (const t of ['issues', 'log', 'refs']) {
    $('tab-' + t).classList.toggle('on', which === t);
    $(t).hidden = which !== t;
  }
  $('issue-tools').hidden = which !== 'issues';
  $('log-tools').hidden = which !== 'log';
  if (which === 'log') $('log').scrollTop = $('log').scrollHeight;
  if (which === 'refs') Bib.render();
}

/* -------------------------------------------------------------- word count */
// Mesma heuristica do servidor (usada quando o texcount nao existe).
const SKIP_ENVS = 'equation|align|gather|multline|eqnarray|displaymath|math|verbatim|lstlisting|minted|tikzpicture|comment|filecontents';
function countWords(text) {
  text = text.replace(/(^|[^\\])%.*$/gm, '$1')
    .replace(new RegExp('\\\\begin\\{(' + SKIP_ENVS + ')\\*?\\}[\\s\\S]*?\\\\end\\{\\1\\*?\\}', 'g'), ' ')
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$]*\$|\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\\(?:begin|end|label|ref|eqref|cref|Cref|pageref|cite[a-z]*|usepackage|documentclass|includegraphics|input|include|bibliography[a-z]*|url|addbibresource|newcommand|renewcommand|setlength|setcounter|autoref|vspace|hspace)\*?(?:\[[^\]]*\])*(?:\{[^}]*\})?/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?|\\.|[{}[\]~&#^_]/g, ' ');
  const m = text.match(/[\p{L}](?:[\p{L}\p{N}_'’-]*[\p{L}\p{N}])?|\p{N}+(?:[.,]\p{N}+)*/gu);
  return m ? m.length : 0;
}
const fmtN = n => n.toLocaleString(window.I18N ? window.I18N.locale() : 'pt-PT');
const WC = {
  timer: null,
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.update(), 400); },
  update() {
    const b = $('wordcount');
    if (!S.path || S.binary || !/\.(tex|ltx)$/i.test(S.path)) { b.hidden = true; return; }
    b.hidden = false;
    let text = Ed.get();
    if (/\\begin\{document\}/.test(text)) text = text.split(/\\begin\{document\}/)[1];
    const sel = Ed.cm && Ed.cm.somethingSelected() ? Ed.cm.getSelection() : '';
    b.textContent = sel ? t('{a} de {b} palavras', { a: fmtN(countWords(sel)), b: fmtN(countWords(text)) })
      : t('{n} palavras', { n: fmtN(countWords(text)) });
  },
  async project() {
    const pop = $('wc-pop');
    if (!pop.hidden) { pop.hidden = true; return; }
    if (!S.project) return;
    pop.hidden = false;
    pop.replaceChildren(el('p', { class: 'muted' }, t('A contar…')));
    try {
      await save();
      const r = await api('GET', P() + '/wordcount');
      const rows = [[t('Total'), r.total]];
      if (r.tool === 'texcount') {
        rows.push([t('Texto'), r.text], [t('Títulos'), r.headers], [t('Legendas e notas'), r.captions],
          [t('Secções'), r.nheaders], [t('Figuras/tabelas'), r.floats],
          [t('Fórmulas (em linha / destacadas)'), r.mathInline + ' / ' + r.mathDisplay]);
      }
      rows.push([t('Ficheiros'), r.files]);
      pop.replaceChildren(
        el('div', { class: 'pop-title' }, t('Projeto inteiro ({main})', { main: S.main || '' })),
        el('table', null, ...rows.map(([k, v]) => el('tr', null, el('td', null, k),
          el('td', null, typeof v === 'number' ? fmtN(v) : v)))),
        el('div', { class: 'muted small' }, r.tool === 'texcount' ? t('Contagem do texcount.')
          : t('Contagem aproximada (texcount não encontrado).')),
        el('button', { onclick: ev => copyWithFeedback(rows.map(([k, v]) => k + ': ' + v).join('\n'), ev.currentTarget) }, t('Copiar')));
    } catch (e) { pop.replaceChildren(el('p', null, t('Falhou: {e}', { e: e.message }))); }
  },
};

/* ----------------------------------------------------------------- BibTeX */
const CITE_CTX = /\\(?![a-zA-Z]*style)[a-zA-Z]*cite[a-zA-Z]*\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)$/;
const fold = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const Bib = {
  data: { entries: [], missing: [], duplicates: [], missingResources: [] }, loading: null,
  async load() {
    if (!S.project) return;
    const proj = S.project;
    try {
      const d = await api('GET', P() + '/bib');
      if (proj !== S.project) return;
      this.data = d;
      for (const e of d.entries) e._hay = fold([e.key, e.author, e.editor, e.title, e.year, e.journal || e.journaltitle || e.booktitle].join(' '));
    } catch (e) { this.data = { entries: [], missing: [], duplicates: [], missingResources: [] }; }
    const n = this.data.entries.length, bad = this.data.missing.length;
    $('refs-count').textContent = !(n || bad) ? '' : bad ? t('({n}, {bad} em falta)', { n, bad }) : t('({n})', { n });
    $('tab-refs').classList.toggle('alert', bad > 0);
    if (!$('refs').hidden) this.render();
  },
  short(e) {
    const names = (e.author || e.editor || '').split(/\s+and\s+/).filter(Boolean)
      .map(a => (a.includes(',') ? a.split(',')[0] : a.split(' ').pop()).trim());
    const who = names.length > 2 ? names[0] + ' et al.' : names.join(' & ');
    return (who || '—') + (e.year ? ' (' + e.year + ')' : '');
  },
  search(q) {
    const words = fold(q).split(/\s+/).filter(Boolean);
    const list = this.data.entries.filter(e => words.every(w => e._hay.includes(w)));
    if (words.length) list.sort((a, b) => (fold(b.key).startsWith(words[0]) ? 1 : 0) - (fold(a.key).startsWith(words[0]) ? 1 : 0));
    return list;
  },
  // Autocompletar dentro de \cite{...}, \citep{...}, \parencite[..]{...}, etc.
  hint(cm) {
    const cur = cm.getCursor();
    const before = cm.getLine(cur.line).slice(0, cur.ch);
    const m = CITE_CTX.exec(before);
    if (!m) return null;
    const partial = m[1].split(',').pop().trimStart();
    const from = { line: cur.line, ch: cur.ch - partial.length };
    const after = cm.getLine(cur.line).slice(cur.ch).match(/^[^,}\s]*/)[0];
    const list = Bib.search(partial).slice(0, 60).map(e => ({
      text: e.key,
      render(node) {
        node.append(el('b', null, e.key), el('span', { class: 'hint-meta' }, ' ' + Bib.short(e) + (e.title ? ' — ' + e.title : '')));
      },
    }));
    if (!list.length) return null;
    return { list, from, to: { line: cur.line, ch: cur.ch + after.length } };
  },
  insert(key) {
    if (S.binary || !S.path) return alert(t('Abra um ficheiro .tex para inserir a citação.'));
    if (Ed.cm) {
      const cm = Ed.cm, cur = cm.getCursor();
      const before = cm.getLine(cur.line).slice(0, cur.ch);
      const m = CITE_CTX.exec(before);
      if (m) {
        const sep = m[1].trim() && !/,\s*$/.test(m[1]) ? ',' : '';
        cm.replaceRange(sep + key, cur);
      } else cm.replaceSelection('\\cite{' + key + '}', 'end');
      cm.focus();
    } else {
      const ta = Ed.ta, s = ta.selectionStart;
      ta.setRangeText('\\cite{' + key + '}', s, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    }
  },
  async add() {
    const box = $('refs-add'), v = box.value.trim();
    if (!v || !S.project) return;
    const btn = $('btn-refs-add');
    btn.disabled = true; btn.textContent = t('A obter…');
    try {
      await save();
      const r = await api('POST', P() + '/bib/add', v.startsWith('@') ? { bibtex: v } : { doi: v });
      box.value = '';
      setStatus(r.existed ? t('Já existia: {k}', { k: r.key }) : t('Acrescentado a {f}: {k}', { f: r.file, k: r.key }), 'ok');
      if (r.created) await refreshTree();
      if (S.path === r.file) { const p = S.path; S.path = null; await openFile(p); }
      await this.load();
      $('refs-search').value = r.key;
      this.render();
      await copyText(r.key);
    } catch (e) { alertErr(e); } finally { btn.disabled = false; btn.textContent = t('Adicionar'); }
  },
  render() {
    const d = this.data, alerts = $('refs-alerts'), listBox = $('refs-list');
    alerts.replaceChildren();
    const link = (f, line, text) => el('a', { href: '#', onclick: ev => { ev.preventDefault(); openFile(f, line).catch(alertErr); } }, text);
    if (d.missingResources.length) {
      alerts.append(el('div', { class: 'ref-alert' }, t('Ficheiro .bib referido mas inexistente: '),
        ...d.missingResources.map(r => el('code', null, r.resource + ' ')), t(' (em '), link(d.missingResources[0].file, null, d.missingResources[0].file), ')'));
    }
    if (d.missing.length) {
      const div = el('div', { class: 'ref-alert' }, t('{n} citação(ões) sem entrada no .bib: ', { n: d.missing.length }));
      d.missing.forEach((m, i) => div.append(i ? ', ' : '', el('code', null, m.key), ' (', link(m.file, m.line, m.file + ':' + m.line), ')'));
      alerts.append(div);
    }
    if (d.duplicates.length) {
      const div = el('div', { class: 'ref-alert warn' }, t('Chaves repetidas: '));
      d.duplicates.forEach((m, i) => div.append(i ? ', ' : '', link(m.file, m.line, m.key)));
      alerts.append(div);
    }
    listBox.replaceChildren();
    if (!d.entries.length) {
      listBox.append(el('p', { class: 'empty' }, t('Sem entradas .bib. Cole um DOI acima para criar references.bib.')));
      return;
    }
    const list = this.search($('refs-search').value);
    for (const e of list.slice(0, 500)) {
      const venue = e.journal || e.journaltitle || e.booktitle || e.publisher || '';
      const stop = ev => ev.stopPropagation();
      listBox.append(el('div', { class: 'ref', title: t('Clique para inserir \\cite{{k}} no cursor', { k: e.key }), onclick: () => this.insert(e.key) },
        el('div', { class: 'ref-main' },
          el('span', { class: 'ref-key' }, e.key),
          el('span', { class: 'ref-who' }, ' ' + this.short(e)),
          e.cited ? null : el('span', { class: 'badge' }, t('não citada')),
          el('div', { class: 'ref-title' }, (e.title || t('(sem título)')) + (venue ? ' — ' + venue : ''))),
        el('span', { class: 'issue-act' },
          el('button', { title: t('Copiar a chave'), onclick: ev => { stop(ev); copyWithFeedback(e.key, ev.currentTarget); } }, t('Chave')),
          el('button', { title: t('Abrir a entrada no {f}', { f: e.file }), onclick: ev => { stop(ev); openFile(e.file, e.line).catch(alertErr); } }, '.bib'),
          e.doi ? el('a', { class: 'btn', href: 'https://doi.org/' + e.doi, target: '_blank', rel: 'noopener noreferrer', onclick: stop }, 'DOI ↗') : null)));
    }
    if (!list.length) listBox.append(el('p', { class: 'empty' }, t('Nenhuma referência corresponde.')));
  },
};

/* ------------------------------------------------------------- autocomplete */
// Comandos frequentes, por ordem aproximada de utilizacao. "{}" marca argumentos: o cursor
// fica dentro do primeiro par de chavetas.
const LATEX_COMMANDS = (
  'textbf{} textit{} emph{} underline{} texttt{} textsc{} textsf{} textrm{} textup{} textsl{} textmd{} textnormal{} '
  + 'section{} subsection{} subsubsection{} paragraph{} subparagraph{} chapter{} part{} section*{} subsection*{} chapter*{} '
  + 'label{} ref{} eqref{} pageref{} autoref{} cref{} Cref{} nameref{} cite{} citep{} citet{} parencite{} textcite{} autocite{} footcite{} nocite{} citeauthor{} citeyear{} '
  + 'begin{} end{} item usepackage{} documentclass{} input{} include{} includegraphics{} caption{} centering footnote{} footnotemark footnotetext{} '
  + 'url{} href{}{} hline cline{} toprule midrule bottomrule cmidrule{} multicolumn{}{}{} multirow{}{}{} newline linebreak pagebreak newpage clearpage cleardoublepage noindent indent '
  + 'vspace{} hspace{} vspace*{} hspace*{} vfill hfill smallskip medskip bigskip quad qquad par '
  + 'frac{}{} dfrac{}{} tfrac{}{} sqrt{} sum int iint oint prod lim infty partial nabla cdot cdots ldots dots vdots ddots times div pm mp leq geq neq approx equiv sim simeq propto '
  + 'mathbf{} mathrm{} mathit{} mathcal{} mathbb{} mathsf{} mathtt{} mathfrak{} boldsymbol{} text{} operatorname{} overline{} underbrace{} overbrace{} hat{} bar{} tilde{} vec{} dot{} ddot{} widehat{} widetilde{} '
  + 'left right big Big bigg Bigg langle rangle lfloor rfloor lceil rceil '
  + 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega '
  + 'Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega '
  + 'in notin subset subseteq supset supseteq cup cap setminus emptyset forall exists neg land lor implies iff to mapsto rightarrow leftarrow Rightarrow Leftarrow leftrightarrow Leftrightarrow uparrow downarrow '
  + 'title{} author{} date{} today maketitle tableofcontents listoffigures listoftables appendix bibliography{} bibliographystyle{} addbibresource{} printbibliography '
  + 'newcommand{}{} renewcommand{}{} newenvironment{}{}{} DeclareMathOperator{}{} setlength{}{} setcounter{}{} addtocounter{}{} stepcounter{} value{} the '
  + 'textwidth linewidth textheight columnwidth paperwidth baselineskip parindent parskip '
  + 'tiny scriptsize footnotesize small normalsize large Large LARGE huge Huge '
  + 'color{} textcolor{}{} colorbox{}{} definecolor{}{}{} rowcolor{} cellcolor{} '
  + 'includepdf{} graphicspath{} resizebox{}{}{} scalebox{}{} rotatebox{}{} raisebox{}{} makebox{} framebox{} fbox{} mbox{} parbox{}{} '
  + 'setmainfont{} setsansfont{} setmonofont{} fontspec{} selectfont fontsize{}{} '
  + 'thanks{} and verb lstinline{} lstinputlisting{} ensuremath{} protect phantom{} hphantom{} vphantom{} '
  + 'pagestyle{} thispagestyle{} pagenumbering{} fancyhead{} fancyfoot{} lhead{} chead{} rhead{} lfoot{} cfoot{} rfoot{} '
  + 'todo{} hyperref{} hypersetup{} geometry{} captionof{}{} subcaption{} FloatBarrier acrshort{} acrlong{} gls{} '
  + 'LaTeX TeX ldots textbackslash textasciitilde textdegree euro S P copyright'
).split(' ').filter(Boolean);
const LATEX_ENVS = ('itemize enumerate description figure figure* table table* tabular tabularx longtable center flushleft flushright '
  + 'equation equation* align align* gather gather* multline split cases matrix pmatrix bmatrix vmatrix array '
  + 'abstract quote quotation verse verbatim lstlisting minted minipage subfigure document thebibliography tikzpicture '
  + 'theorem lemma proof definition corollary proposition remark example frame block columns column appendices '
  + 'tabbing xltabular supertabular landscape small footnotesize').split(' ');
const IMG_EXT = /\.(png|jpe?g|pdf|eps|svg|gif)$/i;
const Sym = {
  data: { labels: [], commands: [], environments: [] },
  async load() {
    if (!S.project) return;
    const proj = S.project;
    try { const d = await api('GET', P() + '/symbols'); if (proj === S.project) this.data = d; } catch (e) { /* segue */ }
  },
};
const Complete = {
  // Descobre o que esta a ser escrito antes do cursor e devolve as sugestoes.
  get(cm, manual) {
    const cur = cm.getCursor(), line = cm.getLine(cur.line);
    const before = line.slice(0, cur.ch), after = line.slice(cur.ch);
    if (CITE_CTX.test(before)) return Bib.hint(cm);
    let m;
    const word = (re) => { const x = after.match(re); return x ? x[0].length : 0; };
    const range = (partial, extra) => ({ from: { line: cur.line, ch: cur.ch - partial.length }, to: { line: cur.line, ch: cur.ch + extra } });
    const rank = (items, q, keyOf) => {
      q = fold(q);
      const pre = [], mid = [];
      for (const it of items) { const k = fold(keyOf(it)); if (k.startsWith(q)) pre.push(it); else if (q && k.includes(q)) mid.push(it); }
      return pre.concat(mid);
    };
    if ((m = /\\(?:[a-zA-Z]*ref|cref|Cref)\*?\{([^{}]*)$/.exec(before))) {
      const partial = m[1].split(',').pop().trimStart();
      const list = rank(Sym.data.labels, partial, l => l.key).slice(0, 80).map(l => ({
        text: l.key, render: n => n.append(el('b', null, l.key), el('span', { class: 'hint-meta' }, ' ' + l.file + ':' + l.line)),
      }));
      return list.length ? { list, ...range(partial, word(/^[^,}\s]*/)) } : null;
    }
    if ((m = /\\(?:input|include|subfile|includegraphics|includepdf|lstinputlisting|bibliography|addbibresource)(?:\[[^\]]*\])?\{([^{}]*)$/.exec(before))) {
      const cmd = before.match(/\\(\w+)[^\\]*$/)[1], partial = m[1];
      const want = cmd === 'includegraphics' ? IMG_EXT : /^(bibliography|addbibresource)$/.test(cmd) ? /\.bib$/i
        : cmd === 'includepdf' ? /\.pdf$/i : cmd === 'lstinputlisting' ? /./ : /\.tex$/i;
      const strip = cmd === 'bibliography' || cmd === 'input' || cmd === 'include' || cmd === 'subfile';
      const base = S.main ? dirname(S.main) : '';
      const files = S.files.filter(f => !f.dir && want.test(f.path))
        .map(f => { let p = base && f.path.startsWith(base + '/') ? f.path.slice(base.length + 1) : f.path; return strip ? p.replace(/\.(tex|bib)$/i, '') : p; });
      const list = rank(files, partial, p => p).slice(0, 80);
      return list.length ? { list, ...range(partial, word(/^[^}]*/)) } : null;
    }
    if ((m = /\\(begin|end)\{([a-zA-Z*]*)$/.exec(before))) {
      const isBegin = m[1] === 'begin', partial = m[2];
      const closed = after.startsWith('}');
      const envs = [...new Set(Sym.data.environments.concat(LATEX_ENVS))];
      const list = rank(envs, partial, e => e).slice(0, 60).map(env => ({
        text: env, displayText: env,
        hint(c, data, comp) {
          const indent = line.match(/^\s*/)[0];
          const to = { line: data.to.line, ch: data.to.ch + (closed ? 1 : 0) };
          if (!isBegin) { c.replaceRange(env + '}', data.from, to); return; }
          const extra = env === 'figure' || env === 'table' ? '[htbp]' : env === 'tabular' ? '{ll}' : '';
          const body = env === 'itemize' || env === 'enumerate' ? '\\item ' : '';
          c.replaceRange(env + '}' + extra + '\n' + indent + '  ' + body + '\n' + indent + '\\end{' + env + '}', data.from, to);
          c.setCursor({ line: data.from.line + 1, ch: indent.length + 2 + body.length });
        },
      }));
      return list.length ? { list, ...range(partial, word(/^[a-zA-Z*]*/)) } : null;
    }
    if ((m = /\\([a-zA-Z@]*)$/.exec(before)) && (manual || m[1].length >= 1)) {
      const partial = m[1];
      const own = Sym.data.commands.map(c => c.name + '{}'.repeat(Math.min(c.args, 3)));
      const all = [...new Set(own.concat(LATEX_COMMANDS))];
      const list = rank(all, partial, c => c.replace(/[{}*]+$/, '')).slice(0, 50)
        .filter(c => c.replace(/\{\}/g, '') !== partial || c.includes('{'))
        .map(c => ({
          text: c, displayText: '\\' + c,
          className: own.includes(c) ? 'hint-own' : '',
          hint(cc, data) {
            const nextBrace = c.includes('{') && after.slice(data.to.ch - cur.ch).startsWith('{');
            const text = nextBrace ? c.replace(/\{\}.*$/, '') : c;
            cc.replaceRange(text, data.from, data.to);
            const i = text.indexOf('{}');
            if (i >= 0) cc.setCursor({ line: data.from.line, ch: data.from.ch + i + 1 });
            else if (nextBrace) cc.setCursor({ line: data.from.line, ch: data.from.ch + text.length + 1 });
          },
        }));
      return list.length ? { list, ...range(partial, word(/^[a-zA-Z@]*/)) } : null;
    }
    return null;
  },
  show(cm, manual) {
    if (!cm.showHint) return;
    cm.showHint({ hint: c => Complete.get(c, manual), completeSingle: false,
      closeCharacters: /[\s()[\]{};>]/ });
  },
  onInput(cm, change) {
    if (!window.CodeMirror || !CodeMirror.showHint || cm.state.completionActive) return;
    if (change.origin !== '+input' || !TEXT_MODES.test(S.path || '') || /\.bib$/i.test(S.path)) return;
    if (!/[\w\\{,@*]/.test((change.text || []).join(''))) return;
    if (Complete.get(cm, false)) Complete.show(cm, false);
  },
};

/* -------------------------------------------------------------- spelling */
// O texto e extraido aqui (sem comandos, matematica, rotulos, citacoes...) e so as palavras
// ainda desconhecidas vao ao servidor; os resultados ficam em cache por lingua.
const SPELL_SKIP_ENVS = new Set(('equation align gather multline eqnarray displaymath math split alignat flalign '
  + 'verbatim Verbatim lstlisting minted comment tikzpicture filecontents dirtree').split(' '));
const SPELL_TABLE_ENVS = /^(tabular|tabularx|tabu|array|longtable|xltabular|supertabular|tabulary)\*?$/;
const SPELL_SKIP_ARG = 'label|ref|eqref|cref|Cref|autoref|pageref|nameref|vref|[a-zA-Z]*cite[a-zA-Z]*|nocite|usepackage|RequirePackage|documentclass|'
  + 'input|include|subfile|includegraphics|includepdf|includesvg|bibliography|bibliographystyle|addbibresource|url|href|'
  + 'lstinputlisting|lstset|lstdefinelanguage|newcommand|renewcommand|providecommand|newenvironment|renewenvironment|DeclareMathOperator|'
  + 'definecolor|color|textcolor|colorbox|rowcolor|cellcolor|setlength|addtolength|setcounter|addtocounter|stepcounter|'
  + 'vspace|hspace|graphicspath|hypersetup|geometry|pagestyle|thispagestyle|pagenumbering|setmainfont|setsansfont|setmonofont|'
  + 'fontspec|newfontfamily|setcitestyle|captionsetup|multicolumn|multirow|cline|cmidrule|hhline|arraystretch|'
  + 'acrshort|acrlong|acrfull|gls|Gls|glspl|seqsplit|texttt|verb|lstinline|path|email|doi|SI|si|num';
const SPELL_RX = new RegExp('\\\\begin\\{([^}]*)\\}(?:\\[[^\\]]*\\])?|\\\\end\\{[^}]*\\}'
  + '|\\\\(?:' + SPELL_SKIP_ARG + ')(?![a-zA-Z@])\\*?(?:\\s*\\[[^\\]]*\\])*(?:\\s*\\{[^{}]*\\})?'
  + '|\\\\[a-zA-Z@]+\\*?(?:\\[[^\\]]*\\])?|\\\\.|\\$\\$|\\\\\\[|\\$(?:[^$\\\\]|\\\\.)*\\$|\\\\\\(.*?\\\\\\)', 'g');
const SPELL_WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;
const SPELL_NAMES = { pt_PT: 'PT-PT', en_GB: 'EN-GB', en_US: 'EN-US' };
const blank = s => ' '.repeat(s.length);

function spellMaskLine(line, st) {
  // comentarios
  const cm = /(^|[^\\])(?:\\\\)*%/.exec(line);
  if (cm) line = line.slice(0, cm.index + cm[0].length - 1) + blank(line.slice(cm.index + cm[0].length - 1));
  let out = '', i = 0;
  while (i < line.length) {
    if (st.skip) {  // dentro de matematica destacada ou de um ambiente ignorado
      const end = st.skip === '\\[' ? '\\]' : st.skip === '$$' ? '$$' : '\\end{' + st.skip + '}';
      const j = line.indexOf(end, i);
      if (j < 0) { out += blank(line.slice(i)); return out; }
      out += blank(line.slice(i, j + end.length)); i = j + end.length; st.skip = null;
      continue;
    }
    SPELL_RX.lastIndex = i;
    const m = SPELL_RX.exec(line);
    if (!m) { out += line.slice(i); break; }
    out += line.slice(i, m.index);
    let tok = m[0];
    if (m[1] !== undefined) {
      const env = m[1].trim();
      if (SPELL_SKIP_ENVS.has(env.replace(/\*$/, ''))) st.skip = env;
      else if (SPELL_TABLE_ENVS.test(env)) {  // especificacao das colunas: {|l|c|}
        const spec = /^(?:\s*\{[^{}]*\})+/.exec(line.slice(m.index + tok.length));
        if (spec) tok += spec[0];
      }
    } else if (tok === '$$' || tok === '\\[') st.skip = tok;
    out += blank(tok);
    i = m.index + tok.length;
  }
  return out;
}

const Spell = {
  cache: {}, marks: [], timer: null, pending: new Set(), ignored: new Set(), busy: false, failed: {},
  langs: { pt_PT: 'Português (Portugal)', en_GB: 'English (UK)', en_US: 'English (US)' },
  setting() { return (S.settings && S.settings.spellLang) || 'auto'; },
  fileLang() {
    if (!Ed.cm) return null;
    for (let n = 0; n < Math.min(5, Ed.cm.lineCount()); n++) {
      const m = /%\s*!\s*TeX\s+spellcheck\s*=\s*([A-Za-z]{2})[-_]([A-Za-z]{2})/i.exec(Ed.cm.getLine(n));
      if (m) { const code = m[1].toLowerCase() + '_' + m[2].toUpperCase(); if (this.langs[code]) return code; }
    }
    return null;
  },
  autoLang() { return S.spellGuess || (lang() === 'pt' ? 'pt_PT' : 'en_GB'); },
  current() {
    if (!Ed.cm || !S.path || S.binary || !/\.(tex|ltx)$/i.test(S.path)) return null;
    const set = this.setting();
    if (set === 'off') return null;
    return this.fileLang() || (set === 'auto' ? this.autoLang() : set);
  },
  words() { return new Set((S.settings && S.settings.words) || []); },
  renderSelect() {
    const sel = $('spell-lang');
    if (!sel) return;
    const keep = this.setting();
    sel.replaceChildren(
      el('option', { value: 'auto' }, t('Ortografia: automática ({l})', { l: SPELL_NAMES[this.autoLang()] })),
      ...Object.keys(this.langs).map(k => el('option', { value: k }, t('Ortografia: {l}', { l: this.langs[k] }))),
      el('option', { value: 'off' }, t('Ortografia: desligada')));
    sel.value = keep;
    const fl = this.fileLang();
    sel.title = fl ? t('Este ficheiro usa {l} (comentário % !TeX spellcheck no início).', { l: this.langs[fl] })
      : t('Verificação ortográfica do projeto. Num ficheiro, pode impor outra língua com «% !TeX spellcheck = en_GB» numa das primeiras linhas.');
    sel.classList.toggle('overridden', !!fl);
    sel.hidden = !S.project;
  },
  clear() { this.marks.forEach(m => m.clear()); this.marks = []; },
  schedule(delay) { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), delay == null ? 500 : delay); },
  // palavras (com posicao) nas linhas visiveis, seguindo o estado desde o inicio do documento
  tokens(from, to) {
    const cm = Ed.cm, st = { skip: null }, out = [];
    let inDoc = !/\\begin\{document\}/.test(cm.getValue());
    for (let n = 0; n <= to; n++) {
      const raw = cm.getLine(n);
      if (!inDoc) { if (/\\begin\{document\}/.test(raw)) inDoc = true; continue; }
      const masked = spellMaskLine(raw, st);
      if (n < from) continue;
      for (const m of masked.matchAll(SPELL_WORD)) {
        let w = m[0], start = m.index;
        const lead = w.match(/^[-'’]*/)[0].length;
        w = w.replace(/^[-'’]+|[-'’]+$/g, ''); start += lead;
        if (w.length < 2 || /\p{N}/u.test(w) || /.\p{Lu}/u.test(w) || /^\p{Lu}+$/u.test(w)) continue;
        out.push({ line: n, ch: start, word: w });
      }
    }
    return out;
  },
  async run() {
    const lng = this.current();
    this.renderSelect();
    if (!lng) { this.clear(); return; }
    const cm = Ed.cm, vp = cm.getViewport();
    const from = Math.max(0, vp.from - 50), to = Math.min(cm.lineCount() - 1, vp.to + 50);
    const toks = this.tokens(from, to);
    const cache = this.cache[lng] || (this.cache[lng] = new Map());
    const unknown = [...new Set(toks.map(x => x.word))].filter(w => !cache.has(w));
    if (unknown.length) {
      if (this.busy) { this.schedule(300); return; }
      this.busy = true;
      try {
        const r = await api('POST', '/api/spell', { lang: lng, words: unknown });
        const wrong = new Set(r.wrong);
        unknown.forEach(w => cache.set(w, !wrong.has(w)));
        delete this.failed[lng];
      } catch (e) {
        if (!this.failed[lng]) { this.failed[lng] = true; setStatus(e.message, 'bad'); }
        return;
      } finally { this.busy = false; }
      if (lng !== this.current() || cm !== Ed.cm) return this.schedule(100);
    }
    const mine = this.words();
    this.clear();
    cm.operation(() => {
      for (const x of toks) {
        if (cache.get(x.word) !== false || mine.has(x.word) || this.ignored.has(x.word)) continue;
        this.marks.push(cm.markText({ line: x.line, ch: x.ch }, { line: x.line, ch: x.ch + x.word.length },
          { className: 'cm-spell-err', attributes: { 'data-word': x.word }, inclusiveLeft: false, inclusiveRight: false }));
      }
    });
  },
  async menu(ev) {
    const cm = Ed.cm, lng = this.current();
    if (!lng) return;
    const pos = cm.coordsChar({ left: ev.clientX, top: ev.clientY }, 'window');
    const mk = cm.findMarksAt(pos).find(m => m.className === 'cm-spell-err');
    if (!mk) return;
    ev.preventDefault();
    const range = mk.find(), word = cm.getRange(range.from, range.to);
    const box = $('spell-menu');
    const close = () => { box.hidden = true; };
    const item = (label, fn, cls) => el('button', { class: 'menu-item' + (cls ? ' ' + cls : ''), onclick: () => { close(); fn(); } }, label);
    box.replaceChildren(el('div', { class: 'muted small' }, t('A procurar sugestões…')));
    box.style.left = Math.min(ev.clientX, window.innerWidth - 260) + 'px';
    box.style.top = Math.min(ev.clientY + 4, window.innerHeight - 300) + 'px';
    box.hidden = false;
    let sugg = [];
    try { sugg = (await api('POST', '/api/spell/suggest', { lang: lng, word })).suggestions; } catch (e) { /* sem sugestoes */ }
    if (box.hidden) return;
    const replace = s => { const r = mk.find(); if (r) cm.replaceRange(s, r.from, r.to); cm.focus(); };
    box.replaceChildren(
      ...(sugg.length ? sugg.map(s => item(s, () => replace(s), 'sugg')) : [el('div', { class: 'muted small' }, t('Sem sugestões'))]),
      el('hr'),
      item(t('Adicionar «{w}» ao dicionário do projeto', { w: word }), () => this.addWord(word)),
      item(t('Ignorar nesta sessão'), () => { this.ignored.add(word); this.run(); }),
      el('div', { class: 'muted small menu-foot' }, this.langs[lng]));
  },
  async addWord(word) {
    const words = [...this.words(), word];
    try {
      S.settings = await api('PUT', P() + '/settings', { words });
      this.run();
    } catch (e) { alertErr(e); }
  },
  async setLang(v) {
    try { S.settings = await api('PUT', P() + '/settings', { spellLang: v }); } catch (e) { alertErr(e); }
    this.run();
  },
};

/* --------------------------------------------------------------------- git */
const Git = {
  st: null, busy: false, msg: null,
  async refresh() {
    if (!S.project) { this.st = null; this.badge(); return; }
    const proj = S.project;
    try { const st = await api('GET', P() + '/git'); if (proj === S.project) this.st = st; } catch (e) { this.st = null; }
    this.badge();
    if ($('git-dlg').open) this.render();
  },
  badge() {
    const b = $('git-badge'), st = this.st;
    $('btn-git').hidden = !S.project || !st || st.git === false;
    if (!st || !st.repo) { b.textContent = ''; b.title = ''; return; }
    const n = st.changes.length;
    b.textContent = n ? '● ' + n : st.behind ? '↓' + st.behind : st.ahead ? '↑' + st.ahead : '✓';
    b.className = n || st.ahead ? 'git-dirty' : '';
  },
  open() {
    if (!S.project) return;
    this.msg = null;
    $('git-dlg').showModal();
    this.render();
    this.refresh();
  },
  async run(path, body, after) {
    if (this.busy) return;
    this.busy = true; this.msg = { text: t('A trabalhar…') }; this.render();
    try {
      await save();
      const r = await api('POST', P() + '/git/' + path, body || {});
      this.st = r.status;
      this.msg = { text: after ? after(r) : t('Feito.'), ok: true };
      return r;
    } catch (e) {
      this.msg = { text: e.message, bad: true };
      await this.refresh();
      return null;
    } finally { this.busy = false; this.badge(); this.render(); }
  },
  async reloadAll() {
    await refreshTree();
    if (S.path && S.files.some(f => f.path === S.path)) { const p = S.path; S.path = null; S.dirty = false; await openFile(p); }
    else if (S.path) { S.path = null; $('filename').textContent = '—'; Ed.set('', ''); }
    Bib.load(); Sym.load();
  },
  render() {
    const box = $('git-body'), st = this.st;
    const B = (label, attrs) => el('button', Object.assign({ disabled: this.busy || null }, attrs), label);
    const input = (id, ph, val) => el('input', { id, placeholder: ph, value: val || '', spellcheck: 'false', autocomplete: 'off' });
    box.replaceChildren();
    $('git-sub').textContent = S.project || '';
    if (!st) { box.append(el('p', { class: 'muted' }, t('A carregar…'))); return; }
    if (st.git === false) { box.append(el('p', null, t('O git não está instalado na máquina onde corre o LocalTeX.'))); return; }
    if (!st.repo) {
      box.append(el('p', null, t('Este projeto ainda não usa Git. Ative-o para guardar versões e, se quiser, ligá-lo a um repositório (GitHub, GitLab…). Crie primeiro o repositório vazio no site.')),
        el('label', null, t('Endereço do repositório remoto (opcional)'), input('git-url', t('https://github.com/utilizador/repo.git'))),
        el('div', { class: 'dlg-foot' }, B(t('Ativar Git'), { class: 'primary', onclick: () => this.run('init', { url: $('git-url').value.trim() }, () => t('Git ativado.')) })));
    } else {
      const sync = [st.ahead ? t('↑ {n} por enviar', { n: st.ahead }) : '', st.behind ? t('↓ {n} por receber', { n: st.behind }) : ''].filter(Boolean).join(' · ');
      box.append(el('div', { class: 'git-info' },
        el('div', null, t('Ramo '), el('code', null, st.branch), st.remote ? ' → ' : '', st.remote ? el('code', null, st.remote) : el('span', { class: 'muted' }, t(' (sem remoto)'))),
        st.last ? el('div', { class: 'muted' }, t('Última versão: {v}', { v: st.last })) : el('div', { class: 'muted' }, t('Ainda sem versões guardadas.')),
        sync ? el('div', null, sync) : null));
      if (!st.identity) {
        box.append(el('div', { class: 'git-section' },
          el('div', null, t('Nome e e-mail que ficam nas versões (só neste projeto):')),
          el('div', { class: 'row2' }, input('git-name', t('Nome')), input('git-email', t('e-mail (p. ex. o «noreply» do GitHub)'))),
          B(t('Guardar identidade'), { onclick: () => this.run('identity', { name: $('git-name').value, email: $('git-email').value }, () => t('Identidade guardada.')) })));
      }
      if (!st.remote) {
        box.append(el('div', { class: 'git-section' },
          el('label', null, t('Ligar a um repositório remoto'), input('git-url', t('https://github.com/utilizador/repo.git'))),
          B(t('Ligar'), { onclick: () => this.run('init', { url: $('git-url').value.trim() }, () => t('Remoto configurado.')) })));
      } else {
        box.append(el('div', { class: 'git-section' },
          B(t('↓ Receber alterações'), { title: t('git pull: traz as alterações feitas noutros sítios (as suas são mantidas)'),
            onclick: async () => { const r = await this.run('pull', {}, x => x.message); if (r) await this.reloadAll(); } })));
      }
      const sec = el('div', { class: 'git-section' });
      if (st.changes.length) {
        sec.append(el('div', null, t('{n} ficheiro(s) alterado(s):', { n: st.changes.length })),
          el('ul', { class: 'git-changes' }, ...st.changes.slice(0, 200).map(c => el('li', null,
            el('span', { class: 'git-state s-' + c.state }, t(c.state)), ' ',
            c.state !== 'apagado' ? el('a', { href: '#', onclick: ev => { ev.preventDefault(); $('git-dlg').close(); openFile(c.path).catch(alertErr); } }, c.path) : c.path))));
      } else sec.append(el('div', { class: 'muted' }, t('Sem alterações por guardar.')));
      const msg = el('textarea', { id: 'git-msg', rows: '2', placeholder: t('Descreva a alteração (p. ex. «Revisão do capítulo 2»)') });
      const done = r => t(r.committed ? 'Versão guardada' : 'Nada de novo para guardar') + (r.pushed ? t(' e enviada.') : '.');
      const commit = push => async () => {
        const r = await this.run('commit', { message: $('git-msg').value, push }, done);
        if (r) $('git-msg') && ($('git-msg').value = '');
      };
      sec.append(msg, el('div', { class: 'dlg-foot' },
        B(t('Guardar versão'), { title: t('git commit (só nesta máquina)'), onclick: commit(false), disabled: this.busy || !st.changes.length || null }),
        st.remote ? B(t(st.changes.length ? 'Guardar e enviar ↑' : 'Enviar ↑'), { class: 'primary', title: t('git commit + git push'), onclick: commit(true),
          disabled: this.busy || (!st.changes.length && !st.ahead && st.upstream) || null }) : null));
      box.append(sec);
    }
    if (this.msg) box.append(el('pre', { class: 'git-msg' + (this.msg.bad ? ' bad' : this.msg.ok ? ' ok' : '') }, this.msg.text));
  },
};
const Clone = {
  access: {},  // servidor -> Promise da resposta de /api/git/access
  timer: 0,
  open() {
    $('clone-err').hidden = true;
    $('clone-url').value = ''; $('clone-name').value = ''; $('clone-branch').value = '';
    delete $('clone-name').dataset.touched;
    this.access = {};
    $('clone-dlg').showModal();
    $('clone-url').focus();
    this.check();
  },
  // Endereco Git -> { scheme: 'https'|'token'|'ssh', host, user, path } (path sem .git)
  parse(u) {
    let m = u.match(/^https?:\/\/([^@\/\s]+@)?([\w.\-]+)(?::\d+)?\/(.+?)\/?$/);
    if (m) return { scheme: m[1] ? 'token' : 'https', host: m[2], user: 'git', path: m[3] };
    m = u.match(/^ssh:\/\/(?:([\w.\-]+)@)?([\w.\-]+)(?::\d+)?\/(.+)$/);
    if (m && m[3]) return { scheme: 'ssh', host: m[2], user: m[1] || 'git', path: m[3] };
    m = u.match(/^([\w.\-]+)@([\w.\-]+):(?!\/)(.+)$/);
    if (m) return { scheme: 'ssh', host: m[2], user: m[1], path: m[3] };
    return null;
  },
  repoPath: p => p.path.replace(/\/(?:-\/)?(?:tree|blob)\/.*$/, '').replace(/\.git$/, '').replace(/^\//, ''),
  sshUrl(p) { return `git@${p.host}:${this.repoPath(p)}.git`; },
  httpsUrl(p) { return `https://${p.host}/${this.repoPath(p)}.git`; },
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.check(), 350); },
  async check() {
    const url = $('clone-url').value.trim(), p = this.parse(url);
    if (url && !p) { this.render(null, null, null); return; }
    const host = p ? p.host : 'github.com', user = p ? p.user : 'git', key = user + '@' + host;
    if (!this.access[key]) {
      this.render('wait', host, p);
      this.access[key] = api('GET', `/api/git/access?host=${encodeURIComponent(host)}&user=${encodeURIComponent(user)}`)
        .catch(() => { delete this.access[key]; return null; });
    }
    const a = await this.access[key];
    if ($('clone-url').value.trim() === url) this.render(a, host, p);
  },
  // Mostra como esta maquina chega ao servidor e, se o endereco escrito nao usar esse
  // metodo, oferece a conversao (HTTPS <-> SSH) num clique.
  render(a, host, p) {
    const box = $('clone-access'), fix = $('clone-fix');
    const ex = 'utilizador/repo.git';
    box.hidden = !a; fix.hidden = true; box.className = 'clone-access';
    $('clone-url').placeholder = `https://${host || 'github.com'}/${t(ex)}`;
    if (!a) return;
    const say = (cls, html) => { if (cls) box.classList.add(cls); box.innerHTML = html; };
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const code = s => `<code>${esc(s)}</code>`;
    if (a === 'wait') { say('', esc(t('A verificar como esta máquina acede a {h}…', { h: host }))); return; }
    if (a.ssh) {
      const ssh = `git@${host}:${t(ex)}`;
      $('clone-url').placeholder = ssh;
      say('ok', '✓ ' + esc(a.sshUser ? t('Esta máquina acede a {h} por SSH (como {u}).', { h: host, u: a.sshUser })
        : t('Esta máquina acede a {h} por SSH.', { h: host })) + ' ' +
        esc(t('Use o endereço SSH, do botão «Code → SSH»:')).replace('«Code → SSH»', '<b>Code → SSH</b>') + ' ' + code(ssh));
    } else if (a.https) {
      say('ok', '✓ ' + esc(t('Esta máquina tem credenciais HTTPS para {h} ({c}). Use o endereço HTTPS:', { h: host, c: a.https })) +
        ' ' + code(`https://${host}/${t(ex)}`));
    } else {
      let msg = esc(t('Esta máquina não tem acesso configurado a {h}: só funcionam repositórios públicos (endereço HTTPS). Para um repositório privado, configure uma chave SSH nesta máquina ou ponha um token no endereço:', { h: host })) +
        ' ' + code(`https://TOKEN@${host}/${t(ex)}`);
      if (a.sshProblem === 'network')
        msg += '<br>' + esc(t('Não foi possível ligar a {h} por SSH (sem rede ou porta 22 bloqueada).', { h: host })) +
          (host === 'github.com' ? ' ' + esc(t('O GitHub também aceita SSH pela porta 443: ver «Using SSH over the HTTPS port» na documentação do GitHub.')) : '');
      if (a.sshProblem === 'hostkey')
        msg += '<br>' + esc(t('A chave SSH de {h} ainda não é conhecida: corra uma vez, num terminal, {c} e aceite-a.', { h: host, c: '§' })).replace('§', code(`ssh -T git@${host}`));
      say('warn', msg);
    }
    if (!p) return;
    let to = null, why = '';
    if (p.scheme === 'https' && a.ssh && !a.https) { to = this.sshUrl(p); why = t('Este endereço é HTTPS, mas esta máquina tem acesso por SSH.'); }
    else if (p.scheme === 'ssh' && !a.ssh && a.sshProblem === 'denied') { to = this.httpsUrl(p); why = t('O SSH não funciona nesta máquina para {h}.', { h: host }); }
    if (!to) return;
    fix.firstChild.textContent = why;
    const b = fix.querySelector('button');
    b.textContent = t('Usar {u}', { u: to });
    b.onclick = () => { $('clone-url').value = to; $('clone-url').dispatchEvent(new Event('input')); $('clone-url').focus(); };
    fix.hidden = false;
  },
  async submit(ev) {
    ev.preventDefault();
    const url = $('clone-url').value.trim(), name = $('clone-name').value.trim();
    const go = $('clone-go');
    go.disabled = true; go.textContent = t('A clonar…'); $('clone-err').hidden = true;
    try {
      await save();
      const r = await api('POST', '/api/projects', { name, git: url, branch: $('clone-branch').value.trim() });
      $('clone-dlg').close();
      await loadProjects(r.name);
    } catch (e) {
      $('clone-err').textContent = e.message; $('clone-err').hidden = false;
    } finally { go.disabled = false; go.textContent = t('Clonar'); }
  },
};

/* --------------------------------------------------------------------- PDF */
const Pdf = {
  lib: null, tried: false, doc: null, path: null, zoom: 'fit', scale: 1, gen: 0, observer: null, base: null,
  kill(doc) { try { (doc.loadingTask || doc).destroy(); } catch (e) { /* ja libertado */ } },
  async ensureLib() {
    if (this.tried) return this.lib;
    this.tried = true;
    try {
      this.lib = await import('/vendor/pdfjs/pdf.min.mjs');
      this.lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    } catch (e) { this.lib = null; }
    return this.lib;
  },
  clear() {
    this.gen++; this.path = null;
    if (this.doc) { this.kill(this.doc); this.doc = null; }
    $('pages').replaceChildren(el('p', { class: 'empty' }, t('Compile para ver o PDF.')));
    $('pages').hidden = false; $('pdf-frame').hidden = true; $('pdf-download').hidden = true;
  },
  async show(path) {
    const gen = ++this.gen;
    const url = fileUrl(path) + '&t=' + Date.now();
    this.path = path;
    const dl = $('pdf-download');
    dl.href = fileUrl(path) + '&download=1'; dl.hidden = false;
    const lib = await this.ensureLib();
    if (gen !== this.gen) return;
    if (!lib) {  // sem PDF.js: visualizador nativo do browser
      $('pages').hidden = true; $('pdf-frame').hidden = false;
      $('pdf-frame').src = url;
      return;
    }
    try {
      const doc = await lib.getDocument({ url }).promise;
      if (gen !== this.gen) { this.kill(doc); return; }
      const first = await doc.getPage(1);
      const old = this.doc;
      this.doc = doc;
      this.base = first.getViewport({ scale: 1 });
      this.layout(true);
      if (old) this.kill(old);
    } catch (e) {
      if (gen === this.gen) $('pages').replaceChildren(el('p', { class: 'empty' }, t('Não foi possível abrir o PDF: {e}', { e: e.message })));
    }
  },
  layout(keepScroll) {
    if (!this.doc) return;
    const box = $('pages');
    const top = box.scrollTop, oldScale = this.scale;
    this.scale = this.zoom === 'fit' ? Math.max(0.2, (box.clientWidth - 24) / this.base.width) : this.zoom;
    if (this.observer) this.observer.disconnect();
    const doc = this.doc, scale = this.scale;
    this.observer = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting) this.render(en.target, doc, scale);
    }, { root: box, rootMargin: '800px 0px' });
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const d = el('div', { class: 'page', 'data-n': n });
      d.style.width = Math.floor(this.base.width * scale) + 'px';
      d.style.height = Math.floor(this.base.height * scale) + 'px';
      pages.push(d);
    }
    box.replaceChildren(...pages);
    box.scrollTop = keepScroll ? top : top * (scale / (oldScale || scale));
    pages.forEach(p => this.observer.observe(p));
  },
  async render(div, doc, scale) {
    if (div.dataset.done) return;
    div.dataset.done = '1';
    try {
      const page = await doc.getPage(+div.dataset.n);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: scale * dpr });
      const canvas = el('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      canvas.style.width = Math.floor(vp.width / dpr) + 'px';
      canvas.style.height = Math.floor(vp.height / dpr) + 'px';
      div.style.width = canvas.style.width; div.style.height = canvas.style.height;
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      if (doc === this.doc) div.replaceChildren(canvas);
    } catch (e) { /* documento substituido durante o desenho */ }
  },
  setZoom(z) {
    this.zoom = z === 'fit' ? 'fit' : Math.min(5, Math.max(0.25, z));
    this.layout(false);
  },
};

/* -------------------------------------------------------------------- init */
function wire() {
  $('project').addEventListener('change', e => e.target.value && openProject(e.target.value).catch(alertErr));
  $('btn-new').onclick = async () => {
    const name = prompt(t('Nome do novo projeto:'));
    if (!name) return;
    try { await save(); const r = await api('POST', '/api/projects', { name: name.trim() }); await loadProjects(r.name); } catch (e) { alertErr(e); }
  };
  $('btn-import').onclick = () => $('file-zip').click();
  $('btn-clone').onclick = () => Clone.open();
  $('clone-form').addEventListener('submit', ev => Clone.submit(ev));
  $('clone-cancel').onclick = () => $('clone-dlg').close();
  $('clone-url').addEventListener('input', () => {
    const m = $('clone-url').value.trim().match(/([^/:]+?)(?:\.git)?\/?$/);
    if (m && !$('clone-name').dataset.touched) $('clone-name').value = m[1].replace(/[^\w .()\-]/g, ' ').trim();
    Clone.schedule();
  });
  $('clone-name').addEventListener('input', () => { $('clone-name').dataset.touched = '1'; });
  $('btn-git').onclick = () => Git.open();
  $('git-close').onclick = () => $('git-dlg').close();
  $('file-zip').onchange = async ev => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const name = prompt(t('Nome do projeto a criar a partir do .zip:'), f.name.replace(/\.zip$/i, '').replace(/[^\w .()\-]/g, ' ').trim());
    if (!name) return;
    setStatus(t('A importar…'));
    try { await save(); const r = await api('POST', '/api/projects?import=' + enc(name.trim()), f); setStatus(''); await loadProjects(r.name); }
    catch (e) { setStatus(t('Importação falhou'), 'bad'); alertErr(e); }
  };
  $('btn-export').onclick = async () => {
    if (!S.project) return;
    try { await save(); } catch (e) { return alertErr(e); }
    location.href = P() + '/zip';
  };
  $('btn-delete').onclick = async () => {
    if (!S.project) return;
    if (prompt(t('Para eliminar definitivamente o projeto, escreva o nome dele («{p}»):', { p: S.project })) !== S.project) return;
    clearTimeout(S.saveTimer); S.dirty = false;
    try { await api('DELETE', P()); store.set('localtex.project', ''); history.replaceState(null, '', '#'); await loadProjects(); } catch (e) { alertErr(e); }
  };
  $('engine').onchange = e => S.project && api('PUT', P() + '/settings', { engine: e.target.value }).catch(alertErr);
  $('auto').checked = store.get('localtex.auto') === '1';
  $('auto').onchange = e => store.set('localtex.auto', e.target.checked ? '1' : '0');
  $('btn-compile').onclick = compile;
  $('btn-newfile').onclick = () => newFile().catch(alertErr);
  $('btn-newdir').onclick = () => newDir().catch(alertErr);
  $('btn-upload').onclick = () => S.project && $('file-upload').click();
  $('file-upload').onchange = ev => { const fs = [...ev.target.files]; ev.target.value = ''; uploadFiles(fs); };
  $('btn-clean').onclick = async () => {
    if (!S.project) return;
    try { const r = await api('POST', P() + '/clean', {}); setStatus(t('{n} auxiliares removidos', { n: r.removed })); } catch (e) { alertErr(e); }
  };
  $('tab-issues').onclick = () => { $('bottom').classList.remove('closed'); selectTab('issues'); };
  $('tab-log').onclick = () => { $('bottom').classList.remove('closed'); selectTab('log'); };
  $('tab-refs').onclick = () => { $('bottom').classList.remove('closed'); selectTab('refs'); };
  $('btn-copy-issues').onclick = ev => {
    if (S.issues.length) copyWithFeedback(S.issues.map(issueText).join('\n\n'), ev.currentTarget);
  };
  $('btn-copy-log').onclick = ev => { const t = $('log').textContent; if (t) copyWithFeedback(t, ev.currentTarget); };
  $('refs-search').oninput = () => Bib.render();
  $('btn-refs-add').onclick = () => Bib.add();
  $('refs-add').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); Bib.add(); }
  });
  $('wordcount').onclick = () => WC.project();
  $('spell-lang').onchange = e => S.project && Spell.setLang(e.target.value);
  document.addEventListener('mousedown', e => { if (!$('spell-menu').hidden && !e.target.closest('#spell-menu')) $('spell-menu').hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('spell-menu').hidden = true; });
  document.addEventListener('mousedown', e => {
    if (!$('wc-pop').hidden && !e.target.closest('#wc-pop, #wordcount')) $('wc-pop').hidden = true;
  });
  $('btn-toggle-bottom').onclick = () => { $('bottom').classList.toggle('closed'); Ed.refresh(); };
  $('zoom-in').onclick = () => Pdf.setZoom(Pdf.scale * 1.2);
  $('zoom-out').onclick = () => Pdf.setZoom(Pdf.scale / 1.2);
  $('zoom-fit').onclick = () => Pdf.setZoom('fit');

  const tree = $('tree');
  tree.addEventListener('dragover', e => { e.preventDefault(); tree.classList.add('drop'); });
  tree.addEventListener('dragleave', () => tree.classList.remove('drop'));
  tree.addEventListener('drop', e => {
    e.preventDefault(); tree.classList.remove('drop');
    uploadFiles([...e.dataTransfer.files]);
  });

  // atalhos globais (fase de captura, para funcionarem dentro do editor)
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); compile(); }
    else if (e.key.toLowerCase() === 's' && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation();
      save().then(() => { if ($('auto').checked) compile(); }).catch(() => {});
    }
  }, true);

  window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // divisor editor | PDF
  const split = $('split');
  split.addEventListener('pointerdown', e => {
    e.preventDefault();
    split.setPointerCapture(e.pointerId);
    split.classList.add('drag'); document.body.classList.add('dragging');
    const move = ev => {
      const w = Math.min(window.innerWidth - 520, Math.max(220, window.innerWidth - ev.clientX));
      $('app').style.setProperty('--pdfw', w + 'px');
    };
    const up = () => {
      split.removeEventListener('pointermove', move);
      split.removeEventListener('pointerup', up);
      split.classList.remove('drag'); document.body.classList.remove('dragging');
      Ed.refresh();
      if (Pdf.zoom === 'fit') Pdf.layout(false);
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up);
  });
  let rz;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { if (Pdf.zoom === 'fit') Pdf.layout(false); }, 200);
  });
}

/* ------------------------------------------------------------------ tema */
// Claro, escuro (editor LaTeX continua claro) ou escuro com o editor tambem escuro.
// O index.html ja aplicou a escolha guardada antes de desenhar; aqui so se liga o menu.
function applyTheme(v) {
  const r = document.documentElement;
  r.dataset.theme = v === 'light' ? 'light' : 'dark';
  r.dataset.editor = v === 'dark-editor' ? 'dark' : 'light';
}
function setupTheme() {
  const sel = $('theme');
  const r = document.documentElement;
  sel.value = r.dataset.theme === 'light' ? 'light' : (r.dataset.editor === 'dark' ? 'dark-editor' : 'dark');
  sel.onchange = () => {
    applyTheme(sel.value);
    store.set('localtex.theme', sel.value);
    if (Ed.cm) Ed.cm.refresh();
  };
}

/* ------------------------------------------------------------------ idioma */
function markMissingEngines() {
  for (const o of $('engine').options) {
    if (o.value === 'auto') continue;
    o.textContent = ENGINE_NAMES[o.value] + ((S.missingEngines || []).includes(o.value) ? t(' (em falta)') : '');
  }
}
function setupLanguage() {
  if (!window.I18N) { $('lang').hidden = true; return; }
  I18N.translateDOM();
  const sel = $('lang');
  for (const [code, name] of Object.entries(I18N.LANGS)) sel.append(el('option', { value: code }, name));
  sel.value = I18N.lang;
  sel.onchange = () => I18N.set(sel.value);
  I18N.onChange(() => {
    // o HTML estatico ja foi traduzido; refaz o que e gerado pelo codigo
    renderTree(); showIssues(S.issues); WC.update(); Git.badge();
    if ($('git-dlg').open) Git.render();
    if (!$('refs').hidden) Bib.render();
    Bib.load();
    Spell.renderSelect(); Spell.schedule(0);
    markMissingEngines();
    if (!$('btn-refs-add').disabled) $('btn-refs-add').textContent = t('Adicionar');
    if (!$('clone-go').disabled) $('clone-go').textContent = t('Clonar');
    if ($('clone-dlg').open) Clone.check();
    if (!Pdf.doc && !Pdf.path) Pdf.clear();
    if (!S.project) closeProject();
    if (S.dirty) setSaveState(t('por guardar')); else setSaveState('');
    setStatus('');
    $('wc-pop').hidden = true;
  });
}

async function init() {
  setupLanguage();
  setupTheme();
  Ed.init();
  wire();
  selectTab('issues');
  try {
    await loadProjects();
    const st = await api('GET', '/api/status');
    const missing = Object.keys(st.engines).filter(e => !st.engines[e]);
    if (missing.includes('lualatex') && missing.includes('xelatex')) {
      showIssues([{ level: 'error', message: t('Não foi encontrada nenhuma distribuição TeX (lualatex/xelatex). Coloque uma instalação portátil na pasta «texlive» ao lado do server.py ou arranque com --texbin PASTA. Ver README.') }]);
    }
    S.missingEngines = missing;
    markMissingEngines();
  } catch (e) { alertErr(e); }
}

init();
})();
