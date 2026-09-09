// #1856 PR-A —— 每条不变量三态(pass / fail / unknown)各一夹具;receipt 整体判定与脱敏。
import { describe, expect, test } from "bun:test";
import {
  buildReceipt, formatReceiptSummary, receiptVerdict, redactReceipt, shortFingerprint, type ReceiptCheck,
} from "./codex-lifecycle-receipt";
import {
  checkChildEnv, checkGoalState, checkHome, checkIdentity, checkPortOwner, checkSession, checkTopology, checkWorkdir,
  compareRollout, evaluateCodexPreflight, evaluateCodexVerify, type PreflightFacts, type RolloutFact,
} from "./codex-lifecycle-preflight";

const T = "01a02193-e1fd-70f3-9e16-6fbff295fbae";
const HOME = "/n/.anet/nodes/x/codex-home";
const ROLL: RolloutFact = { path: `${HOME}/sessions/2026/09/01/rollout-2026-09-01T10-00-00-${T}.jsonl`, inode: 4242, bytes: 1000, mtimeMs: 1 };
const good = (): PreflightFacts => ({
  alias: "x", configNodeId: "n_1", hubNodeId: "n_1",
  home: { dir: HOME, dirMode: 0o700, authMode: 0o600, authBytes: 4000, configTokenFingerprint: "abc", envFileTokenFingerprint: "abc" },
  workdir: { configProjectDir: "/w", tuiCwd: "/w", tuiArgvDir: "/w", bridgeProjectDir: "/w", statusBarDir: "/w" },
  session: { threadId: T, rolloutMatches: [ROLL] },
  port: { port: 24703, owner: { pid: 7, cwd: "/w", codexHome: HOME, tokenFingerprint: null, markerUuid: "m-1", argv: ["codex", "app-server", "--port", "24703"] } },
  topology: { markerUuid: "m-1", recorded: { appsrv: 7, bridge: 8, tui: 9 }, live: { appsrv: 7, bridge: 8, tui: 9 }, liveMarkers: { appsrv: [null, "m-1"], bridge: [null], tui: [null, null] }, liveHomes: { appsrv: [null, HOME], bridge: [HOME], tui: [null, HOME] } },
  goal: { state: "active" },
  children: [{ pid: 7, cwd: "/w", codexHome: HOME, tokenFingerprint: "abc", markerUuid: "m-1", argv: ["codex"] }, { pid: 9, cwd: "/w", codexHome: HOME, tokenFingerprint: "abc", markerUuid: "m-1", argv: ["codex"] }],
  expectedTokenFingerprint: "abc",
});
const status = (c: ReceiptCheck) => c.status;

