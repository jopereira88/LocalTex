(() => {
'use strict';

const $ = id => document.getElementById(id);
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
  const init = { method, headers: {} };
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
    btn.textContent = ok ? 'Copiado ✓' : 'Falhou';
    setTimeout(() => { btn.textContent = old; }, 1200);
  }
  if (!ok) prompt('Copie manualmente (Ctrl+C):', text);
}
// Mensagem de erro limpa para pesquisa na web: sem caminhos, numeros de linha nem contexto.
function searchQuery(msg) {
  let q = String(msg).split('\n')[0]
    .replace(/\s*\(em [^)]*, linha \d+\)/, '')
    .replace(/(?:[A-Za-z]:)?[\w./\\-]+\.(?:tex|sty|cls|bib|bst|aux|ltx|def):\d+:?/g, '')
    .replace(/on input line \d+\.?/g, '').replace(/\bon page \d+\b/g, '')
    .replace(/`[^']{1,60}'/g, m => (/cite|ref/i.test(msg) ? '' : m))
    .replace(/\s+/g, ' ').trim();
  if (q.length > 160) q = q.slice(0, 160);
  return /latex|tex\b/i.test(q) ? q : 'LaTeX ' + q;
}
const searchUrl = msg => 'https://www.google.com/search?q=' + enc(searchQuery(msg));
const issueText = it => (it.file ? it.file + ':' + (it.line || '') + ': ' : it.line ? 'linha ' + it.line + ': ' : '')
  + ({ error: 'Erro', warning: 'Aviso', box: 'Caixa' }[it.level] || it.level) + ': ' + it.message;

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
          'Ctrl-Space': cm => { if (cm.showHint) cm.showHint({ hint: c => Bib.hint(c), completeSingle: false }); },
        },
      });
      this.cm.on('change', () => { if (!this.silent) onEdit(); });
      this.cm.on('inputRead', (cm, change) => Bib.maybeHint(cm, change));
      this.cm.on('cursorActivity', () => WC.schedule());
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
  setSaveState('por guardar');
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
  setSaveState('a guardar…');
  try {
    await api('PUT', fileUrl(path), text);
    if (!S.dirty) setSaveState('guardado');
    if (/\.(tex|bib|ltx)$/i.test(path)) Bib.load();
  } catch (e) {
    S.dirty = true;
    setSaveState('erro ao guardar: ' + e.message);
    throw e;
  }
}

/* ---------------------------------------------------------------- projects */
async function loadProjects(select) {
  const list = await api('GET', '/api/projects');
  const sel = $('project');
  sel.replaceChildren();
  if (!list.length) sel.append(el('option', { value: '' }, '(sem projetos)'));
  for (const p of list) sel.append(el('option', { value: p.name }, p.name));
  const names = list.map(p => p.name);
  const want = [select, decodeURIComponent(location.hash.slice(1)), store.get('localtex.project')]
    .find(n => n && names.includes(n)) || names[0] || null;
  if (want) { sel.value = want; await openProject(want); } else closeProject();
}

function closeProject() {
  S.project = null; S.files = []; S.path = null; S.dirty = false;
  $('tree').replaceChildren(el('p', { class: 'empty' }, 'Crie ou importe um projeto.'));
  $('filename').textContent = '—';
  Ed.set('', '');
  Pdf.clear();
  Bib.data = { entries: [], missing: [], duplicates: [], missingResources: [] };
  $('refs-count').textContent = '';
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
  Bib.load();
  const first = S.main || (S.files.find(f => !f.dir && TEXT_MODES.test(f.path)) || {}).path;
  if (first) await openFile(first); else { $('filename').textContent = '—'; Ed.set('', ''); }
  const pdf = S.main && S.main.replace(/\.[^./]+$/, '') + '.pdf';
  if (pdf && S.files.some(f => f.path === pdf)) Pdf.show(pdf);
}

async function refreshTree() {
  const t = await api('GET', P() + '/tree');
  S.files = t.files; S.settings = t.settings; S.main = t.main; S.magic = t.magic;
  $('engine').value = t.settings.engine || 'auto';
  $('engine').options[0].textContent = 'Auto → ' + ENGINE_NAMES[t.magic || 'lualatex'];
  renderTree();
}

/* -------------------------------------------------------------------- tree */
function renderTree() {
  const tree = $('tree');
  tree.replaceChildren();
  if (!S.files.length) tree.append(el('p', { class: 'empty' }, 'Projeto vazio.'));
  const hidden = p => [...S.collapsed].some(c => p.startsWith(c + '/'));
  for (const f of S.files) {
    if (hidden(f.path)) continue;
    const name = f.path.split('/').pop();
    const depth = f.path.split('/').length - 1;
    const act = el('span', { class: 'act' });
    const stop = fn => ev => { ev.stopPropagation(); fn(); };
    if (!f.dir && /\.tex$/i.test(name) && f.path !== S.main) {
      act.append(el('button', { title: 'Definir como ficheiro principal', onclick: stop(() => setMain(f.path)) }, '☆'));
    }
    act.append(
      el('button', { title: 'Renomear / mover', onclick: stop(() => renameItem(f.path)) }, '✎'),
      el('button', { title: 'Eliminar', onclick: stop(() => deleteItem(f)) }, '✕'));
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
    f.path === S.main ? el('span', { class: 'main-mark', title: 'Ficheiro principal' }, '★') : null,
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
}

function showBinary(path, size) {
  const box = $('binary');
  box.replaceChildren();
  if (/\.(png|jpe?g|gif|bmp|ico)$/i.test(path)) box.append(el('img', { src: fileUrl(path), alt: path }));
  box.append(el('p', null, path + ' — ' + (size / 1024).toFixed(1) + ' kB'
    + (BINARY.test(path) ? '' : ' (não é texto UTF-8, não pode ser editado aqui)')));
  box.append(el('a', { class: 'btn', href: fileUrl(path) + '&download=1' }, 'Descarregar'));
  if (/\.pdf$/i.test(path)) {
    box.append(' ', el('button', { onclick: () => Pdf.show(path) }, 'Ver no painel PDF'));
  }
}

const alertErr = e => alert(e.message || e);

async function setMain(path) {
  await api('PUT', P() + '/settings', { main: path });
  await refreshTree();
}

async function newFile() {
  if (!S.project) return;
  const name = prompt('Nome do novo ficheiro (pode incluir pastas):', (S.dir ? S.dir + '/' : '') + 'novo.tex');
  if (!name) return;
  if (S.files.some(f => f.path === name)) return alert('Já existe.');
  await api('PUT', fileUrl(name), '');
  await refreshTree();
  await openFile(name);
}

async function newDir() {
  if (!S.project) return;
  const name = prompt('Nome da nova pasta:', (S.dir ? S.dir + '/' : '') + 'figuras');
  if (!name) return;
  await api('POST', P() + '/mkdir', { path: name });
  S.dir = name.replace(/\/+$/, '');
  await refreshTree();
}

async function renameItem(path) {
  const to = prompt('Novo nome/caminho:', path);
  if (!to || to === path) return;
  if (S.path && (S.path === path || S.path.startsWith(path + '/'))) await save();
  await api('POST', P() + '/rename', { from: path, to });
  if (S.path === path) S.path = to;
  else if (S.path && S.path.startsWith(path + '/')) S.path = to + S.path.slice(path.length);
  $('filename').textContent = S.path || '—';
  await refreshTree();
}

async function deleteItem(f) {
  if (!confirm('Eliminar ' + (f.dir ? 'a pasta e todo o conteúdo de ' : '') + '«' + f.path + '»?')) return;
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
  setStatus('A carregar ' + files.length + ' ficheiro(s)…');
  try {
    for (const f of files) await api('PUT', fileUrl((dir ? dir + '/' : '') + f.name), f);
    setStatus(files.length + ' ficheiro(s) carregado(s)', 'ok');
  } catch (e) { setStatus('Falha no carregamento', 'bad'); alertErr(e); }
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
  setStatus('A compilar…');
  const t0 = Date.now();
  const tick = setInterval(() => setStatus('A compilar… ' + Math.round((Date.now() - t0) / 1000) + ' s'), 1000);
  try {
    await save();
    showResult(await api('POST', P() + '/compile', {}));
  } catch (e) {
    setStatus('✗ falhou', 'bad');
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
  if (res.ok) setStatus('✓ ' + eng + ' · ' + res.duration + ' s' + (warns ? ' · ' + warns + ' aviso(s)' : ''), 'ok');
  else setStatus('✗ ' + (errs || 1) + ' erro(s) · ' + eng, 'bad');
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
  $('issue-count').textContent = issues.length ? '(' + (errs ? errs + ' erro(s), ' : '') + issues.length + ' no total)' : '';
  if (!issues.length) { box.append(el('p', { class: 'empty' }, 'Sem problemas a assinalar.')); return; }
  const texFiles = S.files.filter(f => !f.dir && /\.tex$/i.test(f.path));
  const labels = { error: 'Erro', warning: 'Aviso', box: 'Caixa' };
  for (const it of issues) {
    const file = it.file || (it.line && texFiles.length === 1 ? texFiles[0].path : null);
    const where = (it.file || '') + (it.line ? (it.file ? ':' : 'linha ') + it.line : '');
    const stop = ev => ev.stopPropagation();
    const copyBtn = el('button', {
      title: 'Copiar esta mensagem', onclick: ev => { stop(ev); copyWithFeedback(issueText(it), ev.currentTarget); },
    }, 'Copiar');
    box.append(el('div', {
      class: 'issue ' + it.level + (file ? ' link' : ''),
      // so salta para a linha se o utilizador nao estiver a selecionar texto
      onclick: file ? () => { if (!String(getSelection())) openFile(file, it.line).catch(alertErr); } : null,
    },
    el('span', { class: 'lvl' }, labels[it.level] || it.level),
    el('span', null, where ? el('div', { class: 'where' }, where) : null, el('div', { class: 'msg' }, it.message)),
    el('span', { class: 'issue-act' }, copyBtn,
      el('a', { class: 'btn', href: searchUrl(it.message), target: '_blank', rel: 'noopener noreferrer',
        title: 'Pesquisar na web: ' + searchQuery(it.message), onclick: stop }, 'Pesquisar ↗'))));
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
const fmtN = n => n.toLocaleString('pt-PT');
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
    b.textContent = sel ? fmtN(countWords(sel)) + ' de ' + fmtN(countWords(text)) + ' palavras'
      : fmtN(countWords(text)) + ' palavras';
  },
  async project() {
    const pop = $('wc-pop');
    if (!pop.hidden) { pop.hidden = true; return; }
    if (!S.project) return;
    pop.hidden = false;
    pop.replaceChildren(el('p', { class: 'muted' }, 'A contar…'));
    try {
      await save();
      const r = await api('GET', P() + '/wordcount');
      const rows = [['Total', r.total]];
      if (r.tool === 'texcount') {
        rows.push(['Texto', r.text], ['Títulos', r.headers], ['Legendas e notas', r.captions],
          ['Secções', r.nheaders], ['Figuras/tabelas', r.floats],
          ['Fórmulas (em linha / destacadas)', r.mathInline + ' / ' + r.mathDisplay]);
      }
      rows.push(['Ficheiros', r.files]);
      pop.replaceChildren(
        el('div', { class: 'pop-title' }, 'Projeto inteiro (' + (S.main || '') + ')'),
        el('table', null, ...rows.map(([k, v]) => el('tr', null, el('td', null, k),
          el('td', null, typeof v === 'number' ? fmtN(v) : v)))),
        el('div', { class: 'muted small' }, r.tool === 'texcount' ? 'Contagem do texcount.'
          : 'Contagem aproximada (texcount não encontrado).'),
        el('button', { onclick: ev => copyWithFeedback(rows.map(([k, v]) => k + ': ' + v).join('\n'), ev.currentTarget) }, 'Copiar'));
    } catch (e) { pop.replaceChildren(el('p', null, 'Falhou: ' + e.message)); }
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
    $('refs-count').textContent = n || bad ? '(' + n + (bad ? ', ' + bad + ' em falta' : '') + ')' : '';
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
  maybeHint(cm, change) {
    if (!window.CodeMirror || !CodeMirror.showHint || cm.state.completionActive) return;
    if (!/[{,\w]/.test((change.text || []).join(''))) return;
    if (!this.data.entries.length) return;
    const cur = cm.getCursor();
    if (CITE_CTX.test(cm.getLine(cur.line).slice(0, cur.ch))) {
      cm.showHint({ hint: c => Bib.hint(c), completeSingle: false, closeCharacters: /[\s}]/ });
    }
  },
  insert(key) {
    if (S.binary || !S.path) return alert('Abra um ficheiro .tex para inserir a citação.');
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
    btn.disabled = true; btn.textContent = 'A obter…';
    try {
      await save();
      const r = await api('POST', P() + '/bib/add', v.startsWith('@') ? { bibtex: v } : { doi: v });
      box.value = '';
      setStatus(r.existed ? 'Já existia: ' + r.key : 'Acrescentado a ' + r.file + ': ' + r.key, 'ok');
      if (r.created) await refreshTree();
      if (S.path === r.file) { const p = S.path; S.path = null; await openFile(p); }
      await this.load();
      $('refs-search').value = r.key;
      this.render();
      await copyText(r.key);
    } catch (e) { alertErr(e); } finally { btn.disabled = false; btn.textContent = 'Adicionar'; }
  },
  render() {
    const d = this.data, alerts = $('refs-alerts'), listBox = $('refs-list');
    alerts.replaceChildren();
    const link = (f, line, text) => el('a', { href: '#', onclick: ev => { ev.preventDefault(); openFile(f, line).catch(alertErr); } }, text);
    if (d.missingResources.length) {
      alerts.append(el('div', { class: 'ref-alert' }, 'Ficheiro .bib referido mas inexistente: ',
        ...d.missingResources.map(r => el('code', null, r.resource + ' ')), ' (em ', link(d.missingResources[0].file, null, d.missingResources[0].file), ')'));
    }
    if (d.missing.length) {
      const div = el('div', { class: 'ref-alert' }, d.missing.length + ' citação(ões) sem entrada no .bib: ');
      d.missing.forEach((m, i) => div.append(i ? ', ' : '', el('code', null, m.key), ' (', link(m.file, m.line, m.file + ':' + m.line), ')'));
      alerts.append(div);
    }
    if (d.duplicates.length) {
      const div = el('div', { class: 'ref-alert warn' }, 'Chaves repetidas: ');
      d.duplicates.forEach((m, i) => div.append(i ? ', ' : '', link(m.file, m.line, m.key)));
      alerts.append(div);
    }
    listBox.replaceChildren();
    if (!d.entries.length) {
      listBox.append(el('p', { class: 'empty' }, 'Sem entradas .bib. Cole um DOI acima para criar references.bib.'));
      return;
    }
    const list = this.search($('refs-search').value);
    for (const e of list.slice(0, 500)) {
      const venue = e.journal || e.journaltitle || e.booktitle || e.publisher || '';
      const stop = ev => ev.stopPropagation();
      listBox.append(el('div', { class: 'ref', title: 'Clique para inserir \\cite{' + e.key + '} no cursor', onclick: () => this.insert(e.key) },
        el('div', { class: 'ref-main' },
          el('span', { class: 'ref-key' }, e.key),
          el('span', { class: 'ref-who' }, ' ' + this.short(e)),
          e.cited ? null : el('span', { class: 'badge' }, 'não citada'),
          el('div', { class: 'ref-title' }, (e.title || '(sem título)') + (venue ? ' — ' + venue : ''))),
        el('span', { class: 'issue-act' },
          el('button', { title: 'Copiar a chave', onclick: ev => { stop(ev); copyWithFeedback(e.key, ev.currentTarget); } }, 'Chave'),
          el('button', { title: 'Abrir a entrada no ' + e.file, onclick: ev => { stop(ev); openFile(e.file, e.line).catch(alertErr); } }, '.bib'),
          e.doi ? el('a', { class: 'btn', href: 'https://doi.org/' + e.doi, target: '_blank', rel: 'noopener noreferrer', onclick: stop }, 'DOI ↗') : null)));
    }
    if (!list.length) listBox.append(el('p', { class: 'empty' }, 'Nenhuma referência corresponde.'));
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
    $('pages').replaceChildren(el('p', { class: 'empty' }, 'Compile para ver o PDF.'));
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
      if (gen === this.gen) $('pages').replaceChildren(el('p', { class: 'empty' }, 'Não foi possível abrir o PDF: ' + e.message));
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
    const name = prompt('Nome do novo projeto:');
    if (!name) return;
    try { await save(); const r = await api('POST', '/api/projects', { name: name.trim() }); await loadProjects(r.name); } catch (e) { alertErr(e); }
  };
  $('btn-import').onclick = () => $('file-zip').click();
  $('file-zip').onchange = async ev => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    const name = prompt('Nome do projeto a criar a partir do .zip:', f.name.replace(/\.zip$/i, '').replace(/[^\w .()\-]/g, ' ').trim());
    if (!name) return;
    setStatus('A importar…');
    try { await save(); const r = await api('POST', '/api/projects?import=' + enc(name.trim()), f); setStatus(''); await loadProjects(r.name); }
    catch (e) { setStatus('Importação falhou', 'bad'); alertErr(e); }
  };
  $('btn-export').onclick = async () => {
    if (!S.project) return;
    try { await save(); } catch (e) { return alertErr(e); }
    location.href = P() + '/zip';
  };
  $('btn-delete').onclick = async () => {
    if (!S.project) return;
    if (prompt('Para eliminar definitivamente o projeto, escreva o nome dele («' + S.project + '»):') !== S.project) return;
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
    try { const r = await api('POST', P() + '/clean', {}); setStatus(r.removed + ' auxiliares removidos'); } catch (e) { alertErr(e); }
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

async function init() {
  Ed.init();
  wire();
  selectTab('issues');
  try {
    await loadProjects();
    const st = await api('GET', '/api/status');
    const missing = Object.keys(st.engines).filter(e => !st.engines[e]);
    if (missing.includes('lualatex') && missing.includes('xelatex')) {
      showIssues([{ level: 'error', message: 'Não foi encontrada nenhuma distribuição TeX (lualatex/xelatex). '
        + 'Coloque uma instalação portátil na pasta «texlive» ao lado do server.py ou arranque com --texbin PASTA. Ver README.' }]);
    }
    for (const e of missing) {
      const o = [...$('engine').options].find(x => x.value === e);
      if (o) o.textContent += ' (em falta)';
    }
  } catch (e) { alertErr(e); }
}

init();
})();
