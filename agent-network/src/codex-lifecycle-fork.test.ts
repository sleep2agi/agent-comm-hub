import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FORK_HOME_COPY, FORK_HOME_NEVER_COPY, checkForkIsolation, forkRolloutPath, rewriteRollout, uuidV7 } from "./codex-lifecycle-fork.js";
import { receiptVerdict, type ReceiptCheck } from "./codex-lifecycle-receipt.js";

const SRC = "01a02193-e1fd-70f3-9e16-6fbff295fbae";
const NEW = "01a0aaaa-0000-7000-8000-000000000001";
const meta = (id: string) => JSON.stringify({ timestamp: "2026-08-20T23:48:55Z", type: "session_meta", payload: { id, session_id: id, cwd: "/w" } });

function fixture(lines: string[]): { dir: string; src: string } {
  const dir = mkdtempSync(join(tmpdir(), "anet-fork-"));
  const src = join(dir, "src.jsonl");
  writeFileSync(src, lines.join("\n") + "\n");
  return { dir, src };
}

describe("#1856 PR-C fork: rollout rewrite", () => {
  test("rewrites every occurrence of the source id, keeps byte size, writes 0600 into a fresh path", async () => {
    const { dir, src } = fixture([meta(SRC), `{"type":"event","payload":{"turn":"x","session":"${SRC}"}}`, `{"type":"msg","payload":{"text":"no id here"}}`]);
    const dst = join(dir, "sessions", "2026", "09", "09", `rollout-x-${NEW}.jsonl`);
    const r = await rewriteRollout(src, dst, SRC, NEW);
    expect(r.lines).toBe(3);
    expect(r.replacements).toBe(3); // id + session_id on line 1, session on line 2
    expect(r.bytesIn).toBe(r.bytesOut);
    expect(statSync(dst).size).toBe(r.bytesOut);
    expect(statSync(dst).mode & 0o777).toBe(0o600);
    const out = readFileSync(dst, "utf8");
    expect(out.includes(SRC)).toBe(false);
    expect(JSON.parse(out.split("\n")[0]).payload.session_id).toBe(NEW);
  });

  test("first line not session_meta for the source id → refuses before writing anything", async () => {
    const { dir, src } = fixture([meta("01a02193-e1fd-70f3-9e16-6fbff295fbaf"), "{}"]);
    const dst = join(dir, "out.jsonl");
    await expect(rewriteRollout(src, dst, SRC, NEW)).rejects.toThrow(/not session_meta/);
    expect(existsSync(dst)).toBe(false);
    const bad = fixture(["not json", "{}"]);
    await expect(rewriteRollout(bad.src, join(bad.dir, "o.jsonl"), SRC, NEW)).rejects.toThrow(/not JSON/);
    expect(existsSync(join(bad.dir, "o.jsonl"))).toBe(false);
  });

  test("refuses same id, malformed ids, existing target, and empty source", async () => {
    const { dir, src } = fixture([meta(SRC)]);
    await expect(rewriteRollout(src, join(dir, "a.jsonl"), SRC, SRC)).rejects.toThrow(/equals/);
    await expect(rewriteRollout(src, join(dir, "b.jsonl"), "01a0", NEW)).rejects.toThrow(/36-char/);
    writeFileSync(join(dir, "c.jsonl"), "x");
    await expect(rewriteRollout(src, join(dir, "c.jsonl"), SRC, NEW)).rejects.toThrow(/already exists/);
    const empty = fixture([]);
    writeFileSync(empty.src, "");
    await expect(rewriteRollout(empty.src, join(empty.dir, "d.jsonl"), SRC, NEW)).rejects.toThrow(/first line|empty/);
  });
});

