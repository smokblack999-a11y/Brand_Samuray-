"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { auditRevenueLeakage, parseCsvLeads } = require("../revenue-recovery/audit");

const sample = {
  currency: "USD",
  slaMinutes: 5,
  leads: [
    { id: "L-1", createdAt: "2026-10-01T09:00:00Z", firstResponseAt: "2026-10-01T09:03:00Z", outcome: "won" },
    { id: "L-2", createdAt: "2026-10-01T09:00:00Z", firstResponseAt: "2026-10-01T09:12:00Z", outcome: "open" },
    { id: "L-3", createdAt: "2026-10-01T09:00:00Z", firstResponseAt: null, outcome: "lost" },
    { id: "L-4", createdAt: "2026-10-01T09:00:00Z", firstResponseAt: "2026-10-01T09:05:00Z", outcome: "lost" }
  ]
};

test("calculates response gaps without calling them proven lost revenue", () => {
  const report = auditRevenueLeakage(sample);
  assert.equal(report.schemaVersion, "samurai.revenue-recovery.audit.v1");
  assert.equal(report.summary.totalLeads, 4);
  assert.equal(report.summary.recordedFirstResponses, 3);
  assert.equal(report.summary.noRecordedFirstResponse, 1);
  assert.equal(report.summary.responsesWithinSla, 2);
  assert.equal(report.summary.responsesAfterSla, 1);
  assert.equal(report.summary.recordedResponseRatePct, 75);
  assert.equal(report.summary.slaCompliancePct, 50);
  assert.equal(report.summary.medianRecordedResponseMinutes, 5);
  assert.equal(report.summary.p90RecordedResponseMinutes, 12);
  assert.equal(report.leakageReview.totalUnconvertedLeadsWithPotentialResponseGap, 2);
  assert.match(report.leakageReview.interpretation, /does not prove/i);
  assert.equal(report.illustrativeScenario, null);
});

test("labels economic output as illustrative and uses only supplied assumptions", () => {
  const report = auditRevenueLeakage({
    ...sample,
    assumptions: { grossProfitPerWin: 200, recoveryRatePct: 50, pilotFee: 100, operatingCost: 20, measurementDays: 14 }
  });
  assert.equal(report.illustrativeScenario.atRiskLeadCount, 2);
  assert.equal(report.illustrativeScenario.illustrativeGrossProfitIfAssumptionHolds, 200);
  assert.equal(report.illustrativeScenario.illustrativeNetContributionAfterStatedCosts, 80);
  assert.equal(report.illustrativeScenario.isForecast, false);
});

test("uses exact SLA boundary as within SLA", () => {
  const report = auditRevenueLeakage({
    currency: "USD",
    slaMinutes: 5,
    leads: [{ id: "exact", createdAt: "2026-10-01T09:00:00Z", firstResponseAt: "2026-10-01T09:05:00Z", outcome: "open" }]
  });
  assert.equal(report.summary.responsesWithinSla, 1);
  assert.equal(report.summary.responsesAfterSla, 0);
});

test("rejects duplicate IDs, invalid outcomes, and response before creation", () => {
  assert.throws(() => auditRevenueLeakage({ ...sample, leads: [sample.leads[0], sample.leads[0]] }), e => e.code === "DUPLICATE_LEAD_ID");
  assert.throws(() => auditRevenueLeakage({ ...sample, leads: [{ ...sample.leads[0], outcome: "maybe" }] }), e => e.code === "INVALID_METRIC");
  assert.throws(() => auditRevenueLeakage({ ...sample, leads: [{ ...sample.leads[0], firstResponseAt: "2026-10-01T08:59:00Z" }] }), e => e.code === "INVALID_METRIC");
});

test("does not echo duplicate lead identifiers in validation errors", () => {
  const sensitiveLookingId = "customer@example.com";
  assert.throws(
    () => auditRevenueLeakage({
      currency: "USD",
      leads: [
        { id: sensitiveLookingId, createdAt: "2026-10-01T09:00:00Z", firstResponseAt: null, outcome: "open" },
        { id: sensitiveLookingId, createdAt: "2026-10-01T09:00:00Z", firstResponseAt: null, outcome: "open" }
      ]
    }),
    error => error.code === "DUPLICATE_LEAD_ID" && !error.message.includes(sensitiveLookingId)
  );
});

test("requires timezone-qualified timestamps and rejects invalid assumptions", () => {
  assert.throws(() => auditRevenueLeakage({
    currency: "USD",
    leads: [{ id: "x", createdAt: "2026-10-01T09:00:00", firstResponseAt: null, outcome: "open" }]
  }), e => e.code === "INVALID_METRIC");
  assert.throws(() => auditRevenueLeakage({
    ...sample,
    assumptions: { grossProfitPerWin: -1, recoveryRatePct: 50, pilotFee: 100, operatingCost: 20 }
  }), e => e.code === "INVALID_METRIC");
});

