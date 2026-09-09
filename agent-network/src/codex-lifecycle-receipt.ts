// #1856 —— Codex TUI 共存节点生命周期控制器的 receipt 合同。
//
// 一份 receipt = 一次生命周期动作(preflight / verify / start / restart / resume / fork / account / rollback)
// 的结构化证据。每个不变量一条 check,状态只有三种:pass / fail / unknown。
// 🔴 整体判定只在**每一条要求的 check 都是 pass** 时才是 PASS;fail 或 unknown 任一条都是 FAIL,
//    并把阻塞项列出来 —— 「部分成功」不能冒充整体成功(TMHR 派工第 14 条)。
// 🔴 敏感值(token / 账号 id / 凭据)不进 receipt:调用方只能放 shortFingerprint() 的短指纹。
//    写盘前再过一遍 redactReceipt(),把漏进来的凭据形状替换掉 —— 双保险,不是替代纪律。
import { createHash } from "crypto";
import { mkdirSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

export type CheckStatus = "pass" | "fail" | "unknown";

export interface ReceiptCheck {
  readonly key: string;
  readonly status: CheckStatus;
  /** 一句人话:pass 说核到了什么,fail 说差在哪,unknown 说为什么量不到。 */
  readonly detail: string;
  /** 可复核的证据(路径、inode、字节数、短指纹……);不得含凭据。 */
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export type LifecycleVerb =
  | "preflight" | "verify" | "start" | "restart" | "resume" | "fork" | "account-install" | "rollback";

export interface LifecycleReceipt {
  readonly format: "anet-codex-lifecycle-receipt/1";
  readonly id: string;
  readonly verb: LifecycleVerb;
  readonly alias: string;
  readonly nodeId: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly verdict: "PASS" | "FAIL";
  /** FAIL 时阻塞的 check key(fail 与 unknown 都算)。 */
  readonly blocking: readonly string[];
  readonly checks: readonly ReceiptCheck[];
}

/** 每个动词要求哪些 check 必须 pass。preflight 只读,不要求 identity_attested(那是 verify 的活)。 */
export const REQUIRED_CHECKS: Readonly<Record<LifecycleVerb, readonly string[]>> = {
  // preflight 不要求 goal 状态(那是 restart 的门:不明则 STOP);它作为附加 check 出现在 receipt 里供人看。
  preflight: ["identity_match", "home_isolated", "workdir_consistent", "session_exact", "rollout_intact", "port_owner_verified", "topology_consistent"],
  verify: ["identity_match", "home_isolated", "workdir_consistent", "session_exact", "rollout_intact", "port_owner_verified", "child_env_attested", "topology_consistent", "identity_attested"],
  start: ["identity_match", "home_isolated", "workdir_consistent", "session_exact", "start_order", "child_env_attested", "identity_attested"],
  restart: ["identity_match", "home_isolated", "workdir_consistent", "session_exact", "rollout_intact", "goal_state_preserved", "stop_order", "start_order", "child_env_attested", "identity_attested"],
  resume: ["identity_match", "home_isolated", "workdir_consistent", "session_exact", "rollout_intact", "start_order", "child_env_attested", "identity_attested"],
  // fork 只创建不启动:identity_attested 留给首次 start(--probe-from);目标侧要求 exact thread + 唯一 rollout。
  fork: ["identity_match", "fork_isolation", "home_isolated", "workdir_consistent", "session_exact"],
  // account-install 内含一次完整 restart(after 阶段的 check 原样并入),外加探针/安装/验证三项;identity_attested 仍由 --probe-from 闭环。
  "account-install": ["identity_match", "home_isolated", "session_exact", "account_probe", "account_installed", "account_verified", "start_order", "identity_attested"],
  rollback: ["identity_match", "home_isolated", "session_exact", "rollback_restore", "account_verified", "start_order"],
};

export function shortFingerprint(value: string | undefined | null, length = 12): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

const SECRET_KEY = /token|secret|password|authorization|auth_json|refresh|api_key|apikey/i;
const SECRET_SHAPE = /^(?:ntok_|utok_|atok_|sk-|ghp_|github_pat_|Bearer\s)/i;

export function redactReceipt<T>(value: T, key = ""): T {
  if (typeof value === "string") return (SECRET_SHAPE.test(value) || (SECRET_KEY.test(key) && !/fingerprint/i.test(key)) ? "[REDACTED]" : value) as T;
  if (Array.isArray(value)) return value.map((child) => redactReceipt(child)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactReceipt(v, k)])) as T;
  }
  return value;
}

