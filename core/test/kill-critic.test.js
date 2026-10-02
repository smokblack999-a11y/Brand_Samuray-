"use strict";
const assert = require("assert");
const { checkDraft } = require("../kill-critic");

const blocked = checkDraft({ draft: "Цена $100, скидка 20%, всё забронировал.", facts: {} });
assert.strictEqual(blocked.decision, "BLOCKED");
assert.ok(blocked.findings.some(x => x.code === "UNSUPPORTED_PRICE"));
assert.ok(blocked.findings.some(x => x.code === "UNSUPPORTED_DISCOUNT"));
assert.ok(blocked.findings.some(x => x.code === "UNVERIFIED_ACTION"));

const allowed = checkDraft({ draft: "Напишите удобную дату, и я уточню наличие.", facts: {} });
assert.strictEqual(allowed.decision, "AUTO_ALLOWED");

console.log("kill-critic tests passed");
