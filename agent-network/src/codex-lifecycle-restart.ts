/**
 * #1856 PR-B — `anet node codex start|restart|resume` 的确定性状态机。
 *
 * 零 LLM:每一步是「读事实 → 判 → 动作 → 写 receipt check」,顺序固定;所有副作用都经 `RestartActions`
 * 注入,所以这个文件可以在纯单测里跑完整个流程(含失败与回滚分支)。
 *
 * 停:Bridge → TUI → App Server(反向于依赖:先断任务入口,再让 TUI 把 rollout 刷完,最后放掉端口)。
 * 起:交给 `anet node start <alias> --copresence --tui-first`(App Server → 端口就绪 → exact-session
 *     TUI 完全恢复 → Bridge),再用 preflight/verify 复核 —— 起的顺序由启动器保证,这里只验证结果。
 * 任一步 fail → 不再往下;若已停掉进程则尝试一次「回滚」= 按原配置再起一次;仍失败就留在已停状态,
 * receipt 记录到哪一步、为什么,exit 2。绝不猜、绝不 fallback 到别的线程。
 */
import type { ReceiptCheck } from "./codex-lifecycle-receipt.js";
import type { RolloutFact } from "./codex-lifecycle-preflight.js";
import { compareRollout } from "./codex-lifecycle-preflight.js";

export type RestartVerb = "start" | "restart" | "resume";
export type GoalState = "active" | "paused" | "stalled" | "achieved" | "none" | "unknown";
export type CopresenceRole = "bridge" | "tui" | "appsrv";

export interface GateResult {
  /** 该阶段所有 check(preflight 或 verify 的输出)。 */
  readonly checks: readonly ReceiptCheck[];
  /** 该阶段 rollout 快照(session_exact 通过时才有)。 */
  readonly rollout: RolloutFact | null;
  /** 端口占用者(null = 空闲)。 */
  readonly port: { readonly port: number | null; readonly ownerPid: number | null; readonly ownerIsOurs: boolean | null };
}

export interface RestartActions {
  /** 只读核对(PR-A 的 preflight;`after` 阶段可带 identity_attested 变 verify)。 */
  gate(phase: "before" | "after"): Promise<GateResult>;
  /** goals.json 的状态摘要 + 内容指纹(unknown = 读不到/不认识的 schema)。 */
  goalState(): Promise<{ state: GoalState; fingerprint: string | null }>;
  /** 三个 tmux 会话谁还活着。 */
  liveSessions(): Promise<Readonly<Record<CopresenceRole, boolean>>>;
  /** 杀掉一个角色的 tmux 会话并等它消失;ok=false 时 detail 说为什么。 */
  stopSession(role: CopresenceRole): Promise<{ ok: boolean; detail: string }>;
  /** 等 rollout 文件字节数稳定(TUI 退出后大 rollout 还在刷盘);返回最终快照。 */
  waitRolloutSettled(before: RolloutFact | null): Promise<RolloutFact | null>;
  /** 等端口空闲;超时仍被占用时给出占用者 pid 与「是不是我们自己的 app-server」。 */
  waitPortFree(): Promise<{ free: boolean; ownerPid: number | null; ownerIsOurs: boolean | null }>;
  /** 对已核实属于本节点的残留 pid 发 TERM(定向,绝不 pkill -f)。 */
  termOwnedPid(pid: number): Promise<{ ok: boolean; detail: string }>;
  /** 跑启动器(`anet node start --copresence --tui-first`);ok=false 时 detail 是它的尾部输出。 */
  start(): Promise<{ ok: boolean; detail: string }>;
  /** hub 上该 node_id 是否在超时内回到 online/idle。 */
  waitHubOnline(): Promise<{ ok: boolean; detail: string }>;
  /** 跨节点 nonce 探针;未配置时返回 undefined(check 记 unknown)。 */
  nonceProbe?: () => Promise<{ ok: boolean; detail: string; evidence?: Record<string, unknown> }>;
}

