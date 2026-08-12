import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, type TursoMemoryConfig } from "./config.ts";
import {
  archiveDir,
  candidateFile,
  checkpointFile,
  findInboxFile,
  inboxDir,
  serializeCandidate,
  type CandidateMeta,
} from "./markdown.ts";
import { buildPacket, formatPacket } from "./packet.ts";
import { redactSecrets } from "./redact.ts";
import { embedderFromConfig } from "./embed.ts";
import { TursoMemoryStore, uid } from "./store/turso-store.ts";
import type { MemoryHit, ProgressEvent, ProjectIdentity } from "./store/types.ts";
import { git, shortError, truncate } from "./util.ts";

export function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
}

interface ToolEndEvent {
  toolName: string;
  toolCallId: string;
  args?: Record<string, unknown>;
  result?: { details?: Record<string, unknown> };
  isError?: boolean;
}

function summarizeTool(e: ToolEndEvent): string | undefined {
  const a = e.args ?? {};
  switch (e.toolName) {
    case "bash": {
      const cmd = typeof a.command === "string" ? truncate(a.command, 160) : "";
      return cmd ? `bash: ${cmd}` : undefined;
    }
    case "edit":
    case "write": {
      const p = typeof a.path === "string" ? a.path : "";
      return p ? `${e.toolName}: ${p}` : undefined;
    }
    case "read":
    case "grep":
    case "find":
    case "ls":
      return undefined;
    default:
      return `tool: ${e.toolName}`;
  }
}

function exitCodeOf(e: ToolEndEvent): number | undefined {
  const code = e.result?.details?.exitCode;
  return typeof code === "number" ? code : undefined;
}

function filePathsOf(e: ToolEndEvent): string[] {
  const p = e.args?.path;
  return typeof p === "string" && p.length > 0 ? [p] : [];
}

function resolveProject(cwd: string, scope: "git-remote-or-root" | "cwd"): ProjectIdentity {
  const root = scope === "cwd" ? cwd : (git(cwd, ["rev-parse", "--show-toplevel"]) ?? cwd);
  const remote = git(cwd, ["remote", "get-url", "origin"]);
  return { rootPath: root, remoteUrl: remote, displayName: path.basename(root) || path.basename(cwd) };
}

function sessionFile(ctx: { sessionManager?: { getSessionFile(): string | undefined } }): string | undefined {
  try {
    return ctx.sessionManager?.getSessionFile() ?? undefined;
  } catch {
    return undefined;
  }
}

interface UiLike {
  notify(message: string, kind?: string): void;
}

interface SessionCtx {
  cwd: string;
  ui?: UiLike;
  sessionManager?: { getSessionFile(): string | undefined };
}

function notify(ctx: { ui?: UiLike }, msg: string, kind = "info"): void {
  try {
    ctx.ui?.notify(msg, kind);
  } catch {
    /* noop */
  }
}

