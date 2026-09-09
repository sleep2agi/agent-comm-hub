import { describe, expect, test } from "bun:test";
import { beforeGateBlocks, orderedStop, runCodexRestart, type GateResult, type RestartActions } from "./codex-lifecycle-restart.js";
import { receiptVerdict, type ReceiptCheck } from "./codex-lifecycle-receipt.js";

const ok = (key: string): ReceiptCheck => ({ key, status: "pass", detail: "ok" });
const unk = (key: string): ReceiptCheck => ({ key, status: "unknown", detail: "no evidence" });
const bad = (key: string): ReceiptCheck => ({ key, status: "fail", detail: "mismatch" });
const PRE = ["identity_match", "home_isolated", "workdir_consistent", "session_exact", "rollout_intact", "port_owner_verified", "goal_state_known", "topology_consistent"];
const VER = [...PRE.filter((k) => k !== "goal_state_known"), "child_env_attested", "identity_attested"];
const roll = (bytes: number, inode = 7) => ({ path: "/h/sessions/2026/09/09/rollout-x.jsonl", inode, bytes, mtimeMs: 1 });

function gate(keys: string[], over: Partial<Record<string, ReceiptCheck["status"]>> = {}, rollout = roll(100)): GateResult {
  return {
    checks: keys.map((k) => (over[k] === "fail" ? bad(k) : over[k] === "unknown" ? unk(k) : ok(k))),
    rollout,
    port: { port: 4501, ownerPid: 1, ownerIsOurs: true },
  };
}

function actions(over: Partial<RestartActions> & { log?: string[] } = {}): RestartActions & { log: string[] } {
  const log = over.log ?? [];
  const base: RestartActions = {
    gate: async (phase) => { log.push(`gate:${phase}`); return phase === "before" ? gate(PRE, { workdir_consistent: "unknown" }) : gate(VER, { identity_attested: "unknown" }, roll(120)); },
    goalState: async () => ({ state: "active", fingerprint: "g1" }),
    liveSessions: async () => ({ bridge: true, tui: false, appsrv: true }),
    stopSession: async (role) => { log.push(`stop:${role}`); return { ok: true, detail: "gone" }; },
    waitRolloutSettled: async (b) => { log.push("settle"); return b; },
    waitPortFree: async () => { log.push("port"); return { free: true, ownerPid: null, ownerIsOurs: null }; },
    termOwnedPid: async (pid) => { log.push(`term:${pid}`); return { ok: true, detail: "" }; },
    start: async () => { log.push("start"); return { ok: true, detail: "就绪" }; },
    waitHubOnline: async () => ({ ok: true, detail: "online in 3s" }),
    nonceProbe: async () => ({ ok: true, detail: "peer got nonce back from alias", evidence: { nonce: "n1" } }),
  };
  const merged = Object.assign(base, over) as RestartActions;
  // 覆盖项也要进 log:顺序断言看的是「哪些动作被调了」,不是「谁实现的」。
  const logged: RestartActions = {
    ...merged,
    gate: async (phase) => { if (over.gate) log.push(`gate:${phase}`); return merged.gate(phase); },
    stopSession: async (role) => { if (over.stopSession) log.push(`stop:${role}`); return merged.stopSession(role); },
    start: async () => { if (over.start) log.push("start"); return merged.start(); },
    nonceProbe: over.nonceProbe === undefined && "nonceProbe" in over ? undefined : merged.nonceProbe,
  };
  return Object.assign(logged, { log });
}

