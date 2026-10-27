"use strict";

const MAX_LEADS = 10000;
const MAX_CSV_CHARS = 5 * 1024 * 1024;
const OUTCOMES = new Set(["open", "won", "lost"]);
const REQUIRED_CSV_COLUMNS = ["lead_id", "created_at", "first_response_at", "outcome"];

function fail(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function finiteNumber(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(n) || n < min || n > max) {
    fail("INVALID_METRIC", field + " must be a number between " + min + " and " + max);
  }
  return n;
}

function parseTimestamp(value, field, { optional = false } = {}) {
  if ((value === null || value === undefined || String(value).trim() === "") && optional) return null;
  const text = String(value || "").trim();
  // Require an explicit timezone so records from different systems remain comparable.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) {
    fail("INVALID_METRIC", field + " must be an ISO timestamp with timezone, e.g. 2026-10-01T09:30:00Z");
  }
  const valueMs = Date.parse(text);
  if (!Number.isFinite(valueMs)) fail("INVALID_METRIC", field + " is not a valid timestamp");
  return valueMs;
}

function parseCsvRecords(csv) {
  if (typeof csv !== "string") fail("INVALID_CSV", "csv must be a string");
  if (csv.length > MAX_CSV_CHARS) fail("CSV_TOO_LARGE", "CSV exceeds the 5 MiB limit", 413);

  const input = csv.charCodeAt(0) === 0xFEFF ? csv.slice(1) : csv;
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (closedQuote && ch !== "," && ch !== "\r" && ch !== "\n" && ch !== " " && ch !== "\t") {
      fail("INVALID_CSV", "Unexpected character after a quoted CSV field");
    }
    if (ch === '"') {
      if (field.length !== 0 || closedQuote) fail("INVALID_CSV", "Unexpected quote in CSV field");
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(field.trim());
      field = "";
      closedQuote = false;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      if (rows.length > MAX_LEADS + 1) fail("TOO_MANY_LEADS", "CSV may contain at most " + MAX_LEADS + " data rows", 413);
      row = [];
      field = "";
      closedQuote = false;
      continue;
    }
    if (closedQuote && (ch === " " || ch === "\t")) continue;
    field += ch;
  }

  if (quoted) fail("INVALID_CSV", "CSV contains an unterminated quoted field");
  row.push(field.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  if (rows.length > MAX_LEADS + 1) fail("TOO_MANY_LEADS", "CSV may contain at most " + MAX_LEADS + " data rows", 413);
  return rows;
}

function parseCsvLeads(csv) {
  const rows = parseCsvRecords(csv);
  if (rows.length < 2) fail("INVALID_CSV", "CSV must contain a header and at least one data row");
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) fail("INVALID_CSV", "CSV contains duplicate column names");
  const missing = REQUIRED_CSV_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) fail("INVALID_CSV", "CSV is missing required columns: " + missing.join(", "));

  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  return rows.slice(1).map((values, i) => ({
    id: values[index.lead_id] || "",
    createdAt: values[index.created_at] || "",
    firstResponseAt: values[index.first_response_at] || null,
    outcome: values[index.outcome] || "",
    sourceRow: i + 2
  }));
}

function normalizeAssumptions(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_METRIC", "assumptions must be an object");
  }
  return {
    grossProfitPerWin: finiteNumber(value.grossProfitPerWin, "assumptions.grossProfitPerWin", { min: 0, max: 1_000_000_000 }),
    recoveryRatePct: finiteNumber(value.recoveryRatePct, "assumptions.recoveryRatePct", { min: 0, max: 100 }),
    pilotFee: finiteNumber(value.pilotFee, "assumptions.pilotFee", { min: 0, max: 1_000_000_000 }),
    operatingCost: finiteNumber(value.operatingCost, "assumptions.operatingCost", { min: 0, max: 1_000_000_000 }),
    measurementDays: finiteNumber(value.measurementDays === undefined ? 14 : value.measurementDays, "assumptions.measurementDays", { min: 1, max: 365 })
  };
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percent(numerator, denominator) {
  return denominator > 0 ? round((numerator / denominator) * 100) : null;
}

function summarizeGroup(items) {
  const won = items.filter((item) => item.outcome === "won").length;
  const lost = items.filter((item) => item.outcome === "lost").length;
  const open = items.filter((item) => item.outcome === "open").length;
  return {
    leads: items.length,
    won,
    lost,
    open,
    winRatePct: percent(won, items.length)
  };
}

/**
 * Audits response-time gaps in one exported lead cohort.
 * This function is deterministic, stateless, and makes no external API calls.
 */
