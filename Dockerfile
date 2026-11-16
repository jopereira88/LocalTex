# Modo servidor: TeX Live completo + LocalTeX.
#   docker compose up -d      (ver docker-compose.yml)
FROM texlive/texlive:latest
RUN (python3 --version && git --version) || (apt-get update \
    && apt-get install -y --no-install-recommends python3 git openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*)
WORKDIR /opt/localtex
# fontes Microsoft (Times New Roman, Arial, Comic Sans) + aliases Calibri/Helvetica/Arial Narrow
RUN (command -v cabextract && command -v fc-cache) || (apt-get update \
    && apt-get install -y --no-install-recommends cabextract fontconfig curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*)
COPY fonts.sh ./
COPY fonts ./fonts
RUN bash fonts.sh --no-sudo || true
COPY server.py ./
COPY static ./static
RUN python3 server.py --fetch-vendor || true
EXPOSE 8765
VOLUME /data
CMD ["python3", "server.py", "--host", "0.0.0.0", "--projects", "/data", "--no-browser"]
