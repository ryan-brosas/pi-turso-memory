# Turso-backed memory vs Hindsight

## Executive decision

Turso is not universally “better” than Hindsight: they solve different layers.

- **Turso/libSQL** is a database and synchronization substrate. Our plugin adds the coding-memory policy: progress ledger, provenance, Markdown exports, explicit review, and bounded injection.
- **Hindsight** is a remote memory engine. It provides automatic retain/recall/reflect behavior and server-side mental models, but requires a reachable Hindsight service and treats the upstream bank as the system of record.

For this plugin's stated goal — **auditable coding progression that remains useful when semantic services are unavailable** — Turso is the better foundation. Hindsight is the stronger choice if the priority is **automatic semantic extraction and reflection with minimal implementation work**.

Do not present the table below as a fake benchmark. The quantitative cells are measurement definitions; the qualitative cells are architectural facts from the current implementations. Run the same corpus and query set against both backends before making a performance claim.

## Decision metrics

| Metric | How to measure | Turso-backed plugin | Hindsight backend | Current winner for coding progression |
|---|---|---|---|---|
| Source-of-truth transparency | Can an operator inspect rows, SQL, hashes, events, and exports without a vendor-specific UI? | SQL schema + raw progress ledger + Markdown inbox/archive | Remote bank/API; server-side processing | **Turso** |
| Human reviewability | Candidate → review → active/rejected transition; inspectable artifact path | Explicit status gate and Markdown export | Automatic retain/consolidation; no equivalent local inbox gate in this integration | **Turso** |
| Provenance completeness | Fraction of recalled items with session, project, Git, event, and file references | First-class columns and JSON metadata | Hindsight returns memory records, but coding/Git provenance is application-managed | **Turso** |
| Offline/local operation | Run with network disabled; report successful capture and recall rate | Local `file:` fallback; fail-open behavior | Requires reachable Hindsight API for memory operations | **Turso** |
| Deployment components | Count required processes/services/secrets | One Pi extension; optional Turso sync | Pi + Hindsight HTTP service + auth/config | **Turso** |
| Exact coding retrieval | Recall@5 for paths, symbols, commands, error text, and IDs | Lexical SQL search is a good fit | Semantic service can work, but exact-match behavior must be measured | **Turso baseline** |
| Paraphrase retrieval | Recall@5/nDCG@10 for “the decision about…” style queries | Current implementation has no semantic index | Server-side recall/reflect is designed for this | **Hindsight** |
| Automatic synthesis | Human-rated usefulness of a multi-session answer | Not implemented; checkpoints/ledger are explicit | `reflect` and mental models are built in | **Hindsight** |
| Write latency | p50/p95 from event accepted to durable acknowledgement | Measure local and remote separately | Measure HTTP retain/retainBatch separately | **Measure** |
| Recall latency | p50/p95 from query to formatted context | Measure SQL + packet formatting | Measure API recall, including network | **Measure** |
| Failure isolation | Percentage of normal Pi turns that continue when memory fails | Fail-open by design | Depends on client/backend timeout and failure behavior | **Turso** |
| Cost predictability | Storage + reads/writes + egress + model/API calls per 1,000 events | Database cost plus optional embedding cost | Service cost plus retain/recall/reflect processing | **Turso baseline** |
| Semantic quality | Unsupported-memory rate and stale-memory rate in injected context | Explicit promotion makes the default conservative | Automatic retention can increase coverage and noise | **Turso for safety; measure quality** |

### Metrics to collect

Use a fixed corpus of the same sanitized Pi sessions and a labelled query set. At minimum collect:

```text
write_p50_ms, write_p95_ms
recall_p50_ms, recall_p95_ms
cold_start_ms
successful_operations / total_operations
Recall@1, Recall@5, nDCG@10, MRR
unsupported_injection_rate
stale_memory_rate
bytes_per_memory_item
cost_per_1,000_events
```

Definitions:

- `Recall@k = relevant results in top k / total relevant results`
- `MRR = mean(1 / rank of the first relevant result)`
- `unsupported_injection_rate = injected memories lacking a supporting source/evidence record / injected memories`
- `stale_memory_rate = recalled memories a reviewer marks obsolete / recalled memories`
- Latency must be reported separately for local-file Turso, remote Turso, and Hindsight-over-HTTP. Do not compare a local SQLite result to a remote HTTP result without labelling the deployment.

A useful coding-memory weighting is: retrieval correctness 30%, provenance/audit 20%, failure isolation 15%, p95 latency 15%, operational simplicity 10%, cost 10%. This weighting favors Turso **for this project**, while a workload that gives most weight to paraphrase retrieval and reflection will favor Hindsight.

## What is currently measured in this repository

The test suite proves behavior, not production performance:

- local schema migration and store operations complete successfully;
- compaction checkpointing and provenance work;
- candidates remain hidden until promotion;
- secrets are redacted before persistence and injection;
- disabled storage does not break Pi.

The test timings are not a benchmark. A real comparison needs the fixed corpus, warm/cold runs, the same query labels, and a reachable Hindsight instance.

## Do I need to put embeddings in Turso?

**Not for the current plugin.** Today it stores:

- progress events and their redacted summaries/evidence;
- project/session/Git/file provenance;
- working state;
- candidate/active memory text, tags, confidence, and evidence metadata;
- Markdown export records.

Vector similarity search is native to libSQL Server: it stores `vector32` values and ranks
  them in SQL. Embedding *generation* runs outside the database — the optional Docker stack
  (see `docker/`) generates vectors with Voyage and backfills `memory_embeddings`. `search()`
  uses FTS5 lexical matching with a scoped SQL `LIKE` fallback.

Start without embeddings. Exact paths, symbols, commands, error messages, and test names are common coding-memory queries, and lexical search is strong for those. Add embeddings only when a labelled query set demonstrates a meaningful paraphrase-recall gap.

## Where semantic search lives now

The embedding model runs outside Turso (Voyage, reached through the Docker gateway); Turso stores the resulting numeric vector. Provider credentials never enter the database or the extension.

The Docker stack (`docker-compose.yml`, `docker/embedder/worker.mjs`) owns the pipeline:

- it creates `memory_embeddings` with a `vector32` BLOB column plus `model`, `dim`, and `updated_at`
  so model or dimension changes invalidate old rows;
- it attempts a native ANN index (`libsql_vector_idx(vector, 'metric=cosine')`) and falls back to
  plain `vector32` ranking when the build lacks it;
- it backfills rows for memory items that have no vector or a stale model, in batches of 16,
  calling the local gateway's `/v1/embeddings` (keyless from the worker's perspective).

The extension itself stays lexical (FTS5 with a LIKE fallback) and does not consume vectors yet.
Fusing lexical and vector hits (hybrid ranking) remains a future step, worth adding only if a
labelled query set shows a real paraphrase-recall gap for coding questions.

Do not embed every raw tool event. Embed promoted decisions, lessons, procedures, failures/corrections, and checkpoints; leave the high-volume ledger lexical. Vector cost scales with the model: `voyage-4-lite` is 1,024 dimensions (4,096 bytes per `vector32` row) before index overhead.

## Recommendation

1. Keep Turso as the authoritative ledger and reviewable memory store.
2. Benchmark lexical retrieval first using the metrics above.
3. If paraphrased-coding Recall@5 is poor, bring up the Docker embedder (or tune its model) so
   `memory_embeddings` stays fresh; the extension remains lexical until hybrid fusion lands.
4. Consider Hindsight as an optional semantic/reflection layer, not as a reason to discard the auditable Turso source of truth.
