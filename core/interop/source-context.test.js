"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readSourceContext, formatSourceContext, validateFiles } = require("./source-context");

test("reads only bounded changed-file context", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "samurai-context-"));
  try {
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "app.js"), "const answer = 42;\n");
    const files = await readSourceContext(root, ["src/app.js"]);
    assert.equal(files[0].content, "const answer = 42;\n");
    assert.match(formatSourceContext(files), /FILE: src\/app\.js/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects unsafe source paths", () => {
  assert.throws(() => validateFiles(["../secret"]), /UNSAFE_SOURCE_PATH/);
  assert.throws(() => validateFiles([".env"]), /UNSAFE_SOURCE_PATH/);
  assert.throws(() => validateFiles([".github/workflows/ci.yml"]), /UNSAFE_SOURCE_PATH/);
});
