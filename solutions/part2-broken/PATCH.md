# Part 2 — broken schemas

These files are the Part 1 graph plus a "day 2" update. Attendees do not copy them by hand. When the facilitator flips the APIs to v2, they fast-forward with:

```bash
node scripts/ship-v2.mjs
```

That copies `products.graphql` and `orders.graphql` onto the `products.graphql` and `orders.graphql` at the repo root, runs check + lint (both are expected to fail; the script hides Rover's findings so attendees diagnose in Studio), publishes products, then publishes orders. The orders publish does not compose: `Address` is a value type already defined `@shareable` in the published `customers` subgraph, and this orders schema defines the same fields without `@shareable`. Studio → **Launches** shows `INVALID_FIELD_SHARING`. The fix is `@shareable` on `type Address` in `orders.graphql` (and import it). `Product` is already an entity in products (`@key(fields: "id")` and a type-level `@connect` for `GET /products/{$this.id}`), in the Part 1 graph and in this schema. Attendees do not add that. The orders stub (`@key(resolvable: false)`) is already correct. The products lint failure is `in_stock` mapped straight through. Diagnose in Studio (**Launches**, **Checks → Linter**) — or `rover subgraph lint` / `GetLintResults` if GraphOS MCP is configured with the graph key — then fix composition and the lint, then runtime issues. Do not remove the entity connector.

Do not read `solutions/part2-fixed/` until a mentor says you are stuck.