describe("① identity", () => {
  test("hub agrees → pass; disagrees → fail; hub unreachable → unknown; no node_id → fail", () => {
    expect(status(checkIdentity(good()))).toBe("pass");
    expect(status(checkIdentity({ ...good(), hubNodeId: "n_2" }))).toBe("fail");
    expect(status(checkIdentity({ ...good(), hubNodeId: null }))).toBe("unknown");
    expect(status(checkIdentity({ ...good(), configNodeId: null }))).toBe("fail");
  });
});
describe("② home isolation", () => {
  test("0700 dir + 0600 auth + matching token fp → pass", () => { expect(status(checkHome(good()))).toBe("pass"); });
  test("group-readable dir / auth, empty auth, token mismatch → fail", () => {
    const g = good();
    expect(status(checkHome({ ...g, home: { ...g.home, dirMode: 0o750 } }))).toBe("fail");
    expect(status(checkHome({ ...g, home: { ...g.home, authMode: 0o640 } }))).toBe("fail");
    expect(status(checkHome({ ...g, home: { ...g.home, authBytes: 0 } }))).toBe("fail");
    expect(status(checkHome({ ...g, home: { ...g.home, envFileTokenFingerprint: "zzz" } }))).toBe("fail");
    expect(status(checkHome({ ...g, home: { ...g.home, dirMode: null } }))).toBe("fail");
  });
});
describe("③ workdir five-way", () => {
  test("all agree → pass; one differs → fail; one unreadable → unknown; no config → fail", () => {
    const g = good();
    expect(status(checkWorkdir(g))).toBe("pass");
    expect(status(checkWorkdir({ ...g, workdir: { ...g.workdir, bridgeProjectDir: "/other" } }))).toBe("fail");
    expect(status(checkWorkdir({ ...g, workdir: { ...g.workdir, statusBarDir: null } }))).toBe("pass");      // 状态栏读不到不算证据缺失
    expect(status(checkWorkdir({ ...g, workdir: { ...g.workdir, statusBarDir: "/other" } }))).toBe("fail");  // 读到了却不一致 → fail
    expect(status(checkWorkdir({ ...g, workdir: { ...g.workdir, bridgeProjectDir: null } }))).toBe("unknown");
    expect(status(checkWorkdir({ ...g, workdir: { ...g.workdir, configProjectDir: null } }))).toBe("fail");
  });
});
describe("④ exact session", () => {
  test("36-char id + one rollout → pass; short id / no id / 0 or 2 rollouts → fail", () => {
    const g = good();
    expect(status(checkSession(g))).toBe("pass");
    expect(status(checkSession({ ...g, session: { threadId: T.slice(0, 8), rolloutMatches: [ROLL] } }))).toBe("fail");
    expect(status(checkSession({ ...g, session: { threadId: null, rolloutMatches: [ROLL] } }))).toBe("fail");
    expect(status(checkSession({ ...g, session: { threadId: T, rolloutMatches: [] } }))).toBe("fail");
    expect(status(checkSession({ ...g, session: { threadId: T, rolloutMatches: [ROLL, { ...ROLL, path: ROLL.path + ".2" }] } }))).toBe("fail");
  });
});
describe("⑤ rollout intact", () => {
  test("same inode, bytes not smaller → pass; shrink / replaced / gone → fail", () => {
    expect(compareRollout(ROLL, { ...ROLL, bytes: 1200, mtimeMs: 2 }).status).toBe("pass");
    expect(compareRollout(ROLL, { ...ROLL, bytes: 900 }).status).toBe("fail");
    expect(compareRollout(ROLL, { ...ROLL, inode: 1 }).status).toBe("fail");
    expect(compareRollout(ROLL, null).status).toBe("fail");
  });
});
describe("⑦ port owner", () => {
  test("free → pass; own app-server → pass; foreign pid (other CODEX_HOME or not app-server) → fail; no port → fail", () => {
    const g = good();
    expect(status(checkPortOwner({ ...g, port: { port: 24703, owner: null } }))).toBe("pass");
    expect(status(checkPortOwner(g))).toBe("pass");
    expect(status(checkPortOwner({ ...g, port: { port: 24703, owner: { ...g.port.owner!, codexHome: "/elsewhere" } } }))).toBe("fail");
    expect(status(checkPortOwner({ ...g, port: { port: 24703, owner: { ...g.port.owner!, argv: ["python3", "-m", "http.server"] } } }))).toBe("fail");
    expect(status(checkPortOwner({ ...g, port: { port: null, owner: null } }))).toBe("unknown");
  });
});
describe("⑧ child env attestation", () => {
  test("all children carry CODEX_HOME + token fp → pass; one wrong → fail; none observed → unknown", () => {
    const g = good();
    expect(status(checkChildEnv(g))).toBe("pass");
    expect(status(checkChildEnv({ ...g, children: [{ ...g.children[0], codexHome: "/host/.codex" }] }))).toBe("fail");
    expect(status(checkChildEnv({ ...g, children: [{ ...g.children[0], tokenFingerprint: "other" }] }))).toBe("fail");
    expect(status(checkChildEnv({ ...g, children: [] }))).toBe("unknown");
  });
});
describe("⑨ goal state", () => {
  test("known states pass, unknown is unknown (restart must STOP)", () => {
    expect(status(checkGoalState(good()))).toBe("pass");
    expect(status(checkGoalState({ ...good(), goal: { state: "paused" } }))).toBe("pass");
    expect(status(checkGoalState({ ...good(), goal: { state: "unknown" } }))).toBe("unknown");
  });
});
describe("topology (attribution = CODEX_HOME + marker where present, never pid)", () => {
  test("all live & attributed → pass even when pids drifted or marker only on app-server; stopped → pass", () => {
    const g = good();
    expect(status(checkTopology(g))).toBe("pass");
    const drifted = checkTopology({ ...g, topology: { ...g.topology, live: { appsrv: 7, bridge: 800, tui: 9 } } });
    expect(drifted.status).toBe("pass");
    expect(drifted.detail).toContain("pids drifted");
    expect(status(checkTopology({ ...g, topology: { ...g.topology, live: { appsrv: null, bridge: null, tui: null }, liveMarkers: { appsrv: [], bridge: [], tui: [] }, liveHomes: { appsrv: [], bridge: [], tui: [] } } }))).toBe("pass");
  });
  test("foreign marker or foreign CODEX_HOME → fail; partial → fail; a segment with no attributable child → unknown", () => {
    const g = good();
    expect(status(checkTopology({ ...g, topology: { ...g.topology, liveMarkers: { ...g.topology.liveMarkers, tui: ["m-OTHER"] } } }))).toBe("fail");
    expect(status(checkTopology({ ...g, topology: { ...g.topology, liveHomes: { ...g.topology.liveHomes, bridge: ["/other/home"] } } }))).toBe("fail");
    expect(status(checkTopology({ ...g, topology: { ...g.topology, live: { appsrv: 7, bridge: null, tui: 9 } } }))).toBe("fail");
    expect(status(checkTopology({ ...g, topology: { ...g.topology, liveHomes: { ...g.topology.liveHomes, bridge: [null] } } }))).toBe("unknown");
  });
});
describe("receipt verdict — no partial success", () => {
  test("preflight of a good node PASSes; a single unknown or fail blocks", () => {
    const checks = evaluateCodexPreflight(good());
    expect(receiptVerdict("preflight", checks).verdict).toBe("PASS");
    const withUnknown = evaluateCodexPreflight({ ...good(), hubNodeId: null });
    const v = receiptVerdict("preflight", withUnknown);
    expect(v.verdict).toBe("FAIL");
    expect(v.blocking).toEqual(["identity_match"]);
  });
  test("verify without a cross-node attestation is FAIL, never PASS", () => {
    const checks = evaluateCodexVerify(good(), { key: "identity_attested", status: "unknown", detail: "probe not implemented yet" });
    const v = receiptVerdict("verify", checks);
    expect(v.verdict).toBe("FAIL");
    expect(v.blocking).toEqual(["identity_attested"]);
    const ok = evaluateCodexVerify(good(), { key: "identity_attested", status: "pass", detail: "peer ack" });
    expect(receiptVerdict("verify", ok).verdict).toBe("PASS");
  });
  test("a required check that is simply missing blocks too", () => {
    expect(receiptVerdict("restart", evaluateCodexPreflight(good())).blocking).toEqual(expect.arrayContaining(["stop_order", "start_order", "child_env_attested", "identity_attested", "goal_state_preserved"]));
  });
});
describe("receipt hygiene", () => {
  test("credential shapes and secret-named keys are redacted; fingerprints survive", () => {
    const r = buildReceipt({ verb: "preflight", alias: "x", nodeId: "n_1", startedAt: new Date(0), finishedAt: new Date(1000), checks: [
      { key: "k", status: "pass", detail: "ok", evidence: { token: "ntok_abcdef123456", tokenFingerprint: "abc", note: "utok_zzz", refresh_token: "plain" } },
    ] });
    const ev = r.checks[0].evidence as Record<string, unknown>;
    expect(ev.token).toBe("[REDACTED]");
    expect(ev.note).toBe("[REDACTED]");
    expect(ev.refresh_token).toBe("[REDACTED]");
    expect(ev.tokenFingerprint).toBe("abc");
    expect(r.format).toBe("anet-codex-lifecycle-receipt/1");
    expect(r.id).toMatch(/-preflight-[0-9a-f]{8}$/);
    expect(JSON.stringify(r)).not.toContain("ntok_");
  });
  test("shortFingerprint is stable, short, and null for empty", () => {
    expect(shortFingerprint("ntok_x")).toBe(shortFingerprint("ntok_x"));
    expect(shortFingerprint("ntok_x")!.length).toBe(12);
    expect(shortFingerprint(null)).toBeNull();
  });
  test("summary ends with the verdict line and blocking list", () => {
    const r = buildReceipt({ verb: "preflight", alias: "x", nodeId: "n_1", startedAt: new Date(0), checks: evaluateCodexPreflight({ ...good(), hubNodeId: "n_9" }) });
    const s = formatReceiptSummary(r);
    expect(s.split("\n").pop()).toMatch(/^FAIL: preflight x — blocking: identity_match$/);
    // goal 状态不明在 preflight 里只是附加信息,不阻塞(restart 的门另算)
    const g = buildReceipt({ verb: "preflight", alias: "x", nodeId: "n_1", startedAt: new Date(0), checks: evaluateCodexPreflight({ ...good(), goal: { state: "unknown" } }) });
    expect(g.verdict).toBe("PASS");
    expect(g.checks.find((c) => c.key === "goal_state_known")?.status).toBe("unknown");
    expect(redactReceipt("Bearer abc")).toBe("[REDACTED]");
  });
});

describe("#1856 PR-C workdir: TUI -C is optional evidence (launcher never passes it)", () => {
  test("config + tui.cwd + bridge agree, -C and status bar unreadable → pass", () => {
    const f = { ...good(), workdir: { configProjectDir: "/w", tuiCwd: "/w", tuiArgvDir: null, bridgeProjectDir: "/w", statusBarDir: null } } as any;
    expect(checkWorkdir(f).status).toBe("pass");
  });
  test("-C readable but different → still fail; tui.cwd unreadable → unknown", () => {
    expect(checkWorkdir({ ...good(), workdir: { configProjectDir: "/w", tuiCwd: "/w", tuiArgvDir: "/x", bridgeProjectDir: "/w", statusBarDir: null } } as any).status).toBe("fail");
    expect(checkWorkdir({ ...good(), workdir: { configProjectDir: "/w", tuiCwd: null, tuiArgvDir: null, bridgeProjectDir: "/w", statusBarDir: null } } as any).status).toBe("unknown");
  });
});