export const INFORMATIONAL_PREFIXES: readonly string[] = ["before:", "source:", "restart:", "rollback:"];

export function receiptVerdict(verb: LifecycleVerb, checks: readonly ReceiptCheck[]): { verdict: "PASS" | "FAIL"; blocking: string[] } {
  const byKey = new Map(checks.map((c) => [c.key, c]));
  const blocking: string[] = [];
  for (const key of REQUIRED_CHECKS[verb]) {
    const c = byKey.get(key);
    if (!c || c.status !== "pass") blocking.push(key);
  }
  // 任何额外 check 若 fail 也阻塞(比如 preflight 顺手量到的东西);unknown 的额外项不阻塞,但会留在 checks 里。
  // 例外:带 INFORMATIONAL_PREFIXES 前缀的是「另一阶段 / 另一个节点」的快照(restart 的 before:、fork 的 source:),
  // 它们该拦的地方已经在状态机里拦过(before 阶段 fail 根本走不到这里;fork 对源只要求四项),留在 receipt 里只为复核。
  for (const c of checks) {
    if (c.status !== "fail" || blocking.includes(c.key)) continue;
    if (INFORMATIONAL_PREFIXES.some((p) => c.key.startsWith(p))) continue;
    blocking.push(c.key);
  }
  return { verdict: blocking.length === 0 ? "PASS" : "FAIL", blocking };
}

export function buildReceipt(opts: {
  verb: LifecycleVerb;
  alias: string;
  nodeId: string | null;
  startedAt: Date;
  finishedAt?: Date;
  checks: readonly ReceiptCheck[];
}): LifecycleReceipt {
  const finishedAt = opts.finishedAt ?? new Date();
  const { verdict, blocking } = receiptVerdict(opts.verb, opts.checks);
  const id = `${finishedAt.toISOString().replace(/[:.]/g, "-")}-${opts.verb}-${shortFingerprint(`${opts.alias}|${finishedAt.getTime()}`, 8)}`;
  return redactReceipt({
    format: "anet-codex-lifecycle-receipt/1",
    id, verb: opts.verb, alias: opts.alias, nodeId: opts.nodeId,
    startedAt: opts.startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
    verdict, blocking, checks: opts.checks,
  });
}

/** receipts 落在节点目录下 receipts/<id>.json,0600,先写临时文件再 rename(原子)。返回绝对路径。 */
export function writeReceipt(nodeDir: string, receipt: LifecycleReceipt): string {
  const dir = join(nodeDir, "receipts");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, `${receipt.id}.json`);
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, target);
  return target;
}

/** 终端摘要:一行一 check,PASS/FAIL 在最后;不打印 evidence 里的长值。 */
export function formatReceiptSummary(receipt: LifecycleReceipt): string {
  const icon = (s: CheckStatus) => (s === "pass" ? "✓" : s === "fail" ? "✗" : "?");
  const lines = receipt.checks.map((c) => `  ${icon(c.status)} ${c.key.padEnd(22)} ${c.detail}`);
  lines.push(`${receipt.verdict === "PASS" ? "PASS" : "FAIL"}: ${receipt.verb} ${receipt.alias}${receipt.blocking.length ? ` — blocking: ${receipt.blocking.join(", ")}` : ""}`);
  return lines.join("\n");
}
