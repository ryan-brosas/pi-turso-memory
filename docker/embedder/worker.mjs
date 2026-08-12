import { createClient } from "@libsql/client";

const TURSO_URL = process.env.TURSO_URL ?? "http://turso:8080";
const EMBED_URL = process.env.EMBED_URL ?? "http://voyage-gateway:8080/v1";
const MODEL = process.env.MODEL ?? "voyage-4-lite";
const POLL_MS = Number(process.env.POLL_MS ?? 30000);
const RUN_ONCE = process.env.RUN_ONCE === "true";
const BATCH = 16;

const client = createClient({ url: TURSO_URL });

async function initSchema() {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS memory_embeddings (
         memory_id TEXT PRIMARY KEY,
         model TEXT NOT NULL,
         dim INTEGER NOT NULL,
         vector BLOB NOT NULL,
         updated_at TEXT NOT NULL
       )`,
    ],
    "write",
  );
  try {
    await client.execute(
      `CREATE INDEX IF NOT EXISTS memory_embeddings_ann
       ON memory_embeddings (libsql_vector_idx(vector, 'metric=cosine'))`,
    );
  } catch {
    /* ANN index is best-effort; plain vector32 ranking still works */
  }
}

async function embed(texts) {
  const res = await fetch(`${EMBED_URL}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`embedding API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.data ?? []).map((d) => d.embedding);
}

async function runOnce() {
  const res = await client.execute({
    sql: `SELECT m.id, m.title, m.content FROM memory_items m
          LEFT JOIN memory_embeddings e ON e.memory_id = m.id
          WHERE e.memory_id IS NULL OR e.model <> ? ORDER BY m.updated_at DESC LIMIT 1000`,
    args: [MODEL],
  });
  let done = 0;
  for (let i = 0; i < res.rows.length; i += BATCH) {
    const batch = res.rows.slice(i, i + BATCH);
    const texts = batch.map((r) => `${r.title}\n${r.content}`);
    const vectors = await embed(texts);
    for (let j = 0; j < batch.length; j++) {
      const vec = vectors[j];
      if (vec && vec.length > 0) {
        await client.execute({
          sql: `INSERT INTO memory_embeddings (memory_id, model, dim, vector, updated_at)
                VALUES (?, ?, ?, vector32(?), ?)
                ON CONFLICT(memory_id) DO UPDATE SET
                  model = excluded.model, dim = excluded.dim, vector = excluded.vector,
                  updated_at = excluded.updated_at`,
          args: [
            String(batch[j].id),
            MODEL,
            vec.length,
            JSON.stringify(vec),
            new Date().toISOString(),
          ],
        });
      }
    }
    done += batch.length;
  }
  return done;
}

await initSchema();
if (RUN_ONCE) {
  const done = await runOnce();
  console.log(`embedded ${done} item(s)`);
  process.exit(0);
}
console.log(`embedder watching ${TURSO_URL} every ${POLL_MS}ms (model ${MODEL})`);
for (;;) {
  try {
    const done = await runOnce();
    if (done > 0) console.log(`embedded ${done} item(s)`);
  } catch (err) {
    console.error(`embed pass failed: ${err?.message ?? err}`);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