describe("#1856 PR-B restart state machine", () => {
  test("happy path: stop Bridge→TUI(absent)→App Server, start, verify, PASS", async () => {
    const a = actions();
    const out = await runCodexRestart("restart", a);
    expect(out.stoppedAt).toBe("done");
    expect(a.log).toEqual(["gate:before", "stop:bridge", "stop:appsrv", "settle", "port", "start", "gate:after"]);
    expect(receiptVerdict("restart", out.checks).verdict).toBe("PASS");
    const stop = out.checks.find((c) => c.key === "stop_order")!;
    expect(stop.evidence).toEqual({ order: ["bridge:stopped", "tui:absent", "appsrv:stopped"] });
    // before 阶段的 unknown(TUI 已死拿不到 cwd)不能沉掉 after 的判决 —— 键带前缀。
    expect(out.checks.find((c) => c.key === "before:workdir_consistent")!.status).toBe("unknown");
    expect(out.checks.find((c) => c.key === "workdir_consistent")!.status).toBe("pass");
  });

  test("before-phase fail → nothing touched", async () => {
    const a = actions({ gate: async (phase) => (phase === "before" ? gate(PRE, { identity_match: "fail" }) : gate(VER)) });
    const out = await runCodexRestart("restart", a);
    expect(out.stoppedAt).toBe("preflight_before");
    expect(a.log).toEqual(["gate:before"]);
    expect(receiptVerdict("restart", out.checks).verdict).toBe("FAIL");
  });

  test("before-phase unknown is allowed (dead TUI), fail is not", () => {
    expect(beforeGateBlocks([ok("a"), unk("b")])).toEqual([]);
    expect(beforeGateBlocks([ok("a"), bad("b"), unk("c")])).toEqual(["b"]);
  });

  test("goal state unknown → STOP before any process is touched", async () => {
    const a = actions({ goalState: async () => ({ state: "unknown", fingerprint: null }) });
    const out = await runCodexRestart("restart", a);
    expect(out.stoppedAt).toBe("goal_state");
    expect(a.log).toEqual(["gate:before"]);
    expect(out.checks.find((c) => c.key === "goal_state_preserved")!.status).toBe("fail");
  });

  test("goal file changed across restart → goal_state_preserved fail, verdict FAIL", async () => {
    let n = 0;
    const a = actions({ goalState: async () => ({ state: "active", fingerprint: n++ === 0 ? "g1" : "g2" }) });
    const out = await runCodexRestart("restart", a);
    expect(out.checks.find((c) => c.key === "goal_state_preserved")!.status).toBe("fail");
    expect(receiptVerdict("restart", out.checks).verdict).toBe("FAIL");
  });

  test("stop failure halts the chain in order (bridge fails → TUI/app-server untouched)", async () => {
    const a = actions({ liveSessions: async () => ({ bridge: true, tui: true, appsrv: true }), stopSession: async (role) => ({ ok: role !== "bridge", detail: role === "bridge" ? "tmux kill-session refused" : "gone" }) });
    const out = await runCodexRestart("restart", a);
    expect(out.stoppedAt).toBe("stop");
    expect(out.checks.find((c) => c.key === "stop_order")!.status).toBe("fail");
    expect(a.log.filter((l) => l.startsWith("stop:"))).toEqual(["stop:bridge"]);
  });

  test("port held by our stale app-server → targeted TERM then continue", async () => {
    let calls = 0;
    const a = actions({ waitPortFree: async () => (calls++ === 0 ? { free: false, ownerPid: 4242, ownerIsOurs: true } : { free: true, ownerPid: null, ownerIsOurs: null }) });
    const out = await runCodexRestart("restart", a);
    expect(out.stoppedAt).toBe("done");
    expect(a.log).toContain("term:4242");
  });

  test("port held by a foreign pid → FAIL, never TERM", async () => {
    const a = actions({ waitPortFree: async () => ({ free: false, ownerPid: 99, ownerIsOurs: false }) });
    const out = await runCodexRestart("restart", a);
    expect(out.stoppedAt).toBe("port_foreign");
    expect(a.log.some((l) => l.startsWith("term:"))).toBe(false);
    expect(a.log).not.toContain("start");
  });

  test("launcher fails → rollback = ordered cleanup + one re-launch; second failure leaves it stopped", async () => {
    const a = actions({ start: async () => ({ ok: false, detail: "app-server did not bind" }) });
    const out = await runCodexRestart("restart", a);
    expect(out.stoppedAt).toBe("start");
    expect(out.rolledBack).toBe(true);
    expect(a.log.filter((l) => l === "start").length).toBe(2);
    expect(out.checks.find((c) => c.key === "rollback_stop")).toBeDefined();
    expect(out.checks.find((c) => c.key === "rollback_start")!.status).toBe("fail");
  });

  test("launcher fails once, rollback re-launch succeeds → continues to verify and can PASS", async () => {
    let n = 0;
    const a = actions({ start: async () => ({ ok: n++ > 0, detail: n > 1 ? "就绪" : "flaky" }) });
    const out = await runCodexRestart("restart", a);
    expect(out.rolledBack).toBe(true);
    expect(out.stoppedAt).toBe("done");
    expect(out.checks.find((c) => c.key === "rollback_start")!.status).toBe("pass");
  });

  test("rollout shrank after restart → rollout_intact fail (no silent thread switch)", async () => {
    const a = actions({ gate: async (phase) => (phase === "before" ? gate(PRE, {}, roll(500)) : gate(VER, { identity_attested: "unknown" }, roll(120))) });
    const out = await runCodexRestart("restart", a);
    expect(out.checks.find((c) => c.key === "rollout_intact")!.status).toBe("fail");
    expect(receiptVerdict("restart", out.checks).verdict).toBe("FAIL");
  });

  test("rollout inode changed → fail; bytes grew on same inode → pass", async () => {
    const grow = actions({ gate: async (phase) => (phase === "before" ? gate(PRE, {}, roll(100)) : gate(VER, {}, roll(150))) });
    expect((await runCodexRestart("restart", grow)).checks.find((c) => c.key === "rollout_intact")!.status).toBe("pass");
    const swap = actions({ gate: async (phase) => (phase === "before" ? gate(PRE, {}, roll(100, 7)) : gate(VER, {}, roll(150, 8))) });
    expect((await runCodexRestart("restart", swap)).checks.find((c) => c.key === "rollout_intact")!.status).toBe("fail");
  });

  test("no probe peer → identity_attested unknown → verdict FAIL with a hint (fail-closed)", async () => {
    const a = actions({ nonceProbe: undefined });
    const out = await runCodexRestart("restart", a);
    const id = out.checks.find((c) => c.key === "identity_attested")!;
    expect(id.status).toBe("unknown");
    expect(id.detail).toContain("--probe-from");
    const v = receiptVerdict("restart", out.checks);
    expect(v.verdict).toBe("FAIL");
    expect(v.blocking).toEqual(["identity_attested"]);
  });

  test("probe answered by the wrong alias → identity_attested fail", async () => {
    const a = actions({ nonceProbe: async () => ({ ok: false, detail: "reply came from 别的节点" }) });
    const out = await runCodexRestart("restart", a);
    expect(out.checks.find((c) => c.key === "identity_attested")!.status).toBe("fail");
  });

  test("start refuses when any session is alive; restart with nothing alive degrades to start", async () => {
    const alive = actions();
    const out = await runCodexRestart("start", alive);
    expect(out.stoppedAt).toBe("live_sessions");
    expect(alive.log).toEqual(["gate:before"]);
    const dead = actions({ liveSessions: async () => ({ bridge: false, tui: false, appsrv: false }) });
    const out2 = await runCodexRestart("restart", dead);
    expect(out2.stoppedAt).toBe("done");
    expect(dead.log.filter((l) => l.startsWith("stop:"))).toEqual([]);
    expect(out2.checks.find((c) => c.key === "stop_order")!.evidence).toEqual({ order: [] });
  });

  test("hub never comes back online → hub_online fail", async () => {
    const a = actions({ waitHubOnline: async () => ({ ok: false, detail: "still offline after 60s" }) });
    const out = await runCodexRestart("restart", a);
    expect(out.checks.find((c) => c.key === "hub_online")!.status).toBe("fail");
    expect(out.stoppedAt).toContain("hub_online");
  });

  test("orderedStop skips absent roles and records the order", async () => {
    const a = actions({ liveSessions: async () => ({ bridge: false, tui: true, appsrv: true }) });
    const c = await orderedStop(a, { bridge: false, tui: true, appsrv: true });
    expect(c.status).toBe("pass");
    expect(a.log).toEqual(["stop:tui", "stop:appsrv"]);
  });
});
