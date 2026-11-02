FROM oven/bun:1.4.4-alpine
WORKDIR /app
COPY package.json bun.lock ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
COPY schemas/package.json schemas/package.json
RUN bun install --frozen-lockfile --production
COPY api/src api/src
COPY schemas/src schemas/src
WORKDIR /app/api
CMD ["bun", "src/server.ts"]
