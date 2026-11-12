/* LocalTeX — idiomas da interface.
 *
 * O texto de origem esta em portugues (no index.html e no app.js). Cada outra lingua e um
 * dicionario {texto portugues: traducao}; o que faltar aparece em portugues. Marcadores
 * {nome} sao substituidos pelos valores passados a t(). Para acrescentar uma lingua, junte
 * um dicionario a DICTS e um nome a LANGS (e, se quiser, as mensagens do servidor em
 * TRANSLATIONS no server.py).
 */
(() => {
'use strict';

const LANGS = { pt: 'Português', en: 'English' };

const EN = {
  // barra de cima
  'Projeto': 'Project',
  'Novo projeto': 'New project',
  '+ Novo': '+ New',
  'Importar projeto (.zip, p. ex. do Overleaf)': 'Import project (.zip, e.g. from Overleaf)',
  'Importar .zip': 'Import .zip',
  'Criar um projeto a partir de um repositório Git (GitHub, GitLab…)': 'Create a project from a Git repository (GitHub, GitLab…)',
  'Clonar Git': 'Clone Git',
  'Descarregar o projeto em .zip': 'Download the project as .zip',
  'Exportar .zip': 'Export .zip',
  'Versões: receber e enviar alterações para o Git': 'Versions: pull and push changes with Git',
  'Eliminar projeto': 'Delete project',
  'Eliminar': 'Delete',
  'Motor': 'Engine',
  'Compilar automaticamente após cada gravação': 'Compile automatically after every save',
  'Auto-compilar': 'Auto-compile',
  'Compilar': 'Compile',
  'Idioma da interface': 'Interface language',

  // painel lateral
  'Novo ficheiro': 'New file',
  '+ Ficheiro': '+ File',
  'Nova pasta': 'New folder',
  '+ Pasta': '+ Folder',
  'Carregar ficheiros (imagens, fontes, .bib…)': 'Upload files (images, fonts, .bib…)',
  'Carregar': 'Upload',
  'Apagar ficheiros auxiliares (.aux, .log, …)': 'Delete auxiliary files (.aux, .log, …)',
  'Limpar auxiliares': 'Clean aux files',
  'Crie ou importe um projeto.': 'Create or import a project.',
  'Projeto vazio.': 'Empty project.',
  'Definir como ficheiro principal': 'Set as main file',
  'Renomear / mover': 'Rename / move',
  'Ficheiro principal': 'Main file',
  '(sem projetos)': '(no projects)',

  // editor
  'Palavras no ficheiro (ou na seleção). Clique para contar o projeto inteiro.': 'Words in the file (or selection). Click to count the whole project.',
  '— palavras': '— words',
  '{n} palavras': '{n} words',
  '{a} de {b} palavras': '{a} of {b} words',
  'por guardar': 'unsaved',
  'a guardar…': 'saving…',
  'guardado': 'saved',
  'erro ao guardar: {e}': 'error saving: {e}',
  '{path} — {kb} kB': '{path} — {kb} kB',
  ' (não é texto UTF-8, não pode ser editado aqui)': ' (not UTF-8 text, cannot be edited here)',
  'Descarregar': 'Download',
  'Ver no painel PDF': 'Show in PDF pane',

  // diálogos simples
  'Nome do novo ficheiro (pode incluir pastas):': 'New file name (may include folders):',
  'novo.tex': 'new.tex',
  'figuras': 'figures',
  'Já existe.': 'Already exists.',
  'Nome da nova pasta:': 'New folder name:',
  'Novo nome/caminho:': 'New name/path:',
  'Eliminar «{p}»?': 'Delete «{p}»?',
  'Eliminar a pasta e todo o conteúdo de «{p}»?': 'Delete the folder and everything in «{p}»?',
  'A carregar {n} ficheiro(s)…': 'Uploading {n} file(s)…',
  '{n} ficheiro(s) carregado(s)': '{n} file(s) uploaded',
  'Falha no carregamento': 'Upload failed',
  'Nome do novo projeto:': 'New project name:',
  'Nome do projeto a criar a partir do .zip:': 'Name of the project to create from the .zip:',
  'A importar…': 'Importing…',
  'Importação falhou': 'Import failed',
  'Para eliminar definitivamente o projeto, escreva o nome dele («{p}»):': 'To permanently delete the project, type its name («{p}»):',
  '{n} auxiliares removidos': '{n} aux files removed',
  'Copie manualmente (Ctrl+C):': 'Copy manually (Ctrl+C):',

  // compilação e problemas
  'A compilar…': 'Compiling…',
  'A compilar… {s} s': 'Compiling… {s} s',
  '✗ falhou': '✗ failed',
  ' · {n} aviso(s)': ' · {n} warning(s)',
  '✗ {n} erro(s) · {eng}': '✗ {n} error(s) · {eng}',
  'Problemas': 'Problems',
  'Referências': 'References',
  'Bibliografia (.bib) do projeto': 'Project bibliography (.bib)',
  'Copiar todos os problemas para a área de transferência': 'Copy all problems to the clipboard',
  'Copiar tudo': 'Copy all',
  'Copiar o log completo': 'Copy the full log',
  'Copiar log': 'Copy log',
  'Mostrar/ocultar': 'Show/hide',
  '({e} erro(s), {n} no total)': '({e} error(s), {n} total)',
  '({n} no total)': '({n} total)',
  'Sem problemas a assinalar.': 'No problems to report.',
  'Erro': 'Error',
  'Aviso': 'Warning',
  'Caixa': 'Box',
  'linha {n}': 'line {n}',
  'Copiar esta mensagem': 'Copy this message',
  'Copiar': 'Copy',
  'Copiado ✓': 'Copied ✓',
  'Falhou': 'Failed',
  'Pesquisar na web: {q}': 'Search the web: {q}',
  'Pesquisar ↗': 'Search ↗',
  'Não foi encontrada nenhuma distribuição TeX (lualatex/xelatex). Coloque uma instalação portátil na pasta «texlive» ao lado do server.py ou arranque com --texbin PASTA. Ver README.':
    'No TeX distribution (lualatex/xelatex) was found. Put a portable installation in a «texlive» folder next to server.py or start with --texbin FOLDER. See README.',
  ' (em falta)': ' (missing)',

  // contador de palavras
  'A contar…': 'Counting…',
  'Total': 'Total',
  'Texto': 'Text',
  'Títulos': 'Headings',
  'Legendas e notas': 'Captions and notes',
  'Secções': 'Sections',
  'Figuras/tabelas': 'Figures/tables',
  'Fórmulas (em linha / destacadas)': 'Formulas (inline / displayed)',
  'Ficheiros': 'Files',
  'Projeto inteiro ({main})': 'Whole project ({main})',
  'Contagem do texcount.': 'Counted by texcount.',
  'Contagem aproximada (texcount não encontrado).': 'Approximate count (texcount not found).',
  'Falhou: {e}': 'Failed: {e}',

  // referências
  'Procurar por chave, autor, título, ano…': 'Search by key, author, title, year…',
  'DOI (10.xxxx/…) ou entrada BibTeX colada': 'DOI (10.xxxx/…) or pasted BibTeX entry',
  'Obter a referência e acrescentá-la ao .bib': 'Fetch the reference and add it to the .bib',
  'Adicionar': 'Add',
  'A obter…': 'Fetching…',
  '({n})': '({n})',
  '({n}, {bad} em falta)': '({n}, {bad} missing)',
  'Abra um ficheiro .tex para inserir a citação.': 'Open a .tex file to insert the citation.',
  'Já existia: {k}': 'Already there: {k}',
  'Acrescentado a {f}: {k}': 'Added to {f}: {k}',
  'Ficheiro .bib referido mas inexistente: ': 'Referenced .bib file does not exist: ',
  ' (em ': ' (in ',
  '{n} citação(ões) sem entrada no .bib: ': '{n} citation(s) with no .bib entry: ',
  'Chaves repetidas: ': 'Duplicate keys: ',
  'Sem entradas .bib. Cole um DOI acima para criar references.bib.': 'No .bib entries. Paste a DOI above to create references.bib.',
  'Clique para inserir \\cite{{k}} no cursor': 'Click to insert \\cite{{k}} at the cursor',
  'não citada': 'not cited',
  '(sem título)': '(untitled)',
  'Copiar a chave': 'Copy the key',
  'Chave': 'Key',
  'Abrir a entrada no {f}': 'Open the entry in {f}',
  'Nenhuma referência corresponde.': 'No matching references.',

  // PDF
  'Arrastar para redimensionar': 'Drag to resize',
  'Reduzir': 'Zoom out',
  'Ajustar à largura': 'Fit to width',
  'Largura': 'Width',
  'Ampliar': 'Zoom in',
  'Compile para ver o PDF.': 'Compile to see the PDF.',
  'Não foi possível abrir o PDF: {e}': 'Could not open the PDF: {e}',

  // Git
  'Fechar': 'Close',
  'A carregar…': 'Loading…',
  'O git não está instalado na máquina onde corre o LocalTeX.': 'git is not installed on the machine running LocalTeX.',
  'Este projeto ainda não usa Git. Ative-o para guardar versões e, se quiser, ligá-lo a um repositório (GitHub, GitLab…). Crie primeiro o repositório vazio no site.':
    "This project doesn't use Git yet. Turn it on to save versions and, if you like, connect it to a repository (GitHub, GitLab…). Create the empty repository on the website first.",
  'Endereço do repositório remoto (opcional)': 'Remote repository address (optional)',
  'Ativar Git': 'Turn on Git',
  'Git ativado.': 'Git turned on.',
  'A trabalhar…': 'Working…',
  'Feito.': 'Done.',
  '↑ {n} por enviar': '↑ {n} to push',
  '↓ {n} por receber': '↓ {n} to pull',
  'Ramo ': 'Branch ',
  ' (sem remoto)': ' (no remote)',
  'Última versão: {v}': 'Latest version: {v}',
  'Ainda sem versões guardadas.': 'No versions saved yet.',
  'Nome e e-mail que ficam nas versões (só neste projeto):': 'Name and e-mail recorded in versions (this project only):',
  'Nome': 'Name',
  'e-mail (p. ex. o «noreply» do GitHub)': 'e-mail (e.g. your GitHub «noreply» address)',
  'Guardar identidade': 'Save identity',
  'Identidade guardada.': 'Identity saved.',
  'Ligar a um repositório remoto': 'Connect to a remote repository',
  'Ligar': 'Connect',
  'Remoto configurado.': 'Remote set up.',
  '↓ Receber alterações': '↓ Pull changes',
  'git pull: traz as alterações feitas noutros sítios (as suas são mantidas)': 'git pull: brings in changes made elsewhere (yours are kept)',
  '{n} ficheiro(s) alterado(s):': '{n} changed file(s):',
  'Sem alterações por guardar.': 'No changes to save.',
  'Descreva a alteração (p. ex. «Revisão do capítulo 2»)': 'Describe the change (e.g. «Revise chapter 2»)',
  'Versão guardada': 'Version saved',
  'Nada de novo para guardar': 'Nothing new to save',
  ' e enviada.': ' and pushed.',
  'Guardar versão': 'Save version',
  'git commit (só nesta máquina)': 'git commit (this machine only)',
  'Guardar e enviar ↑': 'Save and push ↑',
  'Enviar ↑': 'Push ↑',
  'git commit + git push': 'git commit + git push',
  'alterado': 'modified',
  'novo': 'new',
  'apagado': 'deleted',
  'renomeado': 'renamed',
  'conflito': 'conflict',
  'copiado': 'copied',
  'Clonar repositório Git': 'Clone Git repository',
  'Endereço do repositório': 'Repository address',
  'https://github.com/utilizador/repo.git': 'https://github.com/user/repo.git',
  'Nome do projeto': 'Project name',
  'Ramo (opcional)': 'Branch (optional)',
  'o ramo principal do repositório': "the repository's default branch",
  'Repositórios privados usam as credenciais já configuradas na máquina onde corre o LocalTeX (chave SSH ou credential helper), ou um token no endereço: https://TOKEN@github.com/utilizador/repo.git':
    'Private repositories use the credentials already set up on the machine running LocalTeX (SSH key or credential helper), or a token in the address: https://TOKEN@github.com/user/repo.git',
  'Cancelar': 'Cancel',
  'Clonar': 'Clone',
  'A clonar…': 'Cloning…',

  // ortografia
  'Ortografia: automática ({l})': 'Spelling: automatic ({l})',
  'Ortografia: {l}': 'Spelling: {l}',
  'Ortografia: desligada': 'Spelling: off',
  'Este ficheiro usa {l} (comentário % !TeX spellcheck no início).': 'This file uses {l} (% !TeX spellcheck comment at the top).',
  'Verificação ortográfica do projeto. Num ficheiro, pode impor outra língua com «% !TeX spellcheck = en_GB» numa das primeiras linhas.':
    'Project spellcheck. A file can use another language with «% !TeX spellcheck = en_GB» in one of its first lines.',
  'A procurar sugestões…': 'Looking for suggestions…',
  'Sem sugestões': 'No suggestions',
  'Adicionar «{w}» ao dicionário do projeto': 'Add «{w}» to the project dictionary',
  'Ignorar nesta sessão': 'Ignore this session',
};

const DICTS = { en: EN };
const KEY = 'localtex.lang';
const store = {
  get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* indisponivel */ } },
};
const fromUrl = new URLSearchParams(location.search).get('lang');
const browser = (navigator.language || 'pt').slice(0, 2).toLowerCase();
let lang = [fromUrl, store.get(), browser === 'pt' ? 'pt' : 'en'].find(l => l && LANGS[l]) || 'pt';

