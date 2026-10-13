import { describe, expect, it } from "vitest";
import fixture from "../../src-tauri/src/ai/fixtures/contracts/snapshot.json";
import { parseSnapshot } from "./types";
describe("AI snapshot contract", () => {
  it("keeps exact decimal strings and user-provided provenance", () => {
    const snapshot = parseSnapshot(fixture);
    expect(snapshot.referencePrice).toBe("123.45");
    expect(snapshot.evidence[0]?.kind).toBe("userProvided");
    expect(snapshot.evidence[0]?.publishedAt).toBeNull();
  });
  it("accepts ETF and empty evidence, rejects mismatched stock identity", () => {
    expect(
      parseSnapshot({
        ...fixture,
        security: { ...fixture.security, asset: "etf" },
        evidence: [],
      }).evidence,
    ).toEqual([]);
    expect(() =>
      parseSnapshot({
        ...fixture,
        security: { ...fixture.security, id: "sz000001" },
      }),
    ).toThrow();
  });
});
