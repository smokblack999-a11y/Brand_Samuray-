"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{buildPrRequest}=require("./github-pr");
test("PR adapter request contains no credentials",()=>{const request=buildPrRequest({source:{repo:"o/r",sha:"abc"}},{branch:"recovery/abc",title:"fix CI",body:"verified",files:["a.js"]});assert.deepEqual(Object.keys(request).sort(),["baseSha","body","branch","files","repo","title"])});
test("PR adapter rejects incomplete patch metadata",()=>{assert.throws(()=>buildPrRequest({source:{repo:"o/r"}},{}))});
