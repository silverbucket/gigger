# Gigger

Read `README.md` for the stack, commands and data model.

For any UI work, follow `DESIGN.md` (Modernist design rules). Tokens and component classes live in `web/src/styles/modernist.css`; compose screens from `web/src/components/` and keep copy short, sentence case, no exclamation marks.

Before finishing: `bun run format && bun run lint && bun run check && bun test`. UI changes should also pass `bun run test:e2e` against `make up`.
