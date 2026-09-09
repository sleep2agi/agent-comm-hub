// #1856 —— preflight / verify 的纯判定:把「已经量到的事实」变成 receipt checks。
// 量事实的 IO(fs / tmux / /proc / hub)在 cli.ts 的适配层;这里不碰文件系统,便于用夹具穷举每条不变量的
// pass / fail / unknown 三态。判据来源:TMHR 2026-09-09 派工的 14 条不变量,逐条注在对应函数上。
import type { ReceiptCheck } from "./codex-lifecycle-receipt";

export interface RolloutFact {
  readonly path: string;
  readonly inode: number | bigint;
  readonly bytes: number;
  readonly mtimeMs: number;
}

export interface ProcessFact {
  readonly pid: number;
  readonly cwd: string | null;
  /** 子进程实际环境里的 CODEX_HOME(不是 wrapper 继承的那份 —— wrapper 环境不能作承重证据)。 */
  readonly codexHome: string | null;
  /** 子进程实际环境里 CommHub token 的短指纹;null = 没读到或该进程不该持有。 */
  readonly tokenFingerprint: string | null;
  /** 子进程环境里的 ANET_NODE_MARKER(copresence-identity 的身份 uuid);null = 没有。 */
  readonly markerUuid: string | null;
  readonly argv: readonly string[];
}

export interface PreflightFacts {
  readonly alias: string;
  readonly configNodeId: string | null;
  /** hub 名册按 alias 精确查到的 node_id;null = hub 不可达或没这个 alias。 */
  readonly hubNodeId: string | null;
  readonly home: {
    readonly dir: string;
    readonly dirMode: number | null;         // null = 不存在
    readonly authMode: number | null;
    readonly authBytes: number | null;
    readonly configTokenFingerprint: string | null;
    readonly envFileTokenFingerprint: string | null;
  };
  readonly workdir: {
    readonly configProjectDir: string | null;   // 已 realpath
    readonly tuiCwd: string | null;             // TUI 进程 cwd(realpath)
    readonly tuiArgvDir: string | null;         // TUI argv 里 -C <dir>(realpath)
    readonly bridgeProjectDir: string | null;   // Bridge 的 project_dir(realpath)
    readonly statusBarDir: string | null;       // TUI 状态栏显示的目录;null = 没读到
  };
  readonly session: {
    readonly threadId: string | null;
    /** CODEX_HOME 里文件名以 <threadId>.jsonl 结尾的 rollout 全集。 */
    readonly rolloutMatches: readonly RolloutFact[];
  };
  readonly port: {
    readonly port: number | null;
    readonly owner: ProcessFact | null;         // null = 端口空闲
  };
  readonly topology: {
    /** copresence-identity.json 里的身份 uuid;null = 没有 marker 文件。 */
    readonly markerUuid: string | null;
    /** marker 里记的 pid(采集时的观测提示,**不是**身份来源)与现在 tmux pane 的 pid。 */
    readonly recorded: Readonly<Record<"appsrv" | "bridge" | "tui", number | null>>;
    readonly live: Readonly<Record<"appsrv" | "bridge" | "tui", number | null>>;
    /** 每个 tmux 段下带环境的子进程各自的 ANET_NODE_MARKER。 */
    readonly liveMarkers: Readonly<Record<"appsrv" | "bridge" | "tui", readonly (string | null)[]>>;
    /** 每个 tmux 段下带环境的子进程各自的 CODEX_HOME(realpath)。 */
    readonly liveHomes: Readonly<Record<"appsrv" | "bridge" | "tui", readonly (string | null)[]>>;
  };
  readonly goal: { readonly state: "active" | "stalled" | "paused" | "achieved" | "none" | "unknown" };
  readonly children: readonly ProcessFact[];   // appsrv / tui / bridge 的实际子进程(verify 用)
  readonly expectedTokenFingerprint: string | null;
}

const THREAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ① alias 与 immutable node_id 精确匹配。
export function checkIdentity(f: PreflightFacts): ReceiptCheck {
  if (!f.configNodeId) return { key: "identity_match", status: "fail", detail: "config has no node_id" };
  if (f.hubNodeId === null) return { key: "identity_match", status: "unknown", detail: `hub did not resolve alias ${f.alias} to a node_id`, evidence: { configNodeId: f.configNodeId } };
  if (f.hubNodeId !== f.configNodeId) return { key: "identity_match", status: "fail", detail: `alias ${f.alias} resolves to ${f.hubNodeId} on the hub but config says ${f.configNodeId}`, evidence: { configNodeId: f.configNodeId, hubNodeId: f.hubNodeId } };
  return { key: "identity_match", status: "pass", detail: `alias ${f.alias} ↔ ${f.configNodeId} (hub agrees)`, evidence: { nodeId: f.configNodeId } };
}

