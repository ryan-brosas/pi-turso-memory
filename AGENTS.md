# Agent Rules

## Golden rule: check when done

```sh
npm run release:check
```

A green result proves strict TypeScript typechecking (`tsc --noEmit`), the full Node test
suite (34 tests), and the npm tarball inspection (`npm pack --dry-run`).

Evidence: `package.json#scripts`; local probe 2026-08-12 — green, 34/34 tests pass.

## Repository facts

- Published npm Pi extension for auditable, fail-open, Turso/libSQL-backed coding-progress memory
  (`pi-turso-memory`, MIT, public repo `ryan-brosas/pi-turso-memory`).
- TypeScript strict ESM, loaded directly from `src/index.ts` via `package.json` → `pi.extensions`.
- Node runtime: CI runs Node 22 (`.github/workflows/ci.yml`); local runs Node 26.7.0. Minimum
  supported versions are not declared in `package.json` — [NEEDS CLARIFICATION: min Node/Pi].
- Detailed architecture lives in `.pi/project.md`.

## Safety boundaries

- Never expose, invent, or commit credentials. `TURSO_AUTH_TOKEN` and embedding API keys are
  read from the environment only; secret redaction runs before any storage or export
  (`src/redact.ts`, `src/store/turso-store.ts`).
- Preserve unrelated and concurrent working-tree changes; stage only paths changed for the
  active task. The tree currently holds uncommitted embeddings work — do not touch it.
- Publishing and destructive Git operations are irreversible; require explicit confirmation.
  Rulesets already protect `main` and `refs/tags/v*` from force-push/deletion.
- Do not hand-edit gitignored `.pi/` harness state or `*.db*` files.

## Repository invariants

- Storage failures must fail open: Pi continues without memory rather than cancelling or throwing.
- Candidate memories are excluded from recall until explicit `/tm promote`.
- Config precedence: global settings < project settings < environment; local file DB fallback.
- `prepublishOnly` reruns the full release gate; release tags must equal `v<package.json version>`.
- Embeddings are optional and every failure fails open to lexical search; vector support is
  capability-probed at migration time and never required.

Evidence: `src/index.ts`; `src/config.ts`; `src/embed.ts`; `src/store/turso-store.ts`;
`tests/*`; `package.json`; `.github/workflows/release.yml`.

## Operational traps

- Releases are tag-driven: `git push origin main --follow-tags` triggers OIDC trusted publishing
  (no `NPM_TOKEN`). Follow `docs/releasing.md`, never `npm publish` manually.
- The package tarball ships `src`, `docs`, `README.md`, `LICENSE` only (`package.json#files`).
- A stray untracked `memory:` SQLite file can appear in the repo root if a probe runs with an
  invalid `databaseUrl`; do not commit it.
- FTS/vector support is optional; `search` is lexical plus reciprocal-rank fusion when vectors
  exist.

## Product map

- `src/index.ts` — Pi lifecycle integration, `/tm` commands, agent tools.
- `src/config.ts` — configuration loading and precedence.
- `src/embed.ts` — optional Voyage/OpenAI embeddings client.
- `src/store/` — schema, persistence, retrieval, migration, scope rules.
- `src/redact.ts` — secret detection/redaction boundary.
- `src/markdown.ts` — reviewable checkpoint inbox/archive artifacts.
- `tests/` — `node:test` unit and fake-`ExtensionAPI` integration coverage.

## Conventions

- Conventional commit style (`feat:`, `fix:`, `docs:`, `chore:`, `deps:`) is the observed
  history pattern — no mechanical checker enforces it.

## Verification evidence

Run `npm run release:check` before completion. CI reproduces it on Node 22
(`.github/workflows/ci.yml`); publishing is in `.github/workflows/release.yml`. Watch live with
`gh run list --repo ryan-brosas/pi-turso-memory`.
