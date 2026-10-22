"use strict";

const PLACEHOLDER_HOSTS = new Set(["example.com", "example.org", "example.net", "example.test", "core.example.invalid"]);

function parseJson(env, key, fallback, errors) {
  try { return JSON.parse(String(env[key] || fallback)); }
  catch {
    errors.push(key + " must contain valid JSON");
    return null;
  }
}
function isHttpsUrl(value) {
  try { return new URL(String(value)).protocol === "https:"; }
  catch { return false; }
}
function isPlaceholderValue(value) { return /replace|placeholder|example|your[-_ ]|change[-_ ]me/i.test(String(value || "")); }
function isPlaceholderUrl(value) {
  try {
    const u = new URL(String(value));
    return PLACEHOLDER_HOSTS.has(u.hostname.toLowerCase()) || u.hostname.toLowerCase().endsWith(".example.com");
  } catch { return true; }
}
function validateCommerceEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const required = [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_WEBHOOK_URL",
    "CORE_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "COMMERCE_SUCCESS_URL",
    "COMMERCE_CANCEL_URL",
    "COMMERCE_PRODUCTS_JSON",
    "COMMERCE_DELIVERY_ZONES_JSON",
    "COMMERCE_COURIER_IDS",
    "COMMERCE_COURIER_TOKENS_JSON",
    "COMMERCE_ADMIN_IDS"
  ];
  const missing = required.filter((key) => !String(env[key] || "").trim());
  for (const key of missing) errors.push(key + " is required");

  if (String(env.CORE_API_KEY || "").length < 16 || isPlaceholderValue(env.CORE_API_KEY)) errors.push("CORE_API_KEY must be a real secret of at least 16 characters");
  if (String(env.TELEGRAM_WEBHOOK_SECRET || "").length < 16 || isPlaceholderValue(env.TELEGRAM_WEBHOOK_SECRET)) errors.push("TELEGRAM_WEBHOOK_SECRET must be a real secret of at least 16 characters");
  if (env.TELEGRAM_BOT_TOKEN && !/^\\d{5,}:[A-Za-z0-9_-]{20,}$/.test(String(env.TELEGRAM_BOT_TOKEN))) errors.push("TELEGRAM_BOT_TOKEN does not match the expected BotFather token format");

  const webhookUrl = String(env.TELEGRAM_WEBHOOK_URL || "");
  if (webhookUrl && (!isHttpsUrl(webhookUrl) || isPlaceholderUrl(webhookUrl) || !new URL(webhookUrl).pathname.endsWith("/api/telegram/webhook"))) {
    errors.push("TELEGRAM_WEBHOOK_URL must be a real HTTPS URL");
  }
  for (const key of ["COMMERCE_SUCCESS_URL", "COMMERCE_CANCEL_URL"]) {
    const value = String(env[key] || "");
    if (value && (!isHttpsUrl(value) || isPlaceholderUrl(value))) errors.push(key + " must be a real HTTPS URL");
  }

  const stripeKey = String(env.STRIPE_SECRET_KEY || "");
  if (stripeKey && (!stripeKey.startsWith("sk_test_") || isPlaceholderValue(stripeKey))) {
    errors.push("STRIPE_SECRET_KEY must start with sk_test_; live Stripe mode is disabled");
  }
  const stripeWebhook = String(env.STRIPE_WEBHOOK_SECRET || "");
  if (stripeWebhook && (!stripeWebhook.startsWith("whsec_") || isPlaceholderValue(stripeWebhook))) errors.push("STRIPE_WEBHOOK_SECRET must be a real signing secret beginning with whsec_");

  const products = parseJson(env, "COMMERCE_PRODUCTS_JSON", "[]", errors);
  let productCount = 0;
  if (products !== null) {
    if (!Array.isArray(products) || products.length === 0) errors.push("COMMERCE_PRODUCTS_JSON must be a non-empty array");
    else {
      const ids = new Set();
      for (const p of products) {
        if (!p || typeof p !== "object" || !/^[A-Za-z0-9_-]{1,32}$/.test(String(p.id || ""))) {
          errors.push("Every product must have a valid id");
          continue;
        }
        if (ids.has(p.id)) errors.push("Product IDs must be unique");
        ids.add(p.id);
        if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 200) errors.push("Every product must have a name of 1–200 characters");
        if (!Number.isSafeInteger(p.priceKzt) || p.priceKzt <= 0 || p.priceKzt > 999999) errors.push("Product prices must be integer KZT amounts from 1 to 999999");
        if (p.active !== undefined && typeof p.active !== "boolean") errors.push("Product active flag must be true or false");
      }
      productCount = products.filter((p) => p && p.active !== false && typeof p.id === "string" &&
        typeof p.name === "string" && Number.isSafeInteger(p.priceKzt) && p.priceKzt > 0 && p.priceKzt <= 999999).length;
      if (productCount === 0) errors.push("At least one valid active product is required");
    }
  }

  const zones = parseJson(env, "COMMERCE_DELIVERY_ZONES_JSON", "{}", errors);
  let zoneCount = 0;
  if (zones !== null) {
    if (!zones || typeof zones !== "object" || Array.isArray(zones) || Object.keys(zones).length === 0) {
      errors.push("COMMERCE_DELIVERY_ZONES_JSON must be a non-empty object");
    } else {
      for (const [zone, fee] of Object.entries(zones)) {
        if (!zone.trim() || !Number.isSafeInteger(fee) || fee < 0 || fee > 999999) {
          errors.push("Delivery zone fees must be integer KZT amounts from 0 to 999999");
        }
      }
      zoneCount = Object.keys(zones).filter((zone) => zone.trim() && Number.isSafeInteger(zones[zone]) && zones[zone] >= 0 && zones[zone] <= 999999).length;
    }
  }

  const courierIds = String(env.COMMERCE_COURIER_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const courierTokens = parseJson(env, "COMMERCE_COURIER_TOKENS_JSON", "{}", errors);
  if (courierIds.length === 0) errors.push("COMMERCE_COURIER_IDS must contain at least one courier Telegram ID");
  if (new Set(courierIds).size !== courierIds.length) errors.push("COMMERCE_COURIER_IDS must not contain duplicates");
  for (const id of courierIds) {
    if (!/^\d{1,20}$/.test(id)) errors.push("Courier IDs must be numeric Telegram user IDs");
  }
  if (courierTokens !== null) {
    if (!courierTokens || typeof courierTokens !== "object" || Array.isArray(courierTokens)) {
      errors.push("COMMERCE_COURIER_TOKENS_JSON must be a JSON object");
    } else {
      const configuredTokens = [];
      for (const id of courierIds) {
        if (typeof courierTokens[id] !== "string" || courierTokens[id].length < 32 || isPlaceholderValue(courierTokens[id])) {
          errors.push("Every configured courier needs a unique upload token of at least 32 characters");
        } else {
          configuredTokens.push(courierTokens[id]);
        }
      }
      if (new Set(configuredTokens).size !== configuredTokens.length) errors.push("Each courier must have a different upload token");
    }
  }

  const adminIds = String(env.COMMERCE_ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (adminIds.length === 0) errors.push("COMMERCE_ADMIN_IDS must contain at least one administrator Telegram ID");
  for (const id of adminIds) {
    if (!/^\d{1,20}$/.test(id)) errors.push("Administrator IDs must be numeric Telegram user IDs");
  }

  if (String(env.COMMERCE_CURRENCY || "KZT").toUpperCase() !== "KZT") {
    errors.push("This checkout implementation currently supports KZT only");
  }
  if (errors.length) warnings.push("Do not open the store to customers until all errors are fixed");
  return {
    ok: errors.length === 0,
    mode: "stripe-test-only",
    checked: {
      productCount,
      deliveryZoneCount: zoneCount,
      courierCount: courierIds.length,
      adminCount: adminIds.length,
      stripeTestKeyConfigured: stripeKey.startsWith("sk_test_"),
      stripeWebhookConfigured: stripeWebhook.startsWith("whsec_")
    },
    errors,
    warnings
  };
}

if (require.main === module) {
  const result = validateCommerceEnv();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
module.exports = { validateCommerceEnv };
