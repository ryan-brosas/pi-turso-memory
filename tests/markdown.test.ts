import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateFile,
  parseCandidate,
  serializeCandidate,
  type CandidateMeta,
} from "../src/markdown.ts";
import * as path from "node:path";

test("candidate round-trips through frontmatter", () => {
  const meta: CandidateMeta = {
    id: "mem_abc123",
    kind: "decision",
    scope: "project",
    status: "candidate",
    title: "Use FTS dialect adapter",
    confidence: 0.72,
    evidenceKind: "tool_observed",
    gitHead: "abc1234",
    files: ["src/store/search.ts"],
    createdAt: "2026-08-11T12:00:00Z",
  };
  const doc = serializeCandidate(meta, "Keep search behind an adapter.\n\n## Evidence\n- probe");
  const parsed = parseCandidate(doc);
  assert.equal(parsed.meta.id, "mem_abc123");
  assert.equal(parsed.meta.kind, "decision");
  assert.equal(parsed.meta.confidence, 0.72);
  assert.deepEqual(parsed.meta.files, ["src/store/search.ts"]);
  assert.ok(parsed.body.includes("Keep search behind an adapter"));
});

test("candidate file naming embeds kind and id", () => {
  const meta: CandidateMeta = {
    id: "mem_xyz",
    kind: "checkpoint",
    scope: "project",
    status: "candidate",
    title: "t",
    confidence: 0.5,
    evidenceKind: "reviewed",
    files: [],
    createdAt: "2026-08-11T12:00:00Z",
  };
  assert.equal(candidateFile("/m", meta), path.join("/m", "inbox", "checkpoint-mem_xyz.md"));
});

test("text without frontmatter parses as plain body", () => {
  const parsed = parseCandidate("just some text");
  assert.deepEqual(parsed.meta, {});
  assert.equal(parsed.body, "just some text");
});
