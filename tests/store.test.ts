import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createClient } from "@libsql/client";
import { TursoMemoryStore } from "../src/store/turso-store.ts";
import type { MemoryCandidateInput } from "../src/store/types.ts";

async function withStore<T>(fn: (store: TursoMemoryStore, db: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tm-store-"));
  const db = path.join(dir, "memory.db");
  const store = new TursoMemoryStore({ url: `file:${db}` });
  await store.migrate();
  try {
    return await fn(store, db);
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const identity = {
  rootPath: "/repo/pi-turso-memory",
  remoteUrl: "https://github.com/example/pi-turso-memory.git",
  displayName: "pi-turso-memory",
};

const candidate: MemoryCandidateInput = {
  ownerKey: "https://github.com/example/pi-turso-memory.git",
  projectId: "prj_x",
  kind: "decision",
  scope: "project",
  title: "Use the dialect adapter",
  content: "Keep lexical search behind a dialect adapter so FTS5 and Turso FTS both work.",
  tags: ["search"],
  confidence: 0.8,
  importance: 0.7,
  evidenceKind: "tool_observed",
  filePaths: ["src/store/search.ts"],
};

test("migrate creates schema and reports health", async () => {
  await withStore(async (store) => {
    const health = await store.health();
    assert.equal(health.ok, true);
    assert.equal(health.capabilities.basicSql, true);
    const stats = await store.stats();
    assert.equal(stats.memory_items, 0);
  });
});

test("project, session, and progress events persist", async () => {
  await withStore(async (store) => {
    const pid = await store.ensureProject(identity);
    const sid = await store.openSession(pid, { branchName: "main", gitHead: "abc1234" });
    await store.appendProgress({
      id: "evt_1",
      projectId: pid,
      sessionId: sid,
      kind: "failure",
      summary: "pnpm run check failed: type error in store",
      toolName: "bash",
      exitCode: 2,
      filePaths: [],
      metadata: {},
      occurredAt: new Date().toISOString(),
    });
    await store.closeSession(sid, "shutdown");
    const stats = await store.stats();
    assert.equal(stats.projects, 1);
    assert.equal(stats.sessions, 1);
    assert.equal(stats.progress_events, 1);
  });
});

test("secrets are redacted before persistence", async () => {
  await withStore(async (store) => {
    const pid = await store.ensureProject(identity);
    await store.appendProgress({
      id: "evt_secret",
      projectId: pid,
      kind: "progress",
      summary: "called api with sk-abc1234567890abcdef1234567890 and it worked",
      filePaths: [],
      metadata: {},
      occurredAt: new Date().toISOString(),
    });
    const packet = await store.getResumePacket(identity.remoteUrl!);
    const evt = packet.recentEvents.find((e) => e.id === "evt_secret");
    assert.ok(evt);
    assert.ok(!evt.summary.includes("sk-abc"));
    assert.ok(evt.summary.includes("[REDACTED:openai-key]"));
  });
});

test("candidate lifecycle: create, search exclusion, promote, search inclusion", async () => {
  await withStore(async (store) => {
    const pid = await store.ensureProject(identity);
    const id = await store.createCandidate({ ...candidate, projectId: pid });
    let hits = await store.search({ query: "dialect", scope: "current-project" }, identity.remoteUrl!);
    assert.equal(hits.length, 0, "candidates must not surface in normal search");
    await store.promote(id);
    hits = await store.search({ query: "dialect", scope: "current-project" }, identity.remoteUrl!);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.id, id);
    assert.equal(hits[0]!.kind, "decision");
    await store.reject(id);
    hits = await store.search({ query: "dialect", scope: "current-project" }, identity.remoteUrl!);
    assert.equal(hits.length, 0);
  });
});

test("project recall excludes other projects and can exclude globals", async () => {
  await withStore(async (store) => {
    const pid = await store.ensureProject(identity);
    const otherIdentity = {
      rootPath: "/repo/other-project",
      remoteUrl: "https://github.com/example/other-project.git",
      displayName: "other-project",
    };
    const otherPid = await store.ensureProject(otherIdentity);

    const projectId = await store.createCandidate({
      ...candidate,
      ownerKey: identity.remoteUrl!,
      projectId: pid,
      title: "Current project scope marker",
      content: "current project scope marker",
    });
    const otherId = await store.createCandidate({
      ...candidate,
      ownerKey: otherIdentity.remoteUrl!,
      projectId: otherPid,
      title: "Other project scope marker",
      content: "other project scope marker",
    });
    const globalId = await store.createCandidate({
      ...candidate,
      ownerKey: "global",
      projectId: undefined,
      scope: "global",
      title: "Global scope marker",
      content: "global scope marker",
    });
    await store.promote(projectId);
    await store.promote(otherId);
    await store.promote(globalId);

    const projectOnly = await store.search(
      { query: "scope marker", scope: "current-project", includeGlobal: false },
      identity.remoteUrl!,
    );
    assert.deepEqual(projectOnly.map((hit) => hit.id), [projectId]);

    const withGlobal = await store.search(
      { query: "scope marker", scope: "current-project", includeGlobal: true },
      identity.remoteUrl!,
    );
    assert.ok(withGlobal.some((hit) => hit.id === projectId));
    assert.ok(withGlobal.some((hit) => hit.id === globalId));
    assert.ok(!withGlobal.some((hit) => hit.id === otherId));

    const packet = await store.getResumePacket(identity.remoteUrl!, { includeGlobal: false });
    assert.ok(packet.hits.some((hit) => hit.id === projectId));
    assert.ok(!packet.hits.some((hit) => hit.id === globalId));
  });
});

test("working state survives upsert and resume packet", async () => {
  await withStore(async (store) => {
    const pid = await store.ensureProject(identity);
    await store.upsertWorkingState({
      projectId: pid,
      goal: "Ship the memory plugin",
      phase: "validating",
      state: { next: "run npm run check" },
      updatedAt: new Date().toISOString(),
    });
    const packet = await store.getResumePacket(identity.remoteUrl!);
    assert.equal(packet.workingState?.goal, "Ship the memory plugin");
    assert.equal(packet.workingState?.phase, "validating");
  });
});


test("FTS backfills rows that predate the virtual table", async (t) => {
  await withStore(async (store, db) => {
    const health = await store.health();
    if (!health.capabilities.fts5) {
      t.skip("libsql without FTS5 support");
      return;
    }
    const pid = await store.ensureProject(identity);
    await store.close();
    const raw = createClient({ url: `file:${db}` });
    await raw.execute({
      sql: `INSERT INTO memory_items (id, owner_key, project_id, kind, scope, status, title, content, tags_json, confidence, importance, evidence_kind, file_paths_json, content_hash, created_at, updated_at)
            VALUES (?, ?, ?, 'decision', 'project', 'active', ?, ?, '[]', 0.5, 0.5, 'tool_observed', '[]', ?, ?, ?)`,
      args: ["mem_legacy", identity.remoteUrl, pid, "Legacy row", "pre-existing banana is yellow", "hash_legacy", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z"],
    });
    raw.close();
    const reopened = new TursoMemoryStore({ url: `file:${db}` });
    await reopened.migrate();
    try {
      const hits = await reopened.search(
        { query: "banana yellow", scope: "current-project" },
        identity.remoteUrl!,
      );
      assert.deepEqual(hits.map((h) => h.id), ["mem_legacy"]);
    } finally {
      await reopened.close();
    }
  });
});

test("FTS retrieves separated query tokens", async (t) => {
  await withStore(async (store) => {
    const health = await store.health();
    if (!health.capabilities.fts5) {
      t.skip("libsql without FTS5 support");
      return;
    }
    const pid = await store.ensureProject(identity);
    const id = await store.createCandidate({
      ...candidate,
      projectId: pid,
      title: "Banana color",
      content: "the banana is yellow",
    });
    await store.promote(id);

    const hits = await store.search(
      { query: "banana yellow", scope: "current-project" },
      identity.remoteUrl!,
    );
    assert.deepEqual(hits.map((hit) => hit.id), [id], "FTS matches query tokens across words");
  });
});

test("duplicate events are idempotent via content hash", async () => {
  await withStore(async (store) => {
    const pid = await store.ensureProject(identity);
    const evt = {
      id: "evt_dup",
      projectId: pid,
      kind: "progress" as const,
      summary: "same summary",
      filePaths: [] as string[],
      metadata: {} as Record<string, unknown>,
      occurredAt: "2026-08-11T12:00:00Z",
    };
    await store.appendProgress(evt);
    await store.appendProgress(evt);
    const stats = await store.stats();
    assert.equal(stats.progress_events, 1);
  });
});