export default function (pi: ExtensionAPI) {
  let config: TursoMemoryConfig | null = null;
  let store: TursoMemoryStore | null = null;
  let projectId: string | undefined;
  let projectKey: string | undefined;
  let sessionId: string | undefined;

  async function ensureStore(ctx: { cwd: string; ui?: UiLike }): Promise<boolean> {
    if (store) return true;
    try {
      config = loadConfig(ctx.cwd, agentDir());
      if (!config.enabled) return false;
      const handle = embedderFromConfig(config);
      if (config.embeddingMode === "on" && !handle) {
        notify(ctx, "turso-memory: embeddings enabled but no API key or custom endpoint — lexical search only", "warning");
      }
      store = new TursoMemoryStore({
        url: config.databaseUrl,
        authToken: config.authToken,
        operationTimeoutMs: config.operationTimeoutMs,
      });
      await store.migrate();
      store.setEmbedder(handle?.embed, handle?.model);
      return true;
    } catch (e) {
      notify(ctx, `turso-memory: unavailable (${shortError(e)})`, "warning");
      store = null;
      return false;
    }
  }

  async function openSession(ctx: SessionCtx): Promise<void> {
    try {
      if (!(await ensureStore(ctx)) || !store || !config) return;
      const identity = resolveProject(ctx.cwd, config.projectScope);
      projectId = await store.ensureProject(identity);
      projectKey = identity.remoteUrl || identity.rootPath;
      sessionId = await store.openSession(projectId, {
        piSessionPath: sessionFile(ctx),
        branchName: git(ctx.cwd, ["branch", "--show-current"]),
        gitHead: git(ctx.cwd, ["rev-parse", "--short", "HEAD"]),
      });
      void store.ensureEmbeddings(64).catch(() => undefined);
    } catch (e) {
      notify(ctx, `turso-memory: session init failed (${shortError(e)})`, "warning");
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    await openSession(ctx as SessionCtx);
  });

  pi.on("before_agent_start", async (event) => {
    if (!store || !config?.autoRecall || !projectKey) return;
    try {
      const packet = await buildPacket(store, {
        projectKey,
        query: event.prompt,
        maxChars: config.maxInjectedChars,
        includeGlobal: config.includeGlobal,
      });
      const block = formatPacket(packet, config.maxInjectedChars);
      if (block.length < 60) return;
      return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
    } catch {
      return;
    }
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (!store || !config || config.autoCapture === "off" || !projectId) return;
    try {
      const e = event as unknown as ToolEndEvent;
      const summary = summarizeTool(e);
      if (!summary) return;
      const progress: ProgressEvent = {
        id: uid("evt"),
        projectId,
        sessionId,
        kind: e.isError ? "failure" : "progress",
        summary,
        toolName: e.toolName,
        toolCallId: e.toolCallId,
        exitCode: exitCodeOf(e),
        filePaths: filePathsOf(e),
        metadata: {},
        occurredAt: new Date().toISOString(),
        gitHead: git(ctx.cwd, ["rev-parse", "--short", "HEAD"]),
        branchName: git(ctx.cwd, ["branch", "--show-current"]),
      };
      await store.appendProgress(progress);
    } catch {
      /* fail open */
    }
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (!store || !config || !config.checkpointOnCompaction || !projectKey) return;
    try {
      await writeCheckpoint(ctx.cwd);
    } catch {
      /* fail open: never block or cancel native compaction */
    }
  });

  pi.on("session_compact", async (event) => {
    if (!store || !config || !projectId) return;
    try {
      await store.appendProgress({
        id: uid("evt"),
        projectId,
        sessionId,
        kind: "progress",
        summary: `compaction: ${event.reason}`,
        toolName: "compaction",
        filePaths: [],
        metadata: { willRetry: event.willRetry },
        occurredAt: new Date().toISOString(),
      });
    } catch {
      /* fail open */
    }
  });

  pi.on("session_shutdown", async () => {
    try {
      if (store && sessionId) await store.closeSession(sessionId, "shutdown");
      await store?.close();
    } catch {
      /* noop */
    } finally {
      store = null;
      sessionId = undefined;
      projectId = undefined;
      projectKey = undefined;
    }
  });

  async function withStore(
    ctx: ExtensionCommandContext,
    fn: () => Promise<void>,
  ): Promise<void> {
    if (!(await ensureStore(ctx)) || !store) {
      notify(ctx, "turso-memory: store unavailable — run /tm doctor", "error");
      return;
    }
    try {
      await fn();
    } catch (e) {
      notify(ctx, `turso-memory: ${shortError(e)}`, "error");
    }
  }

  async function cmdStatus(ctx: ExtensionCommandContext): Promise<void> {
    await withStore(ctx, async () => {
      const [health, counts] = await Promise.all([store!.health(), store!.stats()]);
      const caps = Object.entries(health.capabilities)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      notify(
        ctx,
        `turso-memory: ${health.ok ? "connected" : "DOWN"} ${health.latencyMs}ms | ${caps} | ` +
          `events=${counts.progress_events} items=${counts.memory_items} projects=${counts.projects} ` +
          `embeddings=${config!.embeddingMode} embedded=${counts.memory_embeddings}`,
      );
    });
  }

  async function cmdTask(ctx: ExtensionCommandContext): Promise<void> {
    await withStore(ctx, async () => {
      if (!projectKey) {
        notify(ctx, "turso-memory: no project bound yet", "warning");
        return;
      }
      const packet = await store!.getResumePacket(projectKey, {
        includeGlobal: config!.includeGlobal,
      });
      const ws = packet.workingState;
      notify(
        ctx,
        ws
          ? `task: ${ws.goal} | phase: ${ws.phase} | ${Object.entries(ws.state)
              .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
              .join(", ")}`
          : "no active task — use /tm checkpoint after starting work",
      );
    });
  }

  async function cmdSearch(ctx: ExtensionCommandContext, query: string): Promise<void> {
    await withStore(ctx, async () => {
      const hits = await store!.search(
        {
          query,
          scope: "current-project",
          limit: config!.maxHits,
          includeCandidates: false,
          includeGlobal: config!.includeGlobal,
        },
        projectKey,
      );
      if (hits.length === 0) {
        notify(ctx, `no active memory matches "${truncate(query, 60)}"`, "warning");
        return;
      }
      for (const h of hits.slice(0, 6)) {
        notify(ctx, `[${h.kind}:${h.id}] ${h.title} — ${truncate(h.content, 120)}`);
      }
    });
  }

  async function writeCheckpoint(cwd: string): Promise<string | undefined> {
    if (!store || !config || !projectKey) return undefined;
    const packet = await store.getResumePacket(projectKey, { includeGlobal: config.includeGlobal });
    const title = `Checkpoint ${new Date().toISOString()}`;
    const body: string[] = [];
    const ws = packet.workingState;
    if (ws) {
      body.push("## Active task", `- Goal: ${ws.goal}`, `- Phase: ${ws.phase}`);
      for (const [k, v] of Object.entries(ws.state)) {
        body.push(`- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
      }
      body.push("");
    }
    if (packet.recentEvents.length > 0) {
      body.push("## Recent progress");
      for (const e of packet.recentEvents.slice(0, 12)) {
        body.push(`- [${e.kind}] ${e.summary}${e.gitHead ? ` (git ${e.gitHead.slice(0, 7)})` : ""}`);
      }
      body.push("");
    }
    body.push("## Next safe action", "- (fill in)", "", "## Open questions", "- (fill in)");
    const id = await store.createCandidate({
      ownerKey: projectKey,
      projectId,
      sessionId,
      kind: "checkpoint",
      scope: "project",
      title,
      content: body.join("\n"),
      tags: ["checkpoint"],
      confidence: 0.5,
      importance: 0.6,
      evidenceKind: "reviewed",
      filePaths: [],
      gitHead: git(cwd, ["rev-parse", "--short", "HEAD"]),
      branchName: git(cwd, ["branch", "--show-current"]),
    });
    const meta: CandidateMeta = {
      id,
      kind: "checkpoint",
      scope: "project",
      status: "candidate",
      title,
      confidence: 0.5,
      evidenceKind: "reviewed",
      files: [],
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(inboxDir(config.memoryDir), { recursive: true });
    const file = candidateFile(config.memoryDir, meta);
    fs.writeFileSync(file, serializeCandidate(meta, body.join("\n")), "utf8");
    await store.recordExport(id, file);
    return file;
  }

  async function cmdPromote(ctx: ExtensionCommandContext, id: string): Promise<void> {
    await withStore(ctx, async () => {
      if (!config) return;
      await store!.promote(id);
      const file = findInboxFile(config.memoryDir, id);
      if (file) {
        fs.mkdirSync(archiveDir(config.memoryDir), { recursive: true });
        try {
          fs.renameSync(path.join(inboxDir(config.memoryDir), file), path.join(archiveDir(config.memoryDir), file));
        } catch {
          /* file move is best-effort */
        }
      }
      notify(ctx, `promoted ${id}`);
    });
  }

  pi.registerCommand("tm", {
    description:
      "Turso memory: status | task | search <q> | checkpoint | promote <id> | reject <id> | embed | refresh | doctor",
    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/);
      const cmd = parts[0] ?? "";
      const rest = parts.slice(1).join(" ");
      switch (cmd) {
        case "status":
          await cmdStatus(ctx);
          break;
        case "task":
          await cmdTask(ctx);
          break;
        case "search":
          if (!rest) {
            notify(ctx, "usage: /tm search <query>", "warning");
          } else {
            await cmdSearch(ctx, rest);
          }
          break;
        case "checkpoint": {
          if (!(await ensureStore(ctx))) {
            notify(ctx, "turso-memory: store unavailable — run /tm doctor", "error");
            break;
          }
          try {
            const file = await writeCheckpoint(ctx.cwd);
            notify(ctx, file ? `checkpoint written: ${file}` : "no project bound", "info");
          } catch (e) {
            notify(ctx, `turso-memory: ${shortError(e)}`, "error");
          }
          break;
        }
        case "promote":
          if (!rest) notify(ctx, "usage: /tm promote <id>", "warning");
          else await cmdPromote(ctx, rest.split(/\s+/)[0]!);
          break;
        case "reject":
          if (!rest) {
            notify(ctx, "usage: /tm reject <id>", "warning");
          } else {
            await withStore(ctx, async () => {
              await store!.reject(rest.split(/\s+/)[0]!);
              notify(ctx, `rejected ${rest.split(/\s+/)[0]}`);
            });
          }
          break;
        case "embed":
          await withStore(ctx, async () => {
            const n = await store!.ensureEmbeddings(0);
            notify(
              ctx,
              n > 0 ? `embedded ${n} memory item(s)` : "all memory items already embedded",
              "info",
            );
          });
          break;
        case "refresh":
          notify(ctx, "snapshot rebuilt at the next prompt", "info");
          break;
        case "doctor": {
          if (!(await ensureStore(ctx)) || !store || !config) break;
          const health = await store.health();
          const sample = redactSecrets("sk-test1234567890abcdef0123");
          const token = config.authToken ? "set" : "unset";
          const embedKey = process.env[config.embeddingApiKeyEnv]
            ? "set"
            : config.embeddingBaseUrl
              ? "keyless-custom"
              : "unset";
          notify(
            ctx,
            `turso-memory doctor | url=${config.databaseUrl.replace(/\?.*$/, "")} auth=${token} | ` +
              `health=${health.ok ? "ok" : "DOWN"} fts5=${health.capabilities.fts5} vectors=${health.capabilities.vectors} | ` +
              `embeddings=${config.embeddingMode} provider=${config.embeddingProvider} model=${config.embeddingModel} key=${embedKey} | ` +
              `redaction=${sample.status}`,
            health.ok ? "info" : "error",
          );
          break;
        }
        default:
          notify(
            ctx,
            "turso-memory commands: status | task | search <q> | checkpoint | promote <id> | reject <id> | refresh | doctor",
          );
      }
    },
  });

  pi.registerTool({
    name: "turso_memory_recall",
    label: "Turso Memory Recall",
    description:
      "Search the Turso-backed memory ledger for relevant project knowledge, failures, and decisions.",
    parameters: Type.Object({
      query: Type.String({ description: "What to look for" }),
      mode: Type.Optional(
        Type.String({ description: "resume | why | debug | design | history | search" }),
      ),
      scope: Type.Optional(Type.String({ description: "current-project | global" })),
      limit: Type.Optional(Type.Number({ description: "Max hits (default 8)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!(await ensureStore(ctx)) || !store) {
        return { content: [{ type: "text", text: "Turso memory unavailable." }], details: {} };
      }
      const hits = await store.search(
        {
          query: params.query,
          mode: params.mode ?? "search",
          scope: params.scope === "global" ? "global" : "current-project",
          limit: params.limit ?? config!.maxHits,
          includeCandidates: false,
          includeGlobal: config!.includeGlobal,
        },
        projectKey,
      );
      const text = hits.length
        ? hits
            .map(
              (h: MemoryHit) =>
                `[${h.kind}:${h.id}] ${h.title}\n${truncate(h.content, 400)}` +
                `${h.gitHead ? `\n(git ${h.gitHead.slice(0, 7)})` : ""}`,
            )
            .join("\n\n")
        : "No relevant memory found.";
      return {
        content: [{ type: "text", text }],
        details: { hits: hits.map((h) => h.id) },
      };
    },
  });

  pi.registerTool({
    name: "turso_memory_checkpoint",
    label: "Turso Memory Checkpoint",
    description: "Write the current task progress to the memory inbox as a reviewable Markdown candidate.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      if (!(await ensureStore(ctx)) || !store) {
        return { content: [{ type: "text", text: "Turso memory unavailable." }], details: {} };
      }
      const file = await writeCheckpoint(ctx.cwd);
      if (!file) {
        return { content: [{ type: "text", text: "No project bound yet." }], details: {} };
      }
      return {
        content: [{ type: "text", text: `Checkpoint written to ${file}` }],
        details: { path: file },
      };
    },
  });
}
