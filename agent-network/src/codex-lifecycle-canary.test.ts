import { describe, expect, test } from "bun:test";
import { formatCanarySummary, runCanary } from "./codex-lifecycle-canary.js";

const ok = { verdict: "PASS" as const, blocking: [], receiptPath: "/r/ok.json" };
const bad = { verdict: "FAIL" as const, blocking: ["identity_attested"], receiptPath: "/r/bad.json" };

describe("#1856 PR-E canary", () => {
  test("runs in order and stops at the first FAIL; later nodes are reported as not run", async () => {
    const calls: string[] = [];
    const s = await runCanary(["a", "b", "c", "d"], async (alias) => { calls.push(alias); return alias === "b" ? bad : ok; });
    expect(calls).toEqual(["a", "b"]);
    expect(s.verdict).toBe("FAIL");
    expect(s.stoppedAt).toBe("b");
    expect(s.skipped).toEqual(["c", "d"]);
    expect(s.ran.map((r) => r.verdict)).toEqual(["PASS", "FAIL"]);
    expect(formatCanarySummary(s)).toContain("⏭  c  not run (stopped at b)");
    expect(formatCanarySummary(s)).toContain("canary FAIL: 1/4 pass, 2 not run");
  });
  test("all PASS → PASS with nothing skipped; duplicates and blanks collapse; a thrown verify counts as FAIL", async () => {
    const s = await runCanary(["a", " a ", "", "b"], async () => ok);
    expect(s.verdict).toBe("PASS");
    expect(s.ran.map((r) => r.alias)).toEqual(["a", "b"]);
    const t = await runCanary(["x"], async () => { throw new Error("boom"); });
    expect(t.verdict).toBe("FAIL");
    expect(t.ran[0].blocking).toEqual(["error: boom"]);
    await expect(runCanary([], async () => ok)).rejects.toThrow(/at least one/);
  });
  test("per-node timing uses the injected clock", async () => {
    let t = 0;
    const s = await runCanary(["a"], async () => ok, () => (t += 250));
    expect(s.ran[0].ms).toBe(250);
  });
});
