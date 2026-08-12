import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "../src/config.ts";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tm-config-"));
}

const savedEnv = { ...process.env };

test.afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in savedEnv)) delete process.env[k];
  }
  Object.assign(process.env, savedEnv);
});

test("defaults fall back to a file database under the agent dir", () => {
  const agent = tmp();
  const cfg = loadConfig(tmp(), agent);
  assert.equal(cfg.databaseUrl, "file:" + path.join(agent, "turso-memory.db"));
  assert.equal(cfg.autoCapture, "candidates");
  assert.equal(cfg.autoRecall, true);
});

test("environment URL overrides settings", () => {
  process.env.TURSO_DATABASE_URL = "http://127.0.0.1:8080";
  process.env.TURSO_AUTH_TOKEN = "tok";
  const cfg = loadConfig(tmp(), tmp());
  assert.equal(cfg.databaseUrl, "http://127.0.0.1:8080");
  assert.equal(cfg.authToken, "tok");
});

test("project settings override global settings", () => {
  const agent = tmp();
  const cwd = tmp();
  fs.writeFileSync(
    path.join(agent, "settings.json"),
    JSON.stringify({ "turso-memory": { autoRecall: true } }),
  );
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".pi", "settings.json"),
    JSON.stringify({ "turso-memory": { autoRecall: false, maxInjectedChars: 500 } }),
  );
  const cfg = loadConfig(cwd, agent);
  assert.equal(cfg.autoRecall, false);
  assert.equal(cfg.maxInjectedChars, 500);
});

test("tilde in fallbackFile is expanded", () => {
  const cfg = loadConfig(tmp(), tmp());
  assert.ok(!cfg.memoryDir.startsWith("~"));
});
