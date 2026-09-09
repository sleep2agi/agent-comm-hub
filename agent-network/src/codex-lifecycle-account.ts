/**
 * #1856 PR-D — `anet node codex account register|list|install` 与 `rollback` 的纯逻辑。
 *
 * 登录源是**不透明的 host-bound 引用** `codex-login:<profile-id>`:CLI 不收路径 / stdin / 环境变量;profile 由本机
 * `~/.anet/codex-login/registry.json`(0600)解析,凭据正文放 `profiles/<id>/auth.json`(0600)。
 * receipt / hub 只记 profile_id 与不可逆的 account_fingerprint(sha256(account_id) 前 16 位)、backup_ref;
 * 不记 token、auth 内容、真实路径。PR-D 只认 OpenAI/ChatGPT 的 auth.json(auth_mode=chatgpt + tokens.account_id)。
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import type { ReceiptCheck } from "./codex-lifecycle-receipt.js";
import type { RestartOutcome } from "./codex-lifecycle-restart.js";

export const SOURCE_KIND = "codex-login-profile";
const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BACKUP_REF_RE = /^receipt:([A-Za-z0-9][A-Za-z0-9-]{3,80})$/;

/** `--source` 只接受 `codex-login:<profile-id>`。路径、`env:`、`-`(stdin)、绝对/相对路径都拒绝,错误里说清为什么。 */
export function parseSourceRef(raw: string): { kind: typeof SOURCE_KIND; profileId: string } {
  const s = String(raw ?? "").trim();
  if (!s) throw new Error("--source is required: codex-login:<profile-id>");
  if (s === "-" || s.startsWith("env:") || s.startsWith("/") || s.startsWith("./") || s.startsWith("~") || s.includes("/auth.json")) {
    throw new Error(`--source ${s}: paths, stdin and env are not accepted — register the login first: anet node codex account register <profile-id> --from-codex-home <dir>`);
  }
  const m = /^codex-login:(.+)$/.exec(s);
  if (!m) throw new Error(`--source ${s}: unknown ref kind (only codex-login:<profile-id>)`);
  if (!PROFILE_ID_RE.test(m[1])) throw new Error(`--source ${s}: profile id must match ${PROFILE_ID_RE}`);
  return { kind: SOURCE_KIND, profileId: m[1] };
}

