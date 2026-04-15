export interface Chunk {
  heading: string;
  content: string;
}
export interface SplitOptions {
  maxTokens: number;
}

// 粗估：1 token ≈ 4 chars（足够用于上限切分）
const CHAR_PER_TOKEN = 4;

export function splitMarkdown(md: string, opts: SplitOptions): Chunk[] {
  const maxChars = opts.maxTokens * CHAR_PER_TOKEN;
  const lines = md.split("\n");
  const stack: string[] = [];
  const sections: { heading: string; content: string[] }[] = [];

  let current: { heading: string; content: string[] } | null = null;

  for (const line of lines) {
    const m = /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      const level = m[1].length;
      const title = m[2].trim();
      stack.length = level - 1;
      stack[level - 1] = title;
      current = { heading: stack.filter(Boolean).join(" > "), content: [] };
    } else if (current) {
      current.content.push(line);
    }
  }
  if (current) sections.push(current);

  const chunks: Chunk[] = [];
  for (const s of sections) {
    const body = s.content.join("\n").trim();
    if (!body) continue;
    if (body.length <= maxChars) {
      chunks.push({ heading: s.heading, content: body });
    } else {
      for (let i = 0; i < body.length; i += maxChars) {
        chunks.push({ heading: s.heading, content: body.slice(i, i + maxChars) });
      }
    }
  }
  return chunks;
}