function t(pt, vars) {
  const d = DICTS[lang];
  let s = (d && d[pt] != null) ? d[pt] : pt;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

// Traduz o HTML estatico da interface. Os nos sao recolhidos uma unica vez (antes de a
// aplicacao criar o editor e o conteudo dinamico), guardando o texto portugues original,
// para se poder mudar de lingua sem recarregar e sem tocar no texto do documento.
const ATTRS = ['title', 'placeholder', 'aria-label'];
const norm = s => s.replace(/\s+/g, ' ').trim();
let staticNodes = null;
function collect(root) {
  const texts = [], attrs = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n.nodeType === 1 && (/^(SCRIPT|STYLE|TEXTAREA|PRE|CODE)$/.test(n.tagName) || n.hasAttribute('data-no-i18n')))
        return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) { if (norm(n.nodeValue)) texts.push([n, n.nodeValue]); }
    else for (const a of ATTRS) if (n.hasAttribute(a)) attrs.push([n, a, n.getAttribute(a)]);
  }
  return { texts, attrs };
}
function translateDOM() {
  if (!staticNodes) staticNodes = collect(document.body);
  for (const [n, src] of staticNodes.texts) {
    n.nodeValue = src.match(/^\s*/)[0] + t(norm(src)) + src.match(/\s*$/)[0];
  }
  for (const [n, a, src] of staticNodes.attrs) n.setAttribute(a, t(norm(src)));
  document.documentElement.lang = lang;
}

const listeners = [];
window.I18N = {
  LANGS, t, translateDOM,
  get lang() { return lang; },
  locale() { return lang === 'pt' ? 'pt-PT' : 'en-GB'; },
  set(l) {
    if (!LANGS[l] || l === lang) return;
    lang = l;
    store.set(l);
    translateDOM();
    listeners.forEach(fn => fn(l));
  },
  onChange(fn) { listeners.push(fn); },
};
})();
