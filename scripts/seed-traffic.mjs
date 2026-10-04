#!/usr/bin/env node
/**
 * Send named-client traffic at a local rover dev router so Studio Insights
 * can answer three questions:
 *
 *   - Which operation is slow? ProductsWithRatingsAndReviews (N+1 reviews).
 *   - What is erroring? GetProducts selects rating. Some products omit it.
 *   - Who still uses deprecated Product.price? storefront-ios and
 *     storefront-android. storefront-web has moved to unitPrice.
 *     catalog-agent still selects both while it audits the migration.
 *
 * Storefront operations are separate screens: catalog, product page, cart,
 * checkout, order confirmation, and the reviews tab. Agent clients send their
 * own operations rather than replaying the storefront ones.
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
const durationMs = Number(process.env.DURATION_MS ?? 300_000);
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

const legacyProducts = `
query GetProducts {
  products {
    id
    title
    price
    rating
    in_stock
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

const homeRail = `
query HomeRail {
  products {
    id
    title
    thumbnail
    category
  }
}
`;

const productReviews = `
query ProductReviews($id: ID!) {
  product(id: $id) {
    id
    reviews {
      id
      rating
      comment
      reviewerName
    }
  }
}
`;

const orderConfirmation = `
query OrderConfirmation($orderId: ID!, $customerId: ID!) {
  order(id: $orderId) {
    id
    status
    createdAt
    total
    shippingAddress {
      city
      country
    }
    items {
      quantity
      product {
        id
        title
      }
    }
  }
  customer(id: $customerId) {
    firstName
    lastName
    email
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
  { document: homeRail, operationName: "HomeRail", weight: 2 },
  {
    document: productReviews,
    operationName: "ProductReviews",
    weight: 2,
    variables: () => ({ id: pick(productIds) }),
  },
  {
    document: orderConfirmation,
    operationName: "OrderConfirmation",
    weight: 2,
    variables: () => ({
      orderId: pick(orderIds),
      customerId: pick(customerIds),
    }),
  },
];

const legacyProduct = `
query GetProduct($id: ID!) {
  product(id: $id) {
    id
    title
    description
    price
    rating
    in_stock
    thumbnail
  }
}
`;

const migratedProduct = `
query GetProduct($id: ID!) {
  product(id: $id) {
    id
    title
    description
    unitPrice
    rating
    in_stock
    thumbnail
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

const legacyCheckoutSummary = `
query CheckoutSummary {
  cart {
    total
    items {
      quantity
      product {
        id
        title
        thumbnail
        price
      }
    }
  }
}
`;

const migratedCheckoutSummary = `
query CheckoutSummary {
  cart {
    total
    items {
      quantity
      product {
        id
        title
        thumbnail
        unitPrice
      }
    }
  }
}
`;

const supportTicket = `
query SupportTicket($orderId: ID!, $customerId: ID!) {
  order(id: $orderId) {
    id
    status
    createdAt
    total
    items {
      productId
      quantity
    }
  }
  customer(id: $customerId) {
    id
    firstName
    lastName
    email
    phone
  }
}
`;

const customerLookup = `
query CustomerLookup($id: ID!) {
  customer(id: $id) {
    id
    email
    phone
  }
}
`;

const inventoryLevels = `
query InventoryLevels {
  products {
    id
    title
    brand
    in_stock
  }
}
`;

const productAvailability = `
query ProductAvailability($id: ID!) {
  product(id: $id) {
    id
    title
    in_stock
  }
}
`;

const recommendationCard = `
query RecommendationCard($id: ID!) {
  product(id: $id) {
    id
    title
    brand
    category
    thumbnail
    description
    unitPrice
  }
}
`;

const recommendationContext = `
query RecommendationContext($id: ID!) {
  product(id: $id) {
    id
    brand
    category
    reviews {
      rating
      comment
    }
  }
}
`;

const packingSlip = `
query PackingSlip($id: ID!) {
  order(id: $id) {
    id
    shippingAddress {
      line1
      city
      postalCode
      country
    }
    items {
      productId
      quantity
      product {
        id
        title
      }
    }
  }
}
`;

const orderStatus = `
query OrderStatus($id: ID!) {
  order(id: $id) {
    id
    status
    createdAt
  }
}
`;

const priceMigrationAudit = `
query PriceMigrationAudit {
  products {
    id
    title
    price
    unitPrice
  }
}
`;

const productPriceCheck = `
query ProductPriceCheck($id: ID!) {
  product(id: $id) {
    id
    title
    price
    unitPrice
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
    { document: legacyCheckoutSummary, operationName: "CheckoutSummary", weight: 2 },
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
    { document: migratedCheckoutSummary, operationName: "CheckoutSummary", weight: 2 },
  ],
};

const supportOperations = [
  {
    document: supportTicket,
    operationName: "SupportTicket",
    weight: 3,
    variables: () => ({
      orderId: pick(orderIds),
      customerId: pick(customerIds),
    }),
  },
  {
    document: customerLookup,
    operationName: "CustomerLookup",
    weight: 2,
    variables: () => ({ id: pick(customerIds) }),
  },
];

const inventoryOperations = [
  { document: inventoryLevels, operationName: "InventoryLevels", weight: 3 },
  {
    document: productAvailability,
    operationName: "ProductAvailability",
    weight: 2,
    variables: () => ({ id: pick(productIds) }),
  },
];

const recommendationOperations = [
  {
    document: recommendationCard,
    operationName: "RecommendationCard",
    weight: 3,
    variables: () => ({ id: pick(productIds) }),
  },
  {
    document: recommendationContext,
    operationName: "RecommendationContext",
    weight: 2,
    variables: () => ({ id: pick(productIds) }),
  },
];

const fulfillmentOperations = [
  {
    document: packingSlip,
    operationName: "PackingSlip",
    weight: 3,
    variables: () => ({ id: pick(orderIds) }),
  },
  {
    document: orderStatus,
    operationName: "OrderStatus",
    weight: 2,
    variables: () => ({ id: pick(orderIds) }),
  },
];

const catalogOperations = [
  { document: priceMigrationAudit, operationName: "PriceMigrationAudit", weight: 3 },
  {
    document: productPriceCheck,
    operationName: "ProductPriceCheck",
    weight: 2,
    variables: () => ({ id: pick(productIds) }),
  },
];

const trafficSources = [
  { name: "storefront-ios", version: "3.2.0", weight: 4, operations: operationsByAudience.legacy },
  {
    name: "storefront-android",
    version: "3.1.1",
    weight: 3,
    operations: operationsByAudience.legacy,
  },
  { name: "storefront-web", version: "2.0.0", weight: 6, operations: operationsByAudience.migrated },
  { name: "support-agent", version: "1.4.0", weight: 3, operations: supportOperations },
  { name: "inventory-agent", version: "0.9.2", weight: 3, operations: inventoryOperations },
  {
    name: "recommendations-agent",
    version: "1.1.0",
    weight: 3,
    operations: recommendationOperations,
  },
  { name: "fulfillment-agent", version: "2.3.1", weight: 3, operations: fulfillmentOperations },
  { name: "catalog-agent", version: "0.3.0", weight: 2, operations: catalogOperations },
];

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
  const client = pickWeighted(trafficSources);
  await graphql(pickWeighted(client.operations), client);
  sent += 1;
  const remaining = end - Date.now();
  if (remaining <= 0) {
    break;
  }
  await sleep(Math.min(delayMs(), remaining));
}

console.log(`done. ${sent} requests in ${Math.round((Date.now() - started) / 1000)}s`);
