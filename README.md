# StoreFront Graph Workshop

A products subgraph is already in Studio. Add the Orders REST API with a Connectors subgraph, then diagnose a broken "day 2" launch with GraphOS.

Solution schemas live under [`solutions/`](solutions/) — skip those until a mentor says to look.

## Before you start

Installs and the GraphOS account are in the pre-workshop email. Do that before the session.

1. Accept the org invite and open the graph on your seat card.
2. In Studio, open **Settings → API Keys → Create New Key**. Name it `workshop`. If Studio asks for a role, choose **Graph Admin**. Copy the key (it starts with `service:`). Studio will not show it again.
3. Copy [`.env.example`](.env.example) to `.env`. Set `APOLLO_KEY` to the key you just created, and `APOLLO_GRAPH_REF` to the graph ref on your seat card (for example `summit26-storefront-042@current`).
4. Confirm the StoreFront API is reachable:

```bash
curl https://summit26-products-api.up.railway.app/health
```

5. Pick an attendee id (the seat number on your card, for example `seat-042`). You will send it as `X-Attendee-Id` on every Orders request.

## Part 1 — Add the Orders API

Your graph in Studio already has a `products` subgraph and a `customers` subgraph. You add the Orders REST API as another Connectors subgraph.

`products.graphql` and `customers.graphql` match what was published. Edit `orders.graphql` (the `orders` subgraph). It already has the `orders` `@source`, including `X-Attendee-Id`. Prompt Apollo Skills (or write the connector yourself) to add `Query.order`. Leave `OrderItem.productId` as a scalar.

Run a local router from this repo:

```bash
APOLLO_KEY=... APOLLO_GRAPH_REF=... rover dev --supergraph-config supergraph.yaml --router-config router.yaml
```

[`router.yaml`](router.yaml) turns on subgraph metrics. With your graph key set, fetches show up in Studio → **Insights** → **Subgraphs**.

Open http://localhost:4000 and run [queries/health.graphql](queries/health.graphql) and the product queries in [queries/part1.graphql](queries/part1.graphql) to confirm products. After your connectors exist, run `GetOrder` and `GetCustomer`. For `order`, add header `X-Attendee-Id: seat-042` in Sandbox.

Publish the orders subgraph when a test query returns real data:

```bash
rover subgraph publish "$APOLLO_GRAPH_REF" \
  --schema orders.graphql \
  --name orders \
  --routing-url http://localhost \
  --allow-invalid-routing-url
```

### Stretch: connector tests

```bash
rover connector test
```

[`tests/part1-orders.connector.yml`](tests/part1-orders.connector.yml) targets `solutions/part1/orders.graphql`. Point `config.schema` at `orders.graphql` to test *your* connector — the coordinate must match (`Query.order`). [`tests/part1-customers.connector.yml`](tests/part1-customers.connector.yml) covers the published customers subgraph.

## Part 2 — Find, fix, ship

When the facilitator says the APIs are on v2, fast-forward to the schema another team already shipped (`.env` must have the graph API key you created and the `APOLLO_GRAPH_REF` from your seat card):

```bash
node scripts/ship-v2.mjs
```

`Product` is already an entity in the products subgraph. Do not add or remove that. The orders publish does not compose, and products lint fails. The script does not print the error details — diagnose in Studio → **Launches** and **Checks → Linter**. After composition succeeds, seed traffic and investigate in Studio → **Insights** (Last hour):

```bash
ROUTER_URL=http://localhost:4000 ATTENDEE_ID=seat-042 node scripts/seed-traffic.mjs
```

Three questions: which operation is slow, which field is erroring, and which clients still select deprecated `Product.price`. Confirm the slow operation in the Connectors Debugger with [queries/part2.graphql](queries/part2.graphql). Then review the proposal that removes `price`:

```bash
rover subgraph check "$APOLLO_GRAPH_REF" \
  --schema solutions/part2-proposal/products.graphql \
  --name products
```

Do not publish the proposal unless you have chosen a hard cutover. See [solutions/part2-fixed/BREAKING-CHANGE.md](solutions/part2-fixed/BREAKING-CHANGE.md).
