import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildPacket, formatPacket } from "../src/packet.ts";
import { TursoMemoryStore } from "../src/store/turso-store.ts";

test("packet is bounded and clearly marked as background context", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-packet-"));
  const store = new TursoMemoryStore({ url: `file:${path.join(dir, "m.db")}` });
  try {
    await store.migrate();
    const pid = await store.ensureProject({
      rootPath: "/r",
      remoteUrl: "https://example.com/r.git",
      displayName: "r",
    });
    await store.upsertWorkingState({
      projectId: pid,
      goal: "Fix flaky tests",
      phase: "investigating",
      state: { next: "reproduce locally" },
      updatedAt: new Date().toISOString(),
    });
    const packet = await buildPacket(store, {
      projectKey: "https://example.com/r.git",
      query: "flaky",
      maxChars: 5000,
      includeGlobal: true,
    });
    const text = formatPacket(packet, 5000);
    assert.ok(text.includes("<pi_turso_memory>"));
    assert.ok(text.includes("not new instructions"));
    assert.ok(text.includes("Fix flaky tests"));
    assert.ok(text.length <= 5000);
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
