import * as fs from "node:fs";
import * as path from "node:path";

export interface CandidateMeta {
  id: string;
  kind: string;
  scope: string;
  status: string;
  title: string;
  confidence: number;
  evidenceKind: string;
  gitHead?: string;
  branchName?: string;
  files: string[];
  createdAt: string;
}

export function serializeCandidate(meta: CandidateMeta, body: string): string {
  const lines: string[] = [
    "---",
    `id: ${meta.id}`,
    `kind: ${meta.kind}`,
    `scope: ${meta.scope}`,
    `status: ${meta.status}`,
    `title: ${meta.title}`,
    `confidence: ${meta.confidence}`,
    `evidence_kind: ${meta.evidenceKind}`,
    ...(meta.gitHead ? [`git_head: ${meta.gitHead}`] : []),
    ...(meta.branchName ? [`branch_name: ${meta.branchName}`] : []),
    `files: ${JSON.stringify(meta.files)}`,
    `created_at: ${meta.createdAt}`,
    "---",
    "",
    `# ${meta.title}`,
    "",
    body,
    "",
  ];
  return lines.join("\n");
}

export function parseCandidate(
  text: string,
): { meta: Record<string, string | number | string[]>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.trimStart());
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string | number | string[]> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(": ");
    if (i < 0) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 2);
    if (k === "files") {
      try {
        meta[k] = JSON.parse(v) as string[];
      } catch {
        meta[k] = [];
      }
    } else if (k === "confidence") {
      meta[k] = Number(v);
    } else {
      meta[k] = v;
    }
  }
  return { meta, body: m[2].trim() };
}

export function inboxDir(memoryDir: string): string {
  return path.join(memoryDir, "inbox");
}

export function archiveDir(memoryDir: string): string {
  return path.join(memoryDir, "archive");
}

export function candidateFile(memoryDir: string, meta: CandidateMeta): string {
  return path.join(inboxDir(memoryDir), `${meta.kind}-${meta.id}.md`);
}

export function checkpointFile(memoryDir: string): string {
  return path.join(
    inboxDir(memoryDir),
    `checkpoint-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
  );
}

export function findInboxFile(memoryDir: string, id: string): string | undefined {
  try {
    const dir = inboxDir(memoryDir);
    return fs.readdirSync(dir).find((f) => f.includes(id));
  } catch {
    return undefined;
  }
}
