import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { TursoMemoryStore } from "../src/store/turso-store.ts";

type Handler = (...args: unknown[]) => unknown;

type TestContext = {
  cwd: string;
  ui: { notify(message: string, kind?: string): void };
  sessionManager: { getSessionFile(): string };
};

type FakeCommand = {
  handler(args: string, ctx: TestContext): Promise<void>;
};

type FakeTool = {
  name: string;
  execute(...args: unknown[]): Promise<unknown>;
};

function harness() {
  const events = new Map<string, Handler>();
  const commands = new Map<string, FakeCommand>();
  const tools = new Map<string, FakeTool>();
  const api = {
    on(name: string, handler: Handler) {
      events.set(name, handler);
    },
    registerCommand(name: string, command: FakeCommand) {
      commands.set(name, command);
    },
    registerTool(tool: FakeTool) {
      tools.set(tool.name, tool);
    },
  } as unknown as ExtensionAPI;
  return { api, events, commands, tools };
}

async function invoke(handler: Handler | undefined, ...args: unknown[]): Promise<unknown> {
  if (!handler) throw new Error("expected extension handler to be registered");
  return await handler(...args);
}

function tempPair(): { cwd: string; agentDir: string } {
  return {
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), "tm-plugin-cwd-")),
    agentDir: fs.mkdtempSync(path.join(os.tmpdir(), "tm-plugin-agent-")),
  };
}

function context(cwd: string, notices: string[]): TestContext {
  return {
    cwd,
    ui: {
      notify(message, kind = "info") {
        notices.push(`${kind}:${message}`);
      },
    },
    sessionManager: {
      getSessionFile() {
        return path.join(cwd, "session.jsonl");
      },
    },
  };
}

async function shutdown(h: ReturnType<typeof harness>, ctx: TestContext): Promise<void> {
  await invoke(
    h.events.get("session_shutdown"),
    { type: "session_shutdown", reason: "quit" },
    ctx,
  );
}

