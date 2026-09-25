# Safely shipping `price` → `unitPrice`

v2 of the Products API added `unitPrice` and still returns `price`. The shipped graph already maps both and marks `price` `@deprecated`. GraphOS schema checks will flag **removing** `price` as a breaking change if any client operation selects it.

Insights → field `Product.price` → **Clients & Operations** is the evidence. After `seed-traffic.mjs`, `storefront-ios` and `storefront-android` still select `price`. `storefront-web` selects `unitPrice`.

## Already shipped — dual field

Keep `price` for those clients. Do not publish the proposal while their request count is above zero.

```graphql
type Product {
  price: Float! @deprecated(reason: "Use unitPrice. price will be removed after 2026-12-01.")
  unitPrice: Float!
}
```

Map both from the API (v2 returns both keys):

```
price
unitPrice
```

This is already in the v2 products schema. Remove `price` later, when Insights shows ios and android usage is gone.

## Option B — hard cutover

Replace `price` with `unitPrice` in one publish of the products subgraph (see [part2-proposal/products.graphql](part2-proposal/products.graphql)).

```bash
rover subgraph check "$APOLLO_GRAPH_REF" \
  --schema solutions/part2-proposal/products.graphql \
  --name products
```

Checks will report a breaking change: `Product.price` removed. Only do this if you have no production traffic on `price`, or you control every client and can ship them together.

## Mentor prompt

Which clients still select `Product.price`? What would you need to see in Insights before publishing the proposal?