export function shortHash(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

/** host_id:machine-id(有则用)+ hostname 的不可逆摘要;registry entry 绑定它,拷到别的机器就不认。 */
export function hostIdOf(machineId: string | null, hostname: string): string {
  return shortHash(`${machineId ?? ""}|${hostname}`);
}

export interface ChatgptAuthShape { auth_mode?: unknown; tokens?: { account_id?: unknown } | null; OPENAI_API_KEY?: unknown }

/** 只认 ChatGPT 登录:auth_mode=chatgpt 且 tokens.account_id 是 36 位 uuid;指纹 = sha256(account_id) 前 16 位。 */
export function accountFingerprint(auth: ChatgptAuthShape): string {
  if (auth?.auth_mode !== "chatgpt") throw new Error(`auth.json auth_mode=${String(auth?.auth_mode)} — PR-D only handles ChatGPT logins (auth_mode=chatgpt)`);
  const id = auth?.tokens?.account_id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("auth.json has no tokens.account_id — not a usable ChatGPT login");
  return shortHash(id);
}

export interface RegistryEntry {
  schema_version: 1;
  profile_id: string;
  provider: "openai-chatgpt";
  host_id: string;
  /** 由 registry 目录解析的相对引用;从不是绝对路径。 */
  credential_ref: string;
  account_fingerprint: string;
  created_at: string;
  last_model_probe_at: string | null;
  last_model_probe_status: ProbeStatus | null;
  revoked: boolean;
  disabled: boolean;
}
export interface Registry { schema_version: 1; host_id: string; profiles: Record<string, RegistryEntry> }
export type ProbeStatus = "ok" | "auth" | "quota" | "model" | "unknown";

export function credentialRefFor(profileId: string): string { return `profile-store:${profileId}`; }
export function credentialPath(registryDir: string, entry: RegistryEntry): string {
  const m = /^profile-store:([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/.exec(entry.credential_ref);
  if (!m) throw new Error(`registry entry ${entry.profile_id}: unsupported credential_ref`);
  return join(registryDir, "profiles", m[1], "auth.json");
}

export function readRegistry(registryDir: string, hostId: string): Registry {
  const p = join(registryDir, "registry.json");
  if (!existsSync(p)) return { schema_version: 1, host_id: hostId, profiles: {} };
  const parsed = JSON.parse(readFileSync(p, "utf-8"));
  if (parsed?.schema_version !== 1 || typeof parsed.profiles !== "object") throw new Error(`${p}: unsupported registry schema`);
  return parsed as Registry;
}

export function writeRegistry(registryDir: string, reg: Registry): void {
  mkdirSync(registryDir, { recursive: true, mode: 0o700 });
  chmodSync(registryDir, 0o700);
  const p = join(registryDir, "registry.json");
  const tmp = `${p}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, p);
}

/** 解析一个 profile:必须存在、未 revoked/disabled、host_id 一致、凭据文件在且 0600。返回凭据路径(只在进程内用,不进 receipt)。 */
export function resolveProfile(registryDir: string, reg: Registry, profileId: string, hostId: string): { entry: RegistryEntry; credentialFile: string } {
  const entry = reg.profiles[profileId];
  if (!entry) throw new Error(`profile ${profileId} is not registered on this host`);
  if (entry.revoked) throw new Error(`profile ${profileId} is revoked`);
  if (entry.disabled) throw new Error(`profile ${profileId} is disabled`);
  if (entry.host_id !== hostId) throw new Error(`profile ${profileId} is bound to another host (host_id mismatch)`);
  const credentialFile = credentialPath(registryDir, entry);
  if (!existsSync(credentialFile)) throw new Error(`profile ${profileId}: credential file missing`);
  const mode = statSync(credentialFile).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error(`profile ${profileId}: credential file mode ${mode.toString(8)} is not owner-only`);
  return { entry, credentialFile };
}

/** 把一次 fresh 模型请求的结果归类;归不进已知类的一律 unknown(unknown 也 STOP,不猜)。 */
export function classifyProbe(exitCode: number | null, stdout: string, stderr: string, expected = "ANET-PROBE-OK"): ProbeStatus {
  const text = `${stdout}\n${stderr}`;
  if (/\b401\b|unauthori[sz]ed|invalid[_ ]token|token (has )?expired|revoked|not logged in|please log ?in/i.test(text)) return "auth";
  if (/insufficient[_ ]quota|quota|rate.?limit|\b429\b|usage limit|too many requests/i.test(text)) return "quota";
  if (/model[^\n]{0,40}(not (found|supported|available)|does not exist|unsupported|invalid)|unsupported model|\b404\b/i.test(text)) return "model";
  if (exitCode === 0 && stdout.includes(expected)) return "ok";
  return "unknown";
}

export function backupRefFor(receiptId: string): string { return `receipt:${receiptId}`; }
/** rollback 只认 `receipt:<id>`,且只在该节点的 receipts/ 目录里解析;调用方不能另指文件。 */
export function backupPathFor(nodeDir: string, backupRef: string): string {
  const m = BACKUP_REF_RE.exec(backupRef);
  if (!m) throw new Error(`backup_ref ${backupRef}: only receipt:<id> from an install receipt is accepted`);
  return join(nodeDir, "receipts", `${m[1]}.auth.bak`);
}

export interface InstallActions {
  /** 目标节点 before 核对:返回 fail 的 key(空 = 可继续)。 */
  preflightBlocks(): Promise<string[]>;
  /** 目标当前 auth 指纹(没有 auth.json → null)。 */
  currentFingerprint(): Promise<string | null>;
  /** 在隔离 staging HOME 里用该 profile 发一次 fresh 模型请求。 */
  probe(): Promise<{ status: ProbeStatus; detail: string }>;
  /** 备份目标 auth.json → backup_ref(0600)。 */
  backup(): Promise<{ backupRef: string }>;
  /** 把 profile 凭据装进目标 CODEX_HOME(0600,原子)。 */
  install(): Promise<void>;
  /** 完整重启(PR-B 状态机),返回其 outcome。 */
  restart(): Promise<RestartOutcome>;
  /** 从 backup_ref 恢复 auth.json。 */
  restore(backupRef: string): Promise<void>;
  /** 探针在 registry 里的回写(时间 + 状态)。 */
  recordProbe(status: ProbeStatus): Promise<void>;
}

export interface InstallInput { profileId: string; sourceFingerprint: string }
export interface InstallOutcome { checks: ReceiptCheck[]; stoppedAt: string; rolledBack: boolean; backupRef: string | null }

const chk = (key: string, status: ReceiptCheck["status"], detail: string, evidence?: Record<string, unknown>): ReceiptCheck =>
  evidence ? { key, status, detail, evidence } : { key, status, detail };

/**
 * account install 状态机:preflight → fresh 探针(401/quota/模型不兼容/unknown 都 STOP,目标一字未动)→ 备份 → 安装 →
 * 完整重启(含 verify)→ 目标指纹 == 源指纹。安装后任一步失败 → 恢复备份 + 再重启一次(回滚),receipt 记两段。
 */
export async function runAccountInstall(input: InstallInput, a: InstallActions): Promise<InstallOutcome> {
  const checks: ReceiptCheck[] = [];
  const fail = (stoppedAt: string, rolledBack = false, backupRef: string | null = null): InstallOutcome => ({ checks, stoppedAt, rolledBack, backupRef });
  const blocks = await a.preflightBlocks();
  if (blocks.length > 0) {
    checks.push(chk("account_probe", "unknown", `not probed: target preflight failed on ${blocks.join(", ")}`));
    return fail("preflight_before");
  }
  const previous = await a.currentFingerprint();
  const probe = await a.probe();
  await a.recordProbe(probe.status);
  if (probe.status !== "ok") {
    checks.push(chk("account_probe", "fail", `fresh model request → ${probe.status}: ${probe.detail}`, { profileId: input.profileId, sourceFingerprint: input.sourceFingerprint, status: probe.status }));
    return fail(`probe_${probe.status}`);
  }
  checks.push(chk("account_probe", "pass", `fresh model request answered (${probe.detail})`, { profileId: input.profileId, sourceFingerprint: input.sourceFingerprint, targetPreviousFingerprint: previous }));
  const { backupRef } = await a.backup();
  checks.push(chk("account_backup", "pass", `previous auth.json saved`, { backupRef, targetPreviousFingerprint: previous }));
  let rolledBack = false;
  try {
    await a.install();
  } catch (e: any) {
    checks.push(chk("account_installed", "fail", `install failed: ${e?.message ?? e}`));
    await a.restore(backupRef); rolledBack = true;
    checks.push(chk("rollback_restore", "pass", "previous auth.json restored (no restart needed — nothing was restarted)"));
    return fail("install", rolledBack, backupRef);
  }
  checks.push(chk("account_installed", "pass", "profile credential installed 0600", { profileId: input.profileId }));
  let restart = await a.restart();
  const restartFailed = restart.stoppedAt !== "done";
  const installedFp = await a.currentFingerprint();
  const fpOk = installedFp === input.sourceFingerprint;
  if (restartFailed || !fpOk) {
    checks.push(...restart.checks.map((c) => ({ ...c, key: `restart:${c.key}` })));
    checks.push(chk("account_verified", "fail", restartFailed ? `restart stopped at ${restart.stoppedAt}` : `installed fingerprint ${installedFp} ≠ source ${input.sourceFingerprint}`));
    await a.restore(backupRef); rolledBack = true;
    const back = await a.restart();
    checks.push(chk("rollback_restore", "pass", "previous auth.json restored", { backupRef }));
    // 回滚那次重启的每一项也进 receipt(rollback: 前缀,信息性),否则「回滚后重启停在 preflight_before」没法复核是哪一项。
    checks.push(...back.checks.map((c) => ({ ...c, key: `rollback:${c.key}` })));
    checks.push(chk("rollback_restart", back.stoppedAt === "done" ? "pass" : "fail", back.stoppedAt === "done" ? "node restarted on the previous login" : `restart after rollback stopped at ${back.stoppedAt}`));
    return fail(restartFailed ? `restart(${restart.stoppedAt})` : "fingerprint_mismatch", rolledBack, backupRef);
  }
  checks.push(...restart.checks);
  checks.push(chk("account_verified", "pass", `node runs on profile ${input.profileId} (fingerprint ${installedFp})`, { profileId: input.profileId, sourceFingerprint: input.sourceFingerprint, targetPreviousFingerprint: previous, backupRef }));
  return { checks, stoppedAt: "done", rolledBack: false, backupRef };
}

export interface RollbackActions {
  /** 读原 install receipt;返回它的 backup_ref 与当时的 target_previous_fingerprint。 */
  readInstallReceipt(): Promise<{ backupRef: string; targetPreviousFingerprint: string | null } | null>;
  backupExists(backupRef: string): Promise<boolean>;
  restore(backupRef: string): Promise<void>;
  restart(): Promise<RestartOutcome>;
  currentFingerprint(): Promise<string | null>;
}

export async function runRollback(a: RollbackActions): Promise<InstallOutcome> {
  const checks: ReceiptCheck[] = [];
  const r = await a.readInstallReceipt();
  if (!r) { checks.push(chk("rollback_restore", "fail", "receipt is not an account-install receipt with a backup_ref")); return { checks, stoppedAt: "receipt", rolledBack: false, backupRef: null }; }
  if (!(await a.backupExists(r.backupRef))) { checks.push(chk("rollback_restore", "fail", `backup ${r.backupRef} is missing`, { backupRef: r.backupRef })); return { checks, stoppedAt: "backup_missing", rolledBack: false, backupRef: r.backupRef }; }
  await a.restore(r.backupRef);
  checks.push(chk("rollback_restore", "pass", "auth.json restored from the install receipt's backup", { backupRef: r.backupRef }));
  const restart = await a.restart();
  checks.push(...restart.checks);
  const fp = await a.currentFingerprint();
  const fpOk = r.targetPreviousFingerprint === null || fp === r.targetPreviousFingerprint;
  checks.push(chk("account_verified", restart.stoppedAt === "done" && fpOk ? "pass" : "fail", restart.stoppedAt !== "done" ? `restart stopped at ${restart.stoppedAt}` : fpOk ? `fingerprint back to ${fp}` : `fingerprint ${fp} ≠ recorded ${r.targetPreviousFingerprint}`, { backupRef: r.backupRef }));
  return { checks, stoppedAt: restart.stoppedAt === "done" && fpOk ? "done" : "verify", rolledBack: true, backupRef: r.backupRef };
}
