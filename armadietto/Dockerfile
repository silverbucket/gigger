FROM remotestorage/armadietto-monolithic@sha256:8b3fc8a4ae17612c728a3a4ffabb90a1fa47fcc2ef8126031183a7280a197928
WORKDIR /opt/armadietto
COPY armadietto/start.cjs armadietto/auth.cjs ./
CMD ["node", "start.cjs"]
