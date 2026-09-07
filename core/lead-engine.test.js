"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreLead } = require("./lead-engine");

test("scores buying intent as hot", () => {
  const result = scoreLead("Хочу купить, сколько стоит и можно ли сегодня?");
  assert.equal(result.intent, "hot");
  assert.ok(result.score >= 70);
});

test("does not classify empty text as a hot lead", () => {
  const result = scoreLead("");
  assert.notEqual(result.intent, "hot");
});