// ② 每节点独立 CODEX_HOME / auth / token(相同 thread 在不同 CODEX_HOME 合法,所以这里只看本节点自己那份)。
export function checkHome(f: PreflightFacts): ReceiptCheck {
  const h = f.home;
  if (h.dirMode === null) return { key: "home_isolated", status: "fail", detail: `CODEX_HOME missing: ${h.dir}` };
  if ((h.dirMode & 0o077) !== 0) return { key: "home_isolated", status: "fail", detail: `CODEX_HOME mode ${h.dirMode.toString(8)} is not owner-only`, evidence: { dir: h.dir } };
  if (h.authMode === null || !h.authBytes) return { key: "home_isolated", status: "fail", detail: "auth.json missing or empty in CODEX_HOME", evidence: { dir: h.dir } };
  if ((h.authMode & 0o077) !== 0) return { key: "home_isolated", status: "fail", detail: `auth.json mode ${h.authMode.toString(8)} is not 0600`, evidence: { dir: h.dir } };
  if (!h.configTokenFingerprint) return { key: "home_isolated", status: "fail", detail: "node config carries no CommHub token" };
  if (h.envFileTokenFingerprint && h.envFileTokenFingerprint !== h.configTokenFingerprint) {
    return { key: "home_isolated", status: "fail", detail: "copresence env file token differs from node config token", evidence: { configTokenFingerprint: h.configTokenFingerprint, envFileTokenFingerprint: h.envFileTokenFingerprint } };
  }
  return { key: "home_isolated", status: "pass", detail: `CODEX_HOME 0700, auth.json 0600 (${h.authBytes} B), token fp ${h.configTokenFingerprint}`, evidence: { dir: h.dir, tokenFingerprint: h.configTokenFingerprint } };
}

// ③ 工作目录同时匹配 config、进程 cwd、TUI -C、Bridge project_dir、TUI 状态栏。
export function checkWorkdir(f: PreflightFacts): ReceiptCheck {
  const w = f.workdir;
  if (!w.configProjectDir) return { key: "workdir_consistent", status: "fail", detail: "config.codexProjectDir is missing (run: anet node config apply <alias> <patch.json>)" };
  // 前四个是承重证据(config / TUI 进程 cwd / TUI argv -C / Bridge 进程的 project_dir);状态栏只能在 pane 上读到
  // 路径时才当证据 —— 读不到不算 unknown(TUI 状态栏不总显示目录),读到了却不一致照样 fail。
  const required: Array<[string, string | null]> = [["config", w.configProjectDir], ["tui.cwd", w.tuiCwd], ["tui.-C", w.tuiArgvDir], ["bridge.project_dir", w.bridgeProjectDir]];
  const all: Array<[string, string | null]> = [...required, ["tui.statusbar", w.statusBarDir]];
  const mismatched = all.filter(([, v]) => v !== null && v !== w.configProjectDir).map(([k, v]) => `${k}=${v}`);
  if (mismatched.length) return { key: "workdir_consistent", status: "fail", detail: `workdir disagrees: ${mismatched.join(", ")} vs config=${w.configProjectDir}`, evidence: Object.fromEntries(all) };
  const missing = required.filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length) return { key: "workdir_consistent", status: "unknown", detail: `could not read ${missing.join(", ")} (node not running, or not observable on this platform)`, evidence: Object.fromEntries(all) };
  return { key: "workdir_consistent", status: "pass", detail: `config / tui.cwd / tui.-C / bridge.project_dir agree on ${w.configProjectDir}${w.statusBarDir ? " (status bar too)" : ""}`, evidence: Object.fromEntries(all) };
}

// ④ session 只能用目标 CODEX_HOME 里完整 36 位 thread ID + 唯一 rollout;禁止前缀 / 最近文件猜测。
export function checkSession(f: PreflightFacts): ReceiptCheck {
  const t = f.session.threadId;
  if (!t) return { key: "session_exact", status: "fail", detail: "config has no codexThreadId (a full 36-char id is required; --last / prefixes are refused by design)" };
  if (!THREAD_ID_RE.test(t)) return { key: "session_exact", status: "fail", detail: `codexThreadId is not a full 36-char id: ${t.slice(0, 8)}…` };
  const n = f.session.rolloutMatches.length;
  if (n === 0) return { key: "session_exact", status: "fail", detail: `no rollout for thread ${t.slice(0, 8)}… in this CODEX_HOME`, evidence: { threadId: t } };
  if (n > 1) return { key: "session_exact", status: "fail", detail: `${n} rollouts match thread ${t.slice(0, 8)}… — ambiguous, refusing to guess`, evidence: { threadId: t, paths: f.session.rolloutMatches.map((r) => r.path) } };
  return { key: "session_exact", status: "pass", detail: `thread ${t.slice(0, 8)}… has exactly one rollout`, evidence: { threadId: t, path: f.session.rolloutMatches[0].path } };
}

