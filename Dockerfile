# Modo servidor: TeX Live completo + LocalTeX.
#   docker compose up -d      (ver docker-compose.yml)
FROM texlive/texlive:latest
RUN python3 --version || (apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*)
WORKDIR /opt/localtex
COPY server.py ./
COPY static ./static
RUN python3 server.py --fetch-vendor || true
EXPOSE 8765
VOLUME /data
CMD ["python3", "server.py", "--host", "0.0.0.0", "--projects", "/data", "--no-browser"]
