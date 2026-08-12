import { DynamicBorder, type Theme } from '@earendil-works/pi-coding-agent';
import { Container, Key, matchesKey, type SelectItem, SelectList, type SelectListTheme, Spacer, Text } from '@earendil-works/pi-tui';
import type { UiDashboardSnapshot } from './types.ts';

function statusGlyph(status: string): string {
  if (status === 'active' || status === 'connected') return '✓';
  if (status === 'candidate') return '○';
  if (status === 'rejected' || status === 'DOWN') return '✗';
  if (status === 'archived') return '■';
  return '·';
}

function colorStatus(theme: Theme, status: string, value: string): string {
  if (status === 'active' || status === 'connected') return theme.fg('success', value);
  if (status === 'candidate') return theme.fg('accent', value);
  if (status === 'rejected' || status === 'DOWN') return theme.fg('error', value);
  return theme.fg('dim', value);
}

function selectListTheme(theme: Theme): SelectListTheme {
  return {
    selectedPrefix: (text: string) => theme.fg('accent', text),
    selectedText: (text: string) => theme.fg('accent', text),
    description: (text: string) => theme.fg('muted', text),
    scrollInfo: (text: string) => theme.fg('muted', text),
    noMatch: (text: string) => theme.fg('muted', text),
  };
}

type DashboardPane = 'overview' | 'candidates' | 'timeline';

export class TursoDashboardComponent extends Container {
  private pane: DashboardPane = 'overview';
  private readonly theme: Theme;
  private readonly snapshot: () => UiDashboardSnapshot;
  private readonly onPromote: (id: string) => void;
  private readonly onReject: (id: string) => void;
  private candidateList: SelectList | undefined;
  private selectedCandidateId: string | undefined;
  private readonly onClose: () => void;

  constructor(
    theme: Theme,
    snapshot: () => UiDashboardSnapshot,
    onPromote: (id: string) => void,
    onReject: (id: string) => void,
    onClose: () => void,
  ) {
    super();
    this.theme = theme;
    this.snapshot = snapshot;
    this.onPromote = onPromote;
    this.onReject = onReject;
    this.onClose = onClose;
    this.rebuild();
  }

