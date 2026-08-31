const fs = require("fs");
const crypto = require("crypto");
const { keccak256, getBytes } = require("ethers");

const file = process.argv[2];

if (!file) {
  console.error("Usage: node verify-keystore.js <keystore.json>");
  process.exit(1);
}

let wallet;

try {
  wallet = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.error("INVALID JSON:", e.message);
  process.exit(1);
}

function fail(msg) {
  console.error("INVALID KEYSTORE:", msg);
  process.exit(1);
}

if (wallet.version !== 3)
  fail("version must be 3");

if (!wallet.crypto)
  fail("missing crypto");

const c = wallet.crypto;
const k = c.kdfparams;

if (c.kdf !== "scrypt")
  fail("expected scrypt");

if (c.cipher !== "aes-128-ctr")
  fail("expected aes-128-ctr");

if (!k || k.dklen !== 32)
  fail("invalid dklen");

if (!Number.isInteger(k.n) || !Number.isInteger(k.r) || !Number.isInteger(k.p))
  fail("invalid scrypt parameters");

const ciphertext = Buffer.from(c.ciphertext, "hex");
const salt = Buffer.from(k.salt, "hex");
const iv = Buffer.from(c.cipherparams.iv, "hex");
const expectedMac = c.mac.toLowerCase();

if (iv.length !== 16)
  fail("IV must be 16 bytes");

if (expectedMac.length !== 64)
  fail("MAC must be 32 bytes");

console.log("================================");
console.log("      WEB3 KEYSTORE VERIFY");
console.log("================================");
console.log("Version :", wallet.version);
console.log("KDF     :", c.kdf);
console.log("Cipher  :", c.cipher);
console.log("scrypt N:", k.n);
console.log("scrypt r:", k.r);
console.log("scrypt p:", k.p);
console.log("DK len  :", k.dklen);
console.log("Ciphertext:", ciphertext.length, "bytes");
console.log("--------------------------------");

process.stdout.write("Password: ");

const stdin = process.stdin;
stdin.setRawMode(true);
stdin.resume();
stdin.setEncoding("utf8");

let password = "";

stdin.on("data", (ch) => {
  if (ch === "\n" || ch === "\r") {
    stdin.setRawMode(false);
    stdin.pause();

    console.log("\nDeriving key...");

    try {
      const dk = crypto.scryptSync(
        Buffer.from(password, "utf8"),
        salt,
        32,
        {
          N: k.n,
          r: k.r,
          p: k.p,
          maxmem: Math.max(
            128 * k.n * k.r + 1024 * 1024,
            256 * 1024 * 1024
          )
        }
      );

      /*
       * Web3 Secret Storage V3:
       * MAC = Keccak256(DK[16..31] || ciphertext)
       */

      const macInput = Buffer.concat([
        dk.subarray(16, 32),
        ciphertext
      ]);

      const actualMac = keccak256(macInput).slice(2).toLowerCase();

      const ok =
        actualMac.length === expectedMac.length &&
        crypto.timingSafeEqual(
          Buffer.from(actualMac, "hex"),
          Buffer.from(expectedMac, "hex")
        );

      if (!ok) {
        console.log("RESULT: WRONG PASSWORD");
        process.exit(2);
      }

      console.log("RESULT: PASSWORD OK");
      console.log("MAC: VALID");
      console.log("Encryption key: VALID");
      console.log("--------------------------------");
      console.log("The keystore password is correct.");
      console.log("Secret material was NOT printed.");
      console.log("--------------------------------");

      /*
       * Deliberately do not decrypt or print
       * mnemonic/private key.
       */

      dk.fill(0);
      password = "";

    } catch (err) {
      console.error("ERROR:", err.message);
      process.exit(3);
    }
  } else if (ch === "\u0003") {
    console.log("\nCancelled.");
    process.exit(130);
  } else {
    password += ch;
  }
});