function auditRevenueLeakage(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_METRIC", "JSON object is required");
  }
  if (!Array.isArray(input.leads)) fail("INVALID_METRIC", "leads must be an array");
  if (input.leads.length < 1) fail("INVALID_METRIC", "at least one lead is required");
  if (input.leads.length > MAX_LEADS) fail("TOO_MANY_LEADS", "At most " + MAX_LEADS + " leads can be audited", 413);

  const currency = String(input.currency || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail("INVALID_METRIC", "currency must be a 3-letter code, e.g. USD");
  const slaMinutes = finiteNumber(input.slaMinutes === undefined ? 5 : input.slaMinutes, "slaMinutes", { min: 1, max: 1440 });
  const assumptions = normalizeAssumptions(input.assumptions);
  const ids = new Set();
  const normalized = input.leads.map((lead, index) => {
    if (!lead || typeof lead !== "object" || Array.isArray(lead)) {
      fail("INVALID_METRIC", "leads[" + index + "] must be an object");
    }
    const id = String(lead.id || "").trim();
    if (!id || id.length > 128) fail("INVALID_METRIC", "leads[" + index + "].id is required and must be at most 128 characters");
    if (ids.has(id)) fail("DUPLICATE_LEAD_ID", "Duplicate lead id: " + id);
    ids.add(id);

    const createdMs = parseTimestamp(lead.createdAt, "leads[" + index + "].createdAt");
    const responseMs = parseTimestamp(lead.firstResponseAt, "leads[" + index + "].firstResponseAt", { optional: true });
    if (responseMs !== null && responseMs < createdMs) {
      fail("INVALID_METRIC", "leads[" + index + "].firstResponseAt cannot precede createdAt");
    }
    const outcome = String(lead.outcome || "").trim().toLowerCase();
    if (!OUTCOMES.has(outcome)) fail("INVALID_METRIC", "leads[" + index + "].outcome must be open, won, or lost");
    const responseMinutes = responseMs === null ? null : (responseMs - createdMs) / 60000;
    const group = responseMinutes === null ? "noRecordedResponse" : responseMinutes <= slaMinutes ? "withinSla" : "late";
    return { id, outcome, responseMinutes, group };
  });

  const withinSla = normalized.filter((lead) => lead.group === "withinSla");
  const late = normalized.filter((lead) => lead.group === "late");
  const noRecordedResponse = normalized.filter((lead) => lead.group === "noRecordedResponse");
  const respondedMinutes = normalized.filter((lead) => lead.responseMinutes !== null).map((lead) => lead.responseMinutes).sort((a, b) => a - b);
  const median = respondedMinutes.length === 0 ? null : respondedMinutes.length % 2
    ? respondedMinutes[(respondedMinutes.length - 1) / 2]
    : (respondedMinutes[respondedMinutes.length / 2 - 1] + respondedMinutes[respondedMinutes.length / 2]) / 2;
  const p90 = respondedMinutes.length === 0 ? null : respondedMinutes[Math.ceil(respondedMinutes.length * 0.9) - 1];

  const noRecordedResponseUnconverted = noRecordedResponse.filter((lead) => lead.outcome !== "won").length;
  const lateUnconverted = late.filter((lead) => lead.outcome !== "won").length;
  const atRiskCount = noRecordedResponseUnconverted + lateUnconverted;
  let scenario = null;
  if (assumptions) {
    const illustrativeGrossProfit = atRiskCount * assumptions.recoveryRatePct / 100 * assumptions.grossProfitPerWin;
    scenario = {
      atRiskLeadCount: atRiskCount,
      recoveryRatePct: assumptions.recoveryRatePct,
      grossProfitPerWin: assumptions.grossProfitPerWin,
      illustrativeGrossProfitIfAssumptionHolds: round(illustrativeGrossProfit),
      pilotFee: round(assumptions.pilotFee),
      operatingCost: round(assumptions.operatingCost),
      illustrativeNetContributionAfterStatedCosts: round(illustrativeGrossProfit - assumptions.pilotFee - assumptions.operatingCost),
      measurementDays: assumptions.measurementDays,
      isForecast: false
    };
  }

  return {
    schemaVersion: "samurai.revenue-recovery.audit.v1",
    currency,
    slaMinutes,
    summary: {
      totalLeads: normalized.length,
      recordedFirstResponses: respondedMinutes.length,
      noRecordedFirstResponse: noRecordedResponse.length,
      responsesWithinSla: withinSla.length,
      responsesAfterSla: late.length,
      recordedResponseRatePct: percent(respondedMinutes.length, normalized.length),
      slaCompliancePct: percent(withinSla.length, normalized.length),
      medianRecordedResponseMinutes: median === null ? null : round(median),
      p90RecordedResponseMinutes: p90 === null ? null : round(p90)
    },
    outcomesByResponseGroup: {
      withinSla: summarizeGroup(withinSla),
      late: summarizeGroup(late),
      noRecordedResponse: summarizeGroup(noRecordedResponse)
    },
    leakageReview: {
      unconvertedLeadsWithNoRecordedResponse: noRecordedResponseUnconverted,
      lateResponseLeadsNotWon: lateUnconverted,
      totalUnconvertedLeadsWithPotentialResponseGap: atRiskCount,
      interpretation: "Potential response gap only; missing timestamps can mean missing logging, and response speed alone does not prove a lead was lost."
    },
    illustrativeScenario: scenario,
    dataQuality: {
      wonWithoutRecordedFirstResponse: noRecordedResponse.filter((lead) => lead.outcome === "won").length
    },
    limitations: [
      "This report describes only the supplied cohort; missing timestamps are not proof that no contact happened.",
      "Response-time and win-rate associations do not prove causation.",
      "The illustrative scenario uses only operator-supplied assumptions and is not a prediction, revenue guarantee, or independently verified ROI.",
      "No names, emails, messages, or other direct identifiers are needed; use pseudonymous lead IDs.",
      "No data is persisted and no outreach is sent by this module."
    ]
  };
}

module.exports = { auditRevenueLeakage, parseCsvLeads, MAX_LEADS, MAX_CSV_CHARS };
