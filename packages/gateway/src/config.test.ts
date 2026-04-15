import { describe, expect, it } from "bun:test";
import { getConfig } from "./config";

describe("config", () => {
  it("returns default values when env vars are not set", () => {
    const config = getConfig();
    expect(config.port).toBe(3100);
    expect(config.claudeCodeTimeout).toBe(600000);
  });

  it("reads PORT from env", () => {
    const original = process.env.PORT;
    process.env.PORT = "8080";
    const config = getConfig();
    expect(config.port).toBe(8080);
    process.env.PORT = original;
  });
});