  private rebuild(): void {
    this.candidateList = undefined;
    this.clear();
    const s = this.snapshot();

    this.addChild(new DynamicBorder((text: string) => this.theme.fg('border', text)));
    this.addChild(new Text(this.theme.fg('accent', this.theme.bold('Turso Memory Dashboard')), 1, 0));
    this.addChild(new Spacer(1));

    const paneLabels: { id: DashboardPane; label: string }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'candidates', label: 'Candidates (' + s.candidates.length + ')' },
      { id: 'timeline', label: 'Timeline' },
    ];
    const tabs = paneLabels
      .map((p) => (p.id === this.pane ? this.theme.fg('accent', this.theme.bold(' ' + p.label + ' ')) : this.theme.fg('dim', ' ' + p.label + ' ')))
      .join('│');
    this.addChild(new Text(tabs, 1, 0));
    this.addChild(new Spacer(1));

    switch (this.pane) {
      case 'overview':
        this.renderOverview(s);
        break;
      case 'candidates':
        this.renderCandidates(s);
        break;
      case 'timeline':
        this.renderTimeline(s);
        break;
    }

    this.addChild(new Spacer(1));
    this.addChild(new Text(this.theme.fg('dim', '  ← → panes  ·  ↑↓ select  ·  Enter/P promote  ·  R reject  ·  Esc close'), 1, 0));
    this.addChild(new DynamicBorder((text: string) => this.theme.fg('border', text)));
  }

  private renderOverview(s: UiDashboardSnapshot): void {
    const health = s.health;
    const statusText = health.ok ? 'connected' : 'DOWN';
    const statusColor = colorStatus(this.theme, statusText, statusGlyph(statusText));
    this.addChild(new Text('  ' + statusColor + '  ' + (health.ok ? health.latencyMs + 'ms' : health.error ?? ''), 0, 0));
    this.addChild(new Text('  FTS5: ' + (health.capabilities.fts5 ? '✓' : '✗'), 0, 0));
    this.addChild(new Spacer(1));

    if (s.workingState) {
      this.addChild(new Text(this.theme.fg('accent', this.theme.bold('  Working task')), 0, 0));
      this.addChild(new Text('  Goal: ' + s.workingState.goal, 0, 0));
      this.addChild(new Text('  Phase: ' + s.workingState.phase, 0, 0));
      this.addChild(new Spacer(1));
    }

    this.addChild(new Text(this.theme.fg('accent', this.theme.bold('  Stats')), 0, 0));
    this.addChild(new Text('  Events: ' + (s.stats.progress_events ?? 0), 0, 0));
    this.addChild(new Text('  Memories: ' + (s.stats.memory_items ?? 0), 0, 0));
    this.addChild(new Text('  Candidates: ' + s.candidates.length, 0, 0));
    this.addChild(new Text('  Active: ' + s.activeMemories.length, 0, 0));
    this.addChild(new Text('  Projects: ' + (s.stats.projects ?? 0), 0, 0));
  }

  private renderCandidates(s: UiDashboardSnapshot): void {
    if (s.candidates.length === 0) {
      this.addChild(new Text(this.theme.fg('dim', '  No candidates. Use /tm checkpoint to create one.'), 0, 0));
      return;
    }

    const selected = s.candidates.find((candidate) => candidate.id === this.selectedCandidateId) ?? s.candidates[0];
    if (!selected) return;
    this.selectedCandidateId = selected.id;

    const items: SelectItem[] = s.candidates.map((c) => ({
      value: c.id,
      label: c.kind + ': ' + c.title.slice(0, 60),
      description: c.evidenceKind + ' · ' + c.confidence.toFixed(2),
    }));

    const list = new SelectList(items, Math.min(items.length, 10), selectListTheme(this.theme));
    list.setSelectedIndex(s.candidates.findIndex((candidate) => candidate.id === selected.id));
    list.onSelectionChange = (item) => {
      if (item.value === this.selectedCandidateId) return;
      this.selectedCandidateId = item.value;
      this.rebuild();
    };
    list.onSelect = (item) => {
      this.onPromote(item.value);
    };
    list.onCancel = () => this.onClose();
    this.candidateList = list;
    this.addChild(list);
    this.addChild(new Spacer(1));

    this.addChild(new Text(this.theme.fg('accent', this.theme.bold('  Selected')), 0, 0));
    this.addChild(new Text('  ' + selected.title, 0, 0));
    this.addChild(new Text('  ' + selected.content.slice(0, 200), 0, 0));
    if (selected.gitHead) this.addChild(new Text('  git: ' + selected.gitHead, 0, 0));
    if (selected.branchName) this.addChild(new Text('  branch: ' + selected.branchName, 0, 0));
    this.addChild(new Text('  evidence: ' + selected.evidenceKind + '  confidence: ' + selected.confidence, 0, 0));
  }

  private renderTimeline(s: UiDashboardSnapshot): void {
    if (s.recentEvents.length === 0) {
      this.addChild(new Text(this.theme.fg('dim', '  No recent events.'), 0, 0));
      return;
    }

    for (const evt of s.recentEvents.slice(0, 12)) {
      const glyph = evt.kind === 'failure' ? '✗' : evt.kind === 'correction' ? '⚠' : '·';
      const color = evt.kind === 'failure' ? this.theme.fg('error', glyph) : this.theme.fg('dim', glyph);
      this.addChild(new Text('  ' + color + '  [' + evt.kind + '] ' + evt.summary.slice(0, 80) + (evt.gitHead ? ' (' + evt.gitHead.slice(0, 7) + ')' : ''), 0, 0));
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.left) || matchesKey(data, "h")) {
      const panes: DashboardPane[] = ['overview', 'candidates', 'timeline'];
      const idx = panes.indexOf(this.pane);
      this.pane = panes[(idx - 1 + panes.length) % panes.length];
      this.rebuild();
    } else if (matchesKey(data, Key.right) || matchesKey(data, "l")) {
      const panes: DashboardPane[] = ['overview', 'candidates', 'timeline'];
      const idx = panes.indexOf(this.pane);
      this.pane = panes[(idx + 1) % panes.length];
      this.rebuild();
    } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onClose();
    } else if (this.pane === 'candidates') {
      if (matchesKey(data, Key.up) || matchesKey(data, Key.down) || matchesKey(data, Key.enter)) {
        this.candidateList?.handleInput(data);
      } else if (matchesKey(data, "p") || matchesKey(data, "shift+p")) {
        const selected = this.snapshot().candidates.find((candidate) => candidate.id === this.selectedCandidateId) ?? this.snapshot().candidates[0];
        if (selected) this.onPromote(selected.id);
      } else if (matchesKey(data, "r") || matchesKey(data, "shift+r")) {
        const selected = this.snapshot().candidates.find((candidate) => candidate.id === this.selectedCandidateId) ?? this.snapshot().candidates[0];
        if (selected) this.onReject(selected.id);
      }
    }
  }

  invalidate(): void {
    super.invalidate();
    this.rebuild();
  }
}