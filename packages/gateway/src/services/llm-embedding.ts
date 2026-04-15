interface EmbeddingClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dim: number;
  batchSize?: number;
  rps?: number;
  maxRetries?: number;
}

export interface EmbeddingClient {
  embedBatch(inputs: string[]): Promise<number[][]>;
}

export function createEmbeddingClient(cfg: EmbeddingClientConfig): EmbeddingClient {
  const batchSize = cfg.batchSize ?? 32;
  const rps = cfg.rps ?? 5;
  const maxRetries = cfg.maxRetries ?? 3;

  let lastSlot = 0;
  async function acquireSlot() {
    const minGap = 1000 / rps;
    const now = Date.now();
    const next = Math.max(now, lastSlot + minGap);
    lastSlot = next;
    if (next > now) await Bun.sleep(next - now);
  }

  async function callOnce(inputs: string[]): Promise<number[][]> {
    const res = await fetch(`${cfg.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, input: inputs }),
    });
    if (!res.ok) throw new Error(`embedding http ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }

  async function callWithRetry(inputs: string[]): Promise<number[][]> {
    let err: unknown;
    for (let i = 0; i < maxRetries; i++) {
      try {
        await acquireSlot();
        return await callOnce(inputs);
      } catch (e) {
        err = e;
        await Bun.sleep(200 * (i + 1));
      }
    }
    throw err;
  }

  return {
    async embedBatch(inputs) {
      const out: number[][] = [];
      for (let i = 0; i < inputs.length; i += batchSize) {
        const chunk = inputs.slice(i, i + batchSize);
        out.push(...(await callWithRetry(chunk)));
      }
      return out;
    },
  };
}
