"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("./rate-limit");

test("rate limiter allows up to max requests and then returns 429", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2, keyGenerator: () => "test" });
  const responses = [];
  const next = () => responses.push("next");
  const makeRes = () => ({
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  });

  const req = { requestId: "req-1" };
  let res = makeRes();
  limiter(req, res, next);
  res = makeRes();
  limiter(req, res, next);
  res = makeRes();
  limiter(req, res, next);

  assert.equal(res.statusCode, 429);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, "RATE_LIMITED");
  assert.equal(res.body.error.requestId, "req-1");
  assert.equal(res.headers["Retry-After"], "60");
  assert.equal(responses.length, 2);
});

test("rate limiter keeps different keys isolated", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, keyGenerator: (req) => req.ip });
  const next = () => {};
  const makeRes = () => ({ setHeader() {}, status(code) { this.statusCode = code; return this; }, json() { return this; } });

  const first = makeRes();
  limiter({ ip: "1.1.1.1", requestId: "a" }, first, next);
  const blocked = makeRes();
  limiter({ ip: "1.1.1.1", requestId: "b" }, blocked, next);
  const other = makeRes();
  limiter({ ip: "2.2.2.2", requestId: "c" }, other, next);

  assert.equal(blocked.statusCode, 429);
  assert.equal(other.statusCode, undefined);
});
