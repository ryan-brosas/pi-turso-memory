import { test } from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../src/config.ts";
import { TursoDashboardComponent } from "../src/ui/dashboard.ts";
import { buildSettingsItems } from "../src/ui/settings.ts";
import type { UiCandidate, UiDashboardSnapshot } from "../src/ui/types.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const snapshot: UiDashboardSnapshot = {
  now: 0,
  health: { ok: true, latencyMs: 0, capabilities: { fts5: true } },
  stats: {},
  workingState: undefined,
  candidates: [],
  activeMemories: [],
  recentEvents: [],
  config: {} as UiDashboardSnapshot["config"],
  projectKey: undefined,
};

function candidate(id: string, title: string, content: string): UiCandidate {
  return {
    id,
    kind: "checkpoint",
    scope: "project",
    status: "candidate",
    title,
    content,
    confidence: 0.9,
    evidenceKind: "test_verified",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("dashboard closes on raw terminal Escape", () => {
  let closeCount = 0;
  const dashboard = new TursoDashboardComponent(
    theme,
    () => snapshot,
    () => {},
    () => {},
    () => {
      closeCount += 1;
    },
  );

  dashboard.handleInput("\x1b");

  assert.equal(closeCount, 1);
});

test("dashboard routes candidate navigation and actions", () => {
  const candidateSnapshot: UiDashboardSnapshot = {
    ...snapshot,
    candidates: [
      candidate("first", "First candidate", "first detail only"),
      candidate("second", "Second candidate", "second detail only"),
    ],
  };
  let promoted: string | undefined;
  let rejected: string | undefined;
  const dashboard = new TursoDashboardComponent(
    theme,
    () => candidateSnapshot,
    (id) => {
      promoted = id;
    },
    (id) => {
      rejected = id;
    },
    () => {},
  );

  dashboard.handleInput("\x1b[C");
  dashboard.handleInput("\x1b[B");

  assert.match(dashboard.render(120).join("\n"), /second detail only/);

  dashboard.handleInput("p");
  dashboard.handleInput("r");

  assert.equal(promoted, "second");
  assert.equal(rejected, "second");
});

test("numeric settings submenus are constructible in ESM", () => {
  const item = buildSettingsItems(theme, defaultConfig("/tmp/pi-turso-memory-test"), () => {}).find(
    (setting) => setting.id === "maxInjectedChars",
  );
  if (!item?.submenu) throw new Error("numeric settings submenu was not registered");

  const submenu = item.submenu(item.currentValue, () => {});

  assert.equal(typeof submenu.handleInput, "function");
});
