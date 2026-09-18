"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {validatePatch,applyPatch}=require("./patch-executor");

test("rejects path traversal",()=>assert.throws(()=>validatePatch({files:[{path:"../x",content:"bad"}]})));
test("rejects git metadata writes",()=>assert.throws(()=>validatePatch({files:[{path:".git/config",content:"bad"}]})));
test("applies bounded patch",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"x10-patch-test-"));
  const r=applyPatch(dir,{files:[{path:"src/fix.js",content:"module.exports=1;"}]},{maxFilesChanged:2});
  assert.deepEqual(r.filesChanged,["src/fix.js"]);
  assert.equal(fs.readFileSync(path.join(dir,"src/fix.js"),"utf8"),"module.exports=1;");
});
