"use strict";

// Isolated auth tests use a non-secret local token solely to generate signed fixtures.
process.env.TELEGRAM_BOT_TOKEN = "unit-test-token-not-a-real-credential";
process.env.TELEGRAM_WEBAPP_AUTH_MAX_AGE_SECONDS = "not-a-number";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { validateInitData } = require("./webapp-auth");

function signedInitData(authDate) {
  const fields = [
    ["auth_date", String(authDate)],
    ["user", JSON.stringify({ id: 987654, first_name: "Unit Test" })]
  ];
  const check = fields.slice().sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => key + "=" + value).join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(check).digest("hex");
  return [...fields, ["hash", hash]]
    .map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value))
    .join("&");
}

test("valid signed Telegram initData returns the signed user", () => {
  const now = Math.floor(Date.now() / 1000);
  const data = validateInitData(signedInitData(now));
  assert.equal(data.user.id, 987654);
  assert.equal(data.authDate, now);
});

test("invalid max-age configuration falls back safely instead of disabling expiry", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.throws(
    () => validateInitData(signedInitData(now - 86401)),
    /expired/
  );
});

test("signed initData with a far-future auth_date is rejected", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.throws(
    () => validateInitData(signedInitData(now + 600)),
    /in the future/
  );
});

test("initData tampering is rejected even with a previously valid signature", () => {
  const now = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams(signedInitData(now));
  params.set("user", JSON.stringify({ id: 1, first_name: "Different user" }));
  assert.throws(() => validateInitData(params.toString()), /Invalid Telegram WebApp signature/);
});