export interface RestartOutcome {
  readonly verb: RestartVerb;
  readonly checks: readonly ReceiptCheck[];
  /** 走到哪一步停下(PASS 时 = "done")。 */
  readonly stoppedAt: string;
  readonly rolledBack: boolean;
}

const check = (key: string, status: ReceiptCheck["status"], detail: string, evidence?: Record<string, unknown>): ReceiptCheck =>
  evidence ? { key, status, detail, evidence } : { key, status, detail };

/** before 阶段的门:required 里不许有 fail;unknown 允许(要重启的节点常常就是缺了一截进程)。 */
export function beforeGateBlocks(checks: readonly ReceiptCheck[]): string[] {
  return checks.filter((c) => c.status === "fail").map((c) => c.key);
}

/** 三个角色按依赖反向停;返回 stop_order check(顺序本身就是证据)。 */
export async function orderedStop(actions: RestartActions, live: Readonly<Record<CopresenceRole, boolean>>): Promise<ReceiptCheck> {
  const order: CopresenceRole[] = ["bridge", "tui", "appsrv"];
  const done: string[] = [];
  for (const role of order) {
    if (!live[role]) { done.push(`${role}:absent`); continue; }
    const r = await actions.stopSession(role);
    if (!r.ok) return check("stop_order", "fail", `stop ${role} failed: ${r.detail}`, { order: done });
    done.push(`${role}:stopped`);
  }
  return check("stop_order", "pass", `Bridge → TUI → App Server`, { order: done });
}

