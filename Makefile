.PHONY: up down seed
up:
	docker compose up -d --build --wait

down:
	docker compose down

seed:
	docker compose exec -T api bun src/seed.ts
