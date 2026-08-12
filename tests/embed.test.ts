import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createEmbedder, embedderFromConfig } from "../src/embed.ts";
import { loadConfig } from "../src/config.ts";

const savedEnv = { ...process.env };

test.afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in savedEnv)) delete process.env[k];
  }
  Object.assign(process.env, savedEnv);
});

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tm-embed-"));
}

function cfg(extra: Record<string, unknown>): ReturnType<typeof loadConfig> {
  const agent = tmp();
  fs.writeFileSync(
    path.join(agent, "settings.json"),
    JSON.stringify({ "turso-memory": extra }),
  );
  return loadConfig(tmp(), agent);
}

test("embedderFromConfig: off mode never builds an embedder", () => {
  process.env.VOYAGE_API_KEY = "voyage-key";
  assert.equal(embedderFromConfig(cfg({ embeddingMode: "off" })), undefined);
});

test("embedderFromConfig: auto mode requires a key", () => {
  delete process.env.VOYAGE_API_KEY;
  assert.equal(embedderFromConfig(cfg({ embeddingMode: "auto" })), undefined);
  process.env.VOYAGE_API_KEY = "voyage-key";
  const h = embedderFromConfig(cfg({ embeddingMode: "auto" }));
  assert.ok(h);
  assert.equal(h!.model, "voyage-4-lite");
});

test("embedderFromConfig: on mode uses the configured key env", () => {
  process.env.MY_EMBED_KEY = "k";
  const h = embedderFromConfig(
    cfg({
      embeddingMode: "on",
      embeddingApiKeyEnv: "MY_EMBED_KEY",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
    }),
  );
  assert.ok(h);
  assert.equal(h!.model, "text-embedding-3-small");
});

test("custom keyless endpoint retries transient failures and caches a single query", async () => {
  delete process.env.LOCAL_EMBED_KEY;
  process.env.OPENAI_API_KEY = "must-not-reach-local-gateway";
  const handle = embedderFromConfig(
    cfg({
      embeddingMode: "on",
      embeddingProvider: "openai",
      embeddingModel: "local-embed",
      embeddingBaseUrl: "http://127.0.0.1:11434/v1",
      embeddingApiKeyEnv: "",
    }),
  );
  assert.ok(handle, "a custom endpoint may intentionally be keyless");

  const originalFetch = globalThis.fetch;
  let calls = 0;
  let authorization: string | null = "not-called";
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    authorization = new Headers(init?.headers).get("authorization");
    if (calls === 1) return new Response("busy", { status: 429 });
    return new Response(JSON.stringify({ data: [{ embedding: [0.5, 0.25] }] }), { status: 200 });
  };
  try {
    assert.deepEqual(await handle!.embed(["repeatable query"]), [[0.5, 0.25]]);
    assert.deepEqual(await handle!.embed(["repeatable query"]), [[0.5, 0.25]]);
    assert.equal(calls, 2, "one retry, then the successful query is cached");
    assert.equal(authorization, null, "keyless endpoints must not receive a Bearer header");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("embedder does not retry permanent HTTP failures", async () => {
  const embed = createEmbedder({ provider: "voyage", model: "test", apiKey: "test-key" });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("bad key", { status: 401 });
  };
  try {
    await assert.rejects(embed(["query"]), /embedding API 401/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
