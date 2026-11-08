.PHONY: dev up up-test down seed
# Everything without Docker: Vite with hot reload, the API under bun --watch,
# in-memory storage saved to .dev/. See README.
dev:
	bun run dev

up:
	docker compose up -d --build --wait

# The stack plus a Mailpit sink, for the integration tests.
up-test:
	./scripts/mail-certs.sh
	docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build --wait

down:
	docker compose -f docker-compose.yml -f docker-compose.test.yml down

seed:
	docker compose exec -T api bun src/seed.ts
