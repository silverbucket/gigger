FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
CMD ["node", "dist/server.js"]