test("parses CSV headers, blank response timestamps, quoted commas, and CRLF", () => {
  const csv = [
    "lead_id,created_at,first_response_at,outcome",
    "L-1,2026-10-01T09:00:00Z,2026-10-01T09:03:00Z,won",
    "L-2,2026-10-01T09:00:00Z,,open"
  ].join("\r\n");
  const leads = parseCsvLeads(csv);
  assert.equal(leads.length, 2);
  assert.equal(leads[0].id, "L-1");
  assert.equal(leads[1].firstResponseAt, null);
  const report = auditRevenueLeakage({ currency: "USD", leads });
  assert.equal(report.summary.noRecordedFirstResponse, 1);
});

test("rejects malformed CSV and missing required columns", () => {
  assert.throws(() => parseCsvLeads("lead_id,created_at\n1,2026-10-01T09:00:00Z"), e => e.code === "INVALID_CSV");
  assert.throws(() => parseCsvLeads('lead_id,created_at,first_response_at,outcome\n1,2026-10-01T09:00:00Z,,"open'), e => e.code === "INVALID_CSV");
});

test("rejects unused CSV columns to minimize accidental personal-data processing", () => {
  const csv = [
    "lead_id,created_at,first_response_at,outcome,customer_email",
    "L-1,2026-10-01T09:00:00Z,,open,person@example.com"
  ].join("\\n");
  assert.throws(
    () => parseCsvLeads(csv),
    error => error.code === "INVALID_CSV" && /only the required columns/.test(error.message)
  );
});

test("calculates win rate only from closed outcomes, excluding open leads", () => {
  const report = auditRevenueLeakage({
    currency: "USD",
    leads: [
      { id: "won-1", createdAt: "2026-10-01T09:00:00Z", firstResponseAt: "2026-10-01T09:01:00Z", outcome: "won" },
      { id: "lost-1", createdAt: "2026-10-01T09:00:00Z", firstResponseAt: "2026-10-01T09:02:00Z", outcome: "lost" },
      { id: "open-1", createdAt: "2026-10-01T09:00:00Z", firstResponseAt: "2026-10-01T09:03:00Z", outcome: "open" },
      { id: "open-2", createdAt: "2026-10-01T09:00:00Z", firstResponseAt: null, outcome: "open" }
    ]
  });
  assert.equal(report.outcomesByResponseGroup.withinSla.resolved, 2);
  assert.equal(report.outcomesByResponseGroup.withinSla.winRatePct, 50);
  assert.equal(report.outcomesByResponseGroup.noRecordedResponse.resolved, 0);
  assert.equal(report.outcomesByResponseGroup.noRecordedResponse.winRatePct, null);
});


test("rejects CSV rows with missing or extra fields instead of silently shifting data", () => {
  const header = "lead_id,created_at,first_response_at,outcome";
  const missingField = [header, "L-1,2026-10-01T09:00:00Z,"].join("\n");
  const extraField = [header, "L-1,2026-10-01T09:00:00Z,,open,unexpected"].join("\n");

  assert.throws(
    () => parseCsvLeads(missingField),
    error => error.code === "INVALID_CSV" && /has 3 fields; expected 4/.test(error.message)
  );
  assert.throws(
    () => parseCsvLeads(extraField),
    error => error.code === "INVALID_CSV" && /has 5 fields; expected 4/.test(error.message)
  );
});

test("rejects booleans and whitespace strings as numeric assumptions", () => {
  for (const grossProfitPerWin of [true, " "]) {
    assert.throws(
      () => auditRevenueLeakage({
        ...sample,
        assumptions: { grossProfitPerWin, recoveryRatePct: 10, pilotFee: 10, operatingCost: 1 }
      }),
      e => e.code === "INVALID_METRIC"
    );
  }
});


test("rejects impossible calendar dates and invalid timezone offsets", () => {
  for (const createdAt of [
    "2026-02-30T09:00:00Z",
    "2026-13-01T09:00:00Z",
    "2026-10-01T24:00:00Z",
    "2026-10-01T09:00:00+25:00"
  ]) {
    assert.throws(
      () => auditRevenueLeakage({
        currency: "USD",
        leads: [{ id: "bad-time", createdAt, firstResponseAt: null, outcome: "open" }]
      }),
      error => error.code === "INVALID_METRIC"
    );
  }
});


test("enforces the CSV size limit using UTF-8 bytes", () => {
  const oversizedUtf8 = "é".repeat(2_621_441);
  assert.throws(() => parseCsvLeads(oversizedUtf8), error => error.code === "CSV_TOO_LARGE");
});