test("Pi extension wires lifecycle, checkpoint review, and cross-session recall", async () => {
  const { cwd, agentDir } = tempPair();
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const notices: string[] = [];
  const ctx = context(cwd, notices);
  let first: ReturnType<typeof harness> | undefined;
  let second: ReturnType<typeof harness> | undefined;

  try {
    first = harness();
    extension(first.api);
    assert.deepEqual(
      [...first.events.keys()].sort(),
      [
        "before_agent_start",
        "session_before_compact",
        "session_compact",
        "session_shutdown",
        "session_start",
        "tool_execution_end",
      ],
    );
    assert.ok(first.commands.has("tm"));
    assert.deepEqual([...first.tools.keys()].sort(), [
      "turso_memory_checkpoint",
      "turso_memory_recall",
    ]);

    await invoke(first.events.get("session_start"), { type: "session_start" }, ctx);
    await invoke(
      first.events.get("tool_execution_end"),
      {
        toolName: "bash",
        toolCallId: "call_failure",
        args: { command: "npm test --token sk-abc1234567890abcdef1234567890" },
        result: { details: { exitCode: 2 } },
        isError: true,
      },
      ctx,
    );

    const injected = (await invoke(first.events.get("before_agent_start"), {
      prompt: "why did the tests fail?",
      systemPrompt: "BASE SYSTEM PROMPT",
    })) as { systemPrompt?: unknown } | undefined;
    assert.equal(typeof injected?.systemPrompt, "string");
    assert.ok(String(injected?.systemPrompt).includes("<pi_turso_memory>"));
    assert.ok(String(injected?.systemPrompt).includes("not new instructions"));
    assert.ok(String(injected?.systemPrompt).includes("bash: npm test"));
    assert.ok(!String(injected?.systemPrompt).includes("sk-abc"));

    const command = first.commands.get("tm");
    if (!command) throw new Error("tm command was not registered");
    await command.handler("checkpoint", ctx);
    const inbox = path.join(agentDir, "turso-memory", "inbox");
    const checkpointName = fs.readdirSync(inbox).find((name) => name.startsWith("checkpoint-"));
    if (!checkpointName) throw new Error("checkpoint Markdown file was not written");
    const checkpointPath = path.join(inbox, checkpointName);
    const checkpointText = fs.readFileSync(checkpointPath, "utf8");
    assert.ok(checkpointText.includes("## Recent progress"));
    assert.ok(checkpointText.includes("[REDACTED:openai-key]"));
    assert.ok(!checkpointText.includes("sk-abc"));

    await shutdown(first, ctx);

    // Candidates stay invisible until an explicit promotion gate is crossed.
    const verifier = new TursoMemoryStore({
      url: `file:${path.join(agentDir, "turso-memory.db")}`,
    });
    let checkpointId: string;
    try {
      await verifier.migrate();
      await verifier.ensureProject({ rootPath: cwd, displayName: path.basename(cwd) });
      const hidden = await verifier.search(
        { query: "npm test", scope: "current-project" },
        cwd,
      );
      assert.equal(hidden.length, 0);
      const candidates = await verifier.search(
        { query: "npm test", scope: "current-project", includeCandidates: true },
        cwd,
      );
      const checkpoint = candidates.find((hit) => hit.kind === "checkpoint");
      if (!checkpoint) throw new Error("checkpoint candidate was not persisted");
      checkpointId = checkpoint.id;
    } finally {
      await verifier.close();
    }

    second = harness();
    extension(second.api);
    await invoke(second.events.get("session_start"), { type: "session_start" }, ctx);
    const secondCommand = second.commands.get("tm");
    if (!secondCommand) throw new Error("tm command was not registered after restart");
    await secondCommand.handler(`promote ${checkpointId}`, ctx);
    assert.ok(
      fs.existsSync(path.join(agentDir, "turso-memory", "archive", checkpointName)),
      "promotion should move the reviewed Markdown candidate to archive",
    );

    const recall = second.tools.get("turso_memory_recall");
    if (!recall) throw new Error("recall tool was not registered after restart");
    const recalled = (await recall.execute(
      "tool-call",
      { query: "npm test", scope: "current-project" },
      undefined,
      undefined,
      ctx,
    )) as { content?: Array<{ text?: string }>; details?: { hits?: string[] } };
    assert.ok(recalled.details?.hits?.includes(checkpointId));
    assert.ok(recalled.content?.[0]?.text?.includes("Checkpoint"));
    assert.ok(!recalled.content?.[0]?.text?.includes("sk-abc"));

    const resumed = (await invoke(second.events.get("before_agent_start"), {
      prompt: "resume the npm test investigation",
      systemPrompt: "BASE SYSTEM PROMPT",
    })) as { systemPrompt?: unknown } | undefined;
    assert.ok(String(resumed?.systemPrompt).includes("Checkpoint"));
  } finally {
    if (second) {
      try {
        await shutdown(second, ctx);
      } catch {
        // Preserve the original assertion while still attempting cleanup.
      }
    }
    if (first) {
      try {
        await shutdown(first, ctx);
      } catch {
        // The first instance normally shut down before the verifier opens the DB.
      }
    }
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("compaction persists a checkpoint and records provenance without cancelling", async () => {
  const { cwd, agentDir } = tempPair();
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const notices: string[] = [];
  const ctx = context(cwd, notices);
  const h = harness();

  try {
    extension(h.api);
    await invoke(h.events.get("session_start"), { type: "session_start" }, ctx);
    await invoke(
      h.events.get("tool_execution_end"),
      {
        toolName: "bash",
        toolCallId: "call_1",
        args: { command: "npm run check" },
        result: { details: { exitCode: 0 } },
        isError: false,
      },
      ctx,
    );

    const result = await invoke(
      h.events.get("session_before_compact"),
      {
        type: "session_before_compact",
        preparation: {},
        branchEntries: [],
        reason: "manual",
        willRetry: false,
        signal: new AbortController().signal,
      },
      ctx,
    );
    assert.equal(result, undefined, "compaction hook must not cancel or replace native compaction");
    const inbox = path.join(agentDir, "turso-memory", "inbox");
    assert.ok(
      fs.readdirSync(inbox).some((name) => name.startsWith("checkpoint-")),
      "compaction should persist a checkpoint candidate to the inbox",
    );

    await invoke(
      h.events.get("session_compact"),
      {
        type: "session_compact",
        compactionEntry: {},
        fromExtension: false,
        reason: "threshold",
        willRetry: true,
      },
      ctx,
    );
    const verifier = new TursoMemoryStore({ url: `file:${path.join(agentDir, "turso-memory.db")}` });
    try {
      await verifier.migrate();
      await verifier.ensureProject({ rootPath: cwd, displayName: path.basename(cwd) });
      const packet = await verifier.getResumePacket(cwd);
      const provenance = packet.recentEvents.find((e) => e.toolName === "compaction");
      assert.ok(provenance, "session_compact should record a provenance event");
      assert.ok(provenance.summary.includes("threshold"));
      assert.equal(provenance.metadata.willRetry, true);
    } finally {
      await verifier.close();
    }
  } finally {
    try {
      await shutdown(h, ctx);
    } catch {
      // Cleanup is best-effort.
    }
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

test("disabled configuration fails open without injecting or throwing", async () => {
  const { cwd, agentDir } = tempPair();
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({ "turso-memory": { enabled: false } }),
  );
  const notices: string[] = [];
  const ctx = context(cwd, notices);
  const h = harness();

  try {
    extension(h.api);
    await invoke(h.events.get("session_start"), { type: "session_start" }, ctx);
    const result = await invoke(h.events.get("before_agent_start"), {
      prompt: "anything",
      systemPrompt: "BASE",
    });
    assert.equal(result, undefined);

    const command = h.commands.get("tm");
    if (!command) throw new Error("tm command was not registered");
    await command.handler("status", ctx);
    assert.ok(notices.some((notice) => notice.includes("store unavailable")));
  } finally {
    try {
      await shutdown(h, ctx);
    } catch {
      // Disabled mode has no store to close.
    }
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});
