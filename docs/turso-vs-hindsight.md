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

## If semantic search is added later

The embedding model runs outside Turso; Turso stores the resulting numeric vector. Keep provider credentials out of the database.

A future schema can look like this (dimension must match the selected model):

```sql
CREATE TABLE memory_embeddings (
  memory_id TEXT NOT NULL REFERENCES memory_items(id),
  chunk_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  embedding F32_BLOB(1536) NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (memory_id, chunk_id, model)
);
```

The exact vector type/index syntax must be gated by the existing capability probe; local SQLite fallback may not support Turso's vector functions. A vector query would filter to `status = 'active'` and the project scope, then order by cosine distance. The production path should be **hybrid**:

1. redact content;
2. keep the exact text and provenance in `memory_items`;
3. generate embeddings asynchronously after promotion (not during tool capture or compaction);
4. store `model`, `dimensions`, and `content_hash` so model changes invalidate/rebuild vectors;
5. combine lexical and vector candidates with scope/status filters;
6. preserve source IDs and evidence in every returned hit.

Do not embed every raw tool event initially. Embed promoted decisions, lessons, procedures, failures/corrections, and checkpoints; leave the high-volume ledger lexical. A 1,536-dimensional float32 vector is about **6,144 raw bytes per chunk** before database/index overhead, so chunk count and model choice directly affect storage and cost.

Embeddings improve paraphrase matching; they do not replace extraction, review, provenance, freshness, or secret redaction. Hindsight's main advantage is its retain/reflect/mental-model pipeline, not merely that it may use vectors internally.

## Recommendation

1. Keep Turso as the authoritative ledger and reviewable memory store.
2. Benchmark lexical retrieval first using the metrics above.
3. Add optional, asynchronous embeddings only for promoted memories if Recall@5 for paraphrased coding questions is poor.
4. Consider Hindsight as an optional semantic/reflection layer, not as a reason to discard the auditable Turso source of truth.