describe("#1856 PR-C fork: ids, paths, copy policy", () => {
  test("uuidV7 has version 7 / variant 10 and sorts after an older one", () => {
    const rand = new Uint8Array(10).fill(0xab);
    const a = uuidV7(Date.UTC(2026, 8, 9, 1, 0, 0), rand);
    const b = uuidV7(Date.UTC(2026, 8, 9, 1, 0, 1), rand);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(() => uuidV7(1, new Uint8Array(3))).toThrow();
  });
  test("forkRolloutPath follows codex's sessions/YYYY/MM/DD/rollout-<stamp>-<id>.jsonl layout (UTC)", () => {
    const p = forkRolloutPath("/h", new Date(Date.UTC(2026, 8, 9, 3, 4, 5)), NEW);
    expect(p).toBe(`/h/sessions/2026/09/09/rollout-2026-09-09T03-04-05-${NEW}.jsonl`);
  });
  test("copy policy: auth.json required and 0600; env file / history / sqlite / sessions never copied", () => {
    expect(FORK_HOME_COPY.find((f) => f.name === "auth.json")).toEqual({ name: "auth.json", required: true, mode: 0o600 });
    for (const n of [".anet-copresence.env", "history.jsonl", "sessions", "logs_2.sqlite"]) expect(FORK_HOME_NEVER_COPY).toContain(n);
    for (const f of FORK_HOME_COPY) expect(FORK_HOME_NEVER_COPY).not.toContain(f.name);
  });
});

describe("#1856 PR-C fork: fork_isolation", () => {
  const ok = () => ({
    source: { nodeId: "n_a", homeReal: "/a/codex-home", threadId: SRC, alias: "源", rolloutInode: 1, rolloutBytes: 100 },
    target: { nodeId: "n_b", homeReal: "/b/codex-home", threadId: NEW, alias: "叉", rolloutInode: 2, rolloutBytes: 100, envFilePresent: false },
    rewrite: { lines: 3, bytesIn: 100, bytesOut: 100, replacements: 3 },
  });
  test("all five distinct + byte-equal rewrite → pass", () => {
    const c = checkForkIsolation(ok());
    expect(c.status).toBe("pass");
    expect(c.evidence).toMatchObject({ targetThread: NEW, idReplacements: 3 });
  });
  test("each shared identity fails on its own", () => {
    const cases: Array<[string, (s: any) => void]> = [
      ["node_id", (s) => { s.target.nodeId = "n_a"; }],
      ["CODEX_HOME", (s) => { s.target.homeReal = "/a/codex-home"; }],
      ["thread id", (s) => { s.target.threadId = SRC; }],
      ["alias", (s) => { s.target.alias = "源"; }],
      ["rollout not a separate", (s) => { s.target.rolloutInode = 1; }],
      ["size changed", (s) => { s.rewrite.bytesOut = 99; }],
      ["never appeared", (s) => { s.rewrite.replacements = 0; }],
      ["env file", (s) => { s.target.envFilePresent = true; }],
      ["not rewritten", (s) => { s.rewrite = null; }],
    ];
    for (const [needle, mutate] of cases) {
      const s = ok(); mutate(s);
      const c = checkForkIsolation(s);
      expect(c.status).toBe("fail");
      expect(c.detail).toContain(needle);
    }
  });
});

describe("#1856 PR-C fork verdict", () => {
  const pass = (key: string): ReceiptCheck => ({ key, status: "pass", detail: "ok" });
  const req = ["identity_match", "fork_isolation", "home_isolated", "workdir_consistent", "session_exact"].map(pass);
  test("a source-side fail (its own workdir gap) is informational; a target-side extra fail still blocks", () => {
    const withSourceGap = [...req, { key: "source:workdir_consistent", status: "fail", detail: "config.codexProjectDir is missing" } as ReceiptCheck, { key: "identity_attested", status: "unknown", detail: "not started" } as ReceiptCheck];
    expect(receiptVerdict("fork", withSourceGap)).toEqual({ verdict: "PASS", blocking: [] });
    const withTargetGap = [...req, { key: "port_owner_verified", status: "fail", detail: "foreign" } as ReceiptCheck];
    expect(receiptVerdict("fork", withTargetGap).blocking).toEqual(["port_owner_verified"]);
  });
  test("fork does not require identity_attested but does require session_exact on the target", () => {
    expect(receiptVerdict("fork", req.filter((c) => c.key !== "session_exact")).blocking).toEqual(["session_exact"]);
  });
});
