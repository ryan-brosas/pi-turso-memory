import type { WorkingState, MemoryKind, MemoryStatus, MemoryScope, MemoryHit, ProgressEvent } from '../store/types.ts';
import type { StoreHealth } from '../store/types.ts';
import type { TursoMemoryConfig } from '../config.ts';

export interface UiDashboardSnapshot {
  now: number;
  health: StoreHealth;
  stats: Record<string, number>;
  workingState: WorkingState | undefined;
  candidates: UiCandidate[];
  activeMemories: MemoryHit[];
  recentEvents: ProgressEvent[];
  config: TursoMemoryConfig;
  projectKey: string | undefined;
}

export interface UiCandidate {
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

export type UiSettingsTab = 'capture' | 'review' | 'database' | 'display';

export interface UiSettingsState {
  tab: UiSettingsTab;
  config: TursoMemoryConfig;
  effectiveConfig: TursoMemoryConfig;
  health: StoreHealth | undefined;
}