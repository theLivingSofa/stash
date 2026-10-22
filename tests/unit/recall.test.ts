import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => ({}), must: (r: { data: unknown }) => r.data }));
vi.mock("@/lib/llm", () => ({ createRouter: () => ({}) }));

const { parseQuestion } = await import("@/lib/recall");

describe("recall question cleanup", () => {
  it("reads the JSON reply", () => {
    expect(parseQuestion('{"question": "What drives how far words spread between languages?"}')).toBe(
      "What drives how far words spread between languages?",
    );
  });
  it("keeps a clean question", () => {
    expect(parseQuestion("Why do city leaders invest public money like venture capitalists?")).toBe(
      "Why do city leaders invest public money like venture capitalists?",
    );
  });
  it("strips labels, quotes and extra lines", () => {
    expect(parseQuestion('Question: "What made porcelain hard to copy in Europe?"\nAnswer: kaolin')).toBe(
      "What made porcelain hard to copy in Europe?",
    );
  });
  it("rejects non-questions and runaway text", () => {
    expect(() => parseQuestion("Porcelain needed kaolin.")).toThrow();
    expect(() => parseQuestion(`${"word ".repeat(60)}?`)).toThrow();
  });
});
