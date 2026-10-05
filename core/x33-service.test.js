"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const x33=require("./x33-service");

test("X33 stays disabled unless explicitly enabled",()=>{
  const old=process.env.X33_ENABLED;
  delete process.env.X33_ENABLED;
  assert.equal(x33.enabled(),false);
  if(old===undefined)delete process.env.X33_ENABLED;else process.env.X33_ENABLED=old;
});

test("micro-KZT conversion is exact",()=>{
  assert.equal(x33.microKzt(1.25),1250000n);
  assert.equal(x33.microKzt(0),0n);
  assert.throws(()=>x33.microKzt(-1),/non-negative/);
});

test("enabled X33 fails closed when database is missing",()=>{
  const oldEnabled=process.env.X33_ENABLED;
  const oldUrl=process.env.X33_DATABASE_URL;
  process.env.X33_ENABLED="true";
  delete process.env.X33_DATABASE_URL;
  delete process.env.DATABASE_URL;
  assert.throws(()=>x33.getEngine(),e=>e&&e.code==="X33_DATABASE_REQUIRED");
  if(oldEnabled===undefined)delete process.env.X33_ENABLED;else process.env.X33_ENABLED=oldEnabled;
  if(oldUrl===undefined)delete process.env.X33_DATABASE_URL;else process.env.X33_DATABASE_URL=oldUrl;
});
