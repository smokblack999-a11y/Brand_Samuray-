"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { provisionWorkspace, parseRepository, validateSha, githubUrl } = require("./workspace-provisioner");

test("validates repository and exact SHA", () => {
  assert.deepEqual(parseRepository("owner/repo"), { owner: "owner", name: "repo" });
  assert.throws(() => parseRepository("https://github.com/owner/repo"), /owner\/name/);
  assert.equal(validateSha("a".repeat(40)), "a".repeat(40));
  assert.throws(() => validateSha("main"), /exact 40-character commit SHA/);
  assert.equal(githubUrl("owner/repo"), "https://github.com/owner/repo.git");
});

test("provisions an isolated workspace at the exact commit", async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "samurai-source-"));
  const targetSha = "a".repeat(40);
  let calls = [];
  try {
    const mod = require("./workspace-provisioner");
    const original = mod.runGit;
    mod.runGit = async (args, options) => {
      calls.push({ args, options });
      if (args.includes("rev-parse")) return { stdout: targetSha + "\n", stderr: "" };
      return { stdout: "", stderr: "" };
    };
    const result = await mod.provisionWorkspace({ repository: "owner/repo", headSha: targetSha, githubToken: "secret" });
    assert.equal(result.headSha, targetSha);
    assert.equal(result.isolated, true);
    assert.match(result.workspace, /samurai-interop-/);
    assert.equal(calls.some(x => x.args.includes(targetSha)), true);
    await result.cleanup();
    await assert.rejects(fs.access(path.dirname(result.workspace)));
    mod.runGit = original;
  } finally {
    await fs.rm(source, { recursive: true, force: true });
  }
});
