import { DynamicBorder, type Theme } from '@earendil-works/pi-coding-agent';
import { type Component, Container, type SettingItem, SettingsList, type SettingsListTheme, Spacer, Text } from '@earendil-works/pi-tui';
import type { TursoMemoryConfig } from '../config.ts';

const BOOLEANS = ['true', 'false'] as const;
const CAPTURE_MODES = ['candidates', 'off'] as const;
const SCOPE_MODES = ['git-remote-or-root', 'cwd'] as const;

function settingsListTheme(theme: Theme): SettingsListTheme {
  return {
    label: (text: string, selected: boolean) => (selected ? theme.fg('accent', text) : text),
    value: (text: string, selected: boolean) => (selected ? theme.fg('accent', text) : theme.fg('muted', text)),
    description: (text: string) => theme.fg('dim', text),
    cursor: theme.fg('accent', '→ '),
    hint: (text: string) => theme.fg('dim', text),
  };
}

function numericSubmenu(theme: Theme, values: number[], format: (v: number) => string, _title: string, _description: string): (currentValue: string, done: (selectedValue?: string) => void) => Component {
  return (currentValue: string, done: (selectedValue?: string) => void) => {
    const items = values.map((v) => ({ value: format(v), label: format(v) }));
    if (!items.some((item) => item.value === currentValue)) {
      items.unshift({ value: currentValue, label: currentValue });
    }
    const { SelectList } = require('@earendil-works/pi-tui') as typeof import('@earendil-works/pi-tui');
    const list = new SelectList(items, Math.min(items.length, 8), {
      selectedPrefix: (text: string) => theme.fg('accent', text),
      selectedText: (text: string) => theme.fg('accent', text),
      description: (text: string) => theme.fg('muted', text),
      scrollInfo: (text: string) => theme.fg('muted', text),
      noMatch: (text: string) => theme.fg('muted', text),
    });
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done();
    return list;
  };
}

export function buildSettingsItems(theme: Theme, config: TursoMemoryConfig, _apply: (id: string, newValue: string) => void): SettingItem[] {
  return [
    { id: 'autoCapture', label: 'Auto capture', currentValue: config.autoCapture, description: 'Automatically write tool results as candidate memory items.', values: [...CAPTURE_MODES] },
    { id: 'autoRecall', label: 'Auto recall', currentValue: config.autoRecall ? 'true' : 'false', description: 'Inject relevant memory before every agent turn.', values: [...BOOLEANS] },
    { id: 'includeGlobal', label: 'Include global memories', currentValue: config.includeGlobal ? 'true' : 'false', description: 'Include scope:global memories in automatic recall.', values: [...BOOLEANS] },
    { id: 'maxInjectedChars', label: 'Max injected chars', currentValue: String(config.maxInjectedChars), description: 'Maximum characters of memory context injected per turn.', submenu: numericSubmenu(theme, [2000, 5000, 10000, 20000], String, 'Max injected chars', '') },
    { id: 'maxHits', label: 'Max search hits', currentValue: String(config.maxHits), description: 'Maximum memory items returned per search.', submenu: numericSubmenu(theme, [4, 8, 16, 32], String, 'Max search hits', '') },
    { id: 'checkpointOnCompaction', label: 'Checkpoint on compaction', currentValue: config.checkpointOnCompaction ? 'true' : 'false', description: 'Write a checkpoint candidate before each compaction.', values: [...BOOLEANS] },
    { id: 'projectScope', label: 'Project scope', currentValue: config.projectScope, description: 'How the project identity is resolved.', values: [...SCOPE_MODES] },
    { id: 'operationTimeoutMs', label: 'Operation timeout (ms)', currentValue: String(config.operationTimeoutMs), description: 'Database operation timeout in milliseconds.', submenu: numericSubmenu(theme, [500, 1200, 3000, 5000, 10000], String, 'Operation timeout (ms)', '') },
    { id: 'databaseUrl', label: 'Database URL', currentValue: config.databaseUrl ? config.databaseUrl.replace(/\?.*$/, '') + (config.databaseUrl.includes('authToken') ? ' (with auth)' : '') : '(local file)', description: 'Read-only: set via environment or settings file.' },
    { id: 'memoryDir', label: 'Memory directory', currentValue: config.memoryDir, description: 'Directory for Markdown inbox/archive files.' },
  ];
}

export class TursoSettingsComponent extends Container {
  settingsList: SettingsList;

  constructor(theme: Theme, items: SettingItem[], onChange: (id: string, newValue: string) => void, onCancel: () => void) {
    super();
    this.addChild(new DynamicBorder((text: string) => theme.fg('border', text)));
    this.addChild(new Text(theme.fg('accent', theme.bold('Turso Memory Settings')), 1, 0));
    this.addChild(new Spacer(1));
    this.settingsList = new SettingsList(items, 12, settingsListTheme(theme), onChange, onCancel, { enableSearch: true });
    this.addChild(this.settingsList);
    this.addChild(new DynamicBorder((text: string) => theme.fg('border', text)));
  }

  handleInput(data: string): void {
    this.settingsList.handleInput(data);
  }
}