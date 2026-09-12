"use strict";

const assert = require("assert");
const { buildOffer } = require("./offer-engine");

test("hot lead gets immediate human-close routing", () => {
  const offer = buildOffer({ score: 91, intent: "hot" }, "Demo Business");
  assert.equal(offer.action, "human_close");
  assert.equal(offer.priority, "P0");
  assert.equal(offer.slaMinutes, 5);
  assert.match(offer.conversionGuard, /Do not invent price/);
});

test("unknown intent fails safe into nurture", () => {
  const offer = buildOffer({ score: 150, intent: "unknown" });
  assert.equal(offer.intent, "cold");
  assert.equal(offer.score, 100);
  assert.equal(offer.action, "nurture");
});
