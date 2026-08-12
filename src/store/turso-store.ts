import { createClient, type InValue } from "@libsql/client";
import { createHash, randomUUID } from "node:crypto";
import { redactSecrets } from "../redact.ts";
import { SCHEMA_SQL } from "./schema.ts";
import type {
  MemoryCandidateInput,
  MemoryHit,
  MemoryKind,
  MemoryScope,
  MemoryStatus,
  MemoryStore,
  ProgressEvent,
  ProjectIdentity,
  RetrievalQuery,
  SessionInput,
  StoreHealth,
  WorkingState,
} from "./types.ts";

type Client = ReturnType<typeof createClient>;

export interface TursoStoreOptions {
  url: string;
  authToken?: string;
  operationTimeoutMs?: number;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function uid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function rowsToObjects(columns: string[], rows: unknown[][]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export class TursoMemoryStore implements MemoryStore {
  private client: Client;
  private fts5 = false;
  private vectors = false;
  private closed = false;

  constructor(opts: TursoStoreOptions) {
    this.client = createClient({ url: opts.url, authToken: opts.authToken });
  }

  async migrate(): Promise<void> {
    const statements = SCHEMA_SQL.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((sql) => ({ sql }));
    await this.client.batch(statements, "write");
    this.fts5 = await this.probeFts5();
    this.vectors = await this.probeVectors();
  }

  private async probeFts5(): Promise<boolean> {
    try {
      await this.client.execute("CREATE VIRTUAL TABLE IF NOT EXISTS _tm_probe_fts USING fts5(x)");
      await this.client.execute("DROP TABLE IF EXISTS _tm_probe_fts");
      return true;
    } catch {
      return false;
    }
  }

  private async probeVectors(): Promise<boolean> {
    try {
      await this.client.execute(
        "SELECT vector_distance_cos(vector32('[1,0]'), vector32('[1,0]'))",
      );
      return true;
    } catch {
      return false;
    }
  }

  async health(): Promise<StoreHealth> {
    const t = Date.now();
    try {
      await this.client.execute("SELECT 1");
      return {
        ok: true,
        latencyMs: Date.now() - t,
        capabilities: { basicSql: true, transactions: true, fts5: this.fts5, vectors: this.vectors },
      };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t, error: String(e), capabilities: {} };
    }
  }

  async stats(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const table of [
      "projects",
      "sessions",
      "progress_events",
      "memory_items",
      "working_state",
      "markdown_exports",
    ]) {
      const row = await this.first(`SELECT COUNT(*) AS n FROM ${table}`);
      out[table] = Number(row?.n ?? 0);
    }
    return out;
  }

  async ensureProject(identity: ProjectIdentity): Promise<string> {
    const scopeKey = identity.remoteUrl || identity.rootPath;
    const id = `prj_${sha256(scopeKey).slice(0, 20)}`;
    const now = new Date().toISOString();
    await this.client.execute({
      sql: `INSERT INTO projects (id, scope_key, root_path, remote_url, display_name, created_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope_key) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      args: [id, scopeKey, identity.rootPath, identity.remoteUrl ?? null, identity.displayName, now, now],
    });
    return id;
  }

  async openSession(projectId: string, input: SessionInput): Promise<string> {
    const id = uid("sess");
    await this.client.execute({
      sql: `INSERT INTO sessions (id, project_id, pi_session_path, parent_session_id, branch_name, git_head, started_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        projectId,
        input.piSessionPath ?? null,
        input.parentSessionId ?? null,
        input.branchName ?? null,
        input.gitHead ?? null,
        new Date().toISOString(),
      ],
    });
    return id;
  }

  async closeSession(sessionId: string, reason: string): Promise<void> {
    await this.client.execute({
      sql: "UPDATE sessions SET ended_at = ?, end_reason = ? WHERE id = ?",
      args: [new Date().toISOString(), reason, sessionId],
    });
  }

