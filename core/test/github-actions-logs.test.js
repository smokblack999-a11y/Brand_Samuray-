"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { deflateRawSync } = require("node:zlib");
const { fetchFailureLogs, extractZipText, redactSecrets } = require("../github-actions-logs");

function makeZip(name, text) {
  const filename = Buffer.from(name);
  const source = Buffer.from(text);
  const compressed = deflateRawSync(source);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(source.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const localRecord = Buffer.concat([local, filename, compressed]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(source.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const centralRecord = Buffer.concat([central, filename]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRecord.length, 12);
  eocd.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, eocd]);
}

test("log redaction masks common API credentials before AI analysis", () => {
  const input = [
    "token=ghp_abcdefghijklmnopqrstuvwxyz1234567890",
    `OPENAI_API_KEY=${["sk", "proj", "abcdefghijklmnopqrstuvwxyz1234567890"].join("-")}`,
    "Authorization: Bearer very-secret-token",
    "password=hunter2"
  ].join("\\n");
  const result = redactSecrets(input);
  assert.doesNotMatch(result, /ghp_abcdefghijklmnopqrstuvwxyz/);
  assert.equal(result.includes(["sk", "proj", "abcdefghijklmnopqrstuvwxyz"].join("-")), false);
  assert.doesNotMatch(result, /Bearer very-secret-token/);
  assert.doesNotMatch(result, /password=hunter2/);
  assert.match(result, /REDACTED/);
});

test("ZIP parser extracts text logs from a bounded GitHub archive", () => {
  const logs = extractZipText(makeZip("failed-job.txt", "Error: module not found"));
  assert.match(logs, /Error: module not found/);
  assert.match(logs, /failed-job.txt/);
});

test("ZIP parser rejects malformed archives", () => {
  assert.throws(() => extractZipText(Buffer.from("not a zip")), { code: "GITHUB_LOG_ARCHIVE_INVALID" });
});

test("log fetch refuses to call GitHub without a token", async () => {
  await assert.rejects(
    fetchFailureLogs({ id: "123", repository: "acme/service" }, { token: "" }),
    { code: "GITHUB_TOKEN_NOT_CONFIGURED" }
  );
});

test("fetchFailureLogs requests failed job logs and returns extracted text", async () => {
  const archive = makeZip("job-log.txt", "TypeError: cannot read property\\npassword=hunter2");
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.endsWith("/jobs?per_page=100")) {
      return { ok: true, json: async () => ({ jobs: [
        { id: 55, name: "unit tests", conclusion: "failure" },
        { id: 56, name: "build", conclusion: "success" }
      ] }) };
    }
    return {
      ok: true,
      arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength)
    };
  };
  const logs = await fetchFailureLogs(
    { id: "123", repository: "acme/service" },
    { token: "test-token", fetch: fakeFetch }
  );
  assert.match(logs, /TypeError: cannot read property/);\n  assert.doesNotMatch(logs, /password=hunter2/);\n  assert.match(logs, /password=\\[REDACTED\\]/);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /\/actions\/jobs\/55\/logs$/);
});
