"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isPublicAddress, validateTarget, resolvePublic, fetchPublicPage, fetchRobotsPolicy, isAllowedByRobots } = require("./crawler");

test("blocks private, loopback, link-local and reserved IPv4 targets", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.2", "169.254.169.254", "100.64.0.1", "224.0.0.1"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
});

test("blocks non-global IPv6 and accepts global unicast", () => {
  for (const ip of ["::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("rejects unsafe URL forms", () => {
  for (const url of ["file:///etc/passwd", "http://127.0.0.1/", "http://localhost/", "http://user:pass@example.com/", "http://example.com:8080/"]) {
    assert.throws(() => validateTarget(url));
  }
});

test("rejects hostnames with any private DNS answer", async () => {
  await assert.rejects(
    resolvePublic("example.com", async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.2", family: 4 }]),
    { code: "DNS_PRIVATE_ADDRESS" }
  );
});

test("re-resolves and validates every redirect target", async () => {
  const lookedUp = [];
  const requested = [];
  const lookup = async host => {
    lookedUp.push(host);
    return [{ address: host === "public.example" ? "8.8.8.8" : "127.0.0.1", family: 4 }];
  };
  const request = async url => {
    requested.push(url.hostname);
    return { statusCode: 302, headers: { location: "http://private.example/" }, body: Buffer.alloc(0) };
  };
  await assert.rejects(fetchPublicPage("https://public.example/", { lookup, request }), { code: "DNS_PRIVATE_ADDRESS" });
  assert.deepEqual(lookedUp, ["public.example", "private.example"]);
  assert.deepEqual(requested, ["public.example"]);
});

test("returns bounded HTML only", async () => {
  const result = await fetchPublicPage("https://public.example/", {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    request: async () => ({ statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: Buffer.from("<title>ok</title>") })
  });
  assert.equal(result.body, "<title>ok</title>");
  assert.equal(result.bytes, 17);
});


test("robots policy blocks disallowed paths and honors the most specific allow rule", () => {
  const policy = "User-agent: *\nDisallow: /private\nAllow: /private/public\n";
  assert.equal(isAllowedByRobots(policy, "https://example.com/private/report"), false);
  assert.equal(isAllowedByRobots(policy, "https://example.com/private/public/report"), true);
  assert.equal(isAllowedByRobots(policy, "https://example.com/about"), true);
});

test("robots wildcard and end anchor are applied", () => {
  const policy = "User-agent: SAMURAI-EVOLUTION\nDisallow: /*?draft=true$\n";
  assert.equal(isAllowedByRobots(policy, "https://example.com/page?draft=true"), false);
  assert.equal(isAllowedByRobots(policy, "https://example.com/page?draft=true&x=1"), true);
});

test("robots policy fetch fails closed for 403 and permits a missing robots.txt", async () => {
  const lookup = async () => [{ address: "8.8.8.8", family: 4 }];
  const forbidden = await fetchRobotsPolicy("https://public.example", {
    lookup, request: async () => ({ statusCode: 403, headers: {}, body: Buffer.alloc(0) })
  });
  assert.equal(isAllowedByRobots(forbidden.text, "https://public.example/"), false);
  const missing = await fetchRobotsPolicy("https://public.example", {
    lookup, request: async () => ({ statusCode: 404, headers: {}, body: Buffer.alloc(0) })
  });
  assert.equal(isAllowedByRobots(missing.text, "https://public.example/"), true);
});
