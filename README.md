# pi-turso-memory

Coding-progression memory for [Pi](https://github.com/earendil-works/pi-coding-agent), backed by
Turso/libSQL: checkpoints, a structured progress ledger, curated Markdown knowledge, and
fail-open retrieval.

Design brief: `/home/utopia/work/inbox/turso-memory-plugin.md`

## What it does

- Persists a **progress ledger** (attempts, failures, corrections, tool outcomes) with Git and
  session provenance.
- Keeps **working state** (goal, phase, next action) per project.
- Writes **candidate checkpoints** as readable Markdown in an inbox; promotion is explicit.
- Persists a checkpoint before compaction and records compaction provenance (configurable via `checkpointOnCompaction`).
- Injects a small, bounded, clearly-marked memory packet at `before_agent_start`.
- Fails open: no database, no crash; the agent just continues without memory.

## Install / develop

Source: <https://github.com/ryan-brosas/pi-turso-memory>. It is published to npm with the
`pi-package` keyword used by the [pi.dev catalog](https://pi.dev/packages).

```bash
pi install npm:pi-turso-memory
# or pin/install directly from GitHub:
pi install git:github.com/ryan-brosas/pi-turso-memory

# develop locally
cd /home/utopia/work/project/pi-turso-memory
npm install
npm run check          # typecheck + tests
pi install /home/utopia/work/project/pi-turso-memory   # or copy to .pi/extensions
```

## Configuration

Config lives in the `turso-memory` namespace of global (`~/.pi/agent/settings.json`) or project
(`.pi/settings.json`) settings. Project overrides global. Environment variables win last.

```json
{
  "turso-memory": {
    "databaseUrl": "http://127.0.0.1:8080",
    "autoCapture": "candidates",
    "autoRecall": true,
    "includeGlobal": true,
    "maxInjectedChars": 10000,
    "maxHits": 8
  }
}
```

Connection resolution order:

1. `databaseUrl` setting (any of `file:`, `http(s)://`, `ws(s)://`, `libsql://`)
2. `TURSO_DATABASE_URL` (or `TURSO_MEMORY_DATABASE_URL`)
3. `TURSO_AUTH_TOKEN` for remote endpoints (never store tokens in settings files)
4. fallback: `file:<agent-dir>/turso-memory.db` when nothing is configured

`includeGlobal` controls whether `scope: "global"` memories are included in automatic recall,
`/tm search`, and the recall tool. `false` makes automatic recall strictly per-project. Memories
from *other* projects are never injected regardless of this setting.

If your Turso/libSQL server runs in Docker (e.g. `ghcr.io/tursodatabase/libsql-server` on
`127.0.0.1:8080`), just set `databaseUrl` to `http://127.0.0.1:8080`.

## Commands

```text
/tm status         connection, capabilities, row counts
/tm task           current working state
/tm search <q>     project-scoped search with provenance
/tm checkpoint     write current state to inbox as a candidate
/tm promote <id>   promote a candidate to active memory
/tm reject <id>    reject a candidate
/tm doctor         config, connection, redaction self-test
/tm refresh        rebuild the injected snapshot at the next prompt
```

Agent tools: `turso_memory_recall` (search) and `turso_memory_checkpoint` (write candidate).

## Testing

```bash
npm run check
```

The suite includes module tests plus a fake-`ExtensionAPI` integration test covering Pi registrations, lifecycle capture, bounded/redacted prompt injection, checkpoint review and promotion, restart recall, compaction, and fail-open behavior. See [`docs/testing-synthesis.md`](docs/testing-synthesis.md) for the testing synthesis and [`docs/turso-vs-hindsight.md`](docs/turso-vs-hindsight.md) for the backend metrics and embedding plan.

## Notes

- Secret scanning runs before hashing/indexing/export; blocked content is never stored.
- Candidate mode is the default: automatic events become ledger rows, never active knowledge
  without `/tm promote`.
- `src/store/turso-store.ts` hides SQL dialect behind a small store interface; FTS/vector
  capabilities are probed at migration time and are never required.
