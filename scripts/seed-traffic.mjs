#!/usr/bin/env node
/**
 * Send named-client traffic at a local rover dev router so Studio Insights
 * can answer three questions:
 *
 *   - Which operation is slow? ProductsWithRatingsAndReviews (N+1 reviews).
 *   - What is erroring? GetProducts selects rating. Some products omit it.
 *   - Who still uses deprecated Product.price? storefront-ios and
 *     storefront-android. storefront-web has moved to unitPrice.
 *
 * Start this once composition succeeds, then open Studio → Insights
 * (last hour). Metrics land within a few minutes. Restart rover dev after
 * editing router.yaml so extended error metrics are on.
 *
 * Reads ATTENDEE_ID from the environment, or from .env in this repo if unset.
 *
 *   node scripts/seed-traffic.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(join(root, ".env"));

const routerUrl = (process.env.ROUTER_URL ?? "http://localhost:4000").replace(
  /\/$/,
  "",
);
const attendeeId = process.env.ATTENDEE_ID?.trim() || "seat-001";
const durationMs = Number(process.env.DURATION_MS ?? 120_000);
const minDelayMs = Number(process.env.MIN_DELAY_MS ?? 1_500);
const maxDelayMs = Number(process.env.MAX_DELAY_MS ?? 4_000);

const queriesDir = join(root, "queries");

function loadDotEnv(path) {
  if (!existsSync(path)) {
    return;
  }
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim().replace(/\r$/, "");
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// The v2 products schema exposes stock as in_stock. The attendee query files
// keep inStock on purpose (that is the lint exercise). Rewrite only the
// documents this script sends so they validate. Order.createdAt stays camelCase.
function forBrokenSchema(document) {
  return document.replaceAll("inStock", "in_stock");
}

const healthDocument = readFileSync(join(queriesDir, "health.graphql"), "utf8");
const part1Document = forBrokenSchema(
  readFileSync(join(queriesDir, "part1.graphql"), "utf8"),
);
const part2Document = forBrokenSchema(
  readFileSync(join(queriesDir, "part2.graphql"), "utf8"),
);

const productIds = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const orderIds = ["1001", "1002", "1003", "1004", "1005", "1006"];
const customerIds = ["1", "2", "3", "4"];

const legacyClients = [
  { name: "storefront-ios", version: "3.2.0", weight: 3 },
  { name: "storefront-android", version: "3.1.1", weight: 2 },
];
const migratedClients = [{ name: "storefront-web", version: "2.0.0", weight: 6 }];

const legacyProducts = `
query GetProducts {
  products {
    id
    title
    price
    rating
    inStock
    brand
    category
  }
}
`;

const migratedProducts = `
query GetProducts {
  products {
    id
    title
    unitPrice
    rating
    in_stock
    brand
    category
  }
}
`;

const productReviews = `
query ProductReviews($id: ID!) {
  product(id: $id) {
    id
    title
    reviews {
      id
      rating
      comment
      reviewerName
    }
  }
}
`;

const orderReceipt = `
query OrderReceipt($id: ID!) {
  order(id: $id) {
    id
    status
    customerId
    createdAt
    total
    shippingAddress {
      line1
      city
      postalCode
      country
    }
    items {
      productId
      quantity
      price
      product {
        id
        title
        description
        thumbnail
      }
    }
  }
}
`;

const sharedOperations = [
  { document: healthDocument, operationName: "GetHealth", weight: 1 },
  { document: part1Document, operationName: "GetCategories", weight: 2 },
  {
    document: part1Document,
    operationName: "GetOrder",
    weight: 2,
    variables: () => ({ id: pick(orderIds) }),
  },
  {
    document: part1Document,
    operationName: "GetCustomer",
    weight: 1,
    variables: () => ({ id: pick(customerIds) }),
  },
  {
    document: part2Document,
    operationName: "ProductsWithRatingsAndReviews",
    weight: 2,
  },
  { document: part2Document, operationName: "GetCart", weight: 2 },
  {
    document: part2Document,
    operationName: "AddToCart",
    weight: 2,
    variables: () => ({ productId: pick(productIds), quantity: 1 }),
  },
  {
    document: part2Document,
    operationName: "RemoveFromCart",
    weight: 1,
    variables: () => ({ productId: pick(productIds) }),
  },
  {
    document: part2Document,
    operationName: "Checkout",
    weight: 1,
    variables: () => ({ customerId: pick(customerIds) }),
  },
  {
    document: productReviews,
    operationName: "ProductReviews",
    weight: 1,
    variables: () => ({ id: pick(productIds) }),
  },
  {
    document: orderReceipt,
    operationName: "OrderReceipt",
    weight: 2,
    variables: () => ({ id: pick(orderIds) }),
  },
];

const legacyProduct = `
query GetProduct($id: ID!) {
  product(id: $id) {
    id
    title
    price
    rating
    in_stock
  }
}
`;

const migratedProduct = `
query GetProduct($id: ID!) {
  product(id: $id) {
    id
    title
    unitPrice
    rating
    inStock
  }
}
`;

const legacyOrder = `
query OrderWithProducts($id: ID!) {
  order(id: $id) {
    id
    status
    items {
      quantity
      price
      product { id title price rating }
    }
  }
}
`;

const migratedOrder = `
query OrderWithProducts($id: ID!) {
  order(id: $id) {
    id
    status
    items {
      quantity
      price
      product { id title unitPrice rating }
    }
  }
}
`;

const legacyBrowse = `
query BrowseProducts {
  products {
    id
    title
    description
    price
    brand
    category
    thumbnail
    in_stock
  }
}
`;

const migratedBrowse = `
query BrowseProducts {
  products {
    id
    title
    description
    unitPrice
    brand
    category
    thumbnail
    in_stock
  }
}
`;

const legacyProductDetails = `
query GetProductDetails($id: ID!) {
  product(id: $id) {
    id
    title
    description
    price
    brand
    category
    thumbnail
    in_stock
  }
}
`;

const migratedProductDetails = `
query GetProductDetails($id: ID!) {
  product(id: $id) {
    id
    title
    description
    unitPrice
    brand
    category
    thumbnail
    in_stock
  }
}
`;

const legacyCartDetails = `
query CartWithProductDetails {
  cart {
    total
    items {
      productId
      quantity
      price
      product {
        id
        title
        description
        price
        brand
        category
        thumbnail
        in_stock
      }
    }
  }
}
`;

const migratedCartDetails = `
query CartWithProductDetails {
  cart {
    total
    items {
      productId
      quantity
      price
      product {
        id
        title
        description
        unitPrice
        brand
        category
        thumbnail
        in_stock
      }
    }
  }
}
`;

const operationsByAudience = {
  legacy: [
    ...sharedOperations,
    { document: legacyProducts, operationName: "GetProducts", weight: 5 },
    {
      document: legacyProduct,
      operationName: "GetProduct",
      weight: 2,
      variables: () => ({ id: pick(productIds) }),
    },
    {
      document: legacyOrder,
      operationName: "OrderWithProducts",
      weight: 2,
      variables: () => ({ id: pick(orderIds) }),
    },
    { document: legacyBrowse, operationName: "BrowseProducts", weight: 3 },
    {
      document: legacyProductDetails,
      operationName: "GetProductDetails",
      weight: 2,
      variables: () => ({ id: pick(productIds) }),
    },
    { document: legacyCartDetails, operationName: "CartWithProductDetails", weight: 2 },
  ],
  migrated: [
    ...sharedOperations,
    { document: migratedProducts, operationName: "GetProducts", weight: 5 },
    {
      document: migratedProduct,
      operationName: "GetProduct",
      weight: 2,
      variables: () => ({ id: pick(productIds) }),
    },
    {
      document: migratedOrder,
      operationName: "OrderWithProducts",
      weight: 2,
      variables: () => ({ id: pick(orderIds) }),
    },
    { document: migratedBrowse, operationName: "BrowseProducts", weight: 3 },
    {
      document: migratedProductDetails,
      operationName: "GetProductDetails",
      weight: 2,
      variables: () => ({ id: pick(productIds) }),
    },
    { document: migratedCartDetails, operationName: "CartWithProductDetails", weight: 2 },
  ],
};

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function pickWeighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) {
      return item;
    }
  }
  return items[items.length - 1];
}

function delayMs() {
  return minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphql(operation, client) {
  const variables = operation.variables?.() ?? {};
  await fetch(routerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-attendee-id": attendeeId,
      "apollographql-client-name": client.name,
      "apollographql-client-version": client.version,
    },
    body: JSON.stringify({
      query: operation.document,
      operationName: operation.operationName,
      variables,
    }),
  }).then((response) => response.json());
  console.log(`sent ${operation.operationName}  ${client.name}@${client.version}`);
}

const started = Date.now();
const end = started + durationMs;
let sent = 0;

console.log(
  `Seeding ${routerUrl} as ${attendeeId} for ${Math.round(durationMs / 1000)}s`,
);

while (Date.now() < end) {
  const client = pickWeighted([...legacyClients, ...migratedClients]);
  const audience = migratedClients.some((item) => item.name === client.name)
    ? "migrated"
    : "legacy";
  await graphql(pickWeighted(operationsByAudience[audience]), client);
  sent += 1;
  const remaining = end - Date.now();
  if (remaining <= 0) {
    break;
  }
  await sleep(Math.min(delayMs(), remaining));
}

console.log(`done. ${sent} requests in ${Math.round((Date.now() - started) / 1000)}s`);
