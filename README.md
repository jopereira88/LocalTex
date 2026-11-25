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
- **Autocompletar** enquanto escreve: comandos (`\sec…` → `\section{}`, incluindo os
  definidos no projeto com `\newcommand`), ambientes (`\begin{ite…` cria o bloco
  `itemize` completo), rótulos em `\ref{…}`/`\cref{…}`, ficheiros em `\input{…}` e
  `\includegraphics{…}`, e chaves de citação. Ctrl+Espaço mostra as sugestões a pedido.
- **Git por projeto**: «Clonar Git» cria um projeto a partir de um repositório (GitHub,
  GitLab…); o botão «Git» mostra o que mudou, recebe alterações (pull) e guarda/envia
  versões (commit + push). Ver [Git](#git).
- **Verificação ortográfica** em português (Portugal), inglês britânico e inglês americano,
  enquanto escreve: palavras erradas sublinhadas, sugestões e dicionário do projeto no botão
  direito. Ver [Ortografia](#ortografia).
- **Interface em português ou inglês** (*Portuguese or English UI*): escolha no menu de idioma
  da barra de cima; muda na hora, sem recarregar. Ver [Idioma](#idioma--language).
- O motor é escolhido por projeto; em «Auto» respeita `% !TEX program = lualatex|xelatex` na
  primeiras linhas do ficheiro principal (por omissão, LuaLaTeX).

Atalhos: **Ctrl+Enter** compila, **Ctrl+S** guarda (também guarda sozinho 1 s depois de parar
de escrever), **Ctrl+F** procura, **Ctrl+/** comenta.

## Do que precisa

1. **Python 3.8+** (qualquer um; no Windows serve a versão «embeddable», que é só um zip).
2. **Uma distribuição TeX** com `lualatex`/`xelatex`: TeX Live, MiKTeX ou TinyTeX.

O LocalTeX não inclui o TeX; limita-se a chamá-lo. Procura-o por esta ordem:
`--texbin PASTA` → pasta `texlive/` (ou `TinyTeX/`) ao lado do `server.py` → `PATH` do sistema.

Não tem TeX? No Linux e no WSL, o script `install-tex.sh` instala-o por si: ver
[C. Linux / WSL](#c-linux--wsl-instalação-passo-a-passo).

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

### C. Linux / WSL: instalação passo a passo

**1. Verifique se já tem TeX.** Num terminal:

```sh
lualatex --version
```

Se mostrar uma versão, salte para o passo 4. Se disser `command not found`, siga o passo 2.

**2. Instale o TeX Live** (só uma vez). Na pasta do LocalTeX:

```sh
./install-tex.sh
```

- Instala o TeX Live oficial completo em `~/texlive`: cerca de **5 GB** e **15 a 30 minutos**,
  conforme a ligação. Não precisa de `sudo` (só o pede se faltar o `perl`, o `wget` ou o
  `fontconfig`, que o Ubuntu normalmente já traz).
- Acrescenta `~/texlive/bin/x86_64-linux` ao `PATH`, em `~/.profile` e `~/.bashrc`.
- No fim verifica as ferramentas que o LocalTeX usa (`lualatex`, `xelatex`, `pdflatex`,
  `latexmk`, `bibtex`, `biber`, `kpsewhich`, `synctex`, `texcount`) e compila um documento
  de teste. Tem de terminar com `lualatex test: OK`.

**3. Abra um terminal novo** (ou corra `source ~/.profile`), para o `PATH` novo ser lido.
Confirme com `lualatex --version`.

**4. Arranque o LocalTeX:**

```sh
./start.sh
```

Abra http://localhost:8765 no browser. No WSL, o browser do Windows também lá chega.

**Opções do `install-tex.sh`:**

| Opção | O que faz |
|---|---|
| `--scheme medium` | Instalação mais pequena (~1,5 GB) com os pacotes que o LocalTeX usa. Pacotes em falta: `tlmgr install NOME`. |
| `--apt` | Usa os pacotes do Ubuntu/Debian (pede `sudo`; versão do TeX Live mais antiga, fica em `/usr/bin`). |
| `--prefix PASTA` | Instala noutra pasta em vez de `~/texlive`. |
| `--mirror URL` | Usa um espelho CTAN à escolha, se o automático for lento. |
| `--with-docs` | Inclui a documentação dos pacotes (mais ~2 GB). |

**Atualizar:** volte a correr `./install-tex.sh`; com o TeX Live já instalado, só atualiza os
pacotes (`tlmgr update --all`).

**Desinstalar:** apague a pasta `~/texlive` (e `~/.texlive`) e o bloco entre
`# >>> LocalTeX: TeX Live >>>` e `# <<< LocalTeX: TeX Live <<<` em `~/.profile` e `~/.bashrc`.

**macOS:** o script não serve. Instale o [MacTeX](https://tug.org/mactex/) e corra `./start.sh`.

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

## Git

Cada projeto pode ser um repositório Git independente. Precisa do `git` instalado na máquina
onde corre o LocalTeX (a imagem Docker já o traz).

- **Clonar Git** (barra de cima): cola o endereço do repositório e escolhe o nome do projeto.
  O diálogo verifica como esta máquina chega ao servidor e diz que endereço usar: o **SSH**
  (`git@github.com:utilizador/repo.git`) se houver uma chave SSH aceite, ou o **HTTPS** se houver
  um *credential helper*. Se colar um endereço do tipo errado, oferece a conversão num clique.
- **Git** (barra de cima): ativa o Git num projeto existente e liga-o a um repositório remoto
  (crie-o vazio no site primeiro); mostra os ficheiros alterados; **Receber alterações**
  (`git pull --rebase`, mantendo as suas alterações por guardar); **Guardar versão**
  (`git commit`) e **Guardar e enviar** (`commit` + `push`).
- O número junto ao botão indica ficheiros por guardar (●), versões por enviar (↑) ou por
  receber (↓).
- Ficheiros auxiliares do LaTeX, o PDF do documento principal e o `.localtex.json` ficam
  fora das versões (via `.git/info/exclude`, sem alterar o `.gitignore` do repositório).
- Se ao receber houver conflitos com alterações suas na mesma linha, **nada é alterado** e o
  LocalTeX avisa; resolva com o git na linha de comandos.

**Autenticação.** O LocalTeX nunca pede palavras-passe: usa as credenciais já configuradas
na máquina onde corre (chave SSH registada no GitHub ou um *credential helper*). Em
alternativa, use um token no endereço: `https://TOKEN@github.com/utilizador/repo.git`
(fica guardado em texto simples em `.git/config` desse projeto; o LocalTeX esconde-o no
ecrã). O nome e e-mail das versões vêm da configuração do git; se faltarem, o painel pede-os.

**Chave SSH por projeto (deploy key).** Para repositórios privados sem configurar nada na
máquina: no diálogo **Clonar Git** marque «Usar uma chave SSH própria para este projeto» e
carregue em **Gerar chave SSH** (num projeto existente: painel **Git** → «Usar uma chave SSH
própria…»). Copie a chave pública e adicione-a no repositório em *Settings → Deploy keys →
Add deploy key* (marque *Allow write access* para poder enviar); **Testar ligação** confirma
que foi aceite. No GitHub cada deploy key só abre **um** repositório (e a mesma chave não
pode ser registada em dois), por isso cada projeto tem a sua.

- As chaves ficam em `projects/.keys/<projeto>` (privada, `0600`) e `.pub`; todos os comandos
  git desse projeto usam só essa chave (`ssh -i … -o IdentitiesOnly=yes`), sem agente SSH nem
  `~/.ssh/config`. Sobrevivem a reinícios e, no Docker, ficam no volume `/data`.
- A chave do servidor (p. ex. github.com) é aceite na primeira ligação e guardada em
  `projects/.keys/known_hosts`.
- As deploy keys só funcionam com o endereço SSH: o diálogo converte um endereço HTTPS, e o
  painel Git oferece mudar o remoto de um projeto existente.
- Eliminar o projeto apaga a sua chave; remova também a deploy key no site.

## Ortografia

Línguas: **português (Portugal, Acordo Ortográfico de 1990)**, **inglês britânico** e
**inglês americano**. As palavras desconhecidas ficam sublinhadas a vermelho; **clique com o
botão direito** numa delas para ver sugestões, acrescentá-la ao **dicionário do projeto** ou
ignorá-la até fechar a página.

- **Escolher a língua:** menu «Ortografia» no cabeçalho do editor (por projeto). Em
  «automática» segue o `babel`/`polyglossia` do ficheiro principal (p. ex.
  `\usepackage[british]{babel}` → inglês britânico); sem isso, usa a língua da interface.
- **Um ficheiro noutra língua** (p. ex. o resumo em português numa tese em inglês): ponha numa
  das primeiras linhas desse ficheiro `% !TeX spellcheck = pt_PT` (ou `en_GB`, `en_US`).
- **O que não é verificado:** comandos, matemática, rótulos, citações, URLs, nomes de
  ficheiros, listagens de código, siglas em maiúsculas e palavras com algarismos ou
  maiúsculas no meio (`mRNA`, `H1N1`).
- O dicionário do projeto fica em `.localtex.json` (campo `words`).
- O inglês britânico segue a grafia *-ise* (organisation); se usa a grafia de Oxford (*-ize*),
  acrescente essas palavras ao dicionário ou use o inglês americano.

Os dicionários (Hunspell: Natura para pt-PT, SCOWL para inglês) são descarregados de
cdn.jsdelivr.net na primeira utilização para a pasta `dictionaries/` (cerca de 2,5 MB); se o
sistema tiver os do Hunspell em `/usr/share/hunspell`, usa esses. Com `--fetch-vendor` ficam
todos descarregados de uma vez, para uso sem Internet. A verificação é feita pelo próprio
`server.py` (não é preciso instalar o Hunspell).

## Idioma / Language

A interface existe em **português** e **inglês**. Muda-se no menu ao lado do botão
«Compilar», a qualquer momento e sem perder trabalho; a escolha fica guardada no browser.
Na primeira visita segue a língua do browser (português se for `pt-*`, inglês nos
restantes casos). Também se pode forçar pelo endereço: `http://localhost:8765/?lang=en`.

As mensagens do servidor (erros, avisos do Git, compilação) seguem a mesma língua; as
mensagens do próprio LaTeX aparecem sempre como o LaTeX as escreve (em inglês).

*The interface is available in Portuguese and English. Switch with the language menu next to
the «Compile» button at any time; the choice is remembered in the browser. You can also open
`http://localhost:8765/?lang=en`.*

**Acrescentar uma língua:** em `static/i18n.js`, junte um dicionário
`{texto em português: tradução}` a `DICTS` e o nome a `LANGS`; para as mensagens do servidor,
um dicionário semelhante em `TRANSLATIONS` no `server.py`. O que faltar aparece em português.

## Tema escuro

No menu de aspeto (ao lado do idioma) há três opções:

- **Claro** — o aspeto habitual;
- **Escuro** — interface escura, mas o editor do LaTeX continua claro;
- **Escuro + editor escuro** — tudo escuro, incluindo o código.

O PDF nunca é alterado: aparece sempre como vai ser impresso. A escolha fica guardada no
browser; na primeira visita segue a preferência do sistema operativo.

## Fontes Microsoft

Times New Roman, Arial (normal, negrito, itálico, Arial Black e Arial Narrow), Calibri,
Helvetica e Comic Sans MS funcionam com `\setmainfont{…}` / `\newfontfamily` sem configurar
nada. O `fonts.sh` trata disso e corre sozinho: no fim do `install-tex.sh`, ao construir a
imagem Docker, e em segundo plano sempre que o `server.py` arranca (Linux/WSL). Quando já
está tudo instalado não altera nada.

| Fonte | WSL | Linux |
|---|---|---|
| Times New Roman, Arial, Arial Black, Comic Sans MS | as do Windows (`C:\Windows\Fonts`), sem copiar | descarregadas das *Core fonts for the web* da Microsoft (SHA-256 verificado), em `~/.local/share/fonts/ms-core` |
| Calibri | a do Windows | substituta: Carlito (mesmas métricas) |
| Arial Narrow | a do Windows, se o Office a instalou | substituta: TeX Gyre Heros Cn |
| Helvetica | substituta: TeX Gyre Heros (o Windows também não a tem) | substituta: TeX Gyre Heros |

As substitutas são ficheiros `<Nome>.fontspec` em `~/texmf/tex/latex/localtex-fonts/`, que o
fontspec lê ao pedir esse nome. Têm as mesmas larguras de letra, por isso a paginação não muda.
São apagadas automaticamente quando a fonte verdadeira aparece. As *Core fonts* estão sob a
[licença da Microsoft](https://corefonts.sourceforge.net/eula.htm).

```sh
./fonts.sh --check     # mostra de onde vem cada fonte
./fonts.sh             # instala o que falta (pode pedir sudo para instalar o cabextract)
```

**Fontes suas:** ponha os `.ttf`/`.otf` na pasta `fonts/` do LocalTeX (por exemplo os
ficheiros da Arial Narrow, `ARIALN*.TTF`). São registadas no arranque seguinte, ou logo com
`./fonts.sh`, e substituem a substituta correspondente. Os ficheiros não vão para o Git.

Para desligar a verificação no arranque: `./start.sh --no-font-setup`.

## Quando um projeto do Overleaf não compila

As causas habituais, por ordem de frequência:

1. **Fontes.** `\setmainfont{Nome}` só funciona se a fonte estiver instalada na máquina que
   compila. O Overleaf tem centenas; o seu servidor não. As fontes Microsoft mais pedidas são
   tratadas automaticamente (ver [Fontes Microsoft](#fontes-microsoft)). Para outras, ou
   instala as fontes, ou põe os ficheiros `.otf/.ttf` numa pasta do projeto e usa
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
(clique no PDF ↔ código), verificação gramatical e resolução de conflitos do Git dentro do
editor.

## Versões

A versão atual é a **1.3.0** (`python server.py --version`). As alterações de cada versão
estão em [CHANGELOG.md](CHANGELOG.md).

O código do LocalTeX está em Git. A pasta `projects/` fica **fora** do repositório
(ver `.gitignore`): os documentos são seus e não devem ir parar ao histórico da ferramenta.
Para versionar um documento, faça `git init` dentro da pasta desse projeto.

## Licença

O LocalTeX é distribuído com a [licença MIT](LICENSE): pode usá-lo, alterá-lo e
redistribuí-lo livremente, desde que mantenha o aviso de copyright.

### Licenças de terceiros

`static/vendor/pdfjs` contém o PDF.js (Mozilla, Apache-2.0) e `static/vendor/codemirror` o
CodeMirror 5 (MIT); ambos mantêm as licenças originais. Os dicionários ortográficos, descarregados quando são
precisos, têm licença própria: pt-PT do projeto Natura (GPL/LGPL/MPL), inglês do SCOWL
(licença MIT/BSD).
