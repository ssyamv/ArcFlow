import { describe, it, expect } from "bun:test";
import { splitMarkdown } from "./rag-index";

describe("splitMarkdown", () => {
  it("splits by h1/h2/h3 headings", () => {
    const md = `# A\ntext1\n## B\ntext2\n# C\ntext3`;
    const chunks = splitMarkdown(md, { maxTokens: 1000 });
    expect(chunks.map((c) => c.heading)).toEqual(["A", "A > B", "C"]);
  });

  it("splits a long section into sub-chunks under token cap", () => {
    const long = "word ".repeat(2000);
    const md = `# H\n${long}`;
    const chunks = splitMarkdown(md, { maxTokens: 800 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.content.length).toBeLessThanOrEqual(800 * 4 + 50));
  });

  it("includes heading ancestry in heading field", () => {
    const md = `# A\n## B\n### C\ntext`;
    const chunks = splitMarkdown(md, { maxTokens: 1000 });
    expect(chunks[chunks.length - 1].heading).toBe("A > B > C");
  });
});
