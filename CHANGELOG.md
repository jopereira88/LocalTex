# Histórico de versões

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e a numeração
segue [Versionamento Semântico](https://semver.org/lang/pt-BR/).

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
