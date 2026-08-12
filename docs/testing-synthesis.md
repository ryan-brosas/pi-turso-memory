# Testing synthesis

This suite synthesizes patterns from the Pi memory extensions surveyed before implementation; it does not copy their test code.

## Sources and adopted ideas

- **pi-memory-extension** — test the Pi event map, safe bounded prompt injection, explicit checkpoint → inbox → human promotion, and the distinction between session history and durable memory.
- **pi-hermes-memory** — test strict configuration behavior, persistence across restart, security scanning before storage, fail-open handlers, and unit/integration separation. Its test plans also emphasize mocking the Pi boundary and recording manual runtime checks separately.
- **pi-observational-memory** — keep compaction/session lifecycle behavior explicit and verify that prepared memory is rendered quickly rather than silently replacing Pi's native compaction.
- **mnemopi** — preserve working/episodic separation, scoped recall, and source-backed records.
- **Pi extension examples** — mechanically verify registrations and exercise handlers through a small fake `ExtensionAPI` harness.

## Automated coverage in this package

| Concern | Coverage | Test |
|---|---|---|
| Pi registration | Hooks, `/tm`, recall/checkpoint tools | `tests/extension.test.ts` |
| Lifecycle capture | `session_start` → `tool_execution_end` → `before_agent_start` | `tests/extension.test.ts` |
| Prompt safety | Bounded, clearly-labelled packet and redacted tool evidence | `tests/packet.test.ts`, `tests/extension.test.ts` |
| Review boundary | Candidate is hidden from normal recall until promotion | `tests/store.test.ts`, `tests/extension.test.ts` |
| Markdown workflow | Checkpoint file, frontmatter, archive move on promotion | `tests/markdown.test.ts`, `tests/extension.test.ts` |
| Restart continuity | New extension instance recalls promoted memory | `tests/extension.test.ts` |
| Compaction boundary | Checkpoint persisted before compaction; provenance recorded; native compaction never cancelled | `tests/extension.test.ts` |
| Fail-open behavior | Disabled configuration does not inject or throw | `tests/extension.test.ts` |
| Store/security contracts | Migration, idempotency, scopes, redaction, working state | `tests/store.test.ts` |

## Deliberately deferred

Background observation/reflection, branch-sensitive reconstruction, and embedding/hybrid ranking remain later phases from the design brief. They should receive dedicated tests when implemented instead of being represented by a superficial registration-only assertion.