// ⑤ 操作前后记录 rollout 绝对路径、inode、bytes、mtime;不得缩小、替换或消失。
export function rolloutSnapshot(f: PreflightFacts): ReceiptCheck {
  const r = f.session.rolloutMatches[0];
  if (!r || f.session.rolloutMatches.length !== 1) return { key: "rollout_intact", status: "fail", detail: "no unique rollout to snapshot (see session_exact)" };
  return { key: "rollout_intact", status: "pass", detail: `rollout ${r.bytes} B inode ${String(r.inode)}`, evidence: { path: r.path, inode: String(r.inode), bytes: r.bytes, mtimeMs: r.mtimeMs } };
}

export function compareRollout(before: RolloutFact, after: RolloutFact | null): ReceiptCheck {
  if (!after) return { key: "rollout_intact", status: "fail", detail: "rollout disappeared after the operation", evidence: { before: { ...before, inode: String(before.inode) } } };
  if (after.path !== before.path || String(after.inode) !== String(before.inode)) return { key: "rollout_intact", status: "fail", detail: "rollout was replaced (path/inode changed)", evidence: { before: { ...before, inode: String(before.inode) }, after: { ...after, inode: String(after.inode) } } };
  if (after.bytes < before.bytes) return { key: "rollout_intact", status: "fail", detail: `rollout shrank ${before.bytes} → ${after.bytes} B`, evidence: { before: { ...before, inode: String(before.inode) }, after: { ...after, inode: String(after.inode) } } };
  return { key: "rollout_intact", status: "pass", detail: `rollout intact (${before.bytes} → ${after.bytes} B, same inode)`, evidence: { path: after.path, inode: String(after.inode), bytes: after.bytes, mtimeMs: after.mtimeMs } };
}

// ⑦ 端口占用归属:只有确定属于目标实例(cwd / argv / CODEX_HOME 都对得上)才算;否则是 foreign PID。
export function checkPortOwner(f: PreflightFacts): ReceiptCheck {
  const p = f.port;
  if (p.port === null) return { key: "port_owner_verified", status: "fail", detail: "config.codexAppServerUrl has no port" };
  if (!p.owner) return { key: "port_owner_verified", status: "pass", detail: `port ${p.port} is free`, evidence: { port: p.port, state: "free" } };
  const o = p.owner;
  const looksLikeAppServer = o.argv.some((a) => /app-server/.test(a));
  const homeOk = o.codexHome !== null && o.codexHome === f.home.dir;
  if (!looksLikeAppServer || !homeOk) {
    return { key: "port_owner_verified", status: "fail", detail: `port ${p.port} is held by pid ${o.pid} that is NOT this node's app-server (argv/CODEX_HOME mismatch) — refusing to touch a foreign process`, evidence: { port: p.port, pid: o.pid, cwd: o.cwd, codexHome: o.codexHome, argv0: o.argv[0] ?? null } };
  }
  return { key: "port_owner_verified", status: "pass", detail: `port ${p.port} owned by this node's app-server pid ${o.pid}`, evidence: { port: p.port, pid: o.pid, cwd: o.cwd, codexHome: o.codexHome } };
}

// ⑧ App Server / TUI / Bridge 的实际子进程环境必须核 CODEX_HOME 与 token 短指纹;wrapper 继承环境不算。
export function checkChildEnv(f: PreflightFacts): ReceiptCheck {
  if (f.children.length === 0) return { key: "child_env_attested", status: "unknown", detail: "no child processes observed (node not running, or process environment not readable on this platform)" };
  const bad: string[] = [];
  for (const c of f.children) {
    if (c.codexHome !== f.home.dir) bad.push(`pid ${c.pid} CODEX_HOME=${c.codexHome ?? "(unset)"}`);
    if (f.expectedTokenFingerprint && c.tokenFingerprint && c.tokenFingerprint !== f.expectedTokenFingerprint) bad.push(`pid ${c.pid} token fp ${c.tokenFingerprint}≠${f.expectedTokenFingerprint}`);
  }
  if (bad.length) return { key: "child_env_attested", status: "fail", detail: bad.join("; "), evidence: { pids: f.children.map((c) => c.pid) } };
  return { key: "child_env_attested", status: "pass", detail: `${f.children.length} child processes carry CODEX_HOME=${f.home.dir}${f.expectedTokenFingerprint ? ` and token fp ${f.expectedTokenFingerprint}` : ""}`, evidence: { pids: f.children.map((c) => c.pid) } };
}

