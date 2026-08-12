export interface ProjectIdentity {
  rootPath: string;
  remoteUrl?: string;
  displayName: string;
}

export interface SessionInput {
  piSessionPath?: string;
  parentSessionId?: string;
  branchName?: string;
  gitHead?: string;
}

export type ProgressKind = "progress" | "failure" | "correction" | "checkpoint";

export interface ProgressEvent {
  id: string;
  projectId: string;
  sessionId?: string;
  parentEventId?: string;
  kind: ProgressKind;
  phase?: string;
  summary: string;
  evidence?: string;
  toolName?: string;
  toolCallId?: string;
  exitCode?: number;
  gitHead?: string;
  branchName?: string;
  filePaths: string[];
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export type MemoryKind =
  | "preference"
  | "fact"
  | "convention"
  | "decision"
  | "lesson"
  | "failure"
  | "correction"
  | "procedure"
  | "experiment"
  | "checkpoint"
  | "handoff";

export type MemoryStatus = "candidate" | "active" | "superseded" | "archived" | "rejected";
export type MemoryScope = "global" | "project" | "session";

export interface MemoryCandidateInput {
  ownerKey: string;
  projectId?: string;
  sessionId?: string;
  kind: MemoryKind;
  scope: MemoryScope;
  title: string;
  content: string;
  tags: string[];
  confidence: number;
  importance: number;
  evidenceKind: "user_stated" | "tool_observed" | "test_verified" | "reviewed" | "inferred";
  gitHead?: string;
  branchName?: string;
  filePaths: string[];
  supersedesId?: string;
}

export interface MemoryHit {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  status: MemoryStatus;
  title: string;
  content: string;
  confidence: number;
  evidenceKind: string;
  gitHead?: string;
  branchName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkingState {
  projectId: string;
  sessionId?: string;
  goal: string;
  phase: string;
  state: Record<string, unknown>;
  sourceEventId?: string;
  updatedAt: string;
}

export interface MemoryPacket {
  workingState?: WorkingState;
  hits: MemoryHit[];
  recentEvents: ProgressEvent[];
}

export interface StoreHealth {
  ok: boolean;
  latencyMs: number;
  error?: string;
  capabilities: Record<string, boolean>;
}

export interface RetrievalQuery {
  query: string;
  mode?: string;
  scope?: "current-project" | "global" | "all";
  limit?: number;
  includeCandidates?: boolean;
  includeGlobal?: boolean;
}

export interface MemoryStore {
  migrate(signal?: AbortSignal): Promise<void>;
  health(): Promise<StoreHealth>;
  stats(): Promise<Record<string, number>>;
  ensureProject(identity: ProjectIdentity): Promise<string>;
  openSession(projectId: string, input: SessionInput): Promise<string>;
  closeSession(sessionId: string, reason: string): Promise<void>;
  appendProgress(event: ProgressEvent): Promise<void>;
  upsertWorkingState(state: WorkingState): Promise<void>;
  getResumePacket(projectKey: string, opts?: { includeGlobal?: boolean }): Promise<MemoryPacket>;
  search(query: RetrievalQuery, projectKey?: string): Promise<MemoryHit[]>;
  createCandidate(input: MemoryCandidateInput): Promise<string>;
  recordExport(memoryId: string, filePath: string): Promise<void>;
  promote(id: string): Promise<void>;
  reject(id: string): Promise<void>;
  forget(id: string): Promise<void>;
  close(): Promise<void>;
}
