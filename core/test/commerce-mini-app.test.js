"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "mini-app");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("Telegram Commerce Mini App JavaScript parses without browser globals at import time", () => {
  assert.doesNotThrow(() => new vm.Script(script, { filename: "core/mini-app/app.js" }));
});

test("Mini App loads local assets and prominently labels test-only behavior", () => {
  assert.match(html, /lang="ru"/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /\/mini-app\/styles\.css/);
  assert.match(html, /\/mini-app\/app\.js/);
  assert.match(html, /telegram-web-app\.js/);
  assert.match(html, /ТЕСТОВЫЙ РЕЖИМ/);
  assert.match(html, /деньги не списываются/i);
  assert.match(html, /реальный.*данные|не вводите настоящие платёжные данные/i);
});

test("Mini App uses verified Telegram initData and contains no server secrets", () => {
  assert.match(script, /X-Telegram-Init-Data/);
  assert.match(script, /tg\.initData/);
  assert.doesNotMatch(script, /CORE_API_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|Bearer sk_(?:test|live)_/);
  assert.doesNotMatch(script, /customerId\s*:/);
});

test("Mini App calls only the versioned Commerce test API and validates Checkout output", () => {
  for (const route of [
    "/v1/commerce/catalog",
    "/v1/commerce/orders",
    "/v1/commerce/orders/"
  ]) assert.ok(script.includes(route), "Missing route contract: " + route);
  assert.match(script, /\/checkout/);
  assert.match(script, /\/cancel/);
  assert.match(script, /cs_test_\[A-Za-z0-9\]/);
  assert.match(script, /https:\/\/checkout\.stripe\.com/);
  assert.match(script, /payload\.mode !== "stripe_test"/);
});

test("Mini App CSS has mobile layout and reduced-motion support", () => {
  assert.match(css, /@media\s*\(max-width:\s*580px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});
