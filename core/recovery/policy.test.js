"use strict";
const test=require("node:test"),assert=require("node:assert/strict");const {evaluatePatch}=require("./policy");
test("blocks destructive commands",()=>assert.equal(evaluatePatch([{path:"fix.js",content:"rm -rf /"}]).decision,"blocked"));
test("routes workflow changes to human review",()=>assert.equal(evaluatePatch([{path:".github/workflows/a.yml",content:"x"}]).decision,"human_review"));
test("allows bounded ordinary source patch",()=>assert.equal(evaluatePatch([{path:"src/a.js",content:"const x=1;"}]).allow,true));
