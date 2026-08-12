import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type AutoCapture = "off" | "candidates";

export interface TursoMemoryConfig {
  enabled: boolean;
  databaseUrl: string;
  databaseUrlEnv: string;
  authToken?: string;
  authTokenEnv: string;
  fallbackFile: string;
  projectScope: "git-remote-or-root" | "cwd";
  autoCapture: AutoCapture;
  autoRecall: boolean;
  includeGlobal: boolean;
  maxInjectedChars: number;
  maxHits: number;
  operationTimeoutMs: number;
  checkpointOnCompaction: boolean;
  memoryDir: string;
  embeddingMode: "off" | "auto" | "on";
  embeddingProvider: "voyage" | "openai";
  embeddingModel: string;
  embeddingApiKeyEnv: string;
  embeddingBaseUrl: string;
}

export function defaultConfig(agentDir: string): TursoMemoryConfig {
  return {
    enabled: true,
    databaseUrl: "",
    databaseUrlEnv: "TURSO_DATABASE_URL",
    authToken: undefined,
    authTokenEnv: "TURSO_AUTH_TOKEN",
    fallbackFile: path.join(agentDir, "turso-memory.db"),
    projectScope: "git-remote-or-root",
    autoCapture: "candidates",
    autoRecall: true,
    includeGlobal: true,
    maxInjectedChars: 10000,
    maxHits: 8,
    operationTimeoutMs: 1200,
    checkpointOnCompaction: true,
    memoryDir: path.join(agentDir, "turso-memory"),
    embeddingMode: "off",
    embeddingProvider: "voyage",
    embeddingModel: "voyage-4-lite",
    embeddingApiKeyEnv: "VOYAGE_API_KEY",
    embeddingBaseUrl: "",
  };
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function namespace(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const v = raw["turso-memory"];
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function apply(base: TursoMemoryConfig, s: Record<string, unknown> | undefined): TursoMemoryConfig {
  if (!s) return base;
  const str = (k: string, fb: string) =>
    typeof s[k] === "string" && (s[k] as string).length > 0 ? (s[k] as string) : fb;
  const num = (k: string, fb: number) =>
    typeof s[k] === "number" && Number.isFinite(s[k] as number) ? (s[k] as number) : fb;
  const bool = (k: string, fb: boolean) => (typeof s[k] === "boolean" ? (s[k] as boolean) : fb);
  return {
    ...base,
    enabled: bool("enabled", base.enabled),
    databaseUrl: str("databaseUrl", base.databaseUrl),
    databaseUrlEnv: str("databaseUrlEnv", base.databaseUrlEnv),
    authTokenEnv: str("authTokenEnv", base.authTokenEnv),
    fallbackFile: expandHome(str("fallbackFile", base.fallbackFile)),
    projectScope: s["projectScope"] === "cwd" ? "cwd" : "git-remote-or-root",
    autoCapture: s["autoCapture"] === "off" ? "off" : "candidates",
    autoRecall: bool("autoRecall", base.autoRecall),
    includeGlobal: bool("includeGlobal", base.includeGlobal),
    maxInjectedChars: num("maxInjectedChars", base.maxInjectedChars),
    maxHits: num("maxHits", base.maxHits),
    operationTimeoutMs: num("operationTimeoutMs", base.operationTimeoutMs),
    checkpointOnCompaction: bool("checkpointOnCompaction", base.checkpointOnCompaction),
    memoryDir: expandHome(str("memoryDir", base.memoryDir)),
    embeddingMode:
      s["embeddingMode"] === "on" ? "on" : s["embeddingMode"] === "auto" ? "auto" : "off",
    embeddingProvider: s["embeddingProvider"] === "openai" ? "openai" : "voyage",
    embeddingModel: str("embeddingModel", base.embeddingModel),
    embeddingApiKeyEnv:
      typeof s["embeddingApiKeyEnv"] === "string"
        ? (s["embeddingApiKeyEnv"] as string)
        : base.embeddingApiKeyEnv,
    embeddingBaseUrl: str("embeddingBaseUrl", base.embeddingBaseUrl),
  };
}

export function loadConfig(cwd: string, agentDir: string): TursoMemoryConfig {
  const globalSettings = readJson(path.join(agentDir, "settings.json"));
  const projectSettings = readJson(path.join(cwd, ".pi", "settings.json"));
  let cfg = apply(defaultConfig(agentDir), namespace(globalSettings));
  cfg = apply(cfg, namespace(projectSettings));
  const url =
    process.env[cfg.databaseUrlEnv] ??
    process.env.TURSO_MEMORY_DATABASE_URL ??
    process.env.TURSO_DATABASE_URL;
  if (url) cfg.databaseUrl = url;
  const token =
    process.env[cfg.authTokenEnv] ??
    process.env.TURSO_MEMORY_AUTH_TOKEN ??
    process.env.TURSO_AUTH_TOKEN;
  if (token) cfg.authToken = token;
  if (!cfg.databaseUrl) cfg.databaseUrl = "file:" + cfg.fallbackFile;
  return cfg;
}
