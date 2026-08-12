import type { TursoMemoryConfig } from "./config.ts";
import type { Embedder } from "./store/types.ts";

export type EmbeddingProvider = "voyage" | "openai";

export interface EmbedderOptions {
  provider: EmbeddingProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL: Record<EmbeddingProvider, string> = {
  voyage: "https://api.voyageai.com/v1",
  openai: "https://api.openai.com/v1",
};
const MAX_QUERY_CACHE_ENTRIES = 128;
const RETRY_ATTEMPTS = 3;

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
}

/**
 * OpenAI-compatible embeddings client (works with Voyage, OpenAI, and compatible
 * local gateways). Retries transient failures; callers still fail open on failure.
 */
export function createEmbedder(opts: EmbedderOptions): Embedder {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL[opts.provider]).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 20000;
  const queryCache = new Map<string, number[]>();

  return async (texts: string[]) => {
    const cached = texts.length === 1 ? queryCache.get(texts[0]!) : undefined;
    if (cached) return [cached];

    const body = JSON.stringify({ model: opts.model, input: texts });
    let failure: unknown;
    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
        const res = await fetch(`${baseUrl}/embeddings`, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          const responseBody = (await res.text()).slice(0, 300);
          failure = new Error(`embedding API ${res.status}: ${responseBody}`);
          if (!isTransientStatus(res.status)) break;
        } else {
          const data = (await res.json()) as { data?: { embedding?: number[] }[] };
          const vectors = (data.data ?? []).map((d) => d.embedding ?? []);
          if (vectors.length !== texts.length || vectors.some((v) => v.length === 0)) {
            throw new Error(`embedding API returned invalid vectors for ${texts.length} inputs`);
          }
          if (texts.length === 1) {
            queryCache.set(texts[0]!, vectors[0]!);
            if (queryCache.size > MAX_QUERY_CACHE_ENTRIES) queryCache.delete(queryCache.keys().next().value!);
          }
          return vectors;
        }
      } catch (error) {
        failure = error;
      }
      if (attempt + 1 < RETRY_ATTEMPTS) await retryDelay(attempt);
    }
    throw failure instanceof Error ? failure : new Error("embedding request failed");
  };
}

export interface EmbedderHandle {
  model: string;
  embed: Embedder;
}

/** Build an embedder from config; undefined when disabled or no usable provider is configured. */
export function embedderFromConfig(config: TursoMemoryConfig): EmbedderHandle | undefined {
  if (config.embeddingMode === "off") return undefined;
  const customEndpoint = config.embeddingBaseUrl.trim().length > 0;
  // An explicit empty env name is an opt-out: never forward ambient provider keys to a local gateway.
  const key =
    config.embeddingApiKeyEnv === ""
      ? undefined
      : process.env[config.embeddingApiKeyEnv] ??
        process.env[`${config.embeddingProvider.toUpperCase()}_API_KEY`];
  if (!key && !customEndpoint) return undefined;
  return {
    model: config.embeddingModel,
    embed: createEmbedder({
      provider: config.embeddingProvider,
      model: config.embeddingModel,
      apiKey: key,
      baseUrl: config.embeddingBaseUrl || undefined,
    }),
  };
}
