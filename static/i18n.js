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
  'Aspeto: tema claro ou escuro (o PDF não muda)': 'Appearance: light or dark theme (the PDF is not changed)',
  'Claro': 'Light',
  'Escuro': 'Dark',
  'Escuro + editor escuro': 'Dark + dark editor',

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
  'utilizador/repo.git': 'user/repo.git',
  'A verificar como esta máquina acede a {h}…': 'Checking how this machine reaches {h}…',
  'Esta máquina acede a {h} por SSH (como {u}).': 'This machine reaches {h} over SSH (as {u}).',
  'Esta máquina acede a {h} por SSH.': 'This machine reaches {h} over SSH.',
  'Use o endereço SSH, do botão «Code → SSH»:': 'Use the SSH address, from the «Code → SSH» button:',
  'Esta máquina tem credenciais HTTPS para {h} ({c}). Use o endereço HTTPS:':
    'This machine has HTTPS credentials for {h} ({c}). Use the HTTPS address:',
  'Esta máquina não tem acesso configurado a {h}: só funcionam repositórios públicos (endereço HTTPS). Para um repositório privado, configure uma chave SSH nesta máquina ou ponha um token no endereço:':
    'This machine has no access set up for {h}: only public repositories work (HTTPS address). For a private repository, set up an SSH key on this machine or put a token in the address:',
  'A chave SSH de {h} ainda não é conhecida: corra uma vez, num terminal, {c} e aceite-a.':
    "{h}'s SSH host key is not known yet: run {c} once in a terminal and accept it.",
  'Este endereço é HTTPS, mas esta máquina tem acesso por SSH.': 'This address is HTTPS, but this machine has SSH access.',
  'O SSH não funciona nesta máquina para {h}.': "SSH doesn't work from this machine for {h}.",
  'Usar {u}': 'Use {u}',
  'Não foi possível ligar a {h} por SSH (sem rede ou porta 22 bloqueada).': 'Could not connect to {h} over SSH (no network or port 22 blocked).',
  'O GitHub também aceita SSH pela porta 443: ver «Using SSH over the HTTPS port» na documentação do GitHub.':
    'GitHub also accepts SSH on port 443: see «Using SSH over the HTTPS port» in the GitHub docs.',
  'Cancelar': 'Cancel',
  'Clonar': 'Clone',
  'Mostrar no PDF o texto da linha do cursor (Ctrl+Alt+P)': 'Show the text at the cursor line in the PDF (Ctrl+Alt+P)',
  'PDF →': 'PDF →',
  'Ir para o código do que está no topo do PDF visível (Ctrl+Alt+C). Também pode fazer duplo clique no PDF.':
    'Go to the source of what is at the top of the visible PDF (Ctrl+Alt+C). You can also double-click the PDF.',
  '← Código': '← Source',
  'Abra um ficheiro .tex para o localizar no PDF.': 'Open a .tex file to find it in the PDF.',
  'Usar uma chave SSH própria para este projeto (deploy key)': 'Use its own SSH key for this project (deploy key)',
  'Escreva primeiro o nome do projeto.': 'Enter the project name first.',
  'Gerar chave SSH': 'Generate SSH key',
  'O LocalTeX cria uma chave SSH só para «{n}», guardada nesta máquina. Depois adiciona-a ao repositório como «deploy key». No GitHub, cada deploy key só abre um repositório: é por isso que cada projeto tem a sua.':
    'LocalTeX creates an SSH key just for «{n}», stored on this machine. You then add it to the repository as a «deploy key». On GitHub each deploy key opens only one repository, which is why each project gets its own.',
  'Copiar': 'Copy',
  'Testar ligação': 'Test connection',
  'A testar…': 'Testing…',
  'A chave funciona: {h} aceita-a para {u}.': 'The key works: {h} accepts it for {u}.',
  'A chave funciona.': 'The key works.',
  '{h} ainda não aceita esta chave. Adicione-a ao repositório e teste de novo.': "{h} doesn't accept this key yet. Add it to the repository and test again.",
  'O ssh não está instalado nesta máquina.': 'ssh is not installed on this machine.',
  'Copie esta chave pública e adicione-a ao repositório: {w}. Marque «Allow write access» para poder enviar alterações.':
    'Copy this public key and add it to the repository: {w}. Tick «Allow write access» so you can push changes.',
  'definições do repositório → deploy keys': 'repository settings → deploy keys',
  'Abrir definições do repositório ↗': 'Open repository settings ↗',
  'Remover chave': 'Remove key',
  'Remover? Clique de novo': 'Remove? Click again',
  'Chave SSH do projeto': 'Project SSH key',
  '(o git deste projeto usa só esta chave)': "(this project's git uses only this key)",
  '(não tem; usa o acesso da máquina)': "(none; uses the machine's access)",
  'Usar uma chave SSH própria…': 'Use its own SSH key…',
  'O remoto usa HTTPS; a chave só funciona com o endereço SSH.': 'The remote uses HTTPS; the key only works with the SSH address.',
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
