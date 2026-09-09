// #1856 PR-A —— 事实层的纯部分:rollout 精确后缀匹配、进程树、argv -C 解析、env 文件指纹;tmux/proc 用注入的原语。
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { descendants, envFileTokenFingerprint, findRollouts, gatherCodexFacts, type FactPrimitives } from "./codex-lifecycle-facts";
import { shortFingerprint } from "./codex-lifecycle-receipt";

const cleanup: string[] = [];
afterEach(() => { for (const p of cleanup.splice(0)) rmSync(p, { recursive: true, force: true }); });
const T = "01a02193-e1fd-70f3-9e16-6fbff295fbae";
const T2 = "01a02193-e1fd-70f3-9e16-6fbff295fbaf";

function home(): string {
  const h = mkdtempSync(join(tmpdir(), "anet-codex-home-")); cleanup.push(h);
  mkdirSync(join(h, "sessions/2026/09/01"), { recursive: true });
  writeFileSync(join(h, "sessions/2026/09/01", `rollout-2026-09-01T10-00-00-${T}.jsonl`), "x".repeat(10));
  writeFileSync(join(h, "sessions/2026/09/01", `rollout-2026-09-01T11-00-00-${T2}.jsonl`), "y".repeat(20));
  return h;
}

describe("findRollouts", () => {
  test("matches only the exact full thread id suffix — the near-identical sibling is not a match", () => {
    const h = home();
    const hits = findRollouts(h, T);
    expect(hits.length).toBe(1);
    expect(hits[0].path.endsWith(`-${T}.jsonl`)).toBe(true);
    expect(hits[0].bytes).toBe(10);
    expect(findRollouts(h, T.slice(0, 8)).length).toBe(0);   // 前缀不匹配
    expect(findRollouts(h, null).length).toBe(0);
  });
  test("two rollouts for the same thread are both returned (caller refuses ambiguity)", () => {
    const h = home();
    mkdirSync(join(h, "sessions/2026/09/02"), { recursive: true });
    writeFileSync(join(h, "sessions/2026/09/02", `rollout-2026-09-02T10-00-00-${T}.jsonl`), "z");
    expect(findRollouts(h, T).length).toBe(2);
  });
});

describe("env file token fingerprint", () => {
  test("reads the quoted token and returns only its fingerprint", () => {
    const h = home();
    writeFileSync(join(h, ".anet-copresence.env"), "export ANET_CODEX_COMMHUB_TOKEN='ntok_secret_value'\n");
    expect(envFileTokenFingerprint(h)).toBe(shortFingerprint("ntok_secret_value"));
    expect(envFileTokenFingerprint(join(h, "nope"))).toBeNull();
  });
});

function fakePrims(overrides: Partial<FactPrimitives> = {}): FactPrimitives {
  const tree: Record<number, number | null> = { 10: 1, 11: 10, 12: 11, 20: 1, 21: 20, 30: 1, 31: 30 };
  return {
    tmuxPanePid: (s) => ({ "x-appsrv": 10, "x": 20, "x-桥": 30 } as Record<string, number>)[s] ?? null,
    listPids: () => Object.keys(tree).map(Number),
    procStatPpid: (pid) => tree[pid] ?? null,
    procCwd: () => "/w",
    procArgv: (pid) => pid === 12 ? ["codex", "app-server", "--port", "24703"] : pid === 21 ? ["codex", "resume", "-C", "/w", T] : pid === 31 ? ["agent-node", "--bridge"] : ["sh"],
    procEnviron: (pid) => (pid === 12 || pid === 21 || pid === 31) ? { CODEX_HOME: "/h", ANET_CODEX_COMMHUB_TOKEN: "ntok_a", ANET_NODE_MARKER: "m-1" } : {},
    listeningPid: () => 12,
    hubNodeIdFor: async () => "n_1",
    ...overrides,
  };
}

describe("process tree + gather", () => {
  test("descendants walks the whole subtree", () => {
    expect(descendants(fakePrims(), 10)).toEqual([10, 11, 12]);
  });
  test("gather picks the codex TUI (not the app-server) for cwd/-C, the bridge cwd, and only env-bearing children", async () => {
    const f = await gatherCodexFacts(fakePrims(), {
      alias: "x", nodeId: "n_1", nodeDir: "/n", codexHome: "/h", configToken: "ntok_a", codexProjectDir: "/w", codexThreadId: T,
      codexAppServerUrl: "ws://127.0.0.1:24703", sessions: { appsrv: "x-appsrv", bridge: "x-桥", tui: "x" }, recordedPids: { appsrv: 10, bridge: 30, tui: 20 }, markerUuid: "m-1",
    });
    expect(f.topology.liveMarkers.tui).toEqual([null, "m-1"]);
    expect(f.topology.liveHomes.tui).toEqual([null, "/h"]);
    expect(f.workdir.tuiArgvDir).toBe("/w");
    expect(f.workdir.bridgeProjectDir).toBe("/w");
    expect(f.port.owner?.pid).toBe(12);
    expect(f.children.map((c) => c.pid)).toEqual([12, 21, 31]);
    expect(f.children.every((c) => c.tokenFingerprint === shortFingerprint("ntok_a"))).toBe(true);
    expect(JSON.stringify(f)).not.toContain("ntok_a");   // 事实里也只有指纹
    expect(f.topology.live).toEqual({ appsrv: 10, bridge: 30, tui: 20 });
    expect(f.hubNodeId).toBe("n_1");
  });
  test("stopped node: no panes → no children, topology all null, hub unreachable → null", async () => {
    const f = await gatherCodexFacts(fakePrims({ tmuxPanePid: () => null, listeningPid: () => null, hubNodeIdFor: async () => null }), {
      alias: "x", nodeId: "n_1", nodeDir: "/n", codexHome: "/h", configToken: null, codexProjectDir: null, codexThreadId: null,
      codexAppServerUrl: null, sessions: { appsrv: "x-appsrv", bridge: "x-桥", tui: "x" }, recordedPids: { appsrv: null, bridge: null, tui: null }, markerUuid: null,
    });
    expect(f.children).toEqual([]);
    expect(f.topology.live).toEqual({ appsrv: null, bridge: null, tui: null });
    expect(f.port).toEqual({ port: null, owner: null });
    expect(f.hubNodeId).toBeNull();
  });
});
