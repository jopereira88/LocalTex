# LocalTeX

Editor e compilador LaTeX no browser, no espírito do Overleaf, mas a correr na sua
máquina ou no seu servidor. Compila com **LuaLaTeX**, **XeLaTeX** ou pdfLaTeX através do
`latexmk` (bibliografia, índices e repetições tratados automaticamente).

- Um único ficheiro Python (`server.py`), só biblioteca-padrão. Sem `pip`, sem Node, sem base de dados.
- Os projetos são pastas normais em `projects/`; pode copiá-las, pô-las em Git ou numa pen.
- Importa o `.zip` exportado pelo Overleaf e exporta de volta.
- Erros e avisos do log numa lista clicável (salta para o ficheiro e a linha).
- Cada erro tem botões **Copiar** e **Pesquisar ↗** (abre uma pesquisa na web com a mensagem
  limpa de caminhos e números de linha); «Copiar tudo» e «Copiar log» copiam a lista/log inteiros.
- **Contador de palavras** no cabeçalho do editor (ficheiro atual ou seleção, em tempo real);
  clique para contar o projeto inteiro com o `texcount` (ou uma contagem aproximada, se não existir).
- **BibTeX integrado**: autocompletar de chaves dentro de `\cite{…}`, `\citep`, `\parencite`…
  (também com Ctrl+Espaço); separador «Referências» para procurar e inserir citações, assinalar
  citações sem entrada, chaves repetidas e entradas não citadas; cole um **DOI** (ou uma entrada
  BibTeX) para a acrescentar ao `.bib` (cria `references.bib` se não houver nenhum).
- O motor é escolhido por projeto; em «Auto» respeita `% !TEX program = lualatex|xelatex` na
  primeiras linhas do ficheiro principal (por omissão, LuaLaTeX).

