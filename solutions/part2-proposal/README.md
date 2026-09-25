# Breaking-change proposal: Product.price → Product.unitPrice

This schema is identical to the Part 2 fix except it **removes** `Product.price` and exposes `unitPrice` instead.

Run a schema check against your published graph (after Part 2 is composing again):

```bash
rover subgraph check "$APOLLO_GRAPH_REF" \
  --schema solutions/part2-proposal/products.graphql \
  --name products
```

Expected: an operation check reports a breaking change because `Product.price` is removed. Compare that to Insights → field `Product.price` → Clients & Operations.

Do not publish this during the workshop. The v2 schema already keeps `price` as `@deprecated` beside `unitPrice`. See [../part2-fixed/BREAKING-CHANGE.md](../part2-fixed/BREAKING-CHANGE.md).
