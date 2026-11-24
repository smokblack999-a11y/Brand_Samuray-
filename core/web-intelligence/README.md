# SAMURAI Web Intelligence — local MVP

Status: isolated foundation; not connected to SAMURAI Core or a browser yet.

## Scope

This module provides a local evidence inbox and deterministic supplier-offer normalization. It does not crawl websites, make network requests, execute page scripts, submit forms, or call hosted AI APIs.

## Data flow

1. A future browser adapter captures a user-selected text fragment and its HTTP(S) source URL.
2. The module normalizes the evidence and computes a SHA-256 content fingerprint.
3. The local store deduplicates records and retains a bounded number of entries.
4. Supplier offers can be compared by currency and price.
5. Every extracted offer remains marked `unverified` until a separate verification step records independent evidence.

## Local usage

```js
const path = require("node:path");
const { createLocalStore } = require("./store");
const { compareSupplierOffers } = require("./index");

const store = createLocalStore({
  filePath: path.join(process.env.HOME, ".samurai", "web-intelligence", "evidence.json"),
  maxRecords: 200
});

const result = store.add({
  title: "Supplier product page",
  sourceUrl: "https://supplier.example/catalog",
  selectedText: "User-selected offer text",
  offer: {
    supplier: "Example Supply",
    product: "Industrial fasteners",
    price: 12.5,
    currency: "USD",
    moq: 10,
    leadTimeDays: 7
  }
});

console.log({ duplicate: result.duplicate, count: result.count });
console.log(compareSupplierOffers(store.list()));
```

## Test

From the repository root:

```bash
cd core
node --test web-intelligence/*.test.js
```

## Security boundaries

- Only credential-free HTTP and HTTPS URLs are accepted.
- Page text is stored as inert text. It is never interpreted as code or instructions.
- No cookies, authorization headers, full HTML, or browser storage are collected.
- Writes use a temporary file and atomic rename; the file is created with owner-only permissions where supported.
- Corrupt or unknown-version stores fail closed and are not overwritten.
- Local storage permissions are not encryption. Device-level encryption and backups remain the operator's responsibility.
- Supplier data is unverified by default. Price comparisons are meaningful only within the same currency and comparable product/quantity/terms.

## Not included yet

- ScriptCat userscript (browser not selected/verified).
- AI extraction or autonomous browsing.
- SAMURAI Core routes or CRM writes.
- Cryptographic signatures or immutable external ledger.
- Automatic supplier outreach or form submission.
