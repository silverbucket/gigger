# Deploy

The production stack runs the images CI publishes to GitHub Container Registry behind Caddy with automatic HTTPS. CI tags every image with `main` plus the commit SHA on pushes to `main`, and with `pr-N` plus the commit SHA on pull requests.

## Set up the server

1. Choose a hostname and point it (an A or AAAA record) at the server.
2. Install Docker with Compose.
3. Copy `compose.prod.yml`, `Caddyfile.prod`, `armadietto/conf.json`, `scripts/deploy.sh` and `.env.example` to the server, keeping the paths.
4. Copy `.env.example` to `.env` and set `DOMAIN` to that hostname, `APP_ORIGIN` to `https://` plus the same hostname, `GHCR_TOKEN` (a GitHub token with `read:packages`), `TOKEN_KEY` and the Meta settings you use. Remove the `#` in front of each.
5. Open ports 80 and 443 in the firewall. Caddy needs both to obtain and renew certificates.

## Deploy

```sh
scripts/deploy.sh
```

The script logs into the registry, pulls the tag in `IMAGE_TAG` (default `main`), builds Sockethub and starts the stack. Run it again to update. Account data, the SQLite database and Caddy certificates live in named volumes and survive restarts and updates.

## Try a pull request

```sh
IMAGE_TAG=pr-12 scripts/deploy.sh
```

Set `IMAGE_TAG` back to `main` (or remove it) and deploy again to return.

## Change the hostname

Update `DOMAIN` and `APP_ORIGIN` in `.env`, point the new name at the server and deploy again. Caddy requests a certificate for the new name on start.
