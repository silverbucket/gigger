# Gigger

A local monorepo for a static web app, a Node/TypeScript API, Armadietto remoteStorage, and Sockethub with Redis.

## Run locally

Install Docker with Compose and start the Docker daemon, then run (the first build downloads Sockethub source and can take several minutes):

```sh
cp .env.example .env
make up
make seed
```

Open [http://localhost:8080](http://localhost:8080). Change `PORT` in `.env` if 8080 is occupied. `make seed` adds one example item to the API database and is safe to repeat. Create a remoteStorage account at `/storage/`; its address is `username@localhost:8080` (use your configured port). Root WebFinger discovery points clients to Armadietto's `/storage/storage/<username>` endpoint and `/storage/oauth/<username>` authorization page. Sockethub's Socket.IO path is `/sockethub`; the API is at `/api`.

`make down` stops the stack without deleting data. Armadietto and the API persist data in named Docker volumes. To delete all local data, run `docker compose down -v` explicitly. Only Caddy publishes a port, bound to localhost. This HTTP setup and open signup are for local development; use HTTPS and appropriate access controls for deployment. Some remoteStorage clients require HTTPS even for localhost. The Armadietto image currently provides Linux amd64 only; other architectures need Docker emulation.

Run API tests with `npm ci --prefix api && npm test --prefix api`. The CI workflow also starts the complete Compose stack and exercises the proxy routes and seed operation.