Atalhos: **Ctrl+Enter** compila, **Ctrl+S** guarda (também guarda sozinho 1 s depois de parar
de escrever), **Ctrl+F** procura, **Ctrl+/** comenta.

## Do que precisa

1. **Python 3.8+** (qualquer um; no Windows serve a versão «embeddable», que é só um zip).
2. **Uma distribuição TeX** com `lualatex`/`xelatex`: TeX Live, MiKTeX ou TinyTeX.

O LocalTeX não inclui o TeX; limita-se a chamá-lo. Procura-o por esta ordem:
`--texbin PASTA` → pasta `texlive/` (ou `TinyTeX/`) ao lado do `server.py` → `PATH` do sistema.

## Três formas de usar

### A. Modo servidor (recomendado para o computador do trabalho)

Corre num computador onde manda (PC de casa, mini-servidor, VPS) e acede pelo browser a partir
de qualquer outro. **No computador do trabalho não instala nada.**

Com Docker (traz o TeX Live completo, ~5 GB de imagem):

```sh
# edite a palavra-passe em docker-compose.yml
docker compose up -d
# abrir http://IP-DO-SERVIDOR:8765  (utilizador: qualquer; palavra-passe: a que definiu)
```

Sem Docker, com o TeX Live já instalado no servidor:

```sh
./start.sh --host 0.0.0.0 --password "a-sua-palavra-passe"
```

Segurança: a palavra-passe viaja em HTTP simples. Use-o dentro de uma rede em que confia ou por
VPN (Tailscale, WireGuard); se o expuser à Internet, ponha-o atrás de um proxy com HTTPS
(Caddy, nginx). Quem tiver acesso pode ler e alterar todos os projetos: é uma ferramenta
pessoal, não multi-utilizador.

### B. Portátil no Windows, sem administrador

Monte uma pasta assim (no disco ou numa pen USB):

```
LocalTeX\
  server.py  start.bat  static\
  python-portable\   <- zip «Windows embeddable package (64-bit)» de python.org, extraído
  texlive\           <- TeX Live portátil
  projects\
```

- **Python**: descarregue o *embeddable package* em python.org/downloads/windows e extraia
  para `python-portable\`. Não tem instalador.
- **TeX Live portátil**: descarregue `install-tl.zip` em tug.org/texlive, extraia e corra
  `install-tl-windows.bat -portable`, indicando como destino a pasta `LocalTeX\texlive`.
  Não pede administrador. A instalação completa ocupa vários GB e demora; pode fazê-la noutro
  computador e copiar a pasta. Alternativa mais leve: TinyTeX (extraia para `LocalTeX\TinyTeX`)
  e acrescente os pacotes de que precisa com `tlmgr install`.
- Duplo clique em `start.bat`. Abre em http://localhost:8765.

Limite a ter em conta: se a empresa bloquear a execução de programas a partir de pastas do
utilizador ou de pens (AppLocker e semelhantes), nem o Python nem o TeX arrancam. Nesse caso só
o modo servidor (A) funciona.

### C. Linux / macOS com TeX já instalado

```sh
./start.sh
```

## Opções

```
--host 127.0.0.1        endereço de escuta (0.0.0.0 = acessível na rede)
--port 8765
--projects PASTA        onde ficam os projetos (por omissão ./projects)
--texbin PASTA          pasta com os executáveis lualatex/xelatex
--password X            exige palavra-passe (ou variável LOCALTEX_PASSWORD)
--timeout 300           segundos máximos por compilação
--allow-shell-escape    permite -shell-escape (minted, etc.) nos projetos que o peçam
--no-latexmk            usa a sequência interna motor → bibtex/biber → motor
--offline               não tenta descarregar as bibliotecas do editor
--fetch-vendor          descarrega-as já para uso sem Internet e sai
```

**Shell-escape** (minted, gnuplot…): arranque com `--allow-shell-escape` e ponha
`"shellEscape": true` no ficheiro `.localtex.json` do projeto. Fica desligado por omissão
porque permite ao documento executar comandos na máquina.

**Bibliotecas do editor**: o visualizador de PDF (PDF.js) já vem incluído. O realce de sintaxe
(CodeMirror 5) é descarregado de cdn.jsdelivr.net na primeira utilização e fica guardado em
`static/vendor/`; a partir daí funciona sem Internet. Se o download não for possível, o editor
passa a uma caixa de texto simples e tudo o resto funciona. Para preparar uma pasta portátil
num computador com Internet: `python server.py --fetch-vendor`.

## Quando um projeto do Overleaf não compila

As causas habituais, por ordem de frequência:

1. **Fontes.** `\setmainfont{Nome}` só funciona se a fonte estiver instalada na máquina que
   compila. O Overleaf tem centenas; o seu servidor não. Ou instala as fontes, ou põe os
   ficheiros `.otf/.ttf` numa pasta do projeto e usa
   `\setmainfont{Ficheiro.otf}[Path=fonts/]`. A primeira compilação com LuaLaTeX numa máquina
   nova é lenta (constrói a cache de fontes).
2. **Pacotes em falta.** Acontece com TinyTeX ou esquemas reduzidos do TeX Live. O erro diz
   `File 'xxx.sty' not found`; instale com `tlmgr install xxx`.
3. **Versão do TeX Live** diferente da do Overleaf (que deixa escolher o ano). Atualize a sua.
4. **Bibliografia com biber**: tem de existir `biber` na distribuição (TeX Live completo traz).
5. **minted / shell-escape**: ver acima.

O separador «Log» mostra o log completo da última compilação.

## O que não tem (por agora)

Colaboração em tempo real, histórico de versões (use Git na pasta do projeto), SyncTeX
(clique no PDF ↔ código), verificação ortográfica e autocompletar de comandos (só as
chaves de citação são autocompletadas).

## Versões

A versão atual é a **1.1.0** (`python server.py --version`). As alterações de cada versão
estão em [CHANGELOG.md](CHANGELOG.md).

O código do LocalTeX está em Git. A pasta `projects/` fica **fora** do repositório
(ver `.gitignore`): os documentos são seus e não devem ir parar ao histórico da ferramenta.
Para versionar um documento, faça `git init` dentro da pasta desse projeto.

## Licenças de terceiros

`static/vendor/pdfjs` contém o PDF.js (Mozilla, Apache-2.0). O CodeMirror 5 (MIT) é
descarregado na primeira utilização.
