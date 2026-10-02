const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.TELEGRAM_BOT_TOKEN = "123456:TEST_TOKEN";

const { validateInitData } = require("../webapp-auth");

function signedInitData(user) {
  const authDate = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify(user),
    query_id: "AA123"
  });
  const pairs = Array.from(params.entries()).sort().map(([k,v]) => k + "=" + v);
  const dataCheckString = pairs.join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

test("accepts valid Telegram WebApp initData", () => {
  const result = validateInitData(signedInitData({ id: 42, first_name: "Test" }));
  assert.equal(result.user.id, 42);
});

test("rejects tampered Telegram WebApp initData", () => {
  const initData = signedInitData({ id: 42 });
  assert.throws(() => validateInitData(initData.replace("42", "43")), /Invalid Telegram WebApp signature/);
});