// ⑨ restart 前读取 Goal 状态;状态不明则 STOP。
export function checkGoalState(f: PreflightFacts): ReceiptCheck {
  const s = f.goal.state;
  if (s === "unknown") return { key: "goal_state_known", status: "unknown", detail: "TUI goal state could not be read — a restart must STOP here, not guess" };
  return { key: "goal_state_known", status: "pass", detail: `goal state: ${s}`, evidence: { state: s } };
}

// 拓扑归属:三段都在跑,且每段至少有一个子进程的 CODEX_HOME 就是本节点的(承重证据);
// copresence-identity 的 marker uuid 出现在哪一段就核哪一段(出现且不等 → foreign,fail);
// marker 文件里的 pid 只是采集时的提示 —— bridge 单独重启过 pid 就漂,而它照样是本节点的进程,不能拿 pid 判串。
// 实测(2026-09-09 DEV 通信牛):早期启动的 TUI / bridge 段只带 CODEX_HOME 不带 marker,app-server 段两者都带。
export function checkTopology(f: PreflightFacts): ReceiptCheck {
  const keys = ["appsrv", "bridge", "tui"] as const;
  const live = keys.filter((k) => f.topology.live[k] !== null);
  if (live.length === 0) return { key: "topology_consistent", status: "pass", detail: "no tmux sessions — node is stopped", evidence: { live: f.topology.live } };
  const partial = keys.filter((k) => f.topology.live[k] === null);
  if (partial.length) return { key: "topology_consistent", status: "fail", detail: `partial topology: ${partial.join(", ")} not running`, evidence: { recorded: f.topology.recorded, live: f.topology.live } };
  const foreignMarker = keys.filter((k) => f.topology.liveMarkers[k].some((m) => m !== null && f.topology.markerUuid !== null && m !== f.topology.markerUuid));
  if (foreignMarker.length) return { key: "topology_consistent", status: "fail", detail: `processes under ${foreignMarker.join(", ")} carry a different identity marker — a foreign instance sits in this node's sessions`, evidence: { live: f.topology.live } };
  const foreignHome = keys.filter((k) => f.topology.liveHomes[k].some((h) => h !== null && h !== f.home.dir));
  if (foreignHome.length) return { key: "topology_consistent", status: "fail", detail: `processes under ${foreignHome.join(", ")} run with another CODEX_HOME — a foreign instance sits in this node's sessions`, evidence: { live: f.topology.live, homes: f.topology.liveHomes } };
  const unattributed = keys.filter((k) => !f.topology.liveHomes[k].some((h) => h === f.home.dir));
  if (unattributed.length) return { key: "topology_consistent", status: "unknown", detail: `no process under ${unattributed.join(", ")} exposes this node's CODEX_HOME (environment not readable on this platform, or wrapper only)`, evidence: { live: f.topology.live } };
  const drifted = keys.filter((k) => f.topology.recorded[k] !== null && f.topology.recorded[k] !== f.topology.live[k]);
  const markerSeen = keys.filter((k) => f.topology.liveMarkers[k].some((m) => m !== null && m === f.topology.markerUuid));
  return { key: "topology_consistent", status: "pass", detail: `appsrv / bridge / tui live and attributed to this node by CODEX_HOME${markerSeen.length ? ` (identity marker seen on ${markerSeen.join(", ")})` : ""}${drifted.length ? ` — pids drifted since harvest for ${drifted.join(", ")} (restarted segments, same identity)` : ""}`, evidence: { live: f.topology.live, recorded: f.topology.recorded } };
}

export function evaluateCodexPreflight(f: PreflightFacts): ReceiptCheck[] {
  return [checkIdentity(f), checkHome(f), checkWorkdir(f), checkSession(f), rolloutSnapshot(f), checkPortOwner(f), checkGoalState(f), checkTopology(f)];
}

/** verify = preflight + 子进程环境 + 跨节点身份验收(identity_attested 由调用方注入;PR-A 里没有探针时给 unknown)。 */
export function evaluateCodexVerify(f: PreflightFacts, identityAttested: ReceiptCheck): ReceiptCheck[] {
  return [...evaluateCodexPreflight(f).filter((c) => c.key !== "goal_state_known"), checkChildEnv(f), identityAttested];
}
