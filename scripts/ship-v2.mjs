#!/usr/bin/env node
/**
 * Fast-forward to the Part 2 "another team shipped v2" state.
 *
 * Copies the canonical broken schema, runs check + lint (both are expected to
 * fail; details are hidden so attendees diagnose in Studio), publishes products,
 * then publishes orders. Orders composition fails: Address is not @shareable.
 * That failed launch is the investigation. Product is already an entity.
 *
 *   node scripts/ship-v2.mjs
 *
 * Reads APOLLO_KEY and APOLLO_GRAPH_REF from the environment, or from
 * .env in this repo if those are unset.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REGISTRY_URL = "https://graphql.api.apollographql.com/api/graphql";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env");
const brokenProducts = join(root, "solutions", "part2-broken", "products.graphql");
const brokenOrders = join(root, "solutions", "part2-broken", "orders.graphql");
const attendeeProducts = join(root, "products.graphql");
const attendeeOrders = join(root, "orders.graphql");

loadDotEnv(envFile);

const apolloKey = process.env.APOLLO_KEY?.trim();
const graphRef = process.env.APOLLO_GRAPH_REF?.trim();

if (!apolloKey || !graphRef) {
  console.error(
    "Missing APOLLO_KEY or APOLLO_GRAPH_REF. Copy .env.example to .env. Create a graph API key in Studio (Settings → API Keys) for APOLLO_KEY, and copy APOLLO_GRAPH_REF from your seat card.",
  );
  process.exit(1);
}

if (!existsSync(brokenProducts) || !existsSync(brokenOrders)) {
  console.error("Missing solutions/part2-broken/products.graphql or orders.graphql");
  process.exit(1);
}

console.log("StoreFront v2 — applying the schemas another team already shipped.");
console.log(`Graph: ${graphRef}`);
console.log("This replaces products.graphql and orders.graphql. Do not re-run after you start fixing.");
console.log("");

copyFileSync(brokenProducts, attendeeProducts);
copyFileSync(brokenOrders, attendeeOrders);
console.log("1/5  Copied part2-broken products.graphql and orders.graphql");
console.log("");

console.log("2/5  Schema check on orders (what CI would run before publish; may take a minute)...");
const check = runRover(
  ["subgraph", "check", graphRef, "--schema", attendeeOrders, "--name", "orders"],
  { quiet: true },
);
summarizeHiddenStep("Check", check);
console.log("");

console.log("3/5  Lint products...");
const lint = runRover(
  ["subgraph", "lint", graphRef, "--schema", attendeeProducts, "--name", "products"],
  { quiet: true },
);
summarizeHiddenStep("Lint", lint);
console.log("");

console.log("4/5  Publishing products...");
const publishProducts = runRover([
  "subgraph",
  "publish",
  graphRef,
  "--schema",
  attendeeProducts,
  "--name",
  "products",
  "--routing-url",
  "http://localhost",
  "--allow-invalid-routing-url",
]);
if (publishProducts.status !== 0) {
  console.error("Products publish failed. Fix Rover/credentials and re-run this script.");
  process.exit(publishProducts.status);
}

console.log("5/5  Publishing orders (this launch does not compose — investigate it)...");
const publish = runRover(
  [
    "subgraph",
    "publish",
    graphRef,
    "--schema",
    attendeeOrders,
    "--name",
    "orders",
    "--routing-url",
    "http://localhost",
    "--allow-invalid-routing-url",
  ],
  { quiet: true },
);

if (publish.status !== 0) {
  if (looksLikeToolingFailure(publish.output)) {
    console.error(publish.output.trim());
    console.error("Orders publish failed. Fix Rover/credentials and re-run this script.");
    process.exit(publish.status);
  }
  summarizeHiddenStep("Orders publish", publish);
}

console.log("");
console.log("Done. Another team's ship is now on your graph.");
console.log("Open Studio → Launches and Checks. Diagnose from that evidence — do not open solutions/part2-fixed.");

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

function runRover(args, { quiet = false } = {}) {
  const result = spawnSync("rover", args, {
    cwd: root,
    env: { ...process.env, APOLLO_REGISTRY_URL: REGISTRY_URL },
    encoding: "utf8",
    stdio: quiet ? ["inherit", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
  });
  if (result.error?.code === "ENOENT") {
    console.error(
      "Rover is not on PATH. Install it from https://www.apollographql.com/docs/rover/getting-started",
    );
    process.exit(1);
  }
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

function summarizeHiddenStep(label, { status, output }) {
  if (status === 0) {
    console.log(`    ${label} passed.`);
    return;
  }
  if (looksLikeToolingFailure(output)) {
    console.error(output.trim());
    process.exit(status);
  }
  console.log(
    `    ${label} did not pass (expected). Details are in Studio — this script will not list them.`,
  );
  const url = output.match(/https:\/\/studio(?:-staging)?\.apollographql\.com\S*/)?.[0];
  if (url) {
    console.log(`    ${url}`);
  }
}

function looksLikeToolingFailure(output) {
  // Composition and lint failures are the investigation. Rover transport and
  // auth errors are not — those should stop the script before publish.
  if (
    /Encountered \d+ (build|composition) error|INVALID_FIELD_SHARING|The changes in the schema you proposed|lint|did not compose/i.test(
      output,
    )
  ) {
    return false;
  }
  return /error sending request|error\[E0\d+\]|401 Unauthorized|Invalid API key|APOLLO_KEY/i.test(
    output,
  );
}
