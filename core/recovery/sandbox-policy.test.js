"use strict";
const test=require("node:test"),assert=require("node:assert/strict");const {sandboxConfig}=require("./sandbox-policy");
test("production policy defaults to network isolation",()=>{const c=sandboxConfig();assert.equal(c.network,"none");assert.equal(c.readOnlyRootFs,true);assert.deepEqual(c.capDrop,["ALL"]);});
