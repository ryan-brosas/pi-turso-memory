import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "../src/redact.ts";

test("clean text stays clean", () => {
  const r = redactSecrets("ran pnpm run check and all tests passed");
  assert.equal(r.status, "clean");
  assert.equal(r.text, "ran pnpm run check and all tests passed");
});

test("openai key is redacted", () => {
  const r = redactSecrets("used sk-abc1234567890abcdef1234567890 to call the api");
  assert.equal(r.status, "redacted");
  assert.ok(!r.text.includes("sk-abc"));
  assert.ok(r.text.includes("[REDACTED:openai-key]"));
  assert.ok(r.reasons.includes("openai-key"));
});

test("private key block is blocked", () => {
  const pem = "-----BEGIN PRIVATE KEY-----\nabcdefghijklmnop\n-----END PRIVATE KEY-----";
  const r = redactSecrets(pem);
  assert.equal(r.status, "blocked");
  assert.ok(!r.text.includes("abcdefghijklmnop"));
  assert.ok(r.reasons.includes("private-key"));
});

test("multiple secret classes are all collected", () => {
  const r = redactSecrets("token=ghp_1234567890abcdefghijklmnop and sk-1234567890abcdef1234567890abc");
  assert.ok(r.reasons.includes("github-token"));
  assert.ok(r.reasons.includes("openai-key"));
});
