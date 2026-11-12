# Histórico de versões

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e a numeração
segue [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.2.0] - 2026-11-12

### Adicionado
- Git por projeto: «Clonar Git» cria um projeto a partir de um repositório; o painel «Git»
  ativa o Git e liga a um remoto, lista os ficheiros alterados, recebe alterações
  (`pull --rebase --autostash`, abortado em segurança se houver conflitos) e guarda/envia
  versões (`commit` + `push`). Indicador de estado no botão. Os auxiliares e o PDF principal
  ficam excluídos via `.git/info/exclude`. Rotas `GET/POST /api/projects/<p>/git[/init|identity|pull|commit]`.
- Autocompletar de comandos LaTeX (lista integrada + `\newcommand` do projeto), ambientes
  (`\begin{…}` insere o bloco completo), rótulos em `\ref`/`\cref`, e ficheiros em
  `\input`/`\include`/`\includegraphics`/`\bibliography`. Rota `GET /api/projects/<p>/symbols`.
- `git` e `openssh-client` na imagem Docker.
- Interface em inglês, além do português. Menu de idioma na barra de cima: muda na hora, sem
  recarregar, e fica guardado no browser; na primeira visita segue a língua do browser;
  `?lang=en` no endereço força uma língua. Traduções em `static/i18n.js`.
- As mensagens do servidor (erros, Git, compilação, BibTeX) são traduzidas conforme o
  cabeçalho `X-LocalTeX-Lang` enviado pelo browser (`TRANSLATIONS` no `server.py`).
- Verificação ortográfica enquanto se escreve, em português (Portugal), inglês britânico e
  inglês americano: sublinhado das palavras desconhecidas, sugestões, «Adicionar ao dicionário
  do projeto» e «Ignorar» no botão direito.
- Língua por projeto (menu «Ortografia»; «automática» segue o `babel`/`polyglossia`) e por
  ficheiro (`% !TeX spellcheck = pt_PT` nas primeiras linhas).
- Verificador compatível com dicionários Hunspell escrito em Python (sem dependências);
  dicionários descarregados na primeira utilização para `dictionaries/` ou lidos de
  `/usr/share/hunspell`. `--fetch-vendor` também os descarrega.
- Rotas `GET /api/spell`, `POST /api/spell` e `POST /api/spell/suggest`.

### Corrigido
- Quando uma compilação anterior tinha falhado, o `latexmk` respondia «Nothing to do … gave an
  error in previous invocation» e a lista de problemas só mostrava esse resumo inútil. Agora
  o LocalTeX repete a compilação com `latexmk -g` para os erros reais voltarem a aparecer.
- Os erros e avisos do BibTeX/biber (ficheiro `.blg`), como «Repeated entry» ou erros de
  sintaxe no `.bib`, passam a aparecer na lista de problemas e levam à linha do `.bib`.

## [1.1.0] - 2026-11-12

### Adicionado
- Erros e avisos: botões **Copiar** e **Pesquisar ↗** em cada mensagem (pesquisa na web com
  a mensagem limpa de caminhos e números de linha), «Copiar tudo» e «Copiar log». A cópia
  funciona também em modo servidor por HTTP simples.
- Contador de palavras em tempo real (ficheiro atual ou seleção); contagem do projeto inteiro
  com o `texcount`, ou aproximada se não estiver instalado. Rota `GET /api/projects/<p>/wordcount`.
- Integração BibTeX:
  - autocompletar de chaves em `\cite`, `\citep`, `\parencite`, `\textcite`… (e Ctrl+Espaço);
  - separador «Referências»: procurar, inserir citação, abrir a entrada no `.bib`, seguir o DOI;
  - aviso de citações sem entrada, chaves repetidas, entradas não citadas e ficheiros `.bib`
    referidos mas inexistentes;
  - acrescentar referências por DOI (via doi.org) ou colando BibTeX, com chave `ApelidoAno`
    e deteção de DOI repetido.
  - Rotas `GET /api/projects/<p>/bib` e `POST /api/projects/<p>/bib/add`.
- Opção `--version`.
- Biblioteca `show-hint` do CodeMirror em `static/vendor/`.

## [1.0.0]

- Versão inicial: editor no browser, compilação com LuaLaTeX/XeLaTeX/pdfLaTeX via `latexmk`,
  lista clicável de erros, visualizador PDF.js, importação/exportação `.zip` (Overleaf).
