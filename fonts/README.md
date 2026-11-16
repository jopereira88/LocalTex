# Fontes adicionadas à mão

Ponha aqui ficheiros `.ttf`, `.otf` ou `.ttc` (por exemplo `ARIALN.TTF`, `ARIALNB.TTF`,
`ARIALNI.TTF`, `ARIALNBI.TTF` para a Arial Narrow). Ficam disponíveis para
`\setmainfont{…}` / `\newfontfamily` em LuaLaTeX e XeLaTeX, em todos os projetos.

- São registadas pelo `fonts.sh`, que corre sozinho ao arrancar o LocalTeX
  (`./start.sh`). Para usar logo, sem reiniciar: `./fonts.sh`.
- Uma fonte posta aqui substitui o alias do LocalTeX (por exemplo Arial Narrow →
  TeX Gyre Heros Cn); o alias é apagado automaticamente.
- Os ficheiros de fontes não vão para o Git (`.gitignore`): a maioria tem licença que não
  permite redistribuí-los. Só este README é versionado.