export async function runCodexRestart(verb: RestartVerb, actions: RestartActions): Promise<RestartOutcome> {
  const checks: ReceiptCheck[] = [];
  const fail = (stoppedAt: string, rolledBack = false): RestartOutcome => ({ verb, checks, stoppedAt, rolledBack });

  // ① before:只读核对。任何 fail → 不碰进程。
  const before = await actions.gate("before");
  const blocks = beforeGateBlocks(before.checks);
  for (const c of before.checks) {
    // preflight 的快照类 check 在 after 阶段会被重新给出;before 的结果带前缀留在 receipt 里供复核。
    checks.push({ ...c, key: c.key === "rollout_intact" ? "rollout_before" : `before:${c.key}` });
  }
  if (blocks.length > 0) {
    checks.push(check("start_order", "unknown", `not started: preflight(before) failed on ${blocks.join(", ")}`));
    return fail("preflight_before");
  }

  // ② goal 状态:不明即 STOP。
  const goalBefore = await actions.goalState();
  if (goalBefore.state === "unknown") {
    checks.push(check("goal_state_preserved", "fail", "goal state unknown before restart — STOP (fail-closed)"));
    return fail("goal_state");
  }

  // ③ 谁活着。start 要求全没活;restart 至少 app-server 活着;resume 同 start。
  const live = await actions.liveSessions();
  const anyLive = live.bridge || live.tui || live.appsrv;
  if (verb !== "restart" && anyLive) {
    checks.push(check("start_order", "fail", `${verb} refused: sessions still alive (${Object.entries(live).filter(([, v]) => v).map(([k]) => k).join(", ")}); use restart`));
    return fail("live_sessions");
  }
  if (verb === "restart" && !anyLive) {
    checks.push(check("stop_order", "pass", "nothing was running — restart degrades to start", { order: [] }));
  }

  // ④ 停(反向依赖),等 rollout 刷盘,等端口放掉。
  let touched = false;
  if (verb === "restart" && anyLive) {
    touched = true;
    const stopped = await orderedStop(actions, live);
    checks.push(stopped);
    if (stopped.status !== "pass") return fail("stop");
  }
  const settled = await actions.waitRolloutSettled(before.rollout);
  if (before.rollout && !settled) {
    checks.push(check("rollout_intact", "fail", "rollout disappeared while stopping", { before: before.rollout.path }));
    return fail("rollout_settle");
  }
  const port = await actions.waitPortFree();
  if (!port.free) {
    if (port.ownerPid != null && port.ownerIsOurs === true) {
      const t = await actions.termOwnedPid(port.ownerPid);
      checks.push(check("port_owner_verified", t.ok ? "pass" : "fail", t.ok ? `stale app-server pid ${port.ownerPid} (ours) terminated` : `TERM pid ${port.ownerPid} failed: ${t.detail}`, { pid: port.ownerPid }));
      if (!t.ok) return fail("port_release");
      const again = await actions.waitPortFree();
      if (!again.free) {
        checks.push(check("port_owner_verified", "fail", `port still held after TERM (pid ${again.ownerPid})`, { pid: again.ownerPid }));
        return fail("port_release");
      }
    } else {
      checks.push(check("port_owner_verified", "fail", `port held by a foreign pid ${port.ownerPid ?? "?"} — not ours, not touched`, { pid: port.ownerPid, ownerIsOurs: port.ownerIsOurs }));
      return fail("port_foreign");
    }
  }

  // ⑤ 起;失败则回滚一次(= 再起一次),仍失败留在已停状态。
  let started = await actions.start();
  let rolledBack = false;
  if (!started.ok) {
    const firstAttempt = started.detail;
    if (touched) {
      rolledBack = true;
      const liveNow = await actions.liveSessions();
      const cleanup = await orderedStop(actions, liveNow);
      checks.push({ ...cleanup, key: "rollback_stop" });
      started = await actions.start();
      checks.push(check("rollback_start", started.ok ? "pass" : "fail",
        started.ok ? "first launch failed; rolled back to running by re-launching the original config" : `re-launch failed too: ${started.detail}`,
        { firstAttempt }));
    }
    if (!started.ok) {
      checks.push(check("start_order", "fail", `launcher did not reach 就绪: ${firstAttempt}`));
      return fail("start", rolledBack);
    }
  }
  checks.push(check("start_order", "pass", "App Server → port ready → exact-session TUI restored → Bridge (launcher --tui-first)"));

  // ⑥ after:严格核对 + rollout 前后比对 + goal 状态未变 + hub 在线 + nonce 探针。
  const after = await actions.gate("after");
  for (const c of after.checks) if (c.key !== "rollout_intact" && c.key !== "identity_attested") checks.push(c);
  const rolloutBefore = settled ?? before.rollout;
  checks.push(rolloutBefore ? compareRollout(rolloutBefore, after.rollout) : after.checks.find((c) => c.key === "rollout_intact") ?? check("rollout_intact", "unknown", "no rollout snapshot on either side"));
  const goalAfter = await actions.goalState();
  checks.push(goalAfter.state !== "unknown" && goalAfter.fingerprint === goalBefore.fingerprint
    ? check("goal_state_preserved", "pass", `goals ${goalBefore.state} → ${goalAfter.state}, file unchanged`, { fingerprint: goalAfter.fingerprint })
    : check("goal_state_preserved", "fail", `goals changed across restart (${goalBefore.state} → ${goalAfter.state})`, { before: goalBefore.fingerprint, after: goalAfter.fingerprint }));
  const hub = await actions.waitHubOnline();
  checks.push(check("hub_online", hub.ok ? "pass" : "fail", hub.detail));
  if (actions.nonceProbe) {
    const p = await actions.nonceProbe();
    checks.push(check("identity_attested", p.ok ? "pass" : "fail", p.detail, p.evidence));
  } else {
    checks.push(check("identity_attested", "unknown", "no probe peer configured — pass --probe-from <alias> for cross-node attestation"));
  }
  const failed = checks.filter((c) => c.status === "fail").map((c) => c.key);
  return { verb, checks, stoppedAt: failed.length > 0 ? `verify_after(${failed.join(",")})` : "done", rolledBack };
}