  async appendProgress(event: ProgressEvent): Promise<void> {
    const redacted = redactSecrets(event.summary);
    const evidence = event.evidence ? redactSecrets(event.evidence) : undefined;
    const hash = sha256([event.projectId, event.kind, redacted.text, event.occurredAt].join("|"));
    try {
      await this.client.execute({
        sql: `INSERT INTO progress_events
              (id, project_id, session_id, parent_event_id, kind, phase, summary, evidence,
               tool_name, tool_call_id, exit_code, git_head, branch_name, file_paths_json,
               metadata_json, redaction_status, occurred_at, content_hash)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          event.id,
          event.projectId,
          event.sessionId ?? null,
          event.parentEventId ?? null,
          event.kind,
          event.phase ?? null,
          redacted.text,
          evidence?.text ?? null,
          event.toolName ?? null,
          event.toolCallId ?? null,
          event.exitCode ?? null,
          event.gitHead ?? null,
          event.branchName ?? null,
          JSON.stringify(event.filePaths),
          JSON.stringify(event.metadata),
          redacted.status,
          event.occurredAt,
          hash,
        ],
      });
    } catch (e) {
      if (!String(e).includes("UNIQUE")) throw e;
    }
  }

  async upsertWorkingState(state: WorkingState): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO working_state (project_id, session_id, goal, phase, state_json, source_event_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
              goal = excluded.goal, phase = excluded.phase, state_json = excluded.state_json,
              session_id = excluded.session_id, source_event_id = excluded.source_event_id,
              updated_at = excluded.updated_at`,
      args: [
        state.projectId,
        state.sessionId ?? null,
        state.goal,
        state.phase,
        JSON.stringify(state.state),
        state.sourceEventId ?? null,
        state.updatedAt,
      ],
    });
  }

  async getResumePacket(
    projectKey: string,
    opts?: { includeGlobal?: boolean },
  ): Promise<{ workingState?: WorkingState; hits: MemoryHit[]; recentEvents: ProgressEvent[] }> {
    const proj = await this.first("SELECT id FROM projects WHERE scope_key = ?", [projectKey]);
    const pid = proj?.id ? String(proj.id) : projectKey;
    const wsRow = await this.first("SELECT * FROM working_state WHERE project_id = ?", [pid]);
    const eventRows = await this.all(
      "SELECT * FROM progress_events WHERE project_id = ? ORDER BY occurred_at DESC LIMIT 12",
      [pid],
    );
    const events: ProgressEvent[] = eventRows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      sessionId: r.session_id ? String(r.session_id) : undefined,
      kind: r.kind as ProgressEvent["kind"],
      phase: r.phase ? String(r.phase) : undefined,
      summary: String(r.summary),
      evidence: r.evidence ? String(r.evidence) : undefined,
      toolName: r.tool_name ? String(r.tool_name) : undefined,
      exitCode: r.exit_code == null ? undefined : Number(r.exit_code),
      gitHead: r.git_head ? String(r.git_head) : undefined,
      branchName: r.branch_name ? String(r.branch_name) : undefined,
      filePaths: JSON.parse(String(r.file_paths_json ?? "[]")) as string[],
      metadata: JSON.parse(String(r.metadata_json ?? "{}")) as Record<string, unknown>,
      occurredAt: String(r.occurred_at),
    }));
    const hits = await this.search(
      {
        query: "",
        mode: "resume",
        scope: "current-project",
        limit: 6,
        includeGlobal: opts?.includeGlobal !== false,
      },
      projectKey,
    );
    let workingState: WorkingState | undefined;
    if (wsRow) {
      workingState = {
        projectId: String(wsRow.project_id),
        sessionId: wsRow.session_id ? String(wsRow.session_id) : undefined,
        goal: String(wsRow.goal),
        phase: String(wsRow.phase),
        state: JSON.parse(String(wsRow.state_json ?? "{}")) as Record<string, unknown>,
        sourceEventId: wsRow.source_event_id ? String(wsRow.source_event_id) : undefined,
        updatedAt: String(wsRow.updated_at),
      };
    }
    return { workingState, hits, recentEvents: events };
  }

  async search(query: RetrievalQuery, projectKey?: string): Promise<MemoryHit[]> {
    const limit = Math.min(Math.max(query.limit ?? 8, 1), 50);
    const statusCond = query.includeCandidates
      ? "status IN ('active','candidate')"
      : "status = 'active'";
    const scopeConds: string[] = [];
    const args: InValue[] = [];
    if (query.scope === "global") {
      scopeConds.push("scope = 'global'");
    } else if (query.scope === "current-project" && projectKey) {
      scopeConds.push(query.includeGlobal === false ? "owner_key = ?" : "(owner_key = ? OR scope = 'global')");
      args.push(projectKey);
    }
    const where = [statusCond, ...scopeConds].join(" AND ");
    const q = query.query.trim();
    if (q.length === 0) {
      const rows = await this.all(
        `SELECT id, kind, scope, status, title, content, confidence, evidence_kind, git_head, branch_name, created_at, updated_at
         FROM memory_items WHERE ${where} ORDER BY updated_at DESC LIMIT ?`,
        [...args, limit],
      );
      return rows.map((r) => this.hit(r));
    }
    const like = `%${escapeLike(q)}%`;
    const rows = await this.all(
      `SELECT id, kind, scope, status, title, content, confidence, evidence_kind, git_head, branch_name, created_at, updated_at
       FROM memory_items
       WHERE ${where} AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC LIMIT ?`,
      [...args, like, like, like, limit],
    );
    return rows.map((r) => this.hit(r));
  }

  private hit(r: Record<string, unknown>): MemoryHit {
    return {
      id: String(r.id),
      kind: r.kind as MemoryKind,
      scope: r.scope as MemoryScope,
      status: r.status as MemoryStatus,
      title: String(r.title),
      content: String(r.content),
      confidence: Number(r.confidence ?? 0.5),
      evidenceKind: String(r.evidence_kind ?? "inferred"),
      gitHead: r.git_head ? String(r.git_head) : undefined,
      branchName: r.branch_name ? String(r.branch_name) : undefined,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  async createCandidate(input: MemoryCandidateInput): Promise<string> {
    const id = uid("mem");
    const hash = sha256(input.content);
    const now = new Date().toISOString();
    await this.client.execute({
      sql: `INSERT INTO memory_items
            (id, owner_key, project_id, source_session_id, kind, scope, status, title, content,
             tags_json, confidence, importance, evidence_kind, supersedes_id, git_head, branch_name,
             file_paths_json, content_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(owner_key, content_hash) DO NOTHING`,
      args: [
        id,
        input.ownerKey,
        input.projectId ?? null,
        input.sessionId ?? null,
        input.kind,
        input.scope,
        input.title,
        input.content,
        JSON.stringify(input.tags),
        input.confidence,
        input.importance,
        input.evidenceKind,
        input.supersedesId ?? null,
        input.gitHead ?? null,
        input.branchName ?? null,
        JSON.stringify(input.filePaths),
        hash,
        now,
        now,
      ],
    });
    return id;
  }

  async recordExport(memoryId: string, filePath: string): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO markdown_exports (id, memory_id, path, content_hash, status, exported_at)
            VALUES (?, ?, ?, ?, 'inbox', ?)`,
      args: [uid("exp"), memoryId, filePath, sha256(filePath), new Date().toISOString()],
    });
  }

  async promote(id: string): Promise<void> {
    await this.client.execute({
      sql: "UPDATE memory_items SET status = 'active', updated_at = ? WHERE id = ?",
      args: [new Date().toISOString(), id],
    });
  }

  async reject(id: string): Promise<void> {
    await this.client.execute({
      sql: "UPDATE memory_items SET status = 'rejected', updated_at = ? WHERE id = ?",
      args: [new Date().toISOString(), id],
    });
  }

  async forget(id: string): Promise<void> {
    await this.client.execute({
      sql: "UPDATE memory_items SET status = 'archived', updated_at = ? WHERE id = ?",
      args: [new Date().toISOString(), id],
    });
  }

  private async all(sql: string, args: InValue[] = []): Promise<Record<string, unknown>[]> {
    const r = await this.client.execute({ sql, args });
    return rowsToObjects(r.columns, r.rows as unknown as unknown[][]);
  }

  private async first(sql: string, args: InValue[] = []): Promise<Record<string, unknown> | undefined> {
    const rows = await this.all(sql, args);
    return rows[0];
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.client.close();
  }
}
