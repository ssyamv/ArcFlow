import { describe, it, expect, afterEach } from "bun:test";
import { createEmbeddingClient } from "./llm-embedding";

describe("llm-embedding", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("batches up to 32 inputs per request", async () => {
    const calls: RequestInit[] = [];
    globalThis.fetch = (async (_url, init) => {
      calls.push(init!);
      const body = JSON.parse(init!.body as string);
      return new Response(
        JSON.stringify({
          data: body.input.map((_: string, i: number) => ({ embedding: [i, 0, 0, 0] })),
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const client = createEmbeddingClient({
      apiKey: "k",
      baseUrl: "http://x",
      model: "m",
      dim: 4,
    });
    const inputs = Array.from({ length: 70 }, (_, i) => `text-${i}`);
    const out = await client.embedBatch(inputs);

    expect(out.length).toBe(70);
    expect(calls.length).toBe(3); // 32 + 32 + 6
  });

  it("retries 3 times on 5xx then throws", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      return new Response("err", { status: 500 });
    }) as typeof fetch;
    const client = createEmbeddingClient({
      apiKey: "k",
      baseUrl: "http://x",
      model: "m",
      dim: 4,
    });
    await expect(client.embedBatch(["a"])).rejects.toThrow();
    expect(n).toBe(3);
  });

  it("rate limits to 5 req/s", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0, 0] }] }), {
        status: 200,
      })) as typeof fetch;
    const client = createEmbeddingClient({
      apiKey: "k",
      baseUrl: "http://x",
      model: "m",
      dim: 4,
      rps: 5,
    });
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 10 }, (_, i) => client.embedBatch([`${i}`])));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900); // 10 req @ 5 rps ~= 1s
  });
});
