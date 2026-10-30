// Generate an access key pair for ACCESS_KEYS.
//   npm run genkey <name>
// Prints `name:troll_<26 base32 chars>` (128 bits of entropy) to paste into
// the Vercel env var. The key is printed ONCE and stored nowhere.

import { randomBytes } from "node:crypto";

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

const name = process.argv[2];
if (!name || !/^[a-zA-Z0-9_-]{1,32}$/.test(name)) {
  console.error("Usage: npm run genkey <name>   (letters/digits/_/-, max 32 chars)");
  process.exit(1);
}

const key = `troll_${base32(randomBytes(16))}`;

console.log(`${name}:${key}`);
console.log("");
console.log("Give this person their own Vercel env var (paste only the troll_… part):");
console.log(`  vercel env add ACCESS_KEY_${name.toUpperCase()} production`);
console.log("(or append name:key to the ACCESS_KEYS list). Redeploy, then send them:");
console.log("  https://madtrolden-mcp.vercel.app/plan#k=<the troll_… key>");
console.log("Give the key to exactly one person. It will not be shown again.");
