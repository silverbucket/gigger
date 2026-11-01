FROM oven/bun:1.4.2-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
COPY schemas/package.json schemas/package.json
RUN bun install --frozen-lockfile
COPY schemas schemas
COPY web web
RUN bun run build
FROM nginx:1.27-alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
