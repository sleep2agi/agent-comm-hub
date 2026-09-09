#!/usr/bin/env node
/**
 * anet — AI Agent Network CLI
 *
 * anet init                    配置 hub（全局）
 * anet init project            配置当前项目
 * anet node create commander   创建 node
 * anet node start commander    启动
 * anet ls                      查看状态
 * anet run                     独立 SSE Agent
 */

import { chmodSync, readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, lstatSync, renameSync, rmSync, cpSync, copyFileSync, unlinkSync, realpathSync, symlinkSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir, hostname, tmpdir } from "os";
import { spawn, spawnSync, execSync, execFileSync } from "child_process";
import { createHash, randomBytes, randomUUID } from "crypto";
import {
  atomicWritePrivateFile,
  atomicWritePrivateJson,
  ensurePrivateDirectory,
  repairPrivateFilePermissions,
} from "../src/private-state";
import {
  writeMarker as writeCopresenceMarker,
  readMarker as readCopresenceMarker,
  removeMarker as removeCopresenceMarker,
  realEnumerator,
  realKiller,
  callerCarriesMarker,
  reapMarkerGroups,
  prepareIdentityForStart,
  anchorsFromMarker,
  type SessionInfo,
  readMarker,
} from "../src/copresence-identity";
import { buildReceipt, formatReceiptSummary, writeReceipt, type LifecycleVerb, type ReceiptCheck } from "../src/codex-lifecycle-receipt";
import { evaluateCodexPreflight, evaluateCodexVerify, checkIdentity, checkHome, checkSession } from "../src/codex-lifecycle-preflight";
import { FORK_HOME_COPY, checkForkIsolation, forkRolloutPath, rewriteRollout, uuidV7 } from "../src/codex-lifecycle-fork";
import { accountFingerprint, backupPathFor, backupRefFor, classifyProbe, credentialRefFor, hostIdOf, parseSourceRef, readRegistry, resolveProfile, runAccountInstall, runRollback, writeRegistry, type ProbeStatus, type RegistryEntry } from "../src/codex-lifecycle-account";
import { gatherCodexFacts, realPrimitives, findRollouts, processFact, goalsFileState } from "../src/codex-lifecycle-facts";
import { runCodexRestart, type RestartActions, type GoalState as LifecycleGoalState } from "../src/codex-lifecycle-restart";
import { alreadyRunningMessage, runningNodePid } from "../src/node-running-guard";
import { assertTmuxSupportsSessionEnv } from "../src/tmux-capability";
import { classifySessionStatus, summarizeSessions } from "../src/session-status-class";
import { formatOfflineAges, parseHubTimestamp, summarizeOfflineAges } from "../src/offline-age";
import { oneLineCell } from "../src/one-line-cell";
import { padDisplayEnd } from "../src/display-width";
import { formatHubTime } from "../src/hub-time-display";
import { formatCliVersion } from "../src/cli-version-display";
import { describeCopresenceStartupFailure } from "../src/copresence-startup-diagnosis";
import { describeCapability, describeFetchFailure, type CapabilityFetchFailure, type DaemonCapabilityRow } from "../src/daemon-capability-display";
import { daemonPathWarnings } from "../src/daemon-runtime-path-preflight";
import { formatHubVersionDetail } from "../src/hub-version-skew";
import { nodeCountLine } from "../src/doctor-node-count";
import { nodeNotFoundMessage } from "../src/node-not-found";
import { columnWidth, lsHeaderRow, lsSeparatorRow, runtimeColumnWidth } from "../src/ls-columns";
import { describeLocalProcess, LOCAL_VS_HUB_NOTE, type LocalProcessState } from "../src/local-process-state";
import { daemonSubcommandRedirect, nodeSubcommandRedirect, projectSubcommandRedirect } from "../src/subcommand-redirect";
import { resolveRuntimeForResume } from "../src/resume-runtime-infer";
import { isSameIncarnation, processVanished, resolveOwnedRoots, type OwnedRootCandidate } from "../src/owned-roots";
import { serializeProfileForConfigJson } from "../src/profile-serialize";
import { parseAndValidateTools, validateModel } from "../src/tool-allowlist";
import { createConnection as netCreateConnection, createServer as netCreateServer } from "net";
import { PassThrough } from "stream";
import { checkbox, confirm, select } from "@inquirer/prompts";
import { ensureGitignoreRule, ensureGitignoreRules } from "../src/gitignore-writeback";
import { superviseChild } from "../src/supervise-child";
import { encodeCwd } from "../src/project-key";
import { buildOpencodeSmokeEnv } from "../src/opencode-smoke-env";
import {
  OPENCODE_AGENT_NODE_SPEC,
  OPENCODE_AGENT_NODE_VERSION,
  PAIRED_AGENT_NODE_SPEC,
  PAIRED_AGENT_NODE_VERSION,
  agentNodeHelpSupportsCodexAppServer,
  agentNodeHelpSupportsOpencode,
  opencodeExactPairInstallCommand,
  pairedAgentNodeResolution,
  resolveAgentNodePackageEntrypointFromPath,
  validateAgentNodePackageEntrypoint,
} from "../src/opencode-agent-node-pair";
import { siblingAgentNodeEntrypoint } from "../src/sibling-agent-node";
import { hardenOpencodeAgentNodeEnv } from "../src/opencode-launch-env";
import {
  clearOpencodeAuthJson,
  findOpencodePreset,
  prepareOpencodeNodeForProfileWrite,
  readOpencodePrivateProfileFile,
  writeOpencodeAuthJson,
  writeOpencodePrivateProfileFile,
} from "../src/opencode-preset";
import {
  buildOpencodeAuthLoginArgs,
  readOpencodeAuthLoginCredential,
  revalidateOpencodeAuthLoginSandbox,
  withOpencodeAuthLoginSandbox,
} from "../src/opencode-auth-login";
import {
  cleanupOpencodeSafeExternalRoot,
  createOpencodeSafeExternalRoot,
  revalidateOpencodeSafeExternalRoot,
} from "../src/opencode-safe-root";
import {
  discoverOpencodeForbiddenRoots,
  resolveOpencodePackageBinaryFromPath,
  validateOpencodePackageBinary,
} from "../src/opencode-package-binary";
import {
  assertOpencodeNodeStateUntracked,
  readOpencodeRuntimeBinding,
  removeOpencodeRuntimeBinding,
  writeOpencodeRuntimeBinding,
} from "../src/opencode-runtime-binding";
import { connectGrokAttach } from "../src/grok-attach-client";
import { ambientTypeScriptTranspiler, nodeServerPayloadFor } from "../src/node-server-payload";
import {
  agentNodeHelpSupportsGrokCopresence,
  buildGrokAgentNodeEnv,
  buildGrokPreviewResolverEnv,
  grokBuildCliCreationFields,
  prepareGrokPreviewResolverConfigs,
  resolveGrokAttachTarget,
  grokCopresenceSocketPaths,
} from "../src/grok-copresence-profile";
import { canonicalSocketsForProfile, planReapableSockets, reapStaleSocket, unixSocketPathInUse } from "../src/stale-socket";
import {
  codexCopresencePosture,
  codexCopresenceCreateFields,
  codexCopresenceCreateHint,
  codexCopresenceRequested,
  shouldPersistCodexCopresence,
  shouldPersistCodexFullAccess,
} from "../src/codex-copresence-profile";
import {
  codexHomeStagePlan,
  codexTuiPaneState,
  describeCodexTuiBlocker,
  describeCodexTuiNotPainted,
} from "../src/codex-copresence-preflight";
import {
  describeMissingDeps,
  isLoopbackHub,
  missingCopresenceDeps,
} from "../src/copresence-deps";
import { runLauncherSync, spawnLauncher } from "../src/win-launcher";
import { chmodIfPosix } from "../src/posix-modes";
import {
  diagnoseGrokCopresence,
  grokAttachSocketState,
  grokCopresenceRequested,
  grokCopresenceSessions,
  shouldPersistGrokCopresence,
  GROK_COPRESENCE_CHILD_ENV,
} from "../src/grok-copresence-orchestration";
import {
  grokCopresenceDisclosure,
  type GrokCopresenceSessionDisclosure,
} from "../src/grok-copresence-disclosure";
import { parseCliOptions, positionalArgs } from "../src/cli-args";
import { parseTokenCreateName } from "../src/token-cli";
import { findExactTmuxSession, parseTmuxSessions } from "../src/tmux-attach";
import { classifyPanePrompt, extractStartFailureReason } from "../src/tmux-pane-prompt";
import { describeUnsafePath } from "../src/unsafe-package-path-reason";
import { describeUmaskRisk, judgeUmask, rejectedPayloads } from "../src/package-mode-preflight";
import { exactSession, PANE_LIST_FORMAT, paneTargetFor } from "../src/tmux-exact-target";
import { diagnoseLocale, formatLocaleSource } from "../src/locale-diagnostic";
import {
  formatSecretAssignment,
  secretPersistenceHeading,
  secretShellAction,
} from "../src/secret-shell-guidance";
import {
  collectClaudeVendorEnvForCreate,
  planPlainSecretEnvRewrites,
} from "../src/claude-vendor-env";
import {
  closeLog,
  ensureWindowsPrivateDirectory,
  measurePowerShellStartupMs,
  openPrivateAppendLog,
  probeWindowsCreationDate,
  probeWindowsOwnedLoopbackConnection,
  readWindowsCopresenceRecord,
  taskkillWindowsProcessTree,
  windowsCopresenceLogPath,
  windowsCopresenceRecordPath,
  writeWindowsCopresenceRecord,
  decideWindowsManagedStop,
  type WindowsManagedProcess,
} from "../src/windows-codex-copresence";
import { normalizeBatchWorkdir } from "../src/batch-workdir";
import { copresenceThreadPlan } from "../src/codex-copresence-thread";
import {
  bridgeClientHealthReceipt,
  assertPendingServerQuiesced,
  codexTuiLaunchArgs,
  migrateCodexPendingThread,
  requirePromotedCodexPendingThread,
} from "../src/codex-tui-client-health";
import { probePosixOwnedLoopbackConnection } from "../src/posix-codex-copresence";
import {
  backupCodexRecoveryState,
  codexTopologyAudit,
  quiesceThenSnapshot,
  resumeAndVerifyCodexThread,
  verifyCodexThreadHistory,
  type CodexRecoveryVerification,
} from "../src/codex-copresence-recovery";
import { loadMockLlmRules, resolveMockLlmReply } from "../src/mock-llm";
import {
  decideDashboardListener,
  parseDashboardLaunchRecord,
  isDashboardProcessCommand,
  type DashboardLaunchRecord,
  type DashboardLaunchSource,
} from "../src/dashboard-managed-process";
import {
  buildBootstrapPasswordUpdateInvocation,
  resolveBootstrapDatabasePath,
} from "../src/bootstrap-password-db";
import {
  CODEX_MODEL_CHOICES,
  DEFAULT_CODEX_MODEL,
  defaultCodexModelForRuntime,
} from "../src/codex-model-default";
import { resolvePrimaryNetwork } from "../src/primary-network";

const args = process.argv.slice(2);
const command = args[0];
const home = process.env.HOME || process.env.USERPROFILE || "~";
const opencodeBindingHome = () => home === "~" ? homedir() : home;

// ── Config helpers ──

function globalConfigPath() { return join(home, ".anet", "config.json"); }
function serverConfigPath() { return join(home, ".anet", "server", "config.json"); }
function adminUtokPath() { return join(home, ".anet", "server", "admin-utok.json"); }
function dashboardLaunchRecordPath(port: string | number) { return join(home, ".anet", "server", `dashboard-${port}.json`); }
function nodesDir() { return join(process.cwd(), ".anet", "nodes"); }
function skillCachePath() { return join(home, ".anet", "skillhub", "catalog-cache.json"); }
function shellQuote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }
/**
 * Pane target (`<session>:<window>.<pane>`) for a session, or null.
 *
 * 🔴 Do NOT use `=name` for capture-pane / send-keys. tmux 3.4 resolves `=name`
 *    for session-targeting commands but not for pane-targeting ones when the
 *    name is non-ASCII, and this fleet's session names are nearly all Chinese:
 *
 *      capture-pane -t '=zz中文探针'  → rc=1  can't find pane
 *      capture-pane -t 'zz中文探针'   → rc=0
 *
 *    So the exact form for a pane is the coordinate, with the session matched by
 *    string equality in our own code rather than by tmux's prefix rules.
 */
/**
 * Will `anet hub start` be able to run?
 *
 * 🔴 The authority is the guard inside `hub start` itself:
 *       if (!commandExists("bunx"))
 *    Tightened from OR in #766 — the only spawn point is `spawnLauncher("bunx", …)`, so
 *    bun alone was never enough. Anything that PREDICTS that guard must route
 *    through here rather than restating the condition: three restatements had
 *    already drifted to the old OR and told bun-only machines they were fine.
 *
 *    Deliberately not used by the guard itself. tests/test766-bunx-preflight
 *    pins that literal and mutates it to prove the gate is live; a helper call
 *    there would make the guard invisible to its own test.
 */
function bunxAvailable(): boolean {
  return commandExists("bunx");
}

function tmuxPaneTarget(sessionName: string): string | null {
  try {
    const out = execFileSync("tmux", ["list-panes", "-a", "-F", PANE_LIST_FORMAT], {
      encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    return paneTargetFor(out, sessionName);
  } catch {
    return null;  // no server / no panes
  }
}

/** Kill a session and report whether it is actually gone afterwards. */
function killTmuxSession(sessionName: string): boolean {
  try { execFileSync("tmux", ["kill-session", "-t", exactSession(sessionName)], { stdio: "pipe" }); } catch {}
  // Asking is not killing. `kill-session` failing is swallowed on purpose (a
  // session that is already gone is the common case and not an error), which
  // means the only way to know is to look afterwards — otherwise `node stop`
  // prints "tmux(tui) killed" and notifies the hub offline while the session
  // is still running.
  return !tmuxSessionRunning(sessionName);
}
function startNodeTmuxSession(sessionName: string, alias: string) {
  // #117 helper used by `anet project up/restart` + the debate/social/PR-review
  // demos. Spawns a detached tmux session that runs `anet node start <alias>`
  // (which since #136 defaults to foreground — no auto-tmux nesting).
  execFileSync("tmux", ["new-session", "-d", "-s", sessionName, `anet node start ${shellQuote(alias)}`], { stdio: "pipe" });
}
function tmuxSessionRunning(name: string): boolean {
  try { execFileSync("tmux", ["has-session", "-t", exactSession(name)], { stdio: "pipe" }); return true; }
  catch { return false; }
}
// #122 — gate auto-tmux on tmux actually being installed. The CLI never
// hard-depends on tmux (a fresh dev box without it should still get a working
// foreground start), so this is best-effort with a short-circuit cache.
let tmuxAvailableCache: boolean | null = null;
function tmuxAvailable(): boolean {
  if (tmuxAvailableCache !== null) return tmuxAvailableCache;
  try { execFileSync("tmux", ["-V"], { stdio: "pipe" }); tmuxAvailableCache = true; }
  catch { tmuxAvailableCache = false; }
  return tmuxAvailableCache;
}

// ── RFC-030 co-presence orchestration helpers ────────────────────────────
//
// `anet node start <alias> --copresence` starts a runtime-specific shared TUI:
//   codex:    app-server + agent-node bridge + codex remote TUI (3 tmux panes)
//   opencode: native loopback serve + agent-node bridge + official attach TUI
//             (the server lives inside the bridge process, so 2 tmux panes)
// Both paths use per-node credentials and exact tmux names. The codex path
// additionally preserves the RFC-030 Risk C double-confirmation gate.

const COPRESENCE_PORT_RANGE_START = 24700;
const COPRESENCE_PORT_RANGE_END = 24799;

async function findFreeLoopbackPort(preferred?: number): Promise<number> {
  const tryOne = (port: number) => new Promise<number | null>((resolve) => {
    const s = netCreateServer();
    s.once("error", () => resolve(null));
    s.listen(port, "127.0.0.1", () => {
      const addr = s.address();
      const chosen = typeof addr === "object" && addr ? addr.port : null;
      s.close(() => resolve(chosen));
    });
  });
  if (preferred !== undefined) {
    const got = await tryOne(preferred);
    if (got !== null) return got;
  }
  for (let p = COPRESENCE_PORT_RANGE_START; p <= COPRESENCE_PORT_RANGE_END; p++) {
    const got = await tryOne(p);
    if (got !== null) return got;
  }
  throw new Error(`no free port in ${COPRESENCE_PORT_RANGE_START}-${COPRESENCE_PORT_RANGE_END}`);
}

function waitForTmuxPaneText(sessionName: string, needle: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      try {
        const paneTarget = tmuxPaneTarget(sessionName);
        // 🔴 The pane is not listable the instant `tmux new-session -d` returns,
        //    so a miss here is normal and means "not yet", never "give up".
        //
        //    The old `return false` left this promise UNSETTLED: it neither
        //    resolved nor rescheduled, so the await never completed, the event
        //    loop drained, and node exited 0 — `anet node start --copresence`
        //    printed two lines and returned success having started nothing.
        //    Reproduced every time in a clean container; instrumented to
        //    confirm this exact branch.
        if (!paneTarget) {
          if (Date.now() >= deadline) { resolve(false); return; }
          setTimeout(poll, 400);
          return;
        }
        // 🔴 `-S -200`:不带它,capture-pane 只返回**当前可见区**。
        // 一行「listening on: …」被后续日志顶出屏幕之后,这个轮询就再也看不到它了,
        // 于是等满 timeout 判失败 —— 而服务其实早就绑上了(#849 实测 1.1s 绑上、
        // 25s 判失败)。本地复现:同一个 pane,先打 needle 再刷 200 行日志,
        //   capture-pane -p          → includes = false
        //   capture-pane -p -S -500  → includes = true
        // 这个函数找的是**一次性出现过**的那一行,不是「此刻屏幕上有什么」,
        // 所以它必须看回滚。(同文件 :810 早就带了 `-S -80`——正确写法一直在。)
        const out = execFileSync("tmux", ["capture-pane", "-t", paneTarget, "-p", "-J", "-S", "-200"], {
          stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
        });
        if (out.includes(needle)) { resolve(true); return; }
      } catch { /* session may still be spinning up */ }
      if (Date.now() >= deadline) { resolve(false); return; }
      setTimeout(poll, 400);
    };
    poll();
  });
}

/**
 * Read a pane, optionally including scrollback.
 *
 * Which one you want depends on the question — see codexTuiPaneState. "Is it
 * blocked right now" must NOT read scrollback (an answered prompt lives there
 * forever); "did the TUI ever paint" must, because the banner scrolls away.
 */
function capturePane(sessionName: string, scrollbackLines?: number): string | null {
  try {
    const paneTarget = tmuxPaneTarget(sessionName);
    if (!paneTarget) return null;
    const args = ["capture-pane", "-t", paneTarget, "-p"];
    if (scrollbackLines) args.push("-S", `-${scrollbackLines}`);
    return execFileSync("tmux", args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch { return null; }
}

/**
 * Poll until the TUI has painted, then classify what it shows.
 *
 * Keys on a codex marker, never on "the pane has text": the launcher's own
 * output sits in that pane for several seconds before codex clears the screen,
 * and an emptiness-based rule reports ready before the TUI even exists. See
 * codexTuiPaneState for the measured timeline.
 */
async function codexTuiStateAfterRender(sessionName: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const onScreen = capturePane(sessionName);
    if (onScreen !== null) {
      const everSeen = capturePane(sessionName, 400) ?? onScreen;
      const state = codexTuiPaneState(onScreen, everSeen);
      if (state !== "not-painted") return state;
    }
    if (Date.now() >= deadline) return "not-painted" as const;
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function resolveCopresenceWebSocketCtor(): Promise<any> {
  const g = (globalThis as any).WebSocket;
  if (typeof g === "function") return g;
  try {
    const undici = await import("undici");
    if (typeof (undici as any).WebSocket === "function") return (undici as any).WebSocket;
  } catch { /* fall through */ }
  throw new Error(
    "no WebSocket available — need Bun / Node 22+ (global WebSocket) or `undici` in node_modules",
  );
}

// Minimal WebSocket JSON-RPC thread creator against a running `codex
// app-server`. Mirrors agent-node/tests/rfc-030-create-thread.ts but inlined
// so the shipped CLI can call it (tests/ is not published).
async function createCodexCopresenceThread(
  ws: string,
  timeoutMs = 60_000,
  resumeThreadId?: string,
): Promise<{ threadId: string; verification?: CodexRecoveryVerification; freshDeferred: boolean }> {
  const WsCtor = await resolveCopresenceWebSocketCtor();
  const socket = new WsCtor(ws);
  const deadline = Date.now() + timeoutMs;
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`ws open timeout on ${ws}`)), Math.max(1000, deadline - Date.now()));
    socket.addEventListener("open", () => { clearTimeout(to); resolve(); }, { once: true });
    socket.addEventListener("error", (e: any) => { clearTimeout(to); reject(new Error(`ws error: ${e?.message || e}`)); }, { once: true });
  });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  socket.addEventListener("message", (ev: any) => {
    let msg: any;
    try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString()); } catch { return; }
    if (typeof msg?.id === "number" && !msg.method) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) {
        // #P2fix复审顺手4 — attach .code so isAlreadyInitializedError's
        // code-based branch is live (mirrors codex-app-server-client.ts
        // where the shared client attaches err.error.code).
        const rpcErr = new Error(`${msg.error.code}: ${msg.error.message}`);
        (rpcErr as Error & { code?: number }).code = msg.error.code;
        p.reject(rpcErr);
      } else p.resolve(msg.result);
    }
  });
  const request = (method: string, params: any, timeoutMsInner: number) => new Promise<any>((resolve, reject) => {
    const id = nextId++;
    const to = setTimeout(() => { pending.delete(id); reject(new Error(`request ${method} timeout`)); }, timeoutMsInner);
    pending.set(id, {
      resolve: (v) => { clearTimeout(to); resolve(v); },
      reject: (e) => { clearTimeout(to); reject(e); },
    });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
  const notify = (method: string, params: any) =>
    socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  try {
    try {
      await request("initialize", {
        clientInfo: { name: "anet-copresence-creator", title: "creator", version: "0.0.1" },
      }, 10_000);
      notify("initialized", {});
    } catch (e) {
      // #P2fix顺手4 — only swallow "already initialized" on the shared
      // server path; every other initialize failure is real.
      if (!isAlreadyInitializedError(e)) throw e;
    }
    const plan = copresenceThreadPlan(resumeThreadId);
    if (plan.method === "thread/resume") {
      if (!SAFE_THREAD_ID.test(plan.params.threadId)) throw new Error("stored threadId has unexpected shape");
      const verification = await resumeAndVerifyCodexThread(
          plan.params.threadId,
          (method, params) => request(method, params, 15_000),
        );
      return { threadId: plan.params.threadId, verification, freshDeferred: false };
    }
    // A fresh Codex 0.148 thread cannot be resumed by a second client until
    // the human TUI owns/materializes it. Do not create or mutate a thread:
    // the deferred bridge observes the TUI's unique thread/started event.
    return { threadId: "", freshDeferred: true };
  } finally {
    try { socket.close(); } catch { /* ignore */ }
  }
}

async function askTypedConfirmation(prompt: string, expected: string): Promise<boolean> {
  const rl = getRL();
  const answer = await new Promise<string>((resolve) => rl.question(prompt, (s) => resolve(s)));
  closeRL();
  return answer.trim() === expected;
}

function copresenceTmuxSessions(displayName: string): { appsrv: string; bridge: string; tui: string } {
  return { appsrv: `${displayName}-appsrv`, bridge: `${displayName}-桥`, tui: displayName };
}

// #P2fix必修2 — validate hub URL for the --copresence codepath before it
// interpolates into a bash -c argument. `hub` comes from the project-local
// `.anet/nodes/<id>/config.json`, so a hostile checkout could plant a URL
// containing shell metacharacters. URL parsing catches most junk; the
// explicit-char reject is defense-in-depth (backtick / dollar / quote would
// break out of the outer single-quoted wrapper even if URL.parse accepted).
const UNSAFE_HUB_CHARS = /['"`$;|&\r\n\t\\]/;
function assertSafeHubUrl(hub: string): void {
  if (typeof hub !== "string" || !hub) {
    throw new Error("hub URL is empty");
  }
  if (UNSAFE_HUB_CHARS.test(hub)) {
    const printable = hub.replace(/[^\x20-\x7e]/g, "?");
    throw new Error(`invalid hub URL (contains disallowed character): ${printable}`);
  }
  let parsed: URL;
  try { parsed = new URL(hub); }
  catch { throw new Error(`invalid hub URL (not parseable): ${hub}`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`invalid hub URL (scheme must be http/https): ${hub}`);
  }
}

// #P2fix必修1 — token must NOT appear in argv or tmux pane_start_command.
// Writes ANET_CODEX_COMMHUB_TOKEN to a 0600 file inside <codexHome> (0700);
// the tmux child sources then removes it before exec'ing codex, so the
// value never reaches /proc/*/cmdline nor tmux's pane_start_command.
// Do NOT use `tmux new-session -e KEY=VAL` (env pairs are argv) or
// `tmux send-keys` (writes into pane history).
function writeCodexCopresenceEnvFile(codexHome: string, token: string): string {
  const envPath = join(codexHome, ".anet-copresence.env");
  // #P2fix复审必修 — TOCTOU + symlink-follow attack surface.
  // Without pre-unlink, a pre-existing symlink at envPath would be followed
  // by writeFileSync and write the token to the link target (rm -f later only
  // removes the link, not the target). Without flag:"wx", writeFileSync creates
  // the file at umask default (typically 0644) and the chmod-to-0600 race is
  // observable to any world-readable scan.
  try { unlinkSync(envPath); } catch (err: any) { if (err?.code !== "ENOENT") throw err; }
  writeFileSync(envPath, `export ANET_CODEX_COMMHUB_TOKEN=${shellQuote(token)}\n`, { mode: 0o600, flag: "wx" });
  chmodIfPosix(envPath, 0o600);  // belt-and-suspenders in case older node ignores mode option
  return envPath;
}

// #P2fix顺手3 — threadId comes from our own JSON-RPC thread/start response
// (server-generated UUID / ULID / opaque token), but we interpolate it into
// a bash string, so a strict-shape check is cheap defense-in-depth against
// a protocol change or a compromised app-server.
const SAFE_THREAD_ID = /^[A-Za-z0-9_-]+$/;

// #P2fix顺手4 — mirrors codex-app-server-bridge.ts:isAlreadyInitialized.
// Only "already initialized" (code -32600 or matching message) is expected
// on the shared-server bootstrap path; every other initialize failure is
// real and must re-throw. Inline copy — cli.ts stays package-boundary-free.
function isAlreadyInitializedError(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  if (code === -32600) return true;
  const msg = (e as { message?: unknown })?.message;
  return typeof msg === "string" && /already initialized/i.test(msg);
}

interface CopresenceOptions {
  codexBin: string;
  codexHome: string;
  model?: string;
  port?: number;
  dangerFullAccess: boolean;
  yesDangerFullAccess: boolean;
  /** Stage the host's auth.json / version.json into the node CODEX_HOME. */
  inheritCodexHome: boolean;
  hub: string;
  token: string;
  /** #1856 PR-B: restore the exact-session TUI before attaching the bridge (thread must be known). */
  tuiFirst?: boolean;
}

/** True once `${hub}/health` answers. Unauthenticated on purpose: we only need
 *  to know something is listening, not to read anything from it. */
async function hubAnswersHealth(hub: string, timeoutMs = 2_000): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`${hub}/health`, { signal: ctl.signal });
    clearTimeout(t);
    return res.ok || res.status === 401;   // 401 = up, just gated
  } catch { return false; }
}

const ANET_HUB_TMUX_SESSION = "anet-hub";

/**
 * Start the local hub if the node's own hub is loopback and nothing answers.
 *
 * 🔴 Loopback only. A remote hub that refuses is somebody else's service, and
 *    spawning a local one would point the node at a DIFFERENT hub than its
 *    profile names — it would come up looking healthy and be invisible to
 *    everyone waiting for it on the real one. See isLoopbackHub.
 *
 * Detached in tmux, because `anet hub start` runs the server in the foreground
 * (stdio: "inherit") and this caller has a node to bring up afterwards.
 */
async function ensureLocalHubRunning(hub: string): Promise<void> {
  if (await hubAnswersHealth(hub)) return;
  if (!isLoopbackHub(hub)) {
    console.error(`[anet] ❌ ${hub} is not answering, and it is not a loopback hub — anet will not start someone else's service.`);
    console.error(`[anet]    Start it where it lives, or point this node at a hub that is up.`);
    process.exit(1);
  }
  // 🔴 Tee the hub's own output to a file. `anet hub start` exits 1 on a failed
  //    preflight (missing bunx is the common one), which takes the tmux session
  //    with it — so "attach to tmux=anet-hub" is advice pointing at something
  //    that no longer exists. Observed exactly that: the session was gone and
  //    the only thing printed was our own 60s timeout. The reason lives here.
  const hubLog = join(tmpdir(), `anet-hub-start-${process.pid}.log`);
  if (process.platform === "win32") {
    console.log(`[anet] local hub ${hub} is not up — starting it as a managed Windows background process`);
    const hubPort = (() => { try { return new URL(hub).port || "9200"; } catch { return "9200"; } })();
    const fd = openPrivateAppendLog(hubLog);
    try {
      const child = spawn(process.execPath, [process.argv[1] ?? "", "hub", "start", "--port", hubPort], {
        cwd: process.cwd(), detached: true, windowsHide: true,
        stdio: ["ignore", fd, fd], env: { ...process.env },
      });
      child.unref();
    } catch (e) {
      console.error(`[anet] ❌ could not start the local hub on Windows: ${(e as Error).message}`);
      process.exit(1);
    } finally { closeLog(fd); }
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await hubAnswersHealth(hub)) { console.log(`[anet] local hub is up`); return; }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.error(`[anet] ❌ the local hub did not answer ${hub}/health within 60s.`);
    try { console.error(readFileSync(hubLog, "utf8").trim().split("\n").slice(-12).join("\n")); } catch {}
    process.exit(1);
  }
  if (tmuxSessionRunning(ANET_HUB_TMUX_SESSION)) {
    console.log(`[anet] local hub is starting in tmux=${ANET_HUB_TMUX_SESSION} — waiting for it`);
  } else {
    console.log(`[anet] local hub ${hub} is not up — starting it in tmux=${ANET_HUB_TMUX_SESSION}`);
    try {
      // 🔴 Re-invoke THIS entry point, not a bare `anet`.
      //    Bare `anet` depends on the name being on PATH — it was not in a
      //    container running the CLI directly, and the only thing printed was
      //    "anet: command not found" 60s later. Worse in production: whoever
      //    launched this may have been running npx, a local build, or another
      //    channel, and a bare name would start a DIFFERENT version's hub than
      //    the one the operator is holding.
      // 🔴 Pass the port from the NODE's hub URL. `anet hub start` defaults to
      //    9200 regardless of what the node was told to use, so on any other
      //    port auto-start brings up a hub the node will never reach and the
      //    wait below times out against a perfectly healthy server. Observed:
      //    node on 9299, "Server: http://127.0.0.1:9200", 60s timeout.
      const hubPort = (() => { try { return new URL(hub).port || "9200"; } catch { return "9200"; } })();
      const selfCmd = `${shellQuote(process.execPath)} ${shellQuote(process.argv[1] ?? "")}`
        + ` hub start --port ${shellQuote(hubPort)}`;
      // 🔴 tmux does NOT hand a new session this process's environment — the
      //    child inherits the tmux SERVER's, which was frozen whenever that
      //    server started. Without forwarding it, an operator who set
      //    COMMHUB_DB to isolate a test hub gets one on the DEFAULT database:
      //    verified here by starting a hub on a spare port with COMMHUB_DB set
      //    and finding it serving the production data, while the file named by
      //    COMMHUB_DB was never created. That is precisely the second-hub-on-one-DB
      //    case hub-daemon.sh guards against, entered through our own auto-start.
      const forwardedEnv = process.env.COMMHUB_DB
        ? ["-e", `COMMHUB_DB=${process.env.COMMHUB_DB}`]
        : [];
      execFileSync("tmux", [
        "new-session", "-d", "-s", ANET_HUB_TMUX_SESSION,
        ...forwardedEnv,
        `${selfCmd} 2>&1 | tee ${shellQuote(hubLog)}`,
      ], { stdio: "pipe" });
    } catch (e) {
      console.error(`[anet] ❌ could not start the local hub: ${(e as Error).message}`);
      console.error(`[anet]    Start it yourself in another terminal: anet hub start`);
      process.exit(1);
    }
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await hubAnswersHealth(hub)) {
      console.log(`[anet] local hub is up`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`[anet] ❌ the local hub did not answer ${hub}/health within 60s.`);
  // Say WHY, not where to look — the session is usually already gone.
  let said = false;
  try {
    const out = readFileSync(hubLog, "utf8").trim();
    if (out) {
      console.error(`[anet]    anet hub start said:`);
      for (const line of out.split("\n").filter((l) => l.trim()).slice(-12)) {
        console.error(`[anet]      ${line}`);
      }
      said = true;
    }
  } catch { /* no log: fall through to the generic hint */ }
  if (!said) {
    console.error(tmuxSessionRunning(ANET_HUB_TMUX_SESSION)
      ? `[anet]    It is still running — look at it: tmux attach -t '=${ANET_HUB_TMUX_SESSION}'`
      : `[anet]    Its tmux session is already gone, and it left no output. Try: anet hub start`);
  }
  process.exit(1);
}

async function waitForFileText(path: string, needle: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (readFileSync(path, "utf8").includes(needle)) return true; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function waitForLoopbackPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = netCreateConnection({ host: "127.0.0.1", port });
      const finish = (ok: boolean) => { socket.destroy(); resolve(ok); };
      socket.setTimeout(500);
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.once("timeout", () => finish(false));
    });
    if (connected) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function windowsManagedProcess(
  role: "appsrv" | "bridge",
  command: string,
  argv: string[],
  env: NodeJS.ProcessEnv,
  logPath: string,
  shell = false,
): Promise<WindowsManagedProcess> {
  const fd = openPrivateAppendLog(logPath);
  let child;
  try {
    child = spawn(command, argv, {
      cwd: process.cwd(), env, detached: true, windowsHide: true,
      stdio: ["ignore", fd, fd], shell,
    });
    child.unref();
  } finally { closeLog(fd); }
  if (!child?.pid) throw new Error(`${role} did not return a pid`);
  let creationDate: string | null = null;
  for (let i = 0; i < 30 && !creationDate; i++) {
    creationDate = probeWindowsCreationDate(child.pid);
    if (!creationDate) await new Promise((r) => setTimeout(r, 100));
  }
  if (!creationDate) {
    try { taskkillWindowsProcessTree(child.pid); } catch {}
    throw new Error(`${role} pid=${child.pid} has no queryable Windows CreationDate; refusing an unmanaged process`);
  }
  return { role, pid: child.pid, creationDate, logPath };
}

async function stopPriorWindowsCopresence(nodeId: string): Promise<void> {
  const prior = readWindowsCopresenceRecord(nodesDir(), nodeId);
  if (!prior) return;
  const decision = decideWindowsManagedStop(prior, probeWindowsCreationDate);
  for (const process of decision.safe) {
    try { taskkillWindowsProcessTree(process.pid); }
    catch (e) {
      throw new Error(`could not stop prior ${process.role} pid=${process.pid}: ${(e as Error).message}`);
    }
  }
  rmSync(windowsCopresenceRecordPath(nodesDir(), nodeId), { force: true });
}

function persistCodexRecoveryPoint(resolved: NonNullable<ReturnType<typeof resolveNodeRef>>, codexHome: string): void {
  const nodeDir = join(nodesDir(), resolved.id);
  const backup = backupCodexRecoveryState({ nodeDir, codexHome });
  const cfgPath = join(nodeDir, "config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.codexRecoveryBackup = { createdAt: backup.createdAt, stateFiles: backup.stateFiles, path: backup.backupDir };
  atomicWritePrivateJson(cfgPath, cfg);
  resolved.profile.codexRecoveryBackup = cfg.codexRecoveryBackup;
  console.log(`[anet] recovery point created after prior runtime quiesced (${backup.stateFiles.length} session-state item(s); credentials excluded)`);
}

async function startWindowsCodexCopresence(
  resolved: NonNullable<ReturnType<typeof resolveNodeRef>>,
  displayName: string,
  opts: CopresenceOptions,
  model: string,
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Windows Codex co-presence needs an interactive console (Windows Terminal, PowerShell, or cmd.exe)");
  }
  const unsafeCmd = /[\r\n&|<>^%!`()\"]/;
  if (unsafeCmd.test(opts.codexBin) || unsafeCmd.test(opts.model || "")) {
    throw new Error("Windows codex command/model contains cmd.exe metacharacters");
  }
  const recoveryCfg = JSON.parse(readFileSync(join(nodesDir(), resolved.id, "config.json"), "utf-8"));
  const priorWindowsRecord = readWindowsCopresenceRecord(nodesDir(), resolved.id);
  let authoritativeOldPendingMarker: string | undefined;
  if (recoveryCfg.codexPendingThread !== undefined) {
    if (priorWindowsRecord?.version !== 2 || !priorWindowsRecord.marker
      || recoveryCfg.codexPendingThread?.marker !== priorWindowsRecord.marker) {
      throw new Error("pending Codex thread is not bound to the exact private previous-generation Windows record");
    }
    authoritativeOldPendingMarker = priorWindowsRecord.marker;
  }
  // Authoritative snapshot only after all prior writers have been reaped.
  // Failure aborts before any replacement app-server can start.
  await quiesceThenSnapshot(
    () => stopPriorWindowsCopresence(resolved.id),
    () => persistCodexRecoveryPoint(resolved, opts.codexHome),
  );
  if (authoritativeOldPendingMarker) {
    await assertPendingServerQuiesced(recoveryCfg.codexAppServerUrl, (oldPort) => waitForLoopbackPort(oldPort, 750));
  }
  const port = await findFreeLoopbackPort(opts.port);
  const wsUrl = `ws://127.0.0.1:${port}`;
  const posture = codexCopresencePosture(opts.dangerFullAccess, resolved.profile, displayName);
  if (posture.downgradeNotice) console.error(posture.downgradeNotice);
  const marker = randomUUID();
  const appLog = windowsCopresenceLogPath(nodesDir(), resolved.id, "appsrv");
  const bridgeLog = windowsCopresenceLogPath(nodesDir(), resolved.id, "bridge");
  rmSync(appLog, { force: true });
  rmSync(bridgeLog, { force: true });
  const hubMcpUrlToml = `mcp_servers.commhub.url=${opts.hub}/mcp`;
  const bearerTomlLiteral = `mcp_servers.commhub.bearer_token_env_var=ANET_CODEX_COMMHUB_TOKEN`;
  const appEnv = {
    ...process.env,
    CODEX_HOME: opts.codexHome,
    ANET_NODE_MARKER: marker,
    ANET_CODEX_COMMHUB_TOKEN: opts.token,
  };
  const managed: WindowsManagedProcess[] = [];
  try {
    managed.push(await windowsManagedProcess("appsrv", opts.codexBin, [
      "app-server",
      "-c", `approval_policy=${posture.approvalPolicy}`,
      "-c", `sandbox_mode=${posture.sandboxMode}`,
      "-c", `model=${model}`,
      "-c", hubMcpUrlToml,
      "-c", bearerTomlLiteral,
      "--listen", wsUrl,
    ], appEnv, appLog, true));
    writeWindowsCopresenceRecord(nodesDir(), resolved.id, managed, marker);
    console.log(`[anet] ① app-server pid=${managed[0].pid} listening ${wsUrl} (sandbox=${posture.sandboxMode})…`);
    // npm installs Codex as codex.cmd. Its cmd.exe grandchild does not
    // reliably inherit a detached Node file descriptor on Windows, so log
    // text is not a readiness signal. Probe the actual loopback listener.
    if (!await waitForLoopbackPort(port, 25_000)) {
      throw new Error(`app-server did not bind ${wsUrl} within 25s; log=${appLog}`);
    }
    const thread = await createCodexCopresenceThread(wsUrl, 60_000, resolved.profile.codexThreadId);
    let threadId = thread.threadId;
    let freshDeferred = thread.freshDeferred;
    if (!freshDeferred && !SAFE_THREAD_ID.test(threadId)) throw new Error("unexpected threadId shape");
    const rawCfgPath = join(nodesDir(), resolved.id, "config.json");
    const rawCfg = JSON.parse(readFileSync(rawCfgPath, "utf-8"));
    let pendingRecoveryId: string | undefined;
    if (freshDeferred && rawCfg.codexPendingThread !== undefined) {
      const migrated = migrateCodexPendingThread(
        rawCfg.codexPendingThread,
        rawCfg.codexAppServerUrl,
        authoritativeOldPendingMarker,
        wsUrl,
        marker,
      );
      rawCfg.codexPendingThread = migrated;
      pendingRecoveryId = migrated.threadId;
    }
    rawCfg.codexAppServerPort = port;
    rawCfg.codexAppServerUrl = wsUrl;
    if (freshDeferred) { delete rawCfg.codexThreadId; delete rawCfg.codexRecoveryVerification; }
    else { rawCfg.codexThreadId = threadId; rawCfg.codexRecoveryVerification = thread.verification; }
    delete rawCfg.session;
    atomicWritePrivateJson(rawCfgPath, rawCfg);

    const bridgeEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CODEX_HOME: opts.codexHome,
      ANET_NODE_MARKER: marker,
      ANET_COPRESENCE_BRIDGE: "1",
    };
    delete bridgeEnv.COMMHUB_TOKEN;
    delete bridgeEnv.ANET_CODEX_COMMHUB_TOKEN;
    managed.push(await windowsManagedProcess("bridge", process.execPath, [
      process.argv[1] ?? "", "node", "start", displayName,
    ], bridgeEnv, bridgeLog));
    writeWindowsCopresenceRecord(nodesDir(), resolved.id, managed, marker);
    const bridgeReceipt = pendingRecoveryId
      ? bridgeClientHealthReceipt(wsUrl, pendingRecoveryId)
      : freshDeferred
        ? "[codex-app-server] client-health role=bridge state=waiting-for-tui-thread"
        : bridgeClientHealthReceipt(wsUrl, threadId);
    if (!await waitForFileText(bridgeLog, bridgeReceipt, 25_000)) {
      throw new Error(`bridge did not attach to the shared app-server before TUI launch; log=${bridgeLog}`);
    }
    if (!probeWindowsCreationDate(managed[1].pid)) throw new Error(`bridge exited during startup; log=${bridgeLog}`);
    if (pendingRecoveryId) {
      const promoted = JSON.parse(readFileSync(rawCfgPath, "utf-8"));
      threadId = requirePromotedCodexPendingThread(promoted, pendingRecoveryId);
      freshDeferred = false;
    }

    console.log(`[anet] ② bridge pid=${managed[1].pid} running`);
    console.log(`[anet] ③ opening Codex TUI in this Windows console (thread=${threadId || "pending-user-thread"})`);
    console.log(`[anet]    stop from another terminal: anet node stop ${displayName}`);
    const tuiArgs = codexTuiLaunchArgs(wsUrl, model, freshDeferred ? undefined : threadId, opts.dangerFullAccess);
    const tui = spawn(opts.codexBin, tuiArgs, {
      cwd: process.cwd(), env: { ...process.env, CODEX_HOME: opts.codexHome },
      stdio: "inherit", windowsHide: false, shell: true,
    });
    await new Promise<void>((resolve, reject) => {
      tui.once("error", reject);
      tui.once("spawn", resolve);
    });
    const tuiCreationDate = tui.pid ? probeWindowsCreationDate(tui.pid) : null;
    if (!tui.pid || !tuiCreationDate) {
      throw new Error("TUI second-client health failed: could not attest the launched TUI process birth");
    }
    // #1342: 这个循环有**两个出口**,以前共用同一条报错。
    //
    //   出口①  25s 到点   → TUI 还活着,只是一直没连上
    //   出口②  tui.exitCode !== null → **TUI 自己退了**,压根没活到能连
    //
    // 报成同一句「没有可归属的连接」时,出口②是**误诊**:查的人会去看端口、
    // 防火墙、app-server,而真实情况是那个进程根本没起来。两个方向完全相反。
    //
    // 并且原文案不说它找的是什么 —— pid / birth / port 一个都没有。
    // 一条只报结论、不报「比对的那两样东西」的报错,只能靠从头复现来查。
    const TUI_HEALTH_MS = 25_000;
    const tuiHealthStart = Date.now();
    const tuiHealthDeadline = tuiHealthStart + TUI_HEALTH_MS;
    let tuiConnected = false;
    let tuiProbes = 0;
    // 🔴 #1342 —— 记下**每次探测本身**花了多久。为什么这一个数字值得单独存:
    //    五次采样里 `probes` 全都是 1,而 `waited` 是 6.5–9.4 秒。这两个数放在
    //    一起,只能说明「循环只转了一圈」,分不出到底是
    //      (a) 探测本身很慢(它每次新起一个 powershell,并在 do{…}while 里
    //          反复枚举整张 Win32_Process),于是 25 秒预算里只跑得完一次;
    //      (b) 还是 TUI 无论如何都在 ~7 秒退出,探多少次都一样。
    //    这两者该查的地方完全相反 —— 前者查探测成本,后者查 TUI。
    //    加一个数就能分辨,所以加。
    let probeMsMax = 0;
    let probeMsLast = 0;
    while (Date.now() < tuiHealthDeadline && tui.exitCode === null) {
      tuiProbes++;
      const probeStart = Date.now();
      const hit = probeWindowsOwnedLoopbackConnection(tui.pid, tuiCreationDate, port);
      probeMsLast = Date.now() - probeStart;
      if (probeMsLast > probeMsMax) probeMsMax = probeMsLast;
      if (hit) {
        tuiConnected = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (!tuiConnected) {
      const waited = Date.now() - tuiHealthStart;
      // #1342 —— 只在失败时量一次「起一个 powershell 要多久」。它是那 10.5 秒里
      //   **启动**那一段的下界;剩下的就是 CIM 全表查询那一段。两段要查的东西
      //   完全不同(runner/镜像 vs 查询写法),而此前日志里分不开。
      const psStartMs = measurePowerShellStartupMs();
      const looking = `pid=${tui.pid} birth=${tuiCreationDate} port=${port} probes=${tuiProbes} waited=${waited}ms probeMsLast=${probeMsLast} probeMsMax=${probeMsMax} psStartMs=${psStartMs ?? "?"}`;
      if (tui.exitCode !== null) {
        throw new Error(
          `TUI second-client health failed: the launched Codex TUI exited (code=${tui.exitCode}) before it connected — ` +
          `这不是"连不上",是它没活到能连。先看 TUI 自己的输出,不要查端口/防火墙。[${looking}]`,
        );
      }
      throw new Error(
        `TUI second-client health failed: launched TUI tree has no attributable connection to the exact app-server ` +
        `after ${TUI_HEALTH_MS}ms — TUI 仍在运行,只是没有一条回环连接能归属到它这一代。[${looking}]`,
      );
    }
    console.log(freshDeferred
      ? `[anet] client-health role=bridge state=waiting-for-tui-thread`
      : `[anet] client-health role=bridge remote=exact thread=exact`);
    // 🔴 #1342 —— 耗时也打在**成功路径**上,不只打在失败诊断里。
    //
    //    #1628 把 `probeMs` 加进了 `if (!tuiConnected)` 的 `[looking]` 串,
    //    它成功定位了成本(2026-08-31 实测:单次探测 9963ms,占 waited 的 96%)。
    //    然后 #1636 按它做了优化 —— **而它验不了那个优化**:修好之后就不再失败,
    //    也就不再打印。**一个只在坏的时候说话的仪表,没法告诉你好是不是真的变好了**,
    //    而且修得越好它越沉默(拿下一个样本得等 flake 再次触发)。
    //
    //    量**错误原因**的诊断打在失败路径就够;量**成本/耗时**的必须两侧都打 ——
    //    它的用途本来就是前后对比,而对比需要两侧都有样本。
    //
    //    ⚠️ `connection=pid-attributed` 这个子串**不能动**:
    //    windows-codex-copresence.test.ts 用 indexOf 钉它的出现顺序。追加在其后是安全的。
    console.log(`[anet] client-health role=tui codex_home=exact remote=exact thread=${freshDeferred ? "pending-user-thread" : "exact"} connection=pid-attributed probes=${tuiProbes} probeMsLast=${probeMsLast} probeMsMax=${probeMsMax}`);
    const code = await new Promise<number>((resolve, reject) => {
      tui.once("exit", (c) => resolve(c ?? 1));
    });
    if (code !== 0) throw new Error(`Codex TUI exited with code ${code}`);
  } catch (e) {
    for (const process of [...managed].reverse()) {
      if (probeWindowsCreationDate(process.pid) === process.creationDate) {
        try { taskkillWindowsProcessTree(process.pid); } catch {}
      }
    }
    rmSync(windowsCopresenceRecordPath(nodesDir(), resolved.id), { force: true });
    throw e;
  }

}

/**
 * `anet node start <name> --copresence` for the grok lane.
 *
 * The mechanism already shipped — leader socket, attach protocol, profile
 * fields. What had not shipped is the last step being automatic: cli.ts used to
 * print "Start the node first, then attach from a second terminal." Codex got
 * one command; grok got two, for no reason living in the mechanism.
 *
 * Two tmux sessions, named the same way the codex lane names its three, so
 * `tmux attach -t '=<alias>'` lands a human on the TUI regardless of runtime.
 */
async function startGrokCopresenceOrchestration(
  nodeId: string,
  opts: { hub?: string },
): Promise<void> {
  const resolved = resolveNodeRef(nodeId);
  if (!resolved) {
    console.error(`Node "${nodeId}" not found. Create it first: anet node create ${nodeId}`);
    process.exit(1);
  }
  const profile = resolved.profile as any;
  const displayName = nodeDisplayName(resolved.id, profile);
  const runtime = runtimeForExecution(profile, `start grok copresence node ${JSON.stringify(nodeId)}`);

  const diag = diagnoseGrokCopresence({
    runtime,
    displayName,
    grokCopresence: profile.grokCopresence,
    grokAttachSocket: profile.grokAttachSocket,
  });
  if (!diag.ok) {
    for (const line of diag.lines) console.error(line);
    process.exit(1);
  }
  // #1768 —— 能跑但少内核层保证的平台(darwin/win32):说一句,不拦。
  for (const line of diag.notices) console.error(line);
  const attachSocket: string = profile.grokAttachSocket;

  // One preflight naming every gap, not one exit per gap — same contract the
  // codex lane uses, same table, so a dep added there is never missing here.
  // No --grok-bin knob: `grok` on PATH is what every other grok codepath in
  // this file assumes, and a flag nobody can discover is not an escape hatch.
  const missing = missingCopresenceDeps(commandExists, process.platform, "grok");
  if (missing.length > 0) {
    console.error(describeMissingDeps(missing, displayName));
    process.exit(1);
  }

  const hub = opts.hub || profile.hub || getHub();
  await ensureLocalHubRunning(hub);

  const { node: nodeSession, tui: tuiSession } = grokCopresenceSessions(displayName);
  for (const stale of [nodeSession, tuiSession]) {
    if (tmuxSessionRunning(stale)) {
      console.error(`[anet] ❌ tmux session ${stale} already exists — stop the node first: anet node stop ${shellQuote(displayName)}`);
      process.exit(1);
    }
  }
  const selfCmd = `${shellQuote(process.execPath)} ${shellQuote(process.argv[1] ?? "")}`;

  // ── piece ① the node (owns the grok leader and the attach socket) ────────
  // GROK_COPRESENCE_CHILD_ENV keeps this inner start from re-entering the
  // orchestration; without it the node forks another pair of sessions forever.
  // 🔴 Tee the node's own output to a file. A leader that dies during startup
  //    takes its tmux session with it, so "attach to tmux=<session>" is advice
  //    pointing at something that no longer exists — observed exactly that:
  //    session gone, log empty, and the only thing printed was our own timeout.
  //    ensureLocalHubRunning above already learned this; the same reason applies.
  const nodeLog = join(tmpdir(), `anet-grok-copresence-${resolved.id}.log`);
  try {
    execFileSync("tmux", [
      "new-session", "-d", "-s", nodeSession, "-c", process.cwd(),
      "-e", `${GROK_COPRESENCE_CHILD_ENV}=1`,
      "bash", "-lc", `exec ${selfCmd} node start ${shellQuote(displayName)} 2>&1 | tee ${shellQuote(nodeLog)}`,
    ], { stdio: "pipe" });
  } catch (e: any) {
    console.error(`[anet] ❌ tmux new-session ${nodeSession} failed: ${e?.message || e}`);
    process.exit(1);
  }
  console.log(`[anet] ① node tmux=${nodeSession} starting (leader + bridge)…`);

  // 🔴 Readiness is the attach socket being a SOCKET, never "tmux did not
  //    throw". A leader that dies during startup leaves either nothing or a
  //    stale regular file from an aborted run, and both read as ready to
  //    anything that only checks existence.
  const deadline = Date.now() + 45_000;
  let state = grokAttachSocketState(null);
  while (Date.now() < deadline) {
    let entry: { isSocket(): boolean } | null = null;
    try { entry = lstatSync(attachSocket); } catch { entry = null; }
    state = grokAttachSocketState(entry);
    if (state === "ready") break;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (state !== "ready") {
    console.error(`[anet] ❌ the grok leader did not open ${attachSocket} within 45s (state=${state}).`);
    // Give the child a moment to flush. Reading the log at the instant of the
    // timeout caught the banner but not the error text: node had printed the
    // file/line echo and died before the message reached the file, so the tail
    // ended mid-stack trace and the reason was still invisible.
    for (let i = 0; i < 10 && tmuxSessionRunning(nodeSession); i++) {
      await new Promise((r) => setTimeout(r, 300));
    }
    await new Promise((r) => setTimeout(r, 500));
    // Print the tail here rather than naming a session that may already be gone.
    try {
      const tail = readFileSync(nodeLog, "utf8").trim().split("\n").slice(-25);
      if (tail.length) {
        console.error(`[anet]    What it printed (${nodeLog}):`);
        for (const line of tail) console.error(`[anet]      ${line}`);
      }
    } catch { console.error(`[anet]    No output was captured at ${nodeLog}.`); }
    if (tmuxSessionRunning(nodeSession)) {
      console.error(`[anet]    Still running — look live: tmux attach -t ${shellQuote(`=${nodeSession}`)}`);
    }
    console.error(`[anet]    Cleanup: anet node stop ${shellQuote(displayName)}`);
    process.exit(1);
  }
  console.log(`[anet] ① node READY — attach socket live at ${attachSocket}`);

  // ── piece ② the attachable TUI ───────────────────────────────────────────
  try {
    execFileSync("tmux", [
      "new-session", "-d", "-s", tuiSession, "-c", process.cwd(),
      "bash", "-lc", `exec ${selfCmd} grok attach ${shellQuote(displayName)}`,
    ], { stdio: "pipe" });
  } catch (e: any) {
    console.error(`[anet] ❌ tmux new-session ${tuiSession} failed: ${e?.message || e}`);
    console.error(`[anet]    The node itself is up; attach by hand: anet grok attach ${shellQuote(displayName)}`);
    process.exit(1);
  }
  // 🔴 Do not print "ready" on the strength of new-session not throwing — the
  //    codex lane shipped exactly that bug and said ready for a TUI that had
  //    already exited. Ask tmux whether the pane is still there.
  await new Promise((r) => setTimeout(r, 800));
  if (!tmuxSessionRunning(tuiSession)) {
    console.error(`[anet] ❌ the TUI session exited immediately — attach failed.`);
    console.error(`[anet]    Reproduce it in the foreground: anet grok attach ${shellQuote(displayName)}`);
    process.exit(1);
  }
  console.log(`[anet] ② TUI tmux=${tuiSession} ready to attach`);
  console.log(``);
  console.log(`[anet] ✅ 共存节点 ${displayName} 就绪`);
  console.log(`[anet]    attach:  tmux attach -t ${shellQuote(`=${tuiSession}`)}    (Ctrl-] detaches the grok TUI)`);
  console.log(`[anet]    stop:    anet node stop ${shellQuote(displayName)}`);
  console.log(`[anet]    runtime: grok-build-cli @ ${attachSocket}`);
}

async function startCopresenceOrchestration(nodeId: string, opts: CopresenceOptions): Promise<void> {
  const resolved = resolveNodeRef(nodeId);
  if (!resolved) {
    console.error(`Node "${nodeId}" not found. Create it first: anet node create ${nodeId}`);
    process.exit(1);
  }
  const displayName = nodeDisplayName(resolved.id, resolved.profile);
  const profile = resolved.profile;
  // Resolve once for both platform backends. Keeping a second default inside
  // the Windows branch lets Windows and POSIX silently drift.
  const model = opts.model || DEFAULT_CODEX_MODEL;
  if (profile.runtime !== "codex-app-server") {
    console.error(`[anet] ❌ --copresence requires runtime=codex-app-server (node "${displayName}" is runtime=${profile.runtime}).`);
    console.error(`[anet]    Create a copresence-capable node with:`);
    console.error(`[anet]      anet node create ${shellQuote(displayName)} --runtime codex-app-server`);
    process.exit(1);
  }
  // One preflight for every external dependency, not one exit per gap. A box
  // missing tmux AND codex used to need two runs to learn both — see
  // src/copresence-deps.ts. `--codex-bin` is honoured by probing that name.
  const missingDeps = missingCopresenceDeps(
    (cmd) => (cmd === "codex" ? commandExists(opts.codexBin) : commandExists(cmd)),
  );
  if (missingDeps.length > 0) {
    console.error(describeMissingDeps(missingDeps, displayName));
    process.exit(1);
  }
  if (!opts.token || !opts.token.startsWith("ntok_")) {
    console.error(`[anet] ❌ node token is missing or not an ntok_ (co-presence bridge requires network-scoped ntok_).`);
    console.error(`[anet]    Run \`anet doctor --fix\` to repair, or recreate the node.`);
    process.exit(1);
  }

  // #P2fix必修2 — hub URL sanity before any interpolation into bash -c.
  // Rejects bad schemes, empty, and shell-metacharacter contamination.
  // 🔴 Must stay BEFORE ensureLocalHubRunning: that one puts the URL in a fetch
  //    and in a tmux command line, so it may not run on an unvalidated string.
  try { assertSafeHubUrl(opts.hub); }
  catch (e: any) {
    console.error(`[anet] ❌ ${e?.message || String(e)}`);
    console.error(`[anet]    Fix: correct the hub URL in ${join(nodesDir(), resolved.id, "config.json")} (or global .anet/config.json).`);
    process.exit(1);
  }

  // The node cannot register anywhere if nothing is listening. Starting a
  // loopback hub needs no privileges and is our own service, so a launcher that
  // refuses over it is just handing the operator a second terminal to open.
  await ensureLocalHubRunning(opts.hub);

  // Risk C double safeguard — dangerous sandbox is never the default.
  // Requires: explicit CLI flag (opts.dangerFullAccess) + typed 'yes' at
  // start (TTY caller) OR a second explicit --yes-danger-full-access flag
  // (non-TTY caller) — the two-flag non-TTY path blocks a piped-yes bypass
  // (`printf 'yes\n' | anet node start …`) while giving CI/Docker E2E an
  // opt-in route. Stderr banner fires either way.
  if (opts.dangerFullAccess) {
    console.error("");
    console.error(`⚠  --dangerously-allow-full-access ENABLED for ${displayName}`);
    console.error("   This grants the codex session unrestricted filesystem/network access.");
    console.error("   Read-only default is safer; only enable if you understand the risk.");
    console.error("");
    if (process.stdin.isTTY) {
      const ok = await askTypedConfirmation(
        "   Type 'yes' to confirm (any other input aborts): ",
        "yes",
      );
      if (!ok) {
        console.error("[anet] aborted (danger-full-access not confirmed).");
        process.exit(1);
      }
    } else {
      if (!opts.yesDangerFullAccess) {
        console.error("[anet] aborted: danger-full-access needs an interactive TTY, or");
        console.error("       both --dangerously-allow-full-access AND --yes-danger-full-access");
        console.error("       (second explicit flag prevents `printf 'yes\\n' |` bypass in scripts).");
        process.exit(1);
      }
      console.error("[anet] non-TTY danger opt-in via --yes-danger-full-access — proceeding");
    }
    console.error(`[anet] ⚠ codex 共存节点 ${displayName} 以 danger-full-access 模式运行`);
    console.error(`[anet] ⚠ (no filesystem or network sandbox; codex may write/delete freely)`);
  }

  mkdirSync(opts.codexHome, { recursive: true });
  // #P2fix复审顺手2 — 0700 on the parent is a load-bearing invariant for the
  // 0600 env file inside; if we can't enforce it, refuse to start rather than
  // silently degrade to whatever perms already exist.
  try {
    if (process.platform === "win32") ensureWindowsPrivateDirectory(opts.codexHome);
    else chmodSync(opts.codexHome, 0o700);
  } catch (e: any) {
    console.error(`[anet] ❌ cannot restrict CODEX_HOME (${opts.codexHome}): ${e?.message || e}`);
    console.error(`[anet]    Credentials require 0700 on POSIX or a protected ACL on Windows.`);
    process.exit(1);
  }

  // 🔴 凭据不在隔离 HOME 里时，codex TUI 会**静默**停在登录选择页(issue #853)：
  //    人 attach 上去只看到 "Sign in with ChatGPT / …"，没有任何东西说明为什么。
  //    本仓另外两条路径都做了凭据物化(grok 用 ensureCredentialLink 符号链接、
  //    opencode 用 writeOpencodePresetIfRequested 写独立文件)，只有 codex 这条没有。
  //    "补哪一种"是个隔离取向的决定(共享刷新 vs 真隔离)，不在这里定；
  //    但**让失败说出原因**不需要等那个决定。
  // The decision the comment above deferred, taken in
  // src/codex-copresence-preflight.ts: SHARE the host's non-session state, and
  // re-stage whenever the host copy is newer — auth.json rotates, so a one-time
  // copy is a delayed failure rather than a fix.
  try {
    const hostCodexHome = join(homedir(), ".codex");
    if (opts.inheritCodexHome) {
      mkdirSync(opts.codexHome, { recursive: true, mode: 0o700 });
      const plan = codexHomeStagePlan(hostCodexHome, opts.codexHome, (pth) => {
        try { return { mtimeMs: statSync(pth).mtimeMs }; } catch { return null; }
      }, join);
      for (const step of plan) {
        copyFileSync(step.src, step.dst);
        try { chmodIfPosix(step.dst, step.mode); } catch { /* best effort */ }
        console.log(`[anet] staged ${step.name} into the node CODEX_HOME (${step.reason}) — ${step.because}`);
      }
    } else if (!existsSync(join(opts.codexHome, "auth.json"))) {
      console.error(`[anet] ⚠ --no-inherit-codex-home, and ${join(opts.codexHome, "auth.json")} does not exist.`);
      console.error(`[anet]   codex TUI 会停在登录选择页，且不会说明原因（#853）。先在该 HOME 下登录一次。`);
    }
  } catch (e) {
    // Never refuse to launch over this: a node that starts and then reports its
    // blocker is strictly more useful than one that will not start.
    console.error(`[anet] ⚠ could not stage CODEX_HOME state: ${(e as Error).message}`);
  }

  if (process.platform === "win32") {
    try {
      await startWindowsCodexCopresence(resolved, displayName, opts, model);
      return;
    } catch (e) {
      console.error(`[anet] ❌ Windows Codex co-presence failed: ${(e as Error).message}`);
      console.error(`[anet]    Cleanup: anet node stop ${displayName}`);
      process.exit(1);
    }
  }

  const { appsrv: appsrvSession, bridge: bridgeSession, tui: tuiSession } =
    copresenceTmuxSessions(displayName);

  // #P3fix必修1 — generate the identity marker uuid ONCE. Same uuid is
  // injected into every tmux session's ANET_NODE_MARKER env AND persisted
  // to the marker file. Single source of truth defeats Blocker 1 (9f2ec282
  // generated it twice — cli-side vs helper-side — so environ scan at stop
  // never matched what was on disk, and nothing was ever killed while the
  // code reported success). See docs of writeMarker() in copresence-identity.ts.
  const identityMarker = randomUUID();
  const prelaunchCfg = JSON.parse(readFileSync(join(nodesDir(), resolved.id, "config.json"), "utf-8"));
  let authoritativeOldPendingMarker: string | undefined;
  if (prelaunchCfg.codexPendingThread !== undefined) {
    const oldIdentity = readCopresenceMarker(nodesDir(), resolved.id);
    if (oldIdentity.kind !== "ok" || prelaunchCfg.codexPendingThread?.marker !== oldIdentity.marker.marker) {
      console.error(`[anet] ❌ pending Codex thread is not bound to the exact private previous-generation marker.`);
      console.error(`[anet]    Fail-closed before reap/start: inspect the private marker and node config; no TUI was started.`);
      process.exit(1);
    }
    authoritativeOldPendingMarker = oldIdentity.marker.marker;
  }

  // #P3fix必修12 — tmux capability preflight. `new-session -e KEY=VALUE`
  // (how the marker gets injected) needs tmux 3.2+; Ubuntu 20.04 ships
  // 3.0a. Without this check the very first new-session below dies with
  // tmux's raw usage dump and the operator has nothing to act on.
  assertTmuxSupportsSessionEnv(
    () => execFileSync("tmux", ["-V"], { stdio: ["ignore", "pipe", "pipe"] }).toString(),
    (m) => console.error(m),
    (m) => { console.error(m); process.exit(1); },
  );

  // #P3fix必修5+6 — everything identity-related happens BEFORE the first
  // marker-carrying tmux session exists.
  //   5: the marker file is written now, not after the app-server binds.
  //      v2 wrote it after a 25s wait and after several exit(1) paths, so a
  //      start that died in that window left a live marker-carrying session
  //      with no marker file on disk — an unreclaimable ghost, the exact
  //      failure this feature exists to prevent.
  //   6: if a marker from a previous generation is still on disk (a stop
  //      that failed deliberately preserves it), its processes are reaped
  //      by identity FIRST. v2 overwrote the file with a fresh uuid while
  //      only killing tmux sessions by NAME, permanently losing the handle
  //      on any surviving subprocess of the old generation.
  const identityPrep = await prepareIdentityForStart(identityMarker, {
    readMarker: () => readCopresenceMarker(nodesDir(), resolved.id),
    reap: (uuid, anchors) => reapMarkerGroups(realEnumerator(), realKiller(), uuid, {
      graceMs: 3000,
      logger: (m) => console.log(`[anet] ${m}`),
      anchors,
    }),
    removeMarker: () => removeCopresenceMarker(nodesDir(), resolved.id),
    writeMarker: (uuid, sessions) => { writeCopresenceMarker(nodesDir(), resolved.id, uuid, sessions); },
    logger: (m) => console.log(`[anet] ${m}`),
  });
  if (identityPrep.kind === "blocked") {
    console.error(`[anet] ❌ refusing to start ${displayName}: ${identityPrep.detail}`);
    console.error(`[anet]    ${identityPrep.remedy}`);
    process.exit(1);
  }
  console.log(`[anet] identity marker written (uuid=${identityMarker.slice(0, 8)}… — on disk before any session starts)`);

  // Kill any prior instances and only then take the authoritative snapshot.
  // Snapshot failure is fail-closed before the new app-server is launched.
  try {
    await quiesceThenSnapshot(async () => {
      for (const s of [appsrvSession, bridgeSession, tuiSession]) {
        if (tmuxSessionRunning(s)) {
          console.log(`[anet] killing prior tmux session ${s}`);
          killTmuxSession(s);
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }, () => persistCodexRecoveryPoint(resolved, opts.codexHome));
  } catch (e) {
    console.error(`[anet] ❌ cannot create quiesced Codex recovery point: ${(e as Error).message}`);
    process.exit(1);
  }

  if (authoritativeOldPendingMarker) {
    try {
      await assertPendingServerQuiesced(prelaunchCfg.codexAppServerUrl, (oldPort) => waitForLoopbackPort(oldPort, 750));
    } catch {
      console.error(`[anet] ❌ previous pending app-server identity did not quiesce; refusing recovery migration.`);
      console.error(`[anet]    Fail-closed: no replacement app-server, bridge, or TUI was started.`);
      process.exit(1);
    }
  }

  const port = await findFreeLoopbackPort(opts.port);
  const wsUrl = `ws://127.0.0.1:${port}`;
  // read-only is still the default; flags.sandboxMode never opens it on its
  // own. What changed: an explicit grant is remembered, and a node that asked
  // for full access and is not getting it now says so instead of running
  // silently crippled.
  const posture = codexCopresencePosture(opts.dangerFullAccess, profile, displayName);
  if (posture.downgradeNotice) console.error(posture.downgradeNotice);
  if (posture.grantedFromProfile) {
    console.error(`[anet] ⚠ full filesystem/network access for ${displayName} (grant recorded on this node profile).`);
  }
  const approvalPolicy = posture.approvalPolicy;
  const sandboxMode = posture.sandboxMode;

  // ── piece ① codex app-server (loopback WS + commhub MCP) ──────────────
  // #P2fix必修1 — token to 0600 file, sourced-then-removed inside the tmux
  // child. Never appears in argv / /proc/*/cmdline / tmux pane_start_command.
  const envFilePath = writeCodexCopresenceEnvFile(opts.codexHome, opts.token);
  // #P2fix必修2 — shellQuote every `-c` TOML fragment (including the hub
  // URL fragment). assertSafeHubUrl was called above; shellQuote guards
  // even in the face of a validator regression.
  const hubMcpUrlToml = `mcp_servers.commhub.url="${opts.hub}/mcp"`;
  const bearerTomlLiteral = `mcp_servers.commhub.bearer_token_env_var="ANET_CODEX_COMMHUB_TOKEN"`;
  const appsrvCmd = [
    `export CODEX_HOME=${shellQuote(opts.codexHome)}`,
    `. ${shellQuote(envFilePath)}`,
    `rm -f ${shellQuote(envFilePath)}`,
    `clear`,
    `exec ${shellQuote(opts.codexBin)} app-server`
      + ` -c approval_policy=${approvalPolicy}`
      + ` -c sandbox_mode=${sandboxMode}`
      + ` -c model=${shellQuote(model)}`
      + ` -c ${shellQuote(hubMcpUrlToml)}`
      + ` -c ${shellQuote(bearerTomlLiteral)}`
      + ` --listen ${wsUrl}`,
  ].join(" ; ");
  try {
    execFileSync("tmux", [
      "new-session", "-d", "-s", appsrvSession, "-c", process.cwd(),
      "-e", `ANET_NODE_MARKER=${identityMarker}`,
      "bash", "-lc", appsrvCmd,
    ], { stdio: "pipe" });
  } catch (e: any) {
    console.error(`[anet] ❌ tmux new-session ${appsrvSession} failed: ${e?.message || e}`);
    try { rmSync(envFilePath, { force: true }); } catch { /* best-effort */ }
    process.exit(1);
  }
  console.log(`[anet] ① app-server tmux=${appsrvSession} listening ${wsUrl} (sandbox=${sandboxMode})…`);
  // #849 —— 别等 pane 里出现「listening on: <url>」:钉住的 codex 原生二进制里根本没有这个
  //   前缀(strings 取证 0 命中),于是每次都等满 25 s 判失败,而 app-server 1.1 s 就绑上了。
  //   Windows 启动器早就按端口探(同文件 windowsManagedProcess 那段),POSIX 这里对齐。
  const bound = await waitForLoopbackPort(port, 25_000);
  if (!bound) {
    console.error(`[anet] ❌ app-server did not bind ${wsUrl} within 25s.`);
    console.error(`[anet]    Debug:   tmux attach -t ${shellQuote(`=${appsrvSession}`)}`);
    console.error(`[anet]    Cleanup: anet node stop ${shellQuote(displayName)}`);
    // #P2fix复审顺手3 — env file was source-then-rm'd by the tmux child on
    // the happy path, but if the bash chain crashed before reaching `rm -f`
    // (e.g. the `.` failed) the token file could linger. Defense-in-depth.
    try { rmSync(envFilePath, { force: true }); } catch { /* best-effort */ }
    process.exit(1);
  }
  console.log(`[anet] ① app-server READY on ${wsUrl}`);

  // #P3fix必修5 — the marker file itself was already written before the
  // first tmux session (see prepareIdentityForStart above); everything from
  // here on is a best-effort refresh that adds pane-pid hints. Those hints
  // are observability plus invariant-11 scope anchors — they are NOT the
  // reap identity (that is always the environ uuid), so a failed refresh
  // degrades post-mortem detail, never reclaimability.
  const harvestSession = (session: string): SessionInfo | undefined => {
    try {
      const panePid = Number(execFileSync("tmux", ["display-message", "-p", "-t", session, "#{pane_pid}"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim());
      if (!Number.isInteger(panePid) || panePid <= 0) return undefined;
      const enumer = realEnumerator();
      const stat = enumer.readStat(panePid);
      if (!stat) return undefined;
      return { tmux: session, pid: panePid, pgid: stat.pgid, starttime_jiffies: stat.starttime_jiffies };
    } catch { return undefined; }
  };
  try {
    writeCopresenceMarker(nodesDir(), resolved.id, identityMarker, {
      appsrv: harvestSession(appsrvSession),
    });
    console.log(`[anet] identity marker refreshed with appsrv pane hint (bridge/tui pending)`);
  } catch (e: any) {
    console.error(`[anet] ⚠ could not refresh identity marker hints: ${e?.message || e}`);
    console.error(`[anet]    Teardown still works — the marker uuid written before startup governs reap.`);
  }

  // ── create fresh thread + persist config ──────────────────────────────
  let threadId: string;
  let freshDeferred = false;
  try {
    const thread = await createCodexCopresenceThread(wsUrl, 60_000, profile.codexThreadId);
    threadId = thread.threadId;
    freshDeferred = thread.freshDeferred;
    profile.codexRecoveryVerification = thread.verification;
  } catch (e: any) {
    console.error(`[anet] ❌ Codex thread recovery verification failed: ${e?.message || e}`);
    console.error(`[anet]    Fail-closed: no bridge/TUI was started and thread/start was not used as a fallback.`);
    console.error(`[anet]    Debug:   tmux attach -t ${shellQuote(`=${appsrvSession}`)}`);
    killTmuxSession(appsrvSession);
    console.error(`[anet]    Rolled back the replacement app-server; existing CODEX_HOME and stored thread remain unchanged.`);
    // #P2fix复审顺手3 — defense-in-depth env-file cleanup (see :431).
    try { rmSync(envFilePath, { force: true }); } catch { /* best-effort */ }
    process.exit(1);
  }
  // #P2fix顺手3 — defense-in-depth shape check before threadId flows into
  // a bash-string interpolation. Server-generated ids match; anything else
  // means either a protocol drift or a compromised app-server.
  if (!freshDeferred && !SAFE_THREAD_ID.test(threadId)) {
    console.error(`[anet] internal error: unexpected threadId shape (rejected before shell interpolation)`);
    console.error(`[anet]    Cleanup: anet node stop ${shellQuote(displayName)}`);
    // #P2fix复审顺手3 — defense-in-depth env-file cleanup (see :431).
    try { rmSync(envFilePath, { force: true }); } catch { /* best-effort */ }
    process.exit(1);
  }
  console.log(`[anet] thread: ${threadId || "pending-user-thread"}`);

  const rawCfgPath = join(nodesDir(), resolved.id, "config.json");
  const rawCfg = JSON.parse(readFileSync(rawCfgPath, "utf-8"));
  let pendingRecoveryId: string | undefined;
  if (freshDeferred && rawCfg.codexPendingThread !== undefined) {
    try {
      const migrated = migrateCodexPendingThread(
        rawCfg.codexPendingThread,
        rawCfg.codexAppServerUrl,
        authoritativeOldPendingMarker,
        wsUrl,
        identityMarker,
      );
      rawCfg.codexPendingThread = migrated;
      pendingRecoveryId = migrated.threadId;
    } catch (e: any) {
      console.error(`[anet] ❌ pending Codex thread recovery refused: ${e?.message || e}`);
      console.error(`[anet]    Fail-closed: no bridge/TUI was started and no thread was guessed or created.`);
      killTmuxSession(appsrvSession);
      try { rmSync(envFilePath, { force: true }); } catch {}
      process.exit(1);
    }
  }
  rawCfg.codexAppServerPort = port;
  rawCfg.codexAppServerUrl = wsUrl;
  if (freshDeferred) { delete rawCfg.codexThreadId; delete rawCfg.codexRecoveryVerification; }
  else { rawCfg.codexThreadId = threadId; rawCfg.codexRecoveryVerification = profile.codexRecoveryVerification; }
  delete rawCfg.session;
  atomicWritePrivateJson(rawCfgPath, rawCfg);

  // #1856 PR-B — restart/resume run with --tui-first: the exact-session TUI must be
  // fully restored before the bridge attaches, so no task can reach a thread the
  // human cannot yet see. Only meaningful when the thread is already known; a
  // fresh/pending node keeps bridge-first because the bridge promotes the thread.
  const tuiFirst = opts.tuiFirst === true && !freshDeferred && !pendingRecoveryId;
  if (opts.tuiFirst === true && !tuiFirst) {
    console.log(`[anet] --tui-first ignored: thread not yet known (fresh/pending) — bridge attaches first`);
  }
  const launchBridge = async () => {
    // ── piece ② bridge (agent-node adopt mode) ────────────────────────────
    // The bridge re-invokes `anet node start` in foreground under tmux; that
    // path reads codexAppServerUrl / codexThreadId from the config we just
    // wrote and spawns agent-node in adopt mode. Same launchAgent()
    // codepath as the non-copresence case — no fork of the bridge dispatch.
    // #1856 PR-D — 桥再入用**当前这份 anet**(execPath + execArgv + argv[1]),不用 PATH 上的 `anet`:
    // 真机上 PATH 里是另一个版本,它不认这份 profile,把桥当成 claude-code-cli 起了;沿用 PATH 等于让桥的运行时取决于环境。
    const selfInvoke = [process.execPath, ...process.execArgv, process.argv[1]].map(shellQuote).join(" ");
    const bridgeCmd = [
      `export CODEX_HOME=${shellQuote(opts.codexHome)}`,
      `unset COMMHUB_TOKEN ANET_CODEX_COMMHUB_TOKEN`,
      `exec ${selfInvoke} node start ${shellQuote(displayName)}`,
    ].join(" && ");
    try {
      execFileSync("tmux", [
        "new-session", "-d", "-s", bridgeSession, "-c", process.cwd(),
        "-e", `ANET_NODE_MARKER=${identityMarker}`,
        "-e", "ANET_COPRESENCE_BRIDGE=1",
        "bash", "-lc", bridgeCmd,
      ], { stdio: "pipe" });
    } catch (e: any) {
      console.error(`[anet] ❌ tmux new-session ${bridgeSession} failed: ${e?.message || e}`);
      console.error(`[anet]    Cleanup: anet node stop ${shellQuote(displayName)}`);
      process.exit(1);
    }
    console.log(`[anet] ② bridge tmux=${bridgeSession} starting…`);
    const bridgeReceipt = pendingRecoveryId
      ? bridgeClientHealthReceipt(wsUrl, pendingRecoveryId)
      : freshDeferred
        ? "[codex-app-server] client-health role=bridge state=waiting-for-tui-thread"
        : bridgeClientHealthReceipt(wsUrl, threadId);
    const bridgeReady = await waitForTmuxPaneText(
      bridgeSession,
      bridgeReceipt,
      25_000,
    );
    if (!bridgeReady) {
      console.error(`[anet] ❌ bridge did not attach to the shared app-server before TUI launch.`);
      console.error(`[anet]    Debug:   tmux attach -t ${shellQuote(`=${bridgeSession}`)}`);
      console.error(`[anet]    Cleanup: anet node stop ${shellQuote(displayName)}`);
      process.exit(1);
    }
    if (pendingRecoveryId) {
      const promoted = JSON.parse(readFileSync(rawCfgPath, "utf-8"));
      try {
        threadId = requirePromotedCodexPendingThread(promoted, pendingRecoveryId);
      } catch {
        console.error(`[anet] ❌ bridge reported ready without atomically promoting the exact pending Codex thread.`);
        console.error(`[anet]    Fail-closed: TUI was not started; no thread was guessed or created.`);
        process.exit(1);
      }
      freshDeferred = false;
    }
    console.log(freshDeferred
      ? `[anet] ② bridge connected; waiting for the TUI-owned thread`
      : `[anet] ② bridge READY on ${wsUrl}`);
  };
  const launchTui = () => {
    // ── piece ③ codex TUI (attachable, resumes same thread) ───────────────
    const tuiArgv = codexTuiLaunchArgs(wsUrl, model, freshDeferred ? undefined : threadId, opts.dangerFullAccess);
    const tuiInvocation = `exec ${shellQuote(opts.codexBin)} ${tuiArgv.map(shellQuote).join(" ")}`;
    const tuiCmd = [
      `export CODEX_HOME=${shellQuote(opts.codexHome)}`,
      tuiInvocation,
    ].join(" ; ");
    try {
      execFileSync("tmux", [
        "new-session", "-d", "-s", tuiSession, "-c", process.cwd(),
        "-e", `ANET_NODE_MARKER=${identityMarker}`,
        "bash", "-lc", tuiCmd,
      ], { stdio: "pipe" });
    } catch (e: any) {
      console.error(`[anet] ❌ tmux new-session ${tuiSession} failed: ${e?.message || e}`);
      console.error(`[anet]    Cleanup: anet node stop ${shellQuote(displayName)}`);
      process.exit(1);
    }
    // The OpenCode co-presence twin checks its TUI session before calling the
    // node ready; this path did not, so `③ TUI … ready to attach` and the 就绪
    // line below were printed on the strength of `new-session` not throwing. A
    // TUI that exits during startup (bad codex binary, unusable CODEX_HOME) left
    // both lines saying ready. Keep the two paths aligned.
    if (!tmuxSessionRunning(tuiSession)) {
      console.error(`[anet] ❌ TUI tmux session ${tuiSession} exited during startup.`);
      console.error(`[anet]    Cleanup: anet node stop ${shellQuote(displayName)}`);
      process.exit(1);
    }
    console.log(`[anet] ③ TUI tmux=${tuiSession} ready to attach`);
  };
  const requireTuiPainted = async () => {
    const TUI_PAINT_TIMEOUT_MS = 40_000;
    const tuiState = await codexTuiStateAfterRender(tuiSession, TUI_PAINT_TIMEOUT_MS);
    if (tuiState !== "usable") {
      console.error("");
      console.error(tuiState === "not-painted"
        ? describeCodexTuiNotPainted(displayName, tuiSession, TUI_PAINT_TIMEOUT_MS)
        : describeCodexTuiBlocker(tuiState, displayName, tuiSession));
      console.error(`[anet]   The sessions are left running so you can look; or: anet node stop ${shellQuote(displayName)}`);
      process.exit(1);
    }
  };
  if (tuiFirst) {
    launchTui();
    await requireTuiPainted();
    console.log(`[anet] ③→② TUI restored on the exact session; attaching the bridge now (--tui-first)`);
    await launchBridge();
  } else {
    await launchBridge();
    launchTui();
  }

  // #P3fix复审 finding #5 — best-effort marker-file update with bridge/tui
  // observability hints now that both sessions are up. Marker file was
  // already written after appsrv (see above) with just appsrv's hint —
  // reap identity is unchanged (still environ scan for uuid). This write
  // is purely for post-mortem debugging so operators can `cat` the marker
  // file and see all three pane pids. Best-effort: if the rewrite fails,
  // the appsrv-only marker still works for reap.
  try {
    writeCopresenceMarker(nodesDir(), resolved.id, identityMarker, {
      appsrv: harvestSession(appsrvSession),
      bridge: harvestSession(bridgeSession),
      tui:    harvestSession(tuiSession),
    });
  } catch { /* best-effort observability update; appsrv-only marker still governs reap */ }

  // 就绪 covers three tmux sessions, so it has to be true of all three at the
  // moment it is printed — ① proved itself by its listening line, but that was
  // several seconds and two spawns ago.
  const dead = [appsrvSession, bridgeSession, tuiSession].filter(s => !tmuxSessionRunning(s));
  if (dead.length > 0) {
    console.error(`[anet] ❌ 共存节点 ${displayName} 没起来 — 这些 tmux 会话已经不在了: ${dead.join(", ")}`);
    console.error(`[anet]    Cleanup: anet node stop ${shellQuote(displayName)}`);
    process.exit(1);
  }

  // 就绪 has to mean "can take a task", not "three sessions exist". Both times
  // a node was unusable on 2026-08-20 the ✅ had already been printed over a
  // TUI parked on an interactive prompt.
  if (!tuiFirst) await requireTuiPainted();

  // #1342 同族副本:这里原本也把**两种处境**折叠成同一句。
  //   !tuiIdentity            → 连 TUI 的 pid 都没拿到(会话名对不上 / 会话刚没了)
  //   !probePosixOwned…       → pid 拿到了,但没有一条回环连接能归属到它
  // 前者要去看 tmux 会话,后者才该去看 CODEX_HOME / 端口。指错方向的代价是整整一轮排查。
  const tuiIdentity = harvestSession(tuiSession);
  if (!tuiIdentity) {
    console.error(`[anet] ❌ TUI second-client health failed: 拿不到 TUI 会话 ${tuiSession} 的进程身份(pid)。`);
    console.error(`[anet]    这不是"连不上",是**根本没找到那个 TUI** —— 先看 tmux 会话在不在、名字对不对,`);
    console.error(`[anet]    不要去查 CODEX_HOME / 端口。`);
    console.error(`[anet]    Cleanup: anet node stop ${shellQuote(displayName)}`);
    process.exit(1);
  }
  if (!probePosixOwnedLoopbackConnection(tuiIdentity.pid, port)) {
    console.error(`[anet] ❌ TUI second-client health failed: managed TUI tree has no attributable connection to the exact app-server.`);
    console.error(`[anet]    找的是: pid=${tuiIdentity.pid} port=${port} session=${tuiSession}`);
    console.error(`[anet]    CODEX_HOME/remote mismatch is possible; refusing to print success.`);
    console.error(`[anet]    Cleanup: anet node stop ${shellQuote(displayName)}`);
    process.exit(1);
  }
  console.log(freshDeferred
    ? `[anet] client-health role=bridge state=waiting-for-tui-thread`
    : `[anet] client-health role=bridge remote=exact thread=exact`);
  console.log(`[anet] client-health role=tui codex_home=exact remote=exact thread=${freshDeferred ? "pending-user-thread" : "exact"} connection=pid-attributed`);

  const hubBase = opts.hub.replace(/\/+$/, "");
  console.log("");
  console.log(`[anet] ✅ 共存节点 ${displayName} 就绪`);
  console.log(`[anet]    attach:    tmux attach -t ${shellQuote(`=${displayName}`)}`);
  console.log(`[anet]    stop:      anet node stop ${shellQuote(displayName)}`);
  console.log(`[anet]    dashboard: ${hubBase}/nodes/${encodeURIComponent(displayName)}`);
  console.log(`[anet]    runtime:   codex-app-server @ ${wsUrl}  (sandbox=${sandboxMode})`);
  if (freshDeferred) console.log(`[anet]    state:     connected; shared thread binds when you begin the first TUI message (Dashboard tasks retry until then)`);
}

async function startOpencodeCopresenceOrchestration(nodeId: string, hubOverride?: string): Promise<void> {
  const resolved = resolveNodeRef(nodeId);
  if (!resolved) {
    console.error(`Node "${nodeId}" not found. Create it first: anet node create ${nodeId}`);
    process.exit(1);
  }
  const runtime = runtimeForExecution(resolved.profile, `start OpenCode copresence node ${JSON.stringify(nodeId)}`);
  const displayName = nodeDisplayName(resolved.id, resolved.profile);
  if (runtime !== "opencode-cli") {
    console.error(`[anet] ❌ OpenCode --copresence requires runtime=opencode-cli (node "${displayName}" is runtime=${runtime}).`);
    process.exit(1);
  }
  if (!tmuxAvailable()) {
    console.error(`[anet] ❌ OpenCode --copresence requires tmux.`);
    process.exit(1);
  }

  const profile: Profile = { ...resolved.profile, opencodeMode: "copresence" };
  saveProfile(resolved.id, profile);
  const bridgeSession = `${displayName}-桥`;
  const tuiSession = displayName;
  const attachScript = join(nodesDir(), resolved.id, "opencode-attach.sh");
  // 🔴 bridge 的输出必须落盘，不能只留在 tmux pane 里。判失败时 bridge 会话
  //    往往**已经没了**（等待循环的退出条件之一就是它），会话一没，
  //    `capture-pane` 必然是空 —— #1225 那次就是这样：用户只拿到一行泛泛的
  //    超时，真正的死因（agent-node 崩在 `host.ip` 上，#1498）谁都看不到。
  const nodeLogDir = join(nodesDir(), resolved.id, "logs");
  const bridgeLog = join(nodeLogDir, "copresence-bridge.log");
  mkdirSync(nodeLogDir, { recursive: true });
  for (const name of [bridgeSession, tuiSession]) {
    if (tmuxSessionRunning(name)) killTmuxSession(name);
  }
  rmSync(attachScript, { force: true });
  rmSync(bridgeLog, { force: true });

  const cliEntry = resolve(process.argv[1]);
  const bridgeCommand = [
    `export PATH=${shellQuote(process.env.PATH ?? "")}`,
    ...(process.env.ANET_AGENT_NODE_BIN
      ? [`export ANET_AGENT_NODE_BIN=${shellQuote(process.env.ANET_AGENT_NODE_BIN)}`]
      : []),
    ...(process.env.ANET_OPENCODE_SAFE_BASE
      ? [`export ANET_OPENCODE_SAFE_BASE=${shellQuote(process.env.ANET_OPENCODE_SAFE_BASE)}`]
      : []),
    `export ANET_OPENCODE_MODE=copresence`,
    `exec > >(tee -a ${shellQuote(bridgeLog)}) 2>&1`,
    `exec ${shellQuote(process.execPath)} ${shellQuote(cliEntry)} node start ${shellQuote(resolved.id)}`
      + (hubOverride ? ` --hub ${shellQuote(hubOverride)}` : ""),
  ].join(" ; ");
  execFileSync("tmux", [
    "new-session", "-d", "-s", bridgeSession, "-c", process.cwd(),
    "bash", "-lc", bridgeCommand,
  ], { stdio: "pipe" });

  const deadline = Date.now() + 30_000;
  while (!existsSync(attachScript) && tmuxSessionRunning(bridgeSession) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!existsSync(attachScript)) {
    const bridgeAlive = tmuxSessionRunning(bridgeSession);
    let paneTail = "";
    try {
      const bridgePane = tmuxPaneTarget(bridgeSession);
      paneTail = bridgePane ? execFileSync("tmux", ["capture-pane", "-p", "-t", bridgePane, "-S", "-80"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).slice(-3_000) : "";
    } catch {}
    let logTail = "";
    try { logTail = readFileSync(bridgeLog, "utf8").slice(-3_000); } catch {}
    killTmuxSession(bridgeSession);
    for (const line of describeCopresenceStartupFailure({
      attachScript, bridgeLog, nodeLogDir, bridgeAlive,
      waitedSeconds: 30, logTail, paneTail,
    })) console.error(line);
    process.exit(1);
  }

  execFileSync("tmux", [
    "new-session", "-d", "-s", tuiSession, "-c", process.cwd(),
    "bash", "-lc", `exec ${shellQuote(attachScript)}`,
  ], { stdio: "pipe" });
  if (!tmuxSessionRunning(tuiSession)) {
    killTmuxSession(bridgeSession);
    console.error(`[anet] ❌ OpenCode TUI tmux exited during startup.`);
    process.exit(1);
  }

  console.log("");
  console.log(`[anet] ✅ OpenCode 共存节点 ${displayName} 就绪`);
  // tmux accepts unique session-name prefixes by default. If the human TUI
  // has exited while `<alias>-桥` is still alive, `tmux attach -t <alias>`
  // silently attaches to the bridge logs. Prefix '=' makes this an exact
  // session lookup, so a missing TUI fails visibly instead of opening the
  // wrong pane.
  console.log(`[anet]    attach:  tmux attach -t ${shellQuote(`=${displayName}`)}`);
  console.log(`[anet]    stop:    anet node stop ${shellQuote(displayName)}`);
  console.log(`[anet]    bridge:  ${bridgeSession}`);
  console.log(`[anet]    mode:    opencode-cli copresence (native serve + full attach TUI)`);
}

// Pin commhub-server to a specific version to defeat bunx caching of older
// versions (bunx with @preview caches the first-resolved version and may not
// refetch). A `latest` agent-network release must pin a *stable* server.
// `anet upgrade` (#88) surfaces this constant in its plan output so users
// understand global-install version != version anet hub start actually runs.
// 🔴 这个常量只能指向**已经发布到 npm 的**版本。release-gate 的 gate 2 会拿它
// 去 `npm view` 核对,而 publish 要求四门全绿 —— 所以「本次要发的版本」不能提前
// 写在这里,否则发它的那个 run 会被自己的 pin 卡死(鸡生蛋)。
// 顺序:先发 commhub-server X → 再把这里改成 X 并发 agent-network。
const PINNED_SERVER_VERSION = "0.9.0-preview.47";

// Canonical SkillHub URL: https://anet.sh/skillhub/catalog.json currently
// returns 307 to this www host. Pin the direct 200 URL so catalog fetch
// failures are real network/content failures, not avoidable redirect/domain
// ambiguity.
const DEFAULT_SKILL_CATALOG_URL = "https://www.anet.sh/skillhub/catalog.json";

function sessionFileExists(uuid: string, cwd: string = process.cwd()): boolean {
  if (!uuid) return false;
  return existsSync(join(homedir(), ".claude", "projects", encodeCwd(cwd), `${uuid}.jsonl`));
}

function claudeProjectDir(cwd: string = process.cwd()): string {
  return join(homedir(), ".claude", "projects", encodeCwd(cwd));
}

interface ClaudeSessionInfo { id: string; mtimeMs: number; sizeBytes: number; summary: string; }

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes}B`
    : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)}KB`
    : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatAge(mtimeMs: number): string {
  const min = (Date.now() - mtimeMs) / 60000;
  if (min < 60) return `${Math.max(1, Math.round(min))}m ago`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Best-effort one-line label for a session: prefer a `summary` entry, else the
// first user message. Reads only the head of the file (sessions can be huge).
function parseSessionSummary(jsonlPath: string): string {
  try {
    const head = readFileSync(jsonlPath, "utf-8").slice(0, 16384);
    const lines = head.split("\n").filter(Boolean).slice(0, 12);
    let firstUser = "";
    for (const line of lines) {
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj?.type === "summary" && typeof obj.summary === "string") {
        return `(summary) ${obj.summary}`.replace(/\s+/g, " ").slice(0, 60);
      }
      if (!firstUser && obj?.type === "user") {
        const c = obj.message?.content;
        const text = typeof c === "string" ? c
          : Array.isArray(c) ? (c.find((x: any) => x?.type === "text")?.text || "") : "";
        if (text) firstUser = text;
      }
    }
    return firstUser ? firstUser.replace(/\s+/g, " ").slice(0, 60) : "(no preview)";
  } catch {
    return "(no preview)";
  }
}

// #149 (Vincent 5448) + #156 (Vincent 5531) — codex-sdk runtime fast/yolo
// posture. agent-node's processWithCodex already hardcodes these defaults,
// but writing them to config.json makes the permission posture visible to
// the user and overridable per-node. Source of truth for both single-node
// (createProfileFromOpts) and batch (createBatch) creation paths — adding
// a fifth yolo here propagates to every path automatically (was the v0.10.6
// gap that caused #156: batch path only wrote 1/4 because it didn't share
// the single-node inline construction).
//
// `--no-yolo` opt-out is for CI / scripted users who need explicit
// permission posture (returns empty so caller's `dangerouslySkipPermissions:
// true` is the only yolo-ish flag landing in config).
function codexSdkYoloFlags(noYolo?: boolean): Record<string, string | boolean> {
  if (noYolo) return {};
  return {
    approvalPolicy: "never",
    sandboxMode: "danger-full-access",
    skipGitRepoCheck: true,
  };
}

// Scan ~/.claude/projects/<cwd-key>/*.jsonl — the Claude Code sessions that
// belong to this directory. Newest first. Shared by `anet session ls` and the
// `anet node create` resume picker (#115).
function listClaudeSessions(cwd: string = process.cwd()): ClaudeSessionInfo[] {
  const dir = claudeProjectDir(cwd);
  if (!existsSync(dir)) return [];
  const out: ClaudeSessionInfo[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    const full = join(dir, f);
    let st;
    try { st = statSync(full); } catch { continue; }
    out.push({
      id: f.replace(/\.jsonl$/, ""),
      mtimeMs: st.mtimeMs,
      sizeBytes: st.size,
      summary: parseSessionSummary(full),
    });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// #115 — `anet node create` resume picker. Returns a session id to bind, or
// null for "fresh session". TTY-only; callers guard on process.stdin.isTTY.
async function pickClaudeSession(alias: string, cwd: string = process.cwd()): Promise<string | null> {
  const sessions = listClaudeSessions(cwd);
  if (sessions.length === 0) return null; // nothing to resume — silently fresh
  const mode = await select({
    message: `Claude session for "${alias}":`,
    choices: [
      { value: "__fresh__", name: "新开 session (fresh)" },
      { value: "__resume__", name: `Resume 已有 session… (${sessions.length} available)` },
    ],
  });
  if (mode === "__fresh__") return null;
  return await select({
    message: "选择要绑定的 session:",
    choices: sessions.map(s => ({
      value: s.id,
      name: `${s.id.slice(0, 8)}…  ${formatAge(s.mtimeMs).padEnd(8)} ${formatSize(s.sizeBytes).padStart(7)}  ${s.summary}`,
    })),
  });
}

let claudeSessionIdSupport: boolean | null = null;
function claudeSupportsSessionId(): boolean {
  if (claudeSessionIdSupport !== null) return claudeSessionIdSupport;
  try {
    const help = execSync("claude --help", { encoding: "utf-8", timeout: 5000 });
    claudeSessionIdSupport = help.includes("--session-id");
  } catch {
    claudeSessionIdSupport = false;
  }
  return claudeSessionIdSupport;
}

// Token/hub from: CLI --token > env > global config
function getToken(): string {
  const opts = parseOpts();
  return opts.token || process.env.COMMHUB_TOKEN || loadGlobal().token || "";
}

function getHub(): string {
  const opts = parseOpts();
  return opts.hub || process.env.COMMHUB_URL || loadGlobal().hub || "";
}

function authHeaders(token?: string): Record<string, string> {
  const t = token || getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// #473 — the per-connection SSE breakdown (`{networkId}:{alias}` → count)
// moved OFF the anonymous /health body (it leaked the whole agent
// topology) and behind auth at GET /api/stats/sse. Returns the SAME
// `sessions` map getSSEStats() always produced, so downstream key lookups
// are unchanged.
//
// TRISTATE by design (审查 round-2, 通信龙): the map alone can't tell
// "genuinely 0 connections" from "I'm not allowed to see" — a non-admin
// user gets 403 here, and rendering that as "0 connected" is a LIE that
// reads as "hub is dead". So `ok` distinguishes them: ok=false means the
// detail is unavailable (403 / unreachable / bad JSON), and callers must
// then show "unknown" or fall back to the anonymous aggregate
// health.sse_connections — never 0. Never throws.
type SseDetail = { ok: boolean; sessions: Record<string, number> };
async function fetchSseSessions(hub: string): Promise<SseDetail> {
  try {
    const res = await fetch(`${hub}/api/stats/sse`, { headers: authHeaders() });
    if (!res.ok) return { ok: false, sessions: {} };
    const body = await res.json() as any;
    const sessions = (body && typeof body.sessions === "object" && body.sessions) || {};
    return { ok: true, sessions };
  } catch {
    return { ok: false, sessions: {} };
  }
}

// #473 — anonymous aggregate connection count from /health (never gated,
// every user can read it). The reliable source for "how many SSE
// connections" when the per-alias detail is unavailable.
async function fetchSseConnectionCount(hub: string): Promise<number | null> {
  try {
    const res = await fetch(`${hub}/health`, { headers: authHeaders() });
    if (!res.ok) return null;
    const body = await res.json() as any;
    return typeof body.sse_connections === "number" ? body.sse_connections : null;
  } catch {
    return null;
  }
}

// #473 — "are all these SPECIFIC aliases SSE-connected?" for the
// orchestration wait-loops. TRISTATE (审查 round-2b, 通信龙): the aggregate
// count CANNOT answer this — `sse_connections >= aliases.length` is true
// whenever N unrelated nodes are connected, which would falsely claim
// "all connected" while a/b/c/d are all down. That's the same class of
// lie as the fake 0, just inverted. So when the per-alias detail is
// unavailable (non-admin 403 / unreachable), we return "unknown" and the
// caller must say so honestly rather than guess from the count.
//   "yes"     — every alias has ≥1 connection (verified)
//   "no"      — detail readable, at least one alias not yet connected
//   "unknown" — detail not readable; cannot assert either way
async function sseAllConnected(hub: string, aliases: string[]): Promise<"yes" | "no" | "unknown"> {
  const detail = await fetchSseSessions(hub);
  if (!detail.ok) return "unknown";
  return aliases.every(a => (detail.sessions[a] || 0) >= 1) ? "yes" : "no";
}

function loadGlobal(): Record<string, any> {
  const p = globalConfigPath();
  repairPrivateFilePermissions(p);
  if (existsSync(p)) try { return JSON.parse(readFileSync(p, "utf-8")); } catch {}
  return {};
}

function saveGlobal(data: Record<string, any>) {
  const dir = join(home, ".anet");
  ensurePrivateDirectory(dir);
  const configPath = join(dir, "config.json");
  atomicWritePrivateJson(configPath, data);
}

function loadServerConfig(): Record<string, any> {
  const p = serverConfigPath();
  repairPrivateFilePermissions(p);
  if (existsSync(p)) try { return JSON.parse(readFileSync(p, "utf-8")); } catch {}
  return {};
}

// #204 preview.5 — shared resolver + refresher for `.anet/node-server.js`. The
// MCP channel plugin file lives at `<cwd>/.anet/node-server.js`; we previously
// only wrote it when missing (`anet init project`) which let stale copies
// linger across upgrades. Vincent's grok-build-acp UAT hit "serde error
// expected value at line 1 column 2" when Grok ACP spawned an outdated
// node-server.js that wrote non-JSON-RPC bytes to stdout. The refresher now
// overwrites on demand (called from launchAgent before grok-build-acp
// spawn) so the file matches the currently-installed agent-network version.
function findBundledNodeServerJs(): string | null {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    join(here, "..", "..", "dist", "src", "node-server.js"),  // installed npm package layout
    join(here, "..", "src", "node-server.js"),
    join(here, "..", "..", "src", "node-server.ts"),
    join(process.argv[1], "..", "..", "dist", "src", "node-server.js"),
    join(process.argv[1], "..", "..", "src", "node-server.ts"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

function refreshNodeServerJsAt(targetPath: string, opts: { overwrite: boolean }): "wrote" | "exists" | "no-source" {
  const exists = existsSync(targetPath);
  if (exists && !opts.overwrite) return "exists";
  const src = findBundledNodeServerJs();
  if (!src) return "no-source";
  // The target is always `.js` — agent-node's spawn gate pins the CommHub MCP
  // payload to exactly `<project>/.anet/node-server.js` — so a `.ts` source
  // must be transpiled on the way, not copied verbatim. See issue #1216: the
  // verbatim copy produced a file that could not be parsed, and the failure
  // surfaced three layers away as "CommHub MCP readiness preflight failed (1)".
  const payload = nodeServerPayloadFor(
    readFileSync(src, "utf-8"),
    src,
    ambientTypeScriptTranspiler(),
  );
  writeFileSync(targetPath, payload);
  return "wrote";
}

function saveServerConfig(data: Record<string, any>) {
  const dir = join(home, ".anet", "server");
  const p = serverConfigPath();
  ensurePrivateDirectory(dir);
  atomicWritePrivateJson(p, data);
}

function serverAuthTokenFromConfig(config = loadServerConfig()): string {
  return config.auth_token || config.token || "";
}

function commhubDbPath() {
  return process.env.COMMHUB_DB || join(home, ".commhub", "commhub.db");
}

function saveAdminUtok(data: Record<string, any>) {
  const dir = join(home, ".anet", "server");
  const p = adminUtokPath();
  ensurePrivateDirectory(dir);
  atomicWritePrivateJson(p, data);
}

function loadAdminUtok(): Record<string, any> {
  const p = adminUtokPath();
  repairPrivateFilePermissions(p);
  if (existsSync(p)) try { return JSON.parse(readFileSync(p, "utf-8")); } catch {}
  return {};
}

interface Profile {
  anet_version?: string;
  node_id?: string;
  node_name?: string;
  name?: string;
  alias?: string;
  hub?: string;
  token?: string;
  runtime?: string;
  codexRuntime?: string;
  codexAppServerUrl?: string;  // RFC-030 — shared codex app-server URL (co-presence)
  codexThreadId?: string;      // RFC-030 — codex thread to adopt
  codexRecoveryVerification?: CodexRecoveryVerification;
  codexRecoveryBackup?: { createdAt: string; stateFiles: string[]; path: string };
  // Remembered so `anet node start <name>` alone brings up the co-presence
  // TUI, the way grokCopresence / opencodeMode already do for their runtimes.
  codexCopresence?: boolean;
  // A full-access grant that was made explicitly once. Never inferred from
  // flags.sandboxMode — see src/codex-copresence-profile.ts.
  codexCopresenceFullAccess?: boolean;
  /** #1856 — 共存节点的工作目录(= 含 .anet 的目录;fork --workdir 写入;lifecycle 命令核对四处一致)。 */
  codexProjectDir?: string;
  opencodeMode?: "headless" | "copresence";
  model?: string;
  channels: string[];
  env: Record<string, string>;
  flags: Record<string, any>;
  session?: string;
  grokSession?: string;
  grokCliSession?: string;
  grokCopresence?: boolean;
  grokLeaderSocket?: string;
  grokAttachSocket?: string;
  resume?: string;
  resumeAlias?: string;
  tools?: string[];
  network_id?: string;
  systemPrompt?: string;
  // Team-scale demo metadata (issue #51 / RFC-008). Read by Phase 2 leader
  // fan-out logic — set by `anet demo sci-team` scaffold.
  team?: string;
  // Node role. PR1+PR3 widen the union beyond RFC-008's leader/worker:
  //   - "host_supervisor" = anet daemon (RFC-026, set by `anet daemon init`)
  //   - "leader" / "worker" = RFC-008 team scaffold
  //   - "member" = explicit non-daemon (some external configs use this)
  // string fallback keeps forward-compat with future roles without
  // forcing `as any` casts at every call site (PR1 had to use `as any`
  // because the union didn't include host_supervisor — 通信龙 nit ②).
  role?: "leader" | "worker" | "host_supervisor" | "member" | string;
}

// Re-export from the pure helper module (src/normalize-runtime.ts) so
// unit tests can import without dragging in CLI side-effects.
import {
  normalizeRuntime,
  normalizeRuntimeStrict,
  reusedLoginFor,
  RUNTIME_REUSED_LOGIN,
  SUPPORTED_RUNTIME_NAMES,
  type ReusedLogin,
  type RuntimeName,
} from "../src/normalize-runtime";
import { describeStaleRuntimeSupport } from "../src/daemon-runtime-staleness";
import { findEnvironAliasMatches } from "../src/environ-alias";
import { describeGrokBuildDrift, parseGrokBuildFromLog, parseGrokBuildFromVersionOutput } from "../src/grok-build-drift";
export { normalizeRuntime, type RuntimeName };

function runtimeForExecution(
  profileOrRuntime: Profile | string | undefined,
  context: string,
): RuntimeName {
  try {
    return normalizeRuntimeStrict(profileOrRuntime);
  } catch (error: any) {
    console.error(`[anet] Refusing to ${context}: ${error?.message || error}`);
    process.exit(1);
  }
}

function nodeDisplayName(id: string, profile?: Profile | null): string {
  return profile?.node_name || profile?.name || profile?.alias || id;
}

function profileSession(profile: Profile): string {
  const runtime = normalizeRuntime(profile);
  if (runtime === "grok-build-cli") return profile.grokCliSession || "";
  if (runtime === "grok-build-acp") return profile.grokSession || profile.session || "";
  return profile.session || "";
}

function generateNodeId(): string {
  return `n_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function legacyNodeId(id: string): string {
  return `n_${createHash("sha1").update(id).digest("hex").slice(0, 8)}`;
}

function normalizeStoredProfile(id: string, project: Record<string, any>, globalConfig?: Record<string, any>): Profile {
  const gc = globalConfig || loadGlobal();
  const nodeName = project.node_name || project.name || project.alias || id;
  return {
    ...project,
    node_id: project.node_id || legacyNodeId(id),
    node_name: nodeName,
    name: nodeName,
    alias: nodeName,
    session: project.session || project.resume || project.sessionId || "",
    hub: project.hub || gc.hub || "",
    // Node tokens are per-node (ntok_). Do not fall back to the global user
    // token; doing so silently corrupts the SSE handshake.
    token: project.token || "",
    channels: Array.isArray(project.channels) ? project.channels : [],
    env: project.env && typeof project.env === "object" ? { ...project.env } : {},
    flags: project.flags && typeof project.flags === "object" ? { ...project.flags } : {},
  };
}

function resolveNodeRef(ref: string): { id: string; profile: Profile } | null {
  const direct = loadProfile(ref);
  if (direct) return { id: ref, profile: direct };

  for (const id of listProfileIds()) {
    const profile = loadProfile(id);
    if (!profile) continue;
    if (profile.node_id === ref || profile.node_name === ref || profile.name === ref || profile.alias === ref) {
      return { id, profile };
    }
  }
  return null;
}

// 光一句 `Node "x" not found.` 对用户没用 —— 他敲错了一个字,而这里手里就攥着全部真名。
// 相似度用**既有的** suggestSimilar(Levenshtein ≤ 2,#214 F7-02 的阈值),不另立一套。
function nodeNotFound(ref: string): string {
  const display: string[] = [];
  const candidates = new Set<string>();
  try {
    for (const id of listProfileIds()) {
      const profile = loadProfile(id);
      display.push(profile?.node_name || profile?.name || profile?.alias || id);
      // 🔴 建议的候选集必须等于 resolveNodeRef **实际认的那些键**,不是我想显示的那一个。
      // 它认 id / node_id / node_name / name / alias 五个;只收显示名的话,用户把
      // 目录 id 敲错一个字母(codex-new → codex-nex)就永远得不到建议 —— 实测撞到过。
      for (const k of [id, profile?.node_id, profile?.node_name, profile?.name, profile?.alias]) {
        if (typeof k === "string" && k) candidates.add(k);
      }
    }
  } catch { /* 读不到配置目录就退化成最朴素的那句,不要在报错路径上自己再抛 */ }
  return nodeNotFoundMessage(ref, display, suggestSimilar(ref, [...candidates]));
}

function normalizeNodeName(name: string): string {
  return name.normalize("NFC");
}

function validateNodeName(name: string) {
  if (name !== normalizeNodeName(name)) {
    console.error(`Error: node-name must be Unicode NFC normalized: ${name}`);
    process.exit(1);
  }
  if (!/^[^\s\/\\:*?"<>|.][^\s\/\\:*?"<>|.]*$/.test(name)) {
    console.error(`Error: invalid node-name "${name}"`);
    console.error(`Allowed: Chinese/letters/numbers/-/_ ; forbidden: whitespace, '.', / \\ : * ? " < > |`);
    process.exit(1);
  }
}

function loadProfile(id: string): Profile | null {
  const p = join(nodesDir(), id, "config.json");
  repairPrivateFilePermissions(p);
  if (!existsSync(p)) return null;
  try {
    const project = JSON.parse(readFileSync(p, "utf-8"));
    return normalizeStoredProfile(id, project);
  } catch { return null; }
}

function loadStoredProfile(id: string): Profile | null {
  const p = join(nodesDir(), id, "config.json");
  repairPrivateFilePermissions(p);
  if (!existsSync(p)) return null;
  try {
    const project = JSON.parse(readFileSync(p, "utf-8"));
    return normalizeStoredProfile(id, project);
  } catch { return null; }
}

function resolveStartProfile(
  nodeId: string,
  candidate: Profile,
): { profile: Profile; runtime: RuntimeName } {
  const nodeWorkDir = join(nodesDir(), nodeId);
  const bindingHome = opencodeBindingHome();
  const binding = readOpencodeRuntimeBinding(nodeWorkDir, bindingHome);
  if (!binding) {
    const runtime = runtimeForExecution(candidate, `start node ${JSON.stringify(nodeId)}`);
    if (runtime === "opencode-cli") {
      throw new Error(
        `OpenCode runtime binding is missing for node ${JSON.stringify(nodeId)}. ` +
        `Refusing legacy/unproven state; recreate this preview node before starting it.`,
      );
    }
    return { profile: candidate, runtime };
  }

  // The external record is authoritative. A checkout that replaces the
  // project-local config with another runtime must not steer this launch into
  // an unhardened branch. Re-open the private profile without following its
  // leaf, require the original exact runtime, and reject force-added Git state.
  assertOpencodeNodeStateUntracked(nodeWorkDir);
  const raw = readOpencodePrivateProfileFile(nodeWorkDir, "config.json");
  if (raw === undefined) {
    throw new Error(`OpenCode config.json is missing for bound node ${JSON.stringify(nodeId)}`);
  }
  let project: Record<string, any>;
  try {
    project = JSON.parse(raw);
  } catch (error: any) {
    throw new Error(`OpenCode config.json is invalid: ${error?.message || error}`);
  }
  const profile = normalizeStoredProfile(nodeId, project);
  const runtime = runtimeForExecution(profile, `start bound OpenCode node ${JSON.stringify(nodeId)}`);
  if (runtime !== "opencode-cli") {
    throw new Error(
      `OpenCode runtime binding mismatch for node ${JSON.stringify(nodeId)}: ` +
      `project config now selects ${JSON.stringify(runtime)}.`,
    );
  }
  return { profile, runtime };
}

function saveProfile(id: string, profile: Profile) {
  const dir = join(nodesDir(), id);
  const isOpencode = normalizeRuntime(profile) === "opencode-cli";
  if (isOpencode) {
    // Validate/create without following any pre-planted state path. mkdir and
    // chmod both follow a final symlink on POSIX, so this must run first.
    prepareOpencodeNodeForProfileWrite(dir);
    // A project checkout must never be able to replace the runtime-bearing
    // profile. Record the immutable runtime identity outside the project
    // before writing any token-bearing state, and refuse force-added .anet
    // content even when .gitignore would normally hide it.
    assertOpencodeNodeStateUntracked(dir);
    writeOpencodeRuntimeBinding(dir, opencodeBindingHome());
  } else {
    ensurePrivateDirectory(dir);
  }
  const normalized = normalizeStoredProfile(id, profile);
  const toSave = serializeProfileForConfigJson(normalized, profile);
  const body = JSON.stringify(toSave, null, 2) + "\n";
  if (isOpencode) {
    // The profile contains the node ntok_. Never replace through a
    // pre-planted config.json symlink or an unvalidated state tree.
    writeOpencodePrivateProfileFile(dir, "config.json", body);
  } else {
    const configPath = join(dir, "config.json");
    atomicWritePrivateFile(configPath, body);
  }
}

function listProfileIds(): string[] {
  const dir = nodesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => existsSync(join(dir, name, "config.json")));
}

// ── Parse --key value and repeatable --channel/--env ──

function parseOpts(): Record<string, string> & { _channels: string[]; _envs: string[] } {
  // Preserve the legacy call-site type while the pure parser models its two
  // repeatable array fields honestly.
  const parsed = parseCliOptions(args);
  return parsed as unknown as Record<string, string> & { _channels: string[]; _envs: string[] };
}

function commandExists(name: string, env?: NodeJS.ProcessEnv): boolean {
  try {
    // Windows has no /bin/sh; use `where`. Unix: `command -v` via /bin/sh with
    // shell-safe quoting (shellQuote, NOT JSON.stringify which lets $() / `` expand).
    if (process.platform === "win32") {
      execFileSync("where", [name], { stdio: "ignore", env });
    } else {
      execFileSync("/bin/sh", ["-c", `command -v ${shellQuote(name)}`], { stdio: "ignore", env });
    }
    return true;
  } catch {
    return false;
  }
}

// #237 — Friendly classification of Node `fetch` errors. Node's fetch throws
// a bare `TypeError: fetch failed` with the real cause hidden in `err.cause`
// (e.g. `{ code: 'ECONNREFUSED', address: '127.0.0.1', port: 9200 }`). Without
// classification the user sees only the Node stack and has no idea whether
// the hub is down, the URL is wrong, the network is broken, or DNS is failing.
function classifyFetchError(err: any, url?: string): string {
  const cause = err?.cause;
  const code = cause?.code || err?.code;
  const address = cause?.address;
  const port = cause?.port;
  const target = url ? `URL: ${url}` : (address ? `${address}:${port}` : "");
  const isLoopback = url?.includes("127.0.0.1") || url?.includes("localhost") || address === "127.0.0.1" || address === "::1";
  if (code === "ECONNREFUSED") {
    if (isLoopback) {
      return `连不上本地 hub (${target}). 请先在另一终端: anet hub start  然后重试.`;
    }
    return `连不上 ${target}. 服务可能未启动 — 检查目标主机/端口, 或网络/代理.`;
  }
  if (code === "ENOTFOUND") {
    return `DNS 解析失败 (${target}). 检查网络/DNS/代理设置.`;
  }
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return `连接超时 (${target}). 网络不稳定或目标无响应 — 检查防火墙/代理.`;
  }
  if (code === "ECONNRESET") {
    return `连接被对端重置 (${target}). 服务可能在启动中或异常退出.`;
  }
  return `fetch 失败: ${err?.message || err}${target ? ` (${target})` : ""}`;
}

// #237 — Detect whether an arbitrary error came from a fetch call. Used by
// the top-level FATAL handler so a bare TypeError surfaces as a friendly
// classified message instead of an undecorated Node stack.
function isFetchError(err: any): boolean {
  if (!err) return false;
  if (err instanceof TypeError && /fetch failed/i.test(err.message || "")) return true;
  const cause = err?.cause;
  if (cause && typeof cause === "object" && (cause.code || cause.syscall === "connect")) return true;
  return false;
}

// #214 F7-02 / F7-10 / F7-11 — Levenshtein distance for did-you-mean
// suggestions on typo'd commands. Pure function, ≤30 LOC, no deps.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length, n = b.length;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j - 1], dp[j]);
      prev = tmp;
    }
  }
  return dp[n];
}

// Return the closest candidate within Levenshtein distance ≤ 2, or null
// if nothing is close enough. Used for "Did you mean ...?" hints.
function suggestSimilar(input: string, candidates: string[]): string | null {
  const lower = input.toLowerCase();
  let best: { name: string; dist: number } | null = null;
  for (const c of candidates) {
    const d = levenshtein(lower, c.toLowerCase());
    if (d <= 2 && (!best || d < best.dist)) best = { name: c, dist: d };
  }
  return best ? best.name : null;
}

type VersionState = "ok" | "unknown" | "not-installed";

interface DetectedVersion {
  name: string;
  displayName: string;
  version: string | null;
  state: VersionState;
  source?: string;
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;  // #192 — optional `-preview.N` / `-rc.0` etc. for display only
}

function packageJsonPath() {
  // Try multiple paths: compiled dist/bin/cli.js → ../../package.json, source bin/cli.ts → ../package.json
  const candidates = [
    join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "package.json"),
    join(fileURLToPath(new URL(".", import.meta.url)), "..", "package.json"),
  ];
  for (const p of candidates) {
    try { if (existsSync(p)) return p; } catch {}
  }
  return candidates[0]; // fallback to first
}

function getAnetVersion(): string {
  try { return JSON.parse(readFileSync(packageJsonPath(), "utf-8")).version || ""; }
  catch { return ""; }
}

// 🅗2 temp fallback per #61 — anet@latest 用户从 dashboard 0.4.5-preview.1 (pin
// stale 80 rounds) → 0.4.2 (current @latest) 是 *功能 regress*, 因为 dashboard
// preview channel 远超 latest channel。短期双 channel 都拉 @preview, 等 N站马
// promote 0.4.5 → @latest 后 swap anet@latest 路径回 @latest (🅗1)。
// TODO(#61 phase-2): swap anet@latest fallback "preview" → "latest" once
//   @sleep2agi/agent-network-dashboard promotes 0.4.5 stable.
//
// 🔴 2026-08-18 — that condition passed a long time ago and nobody re-checked
// it. Measured against the live registry today:
//
//     latest  = 0.6.0
//     preview = 0.6.3-preview.56
//
// The blocker this fallback was written for (latest pinned at 0.4.2 while
// preview had 0.4.5) no longer exists; `latest` is now many minors past the
// version the TODO waits for. The fallback outlived its own stated expiry.
//
// It is NOT flipped here on purpose: doing so changes what every stable-channel
// user's `anet hub dashboard` fetches (0.6.0 instead of 0.6.3-preview.56), and
// whether 0.6.0 is feature-complete enough is a product call, not a cleanup.
// See #866 for the numbers and the decision.
//
// The general shape, worth naming: a temporary workaround that WRITES DOWN its
// expiry condition is better than one that doesn't — but only if someone
// re-reads it. Nothing re-evaluates a condition stored in a comment.
function dashboardReleaseTag(): string {
  const envOverride = process.env.ANET_DASHBOARD_VERSION;
  if (envOverride) return envOverride;
  return "preview";
}

type DashboardPidScan = { ok: true; pids: number[] } | { ok: false; error: string };

function scanDashboardListenerPids(port: string | number): DashboardPidScan {
  if (!commandExists("lsof")) return { ok: false, error: "lsof is not installed" };
  try {
    const out = execFileSync("lsof", ["-t", "-i", `:${port}`, "-sTCP:LISTEN"], { encoding: "utf-8" }).trim();
    const pids = [...new Set(out.split(/\s+/).filter(Boolean).map(Number).filter(pid => Number.isSafeInteger(pid) && pid > 1))];
    return { ok: true, pids };
  } catch (error: any) {
    // lsof exits 1 when no matching listener exists. Distinguish that from
    // a missing/broken inspector; commandExists above already proved the
    // binary exists, and empty stdout is the canonical no-listener result.
    const stdout = String(error?.stdout || "").trim();
    if (!stdout && Number(error?.status) === 1) return { ok: true, pids: [] };
    return { ok: false, error: `lsof failed (${error?.status ?? "unknown"})` };
  }
}

function dashboardProcessField(pid: number, field: "lstart" | "command" | "ppid"): string | null {
  if (!commandExists("ps")) return null;
  try {
    const value = execFileSync("ps", ["-p", String(pid), "-o", `${field}=`], { encoding: "utf-8" }).trim();
    return value || null;
  } catch { return null; }
}

function dashboardListenerDescendsFrom(pid: number, ancestorPid: number): boolean {
  let current = pid;
  const seen = new Set<number>();
  for (let depth = 0; depth < 64 && current > 1 && !seen.has(current); depth++) {
    if (current === ancestorPid) return true;
    seen.add(current);
    const raw = dashboardProcessField(current, "ppid");
    const parent = raw ? Number(raw) : NaN;
    if (!Number.isSafeInteger(parent) || parent <= 0) return false;
    current = parent;
  }
  return false;
}

function loadDashboardLaunchRecord(port: string | number): DashboardLaunchRecord | null {
  try {
    return parseDashboardLaunchRecord(JSON.parse(readFileSync(dashboardLaunchRecordPath(port), "utf-8")));
  } catch { return null; }
}

function sameDashboardLaunchRecord(a: DashboardLaunchRecord | null, b: DashboardLaunchRecord): boolean {
  return !!a
    && a.schema === b.schema
    && a.port === b.port
    && a.listener_pid === b.listener_pid
    && a.listener_birth === b.listener_birth
    && a.source === b.source
    && a.source_key === b.source_key
    && a.recorded_at === b.recorded_at;
}

function revalidateExactManagedDashboard(
  pid: number,
  port: string | number,
  expectedRecord: DashboardLaunchRecord,
): boolean {
  const scan = scanDashboardListenerPids(port);
  if (!scan.ok || scan.pids.length !== 1 || scan.pids[0] !== pid) return false;
  if (!sameDashboardLaunchRecord(loadDashboardLaunchRecord(port), expectedRecord)) return false;
  const birth = dashboardProcessField(pid, "lstart");
  const command = dashboardProcessField(pid, "command");
  return birth === expectedRecord.listener_birth && !!command && isDashboardProcessCommand(command);
}

async function dashboardHttpHealthy(host: string, port: string | number): Promise<boolean> {
  const probeHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  try {
    const response = await fetch(`http://${probeHost}:${port}/login`, { signal: AbortSignal.timeout(1500), redirect: "manual" });
    return response.status >= 200 && response.status < 500;
  } catch { return false; }
}

function resolveGlobalDashboardBinary(): string | null {
  try {
    const found = execFileSync("which", ["agent-network-dashboard"], { encoding: "utf-8" }).trim();
    return found ? realpathSync(found) : null;
  } catch { return null; }
}

function resolveDashboardNpxVersion(tag: string): string | null {
  try {
    const raw = runLauncherSync("npm", ["view", `@sleep2agi/agent-network-dashboard@${tag}`, "version", "--json"], {
      encoding: "utf-8",
      timeout: 8000,
    }).trim();
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" && parsed ? parsed : null;
  } catch { return null; }
}

async function stopExactManagedDashboard(
  pid: number,
  port: string | number,
  expectedRecord: DashboardLaunchRecord,
): Promise<boolean> {
  // Re-read every identity fact immediately before the signal. The PID may
  // have exited and been reused after the initial decision was made.
  if (!revalidateExactManagedDashboard(pid, port, expectedRecord)) return false;
  try { process.kill(pid, "SIGTERM"); } catch { return false; }
  for (let i = 0; i < 12; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const scan = scanDashboardListenerPids(port);
    if (scan.ok && !scan.pids.includes(pid)) return true;
  }
  // The grace period is another PID-reuse window. Never escalate based on
  // the pre-SIGTERM observation; authorize the exact PID again.
  if (!revalidateExactManagedDashboard(pid, port, expectedRecord)) return false;
  try { process.kill(pid, "SIGKILL"); } catch {}
  await new Promise(resolve => setTimeout(resolve, 250));
  const finalScan = scanDashboardListenerPids(port);
  return finalScan.ok && !finalScan.pids.includes(pid);
}

// #89 — npx leaves half-baked `.agent-network-dashboard-<rand>` staging dirs in
// its cache when a previous run was interrupted/concurrent; the next run's rename
// then fails with ENOTEMPTY and the user is stuck until they manually nuke
// ~/.npm/_npx. Best-effort sweep of *stale* (>60s, skips an in-progress concurrent
// npx) staging dirs before spawn. Never throws — startup must not depend on this.
function cleanStaleNpxDashboardTemp() {
  try {
    const npxRoot = join(home, ".npm", "_npx");
    if (!existsSync(npxRoot)) return;
    for (const hash of readdirSync(npxRoot)) {
      const scopeDir = join(npxRoot, hash, "node_modules", "@sleep2agi");
      if (!existsSync(scopeDir)) continue;
      for (const entry of readdirSync(scopeDir)) {
        if (!entry.startsWith(".agent-network-dashboard-")) continue;
        const full = join(scopeDir, entry);
        try {
          if (Date.now() - statSync(full).mtimeMs < 60_000) continue; // in-progress
          rmSync(full, { recursive: true, force: true });
          console.log(`[anet] cleaned stale npx temp dir: ${entry}`);
        } catch {}
      }
    }
  } catch {}
}

function parseSemver(text: string): Semver | null {
  // #192 — capture optional prerelease (`-preview.N` etc.) so `anet -v`
  // Components shows the full installed version, not just major.minor.patch.
  // compareSemver still ignores prerelease (intentional — preview ≡ release
  // for the upgrade-check at cli.ts:4202/4321), so adding the field is
  // display-only and does not regress the upgrade-needed logic.
  const match = text.match(/(?:^|[^0-9])v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?(?:[^0-9]|$)/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    ...(match[4] ? { prerelease: match[4] } : {}),
  };
}

function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

function detectCommandVersion(commandName: string, displayName: string, source?: string): DetectedVersion {
  if (!commandExists(commandName)) {
    return { name: commandName, displayName, version: null, state: "not-installed", source };
  }
  try {
    const output = execFileSync(commandName, ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
    const parsed = parseSemver(output);
    if (!parsed) {
      return { name: commandName, displayName, version: null, state: "unknown", source };
    }
    return {
      name: commandName,
      displayName,
      version: `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ""}`,  // #192
      state: "ok",
      source,
    };
  } catch {
    return { name: commandName, displayName, version: null, state: "unknown", source };
  }
}

function detectGlobalNpmPackage(pkgName: string, displayName: string, source = "global"): DetectedVersion {
  try {
    const output = runLauncherSync("npm", ["ls", "-g", pkgName, "--depth=0", "--json"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const data = JSON.parse(output);
    const version = data?.dependencies?.[pkgName]?.version;
    if (!version) {
      return { name: pkgName, displayName, version: null, state: "unknown", source };
    }
    const parsed = parseSemver(version);
    if (!parsed) {
      return { name: pkgName, displayName, version: null, state: "unknown", source };
    }
    return {
      name: pkgName,
      displayName,
      version: `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ""}`,  // #192
      state: "ok",
      source,
    };
  } catch {
    return { name: pkgName, displayName, version: null, state: "not-installed", source };
  }
}

function detectInstalledPackages() {
  const pkg = JSON.parse(readFileSync(packageJsonPath(), "utf-8"));
  const versions = {
    anet: {
      name: "anet",
      displayName: "anet",
      version: pkg.version as string,
      state: "ok" as VersionState,
    },
    agentNode: detectCommandVersion("agent-node", "agent-node", "global"),
    commhubServer: detectCommandVersion("commhub-server", "commhub-server", "global"),
    claude: detectCommandVersion("claude", "claude CLI"),
    codex: detectCommandVersion("codex", "codex CLI"),
    // Bun 不是「可选运行时」,它是本机跑 hub 的硬前置:`anet hub start` 在
    // 缺 bun/bunx 时直接 process.exit(1)(见 hub start 里的前置校验)。
    // 此前自报里完全不提它,用户只能撞上去才知道 —— 这正是本次要修的。
    // 🔴 判据必须与 hub 守卫同源,而守卫现在是
    //     if (!commandExists("bunx"))            (cli.ts, hub start)
    // —— **只认 bunx**。#766 把它从 OR 收紧成这样,理由写在那里:唯一的启动方式
    // 是 `spawnLauncher("bunx", …)`,OR 会让 bun-only 的机器通过前置检查然后在 spawn 处
    // 失败。这里的 OR 是那次收紧留下的旧副本(#744 复核当时为真,现在为假),它让
    // 自报在 bun-only 机器上说「齐了」,而 `anet hub start` 随后 exit 1。
    // 实测:容器里有 bun 无 bunx,自报通过、hub 起不来,报「找到了 bun,但没有 bunx」。
    bun: (() => {
      // bunx is the requirement; bun is only how we get a version to show.
      if (!bunxAvailable()) {
        return { name: "bunx", displayName: "Bun (bunx)", version: null, state: "not-installed" as VersionState };
      }
      const direct = detectCommandVersion("bun", "Bun");
      if (direct.state === "ok" || direct.state === "unknown") return direct;
      return detectCommandVersion("bunx", "Bun (via bunx)");
    })(),
  };

  if (versions.agentNode.state !== "ok") {
    versions.agentNode = detectGlobalNpmPackage("@sleep2agi/agent-node", "agent-node", "global");
  }
  if (versions.commhubServer.state !== "ok") {
    versions.commhubServer = detectGlobalNpmPackage("@sleep2agi/commhub-server", "commhub-server", "global");
  }

  return versions;
}

function formatDetectedVersion(pkg: DetectedVersion): string {
  const suffix = pkg.source ? ` (${pkg.source})` : "";
  if (pkg.state === "ok" && pkg.version) return `${pkg.displayName} v${pkg.version}${suffix}`;
  if (pkg.state === "unknown") return `${pkg.displayName} installed (version unknown)${suffix}`;
  return `${pkg.displayName} not installed`;
}

function formatLazyComponent(pkg: DetectedVersion): string {
  if (pkg.state === "ok" && pkg.version) return `✓ ${pkg.displayName} v${pkg.version}`;
  if (pkg.state === "unknown") return `✓ ${pkg.displayName} installed`;
  return `○ ${pkg.displayName} — not installed yet (will fetch via npx on first use)`;
}

/** Bun 的自报行。与 formatOptionalRuntime 分开,因为缺失时的语义完全不同:
 *  可选运行时缺了只是少一种 runtime,Bun 缺了 `anet hub start` 直接失败,
 *  所以这里要给出可直接执行的安装命令,而不是一句 "only needed for …"。 */
function formatRequiredBun(pkg: DetectedVersion): string {
  if (pkg.state === "ok" && pkg.version) return `✓ ${pkg.displayName} v${pkg.version}`;
  if (pkg.state === "unknown") return `✓ ${pkg.displayName} installed`;
  // 🔴 这里刻意**不**给 `curl … | bash` 一行流。
  // 那正是 #729/#733/#743/#728 一整条线在修的 fail-open 形状:
  // 管道的退出码只反映 consumer,producer(curl)失败会被吞掉。
  // 我们自己在 CI 里把它当缺陷修掉,就不该在 CLI 里教用户这么做。
  // 给包管理器安装(有校验、可回滚)+ 官方安装页,由用户选。
  return `✗ ${pkg.displayName} not found — \`anet hub start\` will fail without it `
    + `(commhub-server is bun-only). Install with: npm i -g bun `
    + `— or follow https://bun.sh/docs/installation`;
}

function formatOptionalRuntime(pkg: DetectedVersion, reason: string): string {
  if (pkg.state === "ok" && pkg.version) return `✓ ${pkg.displayName} v${pkg.version}`;
  if (pkg.state === "unknown") return `✓ ${pkg.displayName} installed`;
  return `○ ${pkg.displayName} — only needed for ${reason}`;
}

function detectAgentNodeSubDeps(): { claudeAgentSdk: string | null; codexSdk: string | null } {
  const globalPrefix = execSync("npm prefix -g", { encoding: "utf-8", timeout: 5000 }).trim();
  const base = join(globalPrefix, "lib", "node_modules", "@sleep2agi", "agent-node", "node_modules");
  let claudeAgentSdk: string | null = null;
  let codexSdk: string | null = null;
  try {
    const pkg = JSON.parse(readFileSync(join(base, "@anthropic-ai", "claude-agent-sdk", "package.json"), "utf-8"));
    claudeAgentSdk = pkg.version;
  } catch {}
  try {
    const pkg = JSON.parse(readFileSync(join(base, "@openai", "codex-sdk", "package.json"), "utf-8"));
    codexSdk = pkg.version;
  } catch {}
  return { claudeAgentSdk, codexSdk };
}

function printVersionReport() {
  const versions = detectInstalledPackages();
  console.log(`anet v${versions.anet.version}\n`);

  console.log("Components (auto-fetched on first use, you don't need to install them manually):");
  console.log(`  ${formatLazyComponent(versions.agentNode)}`);
  if (versions.agentNode.state === "ok") {
    try {
      const sub = detectAgentNodeSubDeps();
      if (sub.claudeAgentSdk) console.log(`    └ @anthropic-ai/claude-agent-sdk v${sub.claudeAgentSdk}`);
      if (sub.codexSdk) console.log(`    └ @openai/codex-sdk v${sub.codexSdk}`);
    } catch {}
  }
  console.log(`  ${formatLazyComponent(versions.commhubServer)}`);

  // Bun 单独一节,不能混进 "Optional runtimes" —— 它不是可选的。
  // 措辞限定在「本机跑 hub」:节点连远程 hub 不需要 Bun,说成笼统必需是过度声称。
  console.log("\nRequired to run a hub on this machine:");
  console.log(`  ${formatRequiredBun(versions.bun)}`);

  console.log("\nOptional runtimes (install only what you'll use):");
  console.log(`  ${formatOptionalRuntime(versions.claude, "the claude-code-cli runtime")}`);
  console.log(`  ${formatOptionalRuntime(versions.codex, "the codex-sdk runtime")}`);

  const componentsMissing = versions.agentNode.state !== "ok" || versions.commhubServer.state !== "ok";
  if (componentsMissing) {
    console.log("\nNothing is broken — components are fetched the first time you run:");
    console.log("  anet hub start          # bootstraps commhub-server");
    console.log("  anet node start <name>  # bootstraps agent-node");
    // 缺 Bun 时上面这句会误导:`anet hub start` 不会「自动拉取后正常工作」,
    // 它会在前置校验处 exit 1。所以这里必须把话收回来。
    if (!isInstalled(versions.bun)) {
      console.log("\n  ⚠️  but `anet hub start` will not succeed until Bun is installed — see above.");
    }
    console.log("\nDocs: https://anet.sh/guide/getting-started");
  }
}

function isInstalled(pkg: DetectedVersion): boolean {
  return pkg.state === "ok" || pkg.state === "unknown";
}

function installGlobalPackage(pkgName: string) {
  runLauncherSync("npm", ["install", "-g", pkgName], { stdio: "inherit" });
}

function printDetectedPackagesForSetup() {
  const versions = detectInstalledPackages();
  console.log(`检测已安装的包...`);
  console.log(`  ✅ anet v${versions.anet.version}`);
  console.log(`  ${isInstalled(versions.agentNode) ? "✅" : "❌"} ${formatDetectedVersion(versions.agentNode)}`);
  console.log(`  ${isInstalled(versions.claude) ? "✅" : "❌"} ${formatDetectedVersion(versions.claude)}`);
  console.log(`  ${isInstalled(versions.codex) ? "✅" : "❌"} ${formatDetectedVersion(versions.codex)}`);
  console.log(`  ${isInstalled(versions.commhubServer) ? "✅" : "❌"} ${formatDetectedVersion(versions.commhubServer)}`);
  console.log();
  return versions;
}

async function setupCommand() {
  const versions = printDetectedPackagesForSetup();
  const runtimeSelections = await checkbox<RuntimeName>({
    message: "你需要哪些 runtime？（空格选择，回车确认）",
    choices: [
      {
        name: `claude-code-cli — Claude Code CLI${isInstalled(versions.claude) ? "（已就绪 ✅）" : "（需要安装 claude CLI）"}`,
        value: "claude-code-cli",
        checked: isInstalled(versions.claude),
      },
      {
        name: `codex-sdk — Codex SDK${isInstalled(versions.agentNode) && isInstalled(versions.codex) ? "（已就绪 ✅）" : "（需要安装 agent-node + codex CLI）"}`,
        value: "codex-sdk",
      },
      {
        name: `grok-build-acp — Grok Build ACP${isInstalled(versions.agentNode) ? "（需要 agent-node + grok CLI）" : "（需要安装 agent-node + grok CLI）"}`,
        value: "grok-build-acp",
      },
      {
        name: `grok-build-cli — Grok 共存 TUI（实验性 preview；仅可接收可信任务）`,
        value: "grok-build-cli",
      },
      {
        name: `claude-agent-sdk — Claude Agent SDK${isInstalled(versions.agentNode) ? "（已就绪 ✅）" : "（需要安装 agent-node）"}`,
        value: "claude-agent-sdk",
      },
    ],
  });

  const installCommhubServer = await confirm({
    message: "要安装 CommHub Server 吗？（本地开发/测试用）",
    default: false,
  });

  const packagesToInstall: string[] = [];
  const addPackage = (pkgName: string) => {
    if (!packagesToInstall.includes(pkgName)) packagesToInstall.push(pkgName);
  };

  if (runtimeSelections.includes("claude-code-cli") && !isInstalled(versions.claude)) {
    addPackage("@anthropic-ai/claude-code");
  }
  if (runtimeSelections.includes("codex-sdk")) {
    if (!isInstalled(versions.agentNode) && !runtimeSelections.includes("grok-build-cli")) addPackage("@sleep2agi/agent-node");
    if (!isInstalled(versions.codex)) addPackage("@openai/codex");
  }
  if (runtimeSelections.includes("grok-build-acp") && !isInstalled(versions.agentNode) && !runtimeSelections.includes("grok-build-cli")) {
    addPackage("@sleep2agi/agent-node");
  }
  if (runtimeSelections.includes("grok-build-cli") && !isInstalled(versions.agentNode)) {
    addPackage("@sleep2agi/agent-node@preview");
  }
  if (runtimeSelections.includes("claude-agent-sdk") && !isInstalled(versions.agentNode) && !runtimeSelections.includes("grok-build-cli")) {
    addPackage("@sleep2agi/agent-node");
  }
  if (installCommhubServer && !isInstalled(versions.commhubServer)) {
    addPackage("@sleep2agi/commhub-server");
  }

  if (packagesToInstall.length === 0) {
    console.log(`所有所选 runtime 依赖都已安装。`);
  } else {
    console.log(`即将安装:`);
    for (const pkgName of packagesToInstall) {
      console.log(`  npm install -g ${pkgName}`);
    }
    const shouldInstall = await confirm({ message: "确认安装？", default: true });
    if (!shouldInstall) {
      console.log(`已取消。`);
      return;
    }

    console.log(`\n安装中...`);
    for (const pkgName of packagesToInstall) {
      try {
        installGlobalPackage(pkgName);
      } catch {
        console.error(`[anet] Failed to install ${pkgName}`);
        process.exit(1);
      }
    }
  }

  console.log(`\n验证:`);
  const verified = detectInstalledPackages();
  if (runtimeSelections.includes("claude-code-cli")) {
    console.log(`  ${isInstalled(verified.claude) ? "✅" : "❌"} ${formatDetectedVersion(verified.claude)}`);
  }
  if (runtimeSelections.includes("codex-sdk") || runtimeSelections.includes("claude-agent-sdk") || runtimeSelections.includes("grok-build-acp") || runtimeSelections.includes("grok-build-cli")) {
    console.log(`  ${isInstalled(verified.agentNode) ? "✅" : "❌"} ${formatDetectedVersion(verified.agentNode)}`);
  }
  if (runtimeSelections.includes("codex-sdk")) {
    console.log(`  ${isInstalled(verified.codex) ? "✅" : "❌"} ${formatDetectedVersion(verified.codex)}`);
  }
  if (installCommhubServer) {
    console.log(`  ${isInstalled(verified.commhubServer) ? "✅" : "❌"} ${formatDetectedVersion(verified.commhubServer)}`);
  }

  if (runtimeSelections.includes("codex-sdk")) {
    console.log(`  ⚠ codex 需要登录: codex login`);
  }
  if (runtimeSelections.includes("grok-build-acp") || runtimeSelections.includes("grok-build-cli")) {
    console.log(`  ⚠ grok 需要安装并登录: grok login 或 x.ai CLI 认证缓存`);
  }
  if (runtimeSelections.includes("grok-build-cli")) {
    console.warn(`  ⚠ EXPERIMENTAL/DANGEROUS: 网络任务会驱动同一个 Grok TUI；审批归属未完成硬化。`);
    console.warn(`  ⚠ 仅在 preview 中使用，不要接入不可信任务。`);
  }
  if (runtimeSelections.includes("claude-code-cli")) {
    console.log(`  ⚠ claude 需要登录: claude auth login`);
  }

  console.log(`\n完成！下一步: anet node create <node-name>`);
}

// RFC-029 — the effective opencode-ai pin. A per-machine smoke marker may
// attest the exact built-in pin, but cannot select a different upstream
// version: only a new maintainer-vetted preview can bump the release pin.
import {
  formatOpencodePackageIdentityFailure,
  opencodeExactInstallCommand,
  readEffectivePin,
  writePinOverride,
  OPENCODE_BUILTIN_PIN,
} from "../src/opencode-pin";
export const OPENCODE_PINNED_VERSION = OPENCODE_BUILTIN_PIN;

type OpencodeLaunchIdentity = { binary: string; version: string };
let opencodeLaunchIdentity: OpencodeLaunchIdentity | null = null;

function createOpencodeProbeContext(prefix: string) {
  const root = createOpencodeSafeExternalRoot({ prefix });
  try {
    for (const relative of [
      ".config",
      join(".local", "share"),
      ".cache",
      join(".local", "state"),
      ".runtime",
      "tmp",
    ]) {
      mkdirSync(join(root.root, relative), { recursive: true, mode: 0o700 });
    }
    return { root, env: buildOpencodeSmokeEnv(process.env, root.root, root.cwd) };
  } catch (error) {
    try {
      cleanupOpencodeSafeExternalRoot(root);
    } catch (cleanupError: any) {
      throw new Error(
        `OpenCode probe setup failed and its external root could not be cleaned: ` +
        `${cleanupError?.message || cleanupError}`,
      );
    }
    throw error;
  }
}

function checkOpencodePin():
  | ({ ok: true } & OpencodeLaunchIdentity)
  | { ok: false; found: string | null; hint: string } {
  const effective = readEffectivePin();
  const expected = effective.version;
  const forbiddenRoots = discoverOpencodeForbiddenRoots();
  let raw = "";
  let binary = "";
  let probe: ReturnType<typeof createOpencodeProbeContext> | undefined;
  let failure: string | undefined;
  try {
    binary = resolveOpencodePackageBinaryFromPath(process.env.PATH ?? "", {
      expectedVersion: expected,
      forbiddenRoots,
    });
    probe = createOpencodeProbeContext(".anet-opencode-version-");
    revalidateOpencodeSafeExternalRoot(probe.root);
    raw = execFileSync(binary, ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
      cwd: probe.root.cwd,
      env: probe.env,
    }).trim();
    validateOpencodePackageBinary(binary, {
      expectedVersion: expected,
      forbiddenRoots,
    });
  } catch (e: any) {
    failure = `opencode package identity/version check failed: ${e?.message || e}`;
  } finally {
    if (probe) {
      try {
        cleanupOpencodeSafeExternalRoot(probe.root);
      } catch (cleanupError: any) {
        failure = `opencode version probe external-root cleanup failed: ${cleanupError?.message || cleanupError}`;
      }
    }
  }
  if (failure) {
    return {
      ok: false,
      found: null,
      hint: formatOpencodePackageIdentityFailure(expected, failure),
    };
  }
  // opencode --version prints just the semver (e.g. "1.18.1"). Match
  // the first x.y.z substring so future format tweaks (build metadata
  // suffix) don't break the pin check.
  const m = raw.match(/(\d+\.\d+\.\d+)/);
  const found = m ? m[1] : raw;
  if (found === expected) return { ok: true, binary, version: expected };
  const sourceNote = effective.source === "override-file"
    ? ` (from ${opencodeUsePinSource()}; smoke passed ${effective.smokePassedAt})`
    : ` (baked-in default)`;
  return {
    ok: false,
    found,
    hint:
      `Expected opencode-ai@${expected}${sourceNote}; found ${found}.\n` +
      `  → Install the exact release pin: ${opencodeExactInstallCommand(expected)}\n` +
      `  → A different upstream version requires a newly vetted agent-network preview.`,
  };
}

function opencodeUsePinSource(): string {
  // Kept small so the hint above stays one grep-able string.
  return "~/.anet/opencode-pin.json override";
}

type AgentNodeLaunchPlan = {
  command: string;
  argsPrefix: string[];
  source: "explicit" | "sibling" | "global" | "preview" | "paired";
  probeEnv: NodeJS.ProcessEnv;
};

let opencodeAgentNodeLaunchPlan: AgentNodeLaunchPlan | null = null;
let grokAgentNodeLaunchPlan: AgentNodeLaunchPlan | null = null;

// #1808 —— 装在 anet 旁边(同一个 node_modules)的 agent-node。隔离前缀 / npx 缓存 / 多棵
// nvm 树时,PATH 上那份可能是另一棵树里的老版本;旁边这份才是和 anet 一起装的。
// 返回 null 表示没有(全局散装、或 anet 以源码方式运行),调用方按原逻辑走 PATH / npx。
function findSiblingAgentNode(): ReturnType<typeof siblingAgentNodeEntrypoint> {
  const entry = process.argv[1] ? resolve(process.argv[1]) : "";
  return siblingAgentNodeEntrypoint(entry, { // #1832 realpath:npm -g 的 bin/anet 是符号链接
    exists: (path) => existsSync(path), realpath: (path) => realpathSync(path),
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
  });
}

function describeAgentNodeOnPath(env?: NodeJS.ProcessEnv): string {
  try {
    const out = process.platform === "win32"
      ? execFileSync("where", ["agent-node"], { stdio: ["ignore", "pipe", "ignore"], env })
      : execFileSync("/bin/sh", ["-c", "command -v agent-node"], { stdio: ["ignore", "pipe", "ignore"], env });
    return String(out).trim().split(/\r?\n/)[0] || "agent-node";
  } catch {
    return "agent-node";
  }
}
let codexAgentNodeLaunchPlan: AgentNodeLaunchPlan | null = null;

function agentNodeHelp(plan: AgentNodeLaunchPlan): string {
  return execFileSync(plan.command, [...plan.argsPrefix, "--help"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: plan.source === "preview" || plan.source === "paired" ? 120_000 : 5_000,
    env: plan.probeEnv,
  });
}

function planSupportsOpencode(plan: AgentNodeLaunchPlan): boolean {
  try {
    return agentNodeHelpSupportsOpencode(agentNodeHelp(plan));
  } catch {
    return false;
  }
}

function planSupportsRuntime(plan: AgentNodeLaunchPlan, runtime: RuntimeName): boolean {
  try {
    const help = agentNodeHelp(plan);
    return runtime === "grok-build-cli"
      ? agentNodeHelpSupportsGrokCopresence(help)
      : help.includes(runtime);
  } catch {
    return false;
  }
}

function opencodeAgentNodeError(detail: string): Error {
  return new Error(
    `${detail}\n` +
    `Install the exact vetted pair: ${opencodeExactPairInstallCommand()}`,
  );
}

/**
 * Resolve the exact package-owned agent-node paired with this network build.
 * A merely capable older preview is insufficient: historical builds could
 * advertise opencode-cli without this release's isolation guarantees.
 */
function resolveOpencodeAgentNodeLaunchPlan(): AgentNodeLaunchPlan {
  if (opencodeAgentNodeLaunchPlan) return opencodeAgentNodeLaunchPlan;
  const probeEnv = hardenOpencodeAgentNodeEnv(process.env, process.env.PATH);
  const forbiddenRoots = discoverOpencodeForbiddenRoots();
  const explicit = process.env.ANET_AGENT_NODE_BIN;

  if (explicit) {
    if (!isAbsolute(explicit) || !existsSync(explicit)) {
      throw opencodeAgentNodeError(
        "ANET_AGENT_NODE_BIN must name an existing absolute agent-node CLI path",
      );
    }
    let entrypoint: string;
    try {
      entrypoint = validateAgentNodePackageEntrypoint(
        explicit,
        OPENCODE_AGENT_NODE_SPEC,
        OPENCODE_AGENT_NODE_VERSION,
        forbiddenRoots,
      );
    } catch (error: any) {
      throw opencodeAgentNodeError(
        `ANET_AGENT_NODE_BIN is not the exact trusted ${OPENCODE_AGENT_NODE_SPEC}: ${error?.message || error}`,
      );
    }
    const plan: AgentNodeLaunchPlan = {
      command: process.execPath,
      argsPrefix: [entrypoint],
      source: "explicit",
      probeEnv,
    };
    if (!planSupportsOpencode(plan)) {
      throw opencodeAgentNodeError(
        "ANET_AGENT_NODE_BIN lacks opencode-cli; refusing a runtime fallback",
      );
    }
    opencodeAgentNodeLaunchPlan = plan;
    return plan;
  }

  try {
    const entrypoint = resolveAgentNodePackageEntrypointFromPath(
      process.env.PATH ?? "",
      OPENCODE_AGENT_NODE_SPEC,
      OPENCODE_AGENT_NODE_VERSION,
      forbiddenRoots,
    );
    const plan: AgentNodeLaunchPlan = {
      command: process.execPath,
      argsPrefix: [entrypoint],
      source: "global",
      probeEnv,
    };
    if (!planSupportsOpencode(plan)) {
      throw new Error("exact global package does not advertise opencode-cli");
    }
    console.log(`[anet] using installed exact ${OPENCODE_AGENT_NODE_SPEC}.`);
    opencodeAgentNodeLaunchPlan = plan;
    return plan;
  } catch (error: any) {
    throw opencodeAgentNodeError(
      `No exact trusted global ${OPENCODE_AGENT_NODE_SPEC} is available ` +
      `(${error?.message || error}); automatic npx execution is disabled for opencode-cli`,
    );
  }
}

function revalidateOpencodeAgentNodeLaunchPlan(plan: AgentNodeLaunchPlan): AgentNodeLaunchPlan {
  const entrypoint = validateAgentNodePackageEntrypoint(
    plan.argsPrefix[0],
    OPENCODE_AGENT_NODE_SPEC,
    OPENCODE_AGENT_NODE_VERSION,
    discoverOpencodeForbiddenRoots(),
  );
  const checked = { ...plan, command: process.execPath, argsPrefix: [entrypoint] };
  if (!planSupportsOpencode(checked)) {
    throw opencodeAgentNodeError(`${OPENCODE_AGENT_NODE_SPEC} no longer advertises opencode-cli`);
  }
  return checked;
}

function pairedAgentNodeError(detail: string): Error {
  return new Error(`${detail}\nRequired exact runtime: ${PAIRED_AGENT_NODE_SPEC}`);
}

/** Resolve only the exact release-paired package. PATH globals are
 * deliberately ignored so preview.32 cannot shadow preview.33. */
function resolveCodexAgentNodeLaunchPlan(): AgentNodeLaunchPlan {
  if (codexAgentNodeLaunchPlan) return codexAgentNodeLaunchPlan;
  const probeEnv = { ...process.env };
  const forbiddenRoots = discoverOpencodeForbiddenRoots();
  const explicit = process.env.ANET_AGENT_NODE_BIN;
  let rawEntrypoint: string;
  let source: AgentNodeLaunchPlan["source"];
  if (explicit) {
    if (!isAbsolute(explicit) || !existsSync(explicit)) {
      throw pairedAgentNodeError("ANET_AGENT_NODE_BIN must name an existing absolute agent-node CLI path");
    }
    rawEntrypoint = explicit;
    source = "explicit";
  } else {
    let output: string;
    try {
      const resolution = pairedAgentNodeResolution();
      output = execFileSync("npx", resolution.args, {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, env: probeEnv,
      });
    } catch (error: any) {
      throw pairedAgentNodeError(`could not resolve exact paired package: ${error?.stderr || error?.message || error}`);
    }
    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length !== 1 || !isAbsolute(lines[0])) {
      throw pairedAgentNodeError(`${PAIRED_AGENT_NODE_SPEC} returned an invalid entrypoint`);
    }
    rawEntrypoint = lines[0];
    source = "paired";
  }
  let entrypoint: string;
  try {
    entrypoint = validateAgentNodePackageEntrypoint(
      rawEntrypoint, PAIRED_AGENT_NODE_SPEC, PAIRED_AGENT_NODE_VERSION, forbiddenRoots,
    );
  } catch (error: any) {
    throw pairedAgentNodeError(`exact paired package identity validation failed: ${error?.message || error}`);
  }
  const plan: AgentNodeLaunchPlan = { command: process.execPath, argsPrefix: [entrypoint], source, probeEnv };
  if (!agentNodeHelpSupportsCodexAppServer(agentNodeHelp(plan))) {
    throw pairedAgentNodeError("exact paired package lacks codex-app-server capability");
  }
  codexAgentNodeLaunchPlan = plan;
  return plan;
}

function resolvePreviewAgentNodeEntrypoint(resolverEnv: NodeJS.ProcessEnv): string {
  let output: string;
  try {
    output = execFileSync(
      "npx",
      ["-y", "@sleep2agi/agent-node@preview", "--print-entrypoint"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
        env: resolverEnv,
      },
    );
  } catch (e: any) {
    // 🔴 这里以前是 `catch { throw new Error("could not install and resolve …") }`
    // —— 把 npx 说的话整个丢掉。而这是**全新安装的第一次 start** 必经的一步
    // (agent-node 按设计由 npx 懒取,见 checkRuntimeDependency 里那句 note),
    // 所以它失败时用户拿到的是一句没有原因的话,而真正的原因就在被丢掉的 stderr 里:
    // registry 不可达 / 权限 / 磁盘满 / 120s 超时 —— 每一种的下一步动作都不同。
    //
    // 同一个形状在 docs-site/docs/public/install.sh 上修过一次(#908):那次是
    // `>/dev/null 2>&1` 吞掉首次尝试的 stderr,然后把每一种失败都叙述成
    // 「registry 失败」。这里更进一步 —— 它连一个猜测都不给。
    const detail = [e?.stderr, e?.stdout, e?.message]
      .map((v: unknown) => (typeof v === "string" ? v : v ? String(v) : ""))
      .find((v: string) => v.trim().length > 0) ?? "";
    const trimmed = detail.trim().split(/\r?\n/).slice(-8).join("\n").slice(0, 1200);
    const isTimeout = e?.code === "ETIMEDOUT" || e?.signal === "SIGTERM";
    throw new Error(
      `could not install and resolve @sleep2agi/agent-node@preview`
      + (isTimeout ? ` (npx exceeded the 120s budget)` : ``)
      + (trimmed ? `\n--- npx said ---\n${trimmed}` : `\n(npx produced no output — check that \`npx\` itself works)`),
    );
  }

  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1 || !isAbsolute(lines[0])) {
    throw new Error("@sleep2agi/agent-node@preview returned an invalid entrypoint");
  }
  const entrypoint = realpathSync(lines[0]);
  const packageRoot = dirname(dirname(entrypoint));
  const expectedEntrypoint = realpathSync(join(packageRoot, "dist", "cli.js"));
  if (entrypoint !== expectedEntrypoint) {
    throw new Error("@sleep2agi/agent-node@preview entrypoint is outside its package payload");
  }

  const packageJsonPath = join(packageRoot, "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (
    pkg?.name !== "@sleep2agi/agent-node"
    || typeof pkg?.version !== "string"
    || !pkg.version.includes("-preview.")
    || pkg?.publishConfig?.tag !== "preview"
  ) {
    throw new Error("resolved agent-node package is not a preview-channel candidate");
  }

  const uid = process.getuid?.();
  for (const path of [entrypoint, packageJsonPath]) {
    const stat = statSync(path);
    if (!stat.isFile() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o022) !== 0) {
      // Name the condition that fired. "unsafe ownership or mode" sent every
      // reader looking at ownership, while on a stock Debian/Ubuntu box
      // (umask 0002 → npm extracts 0775/0664) it is always the group-write
      // bit — which is why grok-build-cli was unstartable on this machine
      // and the error said nothing about umask.
      throw new Error(
        stat.isFile()
          ? `resolved agent-node package has unsafe ownership or mode — ` +
            describeUnsafePath(path, { uid: stat.uid, mode: stat.mode, processUid: uid ?? stat.uid })
          : `${path} is not a regular file`,
      );
    }
  }
  return entrypoint;
}

/**
 * Resolve and capability-check the executable before launch. An old global
 * agent-node must never receive an unknown runtime name: historical builds
 * normalized unknown names to Claude. We instead fall back explicitly to the
 * preview package and verify that package advertises grok-build-cli first.
 */
function resolveGrokAgentNodeLaunchPlan(): AgentNodeLaunchPlan {
  if (grokAgentNodeLaunchPlan) return grokAgentNodeLaunchPlan;
  prepareGrokPreviewResolverConfigs(home);
  const resolverEnv = buildGrokPreviewResolverEnv(process.env, home);

  const explicit = process.env.ANET_AGENT_NODE_BIN;
  if (explicit) {
    if (!isAbsolute(explicit) || !existsSync(explicit)) {
      throw new Error("ANET_AGENT_NODE_BIN must name an existing absolute agent-node CLI path");
    }
    const plan: AgentNodeLaunchPlan = {
      command: process.execPath,
      argsPrefix: [explicit],
      source: "explicit",
      probeEnv: resolverEnv,
    };
    if (!planSupportsRuntime(plan, "grok-build-cli")) {
      throw new Error("ANET_AGENT_NODE_BIN lacks the required Grok co-presence capability; refusing a runtime fallback");
    }
    grokAgentNodeLaunchPlan = plan;
    return plan;
  }

  const sibling = findSiblingAgentNode();
  if (sibling) {
    const siblingPlan: AgentNodeLaunchPlan = {
      command: process.execPath,
      argsPrefix: [sibling.entrypoint],
      source: "sibling",
      probeEnv: resolverEnv,
    };
    if (planSupportsRuntime(siblingPlan, "grok-build-cli")) {
      // 这一句是 test225 钉住的契约(run.sh assert_installed_candidate_runtime),原样保留;
      // 路径与版本另起一行。
      console.log("[anet] using installed agent-node with Grok co-presence capability.");
      console.log(`[anet]   beside anet: ${sibling.entrypoint} (${sibling.version ?? "version unknown"})`);
      grokAgentNodeLaunchPlan = siblingPlan;
      return siblingPlan;
    }
    console.warn(`[anet] the agent-node beside anet (${sibling.version ?? "?"}) lacks Grok co-presence capability; checking PATH.`);
  }

  if (commandExists("agent-node", resolverEnv)) {
    const globalPlan: AgentNodeLaunchPlan = {
      command: "agent-node",
      argsPrefix: [],
      source: "global",
      probeEnv: resolverEnv,
    };
    if (planSupportsRuntime(globalPlan, "grok-build-cli")) {
      console.log("[anet] using installed agent-node with Grok co-presence capability.");
      console.log(`[anet]   from PATH: ${describeAgentNodeOnPath(resolverEnv)}`);
      grokAgentNodeLaunchPlan = globalPlan;
      return globalPlan;
    }
    console.warn(`[anet] installed agent-node lacks the required Grok co-presence capability; using @sleep2agi/agent-node@preview instead.`);
  } else {
    console.log(`[anet] agent-node is not installed globally; fetching @sleep2agi/agent-node@preview.`);
  }

  const previewEntrypoint = resolvePreviewAgentNodeEntrypoint(resolverEnv);
  const previewPlan: AgentNodeLaunchPlan = {
    command: process.execPath,
    argsPrefix: [previewEntrypoint],
    source: "preview",
    probeEnv: resolverEnv,
  };
  if (!planSupportsRuntime(previewPlan, "grok-build-cli")) {
    throw new Error("@sleep2agi/agent-node@preview lacks the required Grok co-presence capability; refusing a runtime fallback");
  }
  grokAgentNodeLaunchPlan = previewPlan;
  return previewPlan;
}

function assertStartCompatibility(runtime: RuntimeName) {
  if (runtime === "codex-app-server") {
    try {
      resolveCodexAgentNodeLaunchPlan();
    } catch (error: any) {
      console.error(`[anet] Incompatible agent-node for codex-app-server.`);
      console.error(`[anet] ${error?.message || error}`);
      console.error(`[anet] Refusing to start: stale globals and floating @preview are not recovery-safe.`);
      process.exit(1);
    }
    return;
  }
  // RFC-029 — opencode CLI's Zed ACP surface is the only integration
  // point, and its message-schema stability across upstream releases
  // is unproven. Reject any drift from the pinned version so a
  // silent `latest` bump can't wedge running nodes.
  if (runtime === "opencode-cli") {
    const check = checkOpencodePin();
    if (!check.ok) {
      console.error(`[anet] Incompatible opencode-ai runtime.`);
      console.error(`[anet] ${check.hint}`);
      process.exit(1);
    }
    // Preserve the exact package-owned executable that passed the pin check.
    // Profile env/.env is merged later and may replace PATH; the child must
    // still verify and spawn this same file.
    opencodeLaunchIdentity = { binary: check.binary, version: check.version };
    try {
      resolveOpencodeAgentNodeLaunchPlan();
    } catch (error: any) {
      console.error(`[anet] Incompatible agent-node for opencode-cli.`);
      console.error(`[anet] ${error?.message || error}`);
      console.error(`[anet] Refusing to start: an unsupported agent-node could silently select another runtime.`);
      process.exit(1);
    }
    return;
  }

  if (runtime === "grok-build-cli") {
    try {
      resolveGrokAgentNodeLaunchPlan();
    } catch (error: any) {
      console.error(`[anet] Incompatible grok-build-cli runtime.`);
      console.error(`[anet] ${error?.message || error}`);
      console.error(`[anet] Refusing to start: an unsupported agent-node could silently select another runtime.`);
      process.exit(1);
    }
    return;
  }

  if (runtime !== "codex-sdk" && runtime !== "claude-agent-sdk") return;

  const versions = detectInstalledPackages();
  const requiredAgentNode = parseSemver("1.0.0")!;
  const requiredCommhub = parseSemver("0.4.0")!;

  // #237 P0 #5 — agent-node is intentionally lazy-fetched via npx by the
  // spawn path in launchAgent (cli.ts:~2417 `npx -y @sleep2agi/agent-node@preview`).
  // Previously this blocked startup when no global install existed, forcing a
  // manual `anet upgrade` even though the npx fallback would have pulled and
  // run the package fine. Treat "not installed globally" as OK and let the
  // spawn path handle the fetch; only the semver check below fails on a stale
  // GLOBAL install that would actively shadow / block the runtime.
  if (versions.agentNode.state !== "ok" || !versions.agentNode.version) {
    console.log(`[anet] note: agent-node not installed globally — will lazy-fetch via npx on spawn (this is normal for fresh installs).`);
    return;  // skip the semver check; npx will fetch a current version
  }

  const agentNodeVersion = parseSemver(versions.agentNode.version);
  if (!agentNodeVersion || compareSemver(agentNodeVersion, requiredAgentNode) < 0) {
    console.error(`[anet] Incompatible package versions.`);
    console.error(`[anet] anet v${versions.anet.version} requires agent-node >= 1.0.0, but found agent-node v${versions.agentNode.version}.`);
    console.error(`[anet] Run: anet upgrade`);
    process.exit(1);
  }

  if (versions.commhubServer.state === "ok" && versions.commhubServer.version) {
    const commhubVersion = parseSemver(versions.commhubServer.version);
    if (commhubVersion && compareSemver(commhubVersion, requiredCommhub) < 0) {
      console.warn(`[anet] Warning: local commhub-server v${versions.commhubServer.version} is older than recommended >= 0.4.0.`);
      console.warn(`[anet] If this machine hosts CommHub, run: anet upgrade`);
    }
  }
}

function printClaudeCodeNotice() {
  console.log(`[anet] claude-code-cli requires:`);
  console.log(`  - Claude Pro / Team / Enterprise subscription`);
  console.log(`  - Run "claude auth login" first`);
  console.log(`  - Uses Anthropic Claude only`);
  console.log(`  - For other models, use --runtime codex-sdk or claude-agent-sdk`);
}

function printGrokCopresenceWarning(
  nodeRef?: string,
  tools?: unknown,
  session: GrokCopresenceSessionDisclosure = "configured",
) {
  const disclosure = grokCopresenceDisclosure(tools, session);
  console.warn(`[anet] ⚠ EXPERIMENTAL/DANGEROUS Grok co-presence preview.`);
  console.warn(`[anet]   Network tasks drive the same Grok TUI; its fixed tools are automatically approved.`);
  for (const line of disclosure.lines) console.warn(`[anet]   ${line}`);
  console.warn(`[anet]   MCP is the single runtime-owned CommHub server.`);
  console.warn(`[anet]   Use only with trusted tasks and a trusted network. Do not use in production.`);
  if (nodeRef) {
    // 🔴 This line is the one an operator actually reads. When `--copresence`
    //    learned to open the TUI itself, leaving this saying "another terminal"
    //    would have kept the two-step flow alive in the only place it is
    //    documented — the code would be one command and the product two.
    console.warn(`[anet]   Shared TUI in one command:  anet node start ${nodeRef} --copresence`);
    console.warn(`[anet]   Or attach an existing node: anet grok attach ${nodeRef}`);
  }
}

function checkRuntimeDependency(runtime: RuntimeName, phase: "create" | "start") {
  if (runtime === "claude-code-cli") {
    const claudeInstalled = commandExists("claude");
    if (!claudeInstalled && phase === "create") {
      console.warn(`[anet] Warning: claude CLI not found in PATH.`);
      console.warn(`[anet] Install: npm install -g @anthropic-ai/claude-code`);
    }
    if (!claudeInstalled && phase === "start") {
      console.error(`[anet] ❌ Cannot start: claude-code-cli requires the Claude Code CLI, but \`claude\` was not found in PATH.`);
      console.error(`[anet]    Install: npm install -g @anthropic-ai/claude-code`);
      console.error(`[anet]    Login:   claude auth login`);
      console.error(`[anet]    No Claude subscription? Recreate the node with \`--runtime claude-agent-sdk\` or \`--runtime codex-sdk\`.`);
      process.exit(1);
    }
    if (phase === "start") printClaudeCodeNotice();
    return;
  }
  // Unlike legacy runtimes, opencode-cli never executes an ambient or
  // project-context npx fallback. Keep the early UX aligned with the strict
  // package-identity gate in resolveOpencodeAgentNodeLaunchPlan().
  if (runtime === "opencode-cli") {
    if (!commandExists("agent-node")) {
      console.warn(
        `[anet] opencode-cli requires the exact paired global ${OPENCODE_AGENT_NODE_SPEC}; automatic npx execution is disabled.`,
      );
      console.warn(`[anet] Install exact pair: ${opencodeExactPairInstallCommand()}`);
    }
    if (phase === "create" && !commandExists("opencode")) {
      console.warn(`[anet] Warning: opencode CLI not found in PATH.`);
      console.warn(`[anet] Install (exact): ${opencodeExactInstallCommand(OPENCODE_PINNED_VERSION)}`);
    }
    return;
  }
  // #214 P2.5 — agent-node is *intentionally* lazy-fetched via npx by
  // `anet node start` (see bin/cli.ts:~2378). Showing a scary "not found"
  // warning during the create wizard misleads first-time users into thinking
  // setup is broken. Suppress for first-time scenarios and only emit a
  // neutral nudge when start phase actually runs without it cached.
  if (phase === "start" && !commandExists("agent-node") && !findSiblingAgentNode()) { // #1832 更正:旁边有就不说 npx
    console.log(`[anet] note: agent-node will be lazy-fetched via npx on first start (this is normal).`);
  }
  if ((runtime === "grok-build-acp" || runtime === "grok-build-cli") && !commandExists("grok")) {
    console.warn(`[anet] Warning: grok CLI not found in PATH.`);
    console.warn(`[anet] Install/login Grok Build first: https://x.ai/cli`);
  }
  // RFC-030 — codex-app-server (codex TUI bridge) runs a standalone
  // `codex app-server`, so it needs the `codex` CLI on PATH (same binary
  // as codex-sdk, but the app-server subcommand). agent-node itself is
  // lazy-fetched via npx like the other runtimes.
  if (runtime === "codex-app-server" && !commandExists("codex")) {
    console.warn(`[anet] Warning: codex CLI not found in PATH.`);
    console.warn(`[anet] Install/login codex first: https://developers.openai.com/codex/cli`);
  }
}

// ── Help ──

function friendlyError(e: any): string {
  const msg = e?.message || String(e);
  if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
    return "Cannot connect to CommHub server. Is it running?\n  Start: anet hub start\n  Or check: anet doctor";
  }
  if (msg.includes("401") || msg.includes("unauthorized")) {
    return "Authentication failed. Try: anet login";
  }
  if (msg.includes("403")) {
    return "Access denied. You may not have permission for this operation.";
  }
  if (msg.includes("429")) {
    return "Too many requests. Please wait a moment and try again.";
  }
  return msg;
}

type SkillCatalogEntry = {
  slug: string;
  name?: string;
  description?: string;
  version?: string;
  content_url?: string;
  content_sha256?: string;
};

type SkillCatalog = {
  skills?: SkillCatalogEntry[];
};

function skillCatalogUrl(): string {
  return process.env.ANET_SKILL_CATALOG_URL || DEFAULT_SKILL_CATALOG_URL;
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function writeSkillCatalogCache(catalog: SkillCatalog, sourceUrl: string) {
  const p = skillCachePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({
    cached_at: new Date().toISOString(),
    source_url: sourceUrl,
    catalog,
  }, null, 2) + "\n");
}

function readSkillCatalogCache(): { cached_at: string; source_url: string; catalog: SkillCatalog } | null {
  const p = skillCachePath();
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf-8"));
    if (!data?.catalog || !Array.isArray(data.catalog.skills)) return null;
    return data;
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function loadSkillCatalog(verbose = false): Promise<{ catalog: SkillCatalog; sourceUrl: string; fromCache: boolean; cachedAt?: string }> {
  const url = skillCatalogUrl();
  try {
    const catalog = await fetchJson(url) as SkillCatalog;
    if (!Array.isArray(catalog.skills)) throw new Error("catalog has no skills[]");
    writeSkillCatalogCache(catalog, url);
    if (verbose) console.error(`[anet] Skill cache: ${skillCachePath()}`);
    return { catalog, sourceUrl: url, fromCache: false };
  } catch (e: any) {
    const cached = readSkillCatalogCache();
    if (cached) {
      console.error(`[anet] Using local SkillHub cache: ${skillCachePath()}`);
      console.error(`[anet] Cache time: ${cached.cached_at}`);
      console.error(`[anet] Cache source: ${cached.source_url}`);
      if (verbose) console.error(`[anet] Online fetch failed: ${url} (${e?.message || e})`);
      return { catalog: cached.catalog, sourceUrl: cached.source_url, fromCache: true, cachedAt: cached.cached_at };
    }
    throw new Error(`Cannot read ${url} and no local cache exists at ${skillCachePath()}`);
  }
}

function resolveSkillContentUrl(catalogUrl: string, contentUrl: string): string {
  return new URL(contentUrl, catalogUrl).toString();
}

async function fetchSkillContent(entry: SkillCatalogEntry, catalogUrl: string): Promise<string> {
  if (!entry.content_url) throw new Error(`Skill ${entry.slug} has no content_url`);
  if (!entry.content_sha256 || !/^[0-9a-f]{64}$/i.test(entry.content_sha256)) {
    throw new Error(`Skill ${entry.slug} has no valid content_sha256`);
  }
  const contentUrl = resolveSkillContentUrl(catalogUrl, entry.content_url);
  const res = await fetch(contentUrl);
  if (!res.ok) throw new Error(`Cannot read ${contentUrl}: HTTP ${res.status}`);
  const text = await res.text();
  const actual = sha256Text(text);
  if (actual.toLowerCase() !== entry.content_sha256.toLowerCase()) {
    throw new Error(`sha256 mismatch for ${entry.slug}: expected ${entry.content_sha256}, got ${actual}`);
  }
  return text;
}

async function skillCommand() {
  const sub = args[1];
  const verbose = args.includes("--verbose") || args.includes("-v");
  if (sub === "list" || sub === "ls") {
    const { catalog } = await loadSkillCatalog(verbose);
    const skills = [...(catalog.skills || [])].sort((a, b) => (a.slug || "").localeCompare(b.slug || ""));
    if (skills.length === 0) {
      console.log("No skills found.");
      return;
    }
    for (const s of skills) {
      console.log(`${s.slug}\t${s.name || ""}\t${s.description || ""}\t${s.version || ""}`);
    }
    if (verbose) console.error(`[anet] Cache path: ${skillCachePath()}`);
    return;
  }
  if (sub === "show") {
    const slug = args.slice(2).find(a => a !== "--verbose" && a !== "-v" && !a.startsWith("--"));
    if (!slug) {
      console.error("Usage: anet skill show <slug>");
      process.exit(1);
    }
    const { catalog, sourceUrl } = await loadSkillCatalog(verbose);
    const entry = (catalog.skills || []).find(s => s.slug === slug);
    if (!entry) {
      // 🔴 全部 slug 就在上一行的 catalog.skills 里 —— 只说「没找到」等于把用户
      // 手上的信息藏起来。同 #1667(节点名) 与 anet import(会话名)。
      // 相似度复用既有的 suggestSimilar(Levenshtein ≤ 2,#214 F7-02 的阈值),不另立一套。
      const slugs = (catalog.skills || []).map(s => String(s.slug || "")).filter(Boolean);
      const near = suggestSimilar(String(slug), slugs);
      if (near) {
        console.error(`Skill not found: ${slug}. Did you mean "${near}"? (anet skill ls lists all ${slugs.length})`);
      } else if (slugs.length) {
        const shown = slugs.slice(0, 5).join(", ");
        const more = slugs.length > 5 ? `, … (${slugs.length} total)` : "";
        console.error(`Skill not found: ${slug}. ${slugs.length} available: ${shown}${more}`);
      } else {
        console.error(`Skill not found: ${slug}. The catalog is empty.`);
      }
      process.exit(1);
    }
    const text = await fetchSkillContent(entry, sourceUrl);
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    if (verbose) console.error(`[anet] Verified sha256: ${entry.content_sha256}`);
    return;
  }
  console.log(`Usage:
  anet skill list [--verbose]
  anet skill show <slug> [--verbose]`);
}

function printHelp() {
  console.log(`
anet — AI Agent Network CLI (V2)

Quick start:
  anet hub start             Start local hub
  anet login                 Log in to the hub
  anet node create my-agent  Create a node
  anet node start my-agent   Start the node
  anet demo                  List demos
  (连别人已有的 hub: anet init --hub <url>)

Node Management:
  anet node create <name>       Create a new agent node
  anet node start <name>        Start a node
  anet node start --all         Start every node in cwd (= anet project up)
  anet node stop <name>         Stop a running node
  anet node resume <name>       Resume interrupted session
  anet node delete <name>       Delete node and config
  anet node rename <ref> <new>  Rename a node
  anet node edit <ref>          Change a node's runtime or model
  anet node restart <name>      Stop then start a node
  anet node loop <name> ...     Schedule a recurring goal on a node
  anet node ls                  List all nodes
  anet node codex <verb> <ref>  Codex TUI co-presence lifecycle: preflight|verify|start|restart|resume|fork|account|rollback
  anet attach <name>            Attach the node's exact tmux TUI session
  anet info <name>              Detailed node info + server status
  anet status                   Network overview (agents + tasks)
  anet tasks [status]           Query tasks (replied/failed/delivered)
  anet goal list [node]         List local scheduled goals
  anet goal show <node> <id>    Show one goal in detail (progress log)
  anet goal edit <node> <id> ... Edit a goal's interval / text / status
  anet goal cancel <node> <id>  Mark a scheduled goal cancelled

Project (cwd-wide):
  anet project up               Start every node in cwd (skip already-running)
  anet project restart          Kill existing tmux + start fresh (every node)
  anet project down             Stop every node + notify hub offline
  --stagger <s>                  Delay between nodes (default: 3, 0 disables)
  --only a,b / --exclude x,y     Filter by alias or node id

Session:
  anet node create <name> --resume <id>    Bind an existing Claude session
  anet node create <name> --resume-latest  Bind the latest Claude session
  anet node start <name>                   Start in this terminal (foreground, default)
  anet node start <name> --tmux            Start in a tmux session (attach with a terminal; detached when headless)
  anet node start <name> --new-session     Start with fresh Claude session
  anet node resume <name> --session <id> Resume specific session
  anet session ls                          List Claude Code sessions

Co-presence (human TUI + network agent share one thread):
  anet node start <name> --copresence
      For codex-app-server: spawn app-server + bridge + attachable Codex TUI
      in tmux (<name>, <name>-appsrv, <name>-桥).
      For opencode-cli: spawn authenticated loopback serve inside the bridge
      plus the official full OpenCode attach TUI (<name>, <name>-桥).
      Attach with: tmux attach -t '=<name>'. Stop with: anet node stop <name>.
      OpenCode setup: anet node create <name> --runtime opencode-cli --mode copresence
      Codex defaults to a read-only sandbox. To grant full FS/network access, add
      --dangerously-allow-full-access. In an interactive TTY this prompts for
      a typed 'yes'; in a non-TTY caller (script / CI / Docker) you must ALSO
      pass --yes-danger-full-access to confirm — the second explicit flag
      prevents \`printf 'yes\\n' |\` from bypassing the prompt.
      Optional: --codex-bin <path> --codex-home <dir> --model <id> --port <p>

Grok co-presence (preview only):
  anet node create <name> --runtime grok-build-cli
                                Create an experimental shared Grok TUI node
  anet node create <name> --runtime grok-build-cli --tools WebSearch
                                Opt into general web search (supports basic X URL search)
  anet grok attach <name>                  Attach this terminal (Ctrl-] detaches)
  anet grok model <name> <id>              Switch the model; works while attached
  --grok-headless               Use legacy per-turn grok-build-cli instead
  --owner-schedule-control      Opt this node into owner-gated managed-cron edits
  WARNING: network tasks drive the same TUI; use trusted tasks/networks only

Channel:
  anet channel add telegram <name> --bot-token <tok> --allow <uid>
  anet channel ls [name]  List channels

Setup:
  anet init [--hub <url>]                                 Configure hub URL (global; no token prompt)
  anet init --hub <url> --token <tok>
                                Legacy master-token compatibility path
  anet init project                                       Setup project (channel plugin)
  anet setup                                              Install runtime dependencies
  anet hub start                                          Start CommHub Server + admin bootstrap
  anet hub dashboard                                      Start Web Dashboard
  anet hub config                                         Show/set server config
  anet upgrade                                            Upgrade all anet packages (channel-aware)
  anet upgrade --channel preview|latest --dry-run --self  (see flags)

Daemon (host_supervisor — required by the dashboard's node-creation wizard):
  anet daemon up [name]                                   Create + start a daemon (one-shot, default: "daemon")
  anet daemon init <name>                                 Create a host_supervisor node config
  anet daemon start <name>                                Start an existing daemon
  anet daemon list                                        List locally-configured daemons

Config & tokens:
  anet config [path|json]      Show config summary, path, or raw JSON
  anet token ls|create|revoke  Manage API tokens
  anet batch <verb> [prefix]   Manage groups created by create --batch

OpenCode:
  anet opencode upgrade-pin <v> Verify + pin the exact opencode-ai release
  anet opencode auth-login <n> --provider <anthropic|openai>
                                API-key login for an opencode-cli node

Other:
  anet import [alias]         Import sessions from CommHub
  anet register               Create new account
  anet login                  Login (username + password)
  anet login --token <tok>    Login with API token
  anet logout                 Remove saved token
  anet passwd                 Change password
  anet whoami                 Show current user + networks
  anet network ls             List my networks
  anet network create <name>  Create a network
  anet network use <name>     Switch to a network
  anet skill list             List public SkillHub skills
  anet skill show <slug>      Print a skill's SKILL.md (sha256 verified)
  anet license                Show license status + limits
  anet activate <key>         Activate license key
  anet logs <name>            Show recent agent logs
  anet doctor                 System diagnostic check
  anet run                    Standalone SSE agent
  anet -v                     Version + dependency report

Legacy aliases:
  anet create <name>  Alias for anet node create
  anet start <name>   Alias for anet node start
`);
}

function attachCommand() {
  const ref = args[1];
  if (!ref || args.length !== 2) {
    console.error("Usage: anet attach <node-name>");
    process.exit(1);
  }
  const resolved = resolveNodeRef(ref);
  if (!resolved) {
    console.error(nodeNotFound(ref));
    process.exit(1);
  }
  const displayName = nodeDisplayName(resolved.id, resolved.profile);
  let listing: string;
  try {
    listing = execFileSync("tmux", ["list-sessions", "-F", "#{session_id}\t#{session_name}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: any) {
    const code = error?.code === "ENOENT" ? "tmux is not installed" : "no tmux server/session is available";
    console.error(`[anet] Cannot attach ${JSON.stringify(displayName)}: ${code}.`);
    console.error(`[anet] Start it first: anet node start ${shellQuote(displayName)} --tmux`);
    process.exit(1);
  }

  const session = findExactTmuxSession(listing, displayName);
  if (!session) {
    const related = parseTmuxSessions(listing)
      .filter((candidate) => candidate.name.startsWith(`${displayName}-`))
      .map((candidate) => candidate.name);
    console.error(`[anet] TUI session ${JSON.stringify(displayName)} is not running.`);
    if (related.length) {
      console.error(`[anet] Refusing prefix fallback to related non-TUI session(s): ${related.join(", ")}`);
    }
    console.error(`[anet] Start it first: anet node start ${shellQuote(displayName)} --tmux`);
    process.exit(1);
  }

  const child = spawnSync("tmux", ["attach-session", "-t", session.id], { stdio: "inherit" });
  if (child.error) {
    console.error(`[anet] tmux attach failed: ${child.error.message}`);
    process.exit(1);
  }
  if (child.status !== 0) process.exit(child.status ?? 1);
}

function printNodeStartHelp() {
  console.log(`
Usage: anet node start <name> [options]
       anet node start --all [--stagger <seconds>] [--only a,b] [--exclude x,y]

Options:
  --tmux                       Start in a tmux session
  --new-session               Start with a fresh model session
  --copresence                Start a shared human + agent TUI\n                              (codex-app-server | opencode-cli | grok-build-cli)
                              (codex: recorded on the node, so the next start
                              needs no flag — plain 'anet node start <name>')
  --accept-dev-channels       Headless / CI / no-TTY mode: start in detached
                              tmux and auto-confirm the dev-channel prompt
                              (requires tmux)
  --dangerously-allow-full-access
                              Request full filesystem/network access for
                              supported co-presence runtimes. Recorded on the
                              node once granted, so later starts need no flag.
                              A node whose flags ask for full access but has no
                              grant is told so at start, instead of quietly
                              running read-only.
  --yes-danger-full-access    Required with the previous flag in non-TTY use
  --no-inherit-codex-home     Do not stage the host's codex auth.json /
                              version.json into the node's isolated CODEX_HOME.
  --tui-first                 Restore the exact-session TUI before the bridge attaches
                              (thread must be known; used by node codex restart)
                              Without them the TUI parks on the sign-in page or
                              the update prompt; use this only if you intend to
                              sign in inside that HOME yourself.
`);
}

// ── init (global) ──

async function initGlobal() {
  const opts = parseOpts();
  let hub = opts.hub;

  if (!hub) {
    hub = await ask("CommHub URL (e.g. http://YOUR_IP:9200)");
  }

  if (!hub) { closeRL(); console.error("Error: hub URL required"); process.exit(1); }
  hub = hub.replace(/\/+$/, ""); // 去掉结尾斜杠

  // V3 users authenticate with `anet login`; the legacy master token is an
  // explicit compatibility path only. Do not make ordinary init look as
  // though a token is required (#56).
  const token = opts.token || "";
  closeRL();
  try {
    const res = await fetch(`${hub}/health`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const data = await res.json() as any;
    console.log(`✅ CommHub v${data.version} — ${data.sessions_count ?? 0} sessions, ${data.sse_connections ?? 0} SSE`);
  } catch (e: any) {
    console.error(`❌ Cannot reach ${hub}: ${e.message}`);
    process.exit(1);
  }

  const gc = loadGlobal();
  gc.hub = hub;
  if (token) gc.token = token;
  else if (!gc.token) delete gc.token; // don't overwrite existing token with empty
  saveGlobal(gc);
  console.log(`\nSaved to ${globalConfigPath()}`);
  console.log(`Next: anet init project`);
}

// ── init project ──

async function initProject() {
  const gc = loadGlobal();
  const hub = gc.hub;
  if (!hub) {
    console.error("Run 'anet init' first to configure hub URL");
    process.exit(1);
  }

  const anetDir = join(process.cwd(), ".anet");
  mkdirSync(anetDir, { recursive: true });

  // v0.11 security — first action after creating .anet/ is to make
  // sure git won't sweep it. See ensureAnetInRootGitignore() for the
  // incident background.
  ensureAnetInRootGitignore();

  // 1. Write node-server.ts (uses shared resolver below)
  const serverTs = join(anetDir, "node-server.js");
  const refreshed = refreshNodeServerJsAt(serverTs, { overwrite: false });
  if (refreshed === "wrote")        console.log(`  ✅ .anet/node-server.js`);
  else if (refreshed === "exists")  console.log("  Channel plugin: exists");
  else {
    console.log(`  ❌ Cannot find node-server.js source`);
    console.log(`  Fix: cp $(npm root -g)/@sleep2agi/agent-network/src/node-server.ts .anet/node-server.js`);
  }

  // 2. package.json for channel deps
  const pkgJson = join(anetDir, "package.json");
  if (!existsSync(pkgJson)) {
    writeFileSync(pkgJson, JSON.stringify({
      "private": true,
      "dependencies": {
        "@modelcontextprotocol/sdk": "^1.12.0"
      }
    }, null, 2) + "\n");
    try {
      execSync("bun install", { cwd: anetDir, stdio: "pipe" });
      console.log("  ✅ Dependencies installed");
    } catch {
      console.log("  ⚠️  Run: cd .anet && bun install");
    }
  }

  // 3. .env（CommHub URL + Token）
  const envPath = join(anetDir, ".env");
  const token = gc.token || "";
  let envContent = `COMMHUB_URL=${hub}\n`;
  if (token) envContent += `COMMHUB_TOKEN=${token}\n`;
  atomicWritePrivateFile(envPath, envContent);
  console.log(`CommHub URL: ${hub}${token ? " (with token)" : ""}`);

  // 4. .mcp.json（指向 .anet/node-server.js）
  const mcpJsonPath = join(process.cwd(), ".mcp.json");
  let mcpConfig: any = {};
  if (existsSync(mcpJsonPath)) try { mcpConfig = JSON.parse(readFileSync(mcpJsonPath, "utf-8")); } catch {}
  if (!mcpConfig.mcpServers?.commhub) {
    mcpConfig.mcpServers = mcpConfig.mcpServers || {};
    mcpConfig.mcpServers.commhub = { type: "stdio", command: "bun", args: [".anet/node-server.js"] };
    writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    console.log(`.mcp.json: commhub → .anet/node-server.js`);
  } else {
    console.log(`.mcp.json: commhub already set`);
  }

  // 5. CLAUDE.md（让 Claude Code 知道怎么用 CommHub）
  const claudeMdPath = join(process.cwd(), "CLAUDE.md");
  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, `# Agent Network (CommHub)

## 通信方式

你已接入 CommHub 通信网络。用以下 MCP 工具和其他 Agent/指挥室通信：

### 给别人发消息
\`\`\`
commhub_send_task(alias="指挥室", task="你要说的内容", priority="normal")
\`\`\`

### 回复任务
\`\`\`
commhub_reply(task_id="从消息 meta 里拿", text="回复内容", status="completed")
\`\`\`

### 上报状态
\`\`\`
commhub_report_status(status="working", task="正在做什么")
\`\`\`

### 查看谁在线
\`\`\`
commhub_get_all_status()
\`\`\`

### 给用户发文件/图片

❌ **不要把服务器本地路径（\`/home/...\` / \`/tmp/...\`）直接发到回复正文** — 用户的 APP / 浏览器 / 手机都打不开服务器本地路径，发了等于没发。

✅ 正确流程：先上传到 hub，再用 markdown 引用 \`/api/files/<file_id>\`：

\`\`\`bash
# 1. 上传到 hub（地址 / token 走 env，不硬编码）
curl -F "file=@<本地路径>" \\
  -H "Authorization: Bearer \$COMMHUB_TOKEN" \\
  "\$COMMHUB_URL/api/upload"

# 响应：{"ok":true,"file_id":"<32 hex>","url":"/api/files/<32 hex>", ...}
\`\`\`

\`\`\`markdown
<!-- 2. 在回复正文里用 markdown 引用 file_id -->
这是给你的报表：[周报.xlsx](/api/files/<file_id>)
\`\`\`

规范：
- 图片用 **PNG / JPG**（SVG 客户端渲染不了）
- 单文件 ≤ **12 MiB**
- 地址 / token 用 \`\$COMMHUB_URL\` / \`\$COMMHUB_TOKEN\` env（节点 spawn 时已注入），**不硬编码**
- 引用必须是 \`/api/files/<file_id>\` 格式，**不要**把本地路径塞进 markdown link target

## 收到消息

来自 CommHub 的消息会以 \`<channel source="commhub" sender="..." task_id="...">\` 格式出现在对话中。收到后：
1. 立即用 commhub_send_task 回复发送者确认收到
2. 执行任务
3. 用 commhub_send_task 回复结果

## 规则

- 收到任务必须回应：确认→执行→汇报
- **给任何 agent 节点回复都用 commhub_send_task**（不是 commhub_reply）—— commhub_reply 只写库不唤醒对方 agent，对方 next inbox poll 前看不见；只有目标是 Dashboard/UI 时才用 commhub_reply（Vincent 2026-07-28 全网规则）
- 不要猜 alias，用 get_all_status 查
- **给用户发文件先 \`curl -F\` 上传 → markdown 引用 \`/api/files/<id>\`，不要发服务器本地路径**
`);
    console.log(`CLAUDE.md: created`);
  } else {
    console.log(`CLAUDE.md: already exists`);
  }

  console.log(`\n✅ Project ready. Next: anet node create <node-name>`);
}

// ── init profile ──

async function initProfile() {
  console.warn(`[deprecated] anet init profile is now anet node create.`);
  console.warn(`             Run: anet node create <node-name> [--runtime ...]\n`);
  await createCommand(args[2]);
}

function createProfileFromOpts(id: string, opts: ReturnType<typeof parseOpts>): Profile {
  const gc = loadGlobal();
  const hub = opts.hub || gc.hub;
  if (!hub) {
    console.error("Run 'anet init' first to configure hub URL");
    process.exit(1);
  }

  // Build env map
  const envMap: Record<string, string> = {};
  for (const e of opts._envs) {
    const eq = e.indexOf("=");
    if (eq > 0) envMap[e.slice(0, eq)] = e.slice(eq + 1);
  }

  // Default to claude-agent-sdk — works with any Anthropic-compatible API
  // (MiniMax/DeepSeek/GLM/Kimi/Anthropic). claude-code-cli only works for Max/Pro
  // subscribers and was a poor default that left non-subscribers with broken nodes.
  // User-facing `codex-cli` means the live shared TUI. Keep the canonical
  // stored runtime while recording co-presence for later plain starts.
  if (opts.runtime === "codex-cli" && opts.copresence === undefined) {
    opts.copresence = "true";
  }
  const runtime = runtimeForExecution(opts.runtime, "create node");
  const defaultModel = defaultCodexModelForRuntime(runtime);
  // #1469 finding-3 — validate opts.model in place before the profile
  // literal below builds { model: opts.model || defaultModel }. Mutating
  // opts.model here keeps the downstream `opts.model || defaultModel`
  // idiom byte-identical, which test697's L5 mutation guard pins by
  // literal string (`explicit-model-overwritten`). Validation is not-
  // empty-after-trim + no-embedded-whitespace — no known-model allowlist
  // (models are vendor-defined and evolve independently; dispatch
  // explicitly warned against over-restricting). See src/tool-allowlist.ts
  // for the rationale + tests.
  if (opts.model) opts.model = validateModel(opts.model);
  const nodeId = generateNodeId();
  const grokHeadless = opts["grok-headless"] === "true";
  if (grokHeadless && runtime !== "grok-build-cli") {
    console.error("--grok-headless is valid only with --runtime grok-build-cli");
    process.exit(1);
  }

  const profile: Profile = {
    anet_version: "0.1.0",
    node_id: nodeId,
    node_name: id,
    alias: id,
    runtime,
    ...grokBuildCliCreationFields(runtime, nodeId, grokHeadless),
    ...(gc.network_id ? { network_id: gc.network_id } : {}),
    ...(opts.hub ? { hub } : {}),
    ...(opts.model || defaultModel ? { model: opts.model || defaultModel } : {}),
    ...(opts.tools ? { tools: parseAndValidateTools(opts.tools, runtime) } : {}),
    channels: opts._channels.length > 0 ? opts._channels : ["server:commhub"],
    env: envMap,
    flags: {
      // Per-runtime default flags (Vincent ask 2026-06-24 via 通信龙):
      //   - claude-agent-sdk: writes ONLY `permissionMode: "auto"` (DSP is
      //     redundant — the SDK resolver in agent-node prefers permissionMode
      //     over the legacy DSP field, so writing both produced visible
      //     "two-flag" clutter Vincent flagged as redundant).
      //   - claude-code-cli: keeps writing `dangerouslySkipPermissions: true`
      //     ONLY (Vincent's "cli 不用改" — Claude Code reads DSP directly,
      //     not permissionMode).
      //   - codex-sdk / grok-build-acp: keep DSP for back-compat (legacy
      //     consumers may read it).
      ...(runtime === "claude-agent-sdk"
        ? { permissionMode: "auto" }
        : runtime === "grok-build-cli"
          ? { dangerouslySkipPermissions: false }
          : { dangerouslySkipPermissions: true }),
      // #259 Y (2026-06-25): plumb vendor-known image capability down so
      // agent-node's claude-agent-sdk runtime can pick the structured-prompt
      // path. Only written when the chosen model is explicitly verified
      // image-capable (MiniMax-M3 / claude-sonnet-4-6 etc); other vendors
      // get the warn-only fallthrough at runtime.
      ...(runtime === "claude-agent-sdk" && isModelImageCapable(opts.model || defaultModel)
        ? { modelImageCapable: true }
        : {}),
      ...(runtime === "claude-code-cli" ? { teammateMode: opts["teammate-mode"] || "in-process" } : {}),
      ...(opts["max-turns"] ? { maxTurns: parseInt(opts["max-turns"]) } : {}),
      // RFC-036 B4: explicit process-level opt-in. No per-turn/model path can
      // enable it; Hub still requires an exact owner-bound edit intent.
      ...(opts["owner-schedule-control"] === "true" ? { ownerScheduleControl: true } : {}),
      // #149/#156 — codex-sdk fast/yolo flags via shared helper (was inline
      // here only; #156 batch path missed it because of duplication).
      ...(runtime === "codex-sdk" ? codexSdkYoloFlags(opts["no-yolo"] === "true") : {}),
    },
    ...(runtime === "codex-app-server" && opts["codex-app-server-url"]
      ? { codexAppServerUrl: opts["codex-app-server-url"] }
      : {}),
    ...(runtime === "codex-app-server" && opts["codex-thread-id"]
      ? { codexThreadId: opts["codex-thread-id"] }
      : {}),
    ...(runtime === "opencode-cli"
      ? { opencodeMode: opts.mode === "copresence" || opts.copresence === "true" ? "copresence" : "headless" }
      : {}),
    // Same shape one runtime over: opting in at create is what makes every
    // later `anet node start <name>` a single command.
    ...codexCopresenceCreateFields(runtime, opts.copresence),
    ...(runtime === "claude-code-cli"
      ? { session: opts.session || randomUUID() }
      : opts.session && runtime === "grok-build-cli"
        ? { grokCliSession: opts.session }
        : opts.session && runtime === "grok-build-acp"
          ? { grokSession: opts.session }
          : opts.session
            ? { session: opts.session }
            : {}),
  };
  return profile;
}

// #125 fix (preview.3) — share one resolver between the two launchAgent paths
// (claude-agent-sdk runtime + claude-code-cli runtime). Earlier preview.2
// inlined `v.replace(/^~/, home)` at each spawn site, which crashed when v was
// an envRef object instead of a string. The resolver now: (a) returns the
// string verbatim with ~ expansion, (b) resolves envRef objects from
// process.env and FATAL-fails the parent CLI when the referenced var is
// missing — same UX as agent-node's own resolver, just earlier in the chain
// so we don't fork into a crashing child.
function resolveProfileEnv(profileEnv: Record<string, any> | undefined, home: string, dotenvMap?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!profileEnv || typeof profileEnv !== "object") return out;
  for (const [k, v] of Object.entries(profileEnv)) {
    if (typeof v === "string") {
      out[k] = v.replace(/^~/, home);
      continue;
    }
    if (v && typeof v === "object" && typeof (v as any)._envRef === "string") {
      const refName = (v as any)._envRef;
      // #193 envRef Option A — priority: explicit shell env > per-node
      // .anet/nodes/<id>/.env file. Closes the wizard-create-then-start
      // deadlock without forcing the user to manually `export` before start;
      // existing shell env still wins, so prior-working setups don't change.
      const refVal = process.env[refName] ?? dotenvMap?.[refName];
      if (refVal === undefined || refVal === "") {
        console.error(`[anet] FATAL: config.json env.${k} references env var "${refName}" but it is not set in this shell or in .anet/nodes/<id>/.env.`);
        console.error(`[anet]        Fix: export ${refName}=<your-value>  then re-run anet node start`);
        console.error(`[anet]        (or restore .anet/nodes/<id>/.env from your secrets manager)`);
        process.exit(1);
      }
      out[k] = refVal;
      continue;
    }
    // Any other shape is ignored — env values must be string or envRef object.
  }
  return out;
}

// #193 envRef Option A — read a node's per-node secret store from
// .anet/nodes/<id>/.env (mode 600, gitignored). Parses KEY=VALUE lines, one
// per line, no quotes, no shell expansion. Returns {} if the file is missing
// or unreadable. Caller logs the *key count* — never the values.
function loadNodeDotenv(nodeId: string): Record<string, string> {
  const path = join(nodesDir(), nodeId, ".env");
  repairPrivateFilePermissions(path);
  if (!existsSync(path)) return {};
  try {
    return parseNodeDotenv(readFileSync(path, "utf-8"));
  } catch { return {}; }
}

function parseNodeDotenv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1);  // do NOT trim — token values are taken verbatim after the first `=`
    if (key) out[key] = val;
  }
  return out;
}

function loadOpencodeNodeDotenv(nodeId: string): Record<string, string> {
  const raw = readOpencodePrivateProfileFile(join(nodesDir(), nodeId), ".env");
  return raw === undefined ? {} : parseNodeDotenv(raw);
}

// #193 envRef Option A — ensure the user's project-level `.anet/.gitignore`
// covers per-node .env secret stores. Idempotent.
function ensureNodeDotenvGitignore(): void {
  try {
    const anetDir = join(process.cwd(), ".anet");
    if (!existsSync(anetDir)) return;  // no .anet/ yet — nothing to protect
    ensureGitignoreRule(join(anetDir, ".gitignore"), "nodes/*/.env");
  } catch {}
}

// v0.11 security — ensure the *project-root* .gitignore ignores the whole
// `.anet/` tree. Without this, `git stash -u` or `git clean -fd` in the
// project root sweeps the untracked `.anet/` directory and silently
// destroys configs + access.json + per-node secret stores (the 2026-06
// incident shape that motivated the v0.11 security pass). Idempotent.
function ensureAnetInRootGitignore(): void {
  try {
    const gitignorePath = join(process.cwd(), ".gitignore");
    const outcome = ensureGitignoreRule(gitignorePath, ".anet/");
    if (outcome === "created") {
      console.log(`[anet] 🔒 Created ./.gitignore and added '.anet/' rule (protects against \`git stash -u\` / \`git clean -fd\`).`);
    } else if (outcome === "appended") {
      console.log(`[anet] 🔒 Added '.anet/' to ./.gitignore (protects against \`git stash -u\` / \`git clean -fd\`).`);
    }
    // 'already-present' is silent — the rule was already there, nothing to surface.
  } catch (e: any) {
    // Non-fatal: a CI runner may have a read-only fs, or there's no
    // .gitignore-writable parent. Surface as a warn so the operator can
    // add the rule manually but don't block create / init.
    console.warn(`[anet] ⚠ could not update ./.gitignore with '.anet/' rule: ${e?.message || e}`);
    console.warn(`[anet]    Add '.anet/' to your project's .gitignore manually to avoid \`git clean\` sweeping configs+access.json.`);
  }
}

function saveCreatedNode(id: string, profile: Profile) {
  // Preflight the exact values that rewritePlainSecretsToEnvRef will persist
  // before any node directory, gitignore, process.env, config, or dotenv
  // mutation. This is the shared create choke-point used by both the named
  // command and the no-name interactive wizard.
  planPlainSecretEnvRewrites({
    env: (profile as any).env,
    nodeId: ((profile as any).node_id || id),
  });
  if (normalizeRuntime(profile) === "opencode-cli") {
    // This must be the first node-state operation: the envRef rewrite and
    // saveProfile both carry credentials. Reject node/leaf symlinks first.
    const nodeDir = prepareOpencodeNodeForProfileWrite(join(nodesDir(), id));
    // Creation never inherits a same-uid pre-planted dotenv, even when it is
    // an ordinary 0600 file. Clear it before writing this create's refs.
    writeOpencodePrivateProfileFile(nodeDir, ".env", "");
  }
  // v0.11 security — node create writes to .anet/nodes/<id>/ which carries
  // access.json + per-node tokens. Make sure project-root .gitignore covers
  // .anet/ before we drop any secret state into it. Idempotent; silent
  // when already present.
  ensureAnetInRootGitignore();

  // #125 fix: rewrite plain-secret env values to the envRef shape **at create
  // time**, before the config first hits disk. Keeps secrets out of git
  // history, dashboard, anet ls -v, etc. User sees a banner with `export …`
  // lines so they know what to drop into ~/.bashrc.
  rewritePlainSecretsToEnvRef(id, profile);
  writeLegacyProjectAlias(profile.node_name || id);
  saveProfile(id, profile);
}

// #125 — extracted helper so create + migrate-token-to-envref + (future)
// batch.ts share one definition of "what counts as a secret" and one derivation
// rule for the env-var name. Mutates profile.env in place.
function rewritePlainSecretsToEnvRef(nodeId: string, profile: Profile): void {
  const env: any = (profile as any).env;
  if (!env || typeof env !== "object") return;
  // Re-run the side-effect-free planner at the actual writer boundary. The
  // saveCreatedNode preflight guarantees zero create-side effects; this call
  // is defense in depth for any future caller that reaches the writer directly.
  const rewrites = planPlainSecretEnvRewrites({
    env,
    nodeId: ((profile as any).node_id || nodeId),
  });
  for (const { key, refName, value } of rewrites) {
    env[key] = { _envRef: refName };
    // Also surface the value in the *current* process.env so this very
    // session's downstream (e.g. spawning the agent right after create) can
    // start without the user having to re-`export`. Persistent storage is
    // still the user's responsibility (.bashrc / secrets manager).
    if (!process.env[refName]) process.env[refName] = value;
  }
  if (rewrites.length === 0) return;

  // #193 envRef Option A — persist the secrets to a per-node mode-600 .env
  // file alongside the config so `anet node start` self-sources them on a
  // fresh shell. Closes the wizard-create-then-start deadlock without
  // forcing the user to manually `export`. Idempotent: merges with any
  // existing keys; .gitignore is ensured so the file never leaks via git.
  try {
    const nodeDir = join(nodesDir(), nodeId);
    const dotenvPath = join(nodeDir, ".env");
    const isOpencode = normalizeRuntime(profile) === "opencode-cli";
    if (isOpencode) prepareOpencodeNodeForProfileWrite(nodeDir);
    else mkdirSync(nodeDir, { recursive: true });
    // Creation is a fresh OpenCode boundary: never preserve old PATH,
    // NODE_OPTIONS, or ANET_* entries from a pre-existing dotenv.
    const merged = isOpencode ? {} : loadNodeDotenv(nodeId);
    for (const { refName, value } of rewrites) merged[refName] = value;
    const body = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    if (isOpencode) writeOpencodePrivateProfileFile(nodeDir, ".env", body);
    else {
      atomicWritePrivateFile(dotenvPath, body);
    }
    ensureNodeDotenvGitignore();
  } catch (e: any) {
    console.warn(`[anet] ⚠ could not write per-node .env: ${e?.message || e} — fall back to manual export only.`);
  }

  console.log(`\n[anet] 🔐 ${rewrites.length} secret value(s) in env moved out of config.json (envRef shape, #125).`);
  console.log(`[anet]    Persisted to .anet/nodes/${nodeId}/.env (mode 600, gitignored) — \`anet node start\` auto-loads it.`);
  console.log(`[anet]    ${secretPersistenceHeading(process.platform)}`);
  console.log("");
  for (const { refName, value } of rewrites) {
    console.log(`    ${formatSecretAssignment(process.platform, refName, value)}`);
  }
  console.log("");
}

async function requestNodeToken(profile: Profile, id: string): Promise<string> {
  const gc = loadGlobal();
  const hub = profile.hub || gc.hub;
  const networkId = profile.network_id || gc.network_id;
  const userToken = gc.token;
  const nodeName = profile.node_name || profile.name || profile.alias || id;
  if (!hub) throw new Error("missing hub; run: anet init");
  if (!userToken) throw new Error("missing login token; run: anet login");
  if (!networkId) throw new Error("missing network_id; run: anet login");

  const res = await fetch(`${hub}/api/auth/node-token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ network_id: networkId, node_name: nodeName, node_id: profile.node_id }),
  });
  const body = await res.json() as any;
  if (!body?.ok || !body.token) {
    throw new Error(`node-token request failed: ${body?.error || res.status}`);
  }
  return body.token;
}

async function ensureNodeToken(profile: Profile, id: string): Promise<Profile> {
  const token = profile.token || "";
  if (token.startsWith("ntok_")) return profile;
  profile.token = await requestNodeToken(profile, id);
  return profile;
}

// RFC-029 PR③ — materialize the opencode vendor preset (auth.json +
// opencode.json) into the newly-created node's workdir. Runs after
// `saveCreatedNode` so the node dir already exists. API key is read
// from `preset.envKey` at create time and NEVER prompted (per
// 通信龙 PR③ flag refinement 2). File modes: auth.json is written
// 0o600 by writeOpencodeAuthJson. If the env key is missing we emit
// a node-scoped upstream login command rather than suggesting a second create
// of an alias that now already exists.
function writeOpencodePresetIfRequested(id: string, profile: Profile, wizardOpts: Record<string, any>): void {
  if (normalizeRuntime(profile) !== "opencode-cli") return;
  const presetId = wizardOpts._opencodePreset || "anthropic";
  const { findOpencodePreset, readPresetKeyFromEnv, writeOpencodeAuthJson, writeOpencodeConfigJson } =
    // Lazy-loaded so a create wizard for another runtime doesn't
    // pay the import cost.
    require("../src/opencode-preset") as typeof import("../src/opencode-preset");
  const preset = findOpencodePreset(presetId);
  if (!preset) {
    console.warn(`[anet] ⚠ unknown opencode preset '${presetId}' — skipping auth.json write.`);
    return;
  }
  const apiKey = readPresetKeyFromEnv(preset);
  const nodeWorkDir = join(nodesDir(), id);
  // Always materialize the selected provider and visible safe tool policy,
  // including for keyless/free-model use.
  const configPath = writeOpencodeConfigJson(nodeWorkDir, preset);
  if (!apiKey) {
    // A keyless create is a fresh semantic boundary too: never inherit a
    // regular 0600 auth.json pre-planted by the checkout.
    clearOpencodeAuthJson(nodeWorkDir);
    console.warn(
      `[anet] ⚠ opencode-cli preset '${preset.id}' selected but ${preset.envKey} is not set — ` +
      `no vendor credential written; auth.json reset to an empty object. ` +
      `Keyless/free models can still start without a credential.`,
    );
    console.warn(`[anet]   To add this vendor later, run the node-scoped sandboxed login:`);
    console.warn(
      `[anet]   anet opencode auth-login ${shellQuote(id)} --provider ${preset.configProviderId}`,
    );
    console.warn(`[anet]   sign-up / key page: ${preset.signupUrl}`);
    console.log(`[anet]   opencode.json written with safe tool defaults: ${configPath}`);
    return;
  }
  const authPath = writeOpencodeAuthJson(nodeWorkDir, preset, apiKey);
  console.log(`[anet] ✅ opencode preset '${preset.id}' materialized:`);
  console.log(`  auth.json:     ${authPath} (mode 0o600; sensitive — same-uid processes can still read it)`);
  console.log(`  opencode.json: ${configPath} (safe tools disabled by default)`);
  console.log(`[anet]   Default opencode-cli mode is for communication/text tasks in a launch-scoped external workspace.`);
  console.log(`[anet]   Code tools require flags.opencodeUnsafeTools=true for trusted tasks; use Docker/VM for isolation.`);
}

function printOpencodeCreationSecurityDisclosure(profile: Profile): void {
  const unsafeTools = profile.flags?.opencodeUnsafeTools === true;
  console.log(`\n[anet] ${unsafeTools ? "⚠" : "🛡"} OpenCode tool/cwd policy:`);
  if (unsafeTools) {
    console.log(`[anet]    Built-in: bash / read / glob / grep / edit / write / list / task / skill ENABLED`);
    console.log(`[anet]    Built-in: question DISABLED (unattended ACP has no interactive answer UI)`);
    console.log(`[anet]    Cwd:      project cwd`);
    console.log(`[anet]    HIGH RISK: flags.opencodeUnsafeTools=true is only for trusted tasks.`);
    console.log(`[anet]    This is not a security sandbox; use Docker/VM for process and filesystem isolation.`);
  } else {
    console.log(`[anet]    Built-in disabled: bash / read / glob / grep / edit / write / list / task / skill / question`);
    console.log(`[anet]    Cwd:      external disposable workspace (removed after child exit)`);
    console.log(`[anet]    Intended for communication and text-only tasks.`);
    console.log(`[anet]    Code tools require flags.opencodeUnsafeTools=true for trusted tasks.`);
  }
  console.log(`[anet]    CommHub:  agent-node receives tasks and publishes final text.`);
  console.log(`[anet]              OpenCode itself is not given CommHub MCP tools in this preview.`);
}

/** Configure OpenCode consistently for both node-create entry points. */
async function configureOpencodeRuntime(
  wizardOpts: Record<string, any>,
  interactive = Boolean(process.stdin.isTTY),
): Promise<void> {
  wizardOpts.runtime = "opencode-cli";
  const currentPin = readEffectivePin();
  console.log(`[anet] 请确保已安装 opencode CLI (exact): ${opencodeExactInstallCommand(currentPin.version)}`);
  console.log(`[anet]   pin source: ${currentPin.source === "override-file" ? `~/.anet/opencode-pin.json (smoke ${currentPin.smokePassedAt})` : "built-in default"}`);

  if (!interactive) {
    wizardOpts._opencodePreset ||= "anthropic";
    console.log(`[anet] non-TTY create: opencode preset = ${wizardOpts._opencodePreset}`);
    return;
  }
  try {
    const { select: sel } = await import("@inquirer/prompts");
    const preset = await sel({
      message: "选择 opencode vendor preset:",
      choices: [
        { value: "anthropic", name: "Anthropic 原生 API — reads ANTHROPIC_API_KEY env" },
        { value: "openai", name: "OpenAI — reads OPENAI_API_KEY env" },
      ],
    });
    wizardOpts._opencodePreset = preset;
    console.log(`[anet] opencode preset = ${preset}. Credential materializes below the per-node state directory with mode 0600.`);
  } catch (e: any) {
    console.log(`[anet] ⚠ preset selector 不可用 (${e?.message || e}) — 默认 anthropic`);
    wizardOpts._opencodePreset = "anthropic";
  }
}

function writeLegacyProjectAlias(alias: string) {
  const channelDir = join(home, ".claude", "channels", "commhub");
  const projectKey = encodeCwd(process.cwd());
  const aliasDir = join(channelDir, projectKey);
  mkdirSync(aliasDir, { recursive: true });
  writeFileSync(join(aliasDir, ".env"), `COMMHUB_ALIAS=${alias}\n`);
}

function attachChannel(profile: Profile, channel: string) {
  profile.channels = profile.channels || [];
  if (!profile.channels.includes(channel)) profile.channels.push(channel);
}

/**
 * Atomic JSON write for channel access files (and similar small-state JSON
 * files). Writes to `<path>.tmp.<pid>.<ts>` then renameSync → guaranteed
 * atomic replace on POSIX when both files share the same filesystem.
 *
 * Per 通信牛 review 2026-06-26 必改3: direct writeFileSync can leave a
 * truncated access.json on Ctrl-C / disk-full / concurrent write, which
 * makes the channel un-startable. This helper closes that hole.
 *
 * Mirrors the existing saveGoalsFile pattern in this file.
 */
function writeAccessJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

function writeTelegramChannelConfig(nodeId: string, botToken: string, allowId: string): string {
  const channelDir = join(nodesDir(), nodeId, "channels", "telegram");
  mkdirSync(channelDir, { recursive: true });
  mkdirSync(join(channelDir, "inbox"), { recursive: true });

  const envPath = join(channelDir, ".env");
  atomicWritePrivateFile(envPath, `TELEGRAM_BOT_TOKEN=${botToken}\n`);

  writeAccessJsonAtomic(join(channelDir, "access.json"), {
    dmPolicy: "allowlist",
    allowFrom: [allowId],
    groups: {},
    pending: {},
  });
  return channelDir;
}

/**
 * Feishu channel config writer (RFC-020 §5.2 — #179 M4).
 * Mirrors writeTelegramChannelConfig but with the Feishu schema:
 *   - .env: FEISHU_APP_ID + FEISHU_APP_SECRET (chmod 600, .gitignore'd)
 *   - access.json: { allowFrom: [open_id, ...], allowChats: [chat_id, ...] }
 */
function writeFeishuChannelConfig(
  nodeId: string,
  appId: string,
  appSecret: string,
  allowOpenIds: string[],
  allowChatIds: string[],
): string {
  const channelDir = join(nodesDir(), nodeId, "channels", "feishu");
  mkdirSync(channelDir, { recursive: true });
  const accessPath = join(channelDir, "access.json");
  let existing: Record<string, unknown> = {};
  if (existsSync(accessPath)) {
    try {
      const parsed = JSON.parse(readFileSync(accessPath, "utf-8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("root must be a JSON object");
      }
      existing = parsed as Record<string, unknown>;
    } catch (error: any) {
      throw new Error(`refusing to replace malformed ${accessPath}: ${error?.message || error}`);
    }
  }

  const existingFrom = parseFeishuAllowlistField(existing.allowFrom, "allowFrom", accessPath);
  const existingChats = parseFeishuAllowlistField(existing.allowChats, "allowChats", accessPath);

  const envPath = join(channelDir, ".env");
  atomicWritePrivateFile(envPath, `FEISHU_APP_ID=${appId}\nFEISHU_APP_SECRET=${appSecret}\n`);

  writeAccessJsonAtomic(accessPath, {
    ...existing,
    // Docker bootstrap is additive: preserve ids added through `anet channel
    // allow`, while normalising the historical single-element CSV shape.
    allowFrom: [...new Set([...existingFrom, ...allowOpenIds])],
    allowChats: [...new Set([...existingChats, ...allowChatIds])],
  });
  return channelDir;
}

function parseFeishuAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
}

function parseFeishuAllowlistField(raw: unknown, field: string, path: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((value) => typeof value !== "string")) {
    throw new Error(`refusing malformed ${path}: ${field} must be a string array`);
  }
  return [...new Set(raw.flatMap((value) => parseFeishuAllowlist(value)))];
}

async function askChoice<T extends string>(title: string, choices: { label: string; value: T; description?: string }[]): Promise<T> {
  closeRL();
  return await select<T>({
    message: title,
    choices: choices.map((choice) => ({
      name: choice.label,
      value: choice.value,
      description: choice.description,
    })),
  });
}

// ── Unified vendor registry (issue #104-B) ──
//
// Single source of truth for vendor → model → runtime/baseUrl wiring. This
// consolidated the previously-scattered MODEL_PRESETS / PROVIDER_CHOICES /
// BATCH_PRESETS / inline Path-A picker — all three create flows now use
// selectVendorAndModel() (B2) and the old structures were removed (B3).
// Vincent 4677+4679: "先选供应商，然后再选模型" — the create wizard is vendor-first.
//
// Every entry's baseUrl + model ids are verified-with-real-call before
// landing on @latest (feedback_vendor_verify_before_hardcode). The bar
// is "no unverified vendor reaches @latest users", not "no unverified
// vendor lands in source" — preview-first + UAT-before-promote means
// the verify step can happen during Vincent UAT on @preview, as long
// as it happens BEFORE promote to @latest.
//
// 2026-06-24 (通信龙 decision): DeepSeek added here on Vincent's request.
// Verify mode = UAT-before-promote (Vincent's UAT on his deepseek setup
// is the real-call verification). The verify-before-LATEST contract is
// still held — promote latest is gated on Vincent confirming the
// endpoint + both model ids respond. Previously-unverified GLM / Kimi
// remain in the `custom` vendor's catch-all until a similar UAT path
// covers them.

type VendorEnvKey = "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";

interface VendorModel {
  id: string;        // exact API model id (case-sensitive — the vendor's /v1/models is authoritative)
  label?: string;    // display label in the model picker; defaults to id
  default?: boolean; // preselected in the model picker
  // #259 Y (2026-06-25, real-call verified): true → model accepts image
  // content blocks via its Anthropic-compat endpoint. Wizard reads this
  // when writing the new node's config so the agent-node claude-agent-sdk
  // runtime knows whether to build the structured (AsyncIterable<
  // SDKUserMessage>) prompt with image blocks vs the warn-only fallthrough.
  // Defaults to false (legacy = text-only) for any model not explicitly
  // marked — verify-before-hardcode.
  imageCapable?: boolean;
}

interface Vendor {
  key: string;                  // stable key — also accepted by --preset for back-compat
  label: string;                // vendor picker label
  runtime: RuntimeName;         // claude-agent-sdk | codex-sdk | claude-code-cli
  baseUrl?: string;             // ANTHROPIC_BASE_URL value (omit = Anthropic-native / not applicable)
  envKey?: VendorEnvKey;        // which env var the API key goes into
  signupUrl?: string;           // "where to get a key" hint
  requiresAuth?: ReusedLogin;   // 复用哪种外部登录（不是 API key）。单一来源见 RUNTIME_REUSED_LOGIN
  models: VendorModel[];        // [] = freeform: ask the user for a model id (custom), or none (claude-code)
  freeformBaseUrl?: boolean;    // custom only: ask the user for the base URL
}

/**
 * Returns true when `modelId` matches a VENDORS entry marked
 * `imageCapable: true`. Used by the create wizard to plumb the
 * capability into a node's `flags.modelImageCapable` so agent-node's
 * claude-agent-sdk runtime knows whether to build the structured
 * AsyncIterable<SDKUserMessage> prompt with image content blocks
 * (vs the text-only warn-only fallthrough). Conservative default:
 * unknown / missing model → false. #259 Y.
 */
function isModelImageCapable(modelId: string | undefined): boolean {
  if (!modelId) return false;
  for (const v of VENDORS) {
    for (const m of v.models) {
      if (m.id === modelId) return m.imageCapable === true;
    }
  }
  return false;
}

const VENDORS: Vendor[] = [
  {
    // bare hostname, no /anthropic suffix (Vincent verified 2026-05-13 telegram 4227).
    // intern-s2-preview verified by 通信测试马 real-call 2026-05-14.
    key: "intern", label: "上海 AI Lab 书生 (Intern)",
    runtime: "claude-agent-sdk", baseUrl: "https://chat.intern-ai.org.cn",
    envKey: "ANTHROPIC_AUTH_TOKEN", signupUrl: "https://chat.intern-ai.org.cn/",
    models: [
      { id: "intern-s2-preview", label: "intern-s2-preview (默认)", default: true },
      { id: "intern-s1-pro" },
    ],
  },
  {
    // MiniMax-M3 image content block support verified real-call 2026-06-25 via
    // api.minimaxi.com/anthropic (returned correct color identification on an
    // 8×8 red PNG test, input_tokens=98 with cache_read=114 confirming the
    // image went through the vision pipeline — not silently dropped). M2.x
    // series is text-only per MiniMax docs; left in place as legacy option.
    key: "minimax", label: "MiniMax (国内直连，低成本)",
    runtime: "claude-agent-sdk", baseUrl: "https://api.minimaxi.com/anthropic",
    envKey: "ANTHROPIC_AUTH_TOKEN", signupUrl: "https://platform.minimaxi.com",
    models: [
      { id: "MiniMax-M3", label: "MiniMax-M3 (vision-capable, 默认)", default: true, imageCapable: true },
      { id: "MiniMax-M2.7", label: "MiniMax-M2.7 (text-only, legacy)" },
    ],
  },
  {
    // /anthropic suffix; Vincent 2026-06-24 ask, envKey + baseUrl pattern
    // mirrors MiniMax. Verified during UAT-before-promote (see header note);
    // a model-id correction (model-not-found at runtime) is a one-line
    // VENDORS edit if needed.
    key: "deepseek", label: "DeepSeek (国内直连，Anthropic 兼容)",
    runtime: "claude-agent-sdk", baseUrl: "https://api.deepseek.com/anthropic",
    envKey: "ANTHROPIC_AUTH_TOKEN", signupUrl: "https://platform.deepseek.com",
    models: [
      { id: "deepseek-v4-pro", default: true },
      { id: "deepseek-v4-flash" },
    ],
  },
  {
    // /anthropic suffix; verified by 通信SDK马 real-call 2026-05-15 (#104).
    key: "mimo", label: "小米 MiMo",
    runtime: "claude-agent-sdk", baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
    envKey: "ANTHROPIC_AUTH_TOKEN", signupUrl: "https://platform.xiaomimimo.com",
    models: [
      { id: "mimo-v2.5-pro", label: "mimo-v2.5-pro (默认)", default: true },
      { id: "mimo-v2.5" },
      { id: "mimo-v2-pro" },
      { id: "mimo-v2-omni" },
      { id: "mimo-v2.5-tts-voicedesign" },  // #193 — included in Vincent text-callable list (TTS family kept Phase 2)
    ],
  },
  {
    // All Claude 4.x family supports image content blocks natively on the
    // Anthropic API — well-known capability, no separate real-call verify
    // needed beyond the upstream Anthropic spec.
    key: "anthropic", label: "Anthropic Claude (官方 API)",
    runtime: "claude-agent-sdk", envKey: "ANTHROPIC_API_KEY",
    signupUrl: "https://console.anthropic.com",
    models: [
      { id: "claude-sonnet-4-6", default: true, imageCapable: true },
      { id: "claude-opus-4-6", imageCapable: true },
      { id: "claude-haiku-4-5", imageCapable: true },
    ],
  },
  {
    key: "codex", label: "Codex / GPT (海外，需 codex login)",
    runtime: "codex-sdk", requiresAuth: reusedLoginFor("codex-sdk"),
    models: [...CODEX_MODEL_CHOICES],
  },
  {
    // claude-code-cli uses the Claude Code subscription's model; no model picker.
    key: "claude-code", label: "Claude Code CLI (需 Claude Pro/Team/Max 订阅)",
    runtime: "claude-code-cli", requiresAuth: reusedLoginFor("claude-code-cli"),
    models: [],
  },
  {
    // honest home for any not-yet-verified Anthropic-compatible API.
    key: "custom", label: "自定义 — 任何 Anthropic 兼容 API (DeepSeek/GLM/Kimi/OpenRouter/自建)",
    runtime: "claude-agent-sdk", envKey: "ANTHROPIC_AUTH_TOKEN",
    freeformBaseUrl: true,
    models: [],
  },
];

interface VendorSelection {
  vendorKey: string;
  runtime: RuntimeName;
  model?: string;
  baseUrl?: string;
  envKey?: VendorEnvKey;
  signupUrl?: string;
  requiresAuth?: ReusedLogin;
}

// Resolve a vendor + model selection from a known vendor key (used by both the
// interactive helper below and the --preset / --runtime / --model flag path in
// B2). `modelOverride` lets a flag pin a specific model id without prompting.
function resolveVendorSelection(vendorKey: string, modelOverride?: string): VendorSelection | null {
  const vendor = VENDORS.find(v => v.key === vendorKey);
  if (!vendor) return null;
  const defaultModel = vendor.models.find(m => m.default)?.id || vendor.models[0]?.id;
  return {
    vendorKey: vendor.key,
    runtime: vendor.runtime,
    model: modelOverride || defaultModel,
    baseUrl: vendor.baseUrl,
    envKey: vendor.envKey,
    signupUrl: vendor.signupUrl,
    requiresAuth: vendor.requiresAuth,
  };
}

// Resolve a model id back to its vendor. Used by the --preset flag back-compat
// path (B2.3): the old --preset values were model ids (intern-s1-pro,
// MiniMax-M2.7, mimo-v2.5-pro, claude-sonnet-4-6, ...), not vendor keys.
function findVendorByModel(modelId: string): VendorSelection | null {
  for (const vendor of VENDORS) {
    if (vendor.models.some(m => m.id === modelId)) {
      return {
        vendorKey: vendor.key,
        runtime: vendor.runtime,
        model: modelId,
        baseUrl: vendor.baseUrl,
        envKey: vendor.envKey,
        signupUrl: vendor.signupUrl,
        requiresAuth: vendor.requiresAuth,
      };
    }
  }
  return null;
}

// Unified vendor-first interactive selection (issue #104-B): pick vendor →
// pick that vendor's model → runtime + baseUrl resolved from the registry.
// All three create flows migrate to this in B2. Returns null when the
// interactive picker is unavailable (non-TTY / inquirer load failure) so
// callers can fall back to their existing default-runtime behavior.
async function selectVendorAndModel(): Promise<VendorSelection | null> {
  let vendorKey: string;
  try {
    const { select: sel } = await import("@inquirer/prompts");
    vendorKey = await sel({
      message: "选择供应商 (vendor):",
      choices: VENDORS.map(v => ({ value: v.key, name: v.label })),
    });
  } catch (e: any) {
    console.log(`[anet] ⚠ Vendor selector unavailable: ${e?.message || e}`);
    return null;
  }
  const vendor = VENDORS.find(v => v.key === vendorKey);
  if (!vendor) return null;

  let baseUrl = vendor.baseUrl;
  if (vendor.freeformBaseUrl) {
    baseUrl = await ask("ANTHROPIC_BASE_URL (e.g. https://your-host/anthropic)") || "";
  }

  let model: string | undefined;
  if (vendor.models.length === 1) {
    model = vendor.models[0].id;
  } else if (vendor.models.length > 1) {
    // default-marked model sorted first so the picker preselects it.
    const ordered = [...vendor.models].sort((a, b) => (b.default ? 1 : 0) - (a.default ? 1 : 0));
    model = await askChoice(`选择 ${vendor.label} 模型:`,
      ordered.map(m => ({ label: m.label || m.id, value: m.id })));
  } else if (!vendor.requiresAuth) {
    // freeform model (custom): ask the user for an exact model id.
    model = (await ask("Model id")) || undefined;
  }
  // vendor.models.length === 0 && requiresAuth (claude-code) → no model picker.

  return {
    vendorKey: vendor.key,
    runtime: vendor.runtime,
    model,
    baseUrl,
    envKey: vendor.envKey,
    signupUrl: vendor.signupUrl,
    requiresAuth: vendor.requiresAuth,
  };
}

function maskSecretEnv(env: Record<string, any>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const isSecret = /TOKEN|KEY|SECRET|PASSWORD/i.test(key);
    // #135 v3 — env values can be envRef objects since #125 (e.g.
    // `{_envRef:"FOO"}`); render those as the indirection target so users
    // can see what env var they need to set, and never call .slice() on
    // an object (which threw TypeError before this defensive type check).
    if (value && typeof value === "object" && typeof value._envRef === "string") {
      masked[key] = `→ $${value._envRef}`;
      continue;
    }
    if (typeof value !== "string") {
      masked[key] = String(value);
      continue;
    }
    masked[key] = isSecret && value ? `${value.slice(0, 4)}...` : value;
  }
  return masked;
}

function printProfileSummary(id: string, profile: Profile) {
  const summary = {
    node_id: profile.node_id,
    node_name: nodeDisplayName(id, profile),
    runtime: normalizeRuntime(profile),
    model: profile.model || "(runtime default)",
    session: profileSession(profile) || "(new)",
    ...(profile.grokCopresence === true ? {
      grokCopresence: true,
      grokAttachSocket: profile.grokAttachSocket,
    } : {}),
    channels: profile.channels,
    env: maskSecretEnv(profile.env || {}),
    config: join(nodesDir(), id, "config.json"),
  };
  console.log(`\n[anet] Config summary:`);
  console.log(JSON.stringify(summary, null, 2));
}

/** Single source for both node-create picker paths on the canonical main line. */
function createRuntimeChoices() {
  return [
    { value: "claude-agent-sdk", name: "claude-agent-sdk — 任意 OpenAI/Anthropic-compat vendor (intern / MiniMax / Claude / GLM / ...)" },
    { value: "claude-code-cli", name: "claude-code-cli — Anthropic Claude (Max/Pro plan), 复用 `claude` CLI 登录态" },
    { value: "codex-sdk", name: "codex-sdk — OpenAI Codex, 复用 `codex login` 登录态" },
    { value: "codex-app-server", name: "codex-cli — Codex 共存 TUI（人和 Agent 共用一个 thread）" },
    { value: "grok-build-acp", name: "grok-build-acp — Grok Build ACP, 复用 `grok` CLI 登录态" },
    { value: "grok-build-cli", name: "grok-build-cli — Grok 共存 TUI（preview，仅可信任务）" },
    { value: "opencode-cli", name: "opencode-cli — 公版 OpenCode CLI, Anthropic/OpenAI preset (RFC-029)" },
  ];
}

/** #1469 f1 —— 「创建节点」的环境护栏，一处定义。
 *
 *  带名路径（`anet node create <name> --flags`）一直有这两道；而无名的交互向导
 *  在 `createCommand` 里被 `if (!id) return createInteractiveCommand()` 提前短路，
 *  从没走到它们。结果是**最傻瓜的新手入口反而设防最少**：起了 hub 但没跑过
 *  `anet init` 的用户被挡在「Run 'anet init' first」，而带名路径本会自探 127.0.0.1:9200。
 *
 *  抽成函数而不是把交互向导重构成走带名路径：向导是一份独立的 ~170 行实现，
 *  动它的流程风险远大于让两边共用同一道门。
 *
 *  带名路径的调用点保持在**原来的位置**，所以它的行为逐字不变。 */
async function ensureHubConfigured(gc: ReturnType<typeof loadGlobal>): Promise<ReturnType<typeof loadGlobal>> {
  if (!gc.hub) {
    try {
      const h = await fetch("http://127.0.0.1:9200/health").then(r => r.json() as any);
      if (h.ok) {
        gc.hub = "http://127.0.0.1:9200";
        saveGlobal(gc);
        console.log(`[anet] 检测到本地 CommHub: ${gc.hub}`);
      }
    } catch {}
  }
  if (!gc.hub) {
    console.error("未找到 CommHub Server。请先运行:\n  anet hub start\n\n或手动配置:\n  anet init --hub http://YOUR_IP:9200");
    process.exit(1);
  }
  return gc;
}

/** #1469 f1 —— 登录态 + 网络（#467 自选之后仍缺 network_id 的情形）。
 *
 *  交互路径以前会一路走到 `requestNodeToken`，那里是 `throw new Error("missing
 *  network_id; run: anet login")` —— 一个未捕获错误，用户看到的是堆栈而不是下一步。
 *  带名路径给的是可操作退出，这里让两边一致。 */
function ensureLoginAndNetwork(gc: ReturnType<typeof loadGlobal>): void {
  if (!gc.token) {
    console.error(`[anet] ❌ Not logged in. Run: anet login   (or: anet register)`);
    process.exit(1);
  }
  if (!gc.network_id) {
    console.error(`[anet] ❌ Global config is missing network_id; no unique writable network could be selected.`);
    console.error(`[anet]    Run: anet network ls`);
    console.error(`[anet]    Then: anet network use <name>`);
    process.exit(1);
  }
}

async function createInteractiveCommand() {
  // #1469 f1 —— 环境先验，再向用户要任何输入。
  //
  // 顺序是有意的，和带名路径同一条原则（那边的注释原话：「Check hub connection
  // BEFORE asking for model/key」）：hub 不通时先问厂商和 API key，用户粘完 key
  // 才被告知连不上，白费一轮输入。
  //
  // 这两道以前只有带名路径有 —— `if (!id) return createInteractiveCommand()`
  // 在 createCommand 里短路得比它们早，于是最傻瓜的入口设防最少。
  const gcPre = await ensureHubConfigured(loadGlobal());
  ensureLoginAndNetwork(gcPre);

  console.log(`
[anet] Create a node

This wizard creates one agent node for this project:
  - node config: .anet/nodes/<node-name>/config.json
  - runtime: claude-agent-sdk / claude-code-cli / codex-sdk / codex-app-server / grok-build-acp / grok-build-cli / opencode-cli
  - optional Telegram channel: text + images from an allowlist user
`);

  const id = await ask("Node name");
  if (!id) {
    closeRL();
    console.error("Error: node-name required");
    process.exit(1);
  }
  validateNodeName(id);
  if (resolveNodeRef(id)) {
    closeRL();
    console.error(`Node "${id}" already exists: .anet/nodes/${id}/config.json`);
    process.exit(1);
  }

  // #133 runtime-first wizard (Vincent 5101 实测 catch): pick runtime first;
  // only claude-agent-sdk goes through the vendor picker (it's the only
  // runtime that supports arbitrary OpenAI/Anthropic-compat vendors). Other
  // runtimes (claude-code-cli / codex-sdk) reuse their CLI's existing auth
  // and skip vendor selection entirely.
  const opts = parseOpts();
  let pickedRuntime: RuntimeName | null = null;
  try {
    const { select: sel } = await import("@inquirer/prompts");
    pickedRuntime = await sel({
      message: "选择 runtime:",
      choices: createRuntimeChoices(),
    }) as any;
  } catch (e: any) {
    console.log(`[anet] ⚠ Runtime selector unavailable: ${e?.message || e} — defaulting to claude-agent-sdk`);
    pickedRuntime = "claude-agent-sdk";
  }

  if (pickedRuntime === "claude-code-cli") {
    opts.runtime = "claude-code-cli";
    console.log(`[anet] 请确保已安装 Claude Code CLI 并登录: claude auth login`);
  } else if (pickedRuntime === "codex-sdk") {
    opts.runtime = "codex-sdk";
    console.log(`[anet] 请确保已执行: codex login`);
  } else if (pickedRuntime === "codex-app-server") {
    opts.runtime = "codex-app-server";
    opts.copresence = "true";
    console.log(`[anet] 请确保已执行: codex login （codex-app-server 需要 codex CLI）`);
    console.log(`[anet] 已选择 Codex 共存 TUI；以后运行 anet node start ${id} 即可启动或恢复`);
  } else if (pickedRuntime === "grok-build-acp" || pickedRuntime === "grok-build-cli") {
    opts.runtime = pickedRuntime;
    console.log(`[anet] 请确保已安装并登录 Grok Build CLI: grok login`);
    if (pickedRuntime === "grok-build-cli") printGrokCopresenceWarning(id, undefined, "configured");
  } else if (pickedRuntime === "opencode-cli") {
    await configureOpencodeRuntime(opts, true);
  } else {
    // claude-agent-sdk — flow continues into vendor + model picker.
    const sel = await selectVendorAndModel();
    if (sel) {
      opts.runtime = sel.runtime;
      if (sel.model) opts.model = sel.model;
      if (sel.baseUrl) opts._envs.push(`ANTHROPIC_BASE_URL=${sel.baseUrl}`);
      if (sel.envKey) {
        console.log(`
API key:
  Paste the API key/token for the selected vendor.${sel.signupUrl ? `
  📋 注册 / 拿 API Key: ${sel.signupUrl}` : ""}`);
        // #138 fix — same inquirer-stdin issue as Telegram prompts; use
        // inquirer input() to keep stdin handling uniform with the select()
        // call inside selectVendorAndModel above.
        let token: string;
        try {
          const { input: inquirerInput } = await import("@inquirer/prompts");
          token = (await inquirerInput({ message: sel.envKey })).trim();
        } catch {
          token = await ask(sel.envKey);
        }
        if (token) opts._envs.push(`${sel.envKey}=${token}`);
      }
      if (sel.requiresAuth === "codex") {
        console.log(`[anet] 请确保已执行: codex login`);
      } else if (sel.requiresAuth === "claude") {
        console.log(`[anet] 请确保已安装 Claude Code CLI 并登录: claude auth login`);
      }
    } else {
      // Non-TTY / inquirer unavailable — fall back to the default runtime so the
      // node is still created; the API key can be added later via config.json.
      console.log(`[anet] ⚠ vendor selector unavailable — defaulting to claude-agent-sdk runtime (add API key to config.json env later)`);
      opts.runtime = "claude-agent-sdk";
    }
  }

  const profile = await ensureNodeToken(createProfileFromOpts(id, opts), id);

  // #138 fix — @inquirer/prompts select() cleanup leaves process.stdin in a
  // state where the subsequent readline `ask()` doesn't keep the event loop
  // alive — process exits cleanly with code 0 mid-prompt before the user
  // can answer (zsh shows `%` artifact). Switch to inquirer `input()` for
  // the post-select() prompts so stdin handling is uniform with select().
  let addTelegram: string;
  try {
    const { input: inquirerInput } = await import("@inquirer/prompts");
    addTelegram = (await inquirerInput({
      message: "Add Telegram channel? (y/n)",
      default: "n",
    })).trim() || "n";
  } catch {
    // Non-TTY / inquirer unavailable — fall back to legacy readline ask().
    addTelegram = await ask("Add Telegram channel? (y/n)", "n");
  }
  let telegramConfig: { botToken: string; allowId: string } | null = null;
  if (/^y(es)?$/i.test(addTelegram)) {
    console.log(`
Telegram setup:
  1. Open Telegram and talk to @BotFather.
  2. Create a bot and copy the bot token.
  3. Talk to @userinfobot to get your numeric user ID.
`);
    // #138 fix — same inquirer-stdin issue as Add Telegram prompt above.
    let botToken: string;
    let allowId: string;
    try {
      const { input: inquirerInput } = await import("@inquirer/prompts");
      botToken = (await inquirerInput({ message: "Telegram Bot Token" })).trim();
      allowId = (await inquirerInput({ message: "Allow User ID (numeric ID from @userinfobot)", default: "" })).trim();
    } catch {
      botToken = await ask("Telegram Bot Token");
      allowId = await ask("Allow User ID (numeric ID from @userinfobot)", "");
    }
    if (!botToken) {
      closeRL();
      console.error("Error: Telegram Bot Token required");
      process.exit(1);
    }
    telegramConfig = { botToken, allowId };
    attachChannel(profile, "telegram");
  }

  closeRL();
  saveCreatedNode(id, profile);
  if (telegramConfig) {
    writeTelegramChannelConfig(id, telegramConfig.botToken, telegramConfig.allowId);
  }
  writeOpencodePresetIfRequested(id, profile, opts);
  checkRuntimeDependency(normalizeRuntime(profile), "create");

  console.log(`\n[anet] Created node "${id}" (${normalizeRuntime(profile)})`);
  if (telegramConfig) console.log(`[anet] ✅ Telegram channel added`);
  if (normalizeRuntime(profile) === "claude-code-cli") {
    printClaudeCodeNotice();
  }
  if (normalizeRuntime(profile) === "opencode-cli") {
    printOpencodeCreationSecurityDisclosure(profile);
  } else if (profile.grokCopresence === true) {
    printGrokCopresenceWarning(id, profile.tools, "configured");
  } else {
    console.log(`[anet] ⚠ dangerouslySkipPermissions and teammateMode enabled by default.`);
    console.log(`[anet] To disable: edit .anet/nodes/${id}/config.json → flags`);
  }
  printProfileSummary(id, loadProfile(id) || profile);
  console.log(`\nStart: anet node start ${id}`);
  // #135 v2 fix — let the dispatch-end exit handle clean shutdown (see top
  // of switch block at end of file). The preview.1 inline `process.exit(0)`
  // here was counterproductive: process.exit inside an async function leaves
  // the outer `await createCommand()` chain unsettled in a different way,
  // which is what Node v24 ESM strict mode actually warns about.
}

async function createCommand(idOverride?: string) {
  // Batch mode: `anet create --batch` enters the multi-node wizard
  // (issue #55, Vincent 4335). All other create flows fall through to the
  // existing single-node create path below.
  if (!idOverride && args.includes("--batch")) {
    // 🔴 --batch 向导的 runtime **只**来自 VENDORS 表(cli.ts 内 findVendorByModel /
    // resolveVendorSelection / selectVendorAndModel 三个入口全读它),而该表只能产出
    // claude-agent-sdk / claude-code-cli / codex-sdk。所以 --runtime 在这条路上
    // 会被**静默丢弃**,用户显式表达的意图无声消失,然后掉进一个表达不了该运行时的向导。
    // 与其丢弃,不如明说二者不能同用,并指向真正可用的写法(#765)。
    if (args.includes("--runtime")) {
      console.error(`\n  ❌ --batch 与 --runtime 不能同用。`);
      console.error(`\n     --batch 多节点向导的运行时只能来自内置 vendor 预设`);
      console.error(`     (claude-agent-sdk / claude-code-cli / codex-sdk),它无法表达`);
      console.error(`     opencode-cli、grok-build-acp、grok-build-cli、codex-app-server。`);
      console.error(`\n     要指定这些运行时,去掉 --batch,按单节点创建:`);
      console.error(`       anet node create <name> --runtime <runtime>\n`);
      process.exit(1);
    }
    return await createBatchWizardCommand();
  }
  const id = idOverride || args[1];
  if (!id) return createInteractiveCommand();
  if (id.startsWith("--")) {
    console.error("Usage: anet node create <node-name> [--runtime claude-agent-sdk|claude-code-cli|codex-sdk|codex-app-server|grok-build-acp|grok-build-cli|opencode-cli] [--model ...] [--tools ...]");
    console.error("Or run fully interactive: anet node create");
    process.exit(1);
  }
  validateNodeName(id);

  if (resolveNodeRef(id)) {
    console.error(`Node "${id}" already exists: .anet/nodes/${id}/config.json`);
    process.exit(1);
  }

  const opts = parseOpts();
  const gc = loadGlobal();

  // Preserve the user-facing alias's product meaning before strict runtime
  // normalization replaces it with the internal `codex-app-server` name.
  if (opts.runtime === "codex-cli" && opts.copresence === undefined) {
    opts.copresence = "true";
  }

  // ── Check hub connection BEFORE asking for model/key ──
  // 同一道门现在也用在交互向导上（#1469 f1）；调用点位置未变。
  await ensureHubConfigured(gc);

  // #133 runtime-first wizard (Vincent 5101 实测 catch): the old vendor-first
  // selector only enumerated claude-agent-sdk vendors, leaving users who want
  // claude-code-cli (Anthropic Max plan) or codex-sdk (OpenAI auth login)
  // implicitly stuck — they had to know to pass `--runtime codex-sdk` on the
  // CLI to skip the vendor picker. New flow: ask runtime first, then route:
  //   claude-agent-sdk → existing selectVendorAndModel() vendor picker
  //   claude-code-cli  → skip vendor entirely, print login hint
  //   codex-sdk        → skip vendor entirely, print login hint
  // Backward-compatible with explicit --runtime flag (skips the picker).
  const envFlagHasAuth = (opts._envs || []).some((e: string) =>
    e.startsWith("ANTHROPIC_AUTH_TOKEN=") || e.startsWith("ANTHROPIC_API_KEY=")
  );
  const credAlreadyProvided = !!process.env.ANTHROPIC_AUTH_TOKEN
    || !!process.env.ANTHROPIC_API_KEY || envFlagHasAuth;
  const explicitRuntime = opts.runtime
    ? runtimeForExecution(opts.runtime, "create node")
    : undefined;
  const runtimeAlreadyExplicit = explicitRuntime === "claude-agent-sdk"
    || explicitRuntime === "claude-code-cli"
    || explicitRuntime === "codex-sdk"
    || explicitRuntime === "codex-app-server"
    || explicitRuntime === "grok-build-acp"
    || explicitRuntime === "grok-build-cli"
    || explicitRuntime === "opencode-cli";

  // #133 selectRuntime — runtime-first, exported as a helper so create paths
  // (interactive single / batch wizard / sci-team demo) can share the picker.
  const selectRuntime = async (): Promise<RuntimeName | null> => {
    try {
      const { select: sel } = await import("@inquirer/prompts");
      const picked = await sel({
        message: "选择 runtime:",
        choices: createRuntimeChoices(),
      });
      return picked as any;
    } catch (e: any) {
      console.log(`[anet] ⚠ Runtime selector unavailable: ${e?.message || e}`);
      return null;
    }
  };

  // A pre-exported Anthropic credential must not suppress the runtime picker:
  // users still need to choose OpenCode before vendor credentials are used.
  if (!runtimeAlreadyExplicit && process.stdin.isTTY) {
    const runtime = await selectRuntime();
    if (runtime) opts.runtime = runtime;
  } else if (explicitRuntime) {
    opts.runtime = explicitRuntime;
  }

  // Per-runtime branching: vendor picker only for claude-agent-sdk; others skip.
  if (opts.runtime === "claude-code-cli") {
    console.log("[anet] 请确保已安装 Claude Code CLI 并登录: claude auth login");
  } else if (opts.runtime === "codex-sdk") {
    console.log("[anet] 请确保已执行: codex login");
  } else if (opts.runtime === "codex-app-server") {
    if (!runtimeAlreadyExplicit) opts.copresence = "true";
    console.log("[anet] 请确保已执行: codex login（codex-app-server 需要 codex CLI）");
  } else if (opts.runtime === "grok-build-acp" || opts.runtime === "grok-build-cli") {
    console.log("[anet] 请确保已安装并登录 Grok Build CLI: grok login");
    if (opts.runtime === "grok-build-cli") {
      // #1469 finding-3 — validate here too so a typo fails at the interactive
      // grok warning rather than passing through and only tripping at persist.
      const requestedTools = opts.tools ? parseAndValidateTools(opts.tools, "grok-build-cli") : undefined;
      printGrokCopresenceWarning(id, requestedTools, "configured");
    }
  } else if (opts.runtime === "opencode-cli") {
    await configureOpencodeRuntime(opts, Boolean(process.stdin.isTTY));
  } else {
    // Either claude-agent-sdk (explicit / picker-default) or undefined runtime
    // — fall through to vendor selection. credAlreadyProvided also skips since
    // demo paths pre-inject the env.
    if (!credAlreadyProvided && process.stdin.isTTY) {
      const sel = await selectVendorAndModel();
      if (sel) {
        opts.runtime = sel.runtime;
        if (sel.model) opts.model = sel.model;
        opts._envs = opts._envs || [];
        if (sel.baseUrl) opts._envs.push(`ANTHROPIC_BASE_URL=${sel.baseUrl}`);
        if (sel.envKey) {
          if (sel.signupUrl) console.log(`[anet] 没有 Key？去 ${sel.signupUrl} 注册并创建 API Key`);
          const key = await ask(`输入 API Key (${sel.vendorKey})`);
          if (key) opts._envs.push(`${sel.envKey}=${key}`);
        }
        if (sel.requiresAuth === "codex") {
          console.log("[anet] 请确保已执行: codex login");
        } else if (sel.requiresAuth === "claude") {
          console.log("[anet] 请确保已安装 Claude Code CLI 并登录: claude auth login");
        }
      } else {
        console.log(`[anet] ⚠ vendor selector unavailable — defaulting to claude-agent-sdk runtime`);
        opts.runtime = "claude-agent-sdk";
      }
    }
  }

  // Network selection. A headless bootstrap can safely recover a missing
  // network_id only when the authenticated user has exactly one writable
  // network. Multiple candidates are never guessed; interactive callers may
  // choose, while non-interactive callers get an actionable fail-closed error
  // below. This also repairs legacy/token-only global configs (#467).
  if (!opts.network && gc.token && gc.hub) {
    try {
      const nets = await fetch(`${gc.hub}/api/networks`, {
        headers: { Authorization: `Bearer ${gc.token}` },
      }).then(r => r.json() as any);
      const writable = (nets.networks || []).filter((n: any) => ["owner", "admin", "member"].includes(n.member_role));
      if (writable.length > 1 && process.stdin.isTTY) {
        // Multiple writable networks → interactive select
        try {
          const { select: sel } = await import("@inquirer/prompts");
          const roleIcon: Record<string, string> = { owner: "⭐", admin: "🔧", member: "👤" };
          const chosen = await sel({
            message: "选择网络:",
            choices: writable.map((n: any) => ({
              value: n.network_id,
              name: `${roleIcon[n.member_role] || " "} ${n.network_name} (${n.member_role})`,
            })),
            default: gc.network_id,
          });
          gc.network_id = chosen;
          gc.network_name = writable.find((n: any) => n.network_id === chosen)?.network_name;
          saveGlobal(gc);
        } catch {
          // inquirer not available, use current network
        }
      } else if (writable.length === 1 && !gc.network_id) {
        gc.network_id = writable[0].network_id;
        gc.network_name = writable[0].network_name;
        saveGlobal(gc);
      }
    } catch {}
  }

  // #1390 — --resume / --resume-latest imply claude-code-cli. The create
  // command used to gate its whole session-binding block on
  // runtime===claude-code-cli, so `anet node create X --resume <id>` WITHOUT
  // an explicit --runtime silently dropped --resume AND left the node on the
  // default claude-agent-sdk (user asked for A, got B). Decision extracted to
  // resolveRuntimeForResume (unit-tested, hub-free): infer claude-code-cli when
  // runtime is unset, fail loud on an explicit conflicting runtime.
  {
    const decision = resolveRuntimeForResume({
      resume: opts.resume,
      resumeLatest: opts["resume-latest"] === "true",
      session: opts.session,
      explicitRuntime: opts.runtime ? normalizeRuntime(opts.runtime) : "",
    });
    if (decision.conflictError) {
      console.error(`[anet] ❌ ${decision.conflictError}`);
      console.error(`[anet]    去掉 --runtime（会自动推断为 claude-code-cli），或去掉 --resume`);
      process.exit(1);
    }
    if (decision.inferredRuntime) {
      opts.runtime = decision.inferredRuntime;
      console.log(`[anet] --resume 推断 runtime=${decision.inferredRuntime}`);
    }
  }

  // #115 — bind an existing Claude session at create time (claude-code-cli only).
  // --resume <id> / --resume-latest for non-TTY scripts; interactive picker
  // otherwise. The chosen id goes into opts.session, which createProfileFromOpts
  // already consumes (`session: opts.session || randomUUID()`) — no schema change.
  if (normalizeRuntime(opts.runtime || "claude-agent-sdk") === "claude-code-cli" && !opts.session) {
    const wantLatest = opts["resume-latest"] === "true";
    const wantId = opts.resume && opts.resume !== "true" ? opts.resume : "";
    if (wantId && wantLatest) {
      console.error("[anet] --resume <id> 和 --resume-latest 不能同时使用");
      process.exit(1);
    }
    if (wantId) {
      if (!sessionFileExists(wantId)) {
        console.error(`[anet] ❌ session "${wantId}" 不在当前目录的 Claude project 里`);
        console.error(`[anet]    查看可用 session: anet session ls`);
        process.exit(1);
      }
      opts.session = wantId;
      console.log(`[anet] 绑定已有 Claude session: ${wantId.slice(0, 8)}…`);
    } else if (wantLatest) {
      const latest = listClaudeSessions()[0];
      if (!latest) {
        console.error("[anet] ❌ 当前目录没有可 resume 的 Claude session");
        process.exit(1);
      }
      opts.session = latest.id;
      console.log(`[anet] 绑定最近的 Claude session: ${latest.id.slice(0, 8)}… (${formatAge(latest.mtimeMs)})`);
    } else if (process.stdin.isTTY) {
      const picked = await pickClaudeSession(id);
      if (picked) {
        opts.session = picked;
        console.log(`[anet] 绑定已有 Claude session: ${picked.slice(0, 8)}…`);
      }
    } else if (opts.resume === "true") {
      // #1469 f4 —— 裸 `--resume`（无 id）在非 TTY 里没有任何拿到 id 的办法：
      // 选单要 TTY，--resume-latest 没打。以前会一路走到底、建出一个带全新
      // session 的节点 —— 用户打了 --resume 却没有 resume，且零警告。
      //
      // 只在**确实打了裸 --resume** 时报错：没打 resume 的 claude-code-cli
      // 创建在非 TTY 下建新 session 是既有的正确行为，不能被这条波及。
      console.error("[anet] ❌ --resume 没有给 session id，而当前不是交互终端，无法弹出选单");
      console.error("[anet]    脚本里请二选一：");
      console.error("[anet]      anet node create <name> --resume <session-id>");
      console.error("[anet]      anet node create <name> --resume-latest");
      console.error("[anet]    查看可用 session: anet session ls");
      process.exit(1);
    }
  }

  // #453 — an explicit claude-agent-sdk create may intentionally inherit its
  // vendor endpoint/credential from the current shell. Persist only the known
  // Anthropic-compatible keys into the existing envRef path so a fresh shell
  // can restart the node. Explicit --env values remain authoritative.
  try {
    opts._envs = collectClaudeVendorEnvForCreate({
      runtime: normalizeRuntime(opts.runtime || "claude-agent-sdk"),
      explicitEnv: opts._envs || [],
      shellEnv: process.env,
    });
  } catch (error) {
    console.error(`[anet] ❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const profile = createProfileFromOpts(id, opts);

  // Request a network token (ntok_) for this node — agent-node REQUIRES ntok_ for SSE.
  // No silent fallback to utok_; that just defers the failure to runtime.
  ensureLoginAndNetwork(gc);   // #1469 f1 —— 与交互向导共用同一道门；调用点位置未变
  let nodeTokenRes: any;
  try {
    nodeTokenRes = await fetch(`${gc.hub}/api/auth/node-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gc.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ network_id: gc.network_id, node_name: id, node_id: profile.node_id }),
    }).then(r => r.json() as any);
  } catch (e: any) {
    console.error(`[anet] ❌ Could not reach hub: ${e.message}`);
    console.error(`[anet]    Hub: ${gc.hub} — is it running? Try: anet hub start`);
    process.exit(1);
  }
  if (!nodeTokenRes.ok || !nodeTokenRes.token) {
    if (nodeTokenRes.error?.includes("invalid token")) {
      console.error(`[anet] ❌ Your login session has expired (server rotated the token).`);
      console.error(`[anet]    Run: anet login   then re-run: anet node create ${id}`);
    } else {
      console.error(`[anet] ❌ Could not create node token: ${nodeTokenRes.error || "unknown"}`);
    }
    process.exit(1);
  }
  profile.token = nodeTokenRes.token;  // ntok_ written into node config

  saveCreatedNode(id, profile);
  writeOpencodePresetIfRequested(id, profile, opts);
  checkRuntimeDependency(normalizeRuntime(profile), "create");

  const netLabel = gc.network_name || gc.network_id || "global";
  console.log(`\n[anet] Created node "${id}" (${normalizeRuntime(profile)}) in network "${netLabel}"`);
  // A headless codex-app-server node gets one line telling it how to become a
  // shared TUI. Hint only; nothing about the node changes.
  const codexHint = codexCopresenceCreateHint(
    normalizeRuntime(profile), opts.copresence, nodeDisplayName(id, profile),
  );
  if (codexHint) console.log(codexHint);
  if (profile.token?.startsWith("ntok_")) {
    console.log(`[anet] Network token assigned (node-level)`);
  }
  if (normalizeRuntime(profile) === "claude-code-cli") {
    printClaudeCodeNotice();
  }
  if (normalizeRuntime(profile) === "opencode-cli") {
    printOpencodeCreationSecurityDisclosure(profile);
  } else if (profile.grokCopresence === true) {
    printGrokCopresenceWarning(id, profile.tools, "configured");
    console.log(`[anet]   One command brings up the node and its shared TUI together.`);
    console.log(`\nStart: anet node start ${id} --copresence`);
    closeRL();
    if (process.env.ANET_INTERNAL_KEEP_PROCESS !== "1") process.exit(0);
    return;
  }
  // #101 user warning — surface the resolved toolset + dangerouslySkipPermissions
  // implication on every node create so users see what the agent can do before
  // they hand it real work. The earlier behavior printed only the flags warning
  // and left tools opaque.
  const toolsArr = Array.isArray(profile.tools) ? profile.tools : [];
  const toolsLabel = toolsArr.length
    ? `[${toolsArr.join(", ")}] (explicit allowlist)`
    : `all (Claude Code preset — WebFetch / WebSearch / Bash / Read / Write / Edit / Glob / Grep / Task / ...)`;
  console.log(`\n[anet] ⚠ Node created with default tool set:`);
  console.log(`[anet]    Built-in: ${toolsLabel}`);
  console.log(`[anet]    MCP:      commhub_send_task / send_message / send_reply / get_all_status / ...`);
  console.log(`[anet]    Flags:    dangerouslySkipPermissions=true (no per-call confirmation), teammateMode enabled`);
  console.log(`[anet]`);
  console.log(`[anet]    The agent can read/write files, run shell commands, and access the network.`);
  console.log(`[anet]    Make sure this is what you want for this agent's role.`);
  console.log(`[anet]`);
  console.log(`[anet]    Restrict tools:        edit .anet/nodes/${id}/config.json → "tools": ["Read","Bash",...]`);
  console.log(`[anet]    Disable auto-skip:     edit .anet/nodes/${id}/config.json → "flags.dangerouslySkipPermissions": false`);
  console.log(`[anet]    Inspect current set:   anet info ${id}`);
  console.log(`\nStart: anet node start ${id}`);
  closeRL();
  // Only exit if invoked directly from the CLI (top-level command). When called
  // from demoDebateCommand or other in-process orchestration, just return so
  // the caller can continue creating more nodes.
  if (process.env.ANET_INTERNAL_KEEP_PROCESS !== "1") {
    process.exit(0);
  }
}

// ── interactive prompt helper ──

import { createInterface } from "readline";
let _rl: ReturnType<typeof createInterface> | null = null;
function getRL() {
  if (!_rl) _rl = createInterface({ input: process.stdin, output: process.stdout });
  return _rl;
}
function closeRL() { if (_rl) { _rl.close(); _rl = null; } }

function ask(question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? ` [${defaultVal}]` : "";
  return new Promise(resolve => {
    getRL().question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

async function interactiveCreateProfile(id: string): Promise<Profile> {
  const gc = loadGlobal();
  console.log(`\nProfile "${id}" not found. Let's create it:\n`);

  const runtime = await ask("Runtime (claude-code / agent-sdk)", "claude-code") as "claude-code" | "agent-sdk";
  const alias = await ask("Alias", id);
  let model: string | undefined;
  let toolsArr: string[] = [];
  let channels: string[] = [];
  let teammateMode = "";

  if (runtime === "agent-sdk") {
    model = await ask("Model", "MiniMax-M2.7");
    const toolsStr = await ask("Tools (comma-separated)", "Read,Bash,Grep");
    toolsArr = toolsStr.split(",").map(s => s.trim()).filter(Boolean);
  } else {
    const channelsStr = await ask("Channels (comma-separated)", "server:commhub");
    channels = channelsStr.split(",").map(s => s.trim()).filter(Boolean);
    teammateMode = await ask("Teammate mode", "in-process");
  }

  const envStr = await ask("Extra env (K=V, comma-separated, empty to skip)");

  const envMap: Record<string, string> = {};
  if (envStr) {
    for (const e of envStr.split(",")) {
      const eq = e.trim().indexOf("=");
      if (eq > 0) envMap[e.trim().slice(0, eq)] = e.trim().slice(eq + 1);
    }
  }

  const hub = gc.hub; // already validated above

  let profile: Profile = {
    anet_version: "0.0.23",
    node_id: generateNodeId(),
    node_name: alias,
    name: alias,
    alias,
    hub,
    runtime,
    ...(model ? { model } : {}),
    ...(toolsArr.length ? { tools: toolsArr } : {}),
    channels,
    env: envMap,
    flags: {
      // Per-runtime defaults — same split as the non-interactive path above
      // (Vincent 2026-06-24 via 通信龙: agent-sdk = permissionMode only,
      // others = dangerouslySkipPermissions only). The interactive wizard
      // uses a short alias type ("agent-sdk") for `runtime` here, not the
      // canonical "claude-agent-sdk" the non-interactive path sees.
      ...(runtime === "agent-sdk"
        ? { permissionMode: "auto" }
        : { dangerouslySkipPermissions: true }),
      // #259 Y — same image-capable plumbing as the non-interactive path.
      ...(runtime === "agent-sdk" && isModelImageCapable(model)
        ? { modelImageCapable: true }
        : {}),
      ...(teammateMode ? { teammateMode } : {}),
    },
  };

  profile = await ensureNodeToken(profile, id);
  saveProfile(id, profile);
  closeRL();
  console.log(`\n✅ Profile "${id}" saved\n`);
  return profile;
}

// ── ensure .mcp.json has commhub server ──

function ensureMcpJson(profile: Profile) {
  // #245 codex-sdk fix — widened gate (was claude-code-cli only).
  //
  // Both claude-code-cli and codex-sdk runtimes need `.anet/node-server.js`
  // (the in-process commhub MCP stdio server) refreshed + the @modelcontextprotocol/sdk
  // dependency self-healed. The difference is the discovery mechanism:
  //   * claude-code-cli reads cwd `.mcp.json` and finds commhub there
  //   * codex-sdk reads `~/.codex/config.toml [mcp_servers.*]` and CANNOT use
  //     `.mcp.json` (TMCode负责人 459d1b6c diagnostic confirmed). For codex-sdk
  //     anet-node passes a `mcp_servers.commhub` override via the Codex SDK's
  //     `CodexOptions.config` (per-instance, in-memory) — see agent-node/src/cli.ts
  //     `CODEX_CONFIG.mcp_servers` block. That override points at the same
  //     `.anet/node-server.js`, so we still need to keep it fresh on this side.
  //
  // grok-build-cli uses the same artifact through its runtime-owned native
  // Grok config; it never adopts the project's `.mcp.json`.
  // claude-agent-sdk and grok-build-acp do NOT use cwd .anet/node-server.js
  // (they inject in-process via createCommhubSdkMcpServer at agent-node), so
  // they keep the early-return.
  const runtime = normalizeRuntime(profile);
  if (runtime !== "claude-code-cli" && runtime !== "codex-sdk" && runtime !== "grok-build-cli") return;
  if (!profile.channels?.some(ch => ch.includes("commhub"))) return;

  const mcpJsonPath = join(process.cwd(), ".mcp.json");
  let mcpConfig: any = {};
  if (existsSync(mcpJsonPath)) try { mcpConfig = JSON.parse(readFileSync(mcpJsonPath, "utf-8")); } catch {}

  // Always update .anet/node-server.js from npm package (keep in sync)
  const anetDir = join(process.cwd(), ".anet");
  const serverTs = join(anetDir, "node-server.js");
  // 查找 node-server.ts 源文件——混淆后路径可能变，多个候选
  const selfDir = typeof import.meta.url === "string" ? fileURLToPath(new URL(".", import.meta.url)) : __dirname || "";
  const argv1Dir = process.argv[1] ? join(process.argv[1], "..") : "";
  const candidates = [
    // dist/src/node-server.js（npm 包混淆后产物，优先）
    join(selfDir, "..", "src", "node-server.js"),
    join(selfDir, "..", "..", "dist", "src", "node-server.js"),
    join(argv1Dir, "..", "src", "node-server.js"),
    join(argv1Dir, "..", "..", "dist", "src", "node-server.js"),
    // src/node-server.ts（开发环境源码）
    join(selfDir, "..", "..", "src", "node-server.ts"),
    join(selfDir, "..", "src", "node-server.ts"),
    join(selfDir, "src", "node-server.ts"),
    join(argv1Dir, "..", "src", "node-server.ts"),
    join(argv1Dir, "..", "..", "src", "node-server.ts"),
    // npm global install fallback
    ...((() => { try { const root = execSync("npm root -g", { encoding: "utf-8", timeout: 5000 }).trim(); return [join(root, "@sleep2agi", "agent-network", "dist", "src", "node-server.js"), join(root, "@sleep2agi", "agent-network", "src", "node-server.ts")]; } catch { return []; } })()),
  ];
  let found = false;
  for (const p of candidates) {
    if (existsSync(p)) {
      mkdirSync(anetDir, { recursive: true });
      // 🔴 issue #1216, second writer. The candidate list below falls back to
      // `.ts` sources (a source checkout has no dist/), and the target is
      // always `.js` — bun picks its parser from the extension, so copying
      // verbatim produced a file that could not be parsed. #1227 fixed the
      // *other* resolver in this same file (`refreshNodeServerJsAt`); that one
      // only runs for `grok-build-acp`, so this path — which serves
      // claude-code-cli, codex-sdk and grok-build-cli — kept writing
      // TypeScript and kept failing three layers later as
      // "CommHub MCP readiness preflight failed (1)".
      const src = nodeServerPayloadFor(readFileSync(p, "utf-8"), p, ambientTypeScriptTranspiler());
      const dst = existsSync(serverTs) ? readFileSync(serverTs, "utf-8") : "";
      if (src !== dst) {
        writeFileSync(serverTs, src);
        console.log(`[anet] Updated .anet/node-server.js`);
      }
      found = true;
      break;
    }
  }
  if (!found && !existsSync(serverTs)) {
    console.warn(`[anet] ⚠ Cannot find node-server.ts source. CommHub channel may not work.`);
    console.warn(`[anet] Fix: npm install -g @sleep2agi/agent-network@latest`);
  }

  // Ensure .anet/package.json exists
  const pkgJson = join(anetDir, "package.json");
  if (!existsSync(pkgJson)) {
    mkdirSync(anetDir, { recursive: true });
    writeFileSync(pkgJson, JSON.stringify({
      "private": true,
      "dependencies": { "@modelcontextprotocol/sdk": "^1.12.0" }
    }, null, 2) + "\n");
  }

  // #245 — commhub MCP dependency integrity self-heal.
  // node-server.js imports @modelcontextprotocol/sdk subpaths at startup. A
  // partial/corrupt install (e.g. only dist/ present, subpath exports missing —
  // a disk-cleanup / node_modules corruption side-effect) crashes the MCP server
  // BEFORE any tool registers: the node looks alive but ALL commhub_* tools
  // silently vanish. The old code only installed when package.json was absent,
  // so a corrupt node_modules went unrepaired, and the install error was
  // swallowed. Probe the real import every start; reinstall if broken; fail
  // LOUD (not silent) if still broken.
  const sdkImportable = (): boolean => {
    try {
      execSync(
        `bun -e "import('@modelcontextprotocol/sdk/server/index.js').then(()=>process.exit(0)).catch(()=>process.exit(3))"`,
        { cwd: anetDir, stdio: "pipe", timeout: 15000 },
      );
      return true;
    } catch { return false; }
  };
  if (!sdkImportable()) {
    console.warn(`[anet] commhub MCP dependency missing or partial — repairing (bun install in .anet) ...`);
    try {
      execSync("bun install", { cwd: anetDir, stdio: "pipe", timeout: 120000 });
    } catch (e: any) {
      console.error(`[anet] ⚠ bun install in .anet failed: ${e?.message || e}`);
    }
    if (sdkImportable()) {
      console.log(`[anet] ✓ commhub MCP dependency repaired.`);
    } else {
      console.error(`[anet] ❌ commhub MCP dependency (@modelcontextprotocol/sdk) still broken in .anet/node_modules.`);
      console.error(`[anet]    → The commhub channel will NOT load (no commhub_* tools). Other features still work.`);
      console.error(`[anet]    → Fix manually:  cd "${anetDir}" && bun install   (then restart the node)`);
    }
  }

  // Write .anet/.env (hub URL + token) — both runtimes need this; node-server.js
  // reads COMMHUB_URL / COMMHUB_TOKEN from this file when spawned as a stdio MCP.
  const anetEnvPath = join(anetDir, ".env");
  const token = profile.token || "";
  let envContent = `COMMHUB_URL=${profile.hub || "http://127.0.0.1:9200"}\n`;
  if (token) envContent += `COMMHUB_TOKEN=${token}\n`;
  atomicWritePrivateFile(anetEnvPath, envContent);

  // #245 codex-sdk fix — only write `.mcp.json` for claude-code-cli. codex-sdk
  // does not read cwd `.mcp.json`; it reads `~/.codex/config.toml [mcp_servers.*]`
  // (or accepts a `CodexOptions.config` override from agent-node, which is the
  // path this fix uses). Writing `.mcp.json` for codex-sdk would be a silent
  // no-op + confuse anyone reading the file expecting it to work.
  if (runtime === "claude-code-cli") {
    mcpConfig.mcpServers = mcpConfig.mcpServers || {};
    mcpConfig.mcpServers.commhub = { type: "stdio", command: "bun", args: [".anet/node-server.js"] };
    writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    console.log(`[anet] .mcp.json: added commhub channel server`);
  }
}

// ── launch helper (shared by start + resume) ──

/**
 * `anet grok model <node> <model>` — switch a co-presence node's model
 * without a keystroke crossing the composer gate (issue #879).
 *
 * The human in the TUI cannot do this: `/model` is refused by the gate, and
 * Grok's `Ctrl+M` picker shares a byte with Enter. This opens a *control*
 * connection to the node's attach socket instead — one that may ask for a
 * model switch and may not type — so it works while somebody is attached.
 */
async function grokModelCommand(ref: string | undefined, model: string | undefined) {
  if (!ref || ref.startsWith("--") || !model || model.startsWith("--")) {
    console.error("Usage: anet grok model <node> <model>");
    process.exit(1);
  }
  const resolved = resolveNodeRef(ref);
  if (!resolved) {
    console.error(nodeNotFound(ref));
    process.exit(1);
  }
  const { id: nodeId, profile } = resolved;
  const target = resolveGrokAttachTarget({
    runtime: normalizeRuntime(profile),
    grokCopresence: profile.grokCopresence,
    grokAttachSocket: profile.grokAttachSocket,
  });
  if (!target.ok) {
    console.error(`[anet] Node "${nodeDisplayName(nodeId, profile)}" has no co-presence attach socket.`);
    process.exit(1);
  }

  // No TTY is needed or wanted: this connection never carries terminal bytes.
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  type Verdict = { ok: boolean; text: string };
  let settle: (verdict: Verdict) => void;
  const outcome = new Promise<Verdict>((resolveOutcome) => { settle = resolveOutcome; });
  let settled = false;
  // First verdict wins: an error frame and a refusal status can both arrive,
  // and reporting the second one would describe a failure that already had an
  // answer.
  const finish = (ok: boolean, text: string) => {
    if (settled) return;
    settled = true;
    settle({ ok, text });
  };

  let session: Awaited<ReturnType<typeof connectGrokAttach>> | undefined;
  try {
    session = await connectGrokAttach({
      socketPath: target.socketPath,
      input,
      output,
      handshakeTimeoutMs: 5_000,
      onStatus: (frame) => {
        const status = frame.status as { modelSwitch?: { ok?: boolean; model?: string; code?: string; message?: string } } | null;
        const result = status?.modelSwitch;
        // Status frames arrive for every state change; only the ones carrying
        // a modelSwitch verdict answer this command.
        if (!result) return;
        if (result.ok) finish(true, `[anet] ${nodeDisplayName(nodeId, profile)} is switching to ${result.model}; the TUI restarts on the same session.`);
        else finish(false, `[anet] refused (${result.code}): ${result.message}`);
      },
      onError: (error) => finish(false, `[anet] ${error.message}`),
    });
    session.setModel(model);
    const verdict = await Promise.race([
      outcome,
      new Promise<{ ok: boolean; text: string }>((resolveTimeout) => setTimeout(
        () => resolveTimeout({ ok: false, text: "[anet] the node did not report a result within 20s" }),
        20_000,
      )),
    ]);
    console[verdict.ok ? "log" : "error"](verdict.text);
    session.detach();
    await session.closed.catch(() => {});
    process.exit(verdict.ok ? 0 : 1);
  } catch (error) {
    console.error(`[anet] grok model: ${error instanceof Error ? error.message : String(error)}`);
    try { session?.detach(); } catch {}
    process.exit(1);
  }
}

async function grokCommand() {
  if (args[1] === "model") {
    await grokModelCommand(args[2], args[3]);
    return;
  }
  if (args[1] !== "attach") {
    console.error("Usage: anet grok attach <node> | anet grok model <node> <model>");
    process.exit(1);
  }

  const ref = args[2];
  if (!ref || ref.startsWith("--")) {
    console.error("Usage: anet grok attach <node>");
    process.exit(1);
  }
  const resolved = resolveNodeRef(ref);
  if (!resolved) {
    // #1402 — attach resolves nodes by the CURRENT directory's .anet/nodes.
    // The old message ("Create it first") was actively harmful: the node the
    // user wants to attach is usually already created in its project directory
    // and online, so following "create" builds a duplicate or collides on the
    // tmux / attach session. Explain the cwd-scoped resolution instead, show
    // what IS visible here, and only mention create as a guarded last resort.
    const visibleHere = listProfileIds();
    console.error(`[anet] 在当前目录找不到节点 "${ref}"。`);
    console.error(`[anet] anet grok attach 按**当前目录**的 .anet/nodes 解析节点（cwd=${process.cwd()}）。`);
    if (visibleHere.length) {
      console.error(`[anet] 这里可见的节点：${visibleHere.join(", ")}`);
    } else {
      console.error(`[anet] 当前目录的 .anet/nodes 下没有任何节点。`);
    }
    console.error(`[anet] 若它是在别的项目目录创建的（attach 的常见情况），先 cd 到那个目录再 attach。`);
    console.error(`[anet] 用 anet node ls 看当前目录能见的节点；只有确认它确实还不存在，才用：anet node create ${shellQuote(ref)} --runtime grok-build-cli`);
    process.exit(1);
  }
  const { id: nodeId, profile } = resolved;
  const attachTarget = resolveGrokAttachTarget({
    runtime: normalizeRuntime(profile),
    grokCopresence: profile.grokCopresence,
    grokAttachSocket: profile.grokAttachSocket,
  });
  if (!attachTarget.ok) {
    if (attachTarget.reason === "not_grok_build_cli") {
      console.error(`[anet] Node "${nodeDisplayName(nodeId, profile)}" is not a grok-build-cli node.`);
    } else if (attachTarget.reason === "headless") {
      console.error(`[anet] Node "${nodeDisplayName(nodeId, profile)}" uses legacy headless grok-build-cli mode.`);
      console.error(`[anet] Create a new grok-build-cli node or migrate its config explicitly.`);
    } else {
      console.error(`[anet] Node config is missing an absolute grokAttachSocket; refusing to guess the bridge identity.`);
    }
    process.exit(1);
  }
  const socketPath = attachTarget.socketPath;
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    console.error("[anet] grok attach requires an interactive TTY on stdin and stdout.");
    process.exit(1);
  }

  printGrokCopresenceWarning(undefined, profile.tools, "resume");
  // #1412 —— 用**备用屏幕**（alternate screen）承载整个 attach 会话。
  //
  // 症状：detach 之后屏幕定格在断开前那一帧，用户以为还连着、继续打字，
  // 而输入根本没到 runtime（节点日志里没有新记录）。这是"以为还连着"这类
  // 误解里最贵的一种 —— 它看起来完全像一个活着的会话。
  //
  // 进备用屏幕之后，终端会在 detach 时**把 attach 之前的画面原样还回来**，
  // 而不是留下一屏死掉的 TUI；也不需要粗暴 clear 掉用户自己的 scrollback。
  // 这是所有全屏 TUI（vim / less / tmux）的标准做法。
  // 上面已强制要求 stdin/stdout 都是 TTY，所以这里不必再判。
  //
  // 与 #1414 的黑屏修复正交：那一条在**服务端**（attach 后首次 resize 做一次
  // 一行抖动，强制 grok 全量重画）；这一条只管**客户端终端**在断开后的恢复。
  process.stdout.write("\u001b[?1049h");
  const relay = new PassThrough({ highWaterMark: 64 * 1024 });
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw === true;
  const wasPaused = stdin.isPaused();
  let session: Awaited<ReturnType<typeof connectGrokAttach>> | undefined;
  let restored = false;
  let detaching = false;

  const restoreTerminal = () => {
    if (restored) return;
    restored = true;
    stdin.off("data", onInput);
    relay.off("drain", onRelayDrain);
    try { stdin.setRawMode(wasRaw); } catch {}
    if (wasPaused) stdin.pause();
    else stdin.resume();
    // 回到主屏幕：attach 之前的画面被终端还原，断开前那一帧不会留下。
    // 然后在**主屏幕**上明确说一句已断开 —— 否则用户只看到画面变了，
    // 不知道是断开了还是崩了。
    process.stdout.write("\u001b[?1049l");
    process.stdout.write(`[anet] detached from Grok TUI "${nodeDisplayName(nodeId, profile)}" — reattach: anet grok attach ${shellQuote(nodeId)}\n`);
  };
  const requestDetach = () => {
    if (detaching) return;
    detaching = true;
    stdin.pause();
    session?.detach();
  };
  const onRelayDrain = () => stdin.resume();
  const onInput = (chunk: Buffer | string) => {
    if (detaching) return;
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    const escape = bytes.indexOf(0x1d); // Ctrl-] is local-only.
    const forward = escape === -1 ? bytes : bytes.subarray(0, escape);
    if (forward.length > 0 && !relay.write(forward)) stdin.pause();
    if (escape !== -1) requestDetach();
  };
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGQUIT", "SIGTERM", "SIGHUP"];

  try {
    session = await connectGrokAttach({
      socketPath,
      input: relay,
      output: process.stdout,
      signalSource: process,
      terminalSize: () => ({ cols: process.stdout.columns, rows: process.stdout.rows }),
      detachOnInputEnd: true,
      onHello: (hello) => {
        process.stderr.write(
          `[anet] attached to Grok TUI "${hello.alias}" session ${hello.sessionId.slice(0, 8)}… (detach: Ctrl-])\r\n`,
        );
      },
      onError: (error) => process.stderr.write(`[anet] grok attach: ${error.message}\r\n`),
    });

    for (const signal of signals) process.once(signal, requestDetach);
    stdin.setRawMode(true);
    stdin.on("data", onInput);
    relay.on("drain", onRelayDrain);
    stdin.resume();

    const closed = await session.closed;
    if (closed.error) throw closed.error;
  } finally {
    for (const signal of signals) process.off(signal, requestDetach);
    restoreTerminal();
    session?.detach();
    relay.end();
  }
}

// #245 task E — detect channel plugin failures in the latest node log and
// surface an actionable warning before launchAgent re-spawns claude. The
// channel-plugin lifecycle is entirely inside Claude Code (anet only passes
// `--channels ...` args); a failed plugin caches its failure in the running
// claude process's in-memory state, and `--resume <uuid>` inherits that
// cache instead of re-attempting the channel. Only a full process restart
// (anet node stop && start) clears the cache; --resume <uuid> on the fresh
// process still loads conversation history from disk.
//
// This warn is diagnostic-only: it does NOT block launch, change args, or
// alter Claude's session UUID. It just tells the user "if you're confused
// why your telegram channel still isn't connecting after `anet channel add`,
// here's why and here's the fix."
function maybeWarnChannelResumeBlocker(
  nodeId: string,
  profile: Profile,
): void {
  try {
    // Only relevant when the profile declares telegram (the only
    // currently-shipped plugin channel; if more land, extend this list).
    if (!profile.channels.includes("telegram")) return;

    // Tail the most recent log; if it shows a channel-plugin failure
    // pattern, the user is the failure-window user the warn targets.
    const logsDir = join(nodesDir(), nodeId, "logs");
    if (!existsSync(logsDir)) return;
    const logs = readdirSync(logsDir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => ({ name: f, mtime: statSync(join(logsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (logs.length === 0) return;
    const latestLog = join(logsDir, logs[0].name);

    // Tail ~200 lines (cheap, bounded).
    const content = readFileSync(latestLog, "utf-8");
    const tail = content.split("\n").slice(-200).join("\n");
    const FAILURE_PATTERNS = [
      /TELEGRAM_BOT_TOKEN required/i,
      /TELEGRAM_BOT_TOKEN.*missing/i,
      /channel.*failed to (?:start|load|attach)/i,
      /plugin.*exited/i,
      /MCP server.*exited/i,
    ];
    const failureHit = FAILURE_PATTERNS.some((p) => p.test(tail));
    if (!failureHit) return;

    // Additional signal: user has since added the token (otherwise the
    // warn would suggest stop+start that would just fail the same way).
    // Check both possible token locations: per-node .env and the channel
    // access.json (anet channel add writes one or both).
    const nodeEnv = join(nodesDir(), nodeId, ".env");
    const channelDir = join(nodesDir(), nodeId, "channels", "telegram");
    const hasNodeEnv = existsSync(nodeEnv) &&
      /TELEGRAM_BOT_TOKEN=/.test(readFileSync(nodeEnv, "utf-8"));
    const hasChannelState = existsSync(channelDir);
    if (!hasNodeEnv && !hasChannelState) return;

    console.warn(`[anet] ⚠ telegram channel 上次启动失败 — resume 不会重连`);
    console.warn(`[anet]   Claude Code 把 channel plugin 启动失败缓存在当前进程的内存里, --resume 同 session 会继承这个缓存, 不会再 attempt 这个 channel.`);
    console.warn(`[anet]`);
    console.warn(`[anet]   修复 (conversation history 完整保留):`);
    console.warn(`[anet]     anet node stop ${shellQuote(nodeId)} && anet node start ${shellQuote(nodeId)}`);
    console.warn(`[anet]`);
    console.warn(`[anet]   新 Claude 进程会从头 attempt 每个 channel, 同时 --resume <session-uuid> 加载已有 conversation 不丢.`);
    console.warn(`[anet]   (failure pattern matched in ${logs[0].name}; see \`anet channel status ${shellQuote(nodeId)}\` for state.)`);
  } catch {
    // Pure diagnostic — if anything throws (missing log, permission denied,
    // etc.), silently skip. Never let the warn path block a launch.
  }
}

async function launchAgent(id: string, forceNewSession = false, hubOverride?: string, admittedGeneration?: string) {
  const launchResolved = resolveNodeRef(id);
  if (!launchResolved) throw new Error(`Node ${JSON.stringify(id)} not found`);
  const launchGeneration = admittedGeneration || await admitNodeStart(launchResolved.id, Date.now());
  const resolved = resolveNodeRef(id);
  if (!resolved) {
    console.error(`Node "${id}" not found. Create it first: anet node create ${id}`);
    process.exit(1);
  }
  const nodeId = resolved.id;
  let profile: Profile;
  let runtime: RuntimeName;
  try {
    ({ profile, runtime } = resolveStartProfile(nodeId, resolved.profile));
  } catch (error: any) {
    console.error(`[anet] Refusing to start node ${JSON.stringify(nodeId)}: ${error?.message || error}`);
    process.exit(1);
  }
  // Keep the resolved persisted profile separate from the per-launch view.
  // A legacy config may need its canonical node_id repaired below; that write
  // must not accidentally bake a transient --hub override into config.json.
  const persistedProfile = profile;
  // #467 — an explicit command-line hub is a per-launch override. Keep it
  // transient (do not rewrite the node profile), but apply it before MCP
  // materialisation and child-env construction so every runtime observes the
  // same endpoint. CLI flags conventionally outrank persisted config.
  if (hubOverride) profile = { ...profile, hub: hubOverride };
  const displayName = nodeDisplayName(nodeId, profile);
  const session = profileSession(profile);
  const willResume = !!session && !forceNewSession;
  // #1130 —— 已经在跑的节点不起第二个:第二个进程会接管 alias,退出时把它报成 offline,
  //   原进程还活着而 hub 从此不再推送。`anet project up` 早就 skip already-running,这里对齐。
  //   pid 会被复用,所以除了 kill -0 还要看那个 pid 的命令行是不是 agent-node(读不到就按活着处理)。
  {
    const pidFile = join(nodesDir(), nodeId, ".pid");
    const running = runningNodePid({
      pidFileContent: existsSync(pidFile) ? readFileSync(pidFile, "utf-8") : null,
      isAlive: (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } },
      commandOf: (pid) => {
        try { return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
      },
    });
    if (running !== null) {
      for (const line of alreadyRunningMessage(displayName, running)) console.error(line);
      process.exit(1);
    }
  }
  const label = willResume ? `Resuming session ${session.slice(0, 8)}...` : "Starting new session";
  console.log(`[anet] ${label} for "${displayName}" [${runtime}]...\n`);
  if (profile.grokCopresence === true) {
    printGrokCopresenceWarning(nodeId, profile.tools, willResume ? "resume" : "new");
  }
  checkRuntimeDependency(runtime, "start");
  assertStartCompatibility(runtime);

  // Prepare the local commhub stdio artifact. grok-build-cli consumes it from
  // its isolated GROK_HOME and still refuses every project/host MCP config.
  ensureMcpJson(profile);

  // Token already merged in loadProfile: project > global.
  // SSE requires a network-scoped token (ntok_); utok_ leftovers from older
  // versions cause cryptic "SSE 401" loops, so reject them up-front.
  const token = profile.token || "";
  if (!token) {
    console.error(`[anet] ❌ Node config has no token but SSE needs ntok_.`);
    console.error(`[anet]    Run \`anet doctor --fix\` to repair (re-requests ntok_ from hub).`);
    console.error(`[anet]    Or recreate manually:`);
    console.error(`[anet]      anet node delete ${nodeId}`);
    console.error(`[anet]      anet node create ${nodeId}`);
    process.exit(1);
  }
  if (token.startsWith("utok_") || token.startsWith("atok_")) {
    const prefix = token.slice(0, 4);
    console.error(`[anet] ❌ Node config has a ${prefix}_ token but SSE needs ntok_.`);
    console.error(`[anet]    Run \`anet doctor --fix\` to repair (re-requests ntok_ from hub).`);
    console.error(`[anet]    Or recreate manually:`);
    console.error(`[anet]      anet node delete ${nodeId}`);
    console.error(`[anet]      anet node create ${nodeId}`);
    process.exit(1);
  }
  if (runtime === "grok-build-cli") {
    console.log(`[anet] Token: configured (${token.startsWith("ntok_") ? "node" : "custom"})`);
  } else {
    console.log(`[anet] Token: ${token.slice(0, 8)}...`);
  }

  // Fix 1 (#146 / RFC-018) — ensure node_id is persisted in the raw config.
  // resume_id is derived from node_id (agent-node: sdk-<node_id>; claude-code-
  // cli: COMMHUB_RESUME_ID=cc-<node_id>, set in the claude branch below).
  // normalizeStoredProfile fills a missing node_id in memory only — a legacy
  // raw config without it would let the value drift (legacyNodeId is keyed on
  // the dir name, which a rename changes). Persist the canonical id once.
  try {
    const rawCfgPath = join(nodesDir(), nodeId, "config.json");
    const rawCfg = JSON.parse(readFileSync(rawCfgPath, "utf-8"));
    if (!rawCfg.node_id && profile.node_id) {
      saveProfile(nodeId, persistedProfile);
      console.log(`[anet] persisted canonical node_id ${profile.node_id} (legacy config had none).`);
    }
  } catch {}

  if (
    runtime === "codex-sdk" ||
    runtime === "codex-app-server" ||
    runtime === "claude-agent-sdk" ||
    runtime === "grok-build-acp" ||
    runtime === "grok-build-cli" ||
    runtime === "opencode-cli"
  ) {
    // spawn agent-node
    const agentArgs = [
      "--config", join(nodesDir(), nodeId, "config.json"),
      "--alias", displayName,
      "--runtime", runtime,
    ];
    if (forceNewSession) agentArgs.push("--new-session", "true");

    // #204 preview.5 — refresh `.anet/node-server.js` from the *currently
    // installed* agent-network bundle on every start. The grok-build-acp
    // runtime spawns this file as the commhub MCP server via ACP injection
    // (see agent-node `processWithGrok`), and a stale copy from an old
    // `anet init project` can write non-JSON-RPC bytes to stdout, surfacing
    // as Grok's `serde error expected value at line 1 column 2`. Cheap
    // (read+write a few KB) and only fires for these three runtimes.
    if (runtime === "grok-build-acp") {
      try {
        const anetDir = join(process.cwd(), ".anet");
        if (!existsSync(anetDir)) mkdirSync(anetDir, { recursive: true });
        const target = join(anetDir, "node-server.js");
        const status = refreshNodeServerJsAt(target, { overwrite: true });
        if (status === "wrote") {
          console.log(`[anet] refreshed .anet/node-server.js for grok-build-acp (#204)`);
        } else if (status === "no-source") {
          console.warn(`[anet] ⚠ #204 — could not locate a bundled node-server.js to refresh; ` +
            `commhub MCP for Grok may fail if the existing file is stale.`);
        }
      } catch (e: any) {
        console.warn(`[anet] ⚠ #204 — refresh node-server.js failed: ${e?.message || e}`);
      }
    }

    const hub = profile.hub || loadGlobal().hub || "";
    // #203 defense — explicitly set COMMHUB_ALIAS in the agent-node spawn env
    // (mirrors what the claude-code-cli branch below already does). Without
    // this, agent-node's child paths that fall back to process.env.COMMHUB_ALIAS
    // could inherit a stale value from the parent shell (e.g. left over from a
    // previous `anet node start <oldNode>` in the same terminal), causing
    // outbound send_task/send_message to attribute to the wrong alias.
    // `displayName` is the same value we pass as --alias above, so the two
    // sources agree.
    // PR-3 (#146 family) — also propagate COMMHUB_NODE_ID so PR-4's identity
    // getter can resolve `node_id → canonical alias` server-side without
    // relying on the mutable COMMHUB_ALIAS. The runtime can fall back to
    // COMMHUB_ALIAS today; once PR-4 lands, the getter prefers NODE_ID.
    const launcherPath = process.env.PATH;
    const launcherOpencodeSafeBase = process.env.ANET_OPENCODE_SAFE_BASE;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      COMMHUB_ALIAS: displayName,
      ...(profile.node_id ? { COMMHUB_NODE_ID: profile.node_id } : {}),
      ...(runtime === "grok-build-cli"
        ? {
          COMMHUB_TOKEN: "disabled-for-grok-cli-parent",
          COMMHUB_AUTH_TOKEN: "disabled-for-grok-cli-parent",
        }
        : token ? { COMMHUB_TOKEN: token } : {}),
      ...(hub ? { COMMHUB_URL: hub } : {}),
    };
    // #203 defense-in-depth — when profile.node_id is falsy (legacy config
    // without a persisted node_id), the `...(profile.node_id ? ... : {})`
    // spread above is a no-op, and any stale COMMHUB_NODE_ID inherited from
    // the parent shell (e.g. left over from a previous `anet node start`)
    // would survive into the child. agent-node reads COMMHUB_NODE_ID before
    // fileConfig.node_id at cli.ts:580, and its CurrentAliasResolver then
    // asks the hub "what alias for this node_id?" — inheriting A's node_id
    // makes B's runtime drift to A's alias, triggering the report_status
    // token-name rebind at server/src/tools.ts:280-284 → 串号. Explicitly
    // strip both identity envs when we don't have a canonical value; the
    // launcher's --alias flag remains the sole source.
    if (!profile.node_id) delete (env as Record<string, unknown>).COMMHUB_NODE_ID;
    // #125 fix (preview.3) — resolve envRef before spawn so the child gets a
    // plain string in env; the child's own envRef-resolver would otherwise
    // never run (parent crashes on `.replace()` of an object first).
    // #193 envRef Option A — also self-source the per-node .env (mode 600,
    // gitignored) so a wizard-create-then-start in a fresh shell works
    // without the user having to manually export the secret first. Priority
    // is process.env (explicit shell) > dotenv file (see resolveProfileEnv).
    const _dotenvSDK = runtime === "opencode-cli"
      ? loadOpencodeNodeDotenv(nodeId)
      : loadNodeDotenv(nodeId);
    if (Object.keys(_dotenvSDK).length > 0) {
      console.log(`[anet] loaded ${Object.keys(_dotenvSDK).length} key(s) from .anet/nodes/${nodeId}/.env`);
    }
    Object.assign(env, resolveProfileEnv(profile.env as any, home, _dotenvSDK));

    if (runtime === "opencode-cli") {
      if (!opencodeLaunchIdentity) {
        throw new Error("opencode launch identity missing after successful compatibility gate");
      }
      // Reassert the trusted launcher boundary after profile/.env merge.
      env.ANET_OPENCODE_BIN = opencodeLaunchIdentity.binary;
      env.ANET_OPENCODE_VERSION = opencodeLaunchIdentity.version;
      if (launcherOpencodeSafeBase === undefined) delete env.ANET_OPENCODE_SAFE_BASE;
      else env.ANET_OPENCODE_SAFE_BASE = launcherOpencodeSafeBase;
    }
    // Keep the real node credential in the 0600 profile store. Re-assert the
    // sentinels after envRef resolution so profile env cannot reintroduce it.
    if (runtime === "grok-build-cli") {
      env.COMMHUB_TOKEN = "disabled-for-grok-cli-parent";
      env.COMMHUB_AUTH_TOKEN = "disabled-for-grok-cli-parent";
    }

    // Try agent-node from PATH, fallback to npx
    let cmd = "agent-node";
    let commandArgs = agentArgs;
    if (runtime === "opencode-cli") {
      const plan = resolveOpencodeAgentNodeLaunchPlan();
      cmd = plan.command;
      commandArgs = [...plan.argsPrefix, ...agentArgs];
    } else if (runtime === "grok-build-cli") {
      const plan = resolveGrokAgentNodeLaunchPlan();
      cmd = plan.command;
      commandArgs = [...plan.argsPrefix, ...agentArgs];
    } else if (runtime === "codex-app-server") {
      const plan = resolveCodexAgentNodeLaunchPlan();
      cmd = plan.command;
      commandArgs = [...plan.argsPrefix, ...agentArgs];
    } else if (findSiblingAgentNode()) {
      // #1808 —— 旁边那份优先于 PATH 上的(可能是另一棵树里的老版本)。
      const sibling = findSiblingAgentNode()!;
      cmd = process.execPath;
      commandArgs = [sibling.entrypoint, ...agentArgs];
      console.log(`[anet] using the agent-node installed beside anet (${sibling.version ?? "version unknown"}): ${sibling.entrypoint}`);
    } else try { execSync(process.platform === "win32" ? "where agent-node" : "which agent-node", { stdio: "pipe" }); } catch {
      cmd = "npx";
      commandArgs = ["-y", "@sleep2agi/agent-node@preview", ...agentArgs];
    }
    // W1 supervisor wrap (RFC-024, #284 superviseChild) — handle the
    // sentinel exit code 75 (BSD EX_TEMPFAIL, agent-node's "config-apply
    // says please respawn me with the new config" signal) by re-spawning
    // the child in-place. Other exit codes propagate up like before
    // (parent exits with the same code). Stable-uptime threshold (30 s)
    // resets the backoff if the child stays alive that long — a long-
    // running node that eventually crashes doesn't wait 30 s for its
    // first re-fork.
    //
    // `ANET_CONFIG_UPDATE_CAPABLE=1` flag tells the child it's running
    // under a sentinel-aware supervisor → reportStatus will include
    // `config_update_capable: true` in the masked snapshot so the
    // dashboard can show the remote-restart button enabled. Bare-spawn
    // agent-nodes (running outside `anet node start`) inherit the unset
    // env and default to `false` per buildConfigSnapshot.
    const childEnv = runtime === "opencode-cli"
      ? {
        ...hardenOpencodeAgentNodeEnv(env, launcherPath),
        ANET_CONFIG_UPDATE_CAPABLE: "1",
      }
      : runtime === "grok-build-cli"
      ? buildGrokAgentNodeEnv(env)
      : { ...env, ANET_CONFIG_UPDATE_CAPABLE: "1" };

    // #1353 —— 把 daemon 的 anet 二进制 pin 传给子进程。
    //
    // 🔴 这是我 #1299 那次改动的一个错误假设的修正。当时我在 `prepareDaemonAnetBin()`
    //    里往 `process.env` 上写这三个变量,注释还写着「daemon start/up 是
    //    `prepareDaemonAnetBin(); await startCommand()`,同进程」—— **同进程是对的,
    //    但 startCommand 会 spawn 一个 agent-node 子进程,而 childEnv 是从窄的
    //    `env` 变量组的,不是 `process.env`。** 于是子进程一个都拿不到。
    //
    // 2026-08-28 真机实测(两台机器):`nohup anet daemon start <name>` 起来的
    // daemon 进程环境里只有 `ANET_CONFIG_UPDATE_CAPABLE`,随后 create_node 一律
    // 报 `anet_bin_unsafe_path: no ANET_BIN_ABS resolved`。
    //
    // 🔴 症状具有欺骗性:daemon 照常注册、在线、收 doorbell,hub 返回 ok:true + request_id,
    //    失败只出现在 daemon 自己的日志里。我因此把一台残废的 daemon 报成「上线成功」。
    //    「在线」和「能干活」是两件事。
    //
    // 只在 process.env 里确实有的时候才传 —— 它们只由 prepareDaemonAnetBin() 设置,
    // 也就是只在 daemon 路径上存在,普通 `anet node start` 不受影响。
    for (const k of ["ANET_BIN_ABS", "ANET_BIN_SHA256", "ANET_DAEMON_ALLOW_ENV_BIN", "ANET_DAEMON_ALLOW_NON_ROOT_BIN", "ANET_DAEMON_PATH_CONF"]) {
      const v = process.env[k];
      if (v !== undefined && (childEnv as any)[k] === undefined) (childEnv as any)[k] = v;
    }
    const pidFile = join(nodesDir(), nodeId, ".pid");

    // Sentinel code agent-node uses to request re-spawn. Must stay in
    // lockstep with RESTART_SENTINEL in agent-node/src/runtime/config-apply.ts.
    const RESTART_SENTINEL = 75;
    let lastNonRestartCode: number | null = null;
    let activeAgentChild: ReturnType<typeof spawn> | null = null;
    let parentShuttingDown = false;
    let childKillTimer: ReturnType<typeof setTimeout> | null = null;

    // The foreground anet process owns the supervised OpenCode child. Keep
    // this handler OpenCode-only: generic Windows runtimes launch through a
    // cmd.exe wrapper (`shell:true`) and must retain main's already-vetted
    // process lifecycle until a process-tree-aware Windows gate exists.
    const forwardAgentSignal = (signal: NodeJS.Signals) => {
      if (parentShuttingDown) return;
      parentShuttingDown = true;
      try { activeAgentChild?.kill(signal); } catch {}
      childKillTimer = setTimeout(() => {
        try { activeAgentChild?.kill("SIGKILL"); } catch {}
      }, 5_000);
      childKillTimer.unref?.();
    };
    const onAgentSigint = () => forwardAgentSignal("SIGINT");
    const onAgentSigterm = () => forwardAgentSignal("SIGTERM");
    if (runtime === "opencode-cli") {
      process.once("SIGINT", onAgentSigint);
      process.once("SIGTERM", onAgentSigterm);
    }

    await superviseChild({
      label: "agent-node",
      // shutdownGate fires when the child exits with a non-sentinel
      // code → record the code and tell the supervisor to stop. The
      // post-loop code below propagates it to the parent process.
      shutdownGate: () => parentShuttingDown || lastNonRestartCode !== null,
      // The agent-node SIGINT/SIGTERM contract is the parent's: don't
      // jitter, don't backoff hard — re-spawn quickly after a sentinel
      // exit (the config-apply restart path drained in-flight already).
      jitterRatio: 0,
      baseDelayMs: 500,
      maxDelayMs: 5_000,
      runOnce: async (ctrl) => {
        let runCommand = cmd;
        let runCommandArgs = commandArgs;
        if (runtime === "opencode-cli") {
          try {
            const checked = revalidateOpencodeAgentNodeLaunchPlan(
              resolveOpencodeAgentNodeLaunchPlan(),
            );
            runCommand = checked.command;
            runCommandArgs = [...checked.argsPrefix, ...agentArgs];
          } catch (error: any) {
            console.error(`[anet] opencode-cli exact-pair revalidation failed: ${error?.message || error}`);
            lastNonRestartCode = 1;
            return;
          }
        }
        // Stable timer — child survives 30s → reset backoff to base.
        // Mirrors the connectFeishu supervisor pattern from PR #263.
        const stableTimer = setTimeout(() => ctrl.markStable(), 30_000);
        const child = await spawnOwnedNodeChild(nodeId, launchGeneration, () => spawn(runCommand, runCommandArgs, {
          env: childEnv,
          stdio: "inherit",
          shell: runtime === "opencode-cli" ? false : process.platform === "win32",
        }));
        if (runtime === "opencode-cli") activeAgentChild = child;
        if (child.pid) writeFileSync(pidFile, String(child.pid));

        let settled = false;
        const exitInfo = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
          (resolve) => {
            const done = (v: { code: number | null; signal: NodeJS.Signals | null }) => {
              if (settled) return;
              settled = true;
              resolve(v);
            };
            child.once("exit", (code, signal) => done({ code, signal }));
            child.once("error", (err) => {
              console.error(`[anet] ❌ spawn ${runCommand} failed: ${err.message || err}`);
              done({ code: null, signal: null });
            });
          },
        );
        clearTimeout(stableTimer);
        if (runtime === "opencode-cli" && activeAgentChild === child) {
          activeAgentChild = null;
        }

        // Always remove the .pid before deciding the next step — the
        // next spawn writes a fresh one. Without this, a momentary
        // window between exit and re-spawn would show a stale PID.
        try { rmSync(pidFile, { force: true }); } catch {}

        if (exitInfo.code === RESTART_SENTINEL) {
          console.log(
            `[anet] agent-node requested restart (exit ${RESTART_SENTINEL}); re-spawning`,
          );
          return;  // loop iteration ends; supervisor calls runOnce again
        }
        // Any other exit code: stop the loop. shutdownGate reads
        // `lastNonRestartCode` so superviseChild will not schedule the
        // next iteration.
        lastNonRestartCode = exitInfo.code ?? 0;
      },
    });
    if (childKillTimer) clearTimeout(childKillTimer);
    if (runtime === "opencode-cli") {
      process.off("SIGINT", onAgentSigint);
      process.off("SIGTERM", onAgentSigterm);
    }

    // If the child exited with a non-zero, non-sentinel code, propagate
    // it as the parent's exit so `anet node start <name>` still surfaces
    // failures the way it always has (e.g. invalid CLI args → exit 1).
    if (lastNonRestartCode !== null && lastNonRestartCode !== 0) {
      process.exit(lastNonRestartCode);
    }
  } else {
    // spawn claude CLI
    // PR-3 (#146 family) — single-source on displayName (was profile.alias).
    // displayName falls through node_name → name → alias → nodeId, matching
    // the agent-node branch above and the `-n` flag below; using
    // profile.alias here could diverge if the config is hand-edited or if
    // a rename only updated node_name without alias. Also propagate
    // COMMHUB_NODE_ID for PR-4's identity getter.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      COMMHUB_ALIAS: displayName,
      ...(profile.node_id ? { COMMHUB_NODE_ID: profile.node_id } : {}),
      // #115 — suppress Claude Code's "Resume from summary / full session"
      // interactive prompt so restarting a batch of nodes is zero-interaction.
      // The prompt is gated by a session-age threshold (default 70min); a very
      // high value disables it → resumes the full session as-is. Per-spawn,
      // no ~/.claude/settings.json pollution. Respects an explicit user override.
      CLAUDE_CODE_RESUME_THRESHOLD_MINUTES: process.env.CLAUDE_CODE_RESUME_THRESHOLD_MINUTES || "999999999",
      ...(token ? { COMMHUB_TOKEN: token } : {}),
    };
    // #203 defense-in-depth — see agent-node branch above. Strip parent-shell
    // COMMHUB_NODE_ID when we don't have a canonical value; prevents the
    // node-server.js stdio child from inheriting A's node_id when starting B.
    if (!profile.node_id) delete (env as Record<string, unknown>).COMMHUB_NODE_ID;
    // #125 fix (preview.3) — same envRef resolution as the agent-node spawn
    // path above, just for the claude-code-cli runtime branch.
    // #193 envRef Option A — also self-source the per-node .env.
    const _dotenvCC = loadNodeDotenv(nodeId);
    if (Object.keys(_dotenvCC).length > 0) {
      console.log(`[anet] loaded ${Object.keys(_dotenvCC).length} key(s) from .anet/nodes/${nodeId}/.env`);
    }
    Object.assign(env, resolveProfileEnv(profile.env as any, home, _dotenvCC));
    // Fix 1 (#146 / RFC-018) — pin the commhub MCP server's resume_id to a
    // stable per-node value (node-server.ts:75 otherwise falls through to
    // randomUUID() at every start, orphaning the old session row on any
    // restart). cc-<node_id> mirrors agent-node's sdk-<node_id>; the env is
    // inherited by the commhub MCP stdio child the same way COMMHUB_ALIAS is.
    // Set AFTER the envRef merge so a user config.env COMMHUB_RESUME_ID cannot
    // clobber the stable-identity invariant (#146 double-review nit N1).
    if (profile.node_id) env.COMMHUB_RESUME_ID = `cc-${profile.node_id}`;
    if (profile.channels.includes("telegram")) {
      env.TELEGRAM_STATE_DIR = join(nodesDir(), nodeId, "channels", "telegram");
    }

    // #245 task E — "channel previously failed, resume cannot retry" warn.
    //
    // When a channel plugin (telegram in particular) fails its stdio MCP
    // server at session start — e.g. TELEGRAM_BOT_TOKEN was missing because
    // the user ran `anet channel add` AFTER `anet node start` — Claude Code
    // caches the failure in the running process's in-memory state. A
    // subsequent `anet node resume` (or `anet node start` while the old
    // claude process is still alive) inherits that cached failure and
    // silently skips the channel forever. The only working escape is a
    // full process restart: `anet node stop && anet node start` kills the
    // claude process (clears the in-memory cache); the relaunch passes
    // `--resume <uuid>` so the conversation history is preserved while
    // every channel is re-attempted from scratch.
    //
    // anet itself has no hook into Claude's channel lifecycle (channel
    // plugin spawn is fully internal to claude). So this is a diagnostic
    // warning, not a fix: detect the failure pattern from the latest log,
    // surface the actionable fix to the user before the spawn proceeds.
    // launch is NOT blocked — user may have already fixed (e.g. via prior
    // stop+start) and the new log will not have the pattern; the warn is
    // a one-shot guidance for the failure window.
    //
    // Pairs with already-shipped #245 commits:
    //   - 2cc0020 (anet channel add warns if node already running)
    //   - a70caea (anet channel status — surfaces resolved telegram state)
    //   - this commit (anet node start/resume — surfaces failure + escape)
    maybeWarnChannelResumeBlocker(nodeId, profile);

    const claudeArgs: string[] = [];
    // claude-code-cli: byte-identical to pre-2026-06-24 (Vincent ask via
    // 通信龙 — "cli 不用改"). The root-fix added in 2.2.20 was reverted
    // in 2.2.21 because Vincent's preferred root path is claude-agent-sdk,
    // not claude-code-cli; CC users should stay on a known-working flag
    // surface and not be moved to permission-mode without explicit ask.
    if (profile.flags.dangerouslySkipPermissions) claudeArgs.push("--dangerously-skip-permissions");
    let hasDevChannels = false;
    for (const ch of profile.channels) {
      if (ch.startsWith("server:")) {
        claudeArgs.push("--dangerously-load-development-channels", ch);
        hasDevChannels = true;
      } else if (ch === "telegram") {
        claudeArgs.push("--channels", "plugin:telegram@claude-plugins-official");
      } else {
        claudeArgs.push("--channels", ch);
      }
    }
    if (profile.flags.teammateMode) claudeArgs.push("--teammate-mode", profile.flags.teammateMode);

    // #237 P0 #6 — Claude Code's `--dangerously-load-development-channels`
    // pops an interactive confirm box ("I am using this for local
    // development / Exit") that needs an Enter keystroke. anet auto-confirms
    // it via autoConfirmDevChannels() (capture-pane → send-keys) ONLY on the
    // `project up`/`project restart` batch paths and the single-node
    // `--accept-dev-channels` flag — NOT on plain `node start` and NOT on
    // `--tmux` (#494 clarified this; the warn below points accordingly).
    // In a plain foreground `anet node start <alias>` from a non-TTY shell
    // (ssh detached, scripted bootstrap, systemd unit before user attach),
    // no one types Enter → node hangs offline indefinitely with no signal
    // that it's waiting on the user. Friendly preflight: warn loud and
    // suggest the escape hatch that actually dismisses the prompt.
    if (hasDevChannels && !process.stdin.isTTY) {
      console.warn(`[anet] ⚠ claude-code-cli with --dangerously-load-development-channels needs an interactive TTY to confirm Claude Code's dev-channels prompt.`);
      console.warn(`[anet]   This shell's stdin is not a TTY → the spawned claude process will hang on the confirm box and the node will stay offline.`);
      // #494 — this used to point at `--tmux` and claim anet auto-confirms
      // there. The single-node `--tmux` path never ran the capture-pane
      // watcher (only `project up` and `--accept-dev-channels` do), so a
      // headless dev-channels node started via `--tmux` sat on the confirm
      // box forever. Point at the flag that actually dismisses the prompt.
      console.warn(`[anet]   Fix: re-run with \`anet node start ${shellQuote(nodeId)} --accept-dev-channels\` (detached tmux + anet auto-confirms the prompt via capture-pane).`);
      console.warn(`[anet]   Or attach a TTY (interactive ssh) and run again, then hit Enter on the prompt.`);
    }

    if (!profile.session) {
      profile.session = randomUUID();
      saveProfile(nodeId, profile);
    }

    // #486 P0 — claude CLI 2.1.220+ auto-switches to --print mode when its
    // stdin is not a TTY, then errors "Input must be provided either through
    // stdin or as a prompt argument when using --print" AND exits with code
    // 0 (upstream Anthropic bug). anet spawns with { stdio: "inherit" }, so
    // any headless caller (CI, systemd unit, docker run without -it, a
    // watchdog / project-up child, any shell whose stdin is redirected)
    // inherits a non-TTY stdin and hits this — the agent never comes online
    // and downstream sees a false-success "session pinned" line. Refuse the
    // spawn up front with actionable guidance so scripted callers see a
    // real failure (non-zero exit + clear error), and interactive callers
    // stay on the happy path.
    //
    // The dev-channels warn a few lines above (~L4211) covers the narrower
    // "dev-channels + no TTY" case (needs Enter to dismiss a prompt). This
    // gate is broader: NEW claude CLI needs a TTY unconditionally for
    // interactive mode. Both warn/refuse paths coexist; this one fires
    // first when it applies.
    if (!process.stdin.isTTY) {
      console.error(`[anet] ❌ claude-code-cli requires an interactive TTY on stdin.`);
      console.error(`[anet]    Current shell's stdin is not a TTY. Claude CLI 2.1.220+`);
      console.error(`[anet]    auto-switches to --print mode without a TTY and refuses to`);
      console.error(`[anet]    start its interactive session, so the agent never comes online.`);
      console.error(`[anet]    Fix:`);
      // #494 — recommend the purpose-built headless path FIRST.
      // `--accept-dev-channels` always spawns DETACHED (works with no TTY
      // anywhere) and additionally auto-confirms Claude's dev-channels
      // prompt if one appears (a `--tmux` detached session leaves that
      // prompt waiting until someone attaches). `--tmux` stays listed with
      // its precondition spelled out so nobody is pointed back at a wall.
      console.error(`[anet]      • For headless / CI / systemd / docker without -it:`);
      console.error(`[anet]        anet node start ${shellQuote(nodeId)} --accept-dev-channels`);
      console.error(`[anet]        (detached tmux session with a real PTY; auto-confirms the`);
      console.error(`[anet]         dev-channels prompt if the node uses server: channels)`);
      console.error(`[anet]      • anet node start ${shellQuote(nodeId)} --tmux`);
      console.error(`[anet]        (attached when run from a terminal; detached when headless —`);
      console.error(`[anet]         note: does NOT auto-confirm a dev-channels prompt; attach`);
      console.error(`[anet]         with \`tmux attach -t <alias>\` if the node waits on one)`);
      console.error(`[anet]      • Or re-run this command from an interactive terminal.`);
      process.exit(1);
    }

    let launchedWithResume = false;
    const supportsSessionId = claudeSupportsSessionId();
    if (!supportsSessionId) {
      console.warn(`[anet] ⚠ Your Claude Code CLI does not advertise --session-id. Upgrade @anthropic-ai/claude-code to avoid first-run resume drift.`);
      claudeArgs.push("--resume", profile.session);
      launchedWithResume = true;
    } else if (forceNewSession) {
      profile.session = randomUUID();
      saveProfile(nodeId, profile);
      claudeArgs.push("--session-id", profile.session);
    } else if (sessionFileExists(profile.session)) {
      claudeArgs.push("--resume", profile.session);
      launchedWithResume = true;
    } else {
      claudeArgs.push("--session-id", profile.session);
    }

    claudeArgs.push("-n", displayName);

    // #138 fix — fa08eb4 (#135) wrap calls `process.exit(0)` the moment
    // main() resolves. The previous fire-and-forget `child.on("exit")` lets
    // launchAgent return immediately, main() resolves, parent dies before
    // the spawned claude child can claim the TTY foreground process group.
    // On macOS the kernel is strict: orphaned child calling setRawMode on
    // the now-relinquished TTY → EIO (errno 5). On Linux the kernel is more
    // forgiving and the bug usually only manifests as a missing session
    // banner. Fix: await child exit so parent stays alive while child holds
    // the TTY; main() unwinds naturally only after claude actually exits.
    await new Promise<void>(async (resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = await spawnOwnedNodeChild(nodeId, launchGeneration, () => spawn("claude", claudeArgs, { env, stdio: "inherit" }));
      } catch (error: any) {
        console.error(`[anet] ❌ ${error?.message || error}`);
        process.exit(1);
      }
      const pidFile = join(nodesDir(), nodeId, ".pid");
      if (child.pid) writeFileSync(pidFile, String(child.pid));
      child.on("exit", (code) => {
        try { rmSync(pidFile, { force: true }); } catch {}
        // #486 P0 — only print the "session pinned / saved" success line
        // when claude actually exited cleanly. Old behavior printed it
        // after ANY exit (including error paths where claude died with
        // an argument-parse error), giving scripted callers a false-
        // success signal. Non-zero exit propagates via process.exit
        // below; treating exit 0 as the only success path also protects
        // against upstream claude bugs that emit an error to stderr but
        // still exit 0 (rare but observed pre-#486 fix).
        if ((code ?? 0) === 0) {
          if (forceNewSession) {
            console.log(`\n[anet] New Claude Code session saved: ${profile.session?.slice(0, 8)}...`);
          } else if (!launchedWithResume) {
            console.log(`\n[anet] Claude Code session pinned: ${profile.session?.slice(0, 8)}...`);
          }
        }
        // Use the child's exit code as the parent's exit code via the
        // fa08eb4 wrap's natural process.exit(0) path. For non-zero exits,
        // surface explicitly so callers see the failure code.
        if (code && code !== 0) process.exit(code);
        resolve();
      });
      child.on("error", (err) => {
        try { rmSync(pidFile, { force: true }); } catch {}
        console.error(`[anet] ❌ spawn claude failed: ${err.message || err}`);
        // #486 P0 — was `resolve()` → main() natural exit 0 → scripted
        // callers see spawn ENOENT as success. Propagate as failure.
        process.exit(1);
      });
    });
  }
}

type LifecycleProcessIdentity = { pid: number; birth: string; role: "wrapper" | "agent" | "bridge" };
type LifecycleOwnerRecord = {
  schema: 1; state: "starting" | "stopping" | "stopped";
  generation?: string; wrapperPid?: number; wrapperBirth?: string;
  processes?: LifecycleProcessIdentity[];
  startInvokedAt?: number; stopInvokedAt?: number;
};
type LifecycleLockOwner = { schema: 1; pid: number; birth: string; operation: string; generation?: string };

function lifecycleOwnerPath(nodeId: string) { return join(nodesDir(), nodeId, ".lifecycle-owner.json"); }
function lifecycleLockPath(nodeId: string) { return join(nodesDir(), nodeId, ".lifecycle-lock"); }
function lifecycleLockOwnerPath(nodeId: string) { return join(lifecycleLockPath(nodeId), "owner.json"); }

function removeLifecycleLockTree(path: string) {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      let target: string | null = null;
      try { target = realpathSync(path); } catch {}
      rmSync(path, { force: true });
      if (target) rmSync(target, { recursive: true, force: true });
      return;
    }
  } catch {}
  rmSync(path, { recursive: true, force: true });
}

async function withLifecycleLock<T>(nodeId: string, fn: () => T | Promise<T>, operation = "lifecycle", generation?: string): Promise<T> {
  const lock = lifecycleLockPath(nodeId);
  const deadline = Date.now() + 5_000;
  let missingReceiptSince = 0;
  while (true) {
    const claim = `${lock}.claim-${process.pid}-${randomUUID()}`;
    try {
      mkdirSync(claim, { mode: 0o700 });
      const birth = processBirth(process.pid);
      if (!birth) { rmSync(claim, { recursive: true, force: true }); throw new Error("NODE_LIFECYCLE_BIRTH_UNAVAILABLE"); }
      atomicWritePrivateJson(join(claim, "owner.json"), { schema: 1, pid: process.pid, birth, operation, ...(generation ? { generation } : {}) });
      symlinkSync(claim, lock, "dir");
      break;
    }
    catch (e: any) {
      try { rmSync(claim, { recursive: true, force: true }); } catch {}
      if (e?.code !== "EEXIST" && e?.code !== "ENOTEMPTY") throw e;
      let owner: LifecycleLockOwner;
      try { owner = JSON.parse(readFileSync(lifecycleLockOwnerPath(nodeId), "utf-8")); }
      catch (readError: any) {
        // 🔴 #1339: ENOENT 和「解析失败」是两种完全不同的处境,曾经共用 CORRUPT 一个码。
        //
        //   ENOENT  = 持锁者已经 mkdir 了锁目录,但还没写出 owner.json。
        //             中间夹着 processBirth() —— 它读 /proc,机器吃紧时会变慢。
        //             **没有任何东西损坏**,只是还没写完。
        //   解析失败 = 文件在,内容不是合法 JSON。这个才名副其实。
        //
        // 报成 CORRUPT 的代价不是措辞不好看:看到它的人会去找一个损坏的文件,
        // 而那个文件要么不存在、要么完全正确 —— 查不出结果,然后很自然地
        // 「把这个坏掉的锁删掉」,于是绕过了这整套互斥。
        // **一个措辞不准的报错会教用户做一件危险的事。**
        if (readError?.code === "ENOENT") {
          if (!missingReceiptSince) missingReceiptSince = Date.now();
          // 宽限从固定 250ms 改为跟随本函数既有的 deadline(5s)。
          // 理由:250ms 是「本机够、CI 不够」的典型值 —— CI 上 L1 跑到 800~1000s 时
          // 实测撞过(见 #1339 里的 test225 现场)。而 5s 已经是这个函数对
          // 「等一个活着的持锁者」定下的预算,等一份收据没有理由更苛刻。
          // 代价:持锁者若恰好在 mkdir 和写收据之间崩掉,现在要等到 deadline 才报,
          //      而不是 250ms。两者都会报,差的只是延迟;而「写得慢」有实测,
          //      「刚好崩在那个窗口」目前只是假设。
          if (Date.now() < deadline) { await new Promise(r => setTimeout(r, 10)); continue; }
          throw new Error(`NODE_LIFECYCLE_LOCK_RECEIPT_TIMEOUT: ${lock} (持锁者已建锁但 ${Math.round((Date.now() - missingReceiptSince) / 1000)}s 内未写出 owner.json;锁本身没有损坏,不要删它)`);
        }
        throw new Error(`NODE_LIFECYCLE_LOCK_CORRUPT: ${lock} (owner.json 存在但解析失败: ${readError?.message || readError})`);
      }
      if (owner.schema !== 1 || !Number.isSafeInteger(owner.pid) || !owner.birth) throw new Error(`NODE_LIFECYCLE_LOCK_CORRUPT: ${lock}`);
      const current = processIdentitySnapshot(owner.pid);
      if (current.kind === "gone" || (current.kind === "live" && current.birth !== owner.birth)) {
        const claim = `${lock}.reclaim-${process.pid}-${randomUUID()}`;
        try { renameSync(lock, claim); }
        catch (claimError: any) {
          if (claimError?.code === "ENOENT" || claimError?.code === "EEXIST") continue;
          throw claimError;
        }
        // Only the rename winner may inspect/delete this private claim. A
        // loser loops against the replacement public lock and can never
        // recursively delete it (compare-delete TOCTOU).
        let claimedOwner: LifecycleLockOwner;
        try { claimedOwner = JSON.parse(readFileSync(join(claim, "owner.json"), "utf-8")); }
        catch { throw new Error(`NODE_LIFECYCLE_LOCK_CLAIM_CORRUPT: ${claim}`); }
        if (claimedOwner.pid !== owner.pid || claimedOwner.birth !== owner.birth || claimedOwner.operation !== owner.operation) {
          throw new Error(`NODE_LIFECYCLE_LOCK_CLAIM_CHANGED: ${claim}`);
        }
        const claimedIdentity = processIdentitySnapshot(claimedOwner.pid);
        if (claimedIdentity.kind === "unverifiable" || (claimedIdentity.kind === "live" && claimedIdentity.birth === claimedOwner.birth)) {
          throw new Error(`NODE_LIFECYCLE_LOCK_CLAIM_OWNER_LIVE: pid=${claimedOwner.pid}`);
        }
        removeLifecycleLockTree(claim);
        continue;
      }
      if (current.kind === "unverifiable") throw new Error(`NODE_LIFECYCLE_LOCK_OWNER_UNVERIFIABLE: pid=${owner.pid}`);
      if (Date.now() >= deadline) throw new Error(`NODE_LIFECYCLE_LOCK_TIMEOUT: pid=${owner.pid} op=${owner.operation}`);
      await new Promise(r => setTimeout(r, 25));
    }
  }
  try { return await fn(); } finally { removeLifecycleLockTree(lock); }
}

function readLifecycleOwner(nodeId: string): LifecycleOwnerRecord | null {
  try { return JSON.parse(readFileSync(lifecycleOwnerPath(nodeId), "utf-8")); } catch { return null; }
}

function writeLifecycleOwner(nodeId: string, record: LifecycleOwnerRecord) {
  atomicWritePrivateJson(lifecycleOwnerPath(nodeId), record);
}

function snapshotOwnedProcessTree(roots: readonly LifecycleProcessIdentity[]): LifecycleProcessIdentity[] {
  const owned = new Map(roots.map(p => [p.pid, p]));
  if (process.platform !== "linux") return [...owned.values()];
  const verifiedAnchors = new Set<number>();
  for (const root of roots) {
    const current = processIdentitySnapshot(root.pid);
    if (current.kind === "gone") continue;
    if (current.kind === "unverifiable") throw new Error(`NODE_OWNER_BIRTH_UNAVAILABLE: pid=${root.pid}`);
    if (current.birth === root.birth) verifiedAnchors.add(root.pid);
  }
  let rows: Array<{ pid: number; ppid: number }>;
  try {
    rows = execFileSync("ps", ["-e", "-o", "pid=", "-o", "ppid="], { encoding: "utf-8" })
      .split("\n").map(line => line.trim().split(/\s+/).map(Number))
      .filter(parts => parts.length === 2 && parts.every(Number.isSafeInteger))
      .map(([pid, ppid]) => ({ pid, ppid }));
  } catch { throw new Error("NODE_PROCESS_TREE_UNAVAILABLE"); }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (owned.has(row.pid) || !verifiedAnchors.has(row.ppid)) continue;
      const candidate = processIdentitySnapshot(row.pid);
      if (candidate.kind === "gone") continue;
      if (candidate.kind === "unverifiable" || candidate.ppid === undefined) throw new Error(`NODE_DESCENDANT_BIRTH_UNAVAILABLE: pid=${row.pid}`);
      const identity = { birth: candidate.birth, ppid: candidate.ppid };
      // The process table row is only a candidate. Revalidate PPID and birth
      // from one /proc read so an exited/reused PID cannot be adopted.
      if (identity.ppid !== row.ppid || !verifiedAnchors.has(identity.ppid)) continue;
      owned.set(row.pid, { pid: row.pid, birth: identity.birth, role: "bridge" });
      verifiedAnchors.add(row.pid);
      changed = true;
    }
  }
  return [...owned.values()];
}

async function admitNodeStart(nodeId: string, invokedAt: number): Promise<string> {
  return await withLifecycleLock(nodeId, () => {
    const prior = readLifecycleOwner(nodeId);
    if (prior?.state === "stopping" || (prior?.stopInvokedAt && prior.stopInvokedAt >= invokedAt)) {
      throw new Error("NODE_START_CANCELLED_BY_CONCURRENT_STOP");
    }
    const birth = processBirth(process.pid);
    if (!birth) throw new Error("NODE_LIFECYCLE_BIRTH_UNAVAILABLE");
    const generation = randomUUID();
    writeLifecycleOwner(nodeId, {
      schema: 1, state: "starting", generation, wrapperPid: process.pid,
      wrapperBirth: birth, processes: [{ pid: process.pid, birth, role: "wrapper" }], startInvokedAt: invokedAt,
      ...(prior?.stopInvokedAt ? { stopInvokedAt: prior.stopInvokedAt } : {}),
    });
    return generation;
  }, "start-admit");
}

async function spawnOwnedNodeChild<T extends ReturnType<typeof spawn>>(nodeId: string, generation: string, spawnChild: () => T): Promise<T> {
  return await withLifecycleLock(nodeId, async () => {
    const owner = readLifecycleOwner(nodeId);
    if (!owner || owner.state !== "starting" || owner.generation !== generation) throw new Error("NODE_START_CANCELLED_BY_CONCURRENT_STOP");
    const child = spawnChild();
    if (!child.pid) throw new Error("NODE_CHILD_PID_MISSING");
    let birth = processBirth(child.pid);
    for (let i = 0; !birth && i < 10; i++) { await new Promise(r => setTimeout(r, 10)); birth = processBirth(child.pid); }
    if (!birth) {
      try { child.kill("SIGKILL"); } catch {}
      throw new Error(`NODE_CHILD_BIRTH_UNAVAILABLE: pid=${child.pid}`);
    }
    writeLifecycleOwner(nodeId, { ...owner, processes: [...(owner.processes || []), { pid: child.pid, birth, role: "agent" }] });
    return child;
  }, "spawn", generation);
}

// ── start (new session) ──

async function startCommand() {
  const startInvokedAt = Date.now();
  // #173 — `anet node start --all` starts every node under cwd's .anet/nodes/
  // (skip already-running, staggered, auto-resume). It delegates to the
  // `anet project up` implementation (projectUp) so the two stay in lockstep
  // and share the --stagger / --only / --exclude flags + spawn model — no new
  // detached-tmux TTY surface beyond project up's existing #311 follow-up.
  if (args.includes("--all")) {
    const stray = positionalArgs(args.slice(1));  // args[0] is the "start" subcommand token
    if (stray.length > 0) {
      console.error(`[anet] ❌ \`anet node start --all\` starts every node and takes no <alias> (got "${stray[0]}").`);
      console.error(`[anet]    Use either:  anet node start --all          (every node in cwd)`);
      console.error(`[anet]            or:  anet node start ${shellQuote(stray[0])}   (just that one node)`);
      process.exit(1);
    }
    await projectUp("anet node start --all");
    return;
  }

  // #P2fix设计裁6 — extract alias via positionalArgs so `--copresence <alias>`
  // is not treated as `id=--copresence`. positionalArgs is already boolean-
  // aware; parseOpts shares the same exact flag set through cli-args.ts.
  const startPositionals = positionalArgs(args.slice(1));
  const id = startPositionals[0];
  if (!id) { showProfiles("start"); return; }
  const opts = parseOpts();
  const forceNewSession = !!opts["new-session"];

  // RFC-030 P2 — `anet node start <alias> --copresence` spawns the 3-piece
  // codex co-presence dance (app-server + bridge + attachable TUI).
  // Replaces .demo/setup-copresence.sh. See startCopresenceOrchestration
  // for the Risk C double-safeguard (default read-only; danger requires
  // explicit flag + typed confirm + stderr banner) and the per-node
  // CODEX_HOME isolation.
  // The flag is a one-off; `codexCopresence` on the profile is what makes the
  // NEXT start a single `anet node start <name>` — the shape grok and opencode
  // already use. Resolve first so the profile can answer the question too.
  const copresenceFlagPassed = opts.copresence === "true";
  const resolvedForCopresence = resolveNodeRef(id);
  let startGeneration: string | undefined;
  if (copresenceFlagPassed && !resolvedForCopresence) {
    console.error(`Node "${id}" not found. Create it first: anet node create ${id}`);
    process.exit(1);
  }
  if (resolvedForCopresence) {
    try { startGeneration = await admitNodeStart(resolvedForCopresence.id, startInvokedAt); }
    catch (e: any) { console.error(`[anet] ${e?.message || e}`); process.exit(1); }
  }
  // 🔴 The entry gate used to ask ONLY codexCopresenceRequested, which answers
  //    false for every grok node — so `anet node start <grok> --copresence`
  //    fell through to the codex orchestration and died on "requires
  //    runtime=codex-app-server". Each lane answers for itself.
  if (process.env.ANET_COPRESENCE_BRIDGE !== "1" && resolvedForCopresence
    && (codexCopresenceRequested(copresenceFlagPassed, resolvedForCopresence.profile as any)
      || grokCopresenceRequested(copresenceFlagPassed, resolvedForCopresence.profile as any))) {
    const copresenceRuntime = runtimeForExecution(
      resolvedForCopresence.profile,
      `start copresence node ${JSON.stringify(id)}`,
    );
    if (copresenceRuntime === "opencode-cli") {
      await startOpencodeCopresenceOrchestration(id, opts.hub);
      return;
    }
    if (copresenceRuntime === "grok-build-cli") {
      // Record the opt-in BEFORE orchestrating, so a node that comes up shared
      // is never left with a profile claiming the operator never asked.
      if (shouldPersistGrokCopresence(copresenceFlagPassed, resolvedForCopresence.profile as any)) {
        saveProfile(resolvedForCopresence.id, {
          ...(resolvedForCopresence.profile as any),
          grokCopresenceAuto: true,
        });
        console.log(`[anet] remembered co-presence for this node — next time \`anet node start ${shellQuote(nodeDisplayName(resolvedForCopresence.id, resolvedForCopresence.profile))}\` is enough.`);
      }
      await startGrokCopresenceOrchestration(id, { hub: opts.hub });
      return;
    }
    const displayNameForCopresence = nodeDisplayName(resolvedForCopresence.id, resolvedForCopresence.profile);
    const codexHomeDefault = join(nodesDir(), resolvedForCopresence.id, "codex-home");
    const profileHub = opts.hub || (resolvedForCopresence.profile as any).hub || getHub();
    const profileTok = resolvedForCopresence.profile.token || "";
    // Record what was granted so the operator does not retype it. Written
    // BEFORE the orchestration so a node that comes up full-access is never
    // left with a profile claiming it did not.
    const danger = opts["dangerously-allow-full-access"] === "true";
    const prof = resolvedForCopresence.profile as any;
    const remember: Record<string, boolean> = {};
    if (shouldPersistCodexCopresence(copresenceFlagPassed, prof)) remember.codexCopresence = true;
    if (shouldPersistCodexFullAccess(danger, prof)) remember.codexCopresenceFullAccess = true;
    if (Object.keys(remember).length > 0) {
      saveProfile(resolvedForCopresence.id, { ...prof, ...remember });
      if (remember.codexCopresence) {
        console.log(`[anet] remembered co-presence for this node — next time \`anet node start ${shellQuote(displayNameForCopresence)}\` is enough.`);
      }
      if (remember.codexCopresenceFullAccess) {
        console.error(`[anet] ⚠ full-access grant recorded on ${displayNameForCopresence}; future co-presence starts will not ask again.`);
      }
    }
    await startCopresenceOrchestration(id, {
      codexBin: opts["codex-bin"] || "codex",
      codexHome: opts["codex-home"] || codexHomeDefault,
      model: opts.model,
      port: opts.port ? Number(opts.port) : undefined,
      dangerFullAccess: opts["dangerously-allow-full-access"] === "true",
      inheritCodexHome: opts["no-inherit-codex-home"] !== "true",
      yesDangerFullAccess: opts["yes-danger-full-access"] === "true",
      hub: profileHub,
      token: profileTok,
      tuiFirst: opts["tui-first"] === "true",
    });
    return;
  }

  // #136 (Vincent telegram 5158/5159/5161) — revert #122 default auto-wrap.
  // The detached-tmux-by-default path triggered `setRawMode errno 5` on
  // macOS bun (bun's claude-code-cli wants to call setRawMode on a real PTY
  // and the detached tmux child's stdio doesn't satisfy that). Default is
  // now plain foreground; users who want a tmux session opt in with
  // `--tmux`. The `--tmux` path uses `tmux new -As <alias>` ATTACHED
  // (foreground enter, not -d / not detached) — attached mode keeps the
  // PTY chain intact so setRawMode works on every platform. Users can
  // detach with `Ctrl-B D` per normal tmux behavior.
  const wantTmux = opts.tmux === "true";

  // #176 — headless / no-TTY start with automatic dev-channels prompt
  // dismissal. Default `startCommand` assumes an attached TTY, and `--tmux`
  // did too until #486-CR/#494 (it now falls back to a detached session
  // when stdin is not a TTY — see the `headless` branch below — but it
  // still does NOT dismiss the dev-channels prompt; only this flag and
  // `project up` run the capture-pane watcher).
  // claude-code-cli pops "WARNING: Loading development channels …
  // (Enter to confirm)" on every launch and waits for keyboard input. From
  // a watchdog / cron / CI / `setsid`-detached caller there is no TTY to
  // press Enter, so the process hangs forever and the node never comes up
  // (broken telegram → broken whole node — strictly worse than the
  // problem any auto-restart is trying to solve, per 通信龙 a4d1836b).
  //
  // `--accept-dev-channels` spawns the node in a DETACHED tmux session
  // (so claude gets a real PTY from the tmux client/server pair) and runs
  // the existing `dismissDevChannelPrompt` watcher in parallel to confirm
  // the prompt the moment it appears. Same mechanism that `anet project
  // up` already uses (autoConfirmDevChannels at line ~4220) — just made
  // available to single-node `anet node start` for the watchdog +
  // headless re-attach use cases. Closes #176 for the single-node path.
  const wantAcceptDevChannels = opts["accept-dev-channels"] === "true";

  if (!wantTmux && !wantAcceptDevChannels) {
    // Default: spawn the agent runtime in this terminal.
    await launchAgent(id, forceNewSession, opts.hub, startGeneration);
    return;
  }

  if (wantAcceptDevChannels) {
    const resolved = resolveNodeRef(id);
    if (!resolved) {
      console.error(`Node "${id}" not found. Create it first: anet node create ${id}`);
      process.exit(1);
    }
    const alias = nodeDisplayName(resolved.id, resolved.profile);
    if (!tmuxAvailable()) {
      console.error(`[anet] ❌ --accept-dev-channels requires tmux (used for PTY + prompt-dismiss side-channel).`);
      process.exit(1);
    }
    // tmux already running for this alias — assume it's the live session,
    // do NOT re-spawn (would `-As` attach and confuse callers expecting a
    // fresh start).
    if (tmuxSessionRunning(alias)) {
      console.log(`[anet] tmux session "${alias}" already running — skipping spawn (use \`anet node stop\` first if you intended a fresh start).`);
      return;
    }
    const innerHub = opts.hub ? ` --hub ${shellQuote(opts.hub)}` : "";
    const inner = forceNewSession
      ? `anet node start ${shellQuote(alias)} --new-session${innerHub}`
      : `anet node start ${shellQuote(alias)}${innerHub}`;
    // Refuse here, in the caller, for anything the inner `anet node start`
    // would refuse on. Detaching first and discovering it afterwards is how
    // this path used to lie: tmux happily creates a session, the inner command
    // exits 1 a moment later, tmux reaps the session, and the reason dies with
    // the pane. resolveStartProfile is the same check launchAgent runs, so the
    // message the user gets is the real one, on stderr, with exit 1.
    try {
      resolveStartProfile(resolved.id, resolved.profile);
    } catch (error: any) {
      console.error(`[anet] ❌ Refusing to start node ${JSON.stringify(alias)}: ${error?.message || error}`);
      process.exit(1);
    }
    // verifyNodeUp reads .anet/nodes/<id>/.pid; a pid left behind by an earlier
    // run would otherwise be mistaken for this launch's process.
    rmSync(join(nodesDir(), resolved.id, ".pid"), { force: true });
    try {
      execFileSync(
        "tmux",
        ["new-session", "-d", "-s", alias, "-c", process.cwd(), inner],
        { stdio: "ignore" },
      );
    } catch (e: any) {
      console.error(`[anet] ❌ tmux detached spawn failed: ${e?.message || e}`);
      process.exit(1);
    }
    // Concurrently watch the new tmux pane and send Enter when the
    // dev-channels prompt appears. Returns false if the prompt never
    // shows within the window — that's a non-claude node, a node that came up
    // past the prompt already, or a node that died. Which of those it was is
    // decided below by looking at the node, not by assuming.
    const dismissed = await dismissDevChannelPrompt(alias, 45_000);

    // Everything above only proves tmux accepted a command. Whether a node is
    // actually running is a separate fact, and it has to be measured:
    // `tmux new-session -d` succeeds even when the inner `anet node start`
    // refuses and exits 1 a moment later, so printing success here on the
    // strength of the spawn call used to report dead nodes as started. Batch
    // callers believed it — a 97-node restore on 2026-08-17 reported 64/64 up
    // when 6 had never started, and the two outputs were byte-identical.
    const verdict = await verifyNodeUp(resolved.id, 20_000);
    if (!verdict.ok) {
      // The pane is the only place the inner command's own words survive, and
      // only while tmux has not reaped the session yet — so read it first and
      // fall back to the pid-based verdict when it is already gone.
      const paneReason = capturePaneReason(alias);
      console.error(`[anet] ❌ node "${alias}" did not start — ${paneReason || verdict.reason}`);
      if (paneReason) console.error(`[anet]    (${verdict.reason})`);
      // Deliberately do NOT kill the session. A node stuck on a prompt is
      // rescued by one keypress, and a runtime that comes up without writing
      // .pid would be destroyed here for failing a check it never opted into —
      // an 89-node fleet is not the place to act on a guess. But say plainly
      // that the session outlives this failure, because `tmux has-session` is
      // the criterion batch callers use and it will answer yes for this node.
      if (tmuxSessionRunning(alias)) {
        console.error(`[anet]    tmux session "${alias}" is still up — attach and look: tmux attach -t ${shellQuote(alias)}`);
        console.error(`[anet]    (\`tmux has-session\` will say yes for it; this exit code is the one that means "started")`);
      }
      console.error(`[anet]    debug: anet logs ${shellQuote(alias)}  |  anet info ${shellQuote(alias)}`);
      process.exit(1);
    }
    console.log(
      `[anet] ✅ node "${alias}" started detached (${verdict.reason}; ` +
        `dev-channels prompt ${dismissed ? "auto-confirmed" : "did not appear"}).`,
    );
    return;
  }

  // --tmux path: resolve alias for the tmux session name + inner cmd.
  const resolved = resolveNodeRef(id);
  if (!resolved) {
    console.error(`Node "${id}" not found. Create it first: anet node create ${id}`);
    process.exit(1);
  }
  const alias = nodeDisplayName(resolved.id, resolved.profile);

  if (!tmuxAvailable()) {
    console.error(`[anet] ❌ --tmux requested but tmux is not installed.`);
    console.error(`[anet]    Install tmux (e.g. \`brew install tmux\` / \`apt-get install tmux\`) and retry,`);
    console.error(`[anet]    or run \`anet node start ${shellQuote(alias)}\` (without --tmux) to start in this terminal.`);
    process.exit(1);
  }

  // `tmux new -As <alias>`:
  // #486 P0 CR — the previous shape `tmux new -As <alias> … stdio:"inherit"`
  // is ATTACHED and needs the caller's TTY. That defeated the purpose of
  // pointing headless callers at `--tmux` as an escape hatch: in a
  // no-TTY environment `tmux new -As` immediately printed
  // "open terminal failed: not a terminal" and the parent's spawn +
  // synchronous `child.on("exit")` returned so fast that the parent
  // exited 0 — same "假成功" pattern as the mainline #486 bug, sub-path
  // edition. Two behaviors now:
  //   TTY present    → keep attached foreground (setRawMode inside claude
  //                    still needs a real PTY chain; this path is what
  //                    interactive users have relied on since #122).
  //   TTY absent     → detached: `tmux new-session -d`, stdio:"ignore",
  //                    then a bounded `tmux has-session` poll to prove
  //                    the session actually came up. If it didn't (tmux
  //                    quick-fail, permissions, no server startup), the
  //                    captured tmux stderr is surfaced and the parent
  //                    exits non-zero. Prints the exact attach command
  //                    for follow-up.
  //   -A  attach if the session already exists (handles the rerun case)
  //   -s  session name (= alias for discoverability)
  //   -c  start in cwd
  const innerHub = opts.hub ? ` --hub ${shellQuote(opts.hub)}` : "";
  const inner = forceNewSession
    ? `anet node start ${shellQuote(alias)} --new-session${innerHub}`
    : `anet node start ${shellQuote(alias)}${innerHub}`;

  // Same refuse-before-spawning check the --accept-dev-channels path does. The
  // liveness poll below cannot substitute for it: tmux registers the session
  // before the inner command has finished failing, so an unstartable node
  // sails through the 2 s window and the session is gone a moment later —
  // measured as `✅ tmux session "X" started detached` + exit 0 for a runtime
  // this build does not support.
  try {
    resolveStartProfile(resolved.id, resolved.profile);
  } catch (error: any) {
    console.error(`[anet] ❌ Refusing to start node ${JSON.stringify(alias)}: ${error?.message || error}`);
    process.exit(1);
  }

  const headless = !process.stdin.isTTY;
  if (headless) {
    // Detached spawn: no stdin inheritance, capture stderr for surfacing
    // on quick-fail. `new-session -d` returns immediately; we then
    // verify liveness with `has-session` inside a bounded poll before
    // reporting success. Any observed failure path exits non-zero.
    let tmuxStderr = "";
    try {
      // Reuse the same argv shape (`-A -s -c <inner>`) but with
      // `new-session -d`. `-A` still handles the rerun case (attach if
      // exists) which for detached-startup means "leave existing session
      // alone and consider it started".
      const proc = spawnSync(
        "tmux",
        ["new-session", "-d", "-A", "-s", alias, "-c", process.cwd(), inner],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      tmuxStderr = String(proc.stderr || "");
      if (proc.status !== 0) {
        console.error(`[anet] ❌ tmux new-session detached failed (exit ${proc.status}).`);
        if (tmuxStderr.trim()) console.error(`[anet]    tmux stderr: ${tmuxStderr.trim()}`);
        console.error(`[anet]    Fall back to: anet node start ${shellQuote(alias)}`);
        process.exit(proc.status ?? 1);
      }
    } catch (e: any) {
      console.error(`[anet] ❌ tmux detached launch failed: ${e?.message || e}`);
      console.error(`[anet]    Fall back to: anet node start ${shellQuote(alias)}`);
      process.exit(1);
    }
    // Bounded liveness poll — `has-session` returns 0 when the session
    // exists. Wait up to ~2 s (10 × 200 ms) for the tmux server to
    // register the new session. If we never see it, the detached spawn
    // exited cleanly but the session didn't come up (rare — usually
    // means the inner command quick-failed) → surface non-zero.
    const started = Date.now();
    let alive = false;
    while (Date.now() - started < 2000) {
      if (tmuxSessionRunning(alias)) { alive = true; break; }
      // Small blocking wait; keep dependencies minimal (no timers).
      const s = Date.now(); while (Date.now() - s < 200) { /* busy */ }
    }
    if (!alive) {
      console.error(`[anet] ❌ tmux session "${alias}" did not appear within 2 s of detached spawn.`);
      console.error(`[anet]    The tmux server accepted the spawn but the session isn't visible; the`);
      console.error(`[anet]    inner command likely quick-failed. Inspect with:`);
      console.error(`[anet]      tmux ls`);
      console.error(`[anet]      tmux new-session -A -s ${alias} -- ${inner}`);
      process.exit(1);
    }
    console.log(`[anet] ✅ tmux session "${alias}" started detached.`);
    console.log(`[anet]    Attach:   tmux attach -t ${shellQuote(`=${alias}`)}`);
    console.log(`[anet]    Stop:     anet node stop ${alias}`);
    // #494 — a detached `--tmux` start does not run the dev-channels
    // prompt watcher; a claude node with server: channels will sit on the
    // confirm box until a human attaches. Don't let that read as success
    // silently — say so and point at the flag that handles it.
    if ((resolved.profile.channels ?? []).some(ch => typeof ch === "string" && ch.startsWith("server:"))) {
      console.warn(`[anet] ⚠ this node loads dev channels (server:*): Claude will wait on its`);
      console.warn(`[anet]   confirm prompt inside the detached session. Attach and hit Enter,`);
      console.warn(`[anet]   or use \`anet node start ${shellQuote(alias)} --accept-dev-channels\` which auto-confirms.`);
    }
    return;
  }

  // TTY-present path: attached foreground (unchanged shape).
  // stdio: 'inherit' makes the parent terminal a tmux client; setRawMode
  // sees a real PTY through the tmux client/server pair.
  const tmuxArgs = ["new", "-As", alias, "-c", process.cwd(), inner];
  try {
    const child = spawn("tmux", tmuxArgs, { stdio: "inherit" });
    child.on("exit", code => process.exit(code || 0));
  } catch (e: any) {
    console.error(`[anet] ❌ tmux launch failed: ${e.message || e}`);
    console.error(`[anet]    Fall back to: anet node start ${shellQuote(alias)}`);
    process.exit(1);
  }
}

// ── resume (continue session) ──

// ── #1856 —— anet node codex <verb> <alias>:Codex TUI 共存节点生命周期控制器 ──
// PR-A:preflight / verify(只读,不碰进程、不改文件;只在 <nodeDir>/receipts/ 写 receipt)。
// start / restart / resume / fork / account / rollback 分 PR 落地;合同与 14 条不变量见 issue #1856。
/** #1856 —— --probe-from 的 peer 可能住在另一个 .anet 根(fork 出的节点在自己的 workdir 里);--probe-root <dir> 指定去哪找。 */
function resolveNodeRefAt(root: string | undefined, ref: string): { id: string; profile: Profile } | null {
  if (!root) return resolveNodeRef(ref);
  const back = process.cwd();
  try { process.chdir(root); return resolveNodeRef(ref); } catch { return null; } finally { process.chdir(back); }
}

/** #1856 PR-D —— 受控启动前把 codex 的更新提示按「Skip until next version」记进 version.json(固定规则,不敲键盘,不碰二进制)。
 *  真机:首次启动后 TUI 自己刷新了 version.json(latest 0.153.4 ≠ 装的 0.149.1),重启时 TUI 停在更新提示上,启动器 fail-closed。 */
function dismissCodexUpdatePrompt(codexHome: string, say: (m: string) => void): void {
  const p = join(codexHome, "version.json");
  if (!existsSync(p)) return;
  try {
    const v = JSON.parse(readFileSync(p, "utf-8"));
    const latest = typeof v?.latest_version === "string" ? v.latest_version : null;
    if (!latest || v?.dismissed_version === latest) return;
    const tmp = `${p}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ ...v, dismissed_version: latest }) + "\n", { mode: 0o644 });
    renameSync(tmp, p);
    say(`codex update prompt for ${latest} dismissed for this node (version.json dismissed_version; binary untouched)`);
  } catch (e: any) { say(`could not read/write version.json (${e?.message ?? e}); the TUI may stop on the update prompt`); }
}

// ── #1856 —— lifecycle 命令共用的上下文(解析节点、cwd 守卫、事实采集器);start/restart/resume/account 都从这里起 ──
type CodexLifecycleCtx = Awaited<ReturnType<typeof codexLifecycleCtx>>;
async function codexLifecycleCtx(verb: string, ref: string, opts: Record<string, string>) {
  const resolved = resolveNodeRef(ref);
  if (!resolved) { console.error(`[anet] node codex ${verb}: unknown node "${ref}" (anet node ls)`); process.exit(2); }
  const profile = resolved.profile as Record<string, any>;
  if (normalizeRuntime(resolved.profile) !== "codex-app-server") {
    console.error(`[anet] node codex ${verb}: ${resolved.id} runs ${normalizeRuntime(resolved.profile)}, not codex-app-server`);
    process.exit(2);
  }
  const displayName = nodeDisplayName(resolved.id, resolved.profile);
  const nodeDir = join(nodesDir(), resolved.id);
  if (["start", "restart", "resume"].includes(verb) && profile.codexProjectDir) {
    // 启动器用 cwd 当三段 tmux 的工作目录,而 .anet/nodes 也是 cwd 相对的:不在 config 记的目录里起,workdir_consistent 必 fail。
    let here = process.cwd(); try { here = realpathSync(here); } catch { /* keep */ }
    let want = String(profile.codexProjectDir); try { want = realpathSync(want); } catch { /* keep */ }
    if (here !== want) {
      console.error(`[anet] node codex ${verb}: run this from the node's workdir (config.codexProjectDir): cd ${shellQuote(want)}`);
      process.exit(2);
    }
  }
  const marker = readMarker(nodesDir(), resolved.id);
  const recorded = marker.kind === "ok"
    ? { appsrv: marker.marker.sessions.appsrv?.pid ?? null, bridge: marker.marker.sessions.bridge?.pid ?? null, tui: marker.marker.sessions.tui?.pid ?? null }
    : { appsrv: null, bridge: null, tui: null };
  const gc = loadGlobal();
  const startedAt = new Date();
  const hub: string = profile.hub || gc.hub;
  const codexHome = join(nodeDir, "codex-home");
  const sessions = copresenceTmuxSessions(displayName);
  const prim = realPrimitives({ hub, token: profile.token || gc.token, networkId: profile.network_id || gc.network_id });
  const gather = async () => {
    const m = readMarker(nodesDir(), resolved.id);
    const rec = m.kind === "ok"
      ? { appsrv: m.marker.sessions.appsrv?.pid ?? null, bridge: m.marker.sessions.bridge?.pid ?? null, tui: m.marker.sessions.tui?.pid ?? null }
      : recorded;
    const prof = (loadStoredProfile(resolved.id) ?? profile) as Record<string, any>;
    return gatherCodexFacts(prim, {
      alias: displayName,
      nodeId: prof.node_id ?? null,
      nodeDir,
      codexHome,
      configToken: prof.token ?? null,
      codexProjectDir: prof.codexProjectDir ?? null,
      codexThreadId: prof.codexThreadId ?? null,
      codexAppServerUrl: prof.codexAppServerUrl ?? null,
      sessions,
      recordedPids: rec,
      markerUuid: m.kind === "ok" ? m.marker.marker : null,
    });
  };
  const unattested = { key: "identity_attested", status: "unknown" as const, detail: "cross-node nonce probe not run — pass --probe-from <peer> (restart/start/resume) for attestation" };
  const say = (m: string) => { if (opts.json !== "true") console.log(`[anet] codex ${verb}: ${m}`); };
  return { verb, opts, resolved, profile, displayName, nodeDir, recorded, gc, startedAt, hub, codexHome, sessions, prim, gather, unattested, say };
}

// ── #1856 PR-B —— 状态机的真实动作;account install/rollback(PR-D)复用同一套 ──
function codexRestartActions(ctx: CodexLifecycleCtx, peer: { id: string; profile: Profile } | null): RestartActions {
  const { verb, opts, profile, resolved, displayName, nodeDir, codexHome, sessions, prim, hub, gc, gather, unattested, say } = ctx;
  const port = (() => { try { return profile.codexAppServerUrl ? Number(new URL(profile.codexAppServerUrl).port) || null : null; } catch { return null; } })();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const sessionIdExact = (name: string): string | null => {
    try {
      const out = execFileSync("tmux", ["list-sessions", "-F", "#{session_name}\t#{session_id}"], { stdio: ["ignore", "pipe", "ignore"] }).toString();
      for (const line of out.split("\n")) { const [n, id] = line.split("\t"); if (n === name && id) return id; }
    } catch { /* no server */ }
    return null;
  };
  const goalState = async (): Promise<{ state: LifecycleGoalState; fingerprint: string | null }> => goalsFileState(nodeDir);
  const actions: RestartActions = {
    gate: async (phase) => {
      const facts = await gather();
      const checks = phase === "before" ? evaluateCodexPreflight(facts) : evaluateCodexVerify(facts, unattested);
      const rollout = facts.session.rolloutMatches.length === 1 ? facts.session.rolloutMatches[0] : null;
      say(`${phase}: ${checks.filter((c) => c.status === "pass").length}/${checks.length} pass`);
      return { checks, rollout, port: { port, ownerPid: facts.port.owner?.pid ?? null, ownerIsOurs: facts.port.owner ? facts.port.owner.codexHome === facts.home.dir : null } };
    },
    goalState,
    liveSessions: async () => ({ bridge: prim.tmuxPanePid(sessions.bridge) !== null, tui: prim.tmuxPanePid(sessions.tui) !== null, appsrv: prim.tmuxPanePid(sessions.appsrv) !== null }),
    stopSession: async (role) => {
      const name = sessions[role];
      const id = sessionIdExact(name);
      if (!id) return { ok: true, detail: `${name} already gone` };
      try { execFileSync("tmux", ["kill-session", "-t", id], { stdio: "pipe" }); } catch (e: any) { return { ok: false, detail: `tmux kill-session ${id}: ${e?.message ?? e}` }; }
      const deadline = Date.now() + (role === "tui" ? 20_000 : 10_000);
      while (Date.now() < deadline) { if (prim.tmuxPanePid(name) === null) { say(`stopped ${role} (${name})`); return { ok: true, detail: `${name} gone` }; } await sleep(250); }
      return { ok: false, detail: `${name} still alive after kill-session` };
    },
    waitRolloutSettled: async (before) => {
      const prof = (loadStoredProfile(resolved.id) ?? profile) as Record<string, any>;
      const tid = prof.codexThreadId ?? null;
      let last: number | null = null; let stable = 0;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const m = findRollouts(codexHome, tid);
        if (m.length !== 1) return before && m.length === 0 ? null : (m[0] ?? null);
        if (last === m[0].bytes) { if (++stable >= 2) return m[0]; } else { stable = 0; last = m[0].bytes; }
        await sleep(1000);
      }
      return findRollouts(codexHome, tid)[0] ?? null;
    },
    waitPortFree: async () => {
      if (!port) return { free: true, ownerPid: null, ownerIsOurs: null };
      const deadline = Date.now() + 30_000;
      let pid: number | null = null;
      while (Date.now() < deadline) { pid = prim.listeningPid(port); if (pid === null) return { free: true, ownerPid: null, ownerIsOurs: null }; await sleep(500); }
      const pf = pid === null ? null : processFact(prim, pid);
      const ours = pf ? pf.codexHome !== null && pf.codexHome === codexHome && pf.argv.some((a) => /app-server/.test(a)) : null;
      return { free: false, ownerPid: pid, ownerIsOurs: ours };
    },
    termOwnedPid: async (pid) => {
      try { process.kill(pid, "SIGTERM"); } catch (e: any) { return { ok: false, detail: `kill ${pid}: ${e?.message ?? e}` }; }
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) { try { process.kill(pid, 0); } catch { return { ok: true, detail: `pid ${pid} exited` }; } await sleep(250); }
      return { ok: false, detail: `pid ${pid} survived SIGTERM for 10s (not escalating)` };
    },
    start: async () => {
      const prof = (loadStoredProfile(resolved.id) ?? profile) as Record<string, any>;
      // execArgv 跟着走:开发态用 tsx 跑 .ts 时子进程也要带 loader;发布态(dist/bin/cli.js)execArgv 为空,行为不变。
      const argv = [...process.execArgv, process.argv[1], "node", "start", displayName, "--copresence", "--tui-first"];
      if (prof.codexCopresenceFullAccess) argv.push("--dangerously-allow-full-access", "--yes-danger-full-access");
      const env = { ...process.env }; delete env.ANET_COPRESENCE_BRIDGE; delete env.ANET_NODE_MARKER;
      dismissCodexUpdatePrompt(codexHome, say);
      say(`launching: anet node start ${shellQuote(displayName)} --copresence --tui-first`);
      const r = spawnSync(process.execPath, argv, { env, encoding: "utf-8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 });
      const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().split("\n").slice(-12).join("\n");
      if (r.status === 0) { say(`launcher 就绪`); return { ok: true, detail: tail }; }
      return { ok: false, detail: r.error ? `${r.error.message}\n${tail}` : `exit ${r.status}\n${tail}` };
    },
    waitHubOnline: async () => {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`${hub}/api/status`, { headers: { Authorization: `Bearer ${profile.token || gc.token}` } });
          if (res.ok) {
            const body: any = await res.json();
            const row = (body?.sessions ?? []).find((x: any) => x?.alias === displayName);
            if (row && ["idle", "working"].includes(String(row.status))) return { ok: true, detail: `hub reports ${row.status}` };
          }
        } catch { /* retry */ }
        await sleep(2000);
      }
      return { ok: false, detail: "hub did not report the node idle/working within 60s" };
    },
    nonceProbe: peer ? async () => {
      const nonce = `anet-lc-${randomBytes(6).toString("hex")}`;
      const peerTok = (peer.profile as any).token as string;
      const peerAlias = nodeDisplayName(peer.id, peer.profile);
      const headers = { Authorization: `Bearer ${peerTok}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" };
      const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "send_task", arguments: { alias: displayName, task: `[anet lifecycle probe] 请只回复这一串,不做其他事: ${nonce}`, priority: "high" } } };
      try {
        const res = await fetch(`${hub}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
        if (!res.ok) return { ok: false, detail: `probe send_task from ${peerAlias} failed: HTTP ${res.status}` };
      } catch (e: any) { return { ok: false, detail: `probe send_task from ${peerAlias} failed: ${e?.message ?? e}` }; }
      say(`nonce probe sent from ${peerAlias}; waiting for ${displayName} to answer (≤150s)`);
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`${hub}/api/messages?limit=50`, { headers: { Authorization: `Bearer ${peerTok}` } });
          if (res.ok) {
            const rows: any[] = ((await res.json()) as any)?.messages ?? [];
            const hit = rows.find((m) => typeof m?.content === "string" && m.content.includes(nonce) && m.type !== "task");
            if (hit) {
              const from = String(hit.from_alias ?? "");
              if (from === displayName) return { ok: true, detail: `${peerAlias} received the nonce back from ${displayName} (hub-attributed sender)`, evidence: { nonce, peer: peerAlias, messageId: hit.id ?? null } };
              return { ok: false, detail: `nonce came back from "${from}", not ${displayName}`, evidence: { nonce, peer: peerAlias, from } };
            }
          }
        } catch { /* retry */ }
        await sleep(3000);
      }
      return { ok: false, detail: `no reply carrying the nonce reached ${peerAlias} within 150s`, evidence: { nonce, peer: peerAlias } };
    } : undefined,
  };
  return actions;
}

async function codexLifecycleCommand() {
  const verb = args[1] as string | undefined;
  const ref = args[2];
  const opts = parseOpts();
  const usage = () => {
    console.error("Usage: anet node codex <preflight|verify|start|restart|resume|fork|account|rollback> <alias> [--json] [--probe-from <peer>] [--thread <id>]");
    console.error("  preflight  只读核对:alias↔node_id、CODEX_HOME/auth、工作目录四处一致、exact thread + 唯一 rollout、端口归属、tmux 拓扑");
    console.error("  verify     preflight + 子进程环境核对(CODEX_HOME / token 短指纹)+ 跨节点身份验收(PR-B 前恒为 unknown → FAIL)");
    console.error("  exit 0 = PASS;exit 2 = FAIL(receipt 里列 blocking);receipt 落在 .anet/nodes/<id>/receipts/,凭据只记短指纹");
    console.error("  restart    确定性状态机(零 LLM):preflight → goal 状态 → 停 Bridge→TUI→App Server → 端口放掉 → 起(App Server→端口→exact TUI→Bridge)→ verify");
    console.error("             --probe-from <peer> [--probe-root <dir>]  用另一本地节点发 nonce 探针做跨节点身份验收(identity_attested;不给则 unknown → FAIL);peer 在别的 .anet 根时给 --probe-root");
    console.error("  start      同 restart 但要求三段都不在;resume --thread <id> 先把 exact thread 写进 config(要求唯一 rollout)再 start");
    console.error("  fork       fork <source> --name <target> --workdir <dir> [--inherit-full-access]:继承历史,其余全新(node_id/CODEX_HOME/thread/端口/tmux 名);");
    console.error("             rollout 复制并改写 id,源节点零触碰;之后在 <dir> 里 anet node codex start <target> --probe-from <source>");
    console.error("  account    register <profile-id> --from-codex-home <dir> | list | install <alias> --source codex-login:<profile-id> [--probe-from <peer>]");
    console.error("             登录源是本机受控 registry 的不透明引用(不收路径/stdin/env);install = fresh 模型探针 → 备份 → 0600 安装 → 完整重启 → verify;失败自动回滚");
    console.error("  rollback   rollback <alias> --receipt <id> [--probe-from <peer>]:只认原 install receipt 里的 backup_ref");
  };
  const landed = ["preflight", "verify", "start", "restart", "resume", "fork", "account", "rollback"];
  if (!verb || !ref || !landed.includes(verb)) { usage(); process.exit(verb ? 2 : 0); }
  if (verb === "fork") { await codexForkCommand(ref, opts); return; }
  if (verb === "account") { await codexAccountCommand(ref, args[3], opts); return; }
  if (verb === "rollback") { await codexRollbackCommand(ref, opts); return; }
  const ctx = await codexLifecycleCtx(verb, ref, opts);
  const { resolved, profile, displayName, nodeDir, startedAt, codexHome, gather, unattested, say } = ctx;
  if (verb === "preflight" || verb === "verify") {
    const facts = await gather();
    const checks = verb === "preflight" ? evaluateCodexPreflight(facts) : evaluateCodexVerify(facts, unattested);
    const receipt = buildReceipt({ verb, alias: displayName, nodeId: profile.node_id ?? null, startedAt, checks });
    const path = writeReceipt(nodeDir, receipt);
    if (opts.json === "true") console.log(JSON.stringify({ ...receipt, receiptPath: path }, null, 2));
    else { console.log(formatReceiptSummary(receipt)); console.log(`receipt: ${path}`); }
    process.exit(receipt.verdict === "PASS" ? 0 : 2);
  }

  // ── start / restart / resume:确定性状态机(src/codex-lifecycle-restart.ts),这里只提供真实动作 ──
  if (verb === "resume") {
    const thread = String(opts.thread ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(thread)) {
      console.error(`[anet] node codex resume: --thread <36-char thread id> is required (no prefix, no "latest" guessing)`);
      process.exit(2);
    }
    const matches = findRollouts(codexHome, thread);
    if (matches.length !== 1) {
      console.error(`[anet] node codex resume: thread ${thread} has ${matches.length} rollout file(s) under this node's CODEX_HOME — need exactly one; refusing`);
      process.exit(2);
    }
    const stored = (loadStoredProfile(resolved.id) ?? profile) as Record<string, any>;
    if (stored.codexThreadId !== thread) {
      saveProfile(resolved.id, { ...(stored as any), codexThreadId: thread });
      say(`config codexThreadId ${stored.codexThreadId ?? "(none)"} → ${thread} (rollout ${matches[0].path})`);
    }
  }
  const peer = opts["probe-from"] ? resolveNodeRefAt(opts["probe-root"], String(opts["probe-from"])) : null;
  if (opts["probe-from"] && !peer) { console.error(`[anet] node codex ${verb}: --probe-from ${opts["probe-from"]}: unknown local node`); process.exit(2); }
  if (peer && peer.id === resolved.id) { console.error(`[anet] node codex ${verb}: --probe-from must be a *different* node`); process.exit(2); }
  const actions = codexRestartActions(ctx, peer);
  const outcome = await runCodexRestart(verb as "start" | "restart" | "resume", actions);
  const receipt = buildReceipt({ verb: verb as LifecycleVerb, alias: displayName, nodeId: profile.node_id ?? null, startedAt, checks: outcome.checks });
  const path = writeReceipt(nodeDir, receipt);
  if (opts.json === "true") console.log(JSON.stringify({ ...receipt, stoppedAt: outcome.stoppedAt, rolledBack: outcome.rolledBack, receiptPath: path }, null, 2));
  else {
    console.log(formatReceiptSummary(receipt));
    console.log(`stopped at: ${outcome.stoppedAt}${outcome.rolledBack ? " (rolled back)" : ""}`);
    console.log(`receipt: ${path}`);
  }
  process.exit(receipt.verdict === "PASS" ? 0 : 2);
}

// ── #1856 PR-C —— anet node codex fork <source> --name <target> --workdir <dir> ──
async function codexForkCommand(sourceRef: string, opts: Record<string, string>) {
  const json = opts.json === "true";
  const target = String(opts.name ?? "");
  const workdirRaw = String(opts.workdir ?? "");
  if (!target || !workdirRaw) {
    console.error("Usage: anet node codex fork <source> --name <target> --workdir <dir> [--inherit-full-access] [--json]");
    process.exit(2);
  }
  validateNodeName(target);
  if (!existsSync(workdirRaw) || !statSync(workdirRaw).isDirectory()) {
    console.error(`[anet] node codex fork: --workdir ${workdirRaw} is not an existing directory (fork does not create it)`);
    process.exit(2);
  }
  const workdir = realpathSync(workdirRaw);
  const source = resolveNodeRef(sourceRef);
  if (!source) { console.error(`[anet] node codex fork: unknown source node "${sourceRef}" (anet node ls)`); process.exit(2); }
  if (normalizeRuntime(source.profile) !== "codex-app-server") {
    console.error(`[anet] node codex fork: ${source.id} runs ${normalizeRuntime(source.profile)}, not codex-app-server`);
    process.exit(2);
  }
  const sp = source.profile as Record<string, any>;
  const sourceName = nodeDisplayName(source.id, source.profile);
  if (sourceName === target) { console.error(`[anet] node codex fork: --name must differ from the source alias`); process.exit(2); }
  const sourceDir = join(nodesDir(), source.id);
  const sourceHome = join(sourceDir, "codex-home");
  const targetNodesDir = join(workdir, ".anet", "nodes");
  if (existsSync(join(targetNodesDir, target))) {
    console.error(`[anet] node codex fork: ${join(targetNodesDir, target)} already exists — refusing to overwrite`);
    process.exit(2);
  }
  const say = (m: string) => { if (!json) console.log(`[anet] codex fork: ${m}`); };
  const startedAt = new Date();
  const gc = loadGlobal();
  const hub: string = sp.hub || gc.hub;
  const prim = realPrimitives({ hub, token: sp.token || gc.token, networkId: sp.network_id || gc.network_id });
  const smarker = readMarker(nodesDir(), source.id);
  const sfacts = await gatherCodexFacts(prim, {
    alias: sourceName,
    nodeId: sp.node_id ?? null,
    nodeDir: sourceDir,
    codexHome: sourceHome,
    configToken: sp.token ?? null,
    codexProjectDir: sp.codexProjectDir ?? null,
    codexThreadId: sp.codexThreadId ?? null,
    codexAppServerUrl: sp.codexAppServerUrl ?? null,
    sessions: copresenceTmuxSessions(sourceName),
    recordedPids: smarker.kind === "ok"
      ? { appsrv: smarker.marker.sessions.appsrv?.pid ?? null, bridge: smarker.marker.sessions.bridge?.pid ?? null, tui: smarker.marker.sessions.tui?.pid ?? null }
      : { appsrv: null, bridge: null, tui: null },
    markerUuid: smarker.kind === "ok" ? smarker.marker.marker : null,
  });
  const schecks = evaluateCodexPreflight(sfacts);
  const checks: ReceiptCheck[] = schecks.map((c) => ({ ...c, key: `source:${c.key}` }));
  const finish = (dir: string, nodeId: string | null, extra: ReceiptCheck[], next?: string): never => {
    const receipt = buildReceipt({ verb: "fork", alias: target, nodeId, startedAt, checks: [...checks, ...extra] });
    const path = writeReceipt(dir, receipt);
    if (json) console.log(JSON.stringify({ ...receipt, source: sourceName, workdir, receiptPath: path }, null, 2));
    else { console.log(formatReceiptSummary(receipt)); if (next) console.log(next); console.log(`receipt: ${path}`); }
    process.exit(receipt.verdict === "PASS" ? 0 : 2);
  };
  // 源节点只要求四项 pass:身份、HOME、exact thread + 唯一 rollout、rollout 快照。它自己的 workdir/端口/拓扑缺口不影响 fork。
  const mustPass = ["identity_match", "home_isolated", "session_exact", "rollout_intact"];
  const blocked = schecks.filter((c) => mustPass.includes(c.key) && c.status !== "pass");
  if (blocked.length > 0) {
    finish(sourceDir, null, [{ key: "fork_isolation", status: "fail", detail: `source not forkable: ${blocked.map((c) => `${c.key}=${c.status}`).join(", ")}` }]);
  }
  const srcRollout = sfacts.session.rolloutMatches[0];
  say(`source ${sourceName}: thread ${sp.codexThreadId}, rollout ${srcRollout.bytes} B`);

  // 新身份先在 hub 上登记(拿 ntok),再动磁盘;磁盘先写 staging,最后一步 rename 进位。
  process.chdir(workdir);
  const createOpts = { ...opts, runtime: "codex-app-server", copresence: "true", hub: sp.hub ?? opts.hub, model: opts.model ?? sp.model } as unknown as ReturnType<typeof parseOpts>;
  delete (createOpts as any).name; delete (createOpts as any).workdir; delete (createOpts as any).json; delete (createOpts as any)["inherit-full-access"];
  createOpts._channels = createOpts._channels ?? []; createOpts._envs = createOpts._envs ?? [];
  const base = createProfileFromOpts(target, createOpts);
  const newThread = uuidV7(Date.now(), randomBytes(10));
  const inheritFull = opts["inherit-full-access"] === "true" && sp.codexCopresenceFullAccess === true;
  const draft: Profile = { ...base, codexCopresence: true, codexThreadId: newThread, codexProjectDir: workdir, ...(inheritFull ? { codexCopresenceFullAccess: true } : {}) };
  const withTok = await ensureNodeToken(draft, target);
  say(`hub identity for ${target}: node_id ${withTok.node_id}`);
  const staging = join(targetNodesDir, `.fork-${target}-${process.pid}`);
  const stagingHome = join(staging, "codex-home");
  let rewrite: Awaited<ReturnType<typeof rewriteRollout>> | null = null;
  try {
    mkdirSync(stagingHome, { recursive: true, mode: 0o700 });
    chmodSync(stagingHome, 0o700);
    for (const f of FORK_HOME_COPY) {
      const from = join(sourceHome, f.name);
      if (!existsSync(from)) { if (f.required) throw new Error(`${f.name} missing in source CODEX_HOME`); continue; }
      copyFileSync(from, join(stagingHome, f.name));
      chmodSync(join(stagingHome, f.name), f.mode);
    }
    const dst = forkRolloutPath(stagingHome, startedAt, newThread);
    // 源 rollout 记的 cwd(session_meta + 每个 turn_context)要改成新 workdir,否则 TUI 恢复后仍在源项目目录里干活。
    const headerCwd = (() => { try { const first = readFileSync(srcRollout.path, "utf-8").split("\n", 1)[0]; return JSON.parse(first)?.payload?.cwd ?? null; } catch { return null; } })();
    rewrite = await rewriteRollout(srcRollout.path, dst, String(sp.codexThreadId), newThread, typeof headerCwd === "string" && headerCwd ? { from: headerCwd, to: workdir } : undefined);
    say(`rollout copied: ${rewrite.lines} lines, ${rewrite.bytesOut} B, ${rewrite.replacements} id rewrites, ${rewrite.cwdReplacements} cwd rewrites (${headerCwd ?? "?"} → ${workdir}) → ${dst}`);
    saveProfile(target, withTok);
    renameSync(stagingHome, join(targetNodesDir, target, "codex-home"));
    rmSync(staging, { recursive: true, force: true });
  } catch (e: any) {
    rmSync(staging, { recursive: true, force: true });
    console.error(`[anet] node codex fork: ❌ ${e?.message ?? e}`);
    console.error(`[anet]    nothing was moved into ${join(targetNodesDir, target)}; the hub may hold a registration for "${target}" — anet node delete ${shellQuote(target)} cleans it.`);
    finish(sourceDir, withTok.node_id ?? null, [{ key: "fork_isolation", status: "fail", detail: `staging failed: ${e?.message ?? e}` }]);
  }

  // 目标侧核对(nodesDir 现在指向 workdir/.anet/nodes)。
  const targetDir = join(nodesDir(), target);
  const targetHome = join(targetDir, "codex-home");
  const tprim = realPrimitives({ hub, token: withTok.token || gc.token, networkId: (withTok as any).network_id || gc.network_id });
  const tfacts = await gatherCodexFacts(tprim, {
    alias: target,
    nodeId: withTok.node_id ?? null,
    nodeDir: targetDir,
    codexHome: targetHome,
    configToken: withTok.token ?? null,
    codexProjectDir: workdir,
    codexThreadId: newThread,
    codexAppServerUrl: null,
    sessions: copresenceTmuxSessions(target),
    recordedPids: { appsrv: null, bridge: null, tui: null },
    markerUuid: null,
  });
  const targetRollout = tfacts.session.rolloutMatches.length === 1 ? tfacts.session.rolloutMatches[0] : null;
  const isolation = checkForkIsolation({
    source: { nodeId: sp.node_id ?? null, homeReal: sfacts.home.dir, threadId: sp.codexThreadId ?? null, alias: sourceName, rolloutInode: srcRollout.inode, rolloutBytes: srcRollout.bytes },
    target: { nodeId: withTok.node_id ?? null, homeReal: tfacts.home.dir, threadId: newThread, alias: target, rolloutInode: targetRollout?.inode ?? null, rolloutBytes: targetRollout?.bytes ?? null, envFilePresent: existsSync(join(targetHome, ".anet-copresence.env")) },
    rewrite,
  });
  const workdirCheck: ReceiptCheck = tfacts.workdir.configProjectDir === workdir
    ? { key: "workdir_consistent", status: "pass", detail: `config.codexProjectDir=${workdir} (config only — live cwd/bridge are checked at first start)`, evidence: { config: workdir } }
    : { key: "workdir_consistent", status: "fail", detail: `config.codexProjectDir=${tfacts.workdir.configProjectDir} ≠ ${workdir}` };
  const next = `next (run from ${workdir}):\n  anet node codex start ${shellQuote(target)} --probe-from ${shellQuote(sourceName)}   # first start = verify + nonce attestation`;
  finish(targetDir, withTok.node_id ?? null, [
    checkIdentity(tfacts), checkHome(tfacts), checkSession(tfacts), workdirCheck, isolation,
    { key: "identity_attested", status: "unknown", detail: `not started yet — ${next.split("\n")[1].trim()}` },
  ], next);
}

// ── #1856 PR-D —— anet node codex account register|list|install / rollback ──
function codexLoginRegistryDir(): string { return join(home, ".anet", "codex-login"); }
function codexHostId(): string {
  let mid: string | null = null;
  for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) { try { mid = readFileSync(p, "utf-8").trim() || null; if (mid) break; } catch { /* next */ } }
  return hostIdOf(mid, hostname());
}
function readAuthFingerprint(file: string): string | null {
  try { return accountFingerprint(JSON.parse(readFileSync(file, "utf-8"))); } catch { return null; }
}

async function codexAccountCommand(sub: string, arg: string | undefined, opts: Record<string, string>) {
  const json = opts.json === "true";
  const dir = codexLoginRegistryDir();
  const hostId = codexHostId();
  if (sub === "register") {
    const profileId = String(arg ?? "");
    const from = String(opts["from-codex-home"] ?? "");
    if (!profileId || !from) { console.error("Usage: anet node codex account register <profile-id> --from-codex-home <dir>"); process.exit(2); }
    let ref; try { ref = parseSourceRef(`codex-login:${profileId}`); } catch (e: any) { console.error(`[anet] account register: ${e.message}`); process.exit(2); }
    const authFile = join(from, "auth.json");
    if (!existsSync(authFile)) { console.error(`[anet] account register: ${authFile} not found — log in there first (CODEX_HOME=${from} codex login)`); process.exit(2); }
    let fp: string; try { fp = accountFingerprint(JSON.parse(readFileSync(authFile, "utf-8"))); } catch (e: any) { console.error(`[anet] account register: ${e.message}`); process.exit(2); }
    const reg = readRegistry(dir, hostId);
    if (reg.profiles[ref.profileId] && opts.force !== "true") { console.error(`[anet] account register: profile ${ref.profileId} already exists (fingerprint ${reg.profiles[ref.profileId].account_fingerprint}); pass --force to replace`); process.exit(2); }
    const pdir = join(dir, "profiles", ref.profileId);
    mkdirSync(pdir, { recursive: true, mode: 0o700 }); chmodSync(pdir, 0o700);
    const tmp = join(pdir, `auth.json.tmp.${process.pid}`);
    copyFileSync(authFile, tmp); chmodSync(tmp, 0o600); renameSync(tmp, join(pdir, "auth.json"));
    const entry: RegistryEntry = { schema_version: 1, profile_id: ref.profileId, provider: "openai-chatgpt", host_id: hostId, credential_ref: credentialRefFor(ref.profileId), account_fingerprint: fp, created_at: new Date().toISOString(), last_model_probe_at: null, last_model_probe_status: null, revoked: false, disabled: false };
    reg.profiles[ref.profileId] = entry; reg.host_id = hostId;
    writeRegistry(dir, reg);
    if (json) console.log(JSON.stringify({ ok: true, profile_id: ref.profileId, account_fingerprint: fp, host_id: hostId }, null, 2));
    else console.log(`[anet] account register: codex-login:${ref.profileId} → fingerprint ${fp} (host-bound; credential stored 0600 in the local registry)`);
    return;
  }
  if (sub === "list") {
    const reg = readRegistry(dir, hostId);
    const rows = Object.values(reg.profiles).map((e) => ({ profile_id: e.profile_id, provider: e.provider, account_fingerprint: e.account_fingerprint, host_ok: e.host_id === hostId, last_model_probe_at: e.last_model_probe_at, last_model_probe_status: e.last_model_probe_status, revoked: e.revoked, disabled: e.disabled }));
    if (json) { console.log(JSON.stringify(rows, null, 2)); return; }
    if (rows.length === 0) { console.log("[anet] no codex-login profiles registered on this host (anet node codex account register <id> --from-codex-home <dir>)"); return; }
    for (const r of rows) console.log(`codex-login:${r.profile_id}  fp=${r.account_fingerprint}  host=${r.host_ok ? "ok" : "MISMATCH"}  probe=${r.last_model_probe_status ?? "-"}@${r.last_model_probe_at ?? "-"}${r.revoked ? "  REVOKED" : ""}${r.disabled ? "  DISABLED" : ""}`);
    return;
  }
  if (sub !== "install") { console.error("Usage: anet node codex account <register|list|install> …"); process.exit(2); }
  const alias = String(arg ?? "");
  if (!alias) { console.error("Usage: anet node codex account install <alias> --source codex-login:<profile-id> [--probe-from <peer>] [--model <m>] [--json]"); process.exit(2); }
  let src; try { src = parseSourceRef(String(opts.source ?? "")); } catch (e: any) { console.error(`[anet] account install: ${e.message}`); process.exit(2); }
  const reg = readRegistry(dir, hostId);
  let resolvedProfile; try { resolvedProfile = resolveProfile(dir, reg, src.profileId, hostId); } catch (e: any) { console.error(`[anet] account install: ${e.message}`); process.exit(2); }
  const ctx = await codexLifecycleCtx("account-install", alias, opts);
  // 与 start/restart 一样必须在 codexProjectDir 里跑(ctx 里的 cwd 守卫只看 start/restart/resume,这里补一次)。
  if (ctx.profile.codexProjectDir) {
    let here = process.cwd(); try { here = realpathSync(here); } catch { /* keep */ }
    let want = String(ctx.profile.codexProjectDir); try { want = realpathSync(want); } catch { /* keep */ }
    if (here !== want) { console.error(`[anet] account install: run this from the node's workdir: cd ${shellQuote(want)}`); process.exit(2); }
  }
  const peer = opts["probe-from"] ? resolveNodeRefAt(opts["probe-root"], String(opts["probe-from"])) : null;
  if (opts["probe-from"] && !peer) { console.error(`[anet] account install: --probe-from ${opts["probe-from"]}: unknown local node`); process.exit(2); }
  if (peer && peer.id === ctx.resolved.id) { console.error(`[anet] account install: --probe-from must be a *different* node`); process.exit(2); }
  const restartActions = codexRestartActions({ ...ctx, verb: "restart" }, peer);
  const receiptId = `${ctx.startedAt.toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const targetAuth = join(ctx.codexHome, "auth.json");
  const model = String(opts.model ?? ctx.profile.model ?? defaultCodexModelForRuntime("codex-app-server") ?? "");
  const outcome = await runAccountInstall({ profileId: src.profileId, sourceFingerprint: resolvedProfile.entry.account_fingerprint }, {
    preflightBlocks: async () => {
      const facts = await ctx.gather();
      return evaluateCodexPreflight(facts).filter((c) => c.status === "fail").map((c) => c.key);
    },
    currentFingerprint: async () => readAuthFingerprint(targetAuth),
    probe: async () => {
      // 隔离 staging HOME:只放 profile 的 auth.json + 目标的 config.toml;用 codex exec 发一次最小请求(零推理,固定回句)。
      const staging = mkdtempSync(join(tmpdir(), "anet-codex-probe-"));
      try {
        const sh = join(staging, "home"); mkdirSync(sh, { mode: 0o700 });
        copyFileSync(resolvedProfile.credentialFile, join(sh, "auth.json")); chmodSync(join(sh, "auth.json"), 0o600);
        if (existsSync(join(ctx.codexHome, "config.toml"))) copyFileSync(join(ctx.codexHome, "config.toml"), join(sh, "config.toml"));
        const wd = join(staging, "wd"); mkdirSync(wd);
        const argv = ["exec", "--skip-git-repo-check", "--ephemeral", "--color", "never", "-s", "read-only", "-C", wd, ...(model ? ["-m", model] : []), "Reply with exactly ANET-PROBE-OK and nothing else."];
        const r = spawnSync("codex", argv, { env: { ...process.env, CODEX_HOME: sh }, encoding: "utf-8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 });
        const status = classifyProbe(r.status, r.stdout ?? "", r.stderr ?? "");
        const tail = `${r.stderr ?? ""}`.trim().split("\n").slice(-3).join(" | ").slice(0, 300);
        ctx.say(`fresh model probe (${model || "default model"}) → ${status}`);
        return { status, detail: status === "ok" ? `codex exec answered with the sentinel (model ${model || "default"})` : `exit ${r.status ?? "timeout"}: ${tail || "(no stderr)"}` };
      } finally { rmSync(staging, { recursive: true, force: true }); }
    },
    backup: async () => {
      const ref = backupRefFor(receiptId);
      const dst = backupPathFor(ctx.nodeDir, ref);
      mkdirSync(join(ctx.nodeDir, "receipts"), { recursive: true, mode: 0o700 });
      if (existsSync(targetAuth)) { copyFileSync(targetAuth, dst); chmodSync(dst, 0o600); } else { writeFileSync(dst, "", { mode: 0o600 }); }
      ctx.say(`backup → ${ref}`);
      return { backupRef: ref };
    },
    install: async () => {
      const tmp = `${targetAuth}.tmp.${process.pid}`;
      copyFileSync(resolvedProfile.credentialFile, tmp); chmodSync(tmp, 0o600); renameSync(tmp, targetAuth);
      ctx.say(`installed codex-login:${src.profileId} into CODEX_HOME (0600)`);
    },
    restart: async () => runCodexRestart("restart", restartActions),
    restore: async (ref) => {
      const bak = backupPathFor(ctx.nodeDir, ref);
      if (statSync(bak).size === 0) { rmSync(targetAuth, { force: true }); return; }
      const tmp = `${targetAuth}.tmp.${process.pid}`;
      copyFileSync(bak, tmp); chmodSync(tmp, 0o600); renameSync(tmp, targetAuth);
      ctx.say(`restored previous auth.json from ${ref}`);
    },
    recordProbe: async (status: ProbeStatus) => {
      const r2 = readRegistry(dir, hostId);
      const e = r2.profiles[src.profileId]; if (!e) return;
      e.last_model_probe_at = new Date().toISOString(); e.last_model_probe_status = status;
      writeRegistry(dir, r2);
    },
  });
  const receipt = buildReceipt({ verb: "account-install", alias: ctx.displayName, nodeId: ctx.profile.node_id ?? null, startedAt: ctx.startedAt, checks: outcome.checks });
  const withRef = { ...receipt, id: receiptId, source_profile_id: src.profileId, source_account_fingerprint: resolvedProfile.entry.account_fingerprint, backup_ref: outcome.backupRef, stoppedAt: outcome.stoppedAt, rolledBack: outcome.rolledBack };
  const path = writeReceipt(ctx.nodeDir, withRef as any);
  if (json) console.log(JSON.stringify({ ...withRef, receiptPath: path }, null, 2));
  else { console.log(formatReceiptSummary(receipt)); console.log(`stopped at: ${outcome.stoppedAt}${outcome.rolledBack ? " (rolled back)" : ""}`); if (outcome.backupRef) console.log(`backup_ref: ${outcome.backupRef}   (rollback: anet node codex rollback ${shellQuote(ctx.displayName)} --receipt ${receiptId})`); console.log(`receipt: ${path}`); }
  process.exit(receipt.verdict === "PASS" ? 0 : 2);
}

async function codexRollbackCommand(alias: string, opts: Record<string, string>) {
  const json = opts.json === "true";
  const receiptId = String(opts.receipt ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{3,80}$/.test(receiptId)) { console.error("Usage: anet node codex rollback <alias> --receipt <install-receipt-id> [--probe-from <peer>]"); process.exit(2); }
  const ctx = await codexLifecycleCtx("rollback", alias, opts);
  if (ctx.profile.codexProjectDir) {
    let here = process.cwd(); try { here = realpathSync(here); } catch { /* keep */ }
    let want = String(ctx.profile.codexProjectDir); try { want = realpathSync(want); } catch { /* keep */ }
    if (here !== want) { console.error(`[anet] rollback: run this from the node's workdir: cd ${shellQuote(want)}`); process.exit(2); }
  }
  const peer = opts["probe-from"] ? resolveNodeRefAt(opts["probe-root"], String(opts["probe-from"])) : null;
  if (opts["probe-from"] && !peer) { console.error(`[anet] rollback: --probe-from ${opts["probe-from"]}: unknown local node`); process.exit(2); }
  const restartActions = codexRestartActions({ ...ctx, verb: "restart" }, peer);
  const targetAuth = join(ctx.codexHome, "auth.json");
  const outcome = await runRollback({
    readInstallReceipt: async () => {
      const p = join(ctx.nodeDir, "receipts", `${receiptId}.json`);
      if (!existsSync(p)) return null;
      try {
        const r = JSON.parse(readFileSync(p, "utf-8"));
        if (r?.verb !== "account-install" || typeof r?.backup_ref !== "string") return null;
        const prev = r.checks?.find?.((c: any) => c?.key === "account_probe")?.evidence?.targetPreviousFingerprint ?? null;
        return { backupRef: r.backup_ref, targetPreviousFingerprint: typeof prev === "string" ? prev : null };
      } catch { return null; }
    },
    backupExists: async (ref) => { try { return existsSync(backupPathFor(ctx.nodeDir, ref)); } catch { return false; } },
    restore: async (ref) => {
      const bak = backupPathFor(ctx.nodeDir, ref);
      if (statSync(bak).size === 0) { rmSync(targetAuth, { force: true }); return; }
      const tmp = `${targetAuth}.tmp.${process.pid}`;
      copyFileSync(bak, tmp); chmodSync(tmp, 0o600); renameSync(tmp, targetAuth);
      ctx.say(`restored auth.json from ${ref}`);
    },
    restart: async () => runCodexRestart("restart", restartActions),
    currentFingerprint: async () => readAuthFingerprint(targetAuth),
  });
  const receipt = buildReceipt({ verb: "rollback", alias: ctx.displayName, nodeId: ctx.profile.node_id ?? null, startedAt: ctx.startedAt, checks: outcome.checks });
  const path = writeReceipt(ctx.nodeDir, { ...receipt, rolled_back_from: receiptId, backup_ref: outcome.backupRef } as any);
  if (json) console.log(JSON.stringify({ ...receipt, rolledBackFrom: receiptId, backupRef: outcome.backupRef, stoppedAt: outcome.stoppedAt, receiptPath: path }, null, 2));
  else { console.log(formatReceiptSummary(receipt)); console.log(`stopped at: ${outcome.stoppedAt}`); console.log(`receipt: ${path}`); }
  process.exit(receipt.verdict === "PASS" ? 0 : 2);
}

async function resumeCommand() {
  const ref = args[1];
  if (!ref) {
    console.error("Usage: anet node resume <node-name> --session <session-id>");
    console.error("Daily start/resume: anet node start <node-name>");
    return;
  }

  const resolved = resolveNodeRef(ref);
  let nodeId = resolved?.id || ref;
  let profile = resolved?.profile || null;
  const opts = parseOpts();
  const sessionId = opts.session;

  if (!sessionId) {
    console.warn(`[deprecated] anet node resume <node-name> without --session is now anet node start <node-name>.`);
    await launchAgent(nodeId, false);
    return;
  }

  if (!resolved) validateNodeName(nodeId);
  if (!profile) {
    const createOpts = { ...opts, session: sessionId, runtime: opts.runtime || "claude-agent-sdk" } as unknown as ReturnType<typeof parseOpts>;
    profile = await ensureNodeToken(createProfileFromOpts(nodeId, createOpts), nodeId);
    saveProfile(nodeId, profile);
    console.log(`[anet] Created node "${nodeId}"`);
  } else {
    const existing = profileSession(profile);
    if (existing && existing !== sessionId && opts.yes !== "true") {
      const answer = await ask(`[anet] ${nodeId} already has session ${existing.slice(0, 8)}..., overwrite? (y/n)`, "n");
      closeRL();
      if (!/^y(es)?$/i.test(answer)) {
        console.log("[anet] Session unchanged.");
        return;
      }
    }
    const stored = loadStoredProfile(nodeId) || profile;
    const runtime = normalizeRuntime(stored);
    if (runtime === "grok-build-cli") stored.grokCliSession = sessionId;
    else if (runtime === "grok-build-acp") stored.grokSession = sessionId;
    else stored.session = sessionId;
    await ensureNodeToken(stored, nodeId);
    saveProfile(nodeId, stored);
  }

  console.log(`[anet] Saved session ${sessionId.slice(0, 8)}... to .anet/nodes/${nodeId}/config.json\n`);
  await launchAgent(nodeId, false);
}

function showProfiles(cmd: string) {
  const ids = listProfileIds();
  if (ids.length === 0) {
    console.log("No nodes. Run: anet node create <node-name>");
    return;
  }
  console.log("\nNodes:\n");
  for (const id of ids) {
    const p = loadProfile(id);
    const displayName = nodeDisplayName(id, p);
    console.log(`  ${id} (${displayName})  node_id=${p?.node_id || "-"}  [${normalizeRuntime(p || undefined)}]  session=${p ? profileSession(p).slice(0, 8) || "-" : "-"}  channels=[${p?.channels.join(", ")}]`);
  }
  console.log(`\nanet ${cmd} <node-id|node-name>\n`);
}

// ── ls ──

async function lsCommand() {
  const ids = listProfileIds();
  // #101 user warning — verbose mode (`anet ls -v` / `--verbose`) prints a
  // second line per node with the resolved toolset + flag set so users can
  // see at a glance what each agent in the network is empowered to do.
  const verbose = args.includes("-v") || args.includes("--verbose");

  // Fetch CommHub status first
  const gc = loadGlobal();
  let networkSessions: any[] = [];
  // #473 tristate: sseDetail.ok=false → detail unavailable (non-admin/403),
  // per-node column shows "?" not a false "not connected".
  let sseDetail: SseDetail = { ok: false, sessions: {} };

  if (gc.hub) {
    try {
      const [statusRes, sseRes] = await Promise.all([
        fetch(`${gc.hub}/api/status`, { headers: authHeaders() }).then(r => r.json() as any),
        fetchSseSessions(gc.hub), // #473: was /health.sse_sessions (now auth-gated)
      ]);
      networkSessions = statusRes.sessions || [];
      sseDetail = sseRes;
    } catch {}
  }

  // Nodes with network status
  if (ids.length > 0) {
    console.log("\nNodes:\n");
    // 🔴 列宽从 SUPPORTED_RUNTIME_NAMES 算,不写死:runtime 名最长 16
    // (claude-agent-sdk / codex-app-server),原先写死 14 会把 STATUS 顶偏 1–2 列。
    // 表头 / 分隔线 / 数据行三处用同一个宽度,不再各写各的字面量。
    const runtimeW = runtimeColumnWidth(SUPPORTED_RUNTIME_NAMES);
    console.log(lsHeaderRow(runtimeW));
    console.log(lsSeparatorRow(runtimeW));
    for (const id of ids) {
      const p = loadProfile(id);
      const displayName = nodeDisplayName(id, p);
      const runtime = normalizeRuntime(p || undefined);
      const session = p ? profileSession(p).slice(0, 8) || "-" : "-";

      // Check PID
      const pidFile = join(nodesDir(), id, ".pid");
      let localAlive = false;
      if (existsSync(pidFile)) {
        const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
        try { process.kill(pid, 0); localAlive = true; } catch {}
      }

      // Match with CommHub
      const ns: any = networkSessions.find((n: any) => n.alias === displayName || n.node_id === p?.node_id);
      const serverStatus = ns ? ns.status : (localAlive ? "starting" : "offline");
      const sseConnected = !sseDetail.ok ? "?" : (sseDetail.sessions[displayName] ? "●" : "○");

      const statusIcon = serverStatus === "idle" ? "idle" :
                         serverStatus === "working" ? "working" :
                         serverStatus === "offline" ? "offline" :
                         serverStatus;
      console.log(`  ${padDisplayEnd(displayName, 20)} ${padDisplayEnd(runtime, runtimeW)} ${statusIcon.padEnd(8)} ${sseConnected.padEnd(4)} ${session}`);
      if (verbose && p) {
        // #101 verbose — second line shows tools + flags. Width-matched to the
        // header so it lines up under NAME.
        const toolsArr = Array.isArray(p.tools) ? p.tools : [];
        const toolsLabel = toolsArr.length ? `[${toolsArr.join(",")}]` : "all (preset)";
        const flags = (p as any).flags || {};
        const flagLabel = flags.dangerouslySkipPermissions === false ? "permGate=on" : "permGate=off";
        console.log(`  ${" ".repeat(20)} tools=${toolsLabel}  ${flagLabel}`);
        if (runtime === "codex-app-server") {
          const audit = codexTopologyAudit(p as any, join(nodesDir(), id), process.cwd());
          const verified = audit.lastRecoveryVerification as any;
          console.log(`  ${" ".repeat(20)} launch=${audit.launchMode} cwd=${audit.cwd}`);
          console.log(`  ${" ".repeat(20)} CODEX_HOME=${audit.codexHome} remote=${audit.remote || "-"} thread=${audit.threadId || "-"} model=${audit.model || "-"}`);
          console.log(`  ${" ".repeat(20)} recovery=${verified ? `${verified.method} verified ${verified.verifiedAt} turns=${verified.historyTurnCount}` : "not verified"}`);
        }
      }
    }
    console.log();
  }

  // Local sessions
  const cwd = process.cwd();
  const sessionsDir = join(home, ".claude", "sessions");
  const localSessions: any[] = [];

  if (existsSync(sessionsDir)) {
    for (const f of readdirSync(sessionsDir).filter(f => f.endsWith(".json"))) {
      try {
        const data = JSON.parse(readFileSync(join(sessionsDir, f), "utf-8"));
        if (data.cwd === cwd) localSessions.push(data);
      } catch {}
    }
  }

  if (localSessions.length === 0 && ids.length === 0) {
    console.log("No sessions or nodes in this directory.");
    console.log("Get started: anet init\n");
    return;
  }

  // Display sessions
  if (localSessions.length > 0) {
    console.log(`Sessions (${cwd}):\n`);
    console.log("  SESSION              PID     NETWORK");
    console.log("  ──────────────────── ─────── ─────────────────────");

    for (const s of localSessions) {
      const shortId = s.sessionId.slice(0, 18);
      let alive = false;
      try { process.kill(s.pid, 0); alive = true; } catch {}

      // Find in CommHub
      let network = "(not in network)";
      const projectKey = encodeCwd(cwd);
      const aliasEnvPath = join(home, ".claude", "channels", "commhub", projectKey, ".env");
      if (existsSync(aliasEnvPath)) {
        const content = readFileSync(aliasEnvPath, "utf-8");
        const match = content.match(/COMMHUB_ALIAS=(.+)/);
        if (match) {
          const alias = match[1].trim();
          const ns: any = networkSessions.find((n: any) => n.alias === alias);
          const sse = !sseDetail.ok ? "?" : (sseDetail.sessions[alias] ? "●" : "○");
          network = ns ? `${alias} ${ns.status} ${sse}` : `${alias} (not registered)`;
        }
      }

      console.log(`  ${shortId}  ${(alive ? `${s.pid}` : `${s.pid}✕`).padEnd(7)} ${network}`);
    }
    console.log();
  }
}

// ── run ──

async function runCommand() {
  const gc = loadGlobal();
  const opts = parseOpts();
  const hub = process.env.COMMHUB_URL || opts.hub || gc.hub || "http://127.0.0.1:9200";
  const alias = process.env.COMMHUB_ALIAS || opts.alias;

  if (!alias) { console.error("Error: --alias required"); process.exit(1); }

  const { CommHub } = await import("../src/client.js");
  const hub2 = new CommHub({ url: hub, alias });
  hub2.on("task", async (msg: any) => {
    console.log(`[${alias}] ← ${msg.from_session}: ${msg.content.slice(0, 100)}`);
    await hub2.send(msg.from_session, `[${alias}] 收到: ${msg.content.slice(0, 200)}`);
  });
  hub2.on("connected", () => console.log(`[${alias}] Connected`));
  hub2.on("disconnected", () => console.log(`[${alias}] Reconnecting...`));
  process.on("SIGINT", () => hub2.disconnect().then(() => process.exit(0)));
  console.log(`[${alias}] Listening on ${hub}`);
}

// ── server ──

// #199/#200 — find PIDs listening on a given TCP port (lsof-based). Used by
// `anet hub stop` / `anet hub status` to identify the running commhub-server
// process when the user doesn't have it in the foreground.
function findHubPids(port: string | number): number[] {
  try {
    const out = execFileSync("lsof", ["-t", "-i", `:${port}`, "-sTCP:LISTEN"], { encoding: "utf-8" }).toString().trim();
    if (!out) return [];
    return out.split(/\s+/).map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n));
  } catch { return []; }
}

async function serverCommand() {
  const sub = args[1];
  if (sub === "start" || sub === "local" || !sub) {
    // anet hub start — start the CommHub Server only.
    // Auth (register/login) is NOT done here; user runs `anet register` or `anet login`
    // after this. Keeps token state managed in one place and avoids rotation
    // out-of-sync between hub-start and the saved global config.
    const opts = parseOpts();
    const port = opts.port || "9200";
    // --host / --ip flag (or HOST env) controls the bind address. Default to
    // 127.0.0.1 (loopback only) for safety; users running on a remote box
    // who want LAN access pass --ip 0.0.0.0 explicitly.
    const host = opts.ip || opts.host || process.env.HOST || "127.0.0.1";
    const sc = loadServerConfig();
    const devOpen = opts["dev-open"] === "true";
    let tokenSource: "flag" | "env" | "dev-open" | "none" = devOpen ? "dev-open" : "none";
    let token = "";
    if (serverAuthTokenFromConfig(sc)) {
      console.warn(`[anet] ⚠ ~/.anet/server/config.json auth_token is deprecated and ignored in v0.8. See RFC-001.`);
    }
    if (!devOpen) {
      if (opts.token) { token = opts.token; tokenSource = "flag"; }
      else if (process.env.COMMHUB_AUTH_TOKEN) { token = process.env.COMMHUB_AUTH_TOKEN; tokenSource = "env"; }
      if (token) console.warn(`[anet] ⚠ COMMHUB_AUTH_TOKEN / --token is deprecated and will be removed in v1.0. See RFC-001.`);
    }
    const gc = loadGlobal();
    // Health checks always go to loopback; the saved hub URL also stays on
    // loopback for the local machine. LAN clients use the LAN URL printed
    // below in the next-steps banner.
    const hubUrl = `http://127.0.0.1:${port}`;

    console.log(`\n  anet hub start\n`);

    // Check if server already running
    let serverAlreadyRunning = false;
    let child: any = null;
    try {
      const h = await fetch(`${hubUrl}/health`).then(r => r.json() as any);
      if (h.ok) {
        serverAlreadyRunning = true;
        console.log(`  ✅ CommHub Server already running on ${hubUrl}`);
      }
    } catch {}

    if (!serverAlreadyRunning) {
      // #235 — Preflight bun/bunx presence BEFORE spawn. commhub-server is
      // bun-only (Bun.serve + bun:sqlite, no Node equivalent), so a missing
      // bunx in PATH is a hard prerequisite failure, not a recoverable
      // runtime hiccup. Without this check, `spawnLauncher("bunx", ...)` emits an
      // ENOENT 'error' event with no listener → Node crashes with an
      // unhandled exception and a 10-line internal stack — user-hostile and
      // misdirects troubleshooting toward Node internals instead of the
      // actual missing dependency.
      //
      // The post-spawn 15s /health poll then a Bun-missing check (see
      // ~30 lines down) cannot rescue this — spawn ENOENT throws before
      // the poll loop ever runs.
      // 🔴 判据必须等于**真实需求**。下面唯一的启动方式是 `spawnLauncher("bunx", …)`
      // (cli.ts 内 commhub-server 只有这一个 spawn 点),所以「有 bun 就放行」是错的:
      // bun 单独从来不够。原来的 OR 会让 bun-only 的机器通过前置检查,
      // 然后在 spawn 处失败,并报「it disappeared from PATH」—— 而它从来没在过。
      // 实测:release zip 装的 bun 不带 bunx;只加一条 bunx 软链,hub 立刻起来(#766)。
      if (!commandExists("bunx")) {
        // bun 在、bunx 不在 —— 这是最常见也最容易被误诊的一种,单独给话术。
        if (commandExists("bun")) {
          console.error(`\n  ❌ 找到了 bun,但没有 bunx —— anet hub start 用 \`bunx\` 启动 commhub-server。`);
          console.error(`\n     bunx 通常由官方安装器创建。补一条即可:`);
          console.error(`       ln -s "$(command -v bun)" "$(dirname "$(command -v bun)")/bunx"`);
          console.error(`\n     或改用带 bunx 的安装方式:  npm i -g bun`);
          console.error(`\n     Then re-run: anet hub start\n`);
          process.exit(1);
        }
        console.error(`\n  ❌ anet hub start requires the Bun runtime (commhub-server is bun-only — uses Bun.serve + bun:sqlite, no Node fallback).`);
        console.error(`\n     Install Bun first:`);
        // 刻意不给 `curl … | bash` 一行流:那正是 #729/#733/#743 在修的 fail-open
        // 形状(管道退出码只反映 consumer)。CI 里当缺陷修,就不该在 CLI 里教用户。
        console.error(`       npm i -g bun`);
        console.error(`       # 或按 https://bun.sh/docs/installation 安装`);
        console.error(`       # restart your shell so PATH picks up ~/.bun/bin`);
        console.error(`\n     Then re-run: anet hub start`);
        console.error(`\n     More info: https://bun.sh/install\n`);
        process.exit(1);
      }
      console.log(`  Starting CommHub Server on port ${port} (bind ${host})...`);
      const env: Record<string, string> = {
        ...process.env as any,
        PORT: port,
        HOST: host,
        ...(devOpen ? { COMMHUB_DEV_OPEN: "1" } : token ? { COMMHUB_AUTH_TOKEN: token } : {}),
      };
      // Pin to a specific version (module-level constant) — see PINNED_SERVER_VERSION.
      const serverArgs = ["--bun", `@sleep2agi/commhub-server@${PINNED_SERVER_VERSION}`];
      if (devOpen) serverArgs.push("--dev-open");
      child = spawnLauncher("bunx", serverArgs, { env, stdio: "inherit" });
      // #235 — Belt-and-braces: even with the preflight above, race
      // conditions (PATH being modified mid-process, partial install) can
      // still produce an async ENOENT 'error' event. Without this handler
      // Node would crash with "Unhandled 'error' event" — defeat the
      // preflight's UX promise. Log + exit gracefully.
      child.on("error", (err: any) => {
        if (err?.code === "ENOENT") {
          console.error(`\n  ❌ Failed to spawn bunx.`);
          // 不再说 "disappeared from PATH":那条归因会把人引去查 PATH 与
          // 「谁卸载了 bun」,而绝大多数情况是这台机器从来没有过 bunx(#766)。
          console.error(`     This usually means Bun was uninstalled or PATH changed mid-process.`);
          console.error(`     Try: which bunx && bunx --version`);
        } else {
          console.error(`\n  ❌ commhub-server spawn error: ${err?.message || err}`);
        }
        process.exit(1);
      });

      // Wait for server with polling
      let ready = false;
      let serverVersion = "";
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 500));
        try {
          const h = await fetch(`${hubUrl}/health`).then(r => r.json() as any);
          if (h.ok) { ready = true; serverVersion = h.version || ""; break; }
        } catch {}
      }
      if (!ready) {
        // commhub-server is TypeScript w/ a bun shebang; it requires Bun.
        // Most Node-only systems hit this exact failure.
        let bunInstalled = false;
        // 判据与上面那道守卫同源:bunx **或** bun 任一存在即可。
        // 只探 bun 会在 bunx-only 的 PATH 上假报(同 #761 修的那处)。
        for (const probe of ["command -v bun", "command -v bunx"]) {
          try { execSync(probe, { stdio: "pipe" }); bunInstalled = true; break; } catch {}
        }
        if (!bunInstalled) {
          console.error(`  ❌ Bun is required to run commhub-server. Install with:`);
          console.error(`     npm i -g bun`);
          console.error(`     # 或按 https://bun.sh/docs/installation 安装`);
          console.error(`     # then re-run: anet hub start`);
        } else {
          console.error(`  ❌ Server failed to start. Check the bunx output above for the real error.`);
        }
        child?.kill();
        return;
      }
      console.log(`  ✅ Server running on ${hubUrl} (commhub-server v${serverVersion || "?"})`);
      if (devOpen) {
        console.log(`  ⚠️  DEV OPEN MODE`);
      } else {
        console.log(`  🔒 secured`);
      }
      // Warn loudly if user is on a known-broken old version (cache poisoning).
      if (serverVersion && serverVersion.startsWith("0.4.")) {
        console.error(`\n  ⚠️  Old commhub-server v${serverVersion} detected — task routing will not work.`);
        console.error(`     Clear caches and restart:`);
        console.error(`       pkill -f commhub-server`);
        console.error(`       bun pm cache rm  ;  rm -rf ~/.bun/install/cache/@sleep2agi`);
        console.error(`       npm cache clean --force`);
        console.error(`       anet hub start\n`);
      }
    }

    // Save hub URL + launch config. Do NOT touch gc.token here — that's owned by login.
    gc.hub = hubUrl;
    saveServerConfig({ ...sc, port, host });
    saveGlobal(gc);

    // Wait for API to fully boot (the /api/auth/* endpoints may not respond
    // immediately even after /health goes ok).
    for (let i = 0; i < 10; i++) {
      try {
        const r = await fetch(`${hubUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "__probe__", password: "______" }),
        });
        if (r.headers.get("content-type")?.includes("json")) break;
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }

    // Bootstrap an admin account without shipping default credentials.
    // Skip the whole register flow if admin-utok.json already exists —
    // re-running `anet hub start` should be idempotent.
    const existingAdmin = loadAdminUtok();
    let defaultUser = opts.username || opts.user || "";
    let defaultPass = opts.password || opts.pass || "";
    let defaultPassIsRandom = false;  // #261 P0-2 — true when we generated the random anet-XX pwd, drives the must_change_password flag + warn line
    let defaultAccountReady = false;
    let skippedBootstrap = false;
    if (existingAdmin.token) {
      skippedBootstrap = true;
      defaultAccountReady = true;
      defaultUser = existingAdmin.username || defaultUser;
      console.log(`  ✅ Admin already exists (admin-utok.json found, user=${existingAdmin.username || "?"})`);
    } else {
      // #261 P0-2 (2026-06-28): random-by-default bootstrap password.
      // Pre-fix used the well-known `anethub` literal — a public hub
      // could be system-takeover'd with a single curl. Now: explicit
      // --password / --pass flag wins (operator-supplied = trusted, NOT
      // flagged for forced rotation); env ANET_HUB_BOOTSTRAP_PASSWORD
      // wins next (for CI / unattended deploys); otherwise generate
      // `anet-<22 random hex chars>` — printed once, never echoed
      // again, flagged in DB as must_change_password=1 so the operator
      // gets a prominent "rotate now" warn on their first
      // `anet login`. Operator can switch the flag off by passing
      // `--password` / env explicitly even when reusing the same
      // string the random generator would have produced.
      if (!defaultUser) defaultUser = "admin";
      if (!defaultPass) {
        if (process.env.ANET_HUB_BOOTSTRAP_PASSWORD) {
          defaultPass = process.env.ANET_HUB_BOOTSTRAP_PASSWORD;
          // env-supplied: caller picked it, don't force rotation
        } else {
          defaultPass = `anet-${randomUUID().replace(/-/g, "").slice(0, 22)}`;
          defaultPassIsRandom = true;
        }
      }
    }
    if (!skippedBootstrap) {
      try {
        const reg = await fetch(`${hubUrl}/api/auth/register`, {
          method: "POST",
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
          body: JSON.stringify({ username: defaultUser, password: defaultPass }),
        }).then(r => r.json() as any);
        if (reg.ok) {
          defaultAccountReady = true;
          if (reg.token) {
            saveAdminUtok({
              username: reg.user?.username || defaultUser,
              user_id: reg.user?.user_id,
              token: reg.token,
              created_at: new Date().toISOString(),
            });
          }
          // #261 P0-2 — if we generated a random bootstrap password, flip
          // must_change_password=1 in the DB via direct SQLite UPDATE.
          // The hub is local (we just started it), DB path resolved from
          // env / config; failure is non-fatal (op already has the
          // password and `anet passwd` works regardless of the flag).
          if (defaultPassIsRandom && reg.user?.user_id) {
            try {
              const dbPath = resolveBootstrapDatabasePath(process.env, home, process.cwd());
              const invocation = buildBootstrapPasswordUpdateInvocation(reg.user.user_id, dbPath);
              execFileSync(invocation.argv[0], invocation.argv.slice(1), {
                encoding: "utf-8",
                env: invocation.env,
              });
            } catch (e: any) {
              console.log(`  ⚠ must_change_password flag not set (non-fatal): ${e?.message || e}`);
            }
          }
          console.log(`  ✅ Admin account created`);
          console.log(`     username: ${defaultUser}`);
          console.log(`     password: ${defaultPass}`);
          console.log(`     Store this password now; it will not be shown again.`);
          if (defaultPassIsRandom) {
            console.log(`     ⚠ This is a random bootstrap password — you'll be asked to change it on first login.`);
          }
          if (reg.token) console.log(`     Admin token saved to ~/.anet/server/admin-utok.json`);
        } else if (reg.error?.includes("already taken")) {
          defaultAccountReady = true;
          console.log(`  ℹ  Admin account "${defaultUser}" already exists`);
        } else {
          console.log(`  ⚠  Could not bootstrap admin account: ${reg.error}`);
        }
      } catch (e: any) {
        console.log(`  ⚠  Admin account bootstrap skipped: ${e.message}`);
      }
    }

    // Verify existing user token (if any) is still valid; if not, drop it so the
    // user gets a clear "please login" prompt instead of silent staleness.
    let havValidUser = false;
    if (gc.token && gc.token.startsWith("utok_")) {
      try {
        const me = await fetch(`${hubUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${gc.token}` },
        }).then(r => r.json() as any);
        if (me.ok) {
          havValidUser = true;
          console.log(`  ✅ Logged in as "${me.user.username}" (existing session)`);
        }
      } catch {}
      if (!havValidUser) {
        console.log(`  ⚠  Saved token is no longer valid. Run: anet login`);
        delete gc.token;
        delete gc.user;
        saveGlobal(gc);
      }
    }

    // Pick first non-loopback IPv4 so other machines on the LAN know how to reach us.
    let lanIp = "";
    try {
      const nets = (await import("os")).networkInterfaces();
      for (const list of Object.values(nets)) {
        for (const n of list || []) {
          if (n.family === "IPv4" && !n.internal && !lanIp) lanIp = n.address;
        }
      }
    } catch {}
    const lanUrl = lanIp ? `http://${lanIp}:${port}` : "";

    console.log(`\n  Server: ${hubUrl}${lanUrl ? `   (LAN: ${lanUrl})` : ""}\n`);

    const loginHint = (defaultAccountReady && defaultPass)
      ? `anet login --username ${defaultUser} --password ${defaultPass}`
      : `anet login`;
    // hub start does NOT persist the hub URL to global config, so a fresh
    // `anet login` fails with "No hub configured". Pin --hub to the local hub
    // explicitly (hubUrl is already http://127.0.0.1:${port} — a loopback
    // address, reachable regardless of whether the hub bound 127.0.0.1 or 0.0.0.0).
    const loginHintLocal = (defaultAccountReady && defaultPass)
      ? `anet login --hub ${hubUrl} --username ${defaultUser} --password ${defaultPass}`
      : `anet login --hub ${hubUrl}`;

    if (havValidUser) {
      console.log(`  This machine — already logged in. Next:`);
      console.log(`    anet node create my-agent`);
      console.log(`    anet node start my-agent\n`);
    } else {
      console.log(`  This machine — login then create a node:`);
      console.log(`    ${loginHintLocal}`);
      console.log(`    anet node create my-agent`);
      console.log(`    anet node start my-agent\n`);
    }

    const acceptsLan = host === "0.0.0.0" || host === "::" || (host !== "127.0.0.1" && host !== "localhost");
    if (lanUrl && acceptsLan) {
      console.log(`  Other machines connecting to this hub:`);
      console.log(`    anet init --hub ${lanUrl}`);
      console.log(`    ${loginHint}`);
      console.log(`    anet node create my-agent\n`);
    } else if (lanUrl) {
      console.log(`  LAN access: restart with --host 0.0.0.0, then other machines can use ${lanUrl}\n`);
    }

    console.log(`  Start fresh (wipe everything — local SQLite + tokens + nodes):`);
    console.log(`    # 1. stop the hub (Ctrl+C this process)`);
    console.log(`    # 2. wipe state on this machine:`);
    console.log(`    rm -rf ~/.commhub ~/.anet ./.anet`);
    console.log(`    # 3. anet hub start  again\n`);

    if (child) {
      // Forward server output
      child.stdout?.pipe(process.stdout);
      child.stderr?.pipe(process.stderr);
      child.on("exit", (code: number) => process.exit(code || 0));
      process.on("SIGINT", () => { child.kill(); process.exit(0); });
    }

  } else if (sub === "admin" && args[2] === "reset-user") {
    const opts = parseOpts();
    const username = opts.username || opts.user;
    if (!username) {
      console.error("Usage: anet hub admin reset-user --username <user>");
      return;
    }
    const dbPath = commhubDbPath();
    if (!existsSync(dbPath) && opts["i-am-on-the-hub-host"] !== "true") {
      console.error(`[anet] Refusing reset-user: local hub DB not found at ${dbPath}`);
      console.error(`[anet] Run this on the hub host, or pass --i-am-on-the-hub-host if COMMHUB_DB points to the DB.`);
      return;
    }
    const script = `
      import { Database } from "bun:sqlite";
      const db = new Database(process.env.COMMHUB_DB);
      const username = process.env.RESET_USERNAME;
      const user = db.query("SELECT user_id, username FROM users WHERE username = ?1").get(username);
      if (!user) { console.log(JSON.stringify({ ok: false, error: "user not found" })); process.exit(0); }
      const hashPassword = (p) => new Bun.CryptoHasher("sha256").update("anet:" + p).digest("hex");
      const hashToken = (t) => new Bun.CryptoHasher("sha256").update(t).digest("hex");
      const id = (prefix) => prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      const password = "anet-" + crypto.randomUUID().replace(/-/g, "").slice(0, 18);
      const token = "utok_" + crypto.randomUUID().replace(/-/g, "");
      const tokenId = id("tok");
      db.run("UPDATE users SET password_hash = ?1, updated_at = datetime('now') WHERE user_id = ?2", [hashPassword(password), user.user_id]);
      const revoked = db.run("DELETE FROM api_tokens WHERE user_id = ?1 AND network_id IS NULL", [user.user_id]).changes;
      db.run("INSERT INTO api_tokens (token_id, token_hash, user_id, network_id, name, scope) VALUES (?1, ?2, ?3, NULL, 'admin-reset', 'user')", [tokenId, hashToken(token), user.user_id]);
      db.run("INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail) VALUES (?1, ?2, 'password_reset_by_admin', 'user', ?3, 'local cli reset-user')", [user.user_id, user.username, user.user_id]);
      console.log(JSON.stringify({ ok: true, username: user.username, user_id: user.user_id, password, token, token_id: tokenId, revoked }));
    `;
    try {
      const out = runLauncherSync("bun", ["-e", script], {
        encoding: "utf-8",
        env: { ...process.env, COMMHUB_DB: dbPath, RESET_USERNAME: username },
      }).trim();
      const result = JSON.parse(out);
      if (!result.ok) {
        console.error(`[anet] reset-user failed: ${result.error}`);
        return;
      }
      console.log(`[anet] User password reset: ${result.username}`);
      console.log(`[anet] user_id: ${result.user_id}`);
      console.log(`[anet] new password: ${result.password}`);
      console.log(`[anet] new token: ${result.token}`);
      console.log(`[anet] revoked utok_: ${result.revoked}`);
      console.log(`[anet] Save this password now; it will not be shown again.`);
    } catch (e: any) {
      console.error(`[anet] reset-user failed: ${e.message}`);
    }

  } else if (sub === "config") {
    // anet server config — 显示/设置 server 配置
    const opts = parseOpts();
    const sc = loadServerConfig();
    if (opts.port) sc.port = opts.port;
    if (opts.host) sc.host = opts.host;
    if (opts.token) {
      console.warn(`[anet] ⚠ anet hub config --token is deprecated and ignored by v0.8 hub start. Use admin utok_ login instead.`);
      sc.auth_token = opts.token;
    }

    if (opts.port || opts.host || opts.token) {
      saveServerConfig(sc);
      console.log(`Server config saved: ${serverConfigPath()}`);
    }
    console.log(JSON.stringify(sc, null, 2));

  } else if (sub === "dashboard" || sub === "dash") {
    // anet hub dashboard — start Dashboard UI
    const opts = parseOpts();
    const gc = loadGlobal();
    const hubUrl = gc.hub || "http://127.0.0.1:9200";
    const dashPort = opts.port || "3000";
    const dashPortNumber = Number(dashPort);
    if (!Number.isSafeInteger(dashPortNumber) || dashPortNumber < 1 || dashPortNumber > 65535) {
      console.error(`[anet] Invalid Dashboard port: ${dashPort}`);
      process.exit(1);
    }
    // --host / --ip for LAN access; defaults to 127.0.0.1.
    const dashHost = opts.ip || opts.host || process.env.HOSTNAME || "127.0.0.1";

    const globalOptIn = process.env.ANET_DASHBOARD_LOCAL === "1";
    const tag = dashboardReleaseTag();
    const globalBinary = globalOptIn ? resolveGlobalDashboardBinary() : null;
    if (globalOptIn && !globalBinary) {
      console.error(`[anet] ANET_DASHBOARD_LOCAL=1 requested the global Dashboard, but agent-network-dashboard is not on PATH.`);
      // 🔴 NOT "channel-matched" — dashboardReleaseTag() returns "preview" for
      //    every caller. The comment at the spawn site was corrected already;
      //    this string is the same false claim in the one place a *user* reads it.
      console.error(`[anet] Install it explicitly, or unset ANET_DASHBOARD_LOCAL to fall back to npx @sleep2agi/agent-network-dashboard@${tag} (currently "${tag}" for every CLI channel).`);
      process.exit(1);
    }
    const launchSource: DashboardLaunchSource = globalOptIn ? "global" : "npx";
    const npxVersion = globalOptIn ? null : resolveDashboardNpxVersion(tag);
    const sourceKey = globalOptIn
      ? `global:${globalBinary}`
      : `npx:${npxVersion || `unresolved-${tag}`}`;

    console.log(`[anet] Starting Dashboard on ${dashHost}:${dashPort}...`);
    console.log(`[anet] Connecting to CommHub: ${hubUrl}`);

    const listenerScan = scanDashboardListenerPids(dashPort);
    if (!listenerScan.ok) {
      console.warn(`[anet] ⚠ Dashboard listener inspection unavailable: ${listenerScan.error}.`);
      console.warn(`[anet]   No process will be auto-stopped; an occupied port will fail normally.`);
    } else if (listenerScan.pids.length > 0) {
      const listenerPid = listenerScan.pids.length === 1 ? listenerScan.pids[0] : -1;
      const launchRecord = loadDashboardLaunchRecord(dashPort);
      const decision = decideDashboardListener({
        port: dashPortNumber,
        listenerPids: listenerScan.pids,
        record: launchRecord,
        listenerBirth: listenerPid > 1 ? dashboardProcessField(listenerPid, "lstart") : null,
        listenerCommand: listenerPid > 1 ? dashboardProcessField(listenerPid, "command") : null,
        desiredSource: launchSource,
        desiredSourceKey: sourceKey,
        healthy: await dashboardHttpHealthy(dashHost, dashPort),
      });
      if (decision.action === "already_running") {
        console.log(`[anet] ✅ Dashboard already running on ${dashHost}:${dashPort} (managed pid ${decision.pid}); leaving it untouched.`);
        return;
      }
      if (decision.action === "refuse") {
        console.error(`[anet] Refusing automatic Dashboard cleanup: ${decision.reason}.`);
        console.error(`[anet] Inspect the exact listener manually; anet never uses pkill/killall/prefix matching here.`);
        process.exit(1);
      }
      if (decision.action === "terminate_owned_stale") {
        console.log(`[anet] stopping exact managed stale Dashboard pid ${decision.pid} (${decision.reason})...`);
        if (!launchRecord || !await stopExactManagedDashboard(decision.pid, dashPort, launchRecord)) {
          console.error(`[anet] Refusing replacement startup: exact managed pid ${decision.pid} still owns port ${dashPort}.`);
          process.exit(1);
        }
      }
    }
    const adminUtok = loadAdminUtok();
    const fallbackMaster = process.env.COMMHUB_AUTH_TOKEN;
    const dashboardToken = adminUtok.token || fallbackMaster || "";
    if (dashboardToken) {
      if (adminUtok.token) console.log(`[anet] 🔒 Dashboard auth token loaded from admin-utok.json`);
      else console.warn(`[anet] ⚠ COMMHUB_AUTH_TOKEN fallback is deprecated and will be removed in v1.0. See RFC-001.`);
    } else {
      console.warn(`[anet] Could not auto-read admin utok. If hub is on another machine, login in the Dashboard UI or pass COMMHUB_AUTH_TOKEN=<hub's token> temporarily.`);
    }

    const env: Record<string, string> = {
      ...process.env as any,
      PORT: dashPort,
      HOSTNAME: dashHost,
      NEXT_PUBLIC_COMMHUB_URL: hubUrl,
      COMMHUB_URL: hubUrl,
      ...(dashboardToken ? { COMMHUB_AUTH_TOKEN: dashboardToken } : {}),
    };

    // 🔴 The default is NOT channel-matched — this comment used to say it was.
    // dashboardReleaseTag() returns "preview" for every caller (see its own
    // comment for the #61 reason), so a user on the stable `anet` channel gets
    // the preview Dashboard. That is a deliberate temporary decision, but the
    // sentence here claimed the opposite and was the only thing most readers
    // of this call site would see.
    //
    // The runtime output is honest — the spawn line below prints the actual
    // `@${tag}` — so this was a comment that disagreed with both the code and
    // the program's own output.
    //
    // A global binary is used only after the explicit ANET_DASHBOARD_LOCAL=1
    // opt-in.
    cleanStaleNpxDashboardTemp(); // #89 — self-heal npx cache before spawn
    console.log(globalOptIn
      ? `[anet] spawning explicit global Dashboard ${globalBinary} (anet ${getAnetVersion() || "unknown"})`
      : `[anet] spawning dashboard @${tag}${npxVersion ? ` (${npxVersion})` : ""} (anet ${getAnetVersion() || "unknown"})`);
    // #214 P2.6 — first launch compiles Next.js routes on demand and can
    // take 30-60s on cold caches. Users mistook the silence for a hang and
    // killed the spawn. Surface the expectation up-front.
    console.log(`[anet] note: first launch compiles Next.js routes — expect 30-60s before http://${dashHost}:${dashPort} responds.`);
    const dashChild = globalOptIn
      ? spawn(globalBinary!, [], { env, stdio: "inherit" })
      : spawnLauncher("npx", ["-y", `@sleep2agi/agent-network-dashboard@${tag}`], { env, stdio: "inherit" });
    dashChild.on("error", () => {
      if (globalOptIn) console.error(`[anet] Failed to start explicit global Dashboard: ${globalBinary}`);
      else {
        console.error(`[anet] Dashboard package not found. Install manually:`);
        console.error(`  npx @sleep2agi/agent-network-dashboard`);
      }
    });
    dashChild.on("exit", (code) => process.exit(code || 0));
    process.on("SIGINT", () => { dashChild.kill(); process.exit(0); });

    // Record the exact listener only after proving it is a descendant of the
    // child we just spawned. This record + port PID + birth fingerprint are
    // all required before a future invocation may stop anything.
    let listenerRecorded = false;
    for (let i = 0; i < 120; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const scan = scanDashboardListenerPids(dashPort);
      if (!scan.ok || scan.pids.length !== 1) continue;
      const listenerPid = scan.pids[0];
      if (!dashboardListenerDescendsFrom(listenerPid, dashChild.pid || -1)) continue;
      if (!await dashboardHttpHealthy(dashHost, dashPort)) continue;
      const listenerBirth = dashboardProcessField(listenerPid, "lstart");
      if (!listenerBirth) break;
      ensurePrivateDirectory(dirname(dashboardLaunchRecordPath(dashPort)));
      atomicWritePrivateJson(dashboardLaunchRecordPath(dashPort), {
        schema: 1,
        port: dashPortNumber,
        listener_pid: listenerPid,
        listener_birth: listenerBirth,
        source: launchSource,
        source_key: sourceKey,
        recorded_at: new Date().toISOString(),
      } satisfies DashboardLaunchRecord);
      console.log(`[anet] ✅ Dashboard ready; managed listener recorded (pid ${listenerPid}).`);
      listenerRecorded = true;
      break;
    }
    if (!listenerRecorded) {
      console.warn(`[anet] ⚠ Dashboard listener could not be ownership-verified; no managed record was written.`);
      console.warn(`[anet]   Future cleanup will fail closed instead of guessing which process to stop.`);
    }

  } else if (sub === "stop") {
    // #200 — graceful stop: lsof -ti:<port> → SIGTERM each → 3s grace → SIGKILL leftovers.
    const opts = parseOpts();
    const sc = loadServerConfig();
    const port = String(opts.port || sc.port || "9200");
    const pids = findHubPids(port);
    if (pids.length === 0) {
      console.log(`[anet] No hub server listening on port ${port}.`);
      return;
    }
    console.log(`[anet] stopping hub (pid ${pids.join(", ")} on port ${port})...`);
    for (const pid of pids) {
      try { process.kill(pid, "SIGTERM"); } catch (e: any) {
        console.warn(`[anet] ⚠ SIGTERM ${pid} failed: ${e?.message || e}`);
      }
    }
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 250));
      if (findHubPids(port).length === 0) {
        console.log(`[anet] ✅ Stopped.`);
        return;
      }
    }
    const leftover = findHubPids(port);
    for (const pid of leftover) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
    await new Promise(r => setTimeout(r, 500));
    const remaining = findHubPids(port);
    if (remaining.length === 0) console.log(`[anet] ✅ Stopped (after SIGKILL).`);
    else console.error(`[anet] ⚠ Hub pid(s) ${remaining.join(", ")} still on port ${port}; check manually.`);

  } else if (sub === "status") {
    // #200 + #214 维度 1 / F7-04 — show hub running state.
    //
    // 通信工程马 rewrite: previously this command keyed off `lsof` PIDs first
    // and said "Hub not running" if the lookup returned empty. In containers
    // where lsof is missing or returns odd output (e.g. node:24-slim
    // without procps), users saw false "not running" reports even when
    // /health was 200. lsof on alpine also sometimes streamed an
    // unbounded series of integers that join(", ") rendered as
    // "1, 0, 1, 1, 1, 2, 1, 10, ..." (#214 F7-04).
    //
    // New shape: /health is the source of truth. PIDs are best-effort and
    // sanity-filtered. Output gives users a clear next-step regardless of
    // the host environment.
    const opts = parseOpts();
    const sc = loadServerConfig();
    const port = String(opts.port || sc.port || "9200");

    let healthy = false;
    let version = "?";
    try {
      const h = await fetch(`http://127.0.0.1:${port}/health`).then(r => r.json() as any);
      if (h.ok) { healthy = true; version = h.version || "?"; }
    } catch {}

    // Sanity-filter: dedup + drop implausible PIDs (Linux PID_MAX_LIMIT ≤
    // 2^22 = 4194304). Some lsof builds emit fd numbers interleaved with
    // PIDs when the format string is unexpected; the filter limits visible
    // damage even if the env returns garbage.
    const pidsRaw = findHubPids(port);
    const pids = [...new Set(pidsRaw)].filter(p => Number.isInteger(p) && p > 0 && p < 4_194_304);
    // A real commhub-server is 1 process. If lsof reports >5 distinct PIDs
    // on the same port, the environment's lsof (e.g. busybox on alpine) is
    // streaming garbage; show only a hint of the count instead of a
    // misleading list.
    const pidsDisplay = pids.length > 5
      ? `${pids.slice(0, 3).join(", ")}, ... (+${pids.length - 3} more — lsof in this environment may be returning extra fd numbers)`
      : pids.join(", ");

    if (healthy) {
      console.log(`[anet] ✅ hub running on http://127.0.0.1:${port}`);
      console.log(`[anet]   server version: commhub-server v${version}`);
      if (pids.length > 0) console.log(`[anet]   pid(s):         ${pidsDisplay}`);
      else console.log(`[anet]   pid(s):         (lsof unavailable in this environment — health check is authoritative)`);
    } else if (pids.length > 0) {
      console.log(`[anet] ⚠ port ${port} held but /health not OK on http://127.0.0.1:${port}`);
      console.log(`[anet]   pid(s):         ${pidsDisplay}`);
      console.log(`[anet]   server version: ? (port held by non-CommHub process or stale)`);
      console.log(`[anet]   Hint:           anet hub stop  # graceful, then anet hub start`);
    } else {
      console.log(`[anet] Hub not running on port ${port}.`);
      console.log(`[anet]    Start: anet hub start`);
    }

  } else {
    printHubHelp();
  }
}

// #240 — Extracted from serverCommand's else branch so the #215 universal
// --help intercept can route `anet hub --help` here instead of bouncing to
// global printHelp() (which hid stop/status entirely — looked like a
// regression even though the routes were still wired).
function printHubHelp() {
  console.log(`
anet hub <command>

  start [options]    Start CommHub Server (bootstraps admin account; login separately)
  stop  [--port <p>] Stop the running CommHub Server (SIGTERM → 3s grace → SIGKILL)
  status [--port <p>] Show hub PID + port + /health version
  dashboard          Start Dashboard UI
  config [options]   Show/set server config

Options:
  --port <port>      Port (default: 9200)
  --host <host>      Bind address (default: 127.0.0.1)
  --token <token>    Legacy master token (deprecated; prefer user/ntok auth)
  --dev-open         Disable hub auth for local development only

Options:
  --port <port>      Port (default: 9200 for server, 3000 for dashboard)
  --username <user>  Bootstrap admin username
  --password <pass>  Bootstrap admin password (default: a random anet-xxxx, printed once)

Example:
  anet hub start                 # Start server + bootstrap admin account
  anet hub dashboard             # Start Dashboard UI
  anet hub start --host 0.0.0.0  # Allow LAN agents
  anet hub start --port 8080     # Custom port
  anet hub config                # Show config
`);
}

// ── daemon (RFC-026 P2 / issue #338 lane①) ──
//
// `anet daemon` = zero-config-edit `host_supervisor` node provisioning.
// The Vincent friction this kills: pre-RFC-026 P2, registering a machine
// as a schedulable host_supervisor required manually editing
// `.anet/nodes/<name>/config.json` to add `"role": "host_supervisor"`.
// `anet node create` had no role concept; users hit `no_host_supervisor_daemon`
// from dashboard with no path forward except vim-and-restart.
//
// Surface:
//   anet daemon init <name>   create config.json with role + defaults
//   anet daemon start <name>  start daemon (delegates to startCommand)
//   anet daemon up [<name>]   init+start one-shot (default name: "daemon")
//   anet daemon list          list locally-configured daemons
//
// Idempotence (init):
//   - profile exists with role=host_supervisor → no-op + success log
//   - profile exists with different/no role → REFUSE unless --force
//   - profile absent → mint ntok + write config + log next step
//
// Defaults (RFC-026 §9.3 daemon-self-declare):
//   role: "host_supervisor"
//   runtime: "claude-agent-sdk"  (lightest, just the SSE doorbell loop)
//   runtimes_supported: [...SUPPORTED_RUNTIME_NAMES]
//     🔴 不要在这里重抄那个列表。#1298 之前它是硬编码的三元组,于是
//     grok-build-cli / codex-app-server / opencode-cli 三个共存 runtime
//     永远不出现在 daemon 的能力声明里,hub 据此把 create_node 拒掉。
//     唯一真源是 agent-network/src/normalize-runtime.ts 的
//     SUPPORTED_RUNTIME_NAMES —— 抄一份在注释里,它就会再漂一次。
//     (声明 ≠ 真能跑;daemon 侧 spawn 时 fail-fast 兜住 binary-missing。)
//   allowed_secret_keys: []
//     (fail-closed; operator adds via `anet daemon init --allow-secret KEY`
//     or by hand-editing — strict-by-default per RFC-026 §9.7)
//   flags: { dangerouslySkipPermissions: true, teammateMode: true }
//     (standard daemon flags, same defaults — dangerouslySkipPermissions + teammateMode on by default)
//   node_id prefix `node_daemon_` preserved for backwards-compat with
//   pre-#337 dashboard discovery heuristic (no-op cost on post-#337 hubs).

const DAEMON_DEFAULT_NAME = "daemon";

function daemonAnetBinRepairCommand(reason: string, target?: string): string {
  if (reason === "missing") {
    return "npm i -g @sleep2agi/agent-network@latest && anet daemon up";
  }
  if (reason === "relative") {
    return "ANET_BIN_ABS=$(node -e \"console.log(require('fs').realpathSync(process.argv[1]))\" $(command -v anet)) anet daemon up";
  }
  if (reason === "symlink" && target) {
    return `ANET_BIN_ABS=${shellQuote(target)} anet daemon up`;
  }
  if (reason === "writable" && target) {
    return `chmod go-w ${shellQuote(target)} && anet daemon up`;
  }
  if (reason === "not-executable" && target) {
    return `chmod +x ${shellQuote(target)} && anet daemon up`;
  }
  return "anet daemon up";
}

function findPackageJsonDirForDaemonBin(start: string): string | null {
  let dir = dirname(start);
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function verifyDaemonAnetBinIdentity(abs: string): void {
  const pkgDir = findPackageJsonDirForDaemonBin(abs);
  if (!pkgDir) {
    throw new Error(`ANET_BIN_ABS is not an anet package bin: no package.json above ${abs}. Run: unset ANET_BIN_ABS && anet daemon up`);
  }
  let pkg: any;
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
  } catch (e: any) {
    throw new Error(`ANET_BIN_ABS is not an anet package bin: cannot read package.json (${e?.message || e}). Run: npm i -g @sleep2agi/agent-network@latest`);
  }
  if (pkg?.name !== "@sleep2agi/agent-network") {
    throw new Error(`ANET_BIN_ABS is not an anet package bin: package name is ${JSON.stringify(pkg?.name)}. Run: unset ANET_BIN_ABS && anet daemon up`);
  }

  const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.anet;
  if (binRel) {
    try {
      if (realpathSync(resolve(pkgDir, binRel)) === abs) return;
    } catch { /* fall through to shim marker check */ }
  }

  // Source-tree/dev fallback: bin/anet.cjs is copied verbatim to dist/bin/anet.cjs
  // at build time, but package.json points at the dist path.
  const body = readFileSync(abs, "utf-8");
  if (abs.endsWith("/anet.cjs") && body.includes("anet 的 bin 入口垫片") && body.includes("PARSE_FLOOR")) return;

  throw new Error(`ANET_BIN_ABS is not an anet package bin: package.json bin.anet does not point at ${abs}. Run: unset ANET_BIN_ABS && anet daemon up`);
}

function resolveCurrentAnetBinForDaemon(): string {
  const fromEnv = process.env.ANET_BIN_ABS;
  const argvEntry = process.argv[1];
  const packageBin = argvEntry ? join(dirname(argvEntry), "anet.cjs") : "";
  // bin/anet.cjs intentionally rewrites argv[1] to dist/bin/cli.js before
  // importing this file. The daemon must pin the package bin shim itself
  // (the executable named by package.json), not the ESM implementation file.
  const candidate = fromEnv || (packageBin && existsSync(packageBin) ? packageBin : "");
  if (!candidate) {
    throw new Error(`no self-resolved anet package bin found next to ${argvEntry || "(missing argv[1])"}. Run: ${daemonAnetBinRepairCommand("missing")}`);
  }
  if (!isAbsolute(candidate)) {
    throw new Error(`${fromEnv ? "ANET_BIN_ABS" : "self-resolved anet binary"} is not absolute: ${candidate}. Run: ${fromEnv ? "unset ANET_BIN_ABS && anet daemon up" : daemonAnetBinRepairCommand("relative")}`);
  }
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch (e: any) {
    throw new Error(`cannot resolve anet binary ${candidate}: ${e?.message || e}. Run: ${daemonAnetBinRepairCommand("missing")}`);
  }
  if (fromEnv && real !== fromEnv) {
    throw new Error(`ANET_BIN_ABS points at a symlink: ${fromEnv} -> ${real}. Run: ${daemonAnetBinRepairCommand("symlink", real)}`);
  }
  verifyDaemonAnetBinIdentity(real);
  return real;
}

function prepareDaemonAnetBin(): void {
  if (process.platform === "win32") {
    console.error("[anet daemon] Windows is not supported for host_supervisor daemon mode yet.");
    console.error("[anet daemon] The daemon binary safety checks and child process model are POSIX-only; run this on Linux/macOS or WSL.");
    process.exit(1);
  }

  let anetBin: string;
  try {
    anetBin = resolveCurrentAnetBinForDaemon();
  } catch (e: any) {
    console.error(`[anet daemon] ${e?.message || e}`);
    process.exit(1);
  }

  const st = statSync(anetBin);
  if ((st.mode & 0o022) !== 0) {
    const before = (st.mode & 0o777).toString(8);
    console.error(`[anet daemon] refusing to start: anet binary is group/other writable (mode=${before}); daemon requires a non-writable binary.`);
    console.error(`[anet daemon] Run this once, then retry:`);
    console.error(`[anet daemon]   ${daemonAnetBinRepairCommand("writable", anetBin)}`);
    process.exit(1);
  }
  if ((st.mode & 0o111) === 0) {
    console.error(`[anet daemon] anet binary is not executable: ${anetBin}`);
    console.error(`[anet daemon] Run: ${daemonAnetBinRepairCommand("not-executable", anetBin)}`);
    process.exit(1);
  }
  if (st.uid !== 0) {
    console.log(`[anet daemon] anet binary is owned by uid=${st.uid}; accepting it as a user-managed nvm/homebrew/npm install.`);
  }

  process.env.ANET_BIN_ABS = anetBin;
  // #1299 — runtime 只在显式 opt-in 时才认 env 来源的 pin。CLI 正是用 env 把 pin
  // 交给同进程的 daemon(`daemon start/up` 是 `prepareDaemonAnetBin(); await startCommand()`),
  // 所以不声明的话,没有 /etc/anet-daemon/path.conf 的机器上 `anet daemon up` 会被自己拦下。
  process.env.ANET_DAEMON_ALLOW_ENV_BIN = "1";
  process.env.ANET_DAEMON_ALLOW_NON_ROOT_BIN = "1";
  console.log(`[anet daemon] using anet binary: ${anetBin}`);
}

async function daemonCommand() {
  const sub = args[1];
  if (!sub || sub === "help" || sub === "-h" || sub === "--help") {
    console.log(`Usage: anet daemon <subcommand> [name] [options]

Subcommands:
  init <name>          Create a host_supervisor daemon node (role + defaults)
  start <name>         Start a daemon (delegates to anet node start; verifies role)
  restart <name>       stop then start (daemon 是长驻进程,换包/改配置都要重启才生效)
  up [<name>]          init + start one-shot (default name: "${DAEMON_DEFAULT_NAME}")
  list                 List locally-configured daemon nodes

Options:
  --force              init only。两种用法,第二种是产品自己给出的修法却没人写在这里:
                       ① 覆盖一个**非** daemon 的同名配置;
                       ② 对**已经是** daemon 的配置重跑一次 init —— 回填后来新增的
                          runtime(\`anet daemon list\` 报「少 N 个」时走这条)。
                       保留 node_id,但**会重新签发 token**,改完要重启该 daemon 才生效。
  --allow-secret KEY   Pre-populate allowed_secret_keys (repeatable; init only)

Daemon 就是一个 role=host_supervisor 的 agent-node,所以停 / 删 / 看**没有** daemon 版,
直接用 node 级命令(anet daemon restart 内部调的也正是其中的 stop):
  anet node stop <name>    停一个 daemon
  anet node delete <name>  删掉它
  anet node ls             看它在不在跑(daemon list 只列本机配置过的 daemon,不含活性)

A "daemon" is an agent-node with role:host_supervisor — receives create_node
dispatches from the hub/dashboard and forks child agent-nodes on demand.
Run \`anet hub start\` first if you don't yet have a CommHub.`);
    return;
  }
  switch (sub) {
    case "init":  args.splice(0, 1); prepareDaemonAnetBin(); await daemonInitCommand(); break;
    case "start": args.splice(0, 1); prepareDaemonAnetBin(); await daemonStartCommand(); break;
    case "up":    args.splice(0, 1); prepareDaemonAnetBin(); await daemonUpCommand(); break;
    case "restart": args.splice(0, 1); prepareDaemonAnetBin(); await daemonRestartCommand(); break;
    case "list": case "ls": await daemonListCommand(); break;
    default: {
      // 🔴 先查 node 级动作重定向,再退回相似度提示 —— 顺序不能反。
      //    suggestSimilar 的候选集是 ["init","start","restart","up","list"],
      //    **全是会改变状态的命令**。实测(用它本身跑的,不是推的):
      //      anet daemon rm     → 建议 "up"     想删,被指去「创建 + 启动」
      //      anet daemon state  → 建议 "start"  想看状态,被指去「启动」
      //    一个把只读/销毁意图导向「动世界」的提示,比不给提示更贵。
      const redirect = daemonSubcommandRedirect(sub, args[2]);
      if (redirect) {
        for (const line of redirect) console.log(line);
      } else {
        const suggestion = suggestSimilar(sub, ["init", "start", "restart", "up", "list"]);
        if (suggestion) console.log(`Unknown daemon subcommand "${sub}". Did you mean: anet daemon ${suggestion}?`);
      }
      console.log(`Usage: anet daemon <init|start|restart|up|list> [name]`);
      process.exit(1);
    }
  }
}

async function daemonInitCommand() {
  const opts = parseOpts();
  const id = args[1] && !args[1].startsWith("--") ? args[1] : DAEMON_DEFAULT_NAME;
  validateNodeName(id);

  // Idempotence — preserve existing token/node_id when re-running init on a
  // healthy daemon; surface conflict when the profile exists with a non-
  // daemon role unless --force.
  const existing = loadProfile(id);
  if (existing) {
    if (existing.role === "host_supervisor" && !opts.force) {
      // 🔴 这个绿勾以前会被读成「配置是新的」——它只说明「这个名字已经是 daemon」。
      //    本分支**一个字节都没写**：token 没重签、runtime 清单没刷新、
      //    max_concurrent_children 没动。而 #1298（2026-08-28）把默认 runtime 清单
      //    从 3 个放开到 SUPPORTED_RUNTIME_NAMES 全体之后，**在那之前 init 的 daemon
      //    永远停在旧清单上** —— 症状是客户端「选服务器」里那台机器可选 runtime 比别人少。
      //    (#1731 让 `anet daemon list` 会主动报这件事；这里补上另一半:
      //     用户手里最可能敲的就是 `daemon init`,那它自己得说清「我没改」。)
      console.log(`[anet daemon] ✓ "${id}" already a host_supervisor daemon`);
      console.log(`              config: .anet/nodes/${id}/config.json`);
      console.log(`              start:  anet daemon start ${id}`);
      console.log(`              ⚠ 本次**没有改动配置** —— token / runtime 清单 / 并发上限都保持原样。`);
      console.log(`                要用当前默认值重写（含 ${SUPPORTED_RUNTIME_NAMES.length} 个 runtime 的清单）:`);
      console.log(`                  anet daemon init ${id} --force`);
      console.log(`                （保留 node_id，但会重新签发 token；改完要重启该 daemon 才生效）`);
      return;
    }
    if (existing.role !== "host_supervisor" && !opts.force) {
      console.error(`Error: node "${id}" exists with role="${existing.role || "(none)"}", not "host_supervisor".`);
      console.error(`Use --force to overwrite (re-mints token, keeps node_id), or pick a different name.`);
      process.exit(1);
    }
    // --force: fall through; we'll overwrite below, preserving node_id when present
  }

  // Hub gate (mirrors createCommand)
  const gc = loadGlobal();
  if (!gc.hub) {
    try {
      const h = await fetch("http://127.0.0.1:9200/health").then(r => r.json() as any);
      if (h.ok) { gc.hub = "http://127.0.0.1:9200"; saveGlobal(gc); console.log(`[anet] 检测到本地 CommHub: ${gc.hub}`); }
    } catch { /* not reachable */ }
  }
  if (!gc.hub) {
    console.error("未找到 CommHub Server。请先运行:\n  anet hub start\n\n或手动配置:\n  anet init --hub http://YOUR_IP:9200");
    process.exit(1);
  }
  if (!gc.token || !gc.network_id) {
    console.error("未登录或缺少 network_id。请运行:\n  anet login");
    process.exit(1);
  }

  // Collect --allow-secret repeatables (parseOpts only knows --channel/--env;
  // walk argv manually for --allow-secret to avoid touching the shared parser).
  const allowedSecretKeys: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--allow-secret" && args[i + 1]) {
      const k = args[++i];
      if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(k)) {
        console.error(`Error: --allow-secret value "${k}" must match ^[A-Z][A-Z0-9_]{0,63}$ (uppercase env-var name)`);
        process.exit(1);
      }
      allowedSecretKeys.push(k);
    }
  }

  // Mint a network token via existing helper. Preserve node_id when re-init
  // with --force on an existing daemon (avoid orphaning child references).
  const preservedNodeId = existing?.node_id;
  const nodeIdToUse = preservedNodeId || `node_daemon_${randomBytes(6).toString("hex")}`;
  const stubProfile: any = {
    node_id: nodeIdToUse,
    node_name: id,
    hub: gc.hub,
    network_id: gc.network_id,
  };
  let mintedToken: string;
  try {
    mintedToken = await requestNodeToken(stubProfile as any, id);
  } catch (e: any) {
    console.error(`Failed to mint node-token from hub ${gc.hub}: ${e?.message || e}`);
    process.exit(1);
  }

  // Write config.json directly (not via saveProfile) — saveProfile's
  // normalize+whitelist pipeline strips the RFC-026 §9.3 daemon-self-declare
  // fields (runtimes_supported / allowed_secret_keys / max_concurrent_children).
  // The daemon config shape is small + explicit; direct write keeps all the
  // fields on disk so agent-node's report_status can include them in its
  // config_snapshot for the post-#337 hub role extraction to pick up.
  const daemonConfig = {
    anet_version: 1,
    node_id: nodeIdToUse,
    node_name: id,
    alias: id,
    runtime: "claude-agent-sdk",
    role: "host_supervisor",
    hub: gc.hub,
    token: mintedToken,
    network_id: gc.network_id,
    // #1298 — 引用 canonical 集合，不再手写。这里曾经是硬编码的三元组，
    // 于是 grok-build-cli / codex-app-server / opencode-cli 三个共存 runtime
    // 永远不会出现在 daemon 的能力声明里，hub 据此把 create_node 拒掉。
    runtimes_supported: [...SUPPORTED_RUNTIME_NAMES],
    allowed_secret_keys: allowedSecretKeys,
    max_concurrent_children: 20,
    channels: [],
    env: {},
    flags: { dangerouslySkipPermissions: true, teammateMode: true },
  };
  const dir = join(nodesDir(), id);
  ensurePrivateDirectory(dir);
  atomicWritePrivateJson(join(dir, "config.json"), daemonConfig);

  console.log(`[anet daemon] ✓ ${existing ? "re-initialized" : "created"} host_supervisor daemon "${id}"`);
  console.log(`              config:     .anet/nodes/${id}/config.json`);
  console.log(`              node_id:    ${nodeIdToUse}`);
  if (allowedSecretKeys.length) {
    console.log(`              secret keys allowed: ${allowedSecretKeys.join(", ")}`);
  } else {
    console.log(`              secret keys allowed: (none — add with: anet daemon init ${id} --force --allow-secret KEY)`);
  }
  // PR3 nit ③ — daemons spawn arbitrary anet child nodes via the
  // create_node SSE doorbell, which is a significantly higher-privilege
  // capability than a regular agent-node. Surface the perm posture so
  // operators don't ship a daemon to a multi-tenant machine assuming
  // it's locked down.
  console.log(``);
  console.log(`[anet daemon] ⚠ Permission posture:`);
  console.log(`              flags.dangerouslySkipPermissions = true  (no per-call confirmation)`);
  console.log(`              flags.teammateMode = true`);
  console.log(`              role = host_supervisor                   (can fork child agent-nodes via hub)`);
  console.log(`              → Run daemons only on machines you trust to act on your behalf.`);
  console.log(`              → Edit .anet/nodes/${id}/config.json to disable individual flags.`);
  console.log(``);
  console.log(`Next: start it`);
  console.log(`  anet daemon start ${id}    (or anet daemon up ${id} to init+start in one go)`);
}

async function daemonStartCommand() {
  const id = args[1];
  if (!id || id.startsWith("--")) {
    console.error("Usage: anet daemon start <name>");
    process.exit(1);
  }
  const profile = loadProfile(id);
  if (!profile) {
    console.error(`Daemon "${id}" not found. Create it first:`);
    console.error(`  anet daemon init ${id}`);
    process.exit(1);
  }
  if (profile.role !== "host_supervisor") {
    console.error(`Error: node "${id}" exists but role="${profile.role || "(none)"}", not "host_supervisor".`);
    console.error(`Re-init as daemon: anet daemon init ${id} --force`);
    process.exit(1);
  }
  // 2026-08-30 —— 在启动的那一刻就说「你装了它,但这台 daemon 看不见它」。
  //
  // 真机上的代价:daemon 建出来的 grok 节点报「grok CLI not found」,而 grok
  // 就装在 ~/.grok/bin。子节点**继承 daemon 的 PATH**,所以问题在 daemon 这边,
  // 而报错出现在节点那边 —— 中间隔着一次建节点,没人会往这儿想。
  // 在这里说,修起来只要一行 export;等节点报错再说,已经绕了一大圈。
  for (const w of daemonPathWarnings({
    runtimes: ((profile as any)?.runtimes_supported || []) as string[],
    resolvesOnPath: (bin) => commandExists(bin),
    existsInHomeDir: (dir, bin) => existsSync(join(homedir(), dir, bin)),
  })) {
    console.error(w);
  }

  // 2026-09-02 #1722 —— 在启动的那一刻说清「这台 daemon 管得到哪些节点」。
  //
  //   daemon 的 workDir 就是它**启动那一刻所在的目录**(process.cwd())，它 fork 出的
  //   子节点全部落在 `<workDir>/.anet/nodes/` 下(start-daemon.ts 的
  //   `nodesRoot = join(deps.workDir, ".anet", "nodes")`)。**别处的存量节点够不着** ——
  //   不是权限问题，是不在搜索范围里，而 Dashboard 上点它们只会毫无反应。
  //
  //   `anet daemon list` 已经打了 `scanned:`(#1725)，但**启动**这一刻才是 workDir 被
  //   固定下来的时刻 —— 与上面那段 PATH 警告同一个道理:在这里说一句，
  //   胜过用户在 Dashboard 上点半天再回头猜 daemon 是从哪个目录起的。
  console.error(`  workdir: ${process.cwd()}`);
  console.error(`  (它只管得到 ${nodesDir()} 里的节点;别处的存量节点够不着 —— 见 #1722)`);

  // Delegate to existing startCommand — it reads args[1] for the node name,
  // which is what we have after the `daemon start` splice in daemonCommand.
  await startCommand();
}

/**
 * `anet daemon restart <name>` —— stop 然后 start。
 *
 * 2026-08-30 加的。在此之前重启一台 daemon 要敲两条命令,而且**第二条不在
 * `anet daemon` 底下**:`anet node stop <name>` + `anet daemon start <name>`。
 * 因为 `daemon start` 委托给 `node start`,所以停也走 `node`。
 * 这个「停和起不在同一个命令族里」是实现细节漏到了用户面前。
 *
 * 🔴 为什么这一条值得单独加:daemon 是**长驻进程**,而今天已经有两处文案
 * 要用户「升级后重启 daemon」(换包对已经在跑的进程没有任何影响)。
 * 一条被反复指示的动作,不该需要用户自己拼两条命令、还得知道停要走 node。
 */
async function daemonRestartCommand() {
  const id = args[1];
  if (!id || id.startsWith("--")) {
    console.error("Usage: anet daemon restart <name>");
    process.exit(1);
  }
  const profile = loadProfile(id);
  if (!profile) {
    console.error(`Daemon "${id}" not found. Create it first:`);
    console.error(`  anet daemon init ${id}`);
    process.exit(1);
  }
  if (profile.role !== "host_supervisor") {
    console.error(`Error: node "${id}" exists but role="${profile.role || "(none)"}", not "host_supervisor".`);
    console.error(`Re-init as daemon: anet daemon init ${id} --force`);
    process.exit(1);
  }
  // 🔴 停不掉不能当成"那就直接起" —— 那会变成两个同 alias 的进程同时在跑。
  //    stopCommand() 对「本来就没在跑」是**正常返回**的(它会说 not running locally),
  //    所以这里只需要让它的**异常**冒出去,不要 catch 成"继续"。
  console.log(`[anet daemon] restart "${id}" —— 先停`);
  await stopCommand();
  console.log(`[anet daemon] restart "${id}" —— 再起`);
  // 🔴 起不来时,daemon 现在是**停着的** —— 而上面那条 "先停" 已经打印过了,
  //    用户很容易以为 restart 只是"没成功",而不是"我的 daemon 现在没了"。
  //    2026-08-30 实测两次:先 stop 再发现起不来(一次是 grok 自更新到未验证版本
  //    #1615,一次是启动进程没活过父会话)。两次都是停掉之后才知道。
  //    所以这里不吞异常(原样抛出保留退出码与栈),只在抛之前把**当前状态**说清楚。
  try {
    await startCommand();
  } catch (e) {
    console.error(``);
    console.error(`🔴 [anet daemon] "${id}" 已经停了,但没能起来 —— 现在它是**停着的**。`);
    console.error(`   重试:  anet daemon start ${id}`);
    console.error(`   先看上面的启动报错;常见原因是运行时二进制的版本不在验证清单里(见 #1615)。`);
    throw e;
  }
}

async function daemonUpCommand() {
  // Inject default name into args if user said `anet daemon up` with no name
  if (!args[1] || args[1].startsWith("--")) {
    args.splice(1, 0, DAEMON_DEFAULT_NAME);
  }
  await daemonInitCommand();
  // After init, args[1] is still the name; startCommand reads args[1].
  await startCommand();
}

async function daemonListCommand() {
  const ids = listProfileIds();
  const daemons = ids
    .map(id => ({ id, profile: loadProfile(id) }))
    .filter(({ profile }) => profile && profile.role === "host_supervisor");
  // #1722 —— 这条命令的「locally」指的是**当前目录**,不是这台机器:
  // `listProfileIds()` 读的是 `nodesDir()` = `join(process.cwd(), ".anet", "nodes")`。
  // 在别的目录跑,同一台机器上的 daemon 就一个都看不见 —— 而原来的输出里
  // 没有任何东西说得出这一点,读的人会以为「这台机器上没有 daemon」。
  // 🔴 "No host_supervisor daemons" 这个子串被 tests/qa-anet-daemon-cmd/run.sh
  //    钉着,只能在其后追加行,不能改它。
  if (daemons.length === 0) {
    console.log("No host_supervisor daemons configured locally.");
    console.log(`  scanned: ${nodesDir()}`);
    console.log("  (节点配置按目录存放 —— 换个目录跑，看到的是另一份清单)");
    console.log("Create one: anet daemon init <name>");
    return;
  }
  console.log(`Local host_supervisor daemons (${daemons.length}):`);
  console.log(`  scanned: ${nodesDir()}`);

  // #1545 —— 除了"本机配了哪些 daemon",还要说出**它们现在能不能建节点**。
  //
  // 在此之前这条链是断的:daemon 从 #1353 起就在上报 can_create_nodes /
  // create_nodes_blocked_reason,hub 也一路存到 /api/host-supervisors ——
  // 但 agent-network/ 和 dashboard/ 全仓 0 命中。**不是没人算,是没人念。**
  //
  // 🔴 hub 不可达时**不让整条命令失败**:本地清单本来就不需要网络,
  //    而"看不到能力"和"没有 daemon"是两件完全不同的事,必须分别说清。
  const fetched = await fetchDaemonCapabilities();

  for (const { id, profile } of daemons) {
    const nid = (profile as any)?.node_id || "(missing)";
    const runtimes = ((profile as any)?.runtimes_supported || []).join(",") || "(default)";
    console.log(`  ${padDisplayEnd(id, 24)} node_id=${nid}  runtimes=[${runtimes}]`);
    // #1298 只改了**写入**路径：在它之前 init 的 daemon，配置里仍是旧的三元组，
    // 而在此之前没有任何东西说得出这件事 —— 用户在客户端「选服务器」里看到
    // 某台机器少几个 runtime，既不知道为什么，也不知道该做什么。
    const staleHint = describeStaleRuntimeSupport(
      (profile as any)?.runtimes_supported,
      SUPPORTED_RUNTIME_NAMES,
      id,
    );
    if (staleHint) console.log(`    ${staleHint}`);
    console.log(`    ${daemonCreateCapabilityLine(nid, fetched, Date.now())}`);
  }
}

/** 从 hub 取每台 daemon 自报的创建能力。
 *  返回 null 表示**没问到**(未配置 hub / 连不上 / 响应不可读)——
 *  🔴 和"问到了但那台 daemon 没报过"是两件事,调用方必须分开说。 */
// 2026-08-30 —— 以前这五种失败**全部返回 null**,而唯一那句文案说的是「连不上 hub」。
// Mac mini 上实测到的是 HTTP 401:同机 `/health` 200(0.79s)、`/api/host-supervisors` 401。
// hub 完全可达,缺的是**这台机器 CLI 的凭据**(daemon 自己带 token 所以注册成功了)。
// 把「拒绝了你的身份」说成「连不上」,会把人支去查网络/隧道/hub 死活 —— 全白查,
// 该跑的是 `anet login`。同 #473 给 SSE 明细定的规矩:分不清的两件事不许合并成一句话。
type CapabilityFetchResult =
  | { ok: true; rows: Map<string, DaemonCapabilityRow> }
  | { ok: false; failure: CapabilityFetchFailure };

function daemonCreateCapabilityLine(nid: string, fetched: CapabilityFetchResult, nowMs: number): string {
  if (!fetched.ok) {
    // hub 不可达/未配置 —— 这是**第四种**情况,和"没报过"不同:
    // 那台 daemon 可能报得好好的,只是我们现在问不到。别把它说成未知能力。
    return describeFetchFailure(fetched.failure);
  }
  const row = fetched.rows.get(nid);
  if (!row) {
    return "创建能力:查不到 —— hub 上没有这个 node_id(还没注册过,或注册到了别的网络)";
  }
  return describeCapability(row, nowMs).line;
}

async function fetchDaemonCapabilities(): Promise<CapabilityFetchResult> {
  const gc = loadGlobal();
  const hub = parseOpts().hub || gc.hub;
  if (!hub) return { ok: false, failure: { why: "no-hub" } };
  try {
    const res = await fetch(`${hub}/api/host-supervisors`, { headers: authHeaders() });
    if (!res.ok) {
      // 🔴 401/403 单独成一类:它们说的是「凭据」,其余 HTTP 错说的是「hub 那边出事了」。
      const why = (res.status === 401 || res.status === 403) ? "unauthorized" : "http";
      return { ok: false, failure: { why, status: res.status } as CapabilityFetchFailure };
    }
    const body = await res.json() as any;
    if (!body?.ok || !Array.isArray(body.daemons)) return { ok: false, failure: { why: "bad-body" } };
    const m = new Map<string, DaemonCapabilityRow>();
    for (const d of body.daemons) {
      if (d && typeof d.daemon_node_id === "string") m.set(d.daemon_node_id, d as DaemonCapabilityRow);
    }
    return { ok: true, rows: m };
  } catch (e: any) {
    // 只有真的没连上才配叫「连不上」。带上 errno/message,否则用户无从下手。
    return { ok: false, failure: { why: "unreachable", detail: String(e?.message || e).slice(0, 60) } };
  }
}

// ── import ──

async function importCommand() {
  const gc = loadGlobal();
  const opts = parseOpts();
  const hub = opts.hub || gc.hub;
  if (!hub) { console.error("Run 'anet init' first"); process.exit(1); }

  // Fetch all sessions from CommHub
  let sessions: any[] = [];
  try {
    const res = await fetch(`${hub}/api/status`, { headers: authHeaders() });
    const data = await res.json() as any;
    sessions = data.sessions || [];
  } catch (e: any) {
    console.error(`Cannot reach ${hub}: ${e.message}`);
    process.exit(1);
  }

  if (sessions.length === 0) { console.log("No sessions in CommHub."); return; }

  // Filter: only claude-code agents with project_dir
  const claudeSessions = sessions.filter((s: any) => s.agent === "claude-code" && s.project_dir);
  if (claudeSessions.length === 0) { console.log("No claude-code sessions found."); return; }

  const targetAlias = args[1]; // optional: anet import 指挥室
  const toImport = targetAlias
    ? claudeSessions.filter((s: any) => s.alias === targetAlias)
    : claudeSessions;

  if (toImport.length === 0) {
    // 🔴 可导入的会话就在手边(claudeSessions),只说「没找到」等于把用户手上的
    // 信息藏起来 —— 同 #1667 的 `Node "x" not found`。把真名给他。
    const names = claudeSessions.map((s: any) => String(s.alias || "")).filter(Boolean);
    const shown = names.slice(0, 5).join(", ");
    const more = names.length > 5 ? `, … (${names.length} total)` : "";
    console.log(`No session found for "${targetAlias}". ${names.length} importable: ${shown}${more}`);
    return;
  }

  let created = 0;
  for (const s of toImport) {
    const projectDir = s.project_dir;
    const nodeDir = join(projectDir, ".anet", "nodes", s.alias);
    const configPath = join(nodeDir, "config.json");

    if (existsSync(configPath)) {
      console.log(`  ⏭  ${s.alias} — already exists (${projectDir})`);
      continue;
    }

    // Skip if project_dir doesn't exist on this machine
    if (!existsSync(projectDir)) {
      console.log(`  ⚠  ${s.alias} — project_dir not found: ${projectDir}`);
      continue;
    }

    const config: Profile = {
      anet_version: "0.1.0",
      node_id: generateNodeId(),
      node_name: s.alias,
      runtime: "claude-code-cli",
      channels: ["server:commhub"],
      env: {},
      flags: { dangerouslySkipPermissions: true, teammateMode: "in-process" },
      session: s.resume_id,
    };

    ensurePrivateDirectory(nodeDir);
    atomicWritePrivateJson(configPath, {
      anet_version: config.anet_version,
      node_id: config.node_id,
      node_name: config.node_name,
      runtime: config.runtime,
      channels: config.channels,
      env: config.env,
      flags: config.flags,
      session: config.session,
    });
    console.log(`  ✅ ${s.alias} → ${projectDir}/.anet/nodes/${s.alias}/config.json`);
    created++;
  }

  console.log(`\nImported ${created} session(s). Use: cd <project> && anet node resume <alias>`);
}

// ── session ──

function printSessionUsage() {
  console.log(`
anet session <command>

  ls    List Claude Code sessions in current project
`);
}

function sessionCommand() {
  const sub = args[1];
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    printSessionUsage();
    return;
  }

  if (sub === "ls" || sub === "list") {
    // Scan ~/.claude/projects/{project-key}/ for .jsonl files (#115: shared
    // helper with the `anet node create` resume picker).
    const cwd = process.cwd();
    const sessions = listClaudeSessions(cwd);

    if (sessions.length === 0) { console.log(`No sessions for ${cwd}`); return; }

    console.log(`\nSessions in ${cwd} (${sessions.length} total):\n`);
    // 🔴 表头和分隔线原是两个写死的字面量,和数据行对不上:数据行右边缘 38/48/60,
    // 分隔线 40/50/68,表头的 SIZE 落在 45。数据行彼此是一致的 —— 歪的是这两行。
    // id 列宽从**本次要打印的会话**算;SIZE 保持右对齐(padStart)因为它是数字。
    const idW = columnWidth(sessions.map((x) => x.id), "SESSION ID");
    console.log(`  ${"SESSION ID".padEnd(idW)}  ${"SIZE".padStart(8)}  MODIFIED`);
    console.log(`  ${"─".repeat(idW)}  ${"─".repeat(8)}  ${"─".repeat(16)}`);

    for (const s of sessions) {
      const mtime = new Date(s.mtimeMs).toISOString().replace("T", " ").slice(0, 16);
      console.log(`  ${s.id.padEnd(idW)}  ${formatSize(s.sizeBytes).padStart(8)}  ${mtime}`);
    }
    console.log();
  } else {
    printSessionUsage();
  }
}

// #146 R1 — read a node's recorded PID without mutating the pidfile. Pure
// read: renameCommand captures the OLD pid up-front so process-exit can be
// confirmed even though the pidfile is later removed with the old config dir.
function readNodePid(nodeId: string): number | null {
  try {
    const pidFile = join(nodesDir(), nodeId, ".pid");
    if (!existsSync(pidFile)) return null;
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch { return null; }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return !pidAlive(pid);
}

// #146 R1 — terminate a node process and CONFIRM it exited. SIGTERM →
// bounded wait → (force only) SIGKILL → bounded wait. Returns true only when
// the process is verified dead. A surviving old process keeps heart-beating
// and commhub's ON CONFLICT(resume_id) upsert reverts the rename (SDK马
// Finding B), so renameCommand must NOT start the new alias if this is false.
async function terminateNodeProcess(pid: number, force: boolean): Promise<boolean> {
  if (!pidAlive(pid)) return true;
  try { process.kill(pid, "SIGTERM"); } catch {}
  if (await waitForPidExit(pid, 8000)) return true;
  // #1422 — everything below here is the diagnosable path, and until now it
  // was silent: a reader of the logs could not tell how long we waited, nor
  // whether a SIGKILL was ever sent. Both branches now say so, because
  // SIGKILL is --force-only and the absence of one is the more surprising
  // half. Quiet on the happy path (SIGTERM reaped within 8s) by design.
  if (force) {
    console.warn(`[anet] ⚠ pid ${pid} outlived the 8s SIGTERM grace — escalating to SIGKILL (--force).`);
    try { process.kill(pid, "SIGKILL"); } catch {}
    if (await waitForPidExit(pid, 3000)) return true;
  } else {
    console.warn(`[anet] ⚠ pid ${pid} outlived the 8s SIGTERM grace. No SIGKILL was sent — escalation requires --force.`);
  }
  return !pidAlive(pid);
}

// #180 — find MCP-bridge orphan processes carrying COMMHUB_ALIAS=<oldAlias>
// in their env. Complements findNodeProcessesByAlias which only matches by
// argv (claude / agent-node / codex / grok binaries). The MCP stdio bridge
// `.anet/node-server.js` doesn't have `-n <alias>` on argv (it's node-spawned
// with just `node .anet/node-server.js`); its parent claude passes alias via
// env. When claude dies, node-server.js reparents to PID 1 and keeps
// heart-beating with the same env-carried alias — this is the #180 ghost
// mechanism. Sweeping /proc/<pid>/environ closes that gap.
//
// The parser + scanner live in ../src/environ-alias.ts so the algorithm is
// unit-testable in isolation (see tests/environ-alias.test.ts for the shape
// lock). Returns matching pids, or null if procfs is unreadable (fail-closed
// for the caller; matches findNodeProcessesByAlias contract).
function findMcpBridgeOrphansByAlias(...aliases: string[]): number[] | null {
  return findEnvironAliasMatches(aliases, process.pid);
}

// #180 — sweep MCP bridge orphans for a target alias set: SIGTERM then
// SIGKILL (--force) each match. This is the main-fix side of #180 Method 1:
// after terminateNodeProcess kills the identified claude/agent-node/codex/
// grok process, any surviving MCP bridge subprocess (heart-beating via env-
// carried COMMHUB_ALIAS) is caught and reaped here. Mirrors the
// sweepOrphansForAlias helper introduced in RFC-027 PR1.2
// (agent-node/src/runtime/stop-daemon.ts) — same "cross-process orphan"
// wire-shape family. Returns the pids that were signaled (empty if none).
async function sweepMcpOrphansForAlias(force: boolean, ...aliases: string[]): Promise<number[]> {
  const orphans = findMcpBridgeOrphansByAlias(...aliases);
  if (!orphans || orphans.length === 0) return [];
  for (const pid of orphans) {
    try { process.kill(pid, "SIGTERM"); } catch { /* may already be dead */ }
  }
  // Brief grace so node-server.ts's SIGTERM handler (report offline +
  // process.exit(0)) has a chance to finish. Not the full 8s — MCP bridge
  // has no long-running task to save. If still alive after 2s + --force,
  // SIGKILL.
  await new Promise(r => setTimeout(r, 2000));
  const stillAlive = orphans.filter(pid => pidAlive(pid));
  if (stillAlive.length > 0 && force) {
    for (const pid of stillAlive) {
      try { process.kill(pid, "SIGKILL"); } catch { /* may already be dead */ }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return orphans;
}

// #146 / #180 — find a node's live agent process(es) by command line, NOT by a
// possibly-stale .pid. A stale .pid can point to a dead pid the OS later reused
// for an unrelated process — trusting it makes renameCommand SIGKILL an
// innocent process AND miss the real node (it stays a ghost). launchAgent
// always puts the node alias on the agent's argv (`claude -n <alias>` /
// `agent-node --alias <alias>`).
// Returns the matching pids, or `null` if the process table cannot be read —
// callers MUST fail closed on `null` (#180 R2), never treat it as "no match".
// #180 R3 caveat: alias tokenisation assumes node names conforming to
// validateNodeName() (no whitespace/quotes) — the entire current node
// population. A hand-edited legacy alias containing whitespace would not match.
// #1438 + #1458 — anet node stop AND anet node rename both need (pid, birth)
// from the SAME `ps` snapshot to defeat pid-reuse. Two separate reads —
// findNodeProcessesByAlias + processBirth (or subsequent process.kill) — leave
// a window in which pid can be recycled to another process B; without a
// captured discovery-time birth to compare against, the kill hits B.
//
// This helper captures both in one atomic `ps` invocation. lstart is a
// 24-char fixed-width timestamp ("Www Mmm dd HH:MM:SS YYYY"), stable per
// process incarnation, string-comparable.
//
// Widened signature (accepts multiple aliases) because rename passes both
// the display name and the node id — either can match the argv.
function findNodeStopCandidates(...aliases: string[]): OwnedRootCandidate[] | null {
  const wanted = new Set(aliases.filter(Boolean));
  if (wanted.size === 0) return [];
  let out = "";
  try {
    out = execFileSync("ps", ["-eww", "-o", "pid=", "-o", "lstart=", "-o", "args="], { encoding: "utf-8" }).toString();
  } catch { return null; }  // #180 R2 — process table unavailable; caller fails closed
  const candidates = new Map<number, OwnedRootCandidate>();
  // Regex: pid (leading ws + digits) + lstart (fixed 24 chars: 3-letter weekday,
  // space, 3-letter month, space, 1-2 digit day right-padded to 2, space,
  // HH:MM:SS, space, 4-digit year) + args (rest of line).
  const LINE_RE = /^\s*(\d+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2} [ 0-9]\d \d\d:\d\d:\d\d \d{4})\s+(.+)$/;
  for (const line of out.split("\n")) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    if (isNaN(pid) || pid === process.pid) continue;
    const discoveredBirth = m[2];
    const tok = m[3].split(/\s+/);
    // Same identity rules as findNodeProcessesByAlias (#180 R1 / #146 PR-3):
    // command line must be an actual agent process, and the alias must be
    // in the argv (`-n <alias>` / `--alias <alias>` / `node start <alias>`).
    const isForegroundStart = tok.some((x, i) => x === "node" && tok[i + 2] === "node" && tok[i + 3] === "start")
      || tok.some((x, i) => (x.endsWith("/anet") || x === "anet") && tok[i + 1] === "node" && tok[i + 2] === "start");
    const isAgentProc = isForegroundStart || tok.some(x => {
      const base = x.split("/").pop() || x;
      return base === "claude" || base === "agent-node"
        || base === "codex" || base === "grok"
        || x.includes("@anthropic-ai/claude-code") || x.includes("@sleep2agi/agent-node")
        || x.includes("@openai/codex") || x.includes("@openai/codex-sdk");
    });
    if (!isAgentProc) continue;
    let aliasMatch = false;
    for (let i = 0; i < tok.length - 1; i++) {
      if ((tok[i] === "-n" || tok[i] === "--alias") && wanted.has(tok[i + 1])) { aliasMatch = true; break; }
      if (tok[i] === "start" && tok[i - 1] === "node" && wanted.has(tok[i + 1])) { aliasMatch = true; break; }
    }
    if (!aliasMatch) continue;
    candidates.set(pid, { pid, discoveredBirth });
  }
  return [...candidates.values()];
}

// #1438 — read lstart via `ps -p <pid>` so we compare against the SAME format
// findNodeStopCandidates captured. If pid was recycled between discovery and
// this call, ps will return the NEW process's lstart (different string) and
// resolveOwnedRoots' equality check catches it. Returns null on any error
// (pid gone / ps unavailable / anything else) — resolveOwnedRoots then
// falls back to the vanished() fail-closed path.
function probeCurrentBirthSignature(pid: number): string | null {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf-8" }).trim();
    return out || null;
  } catch { return null; }
}

function findNodeProcessesByAlias(...aliases: string[]): number[] | null {
  const wanted = new Set(aliases.filter(Boolean));
  if (wanted.size === 0) return [];
  let out = "";
  try {
    out = execFileSync("ps", ["-eww", "-o", "pid=", "-o", "args="], { encoding: "utf-8" }).toString();
  } catch { return null; }  // #180 R2 — process table unavailable; caller fails closed
  const pids = new Set<number>();
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    if (isNaN(pid) || pid === process.pid) continue;
    const tok = m[2].split(/\s+/);
    // #180 R1 — genuine agent-process identity: an argv token must be the agent
    // executable itself (basename claude / agent-node) or its package path —
    // NOT a mere substring of the whole command line, which an unrelated
    // process could carry in a path/arg and then be wrongly killed.
    // PR-3 (#146 family) — also recognise codex / grok standalone CLIs so a
    // rename on a node started via those binaries can match its real process.
    // Without this gap-fill, rename --force on a codex-sdk or grok-build-acp
    // node that was launched via the standalone CLI (not the agent-node
    // bridge) would silently fail to find the old process.
    const isForegroundStart = tok.some((x, i) => x === "node" && tok[i + 2] === "node" && tok[i + 3] === "start")
      || tok.some((x, i) => (x.endsWith("/anet") || x === "anet") && tok[i + 1] === "node" && tok[i + 2] === "start");
    const isAgentProc = isForegroundStart || tok.some(x => {
      const base = x.split("/").pop() || x;
      return base === "claude" || base === "agent-node"
        || base === "codex" || base === "grok"
        || x.includes("@anthropic-ai/claude-code") || x.includes("@sleep2agi/agent-node")
        || x.includes("@openai/codex") || x.includes("@openai/codex-sdk");
    });
    if (!isAgentProc) continue;
    for (let i = 0; i < tok.length - 1; i++) {
      if ((tok[i] === "-n" || tok[i] === "--alias") && wanted.has(tok[i + 1])) { pids.add(pid); break; }
      if (tok[i] === "start" && tok[i - 1] === "node" && wanted.has(tok[i + 1])) { pids.add(pid); break; }
    }
  }
  return [...pids];
}

type StopResidual = { kind: "process" | "socket"; detail: string; path?: string };
type ProcessIdentitySnapshot =
  | { kind: "gone" }
  | { kind: "unverifiable"; detail: string }
  | { kind: "live"; birth: string; ppid?: number };

function processIdentitySnapshot(pid: number): ProcessIdentitySnapshot {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8").trim();
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/);
      if (fields[0] === "Z") return { kind: "gone" };
      const ppid = Number(fields[1]);
      const birth = fields[19];
      if (!Number.isSafeInteger(ppid) || !birth) return { kind: "unverifiable", detail: "malformed /proc stat" };
      return { kind: "live", birth, ppid };
    } catch (e: any) {
      if (e?.code === "ENOENT" || e?.code === "ESRCH") return { kind: "gone" };
      return { kind: "unverifiable", detail: e?.code || "proc read failed" };
    }
  }
  const birth = processBirth(pid);
  if (birth) return { kind: "live", birth };
  return pidAlive(pid) ? { kind: "unverifiable", detail: "birth probe failed" } : { kind: "gone" };
}

function processBirth(pid: number): string | null {
  if (process.platform === "win32") return probeWindowsCreationDate(pid);
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8").trim();
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/);
      return fields[19] || null;
    } catch { return null; }
  }
  try { return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf-8" }).trim() || null; }
  catch { return null; }
}

function nodeSocketResiduals(profile: Profile): StopResidual[] {
  const out: StopResidual[] = [];
  for (const [label, path] of [["leader", profile.grokLeaderSocket], ["bridge", profile.grokAttachSocket]] as const) {
    if (!path) continue;
    try {
      const st = lstatSync(path);
      if (st.isSocket()) out.push({ kind: "socket", detail: `${label} socket ${path}`, path });
    } catch (e: any) {
      if (e?.code !== "ENOENT") out.push({ kind: "socket", detail: `${label} socket ${path} (${e?.code || "unreadable"})`, path });
    }
  }
  return out;
}

// #1027 — the foreground start wrapper and its child are separate authorities.
// The child pidfile is written only after spawn, so converge on the alias-
// bearing generation. Linux birth ticks are revalidated before every signal;
// a recycled PID is never signalled.
async function reapOwnedGeneration(owned: readonly LifecycleProcessIdentity[]): Promise<StopResidual[]> {
  const audit = () => owned.map(identity => ({ identity, snapshot: processIdentitySnapshot(identity.pid) }));
  const survivors = () => audit().filter(({ identity, snapshot }) =>
    snapshot.kind === "live" && snapshot.birth === identity.birth).map(x => x.identity);
  const unverifiable = () => audit().filter(({ snapshot }) => snapshot.kind === "unverifiable").map(x => x.identity);
  const signalOwned = (signal: NodeJS.Signals) => {
    for (const identity of owned) {
      // One authoritative snapshot distinguishes gone/live/unverifiable. A
      // different birth is reuse; null is never compared to null.
      const snapshot = processIdentitySnapshot(identity.pid);
      if (snapshot.kind !== "live" || snapshot.birth !== identity.birth) continue;
      try { process.kill(identity.pid, signal); } catch {}
    }
  };
  const unknown = unverifiable();
  if (unknown.length) return [{ kind: "process", detail: `birth unavailable for owned pids ${unknown.map(p => p.pid).join(",")}` }];
  signalOwned("SIGTERM");
  // #1522 —— 这个宽限必须**大于** agent-node 那条拆卸链的最坏耗时,否则下面的
  // SIGKILL 会把正在做清理的进程打断,留下 post-stop 残留(实测症状:
  // `post-stop cleanup retained pinned project sandbox placeholder: .grok`)。
  //
  // 最坏耗时来自 agent-node/src/runtime/grok-copresence/leader-lifecycle.ts 的
  // `terminateOwnedGrokLeader(identity, timeoutMs = 2_000)`:
  //   SIGTERM 等 2s → 重验身份 → SIGKILL 等 2s   = 一次调用最坏 4s
  //   该函数在拆卸链里被调用两次                  = **最坏 8s**
  //
  // 🔴 不要反过来去缩短那 2_000:它是 SIGKILL 升级前重做完整身份绑定的窗口,
  //    用来挡同 UID 的 PID 复用竞态(Node 无 pidfd_send_signal)。缩它会削弱那道保护。
  //
  // 这里是**上限不是固定等待** —— 下面的循环在 survivors() 清空时立刻返回,
  // 正常路径上进程 SIGTERM 后很快就退出,用户感觉不到差别。
  const termDeadline = Date.now() + 10_000;
  while (Date.now() < termDeadline) {
    await new Promise(r => setTimeout(r, 100));
    const unknownNow = unverifiable();
    if (unknownNow.length) return [{ kind: "process", detail: `birth unavailable during TERM audit for pids ${unknownNow.map(p => p.pid).join(",")}` }];
    if (survivors().length === 0) return [];
  }
  signalOwned("SIGKILL");
  const killDeadline = Date.now() + 3_000;
  while (Date.now() < killDeadline) {
    await new Promise(r => setTimeout(r, 100));
    const unknownNow = unverifiable();
    if (unknownNow.length) return [{ kind: "process", detail: `birth unavailable during KILL audit for pids ${unknownNow.map(p => p.pid).join(",")}` }];
    if (survivors().length === 0) return [];
  }
  return [{ kind: "process", detail: `owned generation pids ${survivors().map(p => p.pid).join(",") || "unknown"}` }];
}

// #146 GOTCHA-2 — best-effort drain before a rename restart kills the agent.
// Polls commhub /api/status: returns true once the node is NOT actively
// running a task (idle / blocked / error / offline / fell off status), false
// on timeout (still working). Killing a working node drops the in-flight
// task with no reply (#168 silent-lost family) — `--force` is the user's
// acceptance that a stuck/long task may still be interrupted past this wait.
async function waitForNodeIdle(hub: string, token: string, networkId: string, alias: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let sawNode = false;
  const url = `${hub}/api/status?network_id=${encodeURIComponent(networkId)}`;  // #146 R6
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers: authHeaders(token) }).then(r => r.json() as any);
      const node = (res.sessions || []).find((s: any) => s.alias === alias || s.node_name === alias);
      if (node) {
        sawNode = true;
        const st = String(node.status || "").toLowerCase();
        if (st !== "working" && st !== "busy" && st !== "running") return true;
      } else if (sawNode) {
        return true;  // node dropped off the status list — already down, safe to proceed
      }
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  return false;
}

// #146 R2 — verify the restarted agent is genuinely live under the new alias.
// commitRename renames the hub row in place (keeps the old status/updated_at),
// so a plain "alias=new && status!=offline" check is a false positive — true
// even if the new process never started. Authoritative signal: the new node's
// `.pid` is present AND alive — only a real restarted process writes that
// pidfile; the hub row rename cannot fake a local pid. A fresh hub heartbeat
// (last_seen/updated_at past restartStartedAt) corroborates but only annotates.
async function verifyNodeRestarted(
  hub: string, token: string, networkId: string, newName: string,
  restartStartedAt: number, timeoutMs: number,
): Promise<{ ok: boolean; reason: string }> {
  const deadline = Date.now() + timeoutMs;
  const url = `${hub}/api/status?network_id=${encodeURIComponent(networkId)}`;  // #146 R6
  while (Date.now() < deadline) {
    const pid = readNodePid(newName);
    if (pid !== null && pidAlive(pid)) {
      let fresh = false;
      try {
        const res = await fetch(url, { headers: authHeaders(token) }).then(r => r.json() as any);
        const node = (res.sessions || []).find((s: any) => s.alias === newName || s.node_name === newName);
        if (node) {
          // 🔴 #1650 —— 这两列是 hub 的 TEXT 时间戳(`datetime('now')`),UTC 但**不带
          //   时区标记**。`Date.parse` 会按本机时区解析,误差 = 主机偏移,而且不报错:
          //     TZ=Asia/Shanghai  -8h → ts 偏早 → fresh 恒 false(只是拿不到强信号)
          //     TZ=America/*      +7h → ts 偏晚 → **fresh 恒 true** ← 这道校验被静默放行
          //   西于 UTC 的主机上,「重启后 hub 心跳有没有刷新」这一格等于没在判。
          const ts = parseHubTimestamp(node.last_seen_at) ?? parseHubTimestamp(node.updated_at) ?? 0;
          fresh = ts >= restartStartedAt;
        }
      } catch {}
      return { ok: true, reason: fresh ? "new process pid alive + fresh hub heartbeat" : "new process pid alive (hub heartbeat still catching up)" };
    }
    await new Promise(r => setTimeout(r, 2500));
  }
  return { ok: false, reason: `no live new-process pid within ${Math.round(timeoutMs / 1000)}s` };
}

// anet node rename — RFC-010 §4 multi-surface 2PC (issue #84 Phase 2).
// PHASE 1 (prepare) is fully rollback-safe: copy-not-move + rename.lock +
// commhub prepared rename_txn row, old node untouched. PHASE 2 (commit) is the
// non-rollbackable point: commhub routing switch → restart agent → delete old.
// #1698 —— 改一个已存在节点的 runtime。
//
// 在此之前 `anet node` 有十个子命令，没有一个能改 runtime：想换只能手改
// `<project>/.anet/nodes/<name>/config.json` 或删掉重建。而这不是假设的场景 ——
// `grok-build-cli` 在 Ubuntu 24.04+ 上撞 uid_map 墙时，**产品自己的预检**
// (agent-node/src/runtime/grok-build-cli.ts) 给出的首选修法就是
// 「改用 grok-build-acp runtime」。产品给出的修复动作，产品自己没有命令去做。
//
// 🔴 校验走 `normalizeRuntimeStrict`，**不在这里写第四份白名单**。
//    同一个 runtime 全集现在已经有四处（hub 的 create-node-validate.ts、
//    本文件用的 normalize-runtime.ts、agent-node 的 VALID_RUNTIMES、
//    桌面端的 CreateNodeWizardScreen.tsx —— 后者今天才补齐第 7 个）。
//    再抄一份就是给下一次「四处不一致」预定位置。
//
// 🔴 空值不当默认：`normalizeRuntimeStrict` 对空串返回 DEFAULT_RUNTIME，
//    那是给「配置里没写」用的语义。用户显式敲 `--runtime ""` 是打错了，
//    不该被悄悄解释成 claude-agent-sdk —— 所以这里先自己挡掉空值。
async function nodeEditCommand() {
  const ref = args[1];
  const flagIdx = args.indexOf("--runtime");
  const raw = flagIdx >= 0 ? args[flagIdx + 1] : undefined;
  // #1698 —— `--model` 与 `--runtime` 同一条路：都复用**创建路径已经在用的**那个
  // 校验器，不新增第 N 份判据。`anet node create` 走的是
  // `validateModel`（cli.ts 的 create 分支，#1469 finding-3），这里照用。
  //
  // 🔴 触发这一格的是 TM 的一条真实 P0：节点撞上
  //    "Selected model is at capacity"，而**换模型没有命令可用** ——
  //    与 #1698 里 grok 撞 uid_map 墙时「产品给出的修法产品自己做不到」同形。
  const modelIdx = args.indexOf("--model");
  const rawModel = modelIdx >= 0 ? args[modelIdx + 1] : undefined;
  if (!ref || (flagIdx < 0 && modelIdx < 0)) {
    console.log(`
anet node edit <node-id|node-name> [--runtime <id>] [--model <id>]

  Change an existing node's runtime and/or model. Supported runtime ids:
    ${SUPPORTED_RUNTIME_NAMES.join(", ")}

  --model takes any id the runtime accepts; it is validated the same way
  'anet node create --model' validates it (non-empty, no whitespace).

  Note: the change is written to the node's config; a running node keeps its
  current runtime/model until it is restarted (anet node restart <name>).
`);
    return;
  }
  if (flagIdx >= 0 && (raw === undefined || raw.trim() === "" || raw.startsWith("--"))) {
    console.error(`--runtime needs a value. Supported: ${SUPPORTED_RUNTIME_NAMES.join(", ")}`);
    process.exit(1);
  }
  // 🔴 同 --runtime：先自己挡掉空值/漏值。validateModel 对空串是**抛错**的，
  //    但 `--model --runtime x` 这种漏值形态会把下一个 flag 当成模型名，
  //    那是 validateModel 看不出来的（"--runtime" 没有空白、非空）。
  if (modelIdx >= 0 && (rawModel === undefined || rawModel.trim() === "" || rawModel.startsWith("--"))) {
    console.error("--model needs a value (an id the runtime accepts).");
    process.exit(1);
  }
  const resolved = resolveNodeRef(ref);
  if (!resolved) {
    console.error(nodeNotFound(ref));
    process.exit(1);
  }
  const profile = loadProfile(resolved.id);
  if (!profile) {
    console.error(`Node "${resolved.id}" has no readable config.json — nothing to edit.`);
    process.exit(1);
  }
  // 🔴 两个字段都可能改,所以先把「改成什么」全算出来、全校验完,**再一次写盘**。
  //    分两次写会在第二次校验失败时留下一个只改了一半的 config。
  const changes: string[] = [];
  if (flagIdx >= 0) {
    let next: RuntimeName;
    try {
      next = normalizeRuntimeStrict(raw);
    } catch (e: any) {
      console.error(String(e?.message || e));
      process.exit(1);
    }
    const current = normalizeRuntime(profile);
    if (current !== next) {
      (profile as any).runtime = next;
      changes.push(`runtime ${current} -> ${next}`);
    }
  }
  if (modelIdx >= 0) {
    let nextModel: string;
    try {
      // 与 `anet node create --model` 同一个校验器(#1469 finding-3):
      // 非字符串 / trim 后为空 / 含空白 → 抛错。**不在这里另写一套。**
      nextModel = validateModel(rawModel as string);
    } catch (e: any) {
      console.error(String(e?.message || e));
      process.exit(1);
    }
    const currentModel = (profile as any).model as string | undefined;
    if (currentModel !== nextModel) {
      (profile as any).model = nextModel;
      changes.push(`model ${currentModel ?? "(unset)"} -> ${nextModel}`);
    }
  }
  if (changes.length === 0) {
    console.log(`${resolved.id} already matches what you asked for — nothing to change.`);
    return;
  }
  saveProfile(resolved.id, profile);
  for (const c of changes) console.log(`${resolved.id}: ${c}`);
  // 🔴 说清「什么时候生效」。同 `anet goal edit` 的先例:改配置不等于改运行中的进程。
  const running = findNodeStopCandidates(resolved.id);
  if (running === null) {
    console.log(`  (could not read the process table — if ${resolved.id} is running, restart it: anet node restart ${resolved.id})`);
  } else if (running.length > 0) {
    console.log(`  ${resolved.id} is still running with the old settings. Apply them with: anet node restart ${resolved.id}`);
  } else {
    console.log(`  It is not running; the new settings apply on: anet node start ${resolved.id}`);
  }
}

async function renameCommand() {
  const fromRef = args[1];
  const newName = args[2];
  const force = args.includes("--force");
  if (!fromRef || !newName) {
    console.log(`
anet node rename <node-id|node-name> <new-node-name> [--force]
  --force  required to rename a running node. A running node is restarted
           under the new alias (#146): the agent process is stopped (its
           exit is verified) and relaunched so it re-registers with commhub
           under the new name.
           - A best-effort 60s drain waits for any in-flight task to finish
             first; past that, --force means a long/stuck task may still be
             interrupted without a reply (the dispatcher's task stays open).
           - Auto-restart needs tmux. Without tmux the rename still commits,
             but the node is left stopped — start it with: anet node start.
`);
    return;
  }

  // ── 4.1 前置校验 ──
  validateNodeName(newName);
  const resolved = resolveNodeRef(fromRef);
  if (!resolved) {
    console.error(nodeNotFound(fromRef));
    process.exit(1);
  }
  const oldId = resolved.id;
  if (oldId === newName) {
    console.error(`New name "${newName}" is the same as the current name.`);
    process.exit(1);
  }
  if (resolveNodeRef(newName)) {
    console.error(`Node name "${newName}" already exists locally.`);
    process.exit(1);
  }
  const oldDir = join(nodesDir(), oldId);
  const newDir = join(nodesDir(), newName);
  if (existsSync(newDir)) {
    console.error(`Target directory already exists: .anet/nodes/${newName}`);
    process.exit(1);
  }
  const lockPath = join(oldDir, "rename.lock");
  if (existsSync(lockPath)) {
    console.error(`Node "${oldId}" has an in-flight rename (.anet/nodes/${oldId}/rename.lock). Resolve it first.`);
    process.exit(1);
  }
  // An external OpenCode binding is authoritative even when project-local
  // config.json was replaced with another runtime. Rename must not become a
  // laundering path that deletes the old binding and leaves a runnable,
  // unbound legacy profile under the new name. Validate the same private,
  // exact profile used by `node start` before any config write/copy/lock.
  let boundRenameProfile: Profile | undefined;
  try {
    const binding = readOpencodeRuntimeBinding(oldDir, opencodeBindingHome());
    if (binding) {
      const resolvedBound = resolveStartProfile(oldId, resolved.profile);
      if (resolvedBound.runtime !== "opencode-cli") {
        throw new Error("external OpenCode binding resolved to a non-OpenCode runtime");
      }
      boundRenameProfile = resolvedBound.profile;
    }
  } catch (error: any) {
    console.error(
      `[anet] Refusing to rename externally-bound OpenCode node ${JSON.stringify(oldId)}: ` +
      `${error?.message || error}`,
    );
    process.exit(1);
  }
  // state check: running node needs --force (RFC-010 §4.4 active rename).
  // #146 / #180 ship-blocker — DO NOT trust .pid for old-process identity. A
  // stale .pid (left by an agent that exited abnormally, its exit handler never
  // running) can point to a dead pid the OS later reused for an unrelated
  // process; renameCommand would then SIGKILL that innocent process and leave
  // the real node a ghost heart-beating under the old alias (Vincent UAT,
  // N站马). Authoritative detection: scan the live process table by command
  // line — launchAgent always puts the alias there.
  const oldDisplay = nodeDisplayName(oldId, resolved.profile);
  let oldSurvivors: number[] = [];  // #180 — set in C2: old agent pids that refused to die
  // #180 R2 — fail closed if the process table is unreadable: a rename that
  // cannot find/stop the old agent could ghost it or stop the wrong process.
  //
  // #1458 — capture (pid, discoveredBirth) atomically via findNodeStopCandidates
  // so we can defeat pid-reuse at kill time (see rename kill loop below).
  // The bare-pid `findNodeProcessesByAlias` was TOCTOU-vulnerable: between the
  // ps snapshot and each terminateNodeProcess signal, an old pid could be
  // recycled to an unrelated process B and this rename would kill B.
  const oldCandidates = findNodeStopCandidates(oldDisplay, oldId);
  if (oldCandidates === null) {
    console.error(`[anet] ❌ cannot inspect the process table (\`ps\` failed) — refusing the rename.`);
    console.error(`[anet]    Rename must locate + stop the old agent; without \`ps\` it risks a ghost or stopping the wrong process.`);
    process.exit(1);
  }
  const running = oldCandidates.length > 0;
  if (running && !force) {
    console.error(`Node "${oldId}" is running. Use --force to rename a running node (active rename, RFC-010 §4.4).`);
    process.exit(1);
  }
  // #146 R4 — a running node must be restarted under the new alias, which
  // needs tmux. If tmux is unavailable the rename still proceeds, but the node
  // ends up stopped and the user must restart it by hand — surface that
  // up-front so the success message later does not imply auto-recovery.
  const canAutoRestart = tmuxAvailable();
  if (running && !canAutoRestart) {
    console.warn(`[anet] ⚠ tmux not found — the renamed node cannot be auto-restarted.`);
    console.warn(`[anet]   The rename will still proceed; afterwards start it manually: anet node start ${shellQuote(newName)}`);
  }

  const gc = loadGlobal();
  const hub = resolved.profile.hub || gc.hub;
  const token = resolved.profile.token || gc.token;
  const networkId = resolved.profile.network_id || gc.network_id;
  if (!hub || !token || !networkId) {
    console.error(`[anet] rename needs hub + token + network_id — run 'anet login' first.`);
    process.exit(1);
  }
  const stored = boundRenameProfile || loadStoredProfile(oldId) || resolved.profile;
  // #146 R3 — node_id must stay stable across the rename. loadStoredProfile →
  // normalizeStoredProfile already fills a missing node_id in memory with the
  // deterministic legacyNodeId(oldId), so `stored.node_id` is populated — but
  // the raw oldDir/config.json on disk may still lack the field. PHASE 1
  // cpSync copies that *raw* config; if node_id is absent there, the post-copy
  // loadStoredProfile(newName) re-derives legacyNodeId(newName) — a DIFFERENT
  // id — and resume_id (sdk-<node_id>) drifts across the rename (SDK马 Finding
  // B — breaks the session-row upsert + continuity). So persist the canonical
  // node_id back into the raw old config NOW, before cpSync, so the new dir
  // inherits the same id. (通信牛 R3 review — Minimal Patch A.)
  if (!stored.node_id) stored.node_id = generateNodeId();  // theoretical fallback — normalize always fills it
  saveProfile(oldId, stored);  // unconditional: bakes the canonical node_id into the raw config cpSync will copy
  console.log(`[anet] persisted canonical node_id ${stored.node_id} before rename.`);

  // ── PHASE 1: PREPARE (copy/prepare, old node untouched — fully rollbackable) ──
  writeFileSync(lockPath, JSON.stringify({ old: oldId, new: newName, phase: "prepare", ts: Date.now() }) + "\n");
  let txnId: string | null = "";
  try {
    // P2: copy (not move) old → new + update config.alias
    // #457 — pre-create newDir with 0700 so cpSync preserves target dir mode.
    // Node fs.cp does NOT overwrite an existing dest dir's mode; if we let
    // cpSync create newDir, it defaults to umask (0755 under umask 022) and
    // then fails opencode-preset's 0700 predjection at PHASE-3 wiring. Verified
    // Node 20.20.0: `mkdirSync(dst,{mode:0o700})` + `cpSync(src,dst)` leaves
    // dst at 0700 even when src is 0755. Structural fix, no post-cpSync chmod
    // (would be TOCTOU vs the预检's own identity-bound fchmod branch).
    mkdirSync(newDir, { mode: 0o700, recursive: false });
    // cpSync also creates nested directories through the process umask. For
    // OpenCode profiles that would turn the private .config/.local/cache tree
    // into 0755 and make PHASE 1 reject its own copy. Establish and validate
    // every private root before copying; cpSync preserves an existing target
    // directory, so no post-copy chmod or check-then-repair window is needed.
    if (normalizeRuntime(stored) === "opencode-cli") {
      prepareOpencodeNodeForProfileWrite(newDir);
    }
    cpSync(oldDir, newDir, { recursive: true });
    const newLock = join(newDir, "rename.lock");
    if (existsSync(newLock)) rmSync(newLock, { force: true });  // lock belongs to oldDir only
    // #146 — cpSync also copies the old node's `.pid`; that PID belongs to the
    // OLD process and must not leak into the new dir (would mislead stopNode /
    // `running` detection for the new node). The new process writes its own
    // .pid on spawn.
    const newPid = join(newDir, ".pid");
    if (existsSync(newPid)) rmSync(newPid, { force: true });
    const newProfile = loadStoredProfile(newName) || { ...stored };
    newProfile.node_name = newName;
    newProfile.alias = newName;
    saveProfile(newName, newProfile);
    // P3: commhub prepare-rename
    const prep = await fetch(`${hub}/api/node-rename/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ network_id: networkId, old_alias: oldId, new_alias: newName }),
    }).then(r => r.json() as any);
    if (!prep.ok) {
      // PR-3 (#110) — purely-created nodes (`anet node create` without ever
      // running `anet node start`) have no commhub `sessions` row, so
      // server-side prepareRename rejects with "node not found in this
      // network". RFC-010 §4.1 lists `created` as a recommended rename path,
      // so falling out here contradicts the spec. Detect this case and fall
      // back to a local-only rename: the local config dir + alias rename
      // happens, and there's nothing on the server to coordinate yet.
      //
      // Three error shapes are tolerated:
      //   1. PR-2 (server-side, landed): `{ ok:false, code:"node_local_only",
      //      error:"node 'X' has no server session in this network", suggested:"rename locally" }`
      //      — `code` field carries the type; `error` is the human-readable msg.
      //   2. Legacy `error` field containing the literal "node_local_only" string
      //      (kept for any older server build that conflated the two fields).
      //   3. Pre-PR-2 servers: `error` substring match on whatever wording the
      //      server used ("has no server session" or "not found in this network").
      //
      // The original PR-3 (#225 / commit f28ffd9) only checked shapes 2+3 with
      // a regex that didn't match server's actual wording — 测试马's PR-5
      // Case 2 caught it: server returned the new shape (1), CLI fell through
      // to throw, rename hard-failed for purely-created nodes (regressing the
      // exact case #110 was meant to fix). Switch to checking `prep.code` as
      // the primary signal (matches the server contract) and widen the regex
      // fallback to include the server's actual "has no server session" phrase.
      const errStr = String(prep.error || "");
      const isLocalOnly = prep.code === "node_local_only"
        || prep.error === "node_local_only"
        || /node_local_only/i.test(errStr)
        || /has no server session/i.test(errStr)
        || /not found in this network/i.test(errStr)
        || /node .* not found/i.test(errStr);
      if (isLocalOnly) {
        console.log(`[anet] note: "${oldId}" has no server registration yet (never started). Performing local-only rename — no commhub 2PC needed.`);
        // Strip lock + drop the local-only flag for PHASE 2 commit path
        if (existsSync(lockPath)) {
          const lockData = JSON.parse(readFileSync(lockPath, "utf-8"));
          lockData.local_only = true;
          writeFileSync(lockPath, JSON.stringify(lockData));
        }
        txnId = null;  // signal no server txn to PHASE 2 commit / rollback
      } else {
        throw new Error(`commhub prepare-rename: ${prep.error}`);
      }
    } else {
      txnId = prep.txn_id;
    }
  } catch (e: any) {
    // ── PHASE 1 失败回滚: old 原封不动 ──
    console.error(`[anet] rename PHASE 1 failed: ${e.message} — rolling back`);
    let bindingCleanupError: any;
    if (existsSync(newDir)) {
      try {
        removeOpencodeRuntimeBinding(newDir, opencodeBindingHome());
      } catch (cleanupError: any) {
        bindingCleanupError = cleanupError;
      }
      if (!bindingCleanupError) rmSync(newDir, { recursive: true, force: true });
    }
    // PR-3 (#110) — txnId is null for local-only renames; no server abort needed.
    if (txnId) {
      await fetch(`${hub}/api/node-rename/abort`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ txn_id: txnId }),
      }).catch(() => {});
    }
    if (existsSync(lockPath)) rmSync(lockPath, { force: true });
    if (bindingCleanupError) {
      console.error(
        `[anet] rollback INCOMPLETE — failed to remove the prepared external OpenCode binding: ` +
        `${bindingCleanupError?.message || bindingCleanupError}`,
      );
      console.error(`[anet] prepared directory preserved for recovery: .anet/nodes/${newName}`);
    } else {
      console.error(`[anet] rollback complete — "${oldId}" unchanged.`);
    }
    process.exit(1);
  }

  // ── PHASE 2: COMMIT (顺序敏感: commhub 路由 → tmux → 删 old) ──
  // PR-3 (#110) — local-only rename skips server C1 (no txn to commit; the
  // purely-created node had no commhub side to coordinate). Fall through
  // directly to the local cutover (kill old / tmux / dir delete / restart).
  const localOnly = txnId === null;
  const commit = localOnly
    ? { ok: true }
    : await fetch(`${hub}/api/node-rename/commit`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ txn_id: txnId }),
      }).then(r => r.json() as any).catch((e: any) => ({ ok: false, error: String(e?.message || e) }));
  if (!commit.ok) {
    // C1 失败: commhub 路由未切, 仍可干净回滚
    console.error(`[anet] rename PHASE 2 C1 (commhub commit) failed: ${commit.error} — rolling back`);
    let bindingCleanupError: any;
    if (existsSync(newDir)) {
      try {
        removeOpencodeRuntimeBinding(newDir, opencodeBindingHome());
      } catch (cleanupError: any) {
        bindingCleanupError = cleanupError;
      }
      if (!bindingCleanupError) rmSync(newDir, { recursive: true, force: true });
    }
    // PR-3 (#110) — txnId is null for local-only path; nothing to abort server-side.
    if (txnId) {
      await fetch(`${hub}/api/node-rename/abort`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ txn_id: txnId }),
      }).catch(() => {});
    }
    if (existsSync(lockPath)) rmSync(lockPath, { force: true });
    if (bindingCleanupError) {
      console.error(
        `[anet] rollback INCOMPLETE — failed to remove the prepared external OpenCode binding: ` +
        `${bindingCleanupError?.message || bindingCleanupError}`,
      );
      console.error(`[anet] prepared directory preserved for recovery: .anet/nodes/${newName}`);
    } else {
      console.error(`[anet] rollback complete — "${oldId}" unchanged.`);
    }
    process.exit(1);
  }

  // C2 (#146 Option B — RESTART, not tmux-rename): a running agent-node has
  // its alias frozen in a `const` at startup (agent-node/src/cli.ts:112, no
  // live-reload — confirmed by SDK马 agent-node-side audit). After the
  // commhub routing switch the old process keeps polling get_inbox, keeps
  // its SSE at /events/<old>, and keeps report_status under the OLD alias —
  // node goes orphan (invisible under the new name, no message delivery),
  // and its 3-min report_status can even revert the rename (SDK马 Finding
  // B). The earlier `tmux rename-session` only relabelled the window — it
  // left the stale-alias process alive, which IS the #146 bug.
  //
  // Fix: stop the old process (graceful SIGTERM → its shutdown handler
  // reports offline under the old alias, clearing the stale session) then
  // relaunch under the new alias. The new process re-reads newDir/config.json
  // — the `session` field was preserved by the PHASE 1 cpSync, so the
  // Claude / agent session resumes (no context loss). RFC-013 hot-reload
  // (zero-gap alias swap) stays the v0.12.0 path; for a P0 it is too heavy.
  let oldProcessConfirmedDead = !running;  // not running → nothing to kill, trivially "dead"
  if (running) {
    console.log(`[anet] node was running — restarting under new alias "${newName}" (#146 Option B)...`);

    // GOTCHA-2 (#146, #168 family) — best-effort drain. Killing a node
    // mid-task drops that task with no reply; wait (bounded 60s) for it to
    // go idle first. --force already signals the user accepts that a
    // stuck/long task may still be interrupted past this wait.
    const drained = await waitForNodeIdle(hub, token, networkId, oldId, 60000);
    if (!drained) {
      console.warn(`[anet] ⚠ "${oldId}" still running a task after 60s — proceeding with restart (--force).`);
      console.warn(`[anet]   An in-flight task may be interrupted without a reply (dispatcher's task stays open).`);
    }

    // #146 R1 / #180 — terminate every live agent process of the old node and
    // CONFIRM exit. A surviving old process keeps polling get_inbox + heart-
    // beating report_status under the OLD alias; commhub's ON CONFLICT(resume_id)
    // upsert then reverts the rename (SDK马 Finding B). Re-scan by command line
    // at kill time (reuse-proof — never trusts a stale .pid, never SIGKILLs an
    // unrelated recycled pid). Each: SIGTERM → 8s wait → SIGKILL (--force) → 3s.
    // #180 R2 — re-scan; if `ps` now fails fall back to the detection-time set
    // (never silently treat the old node as already stopped).
    //
    // #1458 — re-scan via findNodeStopCandidates so we have discoveredBirth
    // for the fresh live set too. Fallback stays to the detection-time
    // candidates (oldCandidates), NOT bare pids — otherwise the fallback
    // path would silently drop the pid-reuse guard the primary path has.
    // Before EACH kill, verify (pid, discoveredBirth) still names the same
    // incarnation via isSameIncarnation. If pid was recycled, skip (agent A
    // is already gone; B is unrelated and must not be signaled).
    const livePidsCandidates = findNodeStopCandidates(oldDisplay, oldId) ?? oldCandidates;
    for (const { pid, discoveredBirth } of livePidsCandidates) {
      if (!isSameIncarnation(pid, discoveredBirth, probeCurrentBirthSignature)) {
        // pid was recycled OR vanished between discovery/re-scan and this
        // moment. Either way there is nothing of ours to signal here.
        // Log so operators know a recycled-pid case actually fired in
        // production (currently zero measured occurrences; this makes it
        // observable). Do NOT push to oldSurvivors — the agent we wanted
        // gone (A) is gone.
        console.log(`[anet] pid ${pid} was recycled or vanished since discovery — not signaling (agent already gone).`);
        continue;
      }
      if (!(await terminateNodeProcess(pid, force))) {
        oldSurvivors.push(pid);
        console.error(`[anet] ✗ old agent process (pid ${pid}) did not exit after SIGTERM${force ? " + SIGKILL" : " (no SIGKILL — that needs --force)"}.`);
      }
    }
    oldProcessConfirmedDead = oldSurvivors.length === 0;
    if (oldProcessConfirmedDead && livePidsCandidates.length > 0) {
      console.log(`[anet] stopped old agent process(es): ${livePidsCandidates.map(c => c.pid).join(", ")}`);
    }

    // #180 — sweep MCP bridge orphans. claude-code-cli spawns `.anet/node-
    // server.js` as an MCP stdio child; when claude dies (esp. via SIGKILL
    // above), that child reparents to PID 1 and keeps heart-beating with
    // the OLD alias via inherited COMMHUB_ALIAS env → dashboard ghost +
    // commhub ON CONFLICT(resume_id) upsert reverts the rename (SDK马
    // Finding B — the exact "rename ghost" reported in #180). agent-node
    // runtimes don't hit this (in-process MCP, no separate subprocess) —
    // only claude-code-cli. Sweep by /proc/<pid>/environ COMMHUB_ALIAS
    // match — catches any inheriting descendant regardless of argv shape.
    // Real repro numbers: docs/tests/p-180-rename-ghost/run-4.txt.
    const mcpSwept = await sweepMcpOrphansForAlias(force, oldDisplay, oldId);
    if (mcpSwept.length > 0) {
      console.log(`[anet] swept MCP bridge orphan(s) inheriting old alias: pid=${mcpSwept.join(",")}`);
    }
    if (tmuxSessionRunning(oldId)) killTmuxSession(oldId);
    // brief grace so the old SSE/heartbeat + final writebackSession() tear down
    await new Promise(r => setTimeout(r, 1500));

    // GOTCHA-1 (#146) — session resume staleness. newDir/config.json is the
    // PHASE-1 cpSync snapshot. If the old process ran a task between PHASE 1
    // and the kill, agent-node's writebackSession() updated the *old*
    // config's `session` UUID — not the copy. Now that the old process is
    // fully dead (no more writeback), re-sync the latest session from the
    // old config into the new one so the restart resumes the current
    // session (no context loss). oldDir still exists — C3 deletes it next.
    try {
      const oldCfgPath = join(oldDir, "config.json");
      const newCfgPath = join(newDir, "config.json");
      if (existsSync(oldCfgPath) && existsSync(newCfgPath)) {
        const oldCfg = JSON.parse(readFileSync(oldCfgPath, "utf-8"));
        const newCfg = JSON.parse(readFileSync(newCfgPath, "utf-8"));
        if (oldCfg.session && oldCfg.session !== newCfg.session) {
          newCfg.session = oldCfg.session;
          atomicWritePrivateJson(newCfgPath, newCfg);
          console.log(`[anet] re-synced session ${String(oldCfg.session).slice(0, 8)}… from old config (post-task writeback) — context preserved.`);
        }
      }
    } catch (e: any) {
      console.warn(`[anet] ⚠ session re-sync skipped: ${e?.message || e} — restart may resume an earlier session.`);
    }
  }

  // C3: 原子切换本地 — 删 old 目录 (含其中 rename.lock)。在 restart 前删, 这样
  // 重启进程不会看到 stale old dir。
  try {
    removeOpencodeRuntimeBinding(oldDir, opencodeBindingHome());
  } catch (e: any) {
    console.error(
      `[anet] ❌ rename is committed in CommHub, but the old external OpenCode binding ` +
      `could not be removed: ${e?.message || e}`,
    );
    console.error(`[anet]    Both local directories were preserved; do not reuse "${oldId}" until the binding is repaired.`);
    process.exit(1);
  }
  try {
    rmSync(oldDir, { recursive: true, force: true });
  } catch (e: any) {
    console.warn(`[anet] ⚠ failed to remove old config dir .anet/nodes/${oldId}: ${e?.message || e} — rename is committed; clean up the stale dir manually.`);
  }
  writeLegacyProjectAlias(newName);

  // C4 (#146 R2): relaunch the renamed node + verify a *real new process*
  // came up. The restart only fires when the old process is confirmed dead
  // (R1 — else two processes would fight over the same resume_id) and tmux is
  // available (R4). verifyNodeRestarted keys on the new node's live .pid, not
  // on the hub row alone — commitRename renames that row in place, so an
  // alias-match check would pass even if the new process never started.
  let restartFired = false;
  let restartOutcome: { ok: boolean; reason: string } | null = null;
  if (running && oldProcessConfirmedDead && canAutoRestart) {
    const restartStartedAt = Date.now();
    try {
      startNodeTmuxSession(newName, newName);  // detached tmux: `anet node start <newName>`
      restartFired = true;
      // #176 / RFC-018 ③ — a claude-code-cli node restart hits Claude Code's
      // dev-channels confirmation prompt; auto-confirm it concurrently with
      // the liveness check so the rename stays zero-interaction.
      const [outcome] = await Promise.all([
        verifyNodeRestarted(hub, token, networkId, newName, restartStartedAt, 30000),
        autoConfirmDevChannels([{ id: newName, alias: newName, profile: stored }]),
      ]);
      restartOutcome = outcome;
    } catch (e: any) {
      console.warn(`[anet] ⚠ rename committed but auto-restart failed: ${e?.message || e}`);
    }
  }

  // #146 / RFC-018 Fix 4 — runtime-accurate identity note. For claude-code-cli
  // the commhub session row never carries node_id; its identity is the
  // resume_id (cc-<node_id>, pinned by Fix 1). The old unconditional
  // "node_id unchanged" line misled for that runtime (commhub shows
  // node_id=null), so branch the message on runtime.
  if (normalizeRuntime(stored) === "claude-code-cli") {
    console.log(`[anet] node_id ${stored.node_id} unchanged in local config; this runtime's commhub identity is resume_id cc-${stored.node_id} — also stable across the rename. ntok_ token still valid.`);
  } else {
    console.log(`[anet] node_id: ${stored.node_id} — unchanged (only the alias changed; ntok_ token still valid).`);
  }
  if (!running) {
    console.log(`[anet] ✅ Renamed "${oldId}" → "${newName}" (txn ${txnId}). Node was not running — next \`anet node start ${shellQuote(newName)}\` registers under the new alias.`);
  } else if (!oldProcessConfirmedDead) {
    // R1 — old process survived SIGTERM+SIGKILL. Starting the new alias now
    // would let two processes heart-beat the same resume_id and revert the
    // rename (Finding B). Stop here and hand the user a manual recovery path.
    console.error(`[anet] ⚠ Renamed "${oldId}" → "${newName}" (txn ${txnId}) — but old agent process(es) ${oldSurvivors.join(", ")} are still alive.`);
    console.error(`[anet]   Do NOT leave them running: the heartbeat can revert the rename. Recover manually:`);
    console.error(`[anet]     1) kill -9 ${oldSurvivors.join(" ")}`);
    console.error(`[anet]     2) anet node start ${shellQuote(newName)}`);
    process.exit(1);
  } else if (!canAutoRestart) {
    console.log(`[anet] ✅ Renamed "${oldId}" → "${newName}" (txn ${txnId}) — old process stopped. tmux unavailable: start the node manually: anet node start ${shellQuote(newName)}`);
  } else if (restartFired && restartOutcome?.ok) {
    console.log(`[anet] ✅ Renamed "${oldId}" → "${newName}" (txn ${txnId}) — agent restarted + verified live under the new alias (${restartOutcome.reason}).`);
  } else if (restartFired) {
    console.warn(`[anet] ⚠ Renamed "${oldId}" → "${newName}" (txn ${txnId}) — restart fired but a live new process could not be verified (${restartOutcome?.reason ?? "unknown"}).`);
    console.warn(`[anet]   Check: anet logs ${shellQuote(newName)}  |  anet status   — or restart: anet node start ${shellQuote(newName)}`);
  } else {
    console.warn(`[anet] ⚠ Renamed "${oldId}" → "${newName}" (txn ${txnId}) — old process stopped but auto-restart did not fire. Start manually: anet node start ${shellQuote(newName)}`);
  }
}

// ── notify server ──

async function notifyServerOffline(profile: Profile, nodeId: string) {
  const gc = loadGlobal();
  const hub = profile.hub || gc.hub;
  if (!hub) return;
  const displayName = nodeDisplayName(nodeId, profile);
  const resumeId = profile.node_id ? `sdk-${profile.node_id}` : `sdk-${displayName}-0`;
  try {
    // MCP call: report_status offline
    await fetch(`${hub}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", ...authHeaders(profile.token || gc.token) },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "anet-cli", version: "1.0" } },
      }),
    });
    await fetch(`${hub}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", ...authHeaders(profile.token || gc.token) },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "report_status", arguments: { resume_id: resumeId, alias: displayName, status: "offline" } },
      }),
    });
  } catch {}
}

// ── stop ──

type StopNodeResult = { status: "not-running" | "stopped" | "survived"; pid?: number };

async function stopNode(nodeId: string): Promise<StopNodeResult> {
  const pidFile = join(nodesDir(), nodeId, ".pid");
  if (!existsSync(pidFile)) return { status: "not-running" };
  const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
  if (isNaN(pid)) {
    rmSync(pidFile, { force: true });
    return { status: "not-running" };
  }
  if (!pidAlive(pid)) {
    rmSync(pidFile, { force: true });
    return { status: "not-running", pid };
  }
  if (await terminateNodeProcess(pid, false)) {
    rmSync(pidFile, { force: true });
    return { status: "stopped", pid };
  }
  // Keep the pidfile: a surviving runtime must remain visible to the next
  // stop/restart attempt, and the CLI must not claim it is offline.
  return { status: "survived", pid };
}

// Marker-bearing co-presence generations are stopped exclusively by the
// identity reaper.  After it succeeds, the pidfile is bookkeeping only: we
// may remove a dead/stale entry, but must never signal an alive PID through
// this second authority (it may already have been reused by an unrelated
// process after the marker generation exited).
function clearStoppedIdentityPidFile(nodeId: string): StopNodeResult {
  const pidFile = join(nodesDir(), nodeId, ".pid");
  if (!existsSync(pidFile)) return { status: "not-running" };
  const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
  if (isNaN(pid)) {
    rmSync(pidFile, { force: true });
    return { status: "not-running" };
  }
  if (!pidAlive(pid)) {
    rmSync(pidFile, { force: true });
    return { status: "not-running", pid };
  }
  return { status: "survived", pid };
}

function clearAuditedLegacyPidFile(nodeId: string): StopNodeResult {
  const pidFile = join(nodesDir(), nodeId, ".pid");
  if (!existsSync(pidFile)) return { status: "not-running" };
  const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
  rmSync(pidFile, { force: true });
  // The alias/birth audit has just proved no owned generation remains. An
  // alive numeric PID here is therefore stale/reused, never kill authority.
  return { status: "stopped", ...(Number.isNaN(pid) ? {} : { pid }) };
}

async function stopCommand() {
  const stopInvokedAt = Date.now();
  const ref = args[1];
  if (!ref) {
    console.log(`
anet node stop <node-id|node-name>

Stop a running agent node.
`);
    return;
  }

  const resolved = resolveNodeRef(ref);
  if (!resolved) {
    console.error(nodeNotFound(ref));
    process.exit(1);
  }

  const displayName = nodeDisplayName(resolved.id, resolved.profile);
  let stopGeneration = "";
  let stopProcesses: LifecycleProcessIdentity[] = [];
  try {
    await withLifecycleLock(resolved.id, () => {
      const prior = readLifecycleOwner(resolved.id);
      stopGeneration = prior?.generation || randomUUID();
      let roots = prior?.processes || [];
      // 🔴 这一条与下面 alias-fallback 支里的 NODE_OWNER_BIRTH_UNAVAILABLE 是**两件事**,
      // 原先共用同一句错误 —— 于是 CI 上只看错误文本分不出是哪一种,#1422 的定位
      // 因此走过弯路。两者的成因完全不同:
      //   本条(RECEIPT):**收据里已记录**的某个 process 缺 birth 字段 —— 是持久化
      //     记录不完整,与当前进程是否存活无关。
      //   下面那条(带 `: pid=<n>`):ps 发现之后**现在读不到** /proc/<pid>/stat ——
      //     多半是那个 pid 已经退出(#1422 的 TOCTOU)。
      // 分开命名,让 CI 输出自身就能回答「是哪一种」。
      const missingBirth = roots.filter(p => !p.birth).map(p => p.pid);
      if (missingBirth.length > 0) {
        throw new Error(`NODE_OWNER_BIRTH_UNAVAILABLE_RECEIPT: pids=${missingBirth.join(",")}`);
      }
      // One-time migration for pre-receipt generations: discover by alias only
      // while holding stop-intent, then freeze exact identities. Reaping never
      // rescans by alias, so a later same-name generation cannot be adopted.
      if (roots.length === 0) {
        // #1438 — findNodeStopCandidates captures (pid, discoveredBirth) in
        // ONE `ps` snapshot; the (pid, birth) pair has no TOCTOU window
        // between the two fields. resolveOwnedRoots then verifies via
        // currentBirthSignature that the pid we're about to freeze still
        // belongs to the SAME incarnation — if it was recycled to another
        // process B between discovery and here, the mismatch check rejects
        // pid so reap does not kill B.
        const legacy = findNodeStopCandidates(displayName);
        if (legacy === null) throw new Error("NODE_PROCESS_TABLE_UNAVAILABLE");
        // #1422 (window with /proc read collapsing to no-op) is orthogonal:
        // if pid vanished cleanly between discovery and here, that's the
        // stop-outcome we wanted. probes.vanished (ESRCH-based) still
        // handles that path.
        roots = resolveOwnedRoots(legacy, {
          birth: processBirth,
          vanished: (pid) => processVanished(pid),
          currentBirthSignature: probeCurrentBirthSignature,
        });
      }
      stopProcesses = snapshotOwnedProcessTree(roots);
      writeLifecycleOwner(resolved.id, {
        schema: 1, state: "stopping", stopInvokedAt, generation: stopGeneration,
        ...(prior?.wrapperPid ? { wrapperPid: prior.wrapperPid, wrapperBirth: prior.wrapperBirth } : {}),
        processes: stopProcesses,
        ...(prior?.startInvokedAt ? { startInvokedAt: prior.startInvokedAt } : {}),
      });
    }, "stop-intent");
  } catch (e: any) {
    console.error(`[anet] ${e?.message || e}`);
    process.exit(1);
  }
  if (process.platform === "win32") {
    let record;
    try { record = readWindowsCopresenceRecord(nodesDir(), resolved.id); }
    catch (e) {
      console.error(`[anet] ❌ refusing Windows co-presence teardown: ${(e as Error).message}`);
      process.exit(1);
    }
    if (record) {
      const decision = decideWindowsManagedStop(record, probeWindowsCreationDate);
      for (const refused of decision.refused) {
        if (refused.reason === "pid-reused") {
          console.warn(`[anet] ⚠ ${refused.process.role} pid=${refused.process.pid} was reused; leaving the unrelated process untouched`);
        }
      }
      if (decision.refused.length > 0) {
        console.error(`[anet] STOP_TIMEOUT: Windows ownership could not be proven; hub was not notified offline.`);
        process.exit(1);
      }
      for (const managedProcess of [...decision.safe].reverse()) {
        try { taskkillWindowsProcessTree(managedProcess.pid); }
        catch (e) {
          console.error(`[anet] ❌ taskkill failed for ${managedProcess.role} pid=${managedProcess.pid}: ${(e as Error).message}`);
          process.exit(1);
        }
      }
      const windowsResiduals = decision.safe.filter(p => probeWindowsCreationDate(p.pid) === p.creationDate);
      if (windowsResiduals.length > 0) {
        console.error(`[anet] STOP_TIMEOUT: Windows managed processes survived: ${windowsResiduals.map(p => `${p.role}:${p.pid}`).join(", ")}`);
        process.exit(1);
      }
      rmSync(windowsCopresenceRecordPath(nodesDir(), resolved.id), { force: true });
      const pidResult = await stopNode(resolved.id);
      if (pidResult.status === "survived") {
        console.error(`[anet] STOP_TIMEOUT: Windows node pid ${pidResult.pid} survived; hub was not notified offline.`);
        process.exit(1);
      }
      await withLifecycleLock(resolved.id, () => writeLifecycleOwner(resolved.id, {
        ...(readLifecycleOwner(resolved.id) || { schema: 1 }), schema: 1, state: "stopped", stopInvokedAt,
      }));
      await notifyServerOffline(resolved.profile, resolved.id);
      console.log(`[anet] Stopped "${displayName}" (Windows managed app-server + bridge, server notified)`);
      return;
    }
  }
  let allowLegacyTmuxNameSweep = true;
  let identityTeardownKilled = false;
  // #122 — auto-tmux on start needs symmetric cleanup on stop. Kill the
  // tmux session first (idempotent — has-session check guards), then SIGTERM
  // the recorded PID and notify the hub. Order matters: killing tmux kills
  // any child processes too, which makes `stopNode` mostly a defensive op
  // when the PID file is stale.
  //
  // RFC-030 P3 — identity-gated teardown, BEFORE the legacy tmux-name sweep.
  //
  // For copresence nodes (marker file present), run the identity flow:
  // scan /proc/*/environ for ANET_NODE_MARKER=<uuid>, group by current PGID,
  // fail-closed homogeneity per group, TERM→grace→KILL. This reaps codex
  // subprocesses that survived tmux kill-session in P2 (see #466 blockers).
  //
  // For non-copresence nodes (marker file MISSING — the case for every
  // ordinary node including runtime=codex-app-server started WITHOUT
  // --copresence), this block is a silent no-op and the legacy sweep runs
  // unchanged. Gate keys on marker EXISTENCE, not on runtime string, so
  // ordinary codex-app-server nodes take the legacy path (zero-diff).
  try {
    const markerResult = readCopresenceMarker(nodesDir(), resolved.id);
    if (markerResult.kind === "ok") {
      // #466 — once a marker exists, identity owns teardown exclusively.
      // Falling through to the legacy name sweep would let an unrelated
      // process race in under the same tmux session name and be killed even
      // though it does not carry this node's marker.
      allowLegacyTmuxNameSweep = false;
      const uuid = markerResult.marker.marker;
      console.log(`[anet] copresence node — identity-gated teardown (uuid=${uuid.slice(0, 8)}…)`);
      const enumer = realEnumerator();
      const killer = realKiller();
      // Self-context check: refuse if caller ancestry carries the marker
      // (else stop would kill the shell we're running in).
      const selfCheck = callerCarriesMarker(enumer, uuid);
      if (selfCheck.self || selfCheck.ancestorPid) {
        console.error(`[anet] ❌ this stop command's ancestry includes a marker-carrying pid (${selfCheck.ancestorPid}).`);
        console.error(`[anet]    Running stop from inside the copresence tree would kill your own shell.`);
        console.error(`[anet]    Detach from the tmux session (Ctrl-b d) and run stop from an outside shell.`);
        process.exit(2);
      }
      const reapResult = await reapMarkerGroups(enumer, killer, uuid, {
        graceMs: 3000,
        logger: (m) => console.log(`[anet] ${m}`),
        // #P3fix必修1+2 — the recorded pane pids anchor the invariant-11
        // scope test, so a marker-carrying descendant whose environ we
        // cannot read (non-dumpable) is still accounted for instead of
        // being dropped. Each anchor is re-validated (alive + matching
        // starttime) inside the scan before it may widen scope.
        anchors: anchorsFromMarker(markerResult.marker),
      });
      if (reapResult.kind === "success") {
        removeCopresenceMarker(nodesDir(), resolved.id);
        identityTeardownKilled = reapResult.killedPgids.length > 0;
        console.log(`[anet] identity teardown OK (killed ${reapResult.killedPgids.length} pgroup(s))`);
      } else {
        console.error(`[anet] ⚠ identity teardown incomplete: ${reapResult.detail}`);
        console.error(`[anet]    marker preserved for idempotent retry; ${reapResult.residualPids.length} marker-bearing pid(s) may still be alive`);
        if (reapResult.skippedGroups.length > 0) {
          for (const s of reapResult.skippedGroups) {
            console.error(`[anet]    SKIPPED pgid=${s.pgid} — ${s.reason}`);
          }
        }
        // Fail closed. The marker remains the only trustworthy ownership
        // handle; neither tmux names nor the pidfile may replace it after an
        // incomplete identity proof.
        process.exit(1);
      }
    } else if (markerResult.cause !== "MISSING") {
      allowLegacyTmuxNameSweep = false;
      console.error(`[anet] ⚠ copresence marker present but refused (${markerResult.cause}): ${markerResult.detail}`);
      console.error(`[anet]    Refusing the legacy tmux-name sweep: identity could not be proven.`);
      process.exit(1);
    }
    // markerResult.cause === "MISSING" is the ordinary-node path: silent
    // fall-through to legacy sweep (zero-diff for every runtime that never
    // ran --copresence).
  } catch (e: any) {
    console.error(`[anet] ⚠ identity gate check crashed: ${e?.message || e}`);
    // readMarker represents a normal missing marker as {cause:"MISSING"};
    // reaching this catch means the ownership check itself failed.  Never
    // reinterpret that failure as permission to kill by name.
    console.error(`[anet]    Refusing the legacy tmux-name sweep: identity check did not complete.`);
    process.exit(1);
  }

  // RFC-030 P2 legacy path — nodes without an identity marker may own three
  // tmux sessions (`<alias>`, `<alias>-appsrv`, `<alias>-桥`). Sweep those
  // names only when marker absence proves this is the ordinary legacy path.
  // A marker-bearing generation was already handled above by exact identity;
  // name matching after that point would re-open #466's same-name kill race.
  const copresenceSessions = copresenceTmuxSessions(displayName);
  const tmuxTuiKilled = allowLegacyTmuxNameSweep && tmuxSessionRunning(copresenceSessions.tui);
  const tmuxAppsrvKilled = allowLegacyTmuxNameSweep && tmuxSessionRunning(copresenceSessions.appsrv);
  const tmuxBridgeKilled = allowLegacyTmuxNameSweep && tmuxSessionRunning(copresenceSessions.bridge);
  // The three flags above say a session WAS running, which is the condition for
  // trying. Whether the kill landed is a second question, and reporting the
  // first as if it answered the second is how "Stopped X (tmux(tui) killed)"
  // could print over a session that is still up.
  const stillUp: string[] = [];
  for (const [wanted, session] of [
    [tmuxTuiKilled, copresenceSessions.tui],
    [tmuxAppsrvKilled, copresenceSessions.appsrv],
    [tmuxBridgeKilled, copresenceSessions.bridge],
  ] as Array<[boolean, string]>) {
    if (wanted && !killTmuxSession(session)) stillUp.push(session);
  }
  if (stillUp.length > 0) {
    console.error(`[anet] ❌ tmux kill-session did not take for: ${stillUp.join(", ")}`);
    console.error(`[anet]    "${displayName}" is NOT stopped; the hub was not notified offline.`);
    console.error(`[anet]    Look: tmux attach -t ${shellQuote(`=${stillUp[0]}`)}`);
    process.exit(1);
  }
  const tmuxKilled = identityTeardownKilled || tmuxTuiKilled || tmuxAppsrvKilled || tmuxBridgeKilled;
  const generationResiduals = allowLegacyTmuxNameSweep
    ? await reapOwnedGeneration(stopProcesses)
    : [];
  if (generationResiduals.length > 0) {
    console.error(`[anet] STOP_TIMEOUT: could not prove "${displayName}" stopped; hub was not notified offline.`);
    for (const residual of generationResiduals) console.error(`[anet]    residual ${residual.kind}: ${residual.detail}`);
    process.exit(1);
  }
  const stopResult = allowLegacyTmuxNameSweep
    ? clearAuditedLegacyPidFile(resolved.id)
    : clearStoppedIdentityPidFile(resolved.id);
  if (stopResult.status === "survived") {
    console.error(`[anet] could not confirm that "${displayName}" exited (pid ${stopResult.pid}); pidfile retained and PID was not signalled.`);
    process.exit(1);
  }
  // #1385 — the 3s window red-flagged healthy-but-slow socket teardown on
  // busy CI runners (4 distinct stop scenarios, all green on main, all red
  // only under PR-peak load). 10s keeps the gate hard (a leaked listener
  // still fails) while no longer punishing a runner for being slow; the
  // per-residual age line below tells "slow teardown" apart from a real
  // leak when it DOES fire.
  const SOCKET_RESIDUAL_WINDOW_MS = 10_000;
  const socketDeadline = Date.now() + SOCKET_RESIDUAL_WINDOW_MS;
  let socketResiduals = nodeSocketResiduals(resolved.profile);
  while (socketResiduals.length > 0 && Date.now() < socketDeadline) {
    await new Promise(r => setTimeout(r, 100));
    socketResiduals = nodeSocketResiduals(resolved.profile);
  }
  // #1422 —— 走到这里说明属主进程已经被证明消失(上面 reapOwnedGeneration /
  // clearStoppedIdentityPidFile 都过了),但 socket **路径名**还在。
  //
  // 实测(test225 一次确认的红,签名与 08-29 CI 逐字相同):这时的 leader.sock
  // 在 /proc/net/unix 里**一行都没有**,listeners=0 —— 它是个孤儿路径名,
  // 不是"还在拆卸"。成因:删它的 removeUnchangedStaleSocket 住在 agent-node
  // 进程里(grok-copresence/leader-lifecycle.ts:501),而 stop 的
  // reapOwnedGeneration 是 SIGTERM → 宽限 → SIGKILL。**#1522 之前那个宽限是 5s**,
  // 而负载下 agent-node 侧那条拆卸链(每段默认 2000ms,最坏 8s)跑不完 5 秒就被
  // SIGKILL,清理永不执行。
  // 🔴 #1751 已从另一端修掉:宽限 5s → 10s(10 > 8),并加了
  //    agent-network/src/stop-grace-covers-teardown.test.ts 钉住
  //    「CLI 宽限 > timeoutMs × 4」。下面这段窗口的历史成因保留在这里,
  //    因为它解释了 #1385 当年为什么放大窗口也没用。
  // 于是这里的窗口在等一个五秒前被自己杀掉的清扫者 —— 窗口放到多大都等不到,
  // #1385 把 3s 放到 10s 只压低了命中率。
  //
  // 🔴 路径**重新算**,不信 profile 里存的那个:grokCopresenceSocketPaths 是纯函数,
  //    只有与它算出来的规范路径**完全相等**的残留才允许回收。一个被写坏的
  //    profile 因此带不进来别处的 socket —— 前缀校验做不到这一点。
  if (socketResiduals.length > 0) {
    // 🔴 用 **profile.node_id**,不是 resolved.id。resolveNodeRef 返回的 id 是
    //    **目录名(别名)**(`loadProfile(ref)` 成功即 `{ id: ref }`),而 socket 路径是
    //    `anet node create` 用 **node_id** 算的。喂错 id ⇒ 算出的路径永远对不上 ⇒
    //    一条都回收不了 —— 而且**完全静默**(下面的循环体一次都不进)。
    //    我第一版就是这么写的,12 轮验收里 4 次红、0 次回收,红话与修复前逐字相同。
    // 🔴 用 **profile.node_id**,不是 resolved.id。resolveNodeRef 返回的 id 是
    //    **目录名(别名)**(`loadProfile(ref)` 成功即 `{ id: ref }`),而 socket 路径是
    //    `anet node create` 用 **node_id** 算的 —— 喂错 id 算出的路径永远对不上,
    //    可回收集合恒为空,而且**完全静默**。判据与三种结局见
    //    src/stale-socket.ts 的 canonicalSocketsForProfile(带回归测试)。
    const canonicalOutcome = canonicalSocketsForProfile(
      resolved.profile as any,
      (nodeId) => grokCopresenceSocketPaths(nodeId),
    );
    let canonical: { leaderSocket: string; attachSocket: string } | null = null;
    if (canonicalOutcome.kind === "ok") {
      canonical = { leaderSocket: canonicalOutcome.leaderSocket, attachSocket: canonicalOutcome.attachSocket };
    } else if (canonicalOutcome.kind === "mismatch") {
      console.error(`[anet]    stale-socket reclaim skipped: recomputed canonical socket path does not match the profile's`);
    } else if (canonicalOutcome.kind === "uncomputable") {
      console.error(`[anet]    stale-socket reclaim skipped: cannot compute canonical socket paths (${canonicalOutcome.detail})`);
    } else {
      console.error(`[anet]    stale-socket reclaim skipped: profile has no node_id`);
    }
    if (canonical) {
      const runtimeRoot = dirname(canonical.leaderSocket);
      const reapable = planReapableSockets(canonical, socketResiduals.map(r => r.path));
      if (reapable.length === 0) {
        // 有残留、却一个都不在可回收集合里 —— 说出来。静默跳过会让"守卫拒绝了一切"
        // 和"根本没有残留"长得一模一样。
        console.error(`[anet]    stale-socket reclaim matched none of ${socketResiduals.length} residual(s)`);
      }
      for (const target of reapable) {
        const outcome = reapStaleSocket(target, {
          procNetUnix: () => readFileSync("/proc/net/unix", "utf8"),
          lstat: (target) => {
            try {
              const st = lstatSync(target);
              return { dev: st.dev, ino: st.ino, uid: st.uid, isSocket: st.isSocket() };
            } catch { return null; }
          },
          unlink: (target) => unlinkSync(target),
          currentUid: () => process.getuid?.() ?? -1,
        }, { allowedRoot: runtimeRoot });
        if (outcome.kind === "removed") {
          console.log(`[anet] reclaimed stale socket: ${target} (owner proven gone, no listener in /proc/net/unix)`);
        } else if (outcome.kind !== "absent") {
          console.error(`[anet]    kept ${target}: ${outcome.kind}${"detail" in outcome ? ` — ${outcome.detail}` : ""}`);
        }
      }
      socketResiduals = nodeSocketResiduals(resolved.profile);
    }
  }
  if (socketResiduals.length > 0) {
    console.error(`[anet] STOP_TIMEOUT: authoritative local resources survived for "${displayName}" after ${SOCKET_RESIDUAL_WINDOW_MS}ms; hub was not notified offline.`);
    for (const residual of socketResiduals) {
      let age = "unknown-age";
      let listener = "listener=unknown";
      const target = residual.path;
      if (target) {
        // 🔴 这个年龄是 **bind 到现在**,不是"残留了多久":unix socket 的 mtime
        //    定在 bind 那一刻,监听不更新它、close 也不更新(实测)。所以它约等于
        //    节点已经运行了多久,**不能**用来区分"真泄漏"和"还在拆卸" ——
        //    #1385 原来的措辞正是这么声称的,对任何残留都会打成"真泄漏"。
        //    真正能区分的是下面的 listener=。
        try { age = `${Math.round(Date.now() - lstatSync(target).mtimeMs)}ms since bind`; } catch {}
        try {
          listener = unixSocketPathInUse(readFileSync("/proc/net/unix", "utf8"), target)
            ? "listener=yes — someone still holds it; teardown did not finish"
            : "listener=no — orphan pathname that was not reclaimed (see kept-line above for why)";
        } catch (e: any) { listener = `listener=unknown (/proc/net/unix unreadable: ${e?.code || "?"})`; }
      }
      console.error(`[anet]    residual ${residual.kind}: ${residual.detail} (${age}, ${listener})`);
    }
    process.exit(1);
  }
  await withLifecycleLock(resolved.id, () => {
    const owner = readLifecycleOwner(resolved.id);
    if (!owner || owner.generation !== stopGeneration || (owner.state !== "stopping" && owner.state !== "stopped")) {
      throw new Error("NODE_STOP_GENERATION_CHANGED");
    }
    if (owner.state === "stopped") return;
    writeLifecycleOwner(resolved.id, { ...(owner || { schema: 1 }), schema: 1, state: "stopped", stopInvokedAt });
  }, "stop-complete", stopGeneration);
  const killed = stopResult.status === "stopped";
  // Always notify server — even if PID file missing, server may have stale session
  await notifyServerOffline(resolved.profile, resolved.id);
  if (killed || tmuxKilled) {
    const tmuxLabels: string[] = [];
    if (identityTeardownKilled) tmuxLabels.push("identity");
    if (tmuxTuiKilled) tmuxLabels.push("tui");
    if (tmuxAppsrvKilled) tmuxLabels.push("appsrv");
    if (tmuxBridgeKilled) tmuxLabels.push("bridge");
    const what = [
      tmuxLabels.length ? `tmux(${tmuxLabels.join("+")})` : null,
      killed ? "process" : null,
    ].filter(Boolean).join(" + ");
    console.log(`[anet] Stopped "${displayName}" (${what} killed, server notified)`);
  } else {
    console.log(`[anet] "${displayName}" is not running locally (server notified offline)`);
  }
}

// ── project (#117) — cwd-wide node orchestration ─────────────────────
//
// Thin wrapper over `anet node start/stop` for every entry under
// .anet/nodes/. Each spawned node inherits #115's zero-interaction restart
// (CLAUDE_CODE_RESUME_THRESHOLD_MINUTES env injection inside launchAgent),
// so `anet project up` on 22 nodes is genuinely zero-keystroke.

interface ProjectNode { id: string; alias: string; profile: Profile | null; invalid?: string; }

function printProjectUsage() {
  console.log(`
anet project <up|restart|down> [options]

  up        Start every node under cwd's .anet/nodes/ (skip already-running)
  restart   Kill any existing tmux session and start fresh (every node)
  down      Stop every node (kill tmux + notify hub offline)

Options (shared):
  --stagger <seconds>   Delay between nodes (default: 3). 0 disables.
  --only a,b,c          Operate only on these aliases (or node ids)
  --exclude x,y         Skip these aliases (or node ids)

Examples:
  anet project up                           # 起所有，skip 已跑的
  anet project restart --stagger 1          # 全重启，1s 错峰
  anet project down --only commhub_1        # 只停一个
`);
}

function selectProjectNodes(): ProjectNode[] {
  const opts = parseOpts();
  const splitCsv = (s: string) => new Set(s.split(",").map(x => x.trim()).filter(Boolean));
  const only = opts.only && opts.only !== "true" ? splitCsv(opts.only) : null;
  const exclude = opts.exclude && opts.exclude !== "true" ? splitCsv(opts.exclude) : null;
  const out: ProjectNode[] = [];
  for (const id of listProfileIds()) {
    const profile = loadProfile(id);
    const alias = nodeDisplayName(id, profile);
    if (only && !only.has(alias) && !only.has(id)) continue;
    if (exclude && (exclude.has(alias) || exclude.has(id))) continue;
    // #174 — flag unstartable configs up-front. These are the cases
    // launchAgent hard-exits on before it can spawn an agent, so they must
    // be reported as `invalid` and never counted toward `up`.
    let invalid: string | undefined;
    if (!profile) {
      invalid = "config.json missing or not valid JSON";
    } else if (!profile.token) {
      invalid = "no token in config (run `anet doctor --fix`)";
    } else if (profile.token.startsWith("utok_") || profile.token.startsWith("atok_")) {
      invalid = `config has a ${profile.token.slice(0, 4)}_ token but a node needs ntok_ (run \`anet doctor --fix\`)`;
    }
    out.push({ id, alias, profile, invalid });
  }
  return out;
}

function parseStaggerMs(): number {
  const raw = parseOpts().stagger;
  if (raw === undefined) return 3000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`[anet] ❌ --stagger must be a non-negative number (got "${raw}")`);
    process.exit(1);
  }
  return Math.round(n * 1000);
}

/**
 * Make the exit code agree with the summary that was just printed.
 *
 * `project up` / `project restart` already measure each node with
 * verifySpawnedNodes and print every failure — the TEXT was honest. The exit
 * code was not: both returned normally, so a run that brought up 60 of 74 nodes
 * exited 0. Any caller that scripts this (a boot-time sweep, CI, a watchdog)
 * therefore had to re-derive the outcome itself, and one that trusted `$?` was
 * told the fleet was fine. Same defect class as #895's single-node path, one
 * level up.
 *
 * `invalid` counts too: a node whose config cannot start was never attempted,
 * so reporting success would hide it just as effectively as a crash.
 */
function exitFromProjectOutcome(
  failed: { alias: string; reason: string }[],
  invalid: { alias: string; reason: string }[] = [],
) {
  if (failed.length === 0 && invalid.length === 0) return;
  console.error(
    `[anet] ❌ exiting non-zero: ${failed.length} node(s) failed to come up` +
      (invalid.length ? `, ${invalid.length} with unstartable config` : "") +
      ` — see the list above.`,
  );
  process.exit(1);
}

function printProjectSummary(
  total: number,
  up: number,
  failed: { alias: string; reason: string }[],
  invalid: { alias: string; reason: string }[] = [],
) {
  console.log("\n──────────────────────────────────────────────");
  const parts = [`${up}/${total} up`];
  if (invalid.length) parts.push(`${invalid.length} invalid`);
  if (failed.length) parts.push(`${failed.length} failed`);
  console.log(`  ${parts.join(" · ")}`);
  if (invalid.length > 0) {
    console.log("  Invalid config (not started):");
    for (const n of invalid) console.log(`    ⚠ ${n.alias} — ${n.reason}`);
  }
  if (failed.length > 0) {
    console.log("  Failed:");
    for (const f of failed) console.log(`    ✗ ${f.alias} — ${f.reason}`);
    console.log("    → debug: anet logs <alias>  |  anet info <alias>");
  }
  console.log();
}

// #174 — verify a project-spawned node actually came alive. startNodeTmuxSession
// only confirms tmux accepted the detached command; the inner `anet node start`
// can still fail immediately (bad config, spawn error) — that used to be
// miscounted as "up" (N/N up false report). launchAgent writes
// .anet/nodes/<id>/.pid right after it spawns the agent child and removes it
// when the child exits. So: poll for a live pid, then require it to survive a
// short settle window — a child that fails fast writes .pid then has it
// removed on exit. Pure-local, no hub dependency. (Callers clear any stale
// .pid before spawning, so a pid seen here belongs to the fresh process.)
async function verifyNodeUp(nodeId: string, timeoutMs: number): Promise<{ ok: boolean; reason: string }> {
  const deadline = Date.now() + timeoutMs;
  const settleMs = 3000;
  let aliveSince = 0;
  while (Date.now() < deadline) {
    const pid = readNodePid(nodeId);
    if (pid !== null && pidAlive(pid)) {
      if (aliveSince === 0) aliveSince = Date.now();
      else if (Date.now() - aliveSince >= settleMs) return { ok: true, reason: `pid ${pid} alive` };
    } else {
      aliveSince = 0;  // not started yet, or started then died — restart the settle clock
    }
    await new Promise(r => setTimeout(r, 500));
  }
  const pid = readNodePid(nodeId);
  if (pid !== null && pidAlive(pid)) return { ok: true, reason: `pid ${pid} alive` };
  return {
    ok: false,
    reason: pid === null
      ? "no agent pid — inner `anet node start` exited before spawning (check config)"
      : "agent process died right after starting",
  };
}

// #174 — verify a batch of just-spawned nodes concurrently (so a slow/failed
// node does not serialize the whole project up/restart). Pushes failures into
// `failed`; returns the count that came up.
async function verifySpawnedNodes(spawned: ProjectNode[], failed: { alias: string; reason: string }[]): Promise<number> {
  if (spawned.length === 0) return 0;
  console.log(`\n[anet] verifying ${spawned.length} node(s) came up…`);
  const results = await Promise.all(spawned.map(n => verifyNodeUp(n.id, 20000)));
  let up = 0;
  spawned.forEach((n, i) => {
    if (results[i].ok) {
      console.log(`  ✅ ${n.alias}`);
      up++;
    } else {
      console.log(`  ✗  ${n.alias} — ${results[i].reason}`);
      failed.push({ alias: n.alias, reason: results[i].reason });
    }
  });
  return up;
}

// #176 — auto-confirm Claude Code's dev-channels prompt for a tmux-spawned
// claude-code-cli node. anet loads the commhub channel via
// `claude --dangerously-load-development-channels server:commhub`, which pops an
// interactive "WARNING: Loading development channels … (Enter to confirm)"
// prompt on every launch — breaking zero-interaction batch starts (#176). That
// prompt cannot be suppressed by any flag/env/settings in Claude Code 2.1.147.
// So: watch the tmux pane and, ONLY when the prompt's exact text is detected,
// send a single Enter to confirm it. Detection-gated — if the prompt never
// appears (non-claude node, already past it) nothing is ever sent, so a stray
// Enter can never land on a normal Claude UI. Best-effort.
//
// A workspace Claude Code has not seen before shows its folder-trust prompt
// BEFORE the dev-channels one. This watcher used to know only the dev-channels
// markers, so it spent its whole window staring at a trust prompt it would not
// answer; the dev-channels prompt then appeared after the window had already
// closed and nobody ever confirmed it. The node hung silently and the hub
// showed it offline — the failure mode looked identical to a node that was
// merely slow. So: answer the trust prompt too, and restart the clock when we
// do, because the window is meant to bound how long we wait for ONE prompt,
// not how long the whole trust-then-channels sequence takes.
async function dismissDevChannelPrompt(sessionName: string, timeoutMs: number): Promise<boolean> {
  let deadline = Date.now() + timeoutMs;
  let trustAnswered = false;
  while (Date.now() < deadline) {
    let pane = "";
    // Resolve the pane coordinate each iteration: the session may not have a
    // pane yet on the first poll, and a coordinate captured once could go stale.
    const paneTarget = tmuxPaneTarget(sessionName);
    if (!paneTarget) {
      // No pane for this exact session — it has not appeared yet, or it exited.
      // Keep waiting rather than declaring the prompt absent; the deadline ends
      // the loop.
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    try {
      // Discard tmux's stderr: polling a session that has already exited is a
      // normal outcome here, and letting `can't find pane: X` through made the
      // CLI print an alarming line right before an unrelated verdict.
      //
      // 🔴 这里**故意不加 `-S`**,和 #849 修的那两处相反 —— 因为问题不同:
      // 那两处找的是「**曾经出现过**的一行」(就绪信号 / 失败原因),必须看回滚;
      // 这里判的是「**此刻屏幕上有没有一个等人回答的提示框**」。加上回滚,一个
      // 早就被答掉、已经滚走的提示框会被重新识别成待处理,于是往一个并没有显示
      // 它的会话里 send-keys。**同一个 flag,这三处里两处该加、一处不该。**
      pane = execFileSync("tmux", ["capture-pane", "-p", "-t", paneTarget], {
        encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"],
      }).toString();
    } catch {
      return false;  // session gone / tmux error — nothing to confirm
    }
    const prompt = classifyPanePrompt(pane);
    if (prompt === "folder-trust" && !trustAnswered) {
      // Settle briefly so Ink's input handler is fully attached, then accept.
      await new Promise(r => setTimeout(r, 700));
      try { execFileSync("tmux", ["send-keys", "-t", paneTarget, "Enter"], { stdio: "ignore" }); } catch {}
      trustAnswered = true;
      deadline = Date.now() + timeoutMs;  // fresh window for the prompt we came for
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }
    if (prompt === "dev-channels") {
      // Prompt is rendered and waiting. Settle briefly so Ink's input handler
      // is fully attached, then confirm with a single Enter.
      await new Promise(r => setTimeout(r, 700));
      try { execFileSync("tmux", ["send-keys", "-t", paneTarget, "Enter"], { stdio: "ignore" }); } catch {}
      return true;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;  // prompt never appeared within the window
}

// Read a dead/live pane and turn it into the reason the start failed. Used only
// on the failure path, where the pane holds the inner command's own words.
function capturePaneReason(sessionName: string): string | null {
  try {
    const paneTarget = tmuxPaneTarget(sessionName);
    if (!paneTarget) return null;  // session already reaped
    // 🔴 同 #849:找的是「**曾经出现过**的那一行拒绝原因」,不是「此刻屏幕上有什么」。
    // 一个已经死掉的 pane,它的报错很可能已被后续输出顶出可见区 —— 不带 `-S` 就会
    // 拿到 null,调用方回退到一句泛化的失败文案,而真正的原因明明还在回滚里。
    const pane = execFileSync("tmux", ["capture-pane", "-p", "-t", paneTarget, "-S", "-200"], {
      encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    return extractStartFailureReason(pane);
  } catch {
    return null;  // session already reaped — caller falls back to a generic reason
  }
}

// #176 — concurrently auto-confirm the dev-channels prompt for the just-spawned
// claude-code-cli nodes (only those carry a `server:` channel and hit the
// prompt), so `node start --all` / `project up|restart` stay zero-interaction.
async function autoConfirmDevChannels(spawned: ProjectNode[]): Promise<void> {
  // What decides whether the prompt appears is the `server:` channel, NOT the
  // runtime. This filter used to also require runtime === "claude-code-cli",
  // which silently excluded every claude-agent-sdk node — and `claude-code`
  // normalizes to claude-agent-sdk, so legacy-named nodes were excluded too.
  // Those nodes then sat on the confirm box forever during `project up` /
  // `node start --all`, with no watcher ever looking at them.
  //
  // The same file already had the correct predicate: the #494 warning on the
  // `--tmux` path keys purely on `server:` channels with no runtime test. Two
  // places deciding the same question, one of them narrower, and the narrow one
  // was the one doing the work.
  //
  // Widening is safe because dismissDevChannelPrompt is detection-gated: it
  // sends Enter only when the prompt's exact text is on screen, so a node that
  // never shows it simply times out without a keystroke being sent.
  const promptedNodes = spawned.filter(n =>
    !!n.profile?.channels?.some(c => typeof c === "string" && c.startsWith("server:")));
  if (promptedNodes.length === 0) return;
  await Promise.all(promptedNodes.map(n => dismissDevChannelPrompt(n.alias, 45000)));
}

async function projectCommand() {
  const sub = args[1];
  switch (sub) {
    case "up": return projectUp();
    case "restart": return projectRestart();
    case "down": return projectDown();
    case "ls": case "list": {
      // F7-08 — users expect `project list` for "what nodes belong to this
      // project" which is exactly `anet node ls`. Alias instead of dump
      // project help.
      return lsCommand();
    }
    default: {
      if (sub) {
        // 🔴 同 daemon:先查重定向再退回相似度。实测 `anet project rm` → 建议 `up`,
        //    而 `up` 会**启动项目里所有节点** —— 想删的人被指去启动。
        const redirect = projectSubcommandRedirect(sub, args[2]);
        if (redirect) {
          for (const line of redirect) console.log(line);
        } else {
          const suggestion = suggestSimilar(sub, ["up", "restart", "down", "ls"]);
          if (suggestion) console.log(`Unknown project subcommand "${sub}". Did you mean: anet project ${suggestion}?`);
        }
      }
      printProjectUsage();
    }
  }
}

async function projectUp(invokedAs = "anet project up") {
  const nodes = selectProjectNodes();
  if (nodes.length === 0) {
    console.log("[anet] No nodes match. Create some with: anet node create <name>");
    return;
  }
  const stagger = parseStaggerMs();
  console.log(`\n[anet] ${invokedAs} — ${nodes.length} node(s) in ${process.cwd()}`);

  // #174 — partition out invalid configs; they are never spawned or counted up.
  const invalid: { alias: string; reason: string }[] = [];
  const startable: ProjectNode[] = [];
  for (const n of nodes) {
    if (n.invalid) {
      console.log(`  ⚠  ${n.alias} — invalid config: ${n.invalid}`);
      invalid.push({ alias: n.alias, reason: n.invalid });
    } else {
      startable.push(n);
    }
  }

  let alreadyUp = 0;
  const failed: { alias: string; reason: string }[] = [];
  const spawned: ProjectNode[] = [];
  for (let i = 0; i < startable.length; i++) {
    const n = startable[i];
    if (tmuxSessionRunning(n.alias)) {
      console.log(`  ⏭  ${n.alias} — already running`);
      alreadyUp++;
      continue;
    }
    try {
      rmSync(join(nodesDir(), n.id, ".pid"), { force: true });  // clear stale pid so verify sees only the fresh process
      startNodeTmuxSession(n.alias, n.alias);
      console.log(`  ▶  ${n.alias} — starting…`);
      spawned.push(n);
    } catch (e: any) {
      const reason = (e?.stderr?.toString().trim() || e?.message || String(e)).slice(0, 200);
      console.log(`  ✗  ${n.alias} — ${reason}`);
      failed.push({ alias: n.alias, reason });
    }
    if (stagger > 0 && i < startable.length - 1) await new Promise(r => setTimeout(r, stagger));
  }

  // #174 — only count a node `up` once its agent pid is verified alive.
  // #176 — concurrently auto-confirm Claude Code's dev-channels prompt for any
  // claude-code-cli nodes so the batch start stays zero-interaction.
  const [started] = await Promise.all([
    verifySpawnedNodes(spawned, failed),
    autoConfirmDevChannels(spawned),
  ]);
  printProjectSummary(nodes.length, alreadyUp + started, failed, invalid);
  exitFromProjectOutcome(failed, invalid);
}

async function projectRestart() {
  const nodes = selectProjectNodes();
  if (nodes.length === 0) {
    console.log("[anet] No nodes match.");
    return;
  }
  const stagger = parseStaggerMs();
  console.log(`\n[anet] anet project restart — ${nodes.length} node(s) in ${process.cwd()}`);

  // #174 — partition out invalid configs; never spawned or counted up.
  const invalid: { alias: string; reason: string }[] = [];
  const startable: ProjectNode[] = [];
  for (const n of nodes) {
    if (n.invalid) {
      console.log(`  ⚠  ${n.alias} — invalid config: ${n.invalid}`);
      invalid.push({ alias: n.alias, reason: n.invalid });
    } else {
      startable.push(n);
    }
  }

  const failed: { alias: string; reason: string }[] = [];
  const spawned: ProjectNode[] = [];
  for (let i = 0; i < startable.length; i++) {
    const n = startable[i];
    const wasRunning = tmuxSessionRunning(n.alias);
    if (wasRunning) killTmuxSession(n.alias);
    const stopResult = await stopNode(n.id);
    if (stopResult.status === "survived") {
      const reason = `pid ${stopResult.pid} survived SIGTERM; restart refused`;
      console.log(`  ✗  ${n.alias} — ${reason}`);
      failed.push({ alias: n.alias, reason });
      continue;
    }
    try {
      startNodeTmuxSession(n.alias, n.alias);
      console.log(`  ${wasRunning ? "↻" : "▶"}  ${n.alias} — starting…`);
      spawned.push(n);
    } catch (e: any) {
      const reason = (e?.stderr?.toString().trim() || e?.message || String(e)).slice(0, 200);
      console.log(`  ✗  ${n.alias} — ${reason}`);
      failed.push({ alias: n.alias, reason });
    }
    if (stagger > 0 && i < startable.length - 1) await new Promise(r => setTimeout(r, stagger));
  }

  // #174 — only count a node `up` once its agent pid is verified alive.
  // #176 — concurrently auto-confirm Claude Code's dev-channels prompt for any
  // claude-code-cli nodes so the batch restart stays zero-interaction.
  const [started] = await Promise.all([
    verifySpawnedNodes(spawned, failed),
    autoConfirmDevChannels(spawned),
  ]);
  printProjectSummary(nodes.length, started, failed, invalid);
  exitFromProjectOutcome(failed, invalid);
}

async function projectDown() {
  const nodes = selectProjectNodes();
  if (nodes.length === 0) {
    console.log("[anet] No nodes match.");
    return;
  }
  console.log(`\n[anet] anet project down — ${nodes.length} node(s) in ${process.cwd()}`);
  let stopped = 0, alreadyDown = 0, failed = 0;
  for (const n of nodes) {
    const tmuxAlive = tmuxSessionRunning(n.alias);
    if (tmuxAlive) killTmuxSession(n.alias);
    const stopResult = await stopNode(n.id);
    if (stopResult.status === "survived") {
      console.log(`  ✗  ${n.alias} — pid ${stopResult.pid} survived SIGTERM; pidfile retained`);
      failed++;
      continue;
    }
    const localKilled = stopResult.status === "stopped";
    if (n.profile) {
      // Hub may be down (the very scenario this command runs in) — cap notify
      // at 2s so a 22-node teardown isn't held hostage by 44 hung fetches.
      await Promise.race([
        notifyServerOffline(n.profile, n.id),
        new Promise<void>(r => setTimeout(r, 2000)),
      ]).catch(() => {});
    }
    if (tmuxAlive || localKilled) {
      console.log(`  ⏹  ${n.alias}`);
      stopped++;
    } else {
      console.log(`  ·  ${n.alias} — not running`);
      alreadyDown++;
    }
  }
  console.log(`\n  ${stopped}/${nodes.length} stopped${alreadyDown ? ` · ${alreadyDown} were not running` : ""}${failed ? ` · ${failed} failed` : ""}\n`);
  if (failed) process.exitCode = 1;
}

// ── loop ── (#144 round-6)
//
// `anet node loop <alias> "<task>" --every 5m`
//
// One-liner UX wrapper for the inbox `/aloop <interval> <task>` slash
// command. POSTs a task to commhub via /api/task; the receiving node's
// inbox handler parses the `/aloop` prefix and calls createScheduledGoal,
// which persists the goal in goals.json + the scheduler tick fires it.
//
// Why a CLI wrapper instead of just "send the slash text directly"?
// Vincent's "使用简单" priority — a non-interactive node operator
// shouldn't need to memorize slash-command syntax or run a separate
// `send_task` call. One line, one verb, one task.

async function nodeLoopCommand() {
  const aliasRef = args[1];
  const taskText = args[2];
  if (!aliasRef || !taskText) {
    console.log(`
anet node loop <alias> "<task>" --every <interval>

  Schedule a recurring task on a running node. The node will be woken at
  the chosen interval and asked to make an incremental advance on the
  task, reporting back each cycle.

Examples:
  anet node loop my-codex "monitor #271 PR" --every 5m
  anet node loop researcher "scan twitter for grok updates" --every 30m
  anet node loop daily-bot "post the morning summary" --every 2h
  anet node loop nightly-bot "rotate logs"  --every 1d

Interval format: 5m / 2h / 1d (m/h/d suffix required, integer ≥ 1).
Sub-minute intervals (e.g. 30s) are not accepted — the scheduler tick
runs at ~30s cadence so a sub-minute goal would not actually fire any
faster and risks wake-storm load on the runtime.

Use 'anet goal list <alias>' to see scheduled loops; 'anet goal cancel'
to stop one.
`);
    process.exit(aliasRef ? 1 : 0);
  }

  // Default 5m if --every omitted (matches Vincent's example cadence
  // and is the most common cron-style "check periodically" interval).
  const everyIdx = args.indexOf("--every");
  const everyRaw = everyIdx >= 0 ? args[everyIdx + 1] : "5m";
  // CLI mirrors agent-node/src/goals/parser.ts: single-letter m/h/d only,
  // integer ≥ 1. Sub-minute is rejected by both layers (MIN_INTERVAL_MS
  // = 60s in the parser); reject here too so the user sees the error
  // before we POST a doomed task. The previous /^\d+[smhd]$/ pattern
  // accepted `30s` at the CLI layer but the parser rejected it server-
  // side → silent fail (CLI printed "Scheduled" but no goal was created).
  if (!everyRaw || !/^[1-9]\d*[mhd]$/.test(everyRaw)) {
    console.error(`Invalid --every value "${everyRaw}". Use formats like 5m, 30m, 2h, 1d (sub-minute not allowed).`);
    process.exit(1);
  }

  const resolved = resolveNodeRef(aliasRef);
  if (!resolved) {
    console.error(`Node "${aliasRef}" not found. Run 'anet node ls' to see registered nodes.`);
    process.exit(1);
  }

  const profile = resolved.profile;
  const displayName = nodeDisplayName(resolved.id, profile);
  const gc = loadGlobal();
  const hub = profile.hub || gc.hub || "http://127.0.0.1:9200";
  const networkId = profile.network_id || gc.network_id || null;

  // The inbox parser at agent-node/src/goals/parser.ts accepts the
  // namespaced `/aloop <interval> <text>` command. We assemble
  // the slash form and POST it as a normal task — the node's inbox
  // handler routes /aloop tasks to createScheduledGoal regardless of
  // runtime (post-#144 the claude-bucket carve-out is gone).
  const slashCmd = `/aloop ${everyRaw} ${taskText}`;
  const body = JSON.stringify({
    alias: displayName,
    task: slashCmd,
    priority: "normal",
    network_id: networkId || undefined,
  });

  let taskId: string;
  try {
    const res = await fetch(`${hub}/api/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body,
    });
    const j: any = await res.json();
    if (!j?.ok) {
      console.error(`Failed to enqueue /aloop task: ${JSON.stringify(j)}`);
      process.exit(1);
    }
    taskId = j.message_id;
  } catch (e: any) {
    console.error(`Failed to reach hub ${hub}: ${e?.message ?? e}`);
    console.error(`Is the hub running? Try: anet hub start`);
    process.exit(1);
  }

  // #144 round-6 hardening — don't claim success until the node has
  // ACTUALLY created the goal. Previously the CLI printed "✅ Scheduled
  // loop" the instant /api/task enqueued the task; if the parser
  // downstream rejected it (e.g. `5m` not matching the old word-only
  // patterns) the failure reply went back to `from:"api"` and was
  // invisible to the user — silent fail. Now we poll for the node's
  // reply and surface what actually happened.
  console.log(`→ Sent /aloop to ${displayName} (task ${taskId.slice(0, 8)}); waiting for node confirmation...`);

  const POLL_DEADLINE_MS = 15_000;
  const POLL_INTERVAL_MS = 1_000;
  const started = Date.now();
  let taskRow: any = null;
  // Poll `/api/tasks?task_id=<id>` for the task row. After the node
  // handles the /aloop slash command it writes the reply text into
  // tasks.result + sets status='replied' (or 'failed'). This is the
  // robust signal — /api/messages doesn't carry in_reply_to in its
  // SELECT (existing comment at cli.ts:7053), so we can't reliably
  // match a reply back to our task there.
  while (Date.now() - started < POLL_DEADLINE_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const r: any = await fetch(`${hub}/api/tasks?task_id=${encodeURIComponent(taskId)}`, { headers: authHeaders() }).then(x => x.json());
      const t = (r?.tasks || [])[0];
      if (t && (t.status === "replied" || t.status === "failed" || t.status === "cancelled") && t.result) {
        taskRow = t;
        break;
      }
    } catch {
      // network blip; keep polling
    }
  }

  if (!taskRow) {
    console.error(`⚠ Node ${displayName} did not confirm goal creation within 15s.`);
    console.error(`  Possible causes: node offline / agent crashed / parser rejected the interval.`);
    console.error(`  Verify with: anet goal list ${displayName}`);
    console.error(`  Or inspect node logs at ~/.anet/nodes/${resolved.id}/logs/`);
    process.exit(1);
  }

  const replyText = String(taskRow.result || "");
  // The node's reply text is set by agent-node/src/cli.ts:createScheduledGoal
  // wrapping success as "已创建 loop 目标 <id>..." or, on failure,
  // "/aloop 创建失败：<reason>".
  if (taskRow.status === "failed" || (/创建失败|failed/i.test(replyText) && !/已创建 loop 目标/.test(replyText))) {
    console.error(`❌ Node rejected the /aloop command:`);
    console.error(`   ${replyText.replace(/^\[[^\]]+\]\s*/, "").trim()}`);
    process.exit(1);
  }

  console.log(`✅ Scheduled loop on ${displayName}`);
  console.log(`   every: ${everyRaw}`);
  console.log(`   task:  ${taskText}`);
  console.log(`   sent as: ${slashCmd}`);
  console.log(`\n${replyText.replace(/^\[[^\]]+\]\s*/, "").trim()}`);
  console.log(`\nUse 'anet goal list ${displayName}' to inspect; 'anet goal cancel ${displayName} <goal-id>' to stop.`);
}

// ── delete ──

async function deleteCommand() {
  const ref = args[1];
  if (!ref) {
    console.log(`
anet node delete <node-id|node-name>

Delete a node and its config. Use --force to skip confirmation.
`);
    return;
  }

  const resolved = resolveNodeRef(ref);
  if (!resolved) {
    console.error(nodeNotFound(ref));
    process.exit(1);
  }

  const { id: nodeId, profile } = resolved;
  const displayName = nodeDisplayName(nodeId, profile);
  const opts = parseOpts();

  // Stop if running + notify server
  const stopResult = await stopNode(nodeId);
  if (stopResult.status === "survived") {
    console.error(`[anet] Refusing to delete "${displayName}": pid ${stopResult.pid} survived SIGTERM.`);
    process.exitCode = 1;
    return;
  }
  await notifyServerOffline(profile, nodeId);

  const nodeDir = join(nodesDir(), nodeId);
  if (!existsSync(nodeDir)) {
    console.error(`Node directory not found: ${nodeDir}`);
    process.exit(1);
  }

  if (opts.force !== "true" && opts.yes !== "true") {
    console.log(`[anet] This will delete "${displayName}" (node_id: ${profile.node_id || "-"})`);
    console.log(`[anet]   ${nodeDir}`);
    console.log(`[anet] Run again with --force to confirm.`);
    return;
  }

  // The runtime identity lives outside the project tree so a config downgrade
  // cannot bypass it. Remove that exact record first for every runtime: this
  // also repairs an older/downgraded profile whose config no longer says
  // opencode-cli. Any unsafe/tampered binding state fails closed and keeps the
  // node directory available for recovery.
  removeOpencodeRuntimeBinding(nodeDir, opencodeBindingHome());
  rmSync(nodeDir, { recursive: true, force: true });
  console.log(`[anet] Deleted "${displayName}"`);
}

// ── channel ──

function printChannelUsage() {
  console.log(`
anet channel <command>

  add <type> <node-id>          Add channel to a node
  allow feishu <node-id>        Manage feishu allowFrom / allowChats (--add-from/--add-chat/--rm-from/--rm-chat; repeatable)
  ls [node-id]                  List channels (shows allowFrom + allowChats for feishu)
  status [node-id]              Show resolved access.json path + allowlist + pending pairings

Data: .anet/nodes/<node-id>/channels/<type>/
`);
}

async function channelCommand() {
  // anet channel add telegram <node-id> --bot-token xxx --allow xxx
  // anet channel ls [node-id]
  const sub = args[1];
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    printChannelUsage();
    return;
  }

  const opts = parseOpts();

  if (sub === "add") {
    const type = args[2];
    const nodeRef = args[3];

    if (!type || !nodeRef) {
      console.log(`
anet channel add <type> <node-id> [options]

Types:  telegram, feishu

Options (telegram):
  --bot-token <token>     Bot token
  --allow <user-id>       Allow user ID

Options (feishu, RFC-020 #179):
  --app-id <id>           Feishu app ID
  --app-secret <secret>   Feishu app secret
  --allow <open-id>       Allow Feishu open_id (DM)
  --allow-chat <chat-id>  Allow Feishu chat_id (group, optional)

Examples:
  anet channel add telegram 指挥室 --bot-token 123:ABC --allow <your-numeric-uid>
  anet channel add feishu                   指挥室 --app-id cli_xxx --app-secret yyy --allow ou_zzz
  anet channel add feishu                   指挥室                # 交互式
`);
      return;
    }
    if (type !== "telegram" && type !== "feishu") {
      console.error(`Unsupported channel type: ${type}. Supported: telegram, feishu`);
      process.exit(1);
    }

    const resolved = resolveNodeRef(nodeRef);
    const nodeId = resolved?.id || nodeRef;
    const profile = resolved?.profile || null;
    if (!profile) {
      console.error(`Node "${nodeRef}" not found. Create it first: anet node create ${nodeRef} --runtime codex-sdk`);
      process.exit(1);
    }
    const storedProfile = loadStoredProfile(nodeId) || profile;

    let channelDir: string;

    if (type === "telegram") {
      let botToken = opts["bot-token"];
      let allowId = opts.allow;
      if (!botToken) botToken = await ask(`${type} Bot Token`);
      if (!allowId) allowId = await ask("Allow User ID (发 @userinfobot 获取数字ID)", "");
      closeRL();

      if (!botToken || !allowId) {
        console.error("Error: bot-token and allow required");
        process.exit(1);
      }

      channelDir = writeTelegramChannelConfig(nodeId, botToken, allowId);
      attachChannel(storedProfile, "telegram");
    } else {
      // type === "feishu" — RFC-020 §3.1 / §5.1 (#179)
      //
      // 🔴 #1259 —— 飞书回合的工具拒绝层(RFC-020 §13 Layer B)**只实现为一个
      //    `PreToolUse` hook**(agent-node/src/cli.ts 里 checkFeishuToolDeny 的
      //    **唯一**调用点)，而 PreToolUse 是 claude-agent-sdk 的机制。
      //    在 codex-sdk / codex-app-server / opencode-cli 节点上，那一层
      //    **一次都不会被调用** —— 三类拒绝(触达密钥路径的工具、抽取密钥的
      //    Bash 模式、飞书回合上的 commhub MCP 调用，最重是向任意 alias
      //    横向 send_task)全部放行，而且**没有任何东西会报错或提示**。
      //
      //    所以在这里拒绝，而不是让它配上去之后看起来一切正常。
      //    形状对齐本文件既有的 runtime 不匹配处理(见 `--copresence requires
      //    runtime=codex-app-server`)——本仓对 runtime 不匹配的立场就是拒绝并说明。
      //
      // 🔴 缺省即 claude-agent-sdk：`agent-node/src/cli.ts` 的
      //    `opts.runtime || process.env.RUNTIME || fileConfig.runtime || "claude-agent-sdk"`。
      //    所以 undefined **必须放行** —— 把"没写"当成"不是 claude"会打死
      //    每一个从来没设过 runtime 的节点。
      const feishuRuntime = (storedProfile as any)?.runtime || (profile as any)?.runtime || "claude-agent-sdk";
      if (feishuRuntime !== "claude-agent-sdk") {
        console.error(`[anet] ❌ feishu 通道目前只支持 runtime=claude-agent-sdk(节点 "${nodeRef}" 是 runtime=${feishuRuntime})。`);
        console.error(`[anet]    原因:飞书回合的工具拒绝层(RFC-020 §13 Layer B)实现为 claude-agent-sdk 的`);
        console.error(`[anet]    PreToolUse hook。在其它 runtime 上它**一次都不会触发** —— 通道能配上、`);
        console.error(`[anet]    看起来正常，但密钥路径工具 / 抽密钥的 Bash / 飞书回合上的 commhub 调用全部放行。`);
        console.error(`[anet]    见 #1259。要在这个节点上用飞书，改用 claude-agent-sdk 运行时。`);
        process.exit(1);
      }

      let appId = opts["app-id"];
      let appSecret = opts["app-secret"];
      let allowOpenId = opts.allow;
      const allowChatId = opts["allow-chat"] || "";

      if (!appId) appId = await ask("Feishu App ID (开放平台「企业自建应用」凭证)");
      if (!appSecret) appSecret = await ask("Feishu App Secret");
      if (!allowOpenId) allowOpenId = await ask("Allow Feishu open_id (DM 白名单，可空)", "");
      closeRL();

      if (!appId || !appSecret) {
        console.error("Error: --app-id and --app-secret required");
        process.exit(1);
      }
      const allowOpenIds = parseFeishuAllowlist(allowOpenId);
      const allowChatIds = parseFeishuAllowlist(allowChatId);
      if (allowOpenIds.length === 0 && allowChatIds.length === 0) {
        console.error("Error: at least one of --allow <open-id> or --allow-chat <chat-id> required");
        process.exit(1);
      }

      channelDir = writeFeishuChannelConfig(nodeId, appId, appSecret, allowOpenIds, allowChatIds);
      attachChannel(storedProfile, "feishu");
    }

    await ensureNodeToken(storedProfile, nodeId);
    saveProfile(nodeId, storedProfile);

    console.log(`\n✅ ${type} channel added to "${nodeDisplayName(nodeId, profile)}"`);
    console.log(`   ${channelDir}/`);
    console.log(`   config.json updated`);

    // #245 — if the node is already running, the channel MCP server was spawned
    // at session start (before this channel existed) and will NOT pick up the
    // new token until the session restarts. `anet resume` does not reconnect a
    // channel that was absent/failed at first launch. Without this warning,
    // `add` looks like a silent success but messages never arrive (real
    // hour-long "added but receives nothing" detour, 2026-06-16).
    const addPid = readNodePid(nodeId);
    if (addPid != null && pidAlive(addPid)) {
      console.log(`\n⚠ 节点 "${nodeDisplayName(nodeId, profile)}" 正在运行 (pid ${addPid})。`);
      console.log(`  新加的 ${type} 通道**不会立即生效** —— 通道的 MCP server 在会话启动时就拉起了，`);
      console.log(`  现在才加 token，且 anet resume 不会重连首次缺失/失败的通道。`);
      console.log(`  → 生效方式：anet node stop ${nodeId} && anet node start ${nodeId}`);
    }

  } else if (sub === "ls") {
    const nodeRef = args[2];
    const resolved = nodeRef ? resolveNodeRef(nodeRef) : null;
    if (nodeRef && !resolved) {
      console.error(nodeNotFound(nodeRef));
      process.exit(1);
    }
    const ids = resolved ? [resolved.id] : listProfileIds();
    let found = false;

    for (const id of ids) {
      const channelsDir = join(nodesDir(), id, "channels");
      if (!existsSync(channelsDir)) continue;
      const types = readdirSync(channelsDir).filter(d => {
        try { return statSync(join(channelsDir, d)).isDirectory(); } catch { return false; }
      });
      if (types.length === 0) continue;
      if (!found) { console.log("\nNode Channels:\n"); found = true; }
      for (const t of types) {
        const accessPath = join(channelsDir, t, "access.json");
        let allowFrom: string[] = [];
        let allowChats: string[] = [];
        if (existsSync(accessPath)) {
          try {
            const a = JSON.parse(readFileSync(accessPath, "utf-8"));
            if (Array.isArray(a.allowFrom)) allowFrom = a.allowFrom.map(String);
            if (Array.isArray(a.allowChats)) allowChats = a.allowChats.map(String);
          } catch {}
        }
        const profile = loadProfile(id);
        const label = profile ? `${id} (${nodeDisplayName(id, profile)})` : id;
        const fromStr = allowFrom.length ? allowFrom.join(", ") : "(none)";
        // Show allowChats inline when populated; suppress when empty so
        // existing telegram nodes (which don't use it) stay clean.
        const chatsStr =
          allowChats.length > 0 ? `  chats: ${allowChats.join(", ")}` : "";
        console.log(
          `  ${padDisplayEnd(label, 20)} ${t.padEnd(12)} from: ${fromStr}${chatsStr}`,
        );
      }
    }
    if (!found) console.log("No channels. Add one: anet channel add telegram <node-id>");
    console.log();

  } else if (sub === "allow") {
    // #179 — manage feishu (and other channel-type) allowFrom / allowChats
    // lists without hand-editing access.json. Mirrors the schema that
    // writeFeishuChannelConfig produces; telegram-style access (groups/dmPolicy)
    // is not affected by this subcommand.
    //
    // Examples:
    //   anet channel allow feishu 指挥室 --add-from ou_xxx
    //   anet channel allow feishu 指挥室 --add-chat oc_yyy
    //   anet channel allow feishu 指挥室 --rm-from  ou_xxx --rm-chat oc_yyy
    const type = args[2];
    const nodeRef = args[3];
    if (!type || !nodeRef) {
      console.log(`
anet channel allow feishu <node-id> [--add-from <id>] [--add-chat <id>] [--rm-from <id>] [--rm-chat <id>]

Manage allowlists in .anet/nodes/<node>/channels/feishu/access.json.
Each --add-* / --rm-* flag is repeatable to handle multiple ids in one
command. Telegram channels use a different schema; use
\`anet channel add telegram\` --allow there.

Examples:
  anet channel allow feishu 指挥室 --add-from ou_xxx
  anet channel allow feishu 指挥室 --add-chat oc_yyy
  anet channel allow feishu 指挥室 --rm-from ou_xxx --rm-chat oc_yyy

Note: changes take effect on next \`anet node start\` (no hot-reload yet).
`);
      return;
    }
    // 通信牛 review 建议#2 — keep `allow` feishu-only for now. Telegram has its
    // own access management (dmPolicy / groups / pending) under `channel add
    // telegram --allow`; reusing this subcommand on telegram would scribble
    // `allowChats` into telegram's access.json which it doesn't read.
    if (type !== "feishu") {
      console.error(`channel allow currently supports feishu only. Telegram uses 'anet channel add telegram --allow' instead.`);
      process.exit(1);
    }
    const resolved = resolveNodeRef(nodeRef);
    if (!resolved) {
      console.error(nodeNotFound(nodeRef));
      process.exit(1);
    }
    const accessPath = join(nodesDir(), resolved.id, "channels", type, "access.json");
    if (!existsSync(accessPath)) {
      console.error(`No ${type} channel on "${nodeRef}". Add it first: anet channel add ${type} ${nodeRef} ...`);
      process.exit(1);
    }

    type AccessFile = { allowFrom?: string[]; allowChats?: string[] } & Record<string, unknown>;
    let parsed: AccessFile;
    try {
      parsed = JSON.parse(readFileSync(accessPath, "utf-8")) as AccessFile;
    } catch (e: any) {
      console.error(`Failed to read ${accessPath}: ${e?.message || e}`);
      process.exit(1);
    }
    const allowFrom = new Set<string>(Array.isArray(parsed.allowFrom) ? parsed.allowFrom : []);
    const allowChats = new Set<string>(Array.isArray(parsed.allowChats) ? parsed.allowChats : []);

    // Apply ops. Multi-occurrence flags supported via parseOpts() collecting strings.
    const applyOp = (set: Set<string>, value: string | string[] | undefined, op: "add" | "rm") => {
      if (!value) return 0;
      const vals = Array.isArray(value) ? value : [value];
      let n = 0;
      for (const v of vals) {
        const t = v.trim();
        if (!t) continue;
        if (op === "add" && !set.has(t)) { set.add(t); n++; }
        if (op === "rm" && set.has(t))  { set.delete(t); n++; }
      }
      return n;
    };

    // 通信牛 review 建议#1 — parseOpts is single-value (last-write-wins) for
    // ad-hoc flags. To make --add-from / --rm-* etc. genuinely repeatable as
    // the help text claims, collect multi-occurrences locally from argv.
    const collectFlag = (flag: string): string[] => {
      const out: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === flag && args[i + 1] && !args[i + 1].startsWith("--")) {
          out.push(args[++i]);
        }
      }
      return out;
    };
    const nAddFrom = applyOp(allowFrom, collectFlag("--add-from"), "add");
    const nAddChat = applyOp(allowChats, collectFlag("--add-chat"), "add");
    const nRmFrom  = applyOp(allowFrom, collectFlag("--rm-from"),  "rm");
    const nRmChat  = applyOp(allowChats, collectFlag("--rm-chat"), "rm");

    if (nAddFrom + nAddChat + nRmFrom + nRmChat === 0) {
      console.log("Nothing to do (no add/rm operands matched).");
      console.log(`Current state: allowFrom=[${[...allowFrom].join(", ")}] allowChats=[${[...allowChats].join(", ")}]`);
      return;
    }

    // Preserve any extra fields the schema may have grown (e.g. telegram's
    // dmPolicy / groups / pending) by spreading the original parsed object.
    const next = { ...parsed, allowFrom: [...allowFrom], allowChats: [...allowChats] };
    writeAccessJsonAtomic(accessPath, next);
    console.log(`✅ ${type} access updated for "${nodeDisplayName(resolved.id, resolved.profile)}"`);
    if (nAddFrom) console.log(`   +from: ${nAddFrom}`);
    if (nAddChat) console.log(`   +chat: ${nAddChat}`);
    if (nRmFrom)  console.log(`   -from: ${nRmFrom}`);
    if (nRmChat)  console.log(`   -chat: ${nRmChat}`);
    console.log(`   allowFrom: [${[...allowFrom].join(", ")}]`);
    console.log(`   allowChats: [${[...allowChats].join(", ")}]`);

    // #245 / hot-reload caveat — bridge captures access at init, no watcher yet.
    const allowPid = readNodePid(resolved.id);
    if (allowPid != null && pidAlive(allowPid)) {
      console.log(`\n⚠ 节点 "${nodeDisplayName(resolved.id, resolved.profile)}" 正在运行 (pid ${allowPid})。`);
      console.log(`  当前 ${type} bridge 启动时一次性读 access.json，**不会热加载**。`);
      console.log(`  → 生效方式：anet node stop ${resolved.id} && anet node start ${resolved.id}`);
    }

  } else if (sub === "status") {
    // #245 — show the RESOLVED telegram access.json path + allowlist + pending
    // pairings. The running node reads exactly this file (TELEGRAM_STATE_DIR →
    // .anet/nodes/<id>/channels/telegram/); editing any other access.json is a
    // no-op. Not surfacing the resolved path + pending caused a real hour-long
    // "not allowlisted / pairing not found" debugging detour (2026-06-16).
    const nodeRef = args[2];
    const resolved = nodeRef ? resolveNodeRef(nodeRef) : null;
    if (nodeRef && !resolved) {
      console.error(nodeNotFound(nodeRef));
      process.exit(1);
    }
    const ids = resolved ? [resolved.id] : listProfileIds();
    let any = false;
    for (const id of ids) {
      const tgDir = join(nodesDir(), id, "channels", "telegram");
      const accessPath = join(tgDir, "access.json");
      if (!existsSync(accessPath)) continue;
      any = true;
      const profile = loadProfile(id);
      const label = profile ? `${id} (${nodeDisplayName(id, profile)})` : id;
      console.log(`\n● ${label} — telegram`);
      console.log(`  TELEGRAM_STATE_DIR : ${tgDir}`);
      console.log(`  access.json        : ${accessPath}`);
      let access: any = {};
      try { access = JSON.parse(readFileSync(accessPath, "utf-8")); }
      catch (e: any) { console.log(`  ⚠ access.json 读不了: ${e?.message || e}`); continue; }
      const allow = Array.isArray(access.allowFrom) ? access.allowFrom : [];
      const pending = access.pending && typeof access.pending === "object" ? Object.keys(access.pending) : [];
      const groups = access.groups && typeof access.groups === "object" ? Object.keys(access.groups) : [];
      console.log(`  dmPolicy           : ${access.dmPolicy || "(unset)"}`);
      console.log(`  allowFrom          : ${allow.length ? allow.join(", ") : "(none — 还没人能私聊这个节点)"}`);
      console.log(`  pending pairings   : ${pending.length ? pending.join(", ") : "(none)"}`);
      console.log(`  groups             : ${groups.length ? groups.join(", ") : "(none)"}`);
    }
    if (!any) {
      console.log(nodeRef
        ? `No telegram channel for "${nodeRef}". Add one: anet channel add telegram ${nodeRef}`
        : `No telegram channels configured. Add one: anet channel add telegram <node-id>`);
    } else {
      console.log(`\n提示：节点运行时读的就是上面这个 access.json，改对它再重启节点即可；改别处无效。\n`);
    }

  } else {
    printChannelUsage();
  }
}

// ── upgrade (#88) — multi-package + dual-channel + Node-check + dry-run ─

type ReleaseChannel = "preview" | "latest";

interface UpgradePlanRow {
  pkg: string;          // npm package name
  display: string;      // short human label
  current: string | null;
  target: string | null;
  action: "upgrade" | "up-to-date" | "lazy-skip" | "self-skip" | "lookup-failed";
  note?: string;
}

// preview if version carries a prerelease tag, otherwise latest. The same
// channel applies to every package — we don't want one package on latest and
// another on preview, that's how desyncs creep in.
function detectChannel(version: string): ReleaseChannel {
  return /-(preview|rc|alpha|beta|next)/i.test(version) ? "preview" : "latest";
}

// `npm view <pkg>@<channel> version` resolves a dist-tag to its current
// pinned version. 8s timeout — npm registry hiccups shouldn't hang upgrade.
// Returns null on any failure; callers degrade gracefully.
function fetchLatestVersion(pkg: string, channel: ReleaseChannel): string | null {
  try {
    const out = runLauncherSync("npm", ["view", `${pkg}@${channel}`, "version"], {
      encoding: "utf-8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

interface NodeCheck { ok: boolean; current: string; required: string; }
// Read the *full* installed version (including prerelease tag) of a globally-
// installed npm package. detectInstalledPackages strips the prerelease via
// parseSemver, which would make every preview install look "out of date"
// against the preview dist-tag in upgrade plans. Returns null if not installed.
function readGlobalPackageVersion(pkgName: string): string | null {
  try {
    const out = runLauncherSync("npm", ["ls", "-g", pkgName, "--depth=0", "--json"], {
      encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000,
    });
    const data = JSON.parse(out);
    return data?.dependencies?.[pkgName]?.version || null;
  } catch { return null; }
}

function checkNodeVersion(): NodeCheck {
  const required = "22.13.0";
  const current = process.versions.node;
  const [maj, min, patch] = current.split(".").map(n => parseInt(n) || 0);
  const [rMaj, rMin, rPatch] = required.split(".").map(n => parseInt(n) || 0);
  const ok = maj > rMaj
    || (maj === rMaj && min > rMin)
    || (maj === rMaj && min === rMin && patch >= rPatch);
  return { ok, current, required };
}

function printManualAnetUpgrade(channel: ReleaseChannel = "latest") {
  console.log("    Run manually after this command exits:");
  console.log(`      npm install -g @sleep2agi/agent-network@${channel}`);
  console.log("    Or run in a fresh shell:");
  console.log(`      sh -c 'npm install -g @sleep2agi/agent-network@${channel} && anet -v'`);
}

// Detach a self-upgrade child so the current `anet upgrade` process can exit
// cleanly before npm replaces its binary. stderr → /tmp/anet-self-upgrade.err
// gives users a recovery breadcrumb if the spawn fails silently after we exit.
function selfUpgradeDetached(channel: ReleaseChannel): never {
  const errLog = "/tmp/anet-self-upgrade.err";
  const cmd = `npm install -g @sleep2agi/agent-network@${channel} 2>${shellQuote(errLog)} && anet -v`;
  console.log(`\n[anet] ⚙️  auto self-upgrade: detaching npm install (this shell will exit).`);
  console.log(`[anet]   Log: ${errLog}`);
  console.log(`[anet]   When npm finishes, open a NEW terminal (or 'source ~/.bashrc') and run \`anet --version\` to verify ${channel}.`);
  console.log(`[anet]   The current shell's \`anet\` binary will keep pointing at the old version until you do.`);
  // 同源判据:hub start 的守卫是 `if (!commandExists("bunx"))` —— 只认 bunx
  // (#766 从 OR 收紧)。这里原本写的是 OR,是那次收紧漏掉的第三份副本:
  // bun-only 的机器不会收到提示,然后在 hub start 处撞上去。
  if (!bunxAvailable()) {
    // #214 P2.7 — anet hub start needs bun (commhub-server is bun-only).
    // Surface this now so users don't hit it on next `anet hub start`.
    console.log(`[anet]   note: bunx is not on PATH; \`anet hub start\` will fail without it.`);
    console.log(commandExists("bun")
      ? `[anet]         bun is here but bunx is not: ln -s "$(command -v bun)" "$(dirname "$(command -v bun)")/bunx"`
      : `[anet]         Install: npm i -g bun  (或 https://bun.sh/docs/installation)`);
  }
  console.log(`[anet]   (Use \`anet upgrade --no-auto-self\` next time if you prefer to manage the install yourself.)`);
  try {
    const child = spawn("sh", ["-c", cmd], { stdio: "ignore", detached: true });
    child.unref();
  } catch (e: any) {
    console.log(`[anet] ❌ Failed to detach self-upgrade: ${e.message}`);
    printManualAnetUpgrade(channel);
    process.exit(1);
  }
  process.exit(0);
}

function printUpgradePlan(plan: UpgradePlanRow[]) {
  console.log("\n  Plan:");
  for (const p of plan) {
    const cur = p.current || "not installed";
    const tgt = p.target || "(lookup failed)";
    let badge = "";
    switch (p.action) {
      case "upgrade":       badge = "→ upgrade"; break;
      case "up-to-date":    badge = "✓ up to date"; break;
      case "lazy-skip":     badge = "(lazy via npx, skipped)"; break;
      case "self-skip":     badge = "(self — see below)"; break;
      case "lookup-failed": badge = "⚠ npm registry lookup failed"; break;
    }
    console.log(`    ${padDisplayEnd(p.display, 18)}  ${cur.padEnd(20)}  →  ${tgt.padEnd(20)}  ${badge}`);
    if (p.note) console.log(`      ${p.note}`);
  }
}

// RFC-029 — OpenCode lifecycle and pin-management commands.
async function opencodeCommand() {
  const sub = args[1];
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(`anet opencode <sub>

Subcommands:
  upgrade-pin <version>   Reinstall and smoke the exact release pin.
                          Different versions remain rejected until a new
                          maintainer-vetted agent-network preview bumps it.
  auth-login <node> --provider <anthropic|openai>
                          Run upstream login inside a fresh private HOME/XDG
                          tree, import only the selected API-key credential,
                          then delete the temporary DB/log/auth state.

Examples:
  anet opencode upgrade-pin ${OPENCODE_BUILTIN_PIN}
  anet opencode auth-login my-node --provider anthropic
  anet opencode auth-login my-node --provider openai
`);
    return;
  }
  if (sub === "upgrade-pin") {
    await opencodeUpgradePinCommand(args[2]);
    return;
  }
  if (sub === "auth-login") {
    await opencodeAuthLoginCommand(args[2]);
    return;
  }
  console.error(`[anet] unknown opencode subcommand: ${sub}`);
  console.error(`[anet] try: anet opencode --help`);
  process.exit(1);
}

type InteractiveLoginResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  requestedSignal: NodeJS.Signals | null;
  spawnError?: Error;
};

async function runInteractiveOpencodeLogin(
  binary: string,
  loginArgs: string[],
  cwd: string,
  env: Readonly<NodeJS.ProcessEnv>,
): Promise<InteractiveLoginResult> {
  const child = spawn(binary, loginArgs, { cwd, env: { ...env }, stdio: "inherit" });
  let requestedSignal: NodeJS.Signals | null = null;
  let spawnError: Error | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();

  const requestStop = (signal: NodeJS.Signals) => {
    if (requestedSignal === null) requestedSignal = signal;
    try { child.kill(signal); } catch {}
    if (!forceTimer) {
      forceTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, 2_000);
      forceTimer.unref?.();
    }
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as NodeJS.Signals[]) {
    const handler = () => requestStop(signal);
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    return await new Promise<InteractiveLoginResult>((resolve) => {
      let settled = false;
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        resolve({ code, signal, requestedSignal, ...(spawnError ? { spawnError } : {}) });
      };
      child.once("error", (error) => {
        spawnError = error;
        if (!child.pid) finish(null, null);
        else requestStop("SIGKILL");
      });
      child.once("exit", finish);
    });
  } finally {
    if (forceTimer) clearTimeout(forceTimer);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  }
}

async function opencodeAuthLoginCommand(rawNode: string | undefined): Promise<void> {
  const usage = "anet opencode auth-login <node> --provider <anthropic|openai>";
  if (!rawNode) {
    console.error(`[anet] usage: ${usage}`);
    process.exit(1);
  }
  const commandOpts = parseOpts();
  const provider = commandOpts.provider;
  const preset = findOpencodePreset(provider);
  if (!provider || provider === "true" || !preset) {
    console.error(`[anet] auth-login requires --provider anthropic or --provider openai`);
    console.error(`[anet] usage: ${usage}`);
    process.exit(1);
  }

  const resolved = resolveNodeRef(rawNode);
  // Auth import is a credential write: accept only a direct child from this
  // project's enumerated node store, never an alias that resolves outside it.
  const localProfileIds = new Set(listProfileIds());
  if (!resolved || !localProfileIds.has(resolved.id)) {
    console.error(`[anet] node not found: ${rawNode}`);
    process.exit(1);
  }
  if (normalizeRuntime(resolved.profile) !== "opencode-cli") {
    console.error(`[anet] node '${resolved.id}' is not an opencode-cli node`);
    process.exit(1);
  }

  const pin = checkOpencodePin();
  if (!pin.ok) {
    console.error(`[anet] incompatible opencode-ai for auth-login.`);
    console.error(`[anet] ${pin.hint}`);
    process.exit(1);
  }

  const nodeWorkDir = join(nodesDir(), resolved.id);
  console.log(
    `[anet] OpenCode ${preset.id} API-key login for '${resolved.id}' ` +
    `(exact opencode-ai@${pin.version}, fresh private state).`,
  );
  console.log(`[anet] Persistent auth changes only after upstream exits 0 and the credential shape validates.`);

  let credential: Awaited<ReturnType<typeof readOpencodeAuthLoginCredential>> | null = null;
  try {
    credential = await withOpencodeAuthLoginSandbox({
      nodeWorkDir,
      provider: preset.id,
      parentEnv: process.env,
    }, async (sandbox) => {
      revalidateOpencodeAuthLoginSandbox(sandbox);
      const vettedBinary = validateOpencodePackageBinary(pin.binary, {
        expectedVersion: pin.version,
        forbiddenRoots: [...discoverOpencodeForbiddenRoots(), nodeWorkDir],
      });
      const result = await runInteractiveOpencodeLogin(
        vettedBinary,
        buildOpencodeAuthLoginArgs(preset.id),
        sandbox.cwd,
        sandbox.env,
      );
      if (result.requestedSignal) {
        throw new Error(`interactive login interrupted by ${result.requestedSignal}`);
      }
      if (result.spawnError) {
        throw new Error(`could not start the vetted OpenCode binary: ${result.spawnError.message}`);
      }
      if (result.code !== 0) {
        throw new Error(
          `upstream login exited without success ` +
          `(code=${result.code ?? "null"} signal=${result.signal ?? "none"})`,
        );
      }
      return readOpencodeAuthLoginCredential(sandbox);
    });
  } catch (error: any) {
    const detail = String(error?.message ?? error).replace(/[\r\n]+/g, " ").slice(0, 500);
    console.error(`[anet] ✗ OpenCode auth-login failed; persistent auth unchanged: ${detail}`);
    process.exit(1);
  }
  if (!credential) {
    console.error(`[anet] ✗ OpenCode auth-login failed; persistent auth unchanged: no validated API credential`);
    process.exit(1);
  }

  try {
    const authPath = writeOpencodeAuthJson(nodeWorkDir, preset, credential.key);
    console.log(`[anet] ✓ imported ${preset.id} API credential into ${authPath} (mode 0600).`);
    console.log(`[anet] Restart '${resolved.id}' to use the new credential.`);
  } catch (error: any) {
    const detail = String(error?.message ?? error).replace(/[\r\n]+/g, " ").slice(0, 500);
    console.error(`[anet] ✗ validated login, but persistent atomic write failed: ${detail}`);
    process.exit(1);
  }
}

async function opencodeUpgradePinCommand(rawVersion: string | undefined) {
  if (!rawVersion || !/^\d+\.\d+\.\d+/.test(rawVersion)) {
    console.error(`[anet] opencode upgrade-pin requires a semver version (e.g. 1.18.0)`);
    console.error(`[anet] usage: anet opencode upgrade-pin <version>`);
    process.exit(1);
  }
  const version = rawVersion.match(/^\d+\.\d+\.\d+/)![0];

  if (version !== OPENCODE_BUILTIN_PIN) {
    console.error(
      `[anet] Refusing opencode-ai@${version}: this preview is vetted only for ` +
      `opencode-ai@${OPENCODE_BUILTIN_PIN}.`,
    );
    console.error(
      `[anet] Install/smoke the exact release pin with: ` +
      `anet opencode upgrade-pin ${OPENCODE_BUILTIN_PIN}`,
    );
    console.error(`[anet] A different upstream version requires a newly vetted preview.`);
    process.exit(1);
  }

  console.log(`[anet] opencode upgrade-pin: target version = ${version}`);
  console.log(`[anet]   1/3 installing opencode-ai@${version} globally...`);
  try {
    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", [
      "install", "-g", `opencode-ai@${version}`,
    ], {
      stdio: "inherit",
      timeout: 5 * 60_000,
      shell: process.platform === "win32",
    });
  } catch (e: any) {
    console.error(`[anet] ✗ npm install failed. Refusing to update the pin.`);
    process.exit(1);
  }

  // Confirm the installed version matches what we asked for. Guards
  // against `latest`-tag drift + npm skew.
  let installedRaw = "";
  let installedBinary = "";
  let versionProbe: ReturnType<typeof createOpencodeProbeContext> | undefined;
  let versionProbeFailure: string | undefined;
  const forbiddenRoots = discoverOpencodeForbiddenRoots();
  try {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const globalRootRaw = execFileSync(npmCommand, ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
      shell: process.platform === "win32",
    });
    const globalRootLines = globalRootRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (globalRootLines.length !== 1 || !isAbsolute(globalRootLines[0])) {
      throw new Error("npm root -g did not return one absolute package root");
    }
    installedBinary = validateOpencodePackageBinary(
      join(globalRootLines[0], "opencode-ai", "bin", "opencode.exe"),
      { expectedVersion: version, forbiddenRoots },
    );
    versionProbe = createOpencodeProbeContext(".anet-opencode-upgrade-version-");
    revalidateOpencodeSafeExternalRoot(versionProbe.root);
    installedRaw = execFileSync(installedBinary, ["--version"], {
      encoding: "utf-8",
      timeout: 5_000,
      cwd: versionProbe.root.cwd,
      env: versionProbe.env,
    }).trim();
    validateOpencodePackageBinary(installedBinary, {
      expectedVersion: version,
      forbiddenRoots,
    });
  } catch (e: any) {
    versionProbeFailure = String(e?.message || e);
  } finally {
    if (versionProbe) {
      try {
        cleanupOpencodeSafeExternalRoot(versionProbe.root);
      } catch (cleanupError: any) {
        versionProbeFailure =
          `upgrade version-probe external-root cleanup failed: ${cleanupError?.message || cleanupError}`;
      }
    }
  }
  if (versionProbeFailure) {
    console.error(`[anet] ✗ opencode package identity/version check failed after install: ${versionProbeFailure}`);
    console.error(`[anet]   pin NOT updated.`);
    process.exit(1);
  }
  const installedVersion = installedRaw.match(/(\d+\.\d+\.\d+)/)?.[1];
  if (installedVersion !== version) {
    console.error(`[anet] ✗ installed version mismatch — asked for ${version}, got ${installedVersion ?? installedRaw}.`);
    console.error(`[anet]   pin NOT updated.`);
    process.exit(1);
  }

  // Smoke: spawn `opencode acp`, send initialize + session/new, and
  // wait for both responses. Per 通信龙 PR③ refinement 1: pin write is
  // gated on this — an install without a working ACP surface is not
  // usable.
  console.log(`[anet]   2/3 smoke: spawning opencode acp + probing initialize/session/new...`);
  const smokeResult = await smokeOpencodeAcp(installedBinary, version);
  if (!smokeResult.ok) {
    console.error(`[anet] ✗ opencode-ai@${version} smoke failed: ${smokeResult.reason}`);
    console.error(`[anet]   pin NOT updated. The runtime will still reject this version at start.`);
    process.exit(1);
  }
  const smokePassedAt = smokeResult.smokePassedAt;
  console.log(`[anet]   ✓ smoke passed at ${smokePassedAt}`);
  console.log(`[anet]   3/3 writing pin override to ~/.anet/opencode-pin.json...`);
  writePinOverride(version, smokePassedAt, "smoke: initialize + session/new via `opencode acp`");
  console.log(`[anet] ✓ verified release pin opencode-ai@${version}; opencode-cli nodes will accept it.`);
}

// Deterministic ACP smoke — no vendor key, no vendor call, just
// verifies the freshly-installed binary can be spawned, honors the
// JSON-RPC protocol, and returns a sessionId. If ANY step fails we
// treat the whole probe as failed and refuse to write the pin.
async function smokeOpencodeAcp(
  binary: string,
  expectedVersion: string,
): Promise<{ ok: true; smokePassedAt: string } | { ok: false; reason: string }> {
  const { spawn } = await import("child_process");
  let smoke: ReturnType<typeof createOpencodeProbeContext>;
  try {
    smoke = createOpencodeProbeContext(".anet-opencode-smoke-");
  } catch (error: any) {
    return { ok: false, reason: `could not create external smoke root: ${error?.message || error}` };
  }
  const smokeRoot = smoke.root.root;
  const smokeCwd = smoke.root.cwd;
  const smokeEnv = smoke.env;

  let result: { ok: true; smokePassedAt: string } | { ok: false; reason: string };
  try {
    revalidateOpencodeSafeExternalRoot(smoke.root);
    const vettedBinary = validateOpencodePackageBinary(binary, {
      expectedVersion,
      forbiddenRoots: discoverOpencodeForbiddenRoots(),
    });
    result = await new Promise<{ ok: true; smokePassedAt: string } | { ok: false; reason: string }>((resolve) => {
      type SmokeOutcome = { ok: true; smokePassedAt: string } | { ok: false; reason: string };
      let outcome: SmokeOutcome | null = null;
      let resolved = false;
      let seenInitialize = false;
      let seenSessionNew = false;
      const proc = spawn(vettedBinary, ["acp"], {
        cwd: smokeCwd,
        env: smokeEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
      let timer: ReturnType<typeof setTimeout>;

      const resolveOnce = (result: SmokeOutcome) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        resolve(result);
      };
      const exitFailure = (code: number | null, signal: NodeJS.Signals | null): SmokeOutcome => ({
        ok: false,
        reason: seenSessionNew
          ? `opencode acp exited after session/new without a recorded outcome (code=${code} signal=${signal})`
          : seenInitialize
            ? `session/new never responded (code=${code} signal=${signal})`
            : `initialize never responded (code=${code} signal=${signal})`,
      });
      const terminateThenResolve = (result: SmokeOutcome) => {
        if (outcome) return;
        outcome = result;
        clearTimeout(timer);

        // Never resolve while the smoke child can still be alive. TERM gets a
        // one-second grace period, then KILL; the exit/close handler below is
        // the only normal path that resolves the Promise.
        if (proc.exitCode !== null || proc.signalCode !== null) {
          resolveOnce(result);
          return;
        }
        try { proc.kill("SIGTERM"); } catch { /* exit/close will settle */ }
        forceKillTimer = setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch { /* exit/close will settle */ }
        }, 1_000);
      };
      let buf = "";
      timer = setTimeout(() => {
        terminateThenResolve({ ok: false, reason: "smoke timed out after 15s" });
      }, 15_000);

      proc.on("error", (e) => {
        const failure: SmokeOutcome = { ok: false, reason: `spawn error: ${e.message}` };
        // A spawn failure has no child to reap. Later ChildProcess errors with
        // a pid still follow the bounded TERM/KILL path.
        if (!proc.pid) resolveOnce(failure);
        else terminateThenResolve(failure);
      });
      proc.on("exit", (code, signal) => {
        resolveOnce(outcome ?? exitFailure(code, signal));
      });
      // Avoid an unhandled EPIPE if the binary exits between protocol steps.
      proc.stdin.on("error", () => {});

      // Feed initialize + session/new; expect responses for both.
      proc.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf-8");
        while (buf.includes("\n")) {
          const idx = buf.indexOf("\n");
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let msg: any;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.id === 1 && msg.result) {
            seenInitialize = true;
            // Probe session/new only inside the disposable smoke root. This
            // prevents project opencode.json/AGENTS.md/plugin discovery.
            proc.stdin.write(JSON.stringify({
              jsonrpc: "2.0", id: 2, method: "session/new",
              params: { cwd: smokeCwd, mcpServers: [] },
            }) + "\n");
          } else if (msg.id === 2 && msg.result && typeof msg.result.sessionId === "string") {
            seenSessionNew = true;
            terminateThenResolve({ ok: true, smokePassedAt: new Date().toISOString() });
          } else if (msg.error) {
            terminateThenResolve({ ok: false, reason: `smoke rpc error id=${msg.id}: ${msg.error.message}` });
          }
        }
      });

      // Kick off initialize
      proc.stdin.write(JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        },
      }) + "\n");

      // `exit` is expected for every successfully-spawned child. `close` is a
      // defensive fallback for unusual ChildProcess implementations/tests.
      proc.on("close", (code, signal) => {
        resolveOnce(outcome ?? exitFailure(code, signal));
      });
    });
  } catch (error: any) {
    result = { ok: false, reason: `smoke setup/protocol failure: ${error?.message || error}` };
  }
  try {
    cleanupOpencodeSafeExternalRoot(smoke.root);
  } catch (cleanupError: any) {
    return {
      ok: false,
      reason: `smoke external-root cleanup failed: ${cleanupError?.message || cleanupError}`,
    };
  }
  return result;
}

async function upgradeCommand() {
  const opts = parseOpts();
  // #154 (Vincent 5489+5490) — `--self` was opt-in via #151's Option A which
  // only printed verbiage. After Vincent hit the upgrade chicken-and-egg
  // deadlock twice (old CLI doesn't know about the new verbiage), Option B is
  // now the default: detached npm spawn runs automatically. `--no-auto-self`
  // opts out for CI / scriptable use cases that prefer to manage the upgrade
  // process themselves.
  const isAutoSelfOptedOut = opts["no-auto-self"] === "true";
  const isSelf = opts.self === "true" || !isAutoSelfOptedOut;
  const isDryRun = opts["dry-run"] === "true";
  const forkScript = opts["fork-script"];

  // ── 1. Resolve channel ──
  // NOTE: parseOpts special-cases `--channel <value>` into opts._channels
  // (for `anet node create --channel <plugin>` semantics). In the upgrade
  // context the same flag means release channel, so we read _channels[0].
  // This is unambiguous because `anet upgrade` doesn't use channel plugins.
  const anetVersion = getAnetVersion();
  const detected = detectChannel(anetVersion || "");
  const channelFlag = opts._channels[0];
  // F7-09 — bare `--channel` (no value) used to silently fall through to
  // detected channel, leaving the user thinking they switched when they
  // didn't. parseOpts records the bare form as opts.channel = "true";
  // catch and reject explicitly, mirroring the wrong-value branch below.
  if (!channelFlag && opts.channel === "true") {
    console.error(`[anet] ❌ --channel requires a value (preview|latest)`);
    process.exit(1);
  }
  let channel: ReleaseChannel;
  if (channelFlag === "preview" || channelFlag === "latest") {
    channel = channelFlag;
  } else if (channelFlag) {
    console.error(`[anet] ❌ --channel must be "preview" or "latest" (got "${channelFlag}")`);
    process.exit(1);
  } else {
    channel = detected;
  }

  // ── 2. Node version sanity ──
  const node = checkNodeVersion();

  // ── 3. Header ──
  console.log("\n[anet] anet upgrade");
  const channelSrc = channelFlag ? "--channel override" : `detected from anet v${anetVersion}`;
  console.log(`  Channel: ${channel} (${channelSrc})`);
  if (node.ok) {
    console.log(`  Node:    v${node.current} ✓`);
  } else {
    console.log(`  Node:    v${node.current} ⚠  (anet requires >=${node.required})`);
    console.log(`           Continuing anyway, but agent-node preview.9+ may fail to start.`);
    console.log(`           Tip: nvm install ${node.required.split(".")[0]} && nvm use ${node.required.split(".")[0]}`);
  }

  // ── 4. Resolve targets + build plan ──
  console.log("\n  Resolving target versions from npm registry...");

  // For "current" versions we always use the full (prerelease-preserving)
  // version string. parseSemver strips "-preview.N" which would make every
  // preview install look stale; this matters for #88 channel-aware UX.
  const agentNodeCur = readGlobalPackageVersion("@sleep2agi/agent-node");
  const serverCur    = readGlobalPackageVersion("@sleep2agi/commhub-server");
  const dashboardCur = readGlobalPackageVersion("@sleep2agi/agent-network-dashboard");

  const [anetTarget, agentNodeTarget, serverTarget, dashboardTarget] = [
    fetchLatestVersion("@sleep2agi/agent-network", channel),
    fetchLatestVersion("@sleep2agi/agent-node", channel),
    fetchLatestVersion("@sleep2agi/commhub-server", channel),
    fetchLatestVersion("@sleep2agi/agent-network-dashboard", channel),
  ];

  const plan: UpgradePlanRow[] = [];

  // anet (self)
  plan.push({
    pkg: "@sleep2agi/agent-network",
    display: "anet (self)",
    current: anetVersion || null,
    target: anetTarget,
    action: !anetTarget ? "lookup-failed"
      : (anetVersion === anetTarget) ? "up-to-date"
      : isSelf ? "upgrade" : "self-skip",
    note: !isSelf && anetVersion !== anetTarget && anetTarget
      ? "(--no-auto-self set; use `anet upgrade --self` to detach, or follow manual instructions below)"
      : undefined,
  });

  // agent-node
  if (agentNodeCur) {
    plan.push({
      pkg: "@sleep2agi/agent-node",
      display: "agent-node",
      current: agentNodeCur,
      target: agentNodeTarget,
      action: !agentNodeTarget ? "lookup-failed"
        : (agentNodeCur === agentNodeTarget ? "up-to-date" : "upgrade"),
    });
  } else {
    plan.push({
      pkg: "@sleep2agi/agent-node",
      display: "agent-node",
      current: null,
      target: agentNodeTarget,
      action: "lazy-skip",
      note: "(not installed globally — lazy-fetched via npx by `anet node start`)",
    });
  }

  // commhub-server — always note the PINNED vs global drift
  if (serverCur) {
    plan.push({
      pkg: "@sleep2agi/commhub-server",
      display: "commhub-server",
      current: serverCur,
      target: serverTarget,
      action: !serverTarget ? "lookup-failed"
        : (serverCur === serverTarget ? "up-to-date" : "upgrade"),
      note: `(anet hub start uses pinned ${PINNED_SERVER_VERSION} — your global install is for direct CLI use only)`,
    });
  } else {
    plan.push({
      pkg: "@sleep2agi/commhub-server",
      display: "commhub-server",
      current: null,
      target: serverTarget,
      action: "lazy-skip",
      note: `(not installed globally — \`anet hub start\` lazy-fetches pinned ${PINNED_SERVER_VERSION} via npx)`,
    });
  }

  // dashboard
  if (dashboardCur) {
    plan.push({
      pkg: "@sleep2agi/agent-network-dashboard",
      display: "dashboard",
      current: dashboardCur,
      target: dashboardTarget,
      action: !dashboardTarget ? "lookup-failed"
        : (dashboardCur === dashboardTarget ? "up-to-date" : "upgrade"),
    });
  } else {
    plan.push({
      pkg: "@sleep2agi/agent-network-dashboard",
      display: "dashboard",
      current: null,
      target: dashboardTarget,
      action: "lazy-skip",
      note: "(not installed globally — `anet hub dashboard` lazy-fetches via npx)",
    });
  }

  // ── 5. Print plan ──
  printUpgradePlan(plan);

  // ── 6. Dry-run ──
  if (isDryRun) {
    console.log("\n[anet] --dry-run: no install actions performed.\n");
    return;
  }

  // ── 7. Execute upgrades (anet self is handled separately at end) ──
  let upgraded = 0, upToDate = 0, lazy = 0, failed = 0;
  for (const p of plan) {
    if (p.pkg === "@sleep2agi/agent-network") continue;  // self handled below
    if (p.action === "up-to-date") { upToDate++; continue; }
    if (p.action === "lazy-skip")  { lazy++; continue; }
    if (p.action === "lookup-failed") {
      console.log(`\n  ⚠ ${p.display}: registry lookup failed — skipping (try again later).`);
      failed++;
      continue;
    }
    if (p.action !== "upgrade") continue;
    console.log(`\n  ▶ Upgrading ${p.display} → ${p.target}...`);
    try {
      installGlobalPackage(`${p.pkg}@${channel}`);
      console.log(`  ✅ ${p.display} now at ${p.target}`);
      upgraded++;
    } catch (e: any) {
      console.log(`  ✗ ${p.display} failed: ${e.message || e}`);
      failed++;
    }
  }

  // ── 8. anet self ──
  const selfPlan = plan.find(p => p.pkg === "@sleep2agi/agent-network")!;
  if (forkScript) {
    // Back-compat: legacy `--fork-script <path>` is still honored but
    // superseded by `--self`. Document removal target in CHANGELOG.
    try {
      const child = spawn(forkScript, [], { stdio: "inherit", detached: true });
      child.unref();
      console.log(`\n  ▶ Spawned legacy --fork-script: ${forkScript}`);
    } catch (e: any) {
      console.log(`\n  ⚠ --fork-script failed: ${e.message}`);
      printManualAnetUpgrade(channel);
    }
  } else if (isSelf && selfPlan.action === "upgrade") {
    selfUpgradeDetached(channel);  // process.exit
  } else if (selfPlan.action === "self-skip") {
    console.log(`\n  anet (self): ⚠️ NEEDS MANUAL UPGRADE — ${selfPlan.current} → ${selfPlan.target}`);
    console.log("    (skipped to avoid replacing the running CLI mid-execution)");
    printManualAnetUpgrade(channel);
  } else if (selfPlan.action === "up-to-date") {
    console.log("\n  anet (self): up to date.");
  } else if (selfPlan.action === "lookup-failed") {
    console.log("\n  anet (self): registry lookup failed — try later.");
    failed++;
  }

  // ── 9. Post-upgrade hints ──
  // #151 (Vincent 5462) — `Done.` previously misled users when anet itself was
  // self-skipped: they saw `0 upgraded, 2 up-to-date, 1 lazy` and assumed they
  // were on the new version, then ran `anet node create --batch` and still hit
  // the old behavior because the running CLI hadn't been swapped. The summary
  // line now explicitly flags the self-skip state.
  const selfSkipped = selfPlan.action === "self-skip";
  const summary = `${upgraded} upgraded, ${upToDate} up-to-date, ${lazy} lazy${failed ? `, ${failed} failed` : ""}${selfSkipped ? ", 1 NEEDS MANUAL UPGRADE (anet self)" : ""}`;
  console.log(`\n[anet] Done. ${summary}.`);
  if (selfSkipped) {
    console.log(`\n  ⚠️ anet CLI itself was NOT upgraded. Run this in a fresh shell:`);
    console.log(`      npm install -g @sleep2agi/agent-network@${channel}`);
    console.log(`      anet --version    # verify upgrade landed`);
    console.log(`  Without this, new features (e.g. updated vendor presets) won't apply.`);
  }
  if (upgraded > 0) {
    console.log("\n  Restart any running nodes to pick up the new versions:");
    console.log("    anet project restart   # (cwd-wide, see #117)");
  }
  console.log();
}

// ── Main ──

// ── status (network overview) ──

async function statusCommand() {
  const gc = loadGlobal();
  const hub = gc.hub;
  if (!hub) { console.log("No hub configured. Run: anet init"); return; }

  try {
    // #473: this summary line needs only the COUNT, so read the anonymous
    // aggregate health.sse_connections — every user can read it. Using the
    // per-alias detail's key-count here was the regression that showed
    // non-admins "0 connected" (detail 403 → {} → 0) on a live hub.
    const [statusRes, sseCount, tasksRes] = await Promise.all([
      fetch(`${hub}/api/status`, { headers: authHeaders() }).then(r => r.json() as any).catch(() => ({ sessions: [] })),
      fetchSseConnectionCount(hub),
      fetch(`${hub}/api/tasks?limit=10`, { headers: authHeaders() }).then(r => r.json() as any).catch(() => ({ tasks: [] })),
    ]);

    const sessions = statusRes.sessions || [];
    const tasks = tasksRes.tasks || [];

    // 🔴 #1548 —— 分类逻辑抽到 ../src/session-status-class.ts 并加了测试。
    //    原先这里把 `blocked` / `error` 折进 `working`,于是运维看到「N working」
    //    时,其中可能有几个是**卡住**或**出错**的。而 #1548 已经证明 `blocked`
    //    是一个**长期为真**的状态,所以一个 agent 可以永远停在那里而被报成「在干活」。
    //    (它并非「没有出口」—— server 的 report_status upsert 里 `status = ?10` 是无条件
    //     覆盖。真正的机制见下面 Needs attention 那一段的注释与 #1606。)
    const classifyStatus = (s: any) => classifySessionStatus(s?.status);
    // 🔴 #1625 —— **不再用 `statusRes.summary`**。`/api/status` 总是返回一个
    //    summary,于是原先的 `statusRes.summary || …` 让本地分类器从不执行,
    //    屏幕上的数字来自服务端一份停在 #1548 之前的分类(`blocked`/`error`
    //    被折进 `working`)。症状:一个 blocked 节点同时出现在 `working` 和
    //    `needs attention` 两格,四个数加起来比 total 多。
    //    范围等价性已核:该端点只加 `addNetworkScope`、无状态/别名过滤,
    //    且服务端的 summary 就是从同一个 sessions 数组算的。
    const summary = summarizeSessions(sessions);
    const idle = sessions.filter((s: any) => classifyStatus(s) === "idle");
    const working = sessions.filter((s: any) => classifyStatus(s) === "working");
    const attention = sessions.filter((s: any) => classifyStatus(s) === "attention");
    const offline = sessions.filter((s: any) => classifyStatus(s) === "offline");

    console.log(`\n  CommHub: ${hub}`);
    // 🔴 attention 单独一格。折进 working 会让「需要人看一眼」消失在一个看起来
    //    正常的数字里 —— 这正是 #1548 那一族问题:两种不同的事渲染成同一个词。
    const attnCount = summary.attention;
    console.log(`  Agents: ${summary.idle || 0} idle, ${summary.working || 0} working`
      + (attnCount > 0 ? `, ${attnCount} needs attention` : "")
      + `, ${summary.offline || 0} offline`);
    // 🔴 #1648 —— 「刚停的」和「掉了三天没人发现的」原先渲染成同一个数字。
    //    实测(84 台 TM 相关节点):45 台 offline 里 27 台 >3 天、18 台 1-3 天、
    //    近 6 小时内 **0 台** —— 「当前没有活故障」和「有 45 台掉了」是完全
    //    不同的两个结论,而屏幕上只有后者。
    //    与 blocked 不同,这一格是**算得出来的**:offline 节点的 last_seen_at
    //    就是它最后一次心跳,不像「何时变成 blocked」那样根本没有字段。
    const offlineDetail = formatOfflineAges(summarizeOfflineAges(offline, Date.now()));
    if (offlineDetail) console.log(`          └─ ${offlineDetail}`);
    console.log(`  SSE:    ${sseCount === null ? "unknown" : `${sseCount} connected`}`);
    console.log(`  Tasks:  ${tasks.length} recent\n`);

    if (attention.length > 0) {
      console.log("  Needs attention (blocked / error / 未知状态 — 需要有人看一眼):");
      for (const s of attention) {
        console.log(`    ${padDisplayEnd(String(s.alias), 16)} ${String(s.status || "").padEnd(8)} ${oneLineCell(s.task, 48)}`);
      }
      // 🔴 状态是**自报**的:它只在 agent 显式上报时才变。一个 `blocked` 可能是
      //    3 秒前报的,也可能是三周前报的 —— 这里不假装知道哪一种。
      // 🔴 不要写「not progressing」:#1548 的实测证据正好相反 —— 一个 blocked 节点
      //    22 秒答完了一条任务。
      // 🔴 也不要声称「只有那个终态回调能清」——旧注释里的那句是错的:
      //    server/src/tools.ts 的 report_status upsert 里 `status = ?10` 是**无条件覆盖**
      //    (同句其余二十来个字段全是 COALESCE),所以 report_status(status="idle") 就能清。
      //    grok 共存节点出不来的真正原因在 agent-node 侧:
      //      runtime/grok-copresence/liveness.ts
      //        if (!liveness.usable && (requested === "idle" || requested === "working")) return "blocked";
      //    agent-node 每 3 分钟上报的 idle 在发出前被改写成 blocked —— 见 #1606。
      console.log("    (🔴 blocked ≠ 停了 —— 实测 blocked 节点仍能秒回任务。状态由 agent 自报,");
      console.log("     不含活性成分;名册里也没有「何时变成 blocked」这个字段 —— updated_at");
      console.log("     被心跳一直刷,不是它。要确认它还在不在,发一条任务试试。");
      console.log("     🔴 grok 共存节点还有一种可能:blocked 表示的是「共存运行时不可用」,");
      console.log("     而不是「这个 agent 卡住了」—— agent-node 每 3 分钟上报的 idle 会在");
      console.log("     liveness 判不可用时被改写成 blocked。见 #1606。)");
      console.log();
    }

    if (working.length > 0) {
      console.log("  Working:");
      for (const s of working) {
        console.log(`    ${padDisplayEnd(s.alias, 16)} ${oneLineCell(s.task, 60)}`);
      }
      console.log();
    }

    if (tasks.length > 0) {
      console.log("  Recent Tasks:");
      // 🔴 STATUS 列原先写死 8,而 "delivered"/"cancelled"/"completed" 都是 9 —— 
      // 那些行会把 FROM 往右顶 1 列。而表头和分隔线是两个各写各的字面量,
      // 实测同一张表出现三个列位:表头 13 / 普通行 11 / delivered 行 12。
      // 宽度从**要打印的这批行**算(状态值域在另一个包里,CLI import 不到),
      // 表头/分隔线/数据行共用它。
      const stW = columnWidth(tasks.map((t: any) => String(t.status || "?")), "STATUS");
      console.log(`  ${"STATUS".padEnd(stW)} ${"FROM".padEnd(15)} ${"TO".padEnd(15)} CONTENT`);
      console.log(`  ${"─".repeat(stW)} ${"─".repeat(15)} ${"─".repeat(15)} ${"─".repeat(8)}`);
      for (const t of tasks.slice(0, 10)) {
        const st = (t.status || "?").padEnd(stW);
        const from = padDisplayEnd(t.from_name || "?", 15);
        const to = padDisplayEnd(t.to_name || "?", 15);
        const content = oneLineCell(t.content, 40);
        console.log(`  ${st} ${from} ${to} ${content}`);
      }
      console.log();
    }
  } catch (e: any) {
    console.error(`Failed to connect to ${hub}: ${e.message}`);
  }
}

// ── tasks (query tasks) ──

async function tasksCommand() {
  const gc = loadGlobal();
  const hub = gc.hub;
  if (!hub) { console.log("No hub configured. Run: anet init"); return; }
  const opts = parseOpts();
  const status = opts.status || args[1];
  const limit = opts.limit || "20";

  try {
    let url = `${hub}/api/tasks?limit=${limit}`;
    if (status) url += `&status=${status}`;
    const res = await fetch(url, { headers: authHeaders() }).then(r => r.json() as any);
    const tasks = res.tasks || [];

    if (tasks.length === 0) {
      // 🔴 「0 条」有两解:真的一条都没有 / 只是**这个 status** 没有。
      // status 就在手边,说出来比让用户自己猜便宜 —— 同族:#1660(0 节点)、#1667(节点名找不到)。
      if (status) {
        console.log(`\n  No tasks with status "${status}".`);
        console.log("  去掉过滤看全部: anet tasks\n");
      } else {
        console.log("\n  No tasks found.\n");
      }
      return;
    }

    console.log(`\n  Tasks (${tasks.length}):\n`);
    // 🔴 STATUS 列原先写死 8,而 "delivered"/"cancelled"/"completed" 都是 9 —— 
    // 那些行会把 FROM 往右顶 1 列。而表头和分隔线是两个各写各的字面量,
    // 实测同一张表出现三个列位:表头 13 / 普通行 11 / delivered 行 12。
    // 宽度从**要打印的这批行**算(状态值域在另一个包里,CLI import 不到),
    // 表头/分隔线/数据行共用它。
    const stW = columnWidth(tasks.map((t: any) => String(t.status || "?")), "STATUS");
    console.log(`  ${"STATUS".padEnd(stW)} ${"FROM".padEnd(15)} ${"TO".padEnd(15)} ${"AGE".padEnd(8)} CONTENT`);
    console.log(`  ${"─".repeat(stW)} ${"─".repeat(15)} ${"─".repeat(15)} ${"─".repeat(8)} ${"─".repeat(8)}`);
    for (const t of tasks) {
      const st = (t.status || "?").padEnd(stW);
      const from = padDisplayEnd((t.from_name || "?").slice(0, 15), 15);
      const to = padDisplayEnd((t.to_name || "?").slice(0, 15), 15);
      const age = t.created_at ? timeAgo(t.created_at) : "?";
      const content = oneLineCell(t.content, 40);
      console.log(`  ${st} ${from} ${to} ${age.padEnd(8)} ${content}`);
    }
    console.log(`\n  Filter: anet tasks replied | anet tasks failed | anet tasks --status delivered\n`);
  } catch (e: any) {
    console.error(friendlyError(e));
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr.replace(" ", "T") + "Z").getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

// ── goal (local scheduled goal management) ──

type GoalStatus = "active" | "paused" | "complete" | "failed" | "cancelled";
interface LocalGoal {
  goal_id: string;
  text: string;
  status: GoalStatus;
  interval_ms: number;
  next_wake_at?: string;
  last_wake_at?: string;
  last_report_at?: string;
  parent_task_id?: string;
  report_to?: string;
  runtime?: string;
  created_at?: string;
  updated_at?: string;
  progress_log?: Array<{ ts?: string; status?: string; summary?: string }>;
}
interface LocalGoalsFile { version: 1; goals: LocalGoal[]; }

function goalPathForNodeId(nodeId: string): string {
  return join(nodesDir(), nodeId, "goals.json");
}

function loadGoalsFile(nodeId: string): { path: string; file: LocalGoalsFile } {
  const path = goalPathForNodeId(nodeId);
  if (!existsSync(path)) return { path, file: { version: 1, goals: [] } };
  let raw = "";
  try {
    raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.goals)) {
      throw new Error("unsupported goals.json schema");
    }
    return { path, file: parsed };
  } catch (e: any) {
    throw new Error(`cannot read ${path}: ${e.message}`);
  }
}

function saveGoalsFile(path: string, file: LocalGoalsFile) {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n");
  renameSync(tmp, path);
}

function formatGoalInterval(ms: number): string {
  const min = Math.round(ms / 60000);
  if (!Number.isFinite(min) || min <= 0) return "?";
  if (min % 1440 === 0) return `${min / 1440}d`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${min}min`;
}

function formatGoalDue(nextWakeAt?: string): string {
  if (!nextWakeAt) return "-";
  const ms = new Date(nextWakeAt).getTime();
  if (!Number.isFinite(ms)) return nextWakeAt;
  const delta = ms - Date.now();
  const abs = Math.abs(delta);
  const unit = abs < 3600000 ? `${Math.max(1, Math.round(abs / 60000))}m` :
    abs < 86400000 ? `${Math.round(abs / 3600000)}h` : `${Math.round(abs / 86400000)}d`;
  return delta <= 0 ? `due ${unit} ago` : `in ${unit}`;
}

function isNodeProbablyRunning(nodeId: string, profile: Profile): boolean {
  const display = nodeDisplayName(nodeId, profile);
  if (tmuxSessionRunning(display) || tmuxSessionRunning(nodeId)) return true;
  const pidPath = join(nodesDir(), nodeId, ".pid");
  if (!existsSync(pidPath)) return false;
  try { process.kill(parseInt(readFileSync(pidPath, "utf-8"), 10), 0); return true; }
  catch { return false; }
}

// #191 Phase 1 Pillar A — parse a `--interval` flag value (CLI side, kept
// in lockstep with agent-node/src/goals/parser.ts INTERVAL_PATTERNS so the
// edit UX matches what a node accepts in `/agoal`/`/aloop`). Returns ms or
// null when the input is empty / unrecognised / sub-minute.
const GOAL_MIN_INTERVAL_MS = 60_000;
function parseGoalIntervalFlag(input: string | undefined): number | null {
  if (!input || typeof input !== "string") return null;
  const body = input.trim();
  if (!body) return null;
  if (/\d+\s*(?:seconds|second|secs|sec|s)\b/i.test(body) || /\d+\s*秒/.test(body)) return null;
  const patterns: Array<{ re: RegExp; toMs: (m: RegExpExecArray) => number }> = [
    { re: /^\s*hourly\s*$/i, toMs: () => 60 * 60_000 },
    { re: /^\s*daily\s*$/i, toMs: () => 24 * 60 * 60_000 },
    { re: /^\s*每\s*小时\s*$/, toMs: () => 60 * 60_000 },
    { re: /^\s*每\s*天\s*$/, toMs: () => 24 * 60 * 60_000 },
    { re: /^\s*每?\s*(\d+)\s*分钟?\s*$/, toMs: (m) => parseInt(m[1], 10) * 60_000 },
    { re: /^\s*每?\s*(\d+)\s*小时\s*$/, toMs: (m) => parseInt(m[1], 10) * 60 * 60_000 },
    { re: /^\s*每?\s*(\d+)\s*天\s*$/, toMs: (m) => parseInt(m[1], 10) * 24 * 60 * 60_000 },
    { re: /^\s*(\d+)\s*(?:minutes|minute|mins|min|m)\s*$/i, toMs: (m) => parseInt(m[1], 10) * 60_000 },
    { re: /^\s*(\d+)\s*(?:hours|hour|hrs|hr|h)\s*$/i, toMs: (m) => parseInt(m[1], 10) * 60 * 60_000 },
    { re: /^\s*(\d+)\s*(?:days|day|d)\s*$/i, toMs: (m) => parseInt(m[1], 10) * 24 * 60 * 60_000 },
  ];
  for (const { re, toMs } of patterns) {
    const m = re.exec(body);
    if (m) {
      const ms = toMs(m);
      if (!Number.isFinite(ms) || ms < GOAL_MIN_INTERVAL_MS) return null;
      return ms;
    }
  }
  return null;
}

const GOAL_VALID_STATUS = new Set(["active", "paused", "completed", "cancelled"]);

// #191 Phase 1 Pillar A — render one goal with progress log for `anet goal
// show`. Compact, no color codes (consistent with `anet info`).
function printGoalShow(goal: LocalGoal, displayName: string, path: string) {
  console.log("");
  console.log(`  Goal:     ${goal.goal_id}`);
  console.log(`  Node:     ${displayName}`);
  console.log(`  Status:   ${goal.status || "?"}`);
  console.log(`  Text:     ${(goal.text || "").replace(/\s+/g, " ")}`);
  console.log(`  Every:    ${formatGoalInterval(goal.interval_ms)}`);
  console.log(`  Next:     ${formatGoalDue(goal.next_wake_at)}${goal.next_wake_at ? `  (${goal.next_wake_at})` : ""}`);
  if (goal.last_wake_at) console.log(`  Last:     ${goal.last_wake_at}`);
  if (goal.runtime) console.log(`  Runtime:  ${goal.runtime}`);
  if (goal.parent_task_id) console.log(`  Parent:   ${goal.parent_task_id}`);
  if (goal.report_to) console.log(`  ReportTo: ${goal.report_to}`);
  console.log(`  Created:  ${goal.created_at || "-"}`);
  console.log(`  Updated:  ${formatHubTime(goal.updated_at)}`);
  console.log(`  File:     ${path}`);
  const log = Array.isArray(goal.progress_log) ? goal.progress_log : [];
  if (log.length === 0) {
    console.log("  Progress: (none)");
  } else {
    console.log(`  Progress (${log.length}):`);
    for (const entry of log.slice(-10)) {
      const ts = (entry.ts || "").slice(0, 19).padEnd(19);
      const st = (entry.status || "").padEnd(10);
      const sm = (entry.summary || "").replace(/\s+/g, " ").slice(0, 80);
      console.log(`    ${ts}  ${st}  ${sm}`);
    }
    if (log.length > 10) console.log(`    … ${log.length - 10} earlier entries omitted`);
  }
  console.log("");
}

// RFC-025 P1.1 — wake-log renderers live in a separate pure module
// (bin/goal-wake-log-render.ts) so unit tests can import them without
// triggering cli.ts's top-level command dispatch (which prints help
// on any load with no argv). Command handler below wraps + console.logs.
import { renderWakeLogJson, renderWakeLogText } from "./goal-wake-log-render";

function printGoalUsage() {
  console.log(`
anet goal <command>

  list [node]                  List scheduled goals for one node, or all nodes
  show <node> <goal-id>        Show one goal in detail (including progress log)
  wake-log <node> <goal-id>    Export progress_log (wake history) — supports --json / --tail N
  edit <node> <goal-id> ...    Edit a goal's interval / text / status
  cancel <node> <goal-id>      Mark a goal cancelled in that node's goals.json

Edit flags (at least one required):
  --interval <5min|1h|1d|每5分钟|hourly|daily|...>
  --text "<new goal description>"
  --status active|paused|completed|cancelled

Wake-log flags:
  --json                       Output raw JSON (goal_id + entries[])
  --tail N                     Only show the last N entries (default: all)

Examples:
  anet goal list
  anet goal list 通信牛
  anet goal show 通信牛 abcd1234
  anet goal wake-log 通信牛 abcd1234
  anet goal wake-log 通信牛 abcd1234 --tail 5
  anet goal wake-log 通信牛 abcd1234 --json
  anet goal edit 通信牛 abcd1234 --interval 10min
  anet goal edit 通信牛 abcd1234 --status paused
  anet goal cancel 通信牛 abcd1234

Data: .anet/nodes/<node>/goals.json

Note: running agent-node processes keep goal state in memory. After edit /
cancel, restart the node for the change to take effect until live goal
control is backed by a hub API.
`);
}

async function goalCommand() {
  const sub = args[1];
  if (!sub || sub === "--help" || sub === "-h") {
    printGoalUsage();
    return;
  }

  if (sub === "list" || sub === "ls") {
    const nodeRef = args[2];
    const targets = nodeRef
      ? (() => {
          const resolved = resolveNodeRef(nodeRef);
          if (!resolved) {
            console.error(nodeNotFound(nodeRef));
            process.exit(1);
          }
          return [resolved];
        })()
      : listProfileIds().map(id => {
          const profile = loadProfile(id);
          return profile ? { id, profile } : null;
        }).filter(Boolean) as Array<{ id: string; profile: Profile }>;

    let total = 0;
    for (const { id, profile } of targets) {
      const { path, file } = loadGoalsFile(id);
      const goals = file.goals || [];
      if (!nodeRef && goals.length === 0) continue;
      total += goals.length;
      const name = nodeDisplayName(id, profile);
      console.log(`\n${name} (${id})`);
      console.log(`  ${path}`);
      if (goals.length === 0) {
        console.log("  No goals.");
        continue;
      }
      console.log("  ID       STATUS     EVERY   NEXT        TEXT");
      console.log("  ──────── ────────── ─────── ─────────── ─────────────────────────────");
      for (const g of goals) {
        const short = g.goal_id.slice(0, 8);
        const status = String(g.status || "?").padEnd(10);
        const every = formatGoalInterval(g.interval_ms).padEnd(7);
        const due = formatGoalDue(g.next_wake_at).slice(0, 11).padEnd(11);
        const text = (g.text || "").replace(/\s+/g, " ").slice(0, 60);
        console.log(`  ${short} ${status} ${every} ${due} ${text}`);
      }
    }
    if (total === 0) {
      // 空清单也要给下一步 —— 同一个 CLI 里 `anet node ls`(Get started: anet init)
      // 和 `anet project up`(Create some with: anet node create <name>) 都这么做,
      // 只有这里是光秃秃一句。正确写法就在隔壁。
      // 🔴 `anet goal` **没有创建子命令**(只有 list/show/wake-log/edit/cancel),
      // 所以这里不能写 `anet goal add` —— 创建路径是 `anet node loop`,已实跑确认。
      console.log("\nNo goals found.");
      console.log('Schedule one: anet node loop <node> "<task>" --every 5m\n');
    }
    else console.log();
    return;
  }

  if (sub === "cancel") {
    const nodeRef = args[2];
    const goalRef = args[3];
    if (!nodeRef || !goalRef) {
      console.error("Usage: anet goal cancel <node> <goal-id>");
      process.exit(1);
    }
    const resolved = resolveNodeRef(nodeRef);
    if (!resolved) {
      console.error(nodeNotFound(nodeRef));
      process.exit(1);
    }
    const { path, file } = loadGoalsFile(resolved.id);
    const matches = file.goals.filter(g => g.goal_id === goalRef || g.goal_id.startsWith(goalRef));
    if (matches.length === 0) {
      console.error(`Goal "${goalRef}" not found in ${path}`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`Goal prefix "${goalRef}" is ambiguous (${matches.length} matches). Use a longer id.`);
      process.exit(1);
    }
    const goal = matches[0];
    goal.status = "cancelled";
    goal.updated_at = new Date().toISOString();
    goal.progress_log = Array.isArray(goal.progress_log) ? goal.progress_log : [];
    goal.progress_log.push({ ts: new Date().toISOString(), status: "cancelled", summary: "cancelled by anet goal cancel" });
    saveGoalsFile(path, file);

    console.log(`[anet] cancelled goal ${goal.goal_id.slice(0, 8)} for ${nodeDisplayName(resolved.id, resolved.profile)}`);
    console.log(`[anet] ${path}`);
    if (isNodeProbablyRunning(resolved.id, resolved.profile)) {
      console.log("[anet] node appears to be running; restart it for local goals.json changes to take effect.");
    }
    return;
  }

  // #191 Phase 1 Pillar A — `anet goal show <node> <goal-id>`: detailed
  // view for one goal, including the last 10 progress_log entries. Read-only.
  if (sub === "show") {
    const nodeRef = args[2];
    const goalRef = args[3];
    if (!nodeRef || !goalRef) {
      console.error("Usage: anet goal show <node> <goal-id>");
      process.exit(1);
    }
    const resolved = resolveNodeRef(nodeRef);
    if (!resolved) {
      console.error(nodeNotFound(nodeRef));
      process.exit(1);
    }
    const { path, file } = loadGoalsFile(resolved.id);
    const matches = file.goals.filter(g => g.goal_id === goalRef || g.goal_id.startsWith(goalRef));
    if (matches.length === 0) {
      console.error(`Goal "${goalRef}" not found in ${path}`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`Goal prefix "${goalRef}" is ambiguous (${matches.length} matches). Use a longer id.`);
      process.exit(1);
    }
    printGoalShow(matches[0], nodeDisplayName(resolved.id, resolved.profile), path);
    return;
  }

  // RFC-025 P1.1 — `anet goal wake-log <node> <goal-id> [--json] [--tail N]`:
  // export progress_log (wake history). Complements `anet goal show`
  // (which caps at 10 entries) by giving full access + machine-readable
  // JSON for scripting. Read-only, no state changes.
  if (sub === "wake-log" || sub === "wakelog") {
    const nodeRef = args[2];
    const goalRef = args[3];
    if (!nodeRef || !goalRef) {
      console.error("Usage: anet goal wake-log <node> <goal-id> [--json] [--tail N]");
      process.exit(1);
    }
    const opts = parseOpts();
    const resolved = resolveNodeRef(nodeRef);
    if (!resolved) {
      console.error(nodeNotFound(nodeRef));
      process.exit(1);
    }
    const { path, file } = loadGoalsFile(resolved.id);
    const matches = file.goals.filter(g => g.goal_id === goalRef || g.goal_id.startsWith(goalRef));
    if (matches.length === 0) {
      console.error(`Goal "${goalRef}" not found in ${path}`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`Goal prefix "${goalRef}" is ambiguous (${matches.length} matches). Use a longer id.`);
      process.exit(1);
    }
    // --tail parsing. Reject NaN / <=0 / non-integer. Missing = all.
    let tailN: number | undefined;
    if (typeof opts.tail === "string" && opts.tail.length > 0) {
      const n = parseInt(opts.tail, 10);
      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
        console.error(`--tail must be a positive integer, got "${opts.tail}"`);
        process.exit(1);
      }
      tailN = n;
    }
    // parseOpts declares Record<string, string>: bare `--json` lands
    // as the sentinel string "true"; `--json=false` opts out.
    const asJson = typeof opts.json === "string" && opts.json !== "false";
    if (asJson) {
      console.log(JSON.stringify(renderWakeLogJson(matches[0], { tail: tailN }), null, 2));
    } else {
      console.log(renderWakeLogText(matches[0], { tail: tailN }));
    }
    return;
  }

  // #191 Phase 1 Pillar A — `anet goal edit <node> <goal-id> --interval ...
  // --text "..." --status active|paused|completed|cancelled`. At least one
  // mutating flag required. Atomic write (saveGoalsFile = tmp + rename).
  // Appends a progress_log "edited" entry summarising the changed fields so
  // the audit trail is preserved.
  if (sub === "edit") {
    const nodeRef = args[2];
    const goalRef = args[3];
    if (!nodeRef || !goalRef) {
      console.error("Usage: anet goal edit <node> <goal-id> [--interval ...] [--text \"...\"] [--status ...]");
      process.exit(1);
    }
    const opts = parseOpts();
    const resolved = resolveNodeRef(nodeRef);
    if (!resolved) {
      console.error(nodeNotFound(nodeRef));
      process.exit(1);
    }
    const { path, file } = loadGoalsFile(resolved.id);
    const matches = file.goals.filter(g => g.goal_id === goalRef || g.goal_id.startsWith(goalRef));
    if (matches.length === 0) {
      console.error(`Goal "${goalRef}" not found in ${path}`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(`Goal prefix "${goalRef}" is ambiguous (${matches.length} matches). Use a longer id.`);
      process.exit(1);
    }
    const goal = matches[0];
    const changes: string[] = [];

    if (typeof opts.interval === "string" && opts.interval.length > 0) {
      const ms = parseGoalIntervalFlag(opts.interval);
      if (ms === null) {
        console.error(`--interval value not recognised: "${opts.interval}". Try 5min / 1h / 1d / 每5分钟 / hourly / daily (sub-minute rejected).`);
        process.exit(1);
      }
      if (ms !== goal.interval_ms) {
        const prev = formatGoalInterval(goal.interval_ms);
        goal.interval_ms = ms;
        // Recompute next_wake_at from now + new interval so the change
        // takes effect on the next tick rather than waiting out the old
        // window. Live nodes still need a restart per the Note in usage.
        goal.next_wake_at = new Date(Date.now() + ms).toISOString();
        changes.push(`interval ${prev} → ${formatGoalInterval(ms)}`);
      }
    }

    if (typeof opts.text === "string" && opts.text.length > 0) {
      const next = opts.text.trim();
      if (next && next !== goal.text) {
        goal.text = next;
        changes.push(`text updated (${next.length} chars)`);
      }
    }

    if (typeof opts.status === "string" && opts.status.length > 0) {
      const next = opts.status.trim().toLowerCase();
      if (!GOAL_VALID_STATUS.has(next)) {
        console.error(`--status must be one of: ${Array.from(GOAL_VALID_STATUS).join(", ")}`);
        process.exit(1);
      }
      if (next !== goal.status) {
        const prev = goal.status || "?";
        goal.status = next as GoalStatus;
        changes.push(`status ${prev} → ${next}`);
      }
    }

    if (changes.length === 0) {
      console.error("No edit flags supplied (or no effective change). Use --interval / --text / --status.");
      process.exit(1);
    }

    goal.updated_at = new Date().toISOString();
    goal.progress_log = Array.isArray(goal.progress_log) ? goal.progress_log : [];
    goal.progress_log.push({
      ts: goal.updated_at,
      status: goal.status,
      summary: `edited by anet goal edit: ${changes.join("; ")}`,
    });
    saveGoalsFile(path, file);

    console.log(`[anet] edited goal ${goal.goal_id.slice(0, 8)} for ${nodeDisplayName(resolved.id, resolved.profile)}`);
    for (const c of changes) console.log(`         ${c}`);
    console.log(`[anet] ${path}`);
    if (isNodeProbablyRunning(resolved.id, resolved.profile)) {
      console.log("[anet] node appears to be running; restart it for local goals.json changes to take effect.");
    }
    return;
  }

  printGoalUsage();
  process.exit(1);
}

// ── register ──

async function registerCommand() {
  const gc = loadGlobal();
  const sc = loadServerConfig();
  const opts = parseOpts();
  let hub = opts.hub || gc.hub;

  // #467 — scripts commonly bootstrap against an explicit remote Hub while
  // an old global config still exists. Persist the explicit endpoint before
  // registration so the resulting token/network config is internally
  // consistent and subsequent commands use the same Hub.
  if (opts.hub && opts.hub !== gc.hub) {
    gc.hub = opts.hub;
    saveGlobal(gc);
  }

  // Auto-detect local hub
  if (!hub) {
    try {
      const h = await fetch("http://127.0.0.1:9200/health").then(r => r.json() as any);
      if (h.ok) { hub = "http://127.0.0.1:9200"; gc.hub = hub; saveGlobal(gc); console.log(`[anet] 检测到本地 CommHub: ${hub}`); }
    } catch {}
  }
  // 🔴 exit(1), not return. `anet register && anet login && anet node create` is
  //    the documented first-run chain, and a command that prints an error while
  //    exiting 0 lets the chain walk straight past the failure. Measured on a
  //    clean machine with the hub down: register and login both returned 0,
  //    while init and node create returned 1 — loginCommand even mixed both
  //    conventions internally (its bad-password path already exits 1).
  if (!hub) { console.error("未找到 CommHub Server。请先运行: anet hub start"); process.exit(1); }

  const username = opts.username || opts.user || await ask("Username");
  const password = opts.password || opts.pass || await ask("Password (min 6)");
  const email = opts.email || ((opts.username || opts.user) ? "" : await ask("Email (optional)"));
  closeRL();

  if (!username || !password) { console.error("Username and password required."); process.exit(1); }

  // Auto-include server auth token for registration
  const serverToken = serverAuthTokenFromConfig(sc) || getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (serverToken) headers["Authorization"] = `Bearer ${serverToken}`;

  try {
    const res = await fetch(`${hub}/api/auth/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({ username, password, email: email || undefined }),
    }).then(r => r.json() as any);

    if (!res.ok) { console.error(`Registration failed: ${res.error}`); process.exit(1); }

    // Auto-login
    gc.token = res.token;
    gc.user = res.user;
    const nets = await fetch(`${hub}/api/networks`, { headers: { Authorization: `Bearer ${res.token}` } }).then(r => r.json() as any);
    if (nets.ok && nets.networks?.length > 0) {
      gc.network_id = nets.networks[0].network_id;
      gc.network_name = nets.networks[0].network_name;
    }
    saveGlobal(gc);
    console.log(`[anet] Registered and logged in as ${res.user.username}`);
    if (gc.network_name) console.log(`[anet] Default network: ${gc.network_name}`);
    console.log(`[anet] Token saved to ~/.anet/config.json`);
  } catch (e: any) { console.error(friendlyError(e)); process.exit(1); }
}

// ── login/logout/whoami ──

async function loginCommand() {
  const gc = loadGlobal();
  const opts = parseOpts();
  // Accept --hub on the login command directly so scripts (setup-anet.sh)
  // don't have to run a separate `anet init` step. If supplied, persist it
  // to gc.hub so subsequent commands work.
  const hub = opts.hub || gc.hub;
  if (!hub) { console.error("No hub configured. Pass --hub <url> or run 'anet init' first."); process.exit(1); }
  if (opts.hub && opts.hub !== gc.hub) {
    gc.hub = opts.hub;
    saveGlobal(gc);
  }

  // anet login --token <token>
  if (opts.token) {
    try {
      const res = await fetch(`${hub}/api/auth/me`, { headers: { Authorization: `Bearer ${opts.token}` } }).then(r => r.json() as any);
      if (!res.ok) { console.error(`Invalid token: ${res.error}`); process.exit(1); }
      gc.token = opts.token;
      gc.user = res.user;
      gc.network_id = res.current_network;
      saveGlobal(gc);
      console.log(`[anet] Logged in as ${res.user.username} (token)`);
      console.log(`[anet] Network: ${res.current_network || "none"}`);
    } catch (e: any) { console.error(friendlyError(e)); process.exit(1); }
    return;
  }

  // Interactive login
  const username = opts.username || opts.user || await ask("Username");
  const password = opts.password || opts.pass || await ask("Password");
  closeRL();

  if (!username || !password) { console.error("Username and password required."); process.exit(1); }

  let res: any;
  try {
    res = await fetch(`${hub}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(r => r.json() as any);
  } catch (e: any) {
    // Network / DNS / connection error — show the friendly hint, not the
    // first-time-login guidance (auth-fail guidance below is for 401 only).
    console.error(`❌ Cannot reach hub: ${friendlyError(e)}`);
    process.exit(1);
  }

  if (!res?.ok) {
    const serverErr = String(res?.error || "unknown");
    console.error(`❌ Login failed: ${serverErr}`);
    // Only show first-time-login guidance for auth-fail errors. Skip for
    // rate-limit / hub-internal / network-mid-flight server errors so
    // users don't get pointed at `anet register` when retry is what they
    // actually need (#58, Vincent 4339-4350 chain).
    const looksLikeAuthFail = /invalid|password|unauthor|credential|not found/i.test(serverErr);
    if (looksLikeAuthFail) {
      console.error("");
      console.error(`👉 首次用这个 hub? 试一下:`);
      console.error(`     anet register                              # 在 hub 上建新账号`);
      console.error("");
      console.error(`👉 自己刚起的本地 hub?`);
      console.error(`     密码是 anet hub start 启动时【打印过一次】的随机串(形如 anet-xxxxxxxx),`);
      console.error(`     不是固定的 anethub —— 见 #261 P0-2。翻一下 hub 的启动输出。`);
      console.error(`     管理员凭据落在: ~/.anet/server/admin-utok.json`);
      console.error("");
      console.error(`👉 自己 hub 忘了密码? 在 hub host 上跑:`);
      console.error(`     # 必须在 hub server 那台机器上跑 (--i-am-on-the-hub-host 是 safety flag, 防误删别人 DB):`);
      console.error(`     anet hub admin reset-user --username admin --i-am-on-the-hub-host true`);
    }
    // A failed login used to `return`, which exits 0. Any script, CI step or
    // deploy automation that ran `anet login` therefore continued as if it
    // had succeeded. Fail loudly enough for a shell to notice.
    process.exit(1);
  }
  // res.ok === true from here — login succeeded.
  try {
    gc.token = res.token;
    gc.user = res.user;
    console.log(`✅ Logged in as ${res.user.username}`);

    // #261 P0-2 (2026-06-28) — bootstrap-default-password nudge. Server
    // sets `must_change_password: true` on the login response when the
    // user is still using the random bootstrap pwd `anet hub start`
    // generated. NOT a login-blocker (back-compat: old `admin/anethub`
    // deployments simply never get this flag, so they don't see this
    // message); just a prominent warn + the exact next command. Old
    // server builds don't include the field → undefined → no warn,
    // also back-compat.
    if (res.must_change_password === true) {
      console.log(``);
      console.log(`⚠ Your password is the BOOTSTRAP DEFAULT and must be changed.`);
      console.log(`     A public hub with a default password = full takeover risk.`);
      console.log(`     Change it now:  anet passwd`);
      console.log(``);
    }

    // Fetch networks and let user choose
    const nets = await fetch(`${hub}/api/networks`, { headers: { Authorization: `Bearer ${res.token}` } }).then(r => r.json() as any);
    const networks = nets.ok ? (nets.networks || []) : [];

    if (networks.length > 1 && process.stdin.isTTY) {
      // Multiple networks → interactive select
      try {
        const { select: sel } = await import("@inquirer/prompts");
        const roleIcon: Record<string, string> = { owner: "⭐", admin: "🔧", member: "👤", viewer: "👁" };
        const chosen = await sel({
          message: "选择网络:",
          choices: networks.map((n: any) => ({
            value: n.network_id,
            name: `${roleIcon[n.member_role] || " "} ${n.network_name} (${n.member_role || "owner"})`,
          })),
        });
        const net = networks.find((n: any) => n.network_id === chosen);
        gc.network_id = chosen;
        gc.network_name = net?.network_name;
      } catch {
        // inquirer not available, use first network
        gc.network_id = networks[0].network_id;
        gc.network_name = networks[0].network_name;
      }
    } else if (networks.length > 0) {
      gc.network_id = networks[0].network_id;
      gc.network_name = networks[0].network_name;
    }

    saveGlobal(gc);
    if (gc.network_name) console.log(`   network: ${gc.network_name}`);
    console.log(`   token saved to ~/.anet/config.json`);
    console.log(`✅ Login successful — next: anet status / anet node create my-agent`);
  } catch (e: any) { console.error(friendlyError(e)); process.exit(1); }
}

function logoutCommand() {
  const gc = loadGlobal();
  delete gc.token;
  delete gc.user;
  delete gc.network_id;
  delete gc.network_name;
  saveGlobal(gc);
  console.log("[anet] Logged out. Token removed.");
}

async function whoamiCommand() {
  const gc = loadGlobal();
  const hub = gc.hub;
  const token = gc.token;
  if (!hub || !token) { console.log("Not logged in. Run: anet login"); return; }

  try {
    const res = await fetch(`${hub}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json() as any);
    if (!res.ok) { console.log("Session expired. Run: anet login"); return; }
    console.log(`\n  User: ${res.user.username} (${res.user.user_id})`);
    console.log(`  Role: ${res.user.role}`);
    console.log(`  Hub:  ${hub}`);
    if (res.networks?.length) {
      console.log(`\n  Networks:`);
      for (const n of res.networks) {
        const current = n.network_id === gc.network_id ? " ← current" : "";
        console.log(`    ${n.network_name} (${n.network_id.slice(0, 12)})${current}`);
      }
    }
    console.log();
  } catch (e: any) { console.error(friendlyError(e)); }
}

// ── network ──

function printNetworkUsage() {
  console.log(`
anet network <command>

  ls                    List my networks
  create <name>         Create a new network
  use <name>            Switch to a network
  info                  Current network details + stats
  rename <old> <new>    Rename a network
  delete <name> --force Delete a network
  invite                Generate invite code for current network
  join <code>           Join a network by invite code
  members               List members of current network
`);
}

async function networkCommand() {
  const sub = args[1];
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    printNetworkUsage();
    return;
  }

  const gc = loadGlobal();
  const hub = gc.hub;
  const token = gc.token;

  if (!hub) { console.error("Run 'anet init' first."); return; }
  if (!token) { console.error("Run 'anet login' first."); return; }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  if (sub === "create") {
    const name = args[2];
    const opts = parseOpts();
    if (!name) { console.log("Usage: anet network create <name> [--description <desc>]"); return; }
    try {
      const res = await fetch(`${hub}/api/networks`, {
        method: "POST", headers,
        body: JSON.stringify({ name, description: opts.description }),
      }).then(r => r.json() as any);
      if (res.ok) {
        console.log(`[anet] Network "${name}" created (${res.network_id})`);
      } else {
        console.error(`Failed: ${res.error}`);
      }
    } catch (e: any) { console.error(friendlyError(e)); }
    return;
  }

  if (sub === "ls" || sub === "list" || !sub) {
    try {
      const res = await fetch(`${hub}/api/networks`, { headers }).then(r => r.json() as any);
      if (!res.ok) { console.error(res.error); return; }
      if (!res.networks?.length) { console.log("\n  No networks. Create one: anet network create <name>\n"); return; }
      console.log("\n  Networks:\n");
      const roleIcon: Record<string, string> = { owner: "⭐", admin: "🔧", member: "👤", viewer: "👁" };
      for (const n of res.networks) {
        const current = n.network_id === gc.network_id ? " ← current" : "";
        const icon = roleIcon[n.member_role] || " ";
        const role = n.member_role ? ` (${n.member_role})` : "";
        console.log(`  ${icon} ${padDisplayEnd(n.network_name, 18)} ${role.padEnd(10)} ${n.network_id.slice(0, 12)}${current}`);
      }
      console.log();
    } catch (e: any) { console.error(friendlyError(e)); }
    return;
  }

  if (sub === "use") {
    const name = args[2];
    if (!name) { console.log("Usage: anet network use <name>"); return; }
    try {
      const res = await fetch(`${hub}/api/networks`, { headers }).then(r => r.json() as any);
      const net = res.networks?.find((n: any) => n.network_name === name || n.network_id === name);
      if (!net) { console.error(`Network "${name}" not found.`); return; }
      gc.network_id = net.network_id;
      gc.network_name = net.network_name;
      saveGlobal(gc);
      console.log(`[anet] Switched to network "${net.network_name}" (${net.network_id.slice(0, 12)})`);
    } catch (e: any) { console.error(friendlyError(e)); }
    return;
  }

  if (sub === "info") {
    const netId = gc.network_id;
    if (!netId) { console.log("No network selected. Run: anet network use <name>"); return; }
    try {
      const detail = await fetch(`${hub}/api/networks/${netId}`, { headers }).then(r => r.json() as any);
      if (!detail.ok) { console.error(detail.error); return; }
      const n = detail.network;
      const s = detail.stats;
      console.log(`\n  Network: ${n.network_name}`);
      console.log(`  ID:      ${n.network_id}`);
      console.log(`  Owner:   ${n.owner_id}`);
      if (n.description) console.log(`  Desc:    ${n.description}`);
      console.log(`  Created: ${n.created_at}`);
      console.log(`\n  Stats:`);
      console.log(`    Nodes:    ${s.nodes}`);
      console.log(`    Sessions: ${s.sessions}`);
      if (s.tasks?.length) {
        console.log(`    Tasks:`);
        for (const t of s.tasks) console.log(`      ${t.status}: ${t.count}`);
      }
      console.log();
    } catch (e: any) { console.error(friendlyError(e)); }
    return;
  }

  if (sub === "delete") {
    const name = args[2];
    if (!name) { console.log("Usage: anet network delete <name> --force"); return; }
    const opts2 = parseOpts();
    try {
      const res = await fetch(`${hub}/api/networks`, { headers }).then(r => r.json() as any);
      const net = res.networks?.find((n: any) => n.network_name === name || n.network_id === name);
      if (!net) { console.error(`Network "${name}" not found.`); return; }
      if (opts2.force !== "true") {
        console.log(`[anet] This will delete network "${net.network_name}" (${net.network_id})`);
        console.log(`[anet] Run again with --force to confirm.`);
        return;
      }
      const del = await fetch(`${hub}/api/networks/${net.network_id}`, { method: "DELETE", headers }).then(r => r.json() as any);
      if (del.ok) {
        console.log(`[anet] Network "${net.network_name}" deleted`);
        if (gc.network_id === net.network_id) { delete gc.network_id; delete gc.network_name; saveGlobal(gc); }
      } else { console.error(`Failed: ${del.error}`); }
    } catch (e: any) { console.error(friendlyError(e)); }
    return;
  }

  if (sub === "rename") {
    const name = args[2];
    const newName = args[3];
    if (!name || !newName) { console.log("Usage: anet network rename <current-name> <new-name>"); return; }
    try {
      const res = await fetch(`${hub}/api/networks`, { headers }).then(r => r.json() as any);
      const net = res.networks?.find((n: any) => n.network_name === name || n.network_id === name);
      if (!net) { console.error(`Network "${name}" not found.`); return; }
      const rename = await fetch(`${hub}/api/networks/${net.network_id}`, { method: "PUT", headers, body: JSON.stringify({ name: newName }) }).then(r => r.json() as any);
      if (rename.ok) {
        console.log(`[anet] Renamed "${name}" → "${newName}"`);
        if (gc.network_id === net.network_id) { gc.network_name = newName; saveGlobal(gc); }
      } else { console.error(`Failed: ${rename.error}`); }
    } catch (e: any) { console.error(friendlyError(e)); }
    return;
  }

  if (sub === "invite") {
    const opts = parseOpts();
    const netId = gc.network_id;
    if (!netId) { console.error("No network selected. Run: anet network use <name>"); return; }
    const role = opts.role || "member";
    const maxUses = parseInt(opts.uses || "1", 10);
    const expiresDays = opts.expires ? parseInt(opts.expires, 10) : undefined;
    try {
      const res = await fetch(`${hub}/api/networks/${netId}/invite`, {
        method: "POST", headers,
        body: JSON.stringify({ role, max_uses: maxUses, expires_days: expiresDays }),
      }).then(r => r.json() as any);
      if (res.ok) {
        console.log(`\n  Invite code: ${res.invite_code}`);
        console.log(`  Network:     ${gc.network_name || netId}`);
        console.log(`  Role:        ${role}`);
        console.log(`  Uses:        ${maxUses === -1 ? "unlimited" : maxUses}`);
        if (expiresDays) console.log(`  Expires:     ${expiresDays} days`);
        console.log(`\n  Share this with the invitee:`);
        console.log(`  anet network join ${res.invite_code}\n`);
      } else { console.error(`Failed: ${res.error}`); }
    } catch (e: any) { console.error(friendlyError(e)); }
    return;
  }

  if (sub === "join") {
    const code = args[2];
    if (!code) { console.log("Usage: anet network join <invite-code>"); return; }
    try {
      const res = await fetch(`${hub}/api/networks/join`, {
        method: "POST", headers,
        body: JSON.stringify({ invite_code: code }),
      }).then(r => r.json() as any);
      if (res.ok) {
        // Switch to the joined network
        gc.network_id = res.network_id;
        // Fetch network name
        const nets = await fetch(`${hub}/api/networks`, { headers }).then(r => r.json() as any);
        const net = nets.networks?.find((n: any) => n.network_id === res.network_id);
        if (net) gc.network_name = net.network_name;
        saveGlobal(gc);
        console.log(`[anet] Joined network "${gc.network_name || res.network_id}" as ${res.role}`);
        console.log(`[anet] Switched to this network.`);
      } else { console.error(`Failed: ${res.error}`); }
    } catch (e: any) { console.error(friendlyError(e)); }
    return;
  }

  if (sub === "members") {
    const netId = gc.network_id;
    if (!netId) { console.error("No network selected. Run: anet network use <name>"); return; }
    try {
      const res = await fetch(`${hub}/api/networks/${netId}/members`, { headers }).then(r => r.json() as any);
      if (!res.ok) { console.error(res.error); return; }
      console.log(`\n  Members of ${gc.network_name || netId}:\n`);
      const roleIcon: Record<string, string> = { owner: "⭐", admin: "🔧", member: "👤", viewer: "👁" };
      for (const m of res.members) {
        console.log(`  ${roleIcon[m.role] || "?"} ${padDisplayEnd(String(m.display_name || m.username), 16)} ${m.role.padEnd(8)} joined ${m.joined_at?.slice(0, 10) || "?"}`);
      }
      console.log();
    } catch (e: any) { console.error(friendlyError(e)); }
    return;
  }

  printNetworkUsage();
}

// ── logs ──

function logsCommand() {
  const ref = args[1];
  if (!ref) {
    console.log("\nanet logs <node-name>   Show recent agent logs\nanet logs <node-name> --follow   Tail logs\n");
    return;
  }
  const resolved = resolveNodeRef(ref);
  if (!resolved) { console.error(nodeNotFound(ref)); process.exit(1); }

  const logDir = join(nodesDir(), resolved.id, "logs");
  if (!existsSync(logDir)) { console.log("No logs yet."); return; }

  const files = readdirSync(logDir).filter(f => f.endsWith(".log")).sort().reverse();
  if (files.length === 0) { console.log("No log files."); return; }

  const latest = join(logDir, files[0]);
  const opts = parseOpts();

  if (opts.follow === "true" || opts.f === "true") {
    console.log(`Tailing ${latest}...\n`);
    const child = spawn("tail", ["-f", "-n", "50", latest], { stdio: "inherit" });
    process.on("SIGINT", () => { child.kill(); process.exit(0); });
  } else {
    const lines = readFileSync(latest, "utf-8").split("\n");
    const n = parseInt(opts.n || opts.lines || "30");
    const tail = lines.slice(-n).join("\n");
    console.log(`\n${files[0]} (last ${n} lines):\n`);
    console.log(tail);
    if (files.length > 1) console.log(`\n${files.length} log files in ${logDir}`);
  }
}

// ── token ──

async function tokenCommand() {
  const sub = args[1];

  if (sub === "--help" || sub === "-h" || sub === "help") {
    console.log(`
anet token <command>

  ls                    List all tokens
  create <name>         Create a new API token (legacy positional form)
  create --name <name>  Create a new API token
  revoke <token-id>     Revoke a token by ID
`);
    return;
  }

  const createName = sub === "create" ? parseTokenCreateName(args.slice(2)) : null;
  if (createName && !createName.ok) {
    console.error(`Invalid token create arguments: ${createName.error}`);
    console.error("Usage: anet token create --name <name>");
    process.exit(1);
  }

  const gc = loadGlobal();
  const hub = gc.hub;
  const token = gc.token;
  if (!hub || !token) { console.error("Not logged in. Run: anet login"); return; }
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  if (sub === "create") {
    const name = createName!.name;
    try {
      const res = await fetch(`${hub}/api/auth/tokens`, { method: "POST", headers, body: JSON.stringify({ name }) }).then(r => r.json() as any);
      if (res.ok) {
        console.log(`\n  ✅ Token created: ${res.token}`);
        console.log(`  Name: ${name}`);
        console.log(`  ID:   ${res.token_id}`);
        console.log(`\n  ⚠ Save this token — it won't be shown again!\n`);
      } else { console.error(`Failed: ${res.error}`); }
    } catch (e: any) { console.error(friendlyError(e)); }
    return;
  }

  if (sub === "revoke") {
    const tokenId = args[2];
    if (!tokenId) { console.log("Usage: anet token revoke <token-id>"); return; }
    try {
      const res = await fetch(`${hub}/api/auth/tokens/${tokenId}`, { method: "DELETE", headers }).then(r => r.json() as any);
      if (res.ok) console.log(`  ✅ Token ${tokenId} revoked`);
      else console.error(`Failed: ${res.error}`);
    } catch (e: any) { console.error(friendlyError(e)); }
    return;
  }

  // Default: list tokens (same as "ls")
  try {
    const res = await fetch(`${hub}/api/auth/tokens`, { headers }).then(r => r.json() as any);
    if (!res.ok) { console.error(res.error); return; }
    if (!res.tokens?.length) { console.log("\n  No tokens. Create one: anet token create <name>\n"); return; }
    console.log("\n  API Tokens:\n");
    // 🔴 表头里 ID 留 20 列,数据行却是 padEnd(22) —— 整张表从第二列起就错开 2。
    // 三处宽度改为同一组常量。
    // 🔴 而 name 是用户起的、没有上限:写死 14 时一个长名字就把 CREATED 顶偏(本机实测有一个)。
    // 三列宽度全部从**本次要打印的这批 token** 算,表头/分隔线/数据行共用同一组。
    const tW = {
      id: columnWidth(res.tokens.map((t: any) => String(t.token_id || "?")), "ID"),
      name: columnWidth(res.tokens.map((t: any) => String(t.name || "?")), "NAME"),
      created: columnWidth(res.tokens.map((t: any) => String(t.created_at || "?")), "CREATED"),
    };
    console.log(`  ${padDisplayEnd("ID", tW.id)} ${padDisplayEnd("NAME", tW.name)} ${padDisplayEnd("CREATED", tW.created)} LAST USED`);
    console.log(`  ${"─".repeat(tW.id)} ${"─".repeat(tW.name)} ${"─".repeat(tW.created)} ${"─".repeat(9)}`);
    for (const t of res.tokens) {
      console.log(`  ${padDisplayEnd(String(t.token_id || "?"), tW.id)} ${padDisplayEnd(String(t.name || "?"), tW.name)} ${padDisplayEnd(String(t.created_at || "?"), tW.created)} ${t.last_used_at || "never"}`);
    }
    console.log();
  } catch (e: any) { console.error(friendlyError(e)); }
}

// ── passwd ──

async function passwdCommand() {
  const gc = loadGlobal();
  const hub = gc.hub;
  const token = gc.token;
  if (!hub || !token) { console.error("Not logged in. Run: anet login"); return; }

  const opts = parseOpts();
  const oldPw = opts["old-password"] || opts.old || await ask("Current password");
  const scriptedNew = opts["new-password"] || opts["new"];
  const newPw = scriptedNew || await ask("New password (min 8)");
  if (!scriptedNew) {
    const confirmPw = await ask("Confirm new password");
    if (newPw !== confirmPw) {
      closeRL();
      console.error("[anet] Failed: passwords do not match");
      return;
    }
  }
  closeRL();

  if (!oldPw || !newPw) { console.error("Both passwords required."); return; }

  try {
    const res = await fetch(`${hub}/api/auth/password`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
    }).then(r => r.json() as any);

    if (res.ok) {
      if (res.token) {
        gc.token = res.token;
        saveGlobal(gc);
      }
      console.log("[anet] Password changed successfully.");
      if (res.token) console.log("[anet] Login token rotated and saved.");
    } else {
      console.error(`[anet] Failed: ${res.error}`);
    }
  } catch (e: any) { console.error(friendlyError(e)); }
}

// ── demo ──

async function demoCommand() {
  const sub = args[1];
  if (!sub || sub.startsWith("-")) {
    return demoListCommand();
  }
  switch (sub) {
    case "ls": case "list":
      return demoListCommand();
    case "debate":
      args.splice(1, 1);
      return await demoDebateCommand();
    case "socialmedia": case "social":
      args.splice(1, 1);
      return await demoSocialMediaCommand();
    case "pr-review":
      args.splice(1, 1);
      return await demoPrReviewCommand();
    case "sci-team":
      args.splice(1, 1);
      return await demoSciTeamCommand();
    default:
      console.error(`Unknown demo "${sub}". Run 'anet demo ls' to see all available demos.`);
      process.exit(1);
  }
}

function demoListCommand() {
  console.log(`
  Available demos:

  ● debate          辩论赛 — 6 agent (主持人 / 正反 4 辩 / 评委), ~10 min
                  anet demo debate --topic "AI 创造的岗位是否比消灭的多"

  ● socialmedia     社交媒体内容工厂 — 4 agent (选题/文案/配图/审核), ~3 min
                  anet demo socialmedia --topic "..." --platform xiaohongshu

  ● pr-review       代码 PR 审查室 — 4 agent (安全/性能/风格 3 reviewer 并行 + judge), ~2 min
                  anet demo pr-review --diff path/to/change.diff
                  anet demo pr-review --pr https://github.com/owner/repo/pull/N
                  anet demo pr-review --ref origin/main

  ● sci-team        科研军团 — 1 leader + N-1 worker (默认 10, 5-50 可调) 跑书生模型, Phase 1 scaffold
                  anet demo sci-team
                  anet demo sci-team --count 20 --dir ~/intern-s --intern-api $KEY
                  anet demo sci-team --stop / --restart / --cleanup

  See 'anet demo <name> --help' for details.
`);
}


// ── demo: debate ──
// Runs a multi-agent debate with 6 roles (host / 2 pro / 2 con / judge).
// Spawns local agents that connect to the configured hub, dispatches 9 steps
// in sequence, then prints+saves a markdown transcript. Self-cleaning unless
// --keep is passed.

const DEBATE_ROLES = ["主持人", "正方一辩", "正方二辩", "反方一辩", "反方二辩", "评委"] as const;

const DEBATE_PROMPTS: Record<string, (topic: string) => string> = {
  "主持人": (topic) => `你是辩论赛**主持人**，姓名"周老师"。
本次议题：「${topic}」（正方：肯定 / 反方：否定）

收到来自用户/api 的"开场"任务时:
- 用富有节奏感的台词宣布议题、介绍辩论流程(立论→质询→总结→评判),点燃气氛
- 200 字以内,要有梗、要有金句

收到"宣布结束并交评委"任务时:
- 简要回顾本场亮点 50-100 字
- 邀请评委判分

风格：央视《对话》主持的稳重 + 综艺主持的节奏感。`,
  "正方一辩": (topic) => `你是**正方一辩**,姓名"林希",立场:支持议题「${topic}」。
角色个性:逻辑严密、引用数据(可合理虚构)、善用历史经验类比。

收到"立论"任务:
- 直接抛出核心观点 + 3 个论据
- 350-500 字,开篇要抓人

收到"总结陈词"任务:
- 用对方在质询/反驳中暴露的弱点反将一军
- 重申核心立场,留金句
- 250-350 字`,
  "正方二辩": (topic) => `你是**正方二辩**,姓名"陈一川",立场:支持议题「${topic}」。
角色个性:犀利、好斗、专挑对方逻辑漏洞。

收到"质询反方"任务(附反方一辩立论):
- 针对反方立论的 2-3 个具体论点,用反问/数据/案例反驳
- 不要客套,火力全开
- 250-400 字`,
  "反方一辩": (topic) => `你是**反方一辩**,姓名"沈墨",立场:反对议题「${topic}」。
角色个性:冷静的现实派,引用研究报告,强调本议题与表面相似情境的本质差异。

收到"立论"任务(附议题+正方一辩立论):
- 先指出正方论证的最大破绽
- 列举 3 个论据(可合理虚构数据)
- 350-500 字

收到"总结陈词"任务:
- 强化"质量胜过数量"或类似的核心论调
- 250-350 字`,
  "反方二辩": (topic) => `你是**反方二辩**,姓名"白川",立场:反对议题「${topic}」。
角色个性:辛辣、直接、喜欢戳破对方的"乐观假设",常用类比讽刺。

收到"质询正方"任务(附正方一辩立论):
- 用讽刺、类比、反问对正方 2-3 个具体论点开火
- 250-400 字`,
  "评委": (_topic) => `你是辩论赛**评委**,姓名"张教授",公允、深刻、点评一针见血。

收到"判分并宣布胜负"任务(附整场辩论实录):
- 先 100 字总评本场亮点
- 然后给正方/反方分别打分(0-100),列出 2 条加分、2 条扣分理由
- 最后宣布胜负 + 给出核心理由
- 总长 400-600 字
- 不要讨好双方,必须分出胜负`,
};

async function demoDebateCommand() {
  const opts = parseOpts();
  const help = args.includes("--help") || args.includes("-h");
  if (help) {
    console.log(`
  anet demo debate — 多 agent 辩论赛 demo

  Usage:
    anet demo debate [--topic <议题>] [--key <minimax-key>] [--out <path>] [--keep] [--quick]

  Options:
    --topic <text>    辩题 (默认交互输入)
    --key <key>       MiniMax API key (默认 \$MINIMAX_KEY 或交互)
    --out <path>      实录保存路径 (默认 ./debate-<topic>-<ts>.md)
    --keep            跑完不删 6 个 agent + network (默认会清掉)
    --quick           简化版 (开场→正一→反一→评委,4 步)
    --step-timeout    每步超时秒数 (默认 360)
    --suffix          自定义 alias 后缀 (默认随机 4 位)
    --no-network      跑在当前/default network 内 (默认会单独建 debate-<suffix> network)
    --network <id>    指定已存在的 network

  Examples:
    anet demo debate --topic "AI 创造的岗位是否比消灭的多"
    anet demo debate --keep --topic "..."        # 保留 agent
    MINIMAX_KEY=sk-cp-xxx anet demo debate

  需要:
    - 已 anet login 到 hub
    - MiniMax key (Token Plan 至少有 MiniMax-M* 配额)
`);
    return;
  }

  const gc = loadGlobal();
  const hub = gc.hub;
  if (!hub) { console.error("  ❌ 没有 hub. 先 'anet init' 或 'anet hub start'."); return; }
  if (!gc.token) { console.error("  ❌ 没有 token. 先 'anet login'."); return; }

  let topic = opts.topic || "";
  if (!topic) {
    process.stdout.write("  辩题: ");
    topic = await new Promise<string>(r => {
      let buf = "";
      process.stdin.on("data", chunk => {
        buf += chunk.toString();
        if (buf.includes("\n")) r(buf.trim());
      });
    });
  }
  if (!topic) { console.error("  ❌ 议题不能为空."); return; }

  const minimaxKey = opts.key || process.env.MINIMAX_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  if (!minimaxKey) {
    console.error("  ❌ 需要 MiniMax key. 用 --key 或 export MINIMAX_KEY=sk-cp-...");
    return;
  }

  const stepTimeout = parseInt(opts["step-timeout"] || "360", 10) * 1000;
  const keep = args.includes("--keep");
  const quick = args.includes("--quick");
  const suffix = opts.suffix || Math.random().toString(16).slice(2, 6);
  const outPath = opts.out || `./debate-${topic.slice(0, 20).replace(/[^一-龥\w]/g, "-")}-${Date.now()}.md`;

  // Network selection: by default we create a dedicated network "debate-<suffix>"
  // for the run so the demo's 6 agents + tasks live in their own namespace and
  // are wiped together at cleanup. Pass --no-network to fall back to the
  // current/default network (legacy behavior), or --network <id> to use an
  // existing network you already created.
  const useDefaultNetwork = args.includes("--no-network");
  const explicitNetwork = opts.network || "";
  let networkId = "";
  let createdNetworkId = "";
  let networkLabel = "";

  if (explicitNetwork) {
    networkId = explicitNetwork;
    networkLabel = `(provided ${explicitNetwork.slice(0, 16)})`;
  } else if (useDefaultNetwork) {
    try {
      networkId = await resolvePrimaryNetwork(hub, authHeaders());
    } catch (e: any) {
      console.error(`  ❌ ${e?.message || "无法读取当前 network"}`);
      return;
    }
    networkLabel = `(current network)`;
  } else {
    const netName = `debate-${suffix}`;
    console.log(`  ⏳ 正在创建独立 network: ${netName}...`);
    try {
      const r = await fetch(`${hub}/api/networks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${gc.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: netName, description: `Auto-created for anet demo debate: ${topic.slice(0, 80)}` }),
      }).then(r => r.json() as any);
      if (!r?.ok || !r.network_id) {
        console.error(`  ❌ 创建 network 失败: ${r?.error || "unknown"}. 用 --no-network 退到 default 或 --network <id> 指定.`);
        return;
      }
      createdNetworkId = r.network_id;
      networkId = createdNetworkId;
      networkLabel = `(${netName} ${createdNetworkId.slice(0, 16)})`;
    } catch (e: any) {
      console.error(`  ❌ 创建 network 抛出异常: ${e.message}. 用 --no-network 退到 default.`);
      return;
    }
  }

  if (!networkId) {
    console.error("  ⚠️  没有 network_id — agent 可能拉不到任务.");
  }

  // Aliases used for this run (with suffix to avoid collision).
  const roleAliases: Record<string, string> = {};
  for (const r of DEBATE_ROLES) roleAliases[r] = `${r}-${suffix}`;

  console.log(`\n  🎙️  辩题: ${topic}`);
  console.log(`  📡 Hub:  ${hub}`);
  console.log(`  📂 Net:  ${networkLabel}`);
  console.log(`  🆔 Run:  ${suffix}\n`);

  // 1. Create + configure 6 agents
  // Switch the active network in ~/.anet/config.json to createdNetworkId so
  // createCommand provisions the 6 nodes inside the demo's dedicated network.
  // We restore the original network_id in a finally block below regardless of
  // success/failure so the user's CLI never gets stuck on the demo network.
  const origNetworkId = gc.network_id || "";
  const origNetworkName = gc.network_name || "";
  if (createdNetworkId) {
    saveGlobal({ ...gc, network_id: createdNetworkId, network_name: `debate-${suffix}` });
  } else if (explicitNetwork) {
    saveGlobal({ ...gc, network_id: explicitNetwork });
  }

  const restoreNetwork = () => {
    if (createdNetworkId || explicitNetwork) {
      try {
        const cur = loadGlobal();
        saveGlobal({ ...cur, network_id: origNetworkId || undefined, network_name: origNetworkName || undefined });
      } catch {}
    }
  };

  // Tell createCommand not to process.exit so we can call it 6 times
  process.env.ANET_INTERNAL_KEEP_PROCESS = "1";
  try {
    console.log(`  [1/4] 创建 6 个 agent (alias 后缀 -${suffix})...`);
    const nodesRoot = nodesDir();
    for (const role of DEBATE_ROLES) {
      const alias = roleAliases[role];
      if (!existsSync(join(nodesRoot, alias, "config.json"))) {
        const createArgs = ["create", alias,
          "--runtime", "claude-agent-sdk",
          "--model", "MiniMax-M2.7",
          "--env", `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`,
          "--env", `ANTHROPIC_AUTH_TOKEN=${minimaxKey}`,
          "--env", `ANTHROPIC_MODEL=MiniMax-M2.7`,
          // Force the dedicated demo network so createCommand doesn't prompt
          // "选择网络" once per agent — gc.network_id alone isn't enough,
          // createCommand only skips the picker when --network is explicit.
          ...(networkId ? ["--network", networkId] : []),
        ];
        args.length = 0; args.push(...createArgs);
        try { await createCommand(); } catch (e: any) {
          console.error(`     ❌ create ${alias}: ${e.message}`);
          restoreNetwork();
          delete process.env.ANET_INTERNAL_KEEP_PROCESS;
          return;
        }
      }
      // Inject systemPrompt for this role
      const cfgPath = join(nodesRoot, alias, "config.json");
      const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
      cfg.systemPrompt = DEBATE_PROMPTS[role](topic);
      atomicWritePrivateJson(cfgPath, cfg);
    }
    console.log(`        ✓ 创建/更新 6 个 agent`);
  } finally {
    restoreNetwork();
    delete process.env.ANET_INTERNAL_KEEP_PROCESS;
  }

  // 2. Start each in tmux
  console.log(`  [2/4] 启动 6 个 agent (tmux session)...`);
  for (const role of DEBATE_ROLES) {
    const alias = roleAliases[role];
    const sessName = `debate-${suffix}-${alias}`;
    killTmuxSession(sessName);
    try {
      startNodeTmuxSession(sessName, alias);
    } catch (e: any) {
      console.error(`     ❌ tmux ${alias}: ${e.message}`);
      return;
    }
  }

  // Wait until all 6 are SSE-connected
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      // #473: tristate — never GUESS from the aggregate count that these
      // specific aliases are up. "unknown" (non-admin/unreachable) → say
      // so and proceed, don't claim connected and don't burn the full 60s.
      const state = await sseAllConnected(hub, DEBATE_ROLES.map(r => roleAliases[r]));
      if (state === "yes") { console.log(`        ✓ 6 agent 全部 SSE connected`); break; }
      if (state === "unknown") { console.log(`        ⚠ 无法确认 6 个 agent 的 SSE 连接状态（需 admin 权限查看明细），继续执行`); break; }
    } catch {}
  }

  // 3. Drive the 8 (or 4 quick) steps
  type Speech = { header: string; speaker: string; alias: string; text: string };
  const transcript: Speech[] = [];

  async function postTask(alias: string, task: string): Promise<string> {
    const body = JSON.stringify({ alias, task, priority: "normal", network_id: networkId || undefined });
    const res = await fetch(`${hub}/api/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body,
    });
    const j: any = await res.json();
    if (!j?.ok) throw new Error(`postTask failed: ${JSON.stringify(j)}`);
    return j.message_id;
  }

  // Wait for a reply via /api/messages polling (looks for type='reply' with in_reply_to=msgId).
  async function waitReply(msgId: string, alias: string, timeoutMs: number): Promise<string> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const r = await fetch(`${hub}/api/messages?limit=200`, { headers: authHeaders() }).then(x => x.json() as any);
        const msg = (r?.messages || []).find((m: any) => m.from_alias === alias && m.type === "reply" && m.content);
        // /api/messages doesn't include in_reply_to in the SELECT yet, so we
        // match by recency + speaker. Since each step is sequential and we
        // only wait for one alias at a time, this is unambiguous.
        if (msg) {
          let text = msg.content as string;
          if (text.startsWith(`[${alias}]`)) text = text.slice(alias.length + 2).trimStart();
          return text;
        }
      } catch {}
    }
    throw new Error(`timeout waiting for ${alias} reply`);
  }

  async function step(stepNo: number, total: number, header: string, role: string, task: string): Promise<string> {
    const alias = roleAliases[role];
    process.stdout.write(`  [${stepNo}/${total}] ${header} (${alias}) ... `);
    const t0 = Date.now();
    const msgId = await postTask(alias, task);
    const reply = await waitReply(msgId, alias, stepTimeout);
    const dt = Math.round((Date.now() - t0) / 1000);
    console.log(`✓ ${dt}s, ${reply.length} 字`);
    transcript.push({ header, speaker: role, alias, text: reply });
    return reply;
  }

  console.log(`  [3/4] 驱动辩论流程 (${quick ? 4 : 9} 步)...`);
  try {
    if (quick) {
      const t = 4;
      await step(1, t, "开场", "主持人",
        `请你作为主持人,开场宣布以下辩题并介绍流程：\n议题：「${topic}」`);
      const pro = await step(2, t, "正方立论", "正方一辩", `议题:「${topic}」\n请发表立论,直接开始。`);
      const con = await step(3, t, "反方立论", "反方一辩",
        `议题:「${topic}」\n\n正方立论:\n---\n${pro}\n---\n\n请反方立论。`);
      const md = transcript.map(s => `## ${s.header} — ${s.speaker}\n\n${s.text}\n`).join("\n");
      await step(4, t, "评委判分", "评委",
        `议题:「${topic}」\n\n请根据完整辩论判分:\n\n${md}`);
    } else {
      const t = 9;
      await step(1, t, "开场", "主持人",
        `请你作为主持人,开场宣布以下辩题并介绍辩论流程:\n议题：「${topic}」`);
      const pro1 = await step(2, t, "正一立论", "正方一辩",
        `议题:「${topic}」\n你是正方一辩,请立论。`);
      const con1 = await step(3, t, "反一立论", "反方一辩",
        `议题:「${topic}」\n\n正方一辩立论:\n---\n${pro1}\n---\n\n你是反方一辩,请立论。`);
      const pro2 = await step(4, t, "正二质询", "正方二辩",
        `议题:「${topic}」\n\n反方一辩立论:\n---\n${con1}\n---\n\n你是正方二辩,请质询反方。`);
      const con2 = await step(5, t, "反二质询", "反方二辩",
        `议题:「${topic}」\n\n正方一辩立论:\n---\n${pro1}\n---\n\n你是反方二辩,请质询正方。`);
      const conS = await step(6, t, "反一总结", "反方一辩",
        `议题:「${topic}」\n你是反方一辩,请总结陈词。前面发言:\n[正一]\n${pro1}\n\n[反一(你)]\n${con1}\n\n[正二]\n${pro2}\n\n[反二]\n${con2}`);
      const proS = await step(7, t, "正一总结", "正方一辩",
        `议题:「${topic}」\n你是正方一辩,请总结陈词。完整辩论:\n[正一(你)]\n${pro1}\n\n[反一]\n${con1}\n\n[正二]\n${pro2}\n\n[反二]\n${con2}\n\n[反一总结]\n${conS}`);
      const md = transcript.map(s => `【${s.header}】${s.speaker}\n${s.text}`).join("\n\n");
      const verdict = await step(8, t, "评委判分", "评委",
        `议题:「${topic}」\n请根据完整辩论判分。完整实录:\n\n${md}`);
      await step(9, t, "闭幕", "主持人",
        `议题:「${topic}」\n\n评委已宣布:\n---\n${verdict}\n---\n\n请你做闭幕,回顾本场亮点 50-100 字。`);
    }
  } catch (e: any) {
    console.error(`\n  ❌ 流程失败: ${e.message}`);
    if (!keep) console.log(`  (--keep 未指定,稍后会清理 agent)`);
  }

  // 4. Output transcript
  console.log(`\n  [4/4] 写入实录: ${outPath}`);
  const md = [
    `# 辩论赛实录`,
    ``,
    `**议题**: ${topic}`,
    ``,
    `**时间**: ${new Date().toLocaleString()}`,
    ``,
    `**Run**: ${suffix}`,
    ``,
    ...transcript.flatMap(s => [`## ${s.header} — ${s.speaker}`, ``, s.text, ``]),
  ].join("\n");
  writeFileSync(outPath, md);
  console.log(`        ✓ ${md.length} 字写入 ${outPath}`);

  // Cleanup unless --keep
  if (!keep) {
    console.log(`\n  🧹 清理 6 个 agent (用 --keep 跳过)...`);
    for (const role of DEBATE_ROLES) {
      const alias = roleAliases[role];
      const sessName = `debate-${suffix}-${alias}`;
      killTmuxSession(sessName);
      args.length = 0; args.push("delete", alias, "--force");
      try { await deleteCommand(); } catch {}
    }
    if (createdNetworkId) {
      try {
        await fetch(`${hub}/api/networks/${createdNetworkId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${gc.token}` },
        });
        console.log(`        ✓ 删除独立 network (${createdNetworkId.slice(0, 16)})`);
      } catch (e: any) {
        console.log(`        ⚠ 删除 network 失败: ${e.message}. 手动: anet network delete ${createdNetworkId}`);
      }
    }
    console.log(`        ✓ 清理完成`);
  } else {
    console.log(`\n  📌 已保留 6 个 agent (alias 后缀 -${suffix})。手动清理:`);
    console.log(`     tmux kill-session -t debate-${suffix}-*`);
    console.log(`     anet node delete ${DEBATE_ROLES.map(r => `${r}-${suffix}`).join(" ")}`);
    if (createdNetworkId) {
      console.log(`     anet network delete ${createdNetworkId}`);
    }
  }

  console.log(`\n  🏁 完成！实录: ${outPath}\n`);
}

// ── demo: socialmedia ──
// 4-agent social media content factory: angle finder → copywriter →
// image art-director → reviewer. Drives the same step-by-step flow as
// debate but tuned for content production instead of argumentation.
// Default platform is xiaohongshu (small red book / "RED"); override
// with --platform twitter|wechat|linkedin.

const SOCIAL_ROLES = ["选题官", "文案官", "配图官", "审核官"] as const;

const PLATFORM_GUIDE: Record<string, string> = {
  xiaohongshu: "小红书 (RED): 标题钩子要狠，正文人称化，多 emoji 分隔，短段落，结尾互动引导，3-6 个 # 话题标签",
  twitter:     "Twitter / X: 280 字内单条主推 + 可选 1-3 条延展短回复 (thread)，钩子前置，1-2 个话题标签",
  wechat:      "微信公众号: 长文叙事，开头悬念，小标题分段，引用案例，结尾价值升华或互动 CTA",
  linkedin:    "LinkedIn: 专业第一人称叙述，行业洞察 + 数据，1-3 行短段落，结尾留思考问题，2-4 个话题标签",
};

const SOCIAL_PROMPTS: Record<string, (topic: string, platform: string) => string> = {
  "选题官": (topic, platform) => `你是社交媒体内容工厂的**选题官**，姓名"林若"。
任务：为话题「${topic}」在 ${platform} 平台上找 3 个不同的内容切入角度。
平台特点：${PLATFORM_GUIDE[platform] || PLATFORM_GUIDE.xiaohongshu}

收到任务时:
- 列出 3 个独立的内容 angle，每个 1 行 + 标注预估热度 (高/中/低) + 理由
- 然后明确推荐其中 1 个 (写"📌 推荐角度: <编号>") 给文案官
- 总长 200-350 字`,
  "文案官": (topic, platform) => `你是社交媒体内容工厂的**文案官**，姓名"陈夏"。
平台：${platform}
平台风格规则：${PLATFORM_GUIDE[platform] || PLATFORM_GUIDE.xiaohongshu}

收到任务时(附话题 + 选题官推荐角度):
- 严格按平台风格写一篇完整内容
- 含醒目标题 / 开头钩子 / 正文 / 结尾 CTA / 话题标签
- 长度按平台风格控制 (xiaohongshu 400-600 字 / twitter 单条 ≤280 字 + thread 0-3 条 / wechat 800-1500 字 / linkedin 300-500 字)
- 写完用三个 dash 分隔，最后给配图官一句话简介："📷 给配图官: <你想要的视觉画面 30 字内>"`,
  "配图官": (topic, platform) => `你是社交媒体内容工厂的**配图官**，姓名"白苏"。
不实际生图，只输出可直接给图像模型 (MidJourney / DALL-E / image-01 / 即梦) 用的 prompt。

收到任务时 (附完整文案):
- 给 3 张配图的英文 prompt (建议封面 1 + 正文配图 2)，每条 prompt 80-150 字符，含主体/构图/色调/风格关键词
- 中文一句话说明每张图的位置和作用
- 总长 250-400 字`,
  "审核官": (topic, platform) => `你是社交媒体内容工厂的**审核官**，姓名"周岩"。

收到任务 (附话题 + 文案 + 配图 prompts):
- 用 4 个维度评分 (0-10)：吸引力 / 平台适配性 / 合规风险 / 转发意愿
- 列 2-3 条具体修改建议
- 最后给"✅ 通过 / ⚠️ 修改后通过 / ❌ 重做"的明确判定 + 一句金句 reason
- 总长 250-400 字`,
};

const SOCIAL_PLATFORMS = ["xiaohongshu", "twitter", "wechat", "linkedin"] as const;

async function demoSocialMediaCommand() {
  const opts = parseOpts();
  const help = args.includes("--help") || args.includes("-h");
  if (help) {
    console.log(`
  anet demo socialmedia — 4-agent 社交媒体内容工厂

  Usage:
    anet demo socialmedia [--topic <主题>] [--platform xiaohongshu|twitter|wechat|linkedin] [--key <key>]

  Options:
    --topic <text>      内容主题 (默认交互输入)
    --platform <id>     目标平台 (默认 xiaohongshu)
    --key <key>         MiniMax API key (默认 \$MINIMAX_KEY)
    --out <path>        实录路径 (默认 ./social-<topic>-<ts>.md)
    --keep              跑完保留 4 个 agent + network
    --step-timeout <s>  每步超时秒数 (默认 360)
    --suffix <s>        alias 后缀 (默认随机 4 hex)
    --no-network        在 default network 跑 (默认建独立 demo-social-<suffix>)
    --network <id>      复用已有 network

  4 个角色:
    📌 选题官 林若 — 找 3 个 angle 推荐 1 个
    ✍️ 文案官 陈夏 — 按平台风格写完整内容
    📷 配图官 白苏 — 输出 3 条图像生成 prompt
    🔍 审核官 周岩 — 4 维度评分 + 修改建议 + 通过判定

  Examples:
    anet demo socialmedia --topic "Bun 1.3 新特性" --platform xiaohongshu
    anet demo socialmedia --topic "..." --platform twitter --key sk-cp-xxx
`);
    return;
  }

  const gc = loadGlobal();
  const hub = gc.hub;
  if (!hub) { console.error("  ❌ 没有 hub. 先 'anet init' 或 'anet hub start'."); return; }
  if (!gc.token) { console.error("  ❌ 没有 token. 先 'anet login'."); return; }

  let topic = opts.topic || "";
  if (!topic) {
    process.stdout.write("  主题: ");
    topic = await new Promise<string>(r => {
      let buf = "";
      process.stdin.on("data", chunk => {
        buf += chunk.toString();
        if (buf.includes("\n")) r(buf.trim());
      });
    });
  }
  if (!topic) { console.error("  ❌ 主题不能为空."); return; }

  const platform = (opts.platform || "xiaohongshu").toLowerCase();
  if (!SOCIAL_PLATFORMS.includes(platform as any)) {
    console.error(`  ❌ 平台 "${platform}" 不支持. 可选: ${SOCIAL_PLATFORMS.join(", ")}`);
    return;
  }

  const minimaxKey = opts.key || process.env.MINIMAX_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  if (!minimaxKey) {
    console.error("  ❌ 需要 MiniMax key. 用 --key 或 export MINIMAX_KEY=...");
    return;
  }

  const stepTimeout = parseInt(opts["step-timeout"] || "360", 10) * 1000;
  const keep = args.includes("--keep");
  const suffix = opts.suffix || Math.random().toString(16).slice(2, 6);
  const outPath = opts.out || `./social-${topic.slice(0, 20).replace(/[^一-龥\w]/g, "-")}-${Date.now()}.md`;

  const useDefaultNetwork = args.includes("--no-network");
  const explicitNetwork = opts.network || "";
  let networkId = "";
  let createdNetworkId = "";
  let networkLabel = "";

  if (explicitNetwork) {
    networkId = explicitNetwork;
    networkLabel = `(provided ${explicitNetwork.slice(0, 16)})`;
  } else if (useDefaultNetwork) {
    try {
      networkId = await resolvePrimaryNetwork(hub, authHeaders());
    } catch (e: any) {
      console.error(`  ❌ ${e?.message || "无法读取当前 network"}`);
      return;
    }
    networkLabel = `(current network)`;
  } else {
    const netName = `demo-social-${suffix}`;
    try {
      const r = await fetch(`${hub}/api/networks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${gc.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: netName, description: `Auto-created for anet demo socialmedia: ${topic.slice(0, 80)}` }),
      }).then(r => r.json() as any);
      if (!r?.ok || !r.network_id) {
        console.error(`  ❌ 创建 network 失败: ${r?.error || "unknown"}.`);
        return;
      }
      createdNetworkId = r.network_id;
      networkId = createdNetworkId;
      networkLabel = `(${netName} ${createdNetworkId.slice(0, 16)})`;
    } catch (e: any) {
      console.error(`  ❌ 创建 network 抛出异常: ${e.message}.`);
      return;
    }
  }

  const roleAliases: Record<string, string> = {};
  for (const r of SOCIAL_ROLES) roleAliases[r] = `${r}-${suffix}`;

  console.log(`\n  📱 主题: ${topic}`);
  console.log(`  🎯 平台: ${platform}`);
  console.log(`  📡 Hub:  ${hub}`);
  console.log(`  📂 Net:  ${networkLabel}`);
  console.log(`  🆔 Run:  ${suffix}\n`);

  const origNetworkId = gc.network_id || "";
  const origNetworkName = gc.network_name || "";
  if (createdNetworkId) {
    saveGlobal({ ...gc, network_id: createdNetworkId, network_name: `demo-social-${suffix}` });
  } else if (explicitNetwork) {
    saveGlobal({ ...gc, network_id: explicitNetwork });
  }
  let restoreNetwork = () => {
    if (createdNetworkId || explicitNetwork) {
      try {
        const cur = loadGlobal();
        saveGlobal({ ...cur, network_id: origNetworkId || undefined, network_name: origNetworkName || undefined });
      } catch {}
    }
  };

  process.env.ANET_INTERNAL_KEEP_PROCESS = "1";
  try {
    console.log(`  [1/3] 创建 4 个 agent (alias 后缀 -${suffix})...`);
    const nodesRoot = nodesDir();
    for (const role of SOCIAL_ROLES) {
      const alias = roleAliases[role];
      if (!existsSync(join(nodesRoot, alias, "config.json"))) {
        const createArgs = ["create", alias,
          "--runtime", "claude-agent-sdk",
          "--model", "MiniMax-M2.7",
          "--env", `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`,
          "--env", `ANTHROPIC_AUTH_TOKEN=${minimaxKey}`,
          "--env", `ANTHROPIC_MODEL=MiniMax-M2.7`,
          // Force the dedicated demo network so createCommand doesn't prompt
          // "选择网络" once per agent — gc.network_id alone isn't enough,
          // createCommand only skips the picker when --network is explicit.
          ...(networkId ? ["--network", networkId] : []),
        ];
        args.length = 0; args.push(...createArgs);
        try { await createCommand(); } catch (e: any) {
          console.error(`     ❌ create ${alias}: ${e.message}`);
          restoreNetwork();
          delete process.env.ANET_INTERNAL_KEEP_PROCESS;
          return;
        }
      }
      const cfgPath = join(nodesRoot, alias, "config.json");
      const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
      cfg.systemPrompt = SOCIAL_PROMPTS[role](topic, platform);
      atomicWritePrivateJson(cfgPath, cfg);
    }
    console.log(`        ✓ 4 个 agent 就位`);
  } finally {
    restoreNetwork();
    delete process.env.ANET_INTERNAL_KEEP_PROCESS;
  }

  console.log(`  [2/3] 启动 4 个 agent (tmux session)...`);
  for (const role of SOCIAL_ROLES) {
    const alias = roleAliases[role];
    const sessName = `social-${suffix}-${alias}`;
    killTmuxSession(sessName);
    try {
      startNodeTmuxSession(sessName, alias);
    } catch (e: any) {
      console.error(`     ❌ tmux ${alias}: ${e.message}`);
      return;
    }
  }

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const state = await sseAllConnected(hub, SOCIAL_ROLES.map(r => roleAliases[r]));
      if (state === "yes") { console.log(`        ✓ 4 agent 全部 SSE connected`); break; }
      if (state === "unknown") { console.log(`        ⚠ 无法确认 4 个 agent 的 SSE 连接状态（需 admin 权限查看明细），继续执行`); break; }
    } catch {}
  }

  type Speech = { header: string; speaker: string; alias: string; text: string };
  const transcript: Speech[] = [];

  async function postTask(alias: string, task: string): Promise<string> {
    const body = JSON.stringify({ alias, task, priority: "normal", network_id: networkId || undefined });
    const res = await fetch(`${hub}/api/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body,
    });
    const j: any = await res.json();
    if (!j?.ok) throw new Error(`postTask failed: ${JSON.stringify(j)}`);
    return j.message_id;
  }

  async function waitReply(_msgId: string, alias: string, timeoutMs: number): Promise<string> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const r = await fetch(`${hub}/api/messages?limit=200`, { headers: authHeaders() }).then(x => x.json() as any);
        const msg = (r?.messages || []).find((m: any) => m.from_alias === alias && m.type === "reply" && m.content);
        if (msg) {
          let text = msg.content as string;
          if (text.startsWith(`[${alias}]`)) text = text.slice(alias.length + 2).trimStart();
          return text;
        }
      } catch {}
    }
    throw new Error(`timeout waiting for ${alias} reply`);
  }

  async function step(stepNo: number, total: number, header: string, role: string, task: string): Promise<string> {
    const alias = roleAliases[role];
    process.stdout.write(`  [${stepNo}/${total}] ${header} (${alias}) ... `);
    const t0 = Date.now();
    const msgId = await postTask(alias, task);
    const reply = await waitReply(msgId, alias, stepTimeout);
    const dt = Math.round((Date.now() - t0) / 1000);
    console.log(`✓ ${dt}s, ${reply.length} 字`);
    transcript.push({ header, speaker: role, alias, text: reply });
    return reply;
  }

  console.log(`  [3/3] 内容生产 (4 步)...`);
  try {
    const total = 4;
    const angles = await step(1, total, "选题", "选题官",
      `请你为话题「${topic}」在 ${platform} 平台找 3 个内容切入角度，并明确推荐 1 个。`);
    const copy = await step(2, total, "文案", "文案官",
      `话题:「${topic}」\n平台: ${platform}\n选题官产出:\n---\n${angles}\n---\n按推荐角度写一篇完整内容。`);
    const imagery = await step(3, total, "配图", "配图官",
      `话题:「${topic}」\n平台: ${platform}\n文案:\n---\n${copy}\n---\n请给 3 条图像生成 prompt。`);
    const review = await step(4, total, "审核", "审核官",
      `话题:「${topic}」\n平台: ${platform}\n\n[文案]\n${copy}\n\n[配图 prompts]\n${imagery}\n\n请评分 + 修改建议 + 通过判定。`);
    void review;
  } catch (e: any) {
    console.error(`\n  ❌ 流程失败: ${e.message}`);
  }

  console.log(`\n  📝 写入实录: ${outPath}`);
  const md = [
    `# 社交媒体内容工厂实录`,
    ``,
    `**主题**: ${topic}`,
    ``,
    `**平台**: ${platform}`,
    ``,
    `**时间**: ${new Date().toLocaleString()}`,
    ``,
    `**Run**: ${suffix}`,
    ``,
    ...transcript.flatMap(s => [`## ${s.header} — ${s.speaker}`, ``, s.text, ``]),
  ].join("\n");
  writeFileSync(outPath, md);
  console.log(`        ✓ ${md.length} 字写入 ${outPath}`);

  if (!keep) {
    console.log(`\n  🧹 清理 4 个 agent...`);
    for (const role of SOCIAL_ROLES) {
      const alias = roleAliases[role];
      const sessName = `social-${suffix}-${alias}`;
      killTmuxSession(sessName);
      args.length = 0; args.push("delete", alias);
      try { await deleteCommand(); } catch {}
    }
    if (createdNetworkId) {
      try {
        await fetch(`${hub}/api/networks/${createdNetworkId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${gc.token}` },
        });
        console.log(`        ✓ 删除独立 network (${createdNetworkId.slice(0, 16)})`);
      } catch (e: any) {
        console.log(`        ⚠ 删除 network 失败: ${e.message}.`);
      }
    }
    console.log(`        ✓ 清理完成`);
  } else {
    console.log(`\n  📌 已保留 4 个 agent (alias 后缀 -${suffix})`);
    if (createdNetworkId) console.log(`     network: ${createdNetworkId}`);
  }

  console.log(`\n  🏁 完成！实录: ${outPath}\n`);
}

// ── demo: pr-review ──
// 4-agent PR review room: 3 reviewers (security / performance / style) fan-out
// in parallel from the CLI, then a judge consolidates their replies at a
// barrier. Output is a markdown PR review with a LGTM / Request Changes /
// Comment verdict. Spec: docs/demos/pr-review-room-proposal.md (refs #25).

const PR_REVIEW_ROLES = ["reviewer-security", "reviewer-performance", "reviewer-style", "judge"] as const;

const PR_REVIEW_PROMPTS: Record<string, () => string> = {
  "reviewer-security": () => `你是**安全审查员**，专注代码 diff 里的安全风险。

收到任务（附 PR diff）时:
- 检查这些维度: 注入 / 凭据泄露 / 权限绕过 / SSRF / 反序列化 / 命令注入 / 不安全反射 / 越权访问
- 每条 issue 输出格式: "- [严重度: 严重/中/低] file:line — 问题描述（一句话） — 建议改法"
- 没问题就写 "无安全问题。"
- 末尾另起一段写 "## 安全 issue 数: <N>"

要求:
- 只看 diff，不脑补 diff 外内容
- 不写客套话，不重复 reviewer 自我介绍
- 输出 markdown，250-500 字`,

  "reviewer-performance": () => `你是**性能审查员**，专注代码 diff 里的性能与资源使用问题。

收到任务（附 PR diff）时:
- 检查这些维度: N+1 查询 / O(n²) / 不必要 IO / 阻塞 await / 大对象 / 内存泄漏 / 锁粒度 / 缓存缺失
- 每条 issue 输出格式: "- [严重度: 严重/中/低] file:line — 问题描述（一句话） — 建议改法"
- 没问题就写 "无性能问题。"
- 末尾另起一段写 "## 性能 issue 数: <N>"

要求:
- 只看 diff，不脑补 diff 外内容
- 不写客套话，不重复 reviewer 自我介绍
- 输出 markdown，250-500 字`,

  "reviewer-style": () => `你是**代码风格审查员**，专注可读性与可维护性。

收到任务（附 PR diff）时:
- 检查这些维度: 命名 / 注释 / 抽象层级 / 死代码 / 复杂度 / 重复 / 类型签名
- 每条 issue 输出格式: "- [严重度: 严重/中/低] file:line — 问题描述（一句话） — 建议改法"
- 没问题就写 "无风格问题。"
- 末尾另起一段写 "## 风格 issue 数: <N>"

要求:
- 只看 diff，不脑补 diff 外内容
- 不写客套话，不重复 reviewer 自我介绍
- 输出 markdown，250-500 字`,

  "judge": () => `你是**终审 judge**，负责整合 3 份维度审查（安全/性能/风格）输出最终 PR review。

收到任务（附 PR diff 摘要 + 3 份 reviewer markdown）时:
- 先按 (file:line) 二元组去重重叠 issue
- 按严重度排序: 严重 > 中 > 低
- 输出一份最终 markdown:
  - 顶部一行 "**决议：** LGTM" 或 "**决议：** Request Changes" 或 "**决议：** Comment"
    - 任一 reviewer 报"严重"→ Request Changes
    - 全部 reviewer 0 issue → LGTM
    - 其它情况 → Comment
  - 第二行 "**统计：** 安全 N 处 / 性能 N 处 / 风格 N 处"
  - 然后三段 "## 安全" / "## 性能" / "## 风格"，每段列去重后的 issue
  - 最后一段 "## 终审说明" 用 100-200 字解释你判 LGTM / Request Changes / Comment 的核心理由

要求:
- 必须含 "**决议：**" 字段（CLI 用 regex 解析）
- 不重复 reviewer 原文，去重后呈现
- 输出 markdown，500-1200 字`,
};

// fetchPrDiff: 3 入口拿 PR diff
// - --diff <file>: local file readFileSync
// - --ref <ref>:   git diff <ref>..HEAD
// - --pr <url>:    gh CLI fallback (需要 user 装了 gh)
async function fetchPrDiff(opts: Record<string, string>): Promise<{ diff: string; source: string }> {
  if (opts.diff) {
    const p = opts.diff;
    if (!existsSync(p)) throw new Error(`--diff 文件不存在: ${p}`);
    return { diff: readFileSync(p, "utf-8"), source: `local file ${p}` };
  }
  if (opts.ref) {
    const ref = opts.ref;
    try {
      const out = execSync(`git diff ${ref}..HEAD`, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
      if (!out.trim()) throw new Error(`git diff ${ref}..HEAD 输出为空 (无 diff 或 ref 不存在)`);
      return { diff: out, source: `git diff ${ref}..HEAD` };
    } catch (e: any) {
      throw new Error(`git diff 失败: ${e.message}`);
    }
  }
  if (opts.pr) {
    // tier 2: gh CLI fallback
    try {
      execSync("command -v gh", { stdio: "ignore" });
    } catch {
      throw new Error(`--pr 需要本地装 gh CLI (https://cli.github.com)，或改用 --diff <file> / --ref <ref>`);
    }
    const url = opts.pr;
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) throw new Error(`--pr 不是合法 GitHub PR URL: ${url}`);
    const [, owner, repo, num] = m;
    try {
      const out = execSync(`gh api repos/${owner}/${repo}/pulls/${num} -H "Accept: application/vnd.github.v3.diff"`, {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
      return { diff: out, source: `${owner}/${repo}#${num} (gh api)` };
    } catch (e: any) {
      throw new Error(`gh api 拉 PR diff 失败: ${e.message}`);
    }
  }
  throw new Error(`需要 --diff <file> / --ref <ref> / --pr <github-url> 之一`);
}

type PrReviewSection = { role: string; alias: string; text: string; durationMs: number };

async function runPrReviewOrchestration(input: {
  diff: string;
  diffSource: string;
  diffKb: string;
  suffix: string;
  outPath: string;
  keep: boolean;
  roleAliases: Record<string, string>;
  invoke: (role: string, alias: string, prompt: string) => Promise<string>;
}): Promise<void> {
  const reviewerOutputs: PrReviewSection[] = [];
  let judgeOutput = "";
  const reviewerRoles = ["reviewer-security", "reviewer-performance", "reviewer-style"];
  const t0Run = Date.now();

  try {
    console.log(`  [3/6] 广播 review task 给 3 reviewer (parallel)...`);
    const reviewerTask = `请审查以下 diff（按你专精的维度）：\n\n\`\`\`diff\n${input.diff}\n\`\`\``;
    const t0Fanout = Date.now();
    const fanouts = reviewerRoles.map(async role => {
      const alias = input.roleAliases[role];
      const t0 = Date.now();
      const reply = await input.invoke(role, alias, reviewerTask);
      const dt = Date.now() - t0;
      console.log(`        ✓ ${padDisplayEnd(alias, 28)} ${Math.round(dt / 1000).toString().padStart(3)}s, ${reply.length} 字`);
      return { role, alias, text: reply, durationMs: dt };
    });
    const results = await Promise.all(fanouts);
    reviewerOutputs.push(...results);
    const fanoutDt = Date.now() - t0Fanout;
    const serialEstimate = results.reduce((sum, result) => sum + result.durationMs, 0);
    console.log(`        ─ 并行总耗时 ${Math.round(fanoutDt / 1000)}s (估串行 ${Math.round(serialEstimate / 1000)}s, 节省 ~${Math.max(0, Math.round((serialEstimate - fanoutDt) / 1000))}s)`);

    console.log(`  [4/6] barrier 收齐 3 份 review，整包派给 judge...`);
    const judgePackage = [
      `## diff 摘要`,
      `- 来源: ${input.diffSource}`,
      `- 大小: ${input.diffKb} KB`,
      ``,
      `## reviewer-security 输出`,
      reviewerOutputs.find(output => output.role === "reviewer-security")?.text || "(无)",
      ``,
      `## reviewer-performance 输出`,
      reviewerOutputs.find(output => output.role === "reviewer-performance")?.text || "(无)",
      ``,
      `## reviewer-style 输出`,
      reviewerOutputs.find(output => output.role === "reviewer-style")?.text || "(无)",
    ].join("\n");

    console.log(`  [5/6] judge 整合 + 终审...`);
    const judgeAlias = input.roleAliases.judge;
    const t0Judge = Date.now();
    judgeOutput = await input.invoke("judge", judgeAlias, `请整合三份 review 输出最终 PR review：\n\n${judgePackage}`);
    console.log(`        ✓ ${judgeAlias} ${Math.round((Date.now() - t0Judge) / 1000)}s, ${judgeOutput.length} 字`);
  } catch (error: any) {
    console.error(`\n  ❌ 流程失败: ${error.message}`);
    if (!input.keep) console.log(`     (--keep 未指定,稍后会清理 agent)`);
  }

  console.log(`  [6/6] 写入 review: ${input.outPath}`);
  const finalMd = [
    `# PR Review`,
    ``,
    `**来源**: ${input.diffSource}`,
    `**大小**: ${input.diffKb} KB`,
    `**时间**: ${new Date().toLocaleString()}`,
    `**Run**: ${input.suffix}`,
    `**总耗时**: ${Math.round((Date.now() - t0Run) / 1000)}s`,
    ``,
    judgeOutput || "(judge 没输出，看上面错误)",
    ``,
    `---`,
    `## 附：3 reviewer 原始输出`,
    ``,
    ...reviewerOutputs.flatMap(output => [
      `### ${output.role} (${output.alias}, ${Math.round(output.durationMs / 1000)}s)`,
      ``,
      output.text,
      ``,
    ]),
  ].join("\n");
  writeFileSync(input.outPath, finalMd);
  console.log(`        ✓ ${finalMd.length} 字写入 ${input.outPath}`);
}

async function demoPrReviewCommand() {
  const opts = parseOpts();
  const help = args.includes("--help") || args.includes("-h");
  if (help) {
    console.log(`
  anet demo pr-review — 代码 PR 审查室 demo (4 agent: 3 reviewer 并行 + judge)

  Usage:
    anet demo pr-review [--diff <file> | --ref <ref> | --pr <github-url>] \\
                        [--key <minimax-key>] [--out <path>] [--keep] \\
                        [--step-timeout <s>] [--suffix <s>] \\
                        [--no-network | --network <id>]

  Diff 入口 (三选一):
    --diff <file>     本地 .diff / .patch 文件
    --ref <ref>       'git diff <ref>..HEAD' 自动拿当前 branch 的 patch (e.g. --ref origin/main)
    --pr <url>        GitHub PR URL，用 gh CLI 拉 .diff (需本地装 gh)

  其它:
    --key <key>       MiniMax API key (默认 \$MINIMAX_KEY 或 \$ANTHROPIC_AUTH_TOKEN)
    --out <path>      评审输出 (默认 ./pr-review-<id>-<ts>.md)
    --keep            跑完不删 4 agent + network (默认会清掉)
    --step-timeout    单 reviewer/judge 超时秒数 (默认 180)
    --suffix          自定义 alias 后缀 (默认随机 4 hex)
    --no-network      跑在当前/default network 内
    --network <id>    指定已存在的 network

  测试专用:
    MOCK_LLM_REPLIES_FILE=<jsonl>  用确定性 fixture 替代 4 次 LLM 回复；不连接 Hub

  Examples:
    anet demo pr-review --diff ./my-pr.diff
    anet demo pr-review --ref origin/main
    anet demo pr-review --pr https://github.com/sleep2agi/agent-network/pull/40
    anet demo pr-review --diff ./my-pr.diff --keep --suffix demo01

  需要:
    - 已 anet login 到 hub
    - MiniMax key (Token Plan 至少有 MiniMax-M* 配额)
    - --pr 需要本地装 gh CLI (https://cli.github.com)

  完整 spec: docs/demos/pr-review-room-proposal.md
`);
    return;
  }

  // Explicit presence is the opt-in boundary. An unset variable must retain
  // the real Hub/agent/vendor path byte-for-byte; an explicitly empty value
  // is a malformed mock configuration and fails closed in the shared parser.
  const mockMode = Object.prototype.hasOwnProperty.call(process.env, "MOCK_LLM_REPLIES_FILE");
  const mockRepliesFile = process.env.MOCK_LLM_REPLIES_FILE ?? "";
  const gc = loadGlobal();
  const hub = gc.hub;
  if (!mockMode && !hub) { console.error("  ❌ 没有 hub. 先 'anet init' 或 'anet hub start'."); return; }
  if (!mockMode && !gc.token) { console.error("  ❌ 没有 token. 先 'anet login'."); return; }

  // 1. Resolve diff source
  let diff = "";
  let diffSource = "";
  try {
    const r = await fetchPrDiff(opts);
    diff = r.diff;
    diffSource = r.source;
  } catch (e: any) {
    console.error(`  ❌ ${e.message}`);
    return;
  }
  const diffBytes = Buffer.byteLength(diff, "utf-8");
  const diffKb = (diffBytes / 1024).toFixed(1);
  if (diffBytes > 30 * 1024) {
    console.log(`  ⚠️  diff 大小 ${diffKb} KB > 30 KB，可能超 model context。建议用 'gh api -X GET repos/.../files' 先筛关键文件。继续...`);
  }

  const minimaxKey = opts.key || process.env.MINIMAX_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
  if (!mockMode && !minimaxKey) {
    console.error("  ❌ 需要 MiniMax key. 用 --key 或 export MINIMAX_KEY=sk-cp-...");
    return;
  }

  const stepTimeout = parseInt(opts["step-timeout"] || "180", 10) * 1000;
  const keep = args.includes("--keep");
  const suffix = opts.suffix || Math.random().toString(16).slice(2, 6);
  const outPath = opts.out || `./pr-review-${suffix}-${Date.now()}.md`;
  const roleAliases: Record<string, string> = {};
  for (const role of PR_REVIEW_ROLES) roleAliases[role] = `${role}-${suffix}`;

  if (mockMode) {
    const rules = loadMockLlmRules(mockRepliesFile);
    console.log(`\n  🔍 PR diff: ${diffSource}`);
    console.log(`  📏 Size:   ${diffKb} KB`);
    console.log(`  🧪 Mock:   ${mockRepliesFile} (${rules.length} rules)`);
    console.log(`  🆔 Run:    ${suffix}\n`);
    console.log(`  [1/6] 使用确定性 mock LLM（不创建 agent）`);
    console.log(`  [2/6] 本地 mock ready`);
    await runPrReviewOrchestration({
      diff,
      diffSource,
      diffKb,
      suffix,
      outPath,
      keep: true,
      roleAliases,
      // The real path distinguishes reviewers with their per-node system
      // prompts. The deterministic path supplies the same role discriminator
      // directly to the stateless matcher.
      invoke: async (role, _alias, prompt) => resolveMockLlmReply(rules, `${role}\n${prompt}`).reply,
    });
    console.log(`\n  🏁 完成！review: ${outPath}\n`);
    return;
  }

  // Network selection: same convention as demo debate (default = create
  // dedicated `pr-review-<suffix>` network; --no-network = use default;
  // --network <id> = use given existing network).
  const useDefaultNetwork = args.includes("--no-network");
  const explicitNetwork = opts.network || "";
  let networkId = "";
  let createdNetworkId = "";
  let networkLabel = "";

  if (explicitNetwork) {
    networkId = explicitNetwork;
    networkLabel = `(provided ${explicitNetwork.slice(0, 16)})`;
  } else if (useDefaultNetwork) {
    try {
      networkId = await resolvePrimaryNetwork(hub, authHeaders());
    } catch (e: any) {
      console.error(`  ❌ ${e?.message || "无法读取当前 network"}`);
      return;
    }
    networkLabel = `(current network)`;
  } else {
    const netName = `pr-review-${suffix}`;
    console.log(`  ⏳ 正在创建独立 network: ${netName}...`);
    try {
      const r = await fetch(`${hub}/api/networks`, {
        method: "POST",
        headers: { Authorization: `Bearer ${gc.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: netName, description: `Auto-created for anet demo pr-review: ${diffSource}` }),
      }).then(r => r.json() as any);
      if (!r?.ok || !r.network_id) {
        console.error(`  ❌ 创建 network 失败: ${r?.error || "unknown"}. 用 --no-network 退到 default 或 --network <id> 指定.`);
        return;
      }
      createdNetworkId = r.network_id;
      networkId = createdNetworkId;
      networkLabel = `(${netName} ${createdNetworkId.slice(0, 16)})`;
    } catch (e: any) {
      console.error(`  ❌ 创建 network 抛出异常: ${e.message}.`);
      return;
    }
  }

  console.log(`\n  🔍 PR diff: ${diffSource}`);
  console.log(`  📏 Size:   ${diffKb} KB`);
  console.log(`  📡 Hub:    ${hub}`);
  console.log(`  📂 Net:    ${networkLabel}`);
  console.log(`  🆔 Run:    ${suffix}\n`);

  // 2. Create 4 agents
  const origNetworkId = gc.network_id || "";
  const origNetworkName = gc.network_name || "";
  if (createdNetworkId) {
    saveGlobal({ ...gc, network_id: createdNetworkId, network_name: `pr-review-${suffix}` });
  } else if (explicitNetwork) {
    saveGlobal({ ...gc, network_id: explicitNetwork });
  }
  const restoreNetwork = () => {
    if (createdNetworkId || explicitNetwork) {
      try {
        const cur = loadGlobal();
        saveGlobal({ ...cur, network_id: origNetworkId || undefined, network_name: origNetworkName || undefined });
      } catch {}
    }
  };

  process.env.ANET_INTERNAL_KEEP_PROCESS = "1";
  try {
    console.log(`  [1/6] 创建 4 个 agent (alias 后缀 -${suffix})...`);
    const nodesRoot = nodesDir();
    for (const role of PR_REVIEW_ROLES) {
      const alias = roleAliases[role];
      if (!existsSync(join(nodesRoot, alias, "config.json"))) {
        const createArgs = ["create", alias,
          "--runtime", "claude-agent-sdk",
          "--model", "MiniMax-M2.7",
          "--env", `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`,
          "--env", `ANTHROPIC_AUTH_TOKEN=${minimaxKey}`,
          "--env", `ANTHROPIC_MODEL=MiniMax-M2.7`,
          ...(networkId ? ["--network", networkId] : []),
        ];
        args.length = 0; args.push(...createArgs);
        try { await createCommand(); } catch (e: any) {
          console.error(`     ❌ create ${alias}: ${e.message}`);
          restoreNetwork();
          delete process.env.ANET_INTERNAL_KEEP_PROCESS;
          return;
        }
      }
      const cfgPath = join(nodesRoot, alias, "config.json");
      const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
      cfg.systemPrompt = PR_REVIEW_PROMPTS[role]();
      atomicWritePrivateJson(cfgPath, cfg);
    }
    console.log(`        ✓ 创建/更新 4 个 agent`);
  } finally {
    restoreNetwork();
    delete process.env.ANET_INTERNAL_KEEP_PROCESS;
  }

  // 3. Start each in tmux + wait SSE
  console.log(`  [2/6] 启动 4 个 agent (tmux session)...`);
  for (const role of PR_REVIEW_ROLES) {
    const alias = roleAliases[role];
    const sessName = `pr-review-${suffix}-${alias}`;
    killTmuxSession(sessName);
    try {
      startNodeTmuxSession(sessName, alias);
    } catch (e: any) {
      console.error(`     ❌ tmux ${alias}: ${e.message}`);
      return;
    }
  }
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const state = await sseAllConnected(hub, PR_REVIEW_ROLES.map(r => roleAliases[r]));
      if (state === "yes") { console.log(`        ✓ 4 agent 全部 SSE connected`); break; }
      if (state === "unknown") { console.log(`        ⚠ 无法确认 4 个 agent 的 SSE 连接状态（需 admin 权限查看明细），继续执行`); break; }
    } catch {}
  }

  // 4. Helpers: post task + wait reply
  async function postTask(alias: string, task: string): Promise<string> {
    const body = JSON.stringify({ alias, task, priority: "normal", network_id: networkId || undefined });
    const res = await fetch(`${hub}/api/task`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body,
    });
    const j: any = await res.json();
    if (!j?.ok) throw new Error(`postTask failed: ${JSON.stringify(j)}`);
    return j.message_id;
  }
  async function waitReply(_msgId: string, alias: string, timeoutMs: number): Promise<string> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const r = await fetch(`${hub}/api/messages?limit=200`, { headers: authHeaders() }).then(x => x.json() as any);
        const msg = (r?.messages || []).find((m: any) => m.from_alias === alias && m.type === "reply" && m.content);
        if (msg) {
          let text = msg.content as string;
          if (text.startsWith(`[${alias}]`)) text = text.slice(alias.length + 2).trimStart();
          return text;
        }
      } catch {}
    }
    throw new Error(`timeout waiting for ${alias} reply`);
  }

  await runPrReviewOrchestration({
    diff,
    diffSource,
    diffKb,
    suffix,
    outPath,
    keep,
    roleAliases,
    invoke: async (_role, alias, prompt) => {
      const msgId = await postTask(alias, prompt);
      return await waitReply(msgId, alias, stepTimeout);
    },
  });

  // 8. Cleanup unless --keep
  if (!keep) {
    console.log(`\n  🧹 清理 4 个 agent (用 --keep 跳过)...`);
    for (const role of PR_REVIEW_ROLES) {
      const alias = roleAliases[role];
      const sessName = `pr-review-${suffix}-${alias}`;
      killTmuxSession(sessName);
      args.length = 0; args.push("delete", alias, "--force");
      try { await deleteCommand(); } catch {}
    }
    if (createdNetworkId) {
      try {
        await fetch(`${hub}/api/networks/${createdNetworkId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${gc.token}` },
        });
        console.log(`        ✓ 删除独立 network (${createdNetworkId.slice(0, 16)})`);
      } catch (e: any) {
        console.log(`        ⚠ 删除 network 失败: ${e.message}. 手动: anet network delete ${createdNetworkId}`);
      }
    }
    console.log(`        ✓ 清理完成`);
  } else {
    console.log(`\n  📌 已保留 4 个 agent (alias 后缀 -${suffix})。手动清理:`);
    console.log(`     tmux kill-session -t pr-review-${suffix}-*`);
    console.log(`     anet node delete ${PR_REVIEW_ROLES.map(r => `${r}-${suffix}`).join(" ")}`);
    if (createdNetworkId) {
      console.log(`     anet network delete ${createdNetworkId}`);
    }
  }

  // Hint user how to use the output
  console.log(`\n  🏁 完成！review: ${outPath}`);
  console.log(`\n     下一步建议:`);
  console.log(`       1. 查看: less ${outPath}`);
  if (opts.pr) {
    const m = opts.pr.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (m) console.log(`       2. 贴到 GitHub PR: gh pr comment ${m[3]} --repo ${m[1]}/${m[2]} -F ${outPath}`);
  } else {
    console.log(`       2. 贴到 GitHub PR: gh pr comment <PR-N> --repo <owner>/<repo> -F ${outPath}`);
  }
  console.log();
}

// ── demo: sci-team ──
// Phase 1 scaffold per issue #51: batch-create N claude-agent-sdk agents
// (1 leader + N-1 workers) under a team directory, each in its own subdir
// with its own .anet/nodes/<alias>/config.json. Phase 1 wires up wizard +
// creation + launch + stop/restart/cleanup lifecycle. Leader fan-out and
// aggregation logic is deferred to Phase 2 (waiting on RFC-008) — the
// systemPrompts here are intentionally placeholders.
//
// Verified vendor values (per Vincent telegram 4227, commit 1bc03c0):
//   runtime: claude-agent-sdk   (#98 confirmed fully compatible with intern)
//   model:   intern-s1-pro
//   baseUrl: https://chat.intern-ai.org.cn   (bare hostname, no /anthropic)
//   token:   ANTHROPIC_AUTH_TOKEN injected from user-supplied Intern API key
//
// Note: each node lives under <dir>/node<i>, so we briefly process.chdir()
// before save so nodesDir()/saveProfile() drops files in the right place.
// The original cwd is always restored in a finally clause.

const SCI_TEAM_DIRECTIONS = [
  { value: "comprehensive", label: "全面 AI" },
  { value: "infra",         label: "AI Infra (训练 / 推理 / 部署)" },
  { value: "llm-arch",      label: "LLM 架构" },
  { value: "unified-gen",   label: "统一生成 (multi-modal)" },
  { value: "rlhf",          label: "RLHF / Alignment" },
  { value: "ai-safety",     label: "AI Safety" },
  { value: "custom",        label: "自定义 (wizard 再问主题)" },
];

function sciTeamPrompt(role: "leader" | "worker", index: number, teamSize: number, direction: string): string {
  if (role === "leader") {
    const workers = teamSize - 1;
    const workerList = Array.from({ length: workers }, (_, i) => `研究员${i + 1}号`).join(" / ");
    return [
      `你是科研军团的 leader (alias=研究Leader)，带 ${workers} 个研究员 (${workerList}) 协作完成 AI 综述。`,
      `主攻方向：${direction}。`,
      ``,
      `你的工具:`,
      `  - commhub_send_task(alias, task)        派 sub-task 给指定研究员`,
      `  - commhub_get_inbox(alias?, limit?)     查研究员的 reply`,
      `  - commhub_get_all_status()              看团队在线状态`,
      `  - commhub_send_reply(target, message)   回复用户`,
      ``,
      `接到用户任务后的工作流（自主决策，不是 echo 占位）:`,
      `  1. 分析任务 — 识别 AI sub-direction (e.g. Infra / LLM 架构 / 统一生成 / RLHF / AI Safety / Reasoning 等)，按方向切分子主题`,
      `  2. Fan-out — 用 commhub_send_task 把每个 sub-area 派给一个研究员 (可以 1 人 1 area，也可以 2-3 人协作 1 area)。每条 task 写清楚研究员该 cover 什么、输出格式要求`,
      `  3. 收集 reply — 通过 commhub_get_inbox 等研究员 reply (sub-area findings)；等齐才进下一步`,
      `  4. 整合 — dedup + 按 sub-area 排序，出最终 markdown 综述，再 commhub_send_reply 给用户`,
      ``,
      `你是真在做研究 + 协作，**不是** echo 占位。Sub-direction 切分 + fan-out + aggregate 全部自主决策。`,
    ].join("\n");
  }
  return [
    `你是科研军团研究员 ${index} 号 (alias=研究员${index}号)，向 leader (研究Leader) 汇报。`,
    `团队主攻方向：${direction}。`,
    ``,
    `收到 leader 派的 sub-task 后，独立完成调研：`,
    `  1. 调研指定 AI sub-area (优先用 WebSearch 拿最新 trends / papers，结合你自己的 AI knowledge)`,
    `  2. 出 ~300-500 字 sub-area summary，markdown 格式，含: key insights / 代表性 papers 或 systems / open problems / 跟其它 sub-area 的边界`,
    `  3. 用 commhub_send_task 把 summary 当 task content reply 给 leader (alias=研究Leader)`,
    ``,
    `要真做调研 + 出有信息密度的 summary，**不是** echo 占位。`,
  ].join("\n");
}

async function demoSciTeamCommand() {
  const opts = parseOpts();
  const help = args.includes("--help") || args.includes("-h");
  if (help) {
    console.log(`
  anet demo sci-team — Phase 1 scaffold: batch-create N 研究 agent (1 leader + N-1 worker)

  Usage:
    anet demo sci-team [--count N] [--dir <path>] [--intern-api <key>] [--direction <key>]
    anet demo sci-team --stop      # kill 所有 sci-team tmux session
    anet demo sci-team --restart   # --stop 然后 hint 重跑创建
    anet demo sci-team --cleanup   # --stop + 删 node 子目录 + rm -rf 工作目录

  Wizard fields (任一可用 --flag 跳过 prompt):
    --intern-api <key>   书生 API key (Anthropic-compatible Intern)
    --count <N>          军团人数 (5-50, 默认 10)
    --dir <path>         工作目录 (默认 ~/intern-s)
    --direction <key>    综述方向 (comprehensive/infra/llm-arch/unified-gen/rlhf/ai-safety/custom)

  Vendor values (Vincent verified per commit 1bc03c0):
    runtime  = claude-agent-sdk   (#98 confirmed fully compatible with intern)
    model    = intern-s1-pro
    baseUrl  = https://chat.intern-ai.org.cn   (no /anthropic suffix)
    token    = \$ANTHROPIC_AUTH_TOKEN (= 你的 Intern API key)

  Phase 1 scope (scaffold only):
    - Wizard + 批量 mkdir <dir>/node1..nodeN (每个 node 独立 cwd)
    - 每个 node 写 config.json + Intern preset + placeholder systemPrompt
    - Auto register/login (default admin/anethub if no token) + ntok_ per alias
    - Launch all nodes via tmux

  Phase 2+ defer:
    - Leader 智能 fan-out / sub-area assignment / aggregate 综述 (待 RFC-008)
    - Dashboard team 聚合视图 (issue #50)
    - 真实学术 systemPrompts

  Spec: issue #51
`);
    return;
  }

  // ── Lifecycle flags first (so --stop/--cleanup don't trigger wizard) ──
  const isStop    = args.includes("--stop");
  const isRestart = args.includes("--restart");
  const isCleanup = args.includes("--cleanup");
  const lifecycleDir = opts.dir || join(home, "intern-s");
  if (isStop || isRestart || isCleanup) {
    const flag = isStop ? "--stop" : isRestart ? "--restart" : "--cleanup";
    const verb = isStop ? "stop" : isRestart ? "restart" : "cleanup";
    console.warn(`[deprecated] 'anet demo sci-team ${flag}' is deprecated; use 'anet batch ${verb} sci-team' (will remove in next major).`);
    return sciTeamLifecycle({ dir: lifecycleDir, restart: isRestart, cleanup: isCleanup });
  }

  // ── Wizard prompts ──
  const gc = loadGlobal();
  if (!gc.hub) {
    console.error("[anet] 未找到 CommHub Server。先运行 'anet hub start' 或 'anet init --hub <url>'");
    return;
  }

  const internApiKey = opts["intern-api"] || opts["api-key"] || process.env.INTERN_API_KEY || await ask("书生 (Intern) API key");
  if (!internApiKey) {
    closeRL();
    console.error("[anet] 需要 Intern API key. 申请页: https://chat.intern-ai.org.cn/");
    return;
  }

  const countStr = opts.count || await ask("军团人数 (5-50)", "10");
  const countRaw = parseInt(countStr, 10);
  const count = Math.max(5, Math.min(50, Number.isFinite(countRaw) ? countRaw : 10));
  if (count !== countRaw) {
    console.log(`  [anet] 人数 ${countRaw} → 钳到合法区间 [5,50] = ${count}`);
  }

  const targetDir = opts.dir || await ask("工作目录", join(home, "intern-s"));

  let direction = opts.direction || "";
  if (!direction) {
    direction = await askChoice("综述方向", SCI_TEAM_DIRECTIONS.map(d => ({ label: d.label, value: d.value })));
  }
  if (direction === "custom") {
    direction = await ask("自定义方向 (一句话描述)", "通用研究");
  }
  closeRL();

  // ── Auto register/login (default admin/anethub) ──
  if (!gc.token || !gc.user) {
    console.log(`\n[anet] 没有 user token，自动用 default admin/anethub 登录...`);
    const loginRes = await fetch(`${gc.hub}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "anethub" }),
    }).then(r => r.json() as any).catch(() => null);
    if (!loginRes?.ok) {
      console.error(`[anet] 自动登录失败: ${loginRes?.error || "unknown"}. 先 'anet register' 创账号。`);
      return;
    }
    gc.token = loginRes.token;
    gc.user = loginRes.user;
    const nets = await fetch(`${gc.hub}/api/networks`, { headers: { Authorization: `Bearer ${loginRes.token}` } }).then(r => r.json() as any).catch(() => ({ networks: [] }));
    if (nets.networks?.length > 0) {
      gc.network_id = nets.networks[0].network_id;
      gc.network_name = nets.networks[0].network_name;
    }
    saveGlobal(gc);
    console.log(`        ✓ 登录: ${loginRes.user.username}`);
  }

  // ── Plan + create ──
  console.log(`\n[anet] 创建科研军团:`);
  console.log(`        工作目录:  ${targetDir}`);
  console.log(`        节点数:    ${count} (1 leader + ${count - 1} worker)`);
  console.log(`        综述方向:  ${direction}`);
  console.log(`        Runtime:   claude-agent-sdk + intern-s1-pro\n`);

  // sci-team is now a preset wrapper over the generic batch primitive
  // (issue #55). The Intern URL + model + active-fan-out sciTeamPrompt
  // template all stay locked here; createBatch handles the per-node
  // mkdir + ensureNodeToken + saveProfile + tmux launch loop.
  const result = await createBatch({
    prefix: "研究员",
    count,
    workdir: targetDir,
    workdirMode: "separate",
    runtime: "claude-agent-sdk",
    model: "intern-s1-pro",
    baseUrl: "https://chat.intern-ai.org.cn",
    apiKey: internApiKey,
    systemPrompt: (role, index, total) => sciTeamPrompt(role, index, total, direction),
    team: "sci-team",
    leaderAlias: "研究Leader",
  });

  if (result.createdAliases.length === 0) {
    console.error("\n[anet] 没有任何 node 创建成功，退出。");
    return;
  }

  console.log(`\n[anet] 🏁 科研军团 ready.`);
  console.log(`        Dashboard:    anet hub dashboard  (or open ${gc.hub.replace(":9200", ":3000")})`);
  console.log(`        派任务:       commhub_send_task --alias 研究Leader --task "<研究 prompt>"`);
  console.log(`        Phase 1 note: leader 只是 placeholder echo, RFC-008 Phase 2 接入智能 fan-out`);
  console.log(`        Stop:         anet batch stop sci-team`);
  console.log(`        Cleanup:      anet batch cleanup sci-team --workdir ${targetDir}`);
  console.log();
}

// Wrapper preserved for the `anet demo sci-team --stop|--restart|--cleanup`
// flag path (deprecated, see warning in demoSciTeamCommand). New users should
// use `anet batch <verb> sci-team` (the canonical lifecycle command). The
// implementation now delegates to batchLifecycle() so behavior stays in sync.
function sciTeamLifecycle(opts: { dir: string; restart: boolean; cleanup: boolean }) {
  const { dir, restart, cleanup } = opts;
  if (restart) {
    return batchLifecycle({ prefix: "sci-team", verb: "restart", workdir: dir });
  }
  if (cleanup) {
    return batchLifecycle({ prefix: "sci-team", verb: "cleanup", workdir: dir });
  }
  return batchLifecycle({ prefix: "sci-team", verb: "stop", workdir: dir });
}

// ── Batch primitive (issue #55) ──
//
// `createBatch` is the generic N-node spawn primitive that both
// `anet create --batch` (user-facing wizard) and `anet demo sci-team`
// (preset wrapper) call into. It abstracts the pattern PR #53 first wired
// up for sci-team: per-node mkdir + Profile build + ensureNodeToken +
// saveProfile + tmux session launch, with the original cwd restored in a
// finally block.
//
// Vendor presets must stay in sync with the Vincent-verified list at
// cli.ts L1116+ (1bc03c0 chain): adding a new preset here requires a
// real end-to-end API call against the vendor — do not copy parameters
// from another vendor's preset.

interface BatchOptions {
  prefix: string;                // alias 前缀, e.g. "工程师" → 工程师1号..工程师N号
  count: number;                 // node 数 (caller pre-clamps to spec range)
  workdir: string;               // 父目录 (absolute path), e.g. /home/u/anet-team
  workdirMode: "separate" | "shared";  // separate: workdir/node{i}/.anet/nodes/<alias>  | shared: workdir/.anet/nodes/<alias>
  runtime: string;               // claude-agent-sdk / codex-sdk / claude-code-cli
  model?: string;                // e.g. intern-s1-pro / MiniMax-M2.7 / claude-sonnet-4-6
  baseUrl?: string;              // ANTHROPIC_BASE_URL value (omit for Anthropic native)
  apiKey?: string;               // ANTHROPIC_AUTH_TOKEN value (or runtime-specific token)
  authTokenEnvName?: string;     // env var name for the auth token (default ANTHROPIC_AUTH_TOKEN)
  systemPrompt?: string | ((role: "leader" | "worker", index: number, total: number) => string);
  team?: string;                 // profile.team field + tmux session prefix (defaults to prefix)
  leaderAlias?: string;          // 设了 → i=1 = leader role with this alias; i>1 = `${prefix}${i-1}号` worker. 没设 → all i = `${prefix}${i}号` workers.
  printSummary?: boolean;        // default true
  noYolo?: boolean;              // #156 — opt out of codex-sdk yolo flags (CI / scripted use). default false (yolo on, matches single-node).
}

interface BatchResult {
  workdir: string;
  createdAliases: string[];
  failedAliases: string[];
  tmuxPrefix: string;            // for downstream lifecycle ops
}

function batchAliasFor(opts: BatchOptions, i: number): { alias: string; role: "leader" | "worker"; workerIndex: number } {
  if (opts.leaderAlias && i === 1) {
    return { alias: opts.leaderAlias, role: "leader", workerIndex: 0 };
  }
  const workerIndex = opts.leaderAlias ? i - 1 : i;
  return { alias: `${opts.prefix}${workerIndex}号`, role: "worker", workerIndex };
}

function batchNodeDirFor(opts: BatchOptions, i: number): string {
  return opts.workdirMode === "separate" ? join(opts.workdir, `node${i}`) : opts.workdir;
}

async function createBatch(opts: BatchOptions): Promise<BatchResult> {
  // Validate every user-controllable string that lands in a filesystem path
  // or a tmux session name. Single-node createCommand calls validateNodeName
  // for the same reason (cli.ts:1233, also :1079); without it here a
  // `--prefix '../bad'` would escape `.anet/nodes/` via saveProfile()'s
  // `join(nodesDir(), id, "config.json")` write — caught by 通信牛 review of PR #60.
  if (!opts.prefix || opts.prefix.length === 0) {
    console.error("Error: batch prefix is required (got empty).");
    process.exit(1);
  }
  validateNodeName(opts.prefix);
  if (opts.team) validateNodeName(opts.team);
  if (opts.leaderAlias) {
    if (opts.leaderAlias.length === 0) {
      console.error("Error: --leader-alias is empty; pass a name or drop the flag.");
      process.exit(1);
    }
    validateNodeName(opts.leaderAlias);
  }

  // #178 — normalize once, before the loop changes process.cwd(). A literal
  // wizard value such as `~/design` is not expanded by Node; if left relative,
  // every process.chdir() iteration nests another `~/design` segment.
  opts = { ...opts, workdir: normalizeBatchWorkdir(opts.workdir) };

  const tmuxPrefix = opts.team || opts.prefix;
  const gc = loadGlobal();
  mkdirSync(opts.workdir, { recursive: true });
  const origCwd = process.cwd();
  const created: string[] = [];
  const failed: string[] = [];

  try {
    for (let i = 1; i <= opts.count; i++) {
      const { alias, role, workerIndex } = batchAliasFor(opts, i);
      // Defense-in-depth: the prefix/leaderAlias entry-level validation above
      // should already guarantee a safe alias here, but re-check so a bug in
      // batchAliasFor() can never silently escape `.anet/nodes/`.
      validateNodeName(alias);
      const nodeDir = batchNodeDirFor(opts, i);
      mkdirSync(nodeDir, { recursive: true });
      process.chdir(nodeDir);

      const envMap: Record<string, string> = {};
      if (opts.baseUrl) envMap.ANTHROPIC_BASE_URL = opts.baseUrl;
      if (opts.apiKey) envMap[opts.authTokenEnvName || "ANTHROPIC_AUTH_TOKEN"] = opts.apiKey;

      // #93 — per-node identity. The function form (sci-team) already bakes the
      // alias into its template; a plain string --description is shared by every
      // node and carries no identity, so prepend `你是 <alias>。` — without it
      // agent-node's own `你是 ${ALIAS}` fallback is suppressed (it only fires
      // when systemPrompt is absent) and every node thinks it is <prefix>1号.
      // No description → leave undefined so that agent-node fallback still fires.
      let promptText: string | undefined;
      if (typeof opts.systemPrompt === "function") {
        promptText = opts.systemPrompt(role, workerIndex, opts.count);
      } else if (opts.systemPrompt) {
        promptText = `你是 ${alias}。\n\n${opts.systemPrompt}`;
      }

      const nodeId = generateNodeId();
      const profile: Profile = {
        anet_version: "0.1.0",
        node_id: nodeId,
        node_name: alias,
        alias,
        runtime: opts.runtime,
        ...grokBuildCliCreationFields(opts.runtime, nodeId),
        ...(opts.model ? { model: opts.model } : {}),
        ...(gc.network_id ? { network_id: gc.network_id } : {}),
        channels: ["server:commhub"],
        env: envMap,
        flags: {
          dangerouslySkipPermissions: opts.runtime === "grok-build-cli" ? false : true,
          // #156 (Vincent 5531) — same codex-sdk yolo posture as single-node
          // (createProfileFromOpts). Helper is the source of truth, shared
          // between the two paths to prevent the v0.10.6 1/4-vs-4/4 drift.
          ...(opts.runtime === "codex-sdk" ? codexSdkYoloFlags(opts.noYolo) : {}),
        },
        ...(promptText ? { systemPrompt: promptText } : {}),
        ...(opts.team ? { team: opts.team } : {}),
        ...(opts.leaderAlias ? { role } : {}),
      };

      try {
        await ensureNodeToken(profile, alias);
      } catch (e: any) {
        console.error(`        ❌ ${padDisplayEnd(alias, 14)} ntok_ 请求失败: ${e.message}`);
        failed.push(alias);
        continue;
      }
      saveProfile(alias, profile);
      created.push(alias);
      if (opts.printSummary !== false) {
        const roleTag = opts.leaderAlias ? ` (${role.padEnd(7)})` : "";
        console.log(`        ✓ ${padDisplayEnd(alias, 14)}${roleTag}  ${nodeDir}`);
      }
    }
  } finally {
    process.chdir(origCwd);
  }

  // Launch via tmux. We launch in a second pass so a partial config failure
  // doesn't leave half-started tmux sessions running with no config.
  if (created.length > 0) {
    if (opts.printSummary !== false) {
      console.log(`\n[anet] 启动 ${created.length} 个 tmux session...`);
    }
    try {
      for (let idx = 0; idx < created.length; idx++) {
        const alias = created[idx];
        // Map created[idx] back to its original i — index in `created` may be
        // gappy if some entries went into `failed`. We track that by scanning.
        // For workdir-separate mode we need the matching nodeK dir.
        let nodeI = -1;
        for (let i = 1; i <= opts.count; i++) {
          if (batchAliasFor(opts, i).alias === alias) { nodeI = i; break; }
        }
        const nodeDir = nodeI > 0 ? batchNodeDirFor(opts, nodeI) : opts.workdir;
        const sessName = `${tmuxPrefix}-${alias}`;
        killTmuxSession(sessName);
        try {
          process.chdir(nodeDir);
          startNodeTmuxSession(sessName, alias);
          if (opts.printSummary !== false) console.log(`        ✓ ${sessName}`);
        } catch (e: any) {
          console.error(`        ❌ tmux ${alias}: ${e.message}`);
        }
      }
    } finally {
      process.chdir(origCwd);
    }
  }

  return { workdir: opts.workdir, createdAliases: created, failedAliases: failed, tmuxPrefix };
}

// Batch lifecycle (issue #55 #6 "能够 restart all" + extended verbs):
//   - start    re-launch tmux for all `${prefix}-*` configs (skips already-running)
//   - stop     kill any tmux session matching `${prefix}-*`
//   - restart  stop + start (best-effort; relies on saved .anet/nodes/ configs)
//   - cleanup  stop + rm -rf <workdir>/node*  + remove empty <workdir>
//   - list     enumerate distinct `<prefix>` groups currently active in tmux

function batchLifecycle(opts: { prefix: string; verb: "start" | "stop" | "restart" | "cleanup" | "list"; workdir?: string }) {
  const { prefix, verb, workdir } = opts;

  if (verb === "list") {
    let sessions: string[] = [];
    try {
      const out = execSync("tmux list-sessions -F '#{session_name}' 2>/dev/null || true", { encoding: "utf-8" });
      sessions = out.split("\n").filter(s => s && s.includes("-"));
    } catch {}
    const groups = new Map<string, string[]>();
    for (const sess of sessions) {
      const idx = sess.indexOf("-");
      const p = sess.slice(0, idx);
      const alias = sess.slice(idx + 1);
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p)!.push(alias);
    }
    if (groups.size === 0) {
      console.log("[anet] No batch tmux sessions found.");
      return;
    }
    console.log(`[anet] Active batch groups (${groups.size}):`);
    for (const [p, aliases] of groups) {
      console.log(`  ${p.padEnd(20)} (${aliases.length} node)`);
      for (const a of aliases.slice(0, 5)) console.log(`    - ${a}`);
      if (aliases.length > 5) console.log(`    ... +${aliases.length - 5} more`);
    }
    return;
  }

  // stop/restart/cleanup share a "kill matching tmux sessions" pass.
  let killedCount = 0;
  try {
    const out = execSync("tmux list-sessions -F '#{session_name}' 2>/dev/null || true", { encoding: "utf-8" });
    const sessions = out.split("\n").filter(s => s.startsWith(`${prefix}-`));
    for (const sess of sessions) {
      killTmuxSession(sess);
      killedCount++;
    }
  } catch {}
  console.log(`[anet] killed ${killedCount} tmux session(s) matching ${prefix}-*`);

  if (verb === "stop") return;

  if (verb === "cleanup") {
    if (!workdir) {
      console.error("[anet] cleanup 需要 --workdir <path> 指明清理目录。");
      return;
    }
    // Use the same one-time expansion as createBatch. Besides matching create,
    // this prevents cleanup from treating a literal `~/...` as cwd-relative.
    const dir = normalizeBatchWorkdir(workdir);
    if (!existsSync(dir)) {
      console.error(`[anet] 工作目录不存在: ${dir}`);
      return;
    }
    const subdirs = readdirSync(dir).filter(name => name.startsWith("node") && statSync(join(dir, name)).isDirectory());
    for (const sub of subdirs) {
      rmSync(join(dir, sub), { recursive: true, force: true });
    }
    try {
      const remaining = readdirSync(dir);
      if (remaining.length === 0) rmSync(dir, { recursive: true, force: true });
    } catch {}
    console.log(`[anet] 清理完成: ${dir}`);
    // Phase 1 limitation: cleanup only handles `--workdir-mode separate` (each
    // node has its own `<workdir>/node{i}/.anet/nodes/...` tree). For
    // `--workdir-mode shared`, configs live under `<workdir>/.anet/nodes/${prefix}*号`
    // and need a manual `rm -rf` (no registry yet to know which aliases this
    // batch owns vs. other batches that may share the same dir). Phase 2 will
    // add a `~/.anet/batches.json` marker registry to make shared-mode cleanup
    // safe; until then surfacing the gap loudly per 通信牛 PR #60 review.
    if (subdirs.length === 0 && existsSync(join(dir, ".anet", "nodes"))) {
      console.warn(`[anet] ⚠ shared workdir-mode 限制: no node*/ subdirs to remove. Configs under`);
      console.warn(`        ${join(dir, ".anet", "nodes")}/${prefix}*号/  remain on disk. Phase 1 cleanup`);
      console.warn(`        only handles separate workdir-mode. Manual: rm -rf '${join(dir, ".anet", "nodes")}'/${prefix}*号`);
    }
    return;
  }

  if (verb === "restart" || verb === "start") {
    // Phase 1: restart/start in-place is not yet wired (would need to walk
    // saved .anet/nodes/<alias>/config.json under <workdir>/node*/ and
    // re-launch tmux). For now, hint the user to re-run the create wizard.
    console.log(`[anet] '${verb}' in-place not yet implemented (Phase 1 scaffold). Re-run:`);
    console.log(`         anet create --batch    # generic`);
    console.log(`         anet demo sci-team     # sci-team preset`);
    return;
  }
}

// ── batch wizard (anet create --batch) ──
//
// Vendor/model selection is the unified VENDORS registry + selectVendorAndModel()
// (issue #104-B). The old BATCH_PRESETS array was removed in B3 — createBatchWizardCommand
// now uses findVendorByModel() for --preset back-compat and selectVendorAndModel()
// for the interactive path.

async function createBatchWizardCommand() {
  const opts = parseOpts();
  const help = args.includes("--help") || args.includes("-h");
  if (help) {
    console.log(`
  anet create --batch — 批量创建 N 个 agent (issue #55)

  Usage:
    anet create --batch [--preset <key>] [--api-key <key>] [--workdir <path>]
                        [--workdir-mode separate|shared] [--prefix <name>]
                        [--count <N>] [--description <text>]
                        [--leader-alias <name>]

  Wizard fields (任一可用 --flag 跳过):
    --preset <key>        intern-s2-preview (默认) / intern-s1-pro / MiniMax-M2.7 /
                          mimo-v2.5-pro / claude-sonnet-4-6 / claude-opus-4-6 /
                          claude-haiku-4-5 / __custom__
    --api-key <key>       runtime auth token (ANTHROPIC_AUTH_TOKEN or 等价)
    --workdir <path>      父目录, default ~/anet-team
    --workdir-mode        separate (default, <workdir>/node{i}) | shared (单 dir)
    --prefix <name>       alias 前缀, e.g. 工程师 → 工程师1号..工程师N号
    --count <N>           1-50
    --description <text>  systemPrompt 内容 (空 → no systemPrompt)
    --leader-alias <name> 设了 → i=1 = leader with this alias, i>1 workers

  Lifecycle (issue #55 #6 "能够 restart all"):
    anet batch start  <prefix>   # launch (Phase 1: hint re-run create)
    anet batch stop   <prefix>   # kill all matching tmux
    anet batch list              # all active batch groups
    anet batch cleanup <prefix> [--workdir <path>]   # stop + rm -rf <workdir>/node*/
    anet batch restart <prefix>  # stop + start (Phase 1 hint)

  Phase 1 cleanup limitation: only --workdir-mode separate is fully cleaned
  (rm <workdir>/node*). For --workdir-mode shared, configs at
  <workdir>/.anet/nodes/<prefix>*号/ stay on disk — manual rm needed
  (registry-based safe cleanup is Phase 2).

  Vendor presets are Vincent-verified (commit 1bc03c0). For codex / other
  vendors not yet verified, use --preset __custom__ and paste your own
  runtime / baseUrl / model values.

  Spec: issue #55 / RFC-008 (multi-agent team convention)
`);
    return;
  }

  const gc = loadGlobal();
  if (!gc.hub) {
    console.error("[anet] 未找到 CommHub Server。先运行 'anet hub start' 或 'anet init --hub <url>'");
    return;
  }

  // 1. Vendor + model (vendor-first, #104-B B2.3)
  //
  // --preset back-compat (通信龙 decision): old --preset values are model ids
  // (intern-s1-pro / MiniMax-M2.7 / mimo-v2.5-pro / claude-sonnet-4-6 / ...) or
  // "__custom__". findVendorByModel maps a model id → its vendor;
  // resolveVendorSelection covers the case where someone passes a vendor key.
  let runtime: string;
  let model: string | undefined;
  let baseUrl: string | undefined;
  let presetLabel: string;
  // #153 (Vincent 5481) — capture vendor.requiresAuth so the batch wizard
  // can skip the ANTHROPIC_AUTH_TOKEN prompt for vendors that already login
  // through their own CLI (codex / claude-code-cli). For __custom__ runtime,
  // derive requiresAuth from the runtime choice.
  let requiresAuth: ReusedLogin | undefined;
  if (opts.preset === "__custom__") {
    const customRuntime = await ask("Runtime (claude-agent-sdk / codex-sdk / claude-code-cli)", "claude-agent-sdk");
    const customCanonical = runtimeForExecution(customRuntime, "create batch nodes");
    runtime = customCanonical;
    baseUrl = (await ask("ANTHROPIC_BASE_URL (空白=Anthropic default)", "")) || undefined;
    model = (await ask("Model id", "")) || undefined;
    presetLabel = `custom (${runtime}${model ? " + " + model : ""})`;
    // 🔴 这里曾经又手写了一遍 runtime → 登录 的映射（只覆盖 codex-sdk 与
    //    claude-code-cli），于是 grok / codex-app-server 走到这条路径时被当成
    //    「需要 API key」。改为问单一来源；不在表里的 runtime 返回 undefined，
    //    含义仍然是「走 API key」，与原行为一致。
    requiresAuth = reusedLoginFor(customCanonical);
  } else if (opts.preset) {
    const sel = findVendorByModel(opts.preset) || resolveVendorSelection(opts.preset);
    if (!sel) {
      closeRL();
      console.error(`[anet] Unknown --preset: ${opts.preset}. 见 --help 的 vendor / model 列表。`);
      return;
    }
    runtime = sel.runtime; model = sel.model; baseUrl = sel.baseUrl;
    requiresAuth = sel.requiresAuth;
    presetLabel = `${sel.vendorKey}${model ? " + " + model : ""}`;
  } else {
    const sel = await selectVendorAndModel();
    if (!sel) {
      closeRL();
      // 原文案无条件推荐 --preset,但 --preset 只能选到 VENDORS 表里的运行时;
      // 对 opencode-cli / grok-build-* / codex-app-server,--preset **永远无解**,
      // 照着提示反复试是走不通的(#765)。所以把另一条真正可用的路一起给出来。
      console.error(`[anet] vendor selector 不可用（非交互终端？）。`);
      console.error(`[anet]   预设运行时(claude-agent-sdk / claude-code-cli / codex-sdk):用 --preset <model-id>`);
      console.error(`[anet]   其它运行时(opencode-cli / grok-build-acp / grok-build-cli / codex-app-server):`);
      console.error(`[anet]     去掉 --batch,用 anet node create <name> --runtime <runtime>`);
      return;
    }
    runtime = sel.runtime; model = sel.model; baseUrl = sel.baseUrl;
    requiresAuth = sel.requiresAuth;
    presetLabel = `${sel.vendorKey}${model ? " + " + model : ""}`;
  }

  // 2. API key — #153 (Vincent 5481): vendors with their own CLI login flow
  // (codex / claude-code-cli) don't need an ANTHROPIC_AUTH_TOKEN. Skip the
  // prompt and print a hint that the user should run the vendor's own login.
  let apiKey: string | undefined;
  if (requiresAuth === "codex") {
    console.log("  [anet] codex-sdk — will reuse `codex login` state (no API key needed)");
    console.log("         If not logged in: run `codex login` in a separate terminal first.");
    apiKey = undefined;
  } else if (requiresAuth === "claude") {
    console.log("  [anet] claude-code-cli — will reuse `claude` CLI / subscription (no API key needed)");
    console.log("         If not logged in: run `claude` once in a separate terminal to sign in.");
    apiKey = undefined;
  } else {
    apiKey = opts["api-key"] || opts.key || process.env.ANET_BATCH_API_KEY || await ask("API key (ANTHROPIC_AUTH_TOKEN)");
    if (!apiKey) {
      closeRL();
      console.error("[anet] API key required.");
      return;
    }
  }

  // 3. Workdir
  const workdir = opts.workdir || await ask("Workdir", join(home, "anet-team"));
  // #152 (Vincent 5477+5478) — `--workdir-mode` CLI flag already supported
  // (separate / shared), but the interactive wizard never asked. Now it does:
  // explicit prompt with inquirer select when the flag isn't pre-set.
  let workdirMode: "separate" | "shared";
  if (opts["workdir-mode"]) {
    workdirMode = opts["workdir-mode"] as "separate" | "shared";
    if (workdirMode !== "separate" && workdirMode !== "shared") {
      closeRL();
      console.error(`[anet] --workdir-mode must be 'separate' or 'shared', got: ${workdirMode}`);
      return;
    }
  } else {
    try {
      const { select: sel } = await import("@inquirer/prompts");
      workdirMode = await sel({
        message: "工作目录模式 (Workdir mode):",
        choices: [
          { value: "separate" as const, name: `separate — 每节点独立子目录 (${workdir}/node1, ${workdir}/node2, ...)` },
          { value: "shared"   as const, name: `shared   — 全部共享同一目录 (${workdir} 一个 .anet/nodes/, 所有 agent 同 cwd)` },
        ],
        default: "separate",
      }) as "separate" | "shared";
    } catch {
      // Non-TTY / inquirer missing → keep existing default.
      console.log(`[anet] ⚠ Workdir mode selector unavailable — defaulting to 'separate' (use --workdir-mode shared to opt in)`);
      workdirMode = "separate";
    }
  }

  // 4. Prefix + count — #155 (Vincent 5493 hit wizard exit here)
  //
  // After the inquirer select() prompt for workdir mode (above), @inquirer/
  // prompts leaves process.stdin in a state where the readline-based ask()
  // returns immediately at EOF and the process silently exits — the EXACT
  // same #137 (preview.5) pattern. The fix is to use inquirer input() for
  // all post-select prompts so stdin handling stays uniform with the select
  // that came before.
  let prefix: string;
  let countStr: string;
  let description: string;
  try {
    const { input: inquirerInput } = await import("@inquirer/prompts");
    prefix = opts.prefix || (await inquirerInput({
      message: "Node prefix (e.g. 工程师)",
      default: "工程师",
    })).trim() || "工程师";
    countStr = opts.count || (await inquirerInput({
      message: "Count (1-50)",
      default: "5",
    })).trim() || "5";
    // 5. Description (systemPrompt)
    // parseOpts maps a valueless/empty `--description` (e.g. `--description ""`)
    // to the sentinel string "true"; treat that as "not provided" (#93).
    const descFlag = opts.description === "true" ? "" : opts.description;
    description = descFlag || (await inquirerInput({
      message: "Description / system prompt (空 → no prompt)",
      default: "",
    })).trim();
  } catch {
    // Non-TTY / inquirer unavailable — fall back to legacy readline ask().
    prefix = opts.prefix || await ask("Node prefix (e.g. 工程师)", "工程师");
    countStr = opts.count || await ask("Count (1-50)", "5");
    const descFlag = opts.description === "true" ? "" : opts.description;
    description = descFlag || await ask("Description / system prompt (空 → no prompt)", "");
  }
  const countRaw = parseInt(countStr, 10);
  const count = Math.max(1, Math.min(50, Number.isFinite(countRaw) ? countRaw : 5));
  if (count !== countRaw) {
    console.log(`  [anet] Count ${countRaw} → clamped to [1,50] = ${count}`);
  }
  if (count > 20) {
    console.warn(`  [anet] Warning: count=${count} > 20 may exceed memory/ulimit on a developer laptop. Recommended ≤ 20 unless tested.`);
  }

  const leaderAlias = opts["leader-alias"] || "";
  closeRL();

  // Auto-login if no user token (same admin/anethub pattern as demo sci-team)
  if (!gc.token || !gc.user) {
    console.log(`\n[anet] 没有 user token，自动用 default admin/anethub 登录...`);
    const loginRes = await fetch(`${gc.hub}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "anethub" }),
    }).then(r => r.json() as any).catch(() => null);
    if (!loginRes?.ok) {
      console.error(`[anet] 自动登录失败: ${loginRes?.error || "unknown"}. 先 'anet register' 创账号。`);
      return;
    }
    gc.token = loginRes.token;
    gc.user = loginRes.user;
    const nets = await fetch(`${gc.hub}/api/networks`, { headers: { Authorization: `Bearer ${loginRes.token}` } }).then(r => r.json() as any).catch(() => ({ networks: [] }));
    if (nets.networks?.length > 0) {
      gc.network_id = nets.networks[0].network_id;
      gc.network_name = nets.networks[0].network_name;
    }
    saveGlobal(gc);
    console.log(`        ✓ 登录: ${loginRes.user.username}`);
  }

  console.log(`\n[anet] Creating batch '${prefix}' × ${count} in ${workdir}/...`);
  console.log(`        Preset:        ${presetLabel}`);
  console.log(`        Workdir mode:  ${workdirMode}`);
  if (leaderAlias) console.log(`        Leader alias:  ${leaderAlias}`);
  console.log();

  const result = await createBatch({
    prefix,
    count,
    workdir,
    workdirMode,
    runtime,
    model,
    baseUrl,
    apiKey,
    systemPrompt: description || undefined,
    leaderAlias: leaderAlias || undefined,
    noYolo: opts["no-yolo"] === "true",  // #156 — propagate opt-out to batch path
  });

  if (result.createdAliases.length === 0) {
    console.error(`\n[anet] No nodes created.`);
    return;
  }
  console.log(`\n[anet] 🏁 Batch '${prefix}' ready. ${result.createdAliases.length} node launched.`);
  if (result.failedAliases.length > 0) {
    console.log(`        ⚠ ${result.failedAliases.length} 失败: ${result.failedAliases.join(", ")}`);
  }
  console.log(`        Stop:    anet batch stop ${result.tmuxPrefix}`);
  console.log(`        List:    anet batch list`);
  console.log(`        Cleanup: anet batch cleanup ${result.tmuxPrefix} --workdir ${workdir}`);
  console.log();
}

// ── batch top-level subcommand: anet batch <verb> ──

async function batchCommand() {
  const sub = args[1];
  if (!sub || sub === "-h" || sub === "--help" || sub.startsWith("-")) {
    console.log(`
  anet batch <verb> <prefix>                # batch lifecycle ops (issue #55)

  Verbs:
    start <prefix>                        re-launch (Phase 1: hint re-run create)
    stop <prefix>                         kill all tmux matching <prefix>-*
    restart <prefix>                      stop + start
    cleanup <prefix> --workdir <path>     stop + rm -rf <workdir>/node*/
                                          (shared workdir-mode leaves configs
                                          under <workdir>/.anet/nodes/; needs
                                          manual rm — registry is Phase 2)
    list                                  list all active batch groups
                                          (Phase 1: also catches non-anet tmux
                                          sessions whose names contain '-')

  See also: anet create --batch  (batch create wizard)
`);
    return;
  }
  const verb = sub;
  const validVerbs = ["start", "stop", "restart", "cleanup", "list"] as const;
  if (!(validVerbs as readonly string[]).includes(verb)) {
    console.error(`[anet] Unknown batch verb '${verb}'. Valid: ${validVerbs.join(" / ")}`);
    return;
  }

  if (verb === "list") {
    return batchLifecycle({ prefix: "", verb: "list" });
  }

  const prefix = args[2];
  if (!prefix) {
    console.error(`[anet] Usage: anet batch ${verb} <prefix>`);
    return;
  }
  const opts = parseOpts();
  const workdir = opts.workdir;
  return batchLifecycle({ prefix, verb: verb as "start" | "stop" | "restart" | "cleanup", workdir });
}


// ── config show ──

function configShowCommand() {
  const gc = loadGlobal();
  const configPath = join(home, ".anet", "config.json");

  console.log(`\n  anet config (${configPath})\n`);
  console.log(`  hub:          ${gc.hub || "(not set — run: anet init)"}`);
  console.log(`  token:        ${gc.token ? gc.token.slice(0, 12) + "..." : "(not set — run: anet login)"}`);
  console.log(`  user:         ${gc.user?.username || "(not logged in)"}`);
  console.log(`  network_id:   ${gc.network_id || "(none — run: anet network use)"}`);
  console.log(`  network_name: ${gc.network_name || "(none)"}`);

  // Show node count
  const nd = nodesDir();
  let nodeCount = 0;
  try { nodeCount = readdirSync(nd).filter(d => existsSync(join(nd, d, "config.json"))).length; } catch {}
  console.log(`\n  nodes:        ${nodeCount} in .anet/nodes/`);

  const sub = args[1];
  if (sub === "path") {
    console.log(`\n  ${configPath}`);
  } else if (sub === "json") {
    console.log(`\n${JSON.stringify(gc, null, 2)}`);
  } else {
    console.log(`\n  Subcommands:`);
    console.log(`    anet config          Show config summary`);
    console.log(`    anet config path     Print config file path`);
    console.log(`    anet config json     Print raw JSON`);
  }
  console.log();
}

// ── info ──

async function infoCommand() {
  const ref = args[1];
  if (!ref) { console.log("\nanet info <node-name>   Detailed node information\n"); return; }
  const resolved = resolveNodeRef(ref);
  if (!resolved) { console.error(nodeNotFound(ref)); process.exit(1); }
  const { id: nodeId, profile } = resolved;
  const displayName = nodeDisplayName(nodeId, profile);

  console.log(`\n  Node: ${displayName}`);
  console.log(`  ──────────────────────────────────`);
  console.log(`  node_id:  ${profile.node_id || "-"}`);
  console.log(`  runtime:  ${normalizeRuntime(profile)}`);
  console.log(`  model:    ${profile.model || "(default)"}`);
  console.log(`  hub:      ${profile.hub || loadGlobal().hub || "-"}`);
  console.log(`  channels: ${profile.channels?.join(", ") || "(none)"}`);
  // Co-presence reduces config to one of two runtime-owned process profiles;
  // pinned Grok ignores a general --tools allowlist in interactive TUI mode.
  const toolsArr = Array.isArray(profile.tools) ? profile.tools : [];
  const requestedTools = toolsArr.length ? `[${toolsArr.join(", ")}]` : "all (Claude Code preset)";
  const grokCopresenceXSearch = profile.grokCopresence === true
    && toolsArr.length === 1 && toolsArr[0] === "WebSearch";
  console.log(`  tools:    ${profile.grokCopresence === true
    ? grokCopresenceXSearch
      ? "fixed x-search profile [todo_write,search_tool,use_tool,web_search] (general web; no web-fetch/filesystem/shell/media/subagents)"
      : "fixed commhub-only profile [todo_write,search_tool,use_tool] (no filesystem/shell/web/media/subagents)"
    : requestedTools}`);
  // Flags worth surfacing — dangerouslySkipPermissions is the one most likely
  // to surprise users in retrospect, so list it first.
  const flags = (profile as any).flags || {};
  const flagBits = [
    `dangerouslySkipPermissions=${flags.dangerouslySkipPermissions === false ? "false" : "true"}`,
    flags.teammateMode ? "teammateMode" : null,
  ].filter(Boolean);
  console.log(`  flags:    ${flagBits.join(", ")}`);
  console.log(`  config:   .anet/nodes/${nodeId}/config.json`);

  // PID check
  const pidFile = join(nodesDir(), nodeId, ".pid");
  let alive = false;
  if (existsSync(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
    try { process.kill(pid, 0); alive = true; } catch {}
    console.log(`  pid:      ${pid} ${alive ? "● running" : "✕ stopped"}`);
  } else {
    console.log(`  pid:      (not running)`);
  }

  // Server status
  const gc = loadGlobal();
  if (gc.hub) {
    try {
      const status = await fetch(`${gc.hub}/api/status`, { headers: authHeaders() }).then(r => r.json() as any);
      const session = status.sessions?.find((s: any) => s.alias === displayName || s.node_id === profile.node_id);
      if (session) {
        console.log(`\n  Server Status:`);
        console.log(`    status:   ${session.status}`);
        console.log(`    task:     ${(session.task || "-").slice(0, 60)}`);
        console.log(`    updated:  ${formatHubTime(session.updated_at)}`);
      } else {
        console.log(`\n  Server: not registered`);
      }
    } catch {}

    // Recent tasks
    try {
      const tasks = await fetch(`${gc.hub}/api/tasks?to_name=${encodeURIComponent(displayName)}&limit=3`, { headers: authHeaders() }).then(r => r.json() as any);
      if (tasks.tasks?.length > 0) {
        console.log(`\n  Recent Tasks:`);
        for (const t of tasks.tasks) {
          console.log(`    ${t.status.padEnd(10)} ${padDisplayEnd(String(t.from_name || "?"), 12)} ${oneLineCell(t.content, 40)}`);
        }
      }
    } catch {}
  }

  // Logs
  const logDir = join(nodesDir(), nodeId, "logs");
  if (existsSync(logDir)) {
    const files = readdirSync(logDir).filter(f => f.endsWith(".log")).sort().reverse();
    if (files.length > 0) console.log(`\n  Logs: ${files.length} file(s), latest: ${files[0]}`);
  }

  console.log();
}

// ── migrate-token-to-envref (issue #125) ──
//
// Convert plain-secret env values in a node's config.json to the envRef shape
// (`{ "_envRef": "<NAME>" }`) so secrets stop persisting on disk. Backward
// compat: agent-node runtime accepts both shapes; existing plain configs keep
// working until the user migrates.
async function migrateTokenToEnvRefCommand() {
  const ref = args[1];
  if (!ref) {
    console.log(`\nanet node migrate-token-to-envref <node-name>`);
    console.log(`\n  Convert plain-secret env values in this node's config.json to envRef shape.`);
    console.log(`  Secrets persist in process.env only; config.json holds the env-var name.\n`);
    return;
  }
  const resolved = resolveNodeRef(ref);
  if (!resolved) { console.error(nodeNotFound(ref)); process.exit(1); }
  const { id: nodeId, profile } = resolved;
  const envMap: any = profile.env;
  if (!envMap || typeof envMap !== "object") {
    console.log(`[anet] Node "${nodeId}" has no env map — nothing to migrate.`);
    return;
  }

  // Same regex pair the runtime (#125) and `anet doctor` (#125) use.
  const SECRET_KEY_RX = /(_TOKEN|_KEY|_SECRET|AUTH)$/i;
  const SECRET_VAL_RX = /^(sk-|utok_|ntok_|atok_|ak-|gsk_|key-|Bearer\s)/i;
  const candidates: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(envMap)) {
    if (typeof v !== "string") continue; // already envRef object
    if (SECRET_KEY_RX.test(k) || SECRET_VAL_RX.test(v)) {
      candidates.push({ key: k, value: v });
    }
  }
  if (candidates.length === 0) {
    console.log(`[anet] Node "${nodeId}" — no plain-secret env values detected. Nothing to migrate.`);
    return;
  }

  // Derive a safe env-var name: <KEY>_<NODE_ID_SUFFIX>. node_id is ASCII;
  // alias may include CJK which is allowed in process.env on most shells but
  // breaks `export NAME=...` interpolation. Pick the ASCII path.
  const nodeIdShort = (profile.node_id || nodeId).replace(/[^A-Za-z0-9_]/g, "_").slice(0, 16);
  const newEnv: any = { ...envMap };
  const assignmentLines: string[] = [];
  for (const { key, value } of candidates) {
    const refName = `${key}_${nodeIdShort}`.toUpperCase();
    newEnv[key] = { _envRef: refName };
    assignmentLines.push(formatSecretAssignment(process.platform, refName, value));
  }

  // Backup the original config before overwriting, so users can revert.
  const cfgPath = join(nodesDir(), nodeId, "config.json");
  if (!existsSync(cfgPath)) {
    console.error(`[anet] Node "${nodeId}" config not found at ${cfgPath}`);
    process.exit(1);
  }
  const bakPath = `${cfgPath}.bak-${Date.now()}`;
  try {
    atomicWritePrivateFile(bakPath, readFileSync(cfgPath, "utf-8"));
  } catch (e: any) {
    console.error(`[anet] Failed to write backup ${bakPath}: ${e.message}`);
    process.exit(1);
  }

  // Persist the migrated env map. We rewrite the whole profile to preserve
  // every other field (the canonical writer is `saveProfile()`).
  const newProfile: any = { ...profile, env: newEnv };
  saveProfile(nodeId, newProfile);

  console.log(`\n[anet] ✅ Migrated ${candidates.length} env value(s) in node "${nodeId}":`);
  for (const { key } of candidates) console.log(`         env.${key} → { _envRef: "${key}_${nodeIdShort}".toUpperCase() }`);
  console.log(`[anet]    Backup written: ${bakPath}\n`);
  console.log(`[anet] 🔑 Now ${secretShellAction(process.platform)} the secret values in your shell BEFORE starting this node:`);
  console.log("");
  for (const line of assignmentLines) console.log(`    ${line}`);
  console.log("");
  console.log(`[anet]    (${secretPersistenceHeading(process.platform)})`);
  console.log(`[anet]    The agent-node runtime will refuse to start if any referenced var is unset.`);
  console.log(`[anet]    Restart the node: anet node start ${nodeId}\n`);
}

// ── license ──

async function licenseCommand() {
  // #214 P2.8 — Agent Network is open source under Apache-2.0. Earlier
  // versions of this command printed a hub-reported "license type"
  // (PRO/STARTER/EXPIRED) and per-tier soft limits, which conflicted with
  // the actual OSS reality and misled users into thinking this was
  // commercial software. New shape: lead with the truth, then surface any
  // self-hosted hub's license info as a secondary, opt-in detail.
  console.log(`
  License: Apache-2.0 (open source)
  Source:  https://github.com/sleep2agi/agent-network
  Docs:    https://anet.sh/

  Agent Network is fully open source. No commercial tier, no usage limits
  enforced by the CLI, no telemetry.
`);

  const gc = loadGlobal();
  if (!gc.hub) {
    console.log(`  (no hub configured — run 'anet init' to set one if you want hub-side license info)\n`);
    return;
  }
  try {
    const res = await fetch(`${gc.hub}/api/license`, { headers: authHeaders() }).then(r => r.json() as any);
    if (res && res.ok && res.license) {
      const lic = res.license;
      const lim = res.limits;
      console.log(`  Hub (${gc.hub}) license info:`);
      console.log(`    Type:    ${String(lic.type || "?").toUpperCase()}`);
      if (lic.expires_at) console.log(`    Expires: ${lic.expires_at}${lic.expired ? " (EXPIRED)" : ""}`);
      if (lim) console.log(`    Soft limits: agents=${lim.max_agents}, networks=${lim.max_networks}, tasks/day=${lim.max_tasks_day}`);
      console.log(`  (Self-hosted hub license data — informational only; the OSS code itself is unrestricted.)\n`);
    } else {
      console.log(`  (hub does not report license info)\n`);
    }
  } catch {
    console.log(`  (hub unreachable — check 'anet doctor' if you expected hub-side license info)\n`);
  }
}

async function activateCommand() {
  const gc = loadGlobal();
  const hub = gc.hub;
  if (!hub) { console.error("Run 'anet init' first."); return; }

  const key = args[1];
  if (!key) {
    console.log("\nUsage: anet activate <license-key>\n\nExample: anet activate anet-XXXX-XXXX-XXXX-XXXX\n");
    return;
  }

  try {
    const res = await fetch(`${hub}/api/license/activate`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    }).then(r => r.json() as any);

    if (res.ok) {
      console.log(`\n  ✅ License activated: ${res.type.toUpperCase()}`);
      console.log(`  Valid for ${res.expires_in_days} days\n`);
    } else {
      console.error(`  ❌ Activation failed: ${res.error}\n`);
    }
  } catch (e: any) { console.error(friendlyError(e)); }
}

// ── doctor (diagnostic) ──

// Auto-detect node config issues a fix run can repair. Returns a list of
// human-readable problems plus actionable migrations.
type NodeIssue =
  | { kind: "legacy_alias_field"; from: string; to: string }
  | { kind: "legacy_resume_field" }
  | { kind: "legacy_runtime_name"; from: string }
  | { kind: "stale_dev_hub"; current: string }
  | { kind: "missing_token" }
  | { kind: "user_token"; prefix: string }
  | { kind: "untyped_token"; preview: string }
  | { kind: "missing_node_id" };

function diagnoseNode(id: string): { raw: Record<string, any>; issues: NodeIssue[] } | null {
  const p = join(nodesDir(), id, "config.json");
  if (!existsSync(p)) return null;
  let raw: Record<string, any>;
  try { raw = JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
  const gc = loadGlobal();
  const issues: NodeIssue[] = [];
  if (raw.alias && !raw.name && !raw.node_name) issues.push({ kind: "legacy_alias_field", from: "alias", to: "name" });
  if (raw.resume && !raw.session) issues.push({ kind: "legacy_resume_field" });
  if (raw.runtime === "claude-code") issues.push({ kind: "legacy_runtime_name", from: raw.runtime });
  // Known stale dev IPs that pre-V3 docs leaked into node configs. Treat any
  // non-empty hub != global hub as suspect when the global one is set.
  const STALE_HUBS = ["http://47.77.216.1:9200"];
  if (raw.hub && (STALE_HUBS.includes(raw.hub) || (gc.hub && raw.hub !== gc.hub))) {
    issues.push({ kind: "stale_dev_hub", current: raw.hub });
  }
  const rawToken = String(raw.token || "");
  if (!rawToken) issues.push({ kind: "missing_token" });
  else if (rawToken.startsWith("utok_") || rawToken.startsWith("atok_")) {
    issues.push({ kind: "user_token", prefix: rawToken.slice(0, 4) });
  } else if (!rawToken.startsWith("ntok_")) {
    issues.push({ kind: "untyped_token", preview: String(raw.token).slice(0, 8) + "…" });
  }
  if (!raw.node_id) issues.push({ kind: "missing_node_id" });
  return { raw, issues };
}

async function migrateNode(id: string, opts: { hub: string; utok: string; networkId: string }): Promise<{ ok: boolean; changes: string[]; error?: string }> {
  const p = join(nodesDir(), id, "config.json");
  const diag = diagnoseNode(id);
  if (!diag) return { ok: false, changes: [], error: "diagnose failed" };
  const { raw, issues } = diag;
  if (!issues.length) return { ok: true, changes: [] };

  const changes: string[] = [];
  // Field renames
  if (raw.alias && !raw.name) { raw.name = raw.alias; delete raw.alias; changes.push("alias→name"); }
  if (raw.resume && !raw.session) { raw.session = raw.resume; delete raw.resume; changes.push("resume→session"); }
  if (raw.runtime === "claude-code") { raw.runtime = "claude-code-cli"; changes.push("runtime claude-code→claude-code-cli"); }
  // Stale hub URL → use global hub
  if (raw.hub && opts.hub && raw.hub !== opts.hub) {
    const wasStaleDev = ["http://47.77.216.1:9200"].includes(raw.hub);
    if (wasStaleDev || raw.hub.includes("47.77.216.1")) {
      raw.hub = opts.hub; changes.push(`hub→${opts.hub}`);
    }
  }
  // Backfill node_id / node_name / anet_version
  if (!raw.anet_version) raw.anet_version = "0.1.0";
  if (!raw.node_id) { raw.node_id = `n_${Math.random().toString(16).slice(2, 10)}`; changes.push(`node_id=${raw.node_id}`); }
  if (!raw.node_name) raw.node_name = raw.name || id;

  // Token: if missing, user-scoped, or untyped, request a fresh ntok_ from hub
  const tokenStr = String(raw.token || "");
  if (!tokenStr || !tokenStr.startsWith("ntok_")) {
    try {
      const res = await fetch(`${opts.hub}/api/auth/node-token`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.utok}`, "Content-Type": "application/json" },
        body: JSON.stringify({ network_id: opts.networkId, node_name: raw.node_name, node_id: raw.node_id }),
      });
      const body = await res.json() as any;
      if (!body?.ok || !body.token) {
        return { ok: false, changes, error: `node-token request failed: ${body?.error || res.status}` };
      }
      raw.token = body.token;
      changes.push(tokenStr ? `token→ntok_…${body.token.slice(-6)}` : `token=ntok_…${body.token.slice(-6)}`);
    } catch (e: any) {
      return { ok: false, changes, error: `node-token request threw: ${e.message}` };
    }
  }

  atomicWritePrivateJson(p, raw);
  return { ok: true, changes };
}

// Read the process umask without leaving it changed: POSIX only exposes it via
// a set-and-return call, so set it to something arbitrary, keep the old value,
// and immediately put it back.
function readProcessUmask(): number {
  const previous = process.umask(0o022);
  process.umask(previous);
  return previous;
}

// Payloads npm/npx already extracted for @sleep2agi/agent-node. Read-only scan
// of local caches; doctor must never fetch, so an empty result means "nothing
// extracted yet", not "safe".
function findExtractedAgentNodePayloads(): { path: string; uid: number; mode: number }[] {
  const roots: string[] = [];
  const npxRoot = join(homedir(), ".npm", "_npx");
  if (existsSync(npxRoot)) {
    for (const entry of readdirSync(npxRoot)) {
      roots.push(join(npxRoot, entry, "node_modules", "@sleep2agi", "agent-node"));
    }
  }
  const out: { path: string; uid: number; mode: number }[] = [];
  for (const root of roots) {
    for (const rel of [["dist", "cli.js"], ["package.json"]]) {
      const path = join(root, ...rel);
      try {
        const st = statSync(path);
        if (st.isFile()) out.push({ path, uid: st.uid, mode: st.mode });
      } catch { /* not extracted here */ }
    }
  }
  return out;
}

async function doctorCommand() {
  const fix = args.includes("--fix");
  console.log(`\nanet doctor — System Diagnostic${fix ? " (auto-fix mode)" : ""}\n`);
  let ok = 0, warn = 0, fail = 0;
  const check = (name: string, pass: boolean, detail?: string) => {
    if (pass) { console.log(`  ✅ ${name}${detail ? ` (${detail})` : ""}`); ok++; }
    else { console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); fail++; }
  };
  const info = (name: string, detail: string) => { console.log(`  ℹ  ${name}: ${detail}`); };
  const warning = (name: string, detail: string) => { console.log(`  ⚠  ${name}: ${detail}`); warn++; };

  // 1. Global config
  const gc = loadGlobal();
  check("Global config (~/.anet/config.json)", !!gc.hub, gc.hub || "missing — run: anet init");
  if (gc.token) check("Auth token configured", true);
  else warning("Auth token", "not set — agents connect without auth");

  const locale = diagnoseLocale(process.env, process.platform);
  if (locale.shouldWarn) {
    const source = formatLocaleSource(locale);
    warning(
      "System locale",
      `${source} is not UTF-8; Unicode aliases and tmux output may be corrupted. Fix: export LANG=C.UTF-8 LC_ALL=C.UTF-8`,
    );
  }

  // The grok-build-cli / opencode-cli payload check refuses any resolved
  // agent-node whose mode has a group- or other-write bit. npm creates files
  // as `0o666 & ~umask`, so a stock Debian/Ubuntu umask of 0002 guarantees
  // 0775/0664 and guarantees the refusal — which surfaces to the operator as
  // "Incompatible grok-build-cli runtime" and says nothing about umask. Say it
  // here, before anyone spends an evening on it. Local state only: the process
  // umask plus whatever is already extracted; doctor never fetches.
  const umaskVerdict = judgeUmask(readProcessUmask());
  const umaskRisk = describeUmaskRisk(umaskVerdict);
  if (umaskRisk) warning("Package file modes", umaskRisk);
  const extracted = findExtractedAgentNodePayloads();
  const rejected = rejectedPayloads(extracted, process.getuid?.() ?? 0);
  if (rejected.length > 0) {
    warning(
      "Resolved agent-node payload",
      `${rejected.length} already-extracted file(s) would be rejected right now, e.g. ` +
      `${rejected[0].path} (mode ${(rejected[0].mode & 0o777).toString(8)}). ` +
      `Fix: chmod -R g-w,o-w ${dirname(dirname(rejected[0].path))}`,
    );
  } else if (extracted.length > 0) {
    check("Resolved agent-node payload", true, `${extracted.length} file(s) pass the mode check`);
  }

  // 2. Hub connectivity
  if (gc.hub) {
    try {
      const health = await fetch(`${gc.hub}/health`, { headers: authHeaders() }).then(r => r.json() as any);
      // 🔴 #1595 —— 原先只印 hub 自报的版本,读的人看不到自己这台 CLI 钉的是哪个。
      //   实测:生产 hub 在 .38,而 PINNED_SERVER_VERSION 是 .44,差 6 个版本。
      //   只并排摆出两个数,**不判断谁对、不给阈值、不发警告** —— hub 比 pin
      //   老或新都可能完全合理,猜一个「应该一致」的判据会在正常情况下误报。
      check("CommHub reachable", health.ok === true, formatHubVersionDetail(gc.hub, health.version, PINNED_SERVER_VERSION));
      if (health.api_version) info("API version", health.api_version);
      info("Sessions", `${health.sessions_count || health.sessions || 0} registered`);
      info("SSE connections", `${health.sse_connections ?? 0} active`); // #473: aggregate stayed on /health
      if (health.license) info("License", health.license);
      if (health.multi_network) check("Multi-network", true);
    } catch (e: any) {
      check("CommHub reachable", false, `${gc.hub} — ${e.message}`);
    }
  }

  // 3. Nodes — also detect legacy/broken configs and (with --fix) migrate.
  const ids = listProfileIds();
  // 🔴 0 个节点**不报 error**:那是全新安装的预期状态,把它算成 error 等于在
  //   新用户的第一次诊断里制造假警报。但也不报 ok —— 同一个 0 对本来有节点的人
  //   意味着配置目录不见了,而 doctor 手上只有一个数字,分不出这两种。
  //   ⇒ 两种现实都说出来,各给一个下一步。
  const nodeLine = nodeCountLine(ids.length);
  if (nodeLine.ok) check("Nodes configured", true, nodeLine.detail);
  else info("Nodes configured", nodeLine.info);
  let needsMigration: string[] = [];
  for (const id of ids) {
    const p = loadProfile(id);
    const name = nodeDisplayName(id, p);
    const runtime = normalizeRuntime(p || undefined);
    const pid = join(nodesDir(), id, ".pid");
    // 🔴 这一列量的是**本机进程**,不是 hub 的看法。原先印无限定的 running/stopped,
    // 和 `anet node ls` 的 STATUS(来自 CommHub)会给出相反答案而无从分辨。
    const localState: LocalProcessState = (() => {
      if (!existsSync(pid)) return { kind: "none" };
      const raw = parseInt(readFileSync(pid, "utf-8").trim(), 10);
      if (!Number.isFinite(raw)) return { kind: "none" };
      try { process.kill(raw, 0); return { kind: "alive", pid: raw }; } catch { return { kind: "stale", pid: raw }; }
    })();
    const alive = localState.kind === "alive";
    info(`  ${name}`, `${runtime} ${describeLocalProcess(localState)} node_id=${p?.node_id || "-"}`);
    // #1259 —— 飞书桥经 parent IPC 交给 think()，而 think() 是所有 runtime 共用的入口：
    //   **没有任何东西阻止** codex / opencode 节点开飞书通道，**也没有任何东西验证过它能工作**。
    //   更要紧的是该 issue 评论里的一格：飞书的工具拒绝层在其余 runtime 上根本不会触发。
    //   #1575 是预防性的（挡住新配），**已经配好的组合仍在裸奔** —— 所以要有一条只读盘点。
    //
    // 🔴 用 ⚠ 不用 ❌：这是「没验过 + 拦截层不生效」，不是「一定坏」。
    // 🔴 判据用目录存在性（channels/feishu/），与 cli.ts 里 channelDir 的算法同源，不另拼路径。
    if (p && runtime !== "claude-agent-sdk"
        && existsSync(join(nodesDir(), id, "channels", "feishu"))) {
      warning(`    ↳ ${name} feishu`,
        `runtime=${runtime} 配了飞书通道，而只有 claude-agent-sdk 验过；`
        + `其余 runtime 上飞书的工具拒绝层不会触发（#1259）`);
    }
    if (p && runtime === "codex-app-server") {
      const audit = codexTopologyAudit(p as any, join(nodesDir(), id), process.cwd());
      const verified = audit.lastRecoveryVerification as any;
      info(`    ↳ ${name} topology`, `${audit.launchMode}; cwd=${audit.cwd}; CODEX_HOME=${audit.codexHome}; remote=${audit.remote || "-"}; thread=${audit.threadId || "-"}; model=${audit.model || "-"}; flags=${JSON.stringify(audit.flags)}`);
      if (audit.threadId && !verified) warning(`    ↳ ${name} recovery`, "stored thread has no successful thread/read history verification");
      else if (verified) info(`    ↳ ${name} recovery`, `${verified.method} verified ${verified.verifiedAt}; turns=${verified.historyTurnCount}; fingerprint=${String(verified.historyFingerprint).slice(0, 12)}`);
    }
    // #1615 —— grok 共存节点的「下次重启会挂」在重启前**没有任何信号**：
    //   grok CLI 自我更新 → 名册仍 idle（跑的是老进程）→ 只有重启才暴露，
    //   而重启正是升级 agent-node 之后必须做的动作。
    //
    // 🔴 这里判的是**漂移**不是**合法性**：「这版本合不合法」要 agent-node 的
    //    GROK_COPRESENCE_VERIFIED_BUILDS，而 agent-network 不依赖 agent-node。
    //    抄一份就是本仓第五份白名单。改判「PATH 上的 grok 与该节点启动时用的
    //    是不是同一个」—— 判据完全在本包内，也不需要知道哪个版本合法。
    if (p && (runtime === "grok-build-cli" || runtime === "grok-build-acp")) {
      const current = (() => {
        try {
          return parseGrokBuildFromVersionOutput(
            execFileSync(process.env.GROK_BINARY || "grok", ["--version"],
              { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).toString());
        } catch { return undefined; }
      })();
      const started = (() => {
        try {
          const dir = join(nodesDir(), id, "logs");
          // 最新的那份日志优先；它没有横幅时再往前找（日志按天切，横幅只在启动那天）。
          const files = readdirSync(dir).filter(f => f.endsWith(".log")).sort().reverse();
          for (const f of files) {
            const hit = parseGrokBuildFromLog(readFileSync(join(dir, f), "utf-8"));
            if (hit) return hit;
          }
        } catch { /* 读不到就是读不到 —— 下面如实说,不猜 */ }
        return undefined;
      })();
      const d = describeGrokBuildDrift(started, current);
      if (d.kind === "match") info(`    ↳ ${name} grok build`, d.line);
      else warning(`    ↳ ${name} grok build`, d.line);
    }
    const diag = diagnoseNode(id);
    if (diag && diag.issues.length) {
      needsMigration.push(id);
      for (const issue of diag.issues) {
        const detail = (() => {
          switch (issue.kind) {
            case "legacy_alias_field": return "config still uses 'alias' (V2 era); should be 'name'";
            case "legacy_resume_field": return "config still uses 'resume'; should be 'session'";
            case "legacy_runtime_name": return `runtime '${issue.from}' is V2; should be 'claude-code-cli'`;
            case "stale_dev_hub": return `hub='${issue.current}' doesn't match global hub`;
            case "missing_token": return "no token field — V3 SSE requires ntok_";
            case "user_token": return `token is ${issue.prefix}_ user-scoped; SSE requires ntok_`;
            case "untyped_token": return `token has no V3 prefix (preview '${issue.preview}')`;
            case "missing_node_id": return "no node_id field";
          }
        })();
        warning(`    ↳ ${name}`, detail);
      }
    }
  }
  // 说清上面那一列量的是什么 —— 否则它和 anet node ls 的 STATUS 是两个
  // 同样权威、可以互相矛盾的答案。
  if (ids.length) info("  这一列的含义", LOCAL_VS_HUB_NOTE);

  const localDaemons = ids
    .map(id => ({ id, profile: loadProfile(id) }))
    .filter(({ profile }) => profile?.role === "host_supervisor");
  if (localDaemons.length) {
    const fetched = await fetchDaemonCapabilities();
    const nowMs = Date.now();
    for (const { id, profile } of localDaemons) {
      const name = nodeDisplayName(id, profile);
      const nid = profile?.node_id || "(missing)";
      info(`    ↳ ${name} create-node`, daemonCreateCapabilityLine(nid, fetched, nowMs));
    }
  }

  if (needsMigration.length) {
    if (fix) {
      console.log(`\n  ⚙  Auto-fixing ${needsMigration.length} node(s)...`);
      if (!gc.hub || !gc.token || !gc.network_id) {
        console.log(`  ❌ Cannot migrate: global config missing hub/token/network_id. Run 'anet login' first.`);
      } else {
        for (const id of needsMigration) {
          const result = await migrateNode(id, { hub: gc.hub, utok: gc.token, networkId: gc.network_id });
          if (result.ok) {
            console.log(`     ✅ ${id}: ${result.changes.join(" / ") || "no changes"}`);
            ok++;
          } else {
            console.log(`     ❌ ${id}: ${result.error}`);
            fail++;
          }
        }
      }
    } else {
      info("→ run", `anet doctor --fix  to auto-migrate ${needsMigration.length} node(s)`);
    }
  }

  // #1259 —— 🔴 **空集也要出声。**
  //   上面那条飞书盘点只在命中时打印。0 命中和「这台机器没有节点目录」「跑在另一棵
  //   .anet 树里」输出一模一样，而 doctor 全绿会被读成「全网没问题」。
  //   #1259 的作者为此专门写了一句：一台机器的盘点**不能推广成「全网没有」**，
  //   并附了他因「局部样本 + 全称措辞」栽过两次的记录。
  //   ⇒ 无论命中与否，都把**这次扫的是哪一棵树**说出来（口径与 `anet daemon list`
  //     的 `scanned:` 一致，#1725）。
  info("Feishu × runtime 盘点", `扫了 ${nodesDir()} 下 ${ids.length} 个节点配置`
    + `；这只是**这一棵 .anet 树**，同一台机器上可能还有别的（见 #1259）`);

  // #125 — scan all nodes for plain-secret env values still persisted in
  // config.json. Migration is per-node (`anet node migrate-token-to-envref
  // <alias>`); doctor just enumerates candidates so users see the inventory
  // before deciding whether to migrate.
  const SECRET_KEY_RX = /(_TOKEN|_KEY|_SECRET|AUTH)$/i;
  const SECRET_VAL_RX = /^(sk-|utok_|ntok_|atok_|ak-|gsk_|key-|Bearer\s)/i;
  const plainSecretNodes: { id: string; fields: string[] }[] = [];
  for (const id of ids) {
    const p = loadProfile(id);
    if (!p || !p.env || typeof p.env !== "object") continue;
    const hits: string[] = [];
    for (const [k, v] of Object.entries(p.env)) {
      if (typeof v !== "string") continue; // already envRef object → safe
      if (SECRET_KEY_RX.test(k) || SECRET_VAL_RX.test(v)) hits.push(k);
    }
    if (hits.length) plainSecretNodes.push({ id, fields: hits });
  }
  if (plainSecretNodes.length) {
    warning("Plain-secret config detected", `${plainSecretNodes.length} node(s) persist secrets in config.json (security hygiene #125)`);
    for (const { id, fields } of plainSecretNodes) {
      const name = nodeDisplayName(id, loadProfile(id));
      info(`    ↳ ${name}`, `env keys: ${fields.join(", ")}`);
    }
    info("→ migrate", `anet node migrate-token-to-envref <alias>   (one node at a time, prints export commands)`);
  } else {
    check("No plain-secret config", true, "all env values are either non-secret or envRef objects");
  }

  // Probe each ntok_ against hub; auto-reissue any that hub rejects with 401.
  // This handles "hub DB was wiped / token revoked" — the node config is
  // otherwise valid, only the token string is stale. We patch only the token
  // field, preserving session_id / channels / runtime / everything else.
  if (fix && gc.hub && gc.token && gc.network_id) {
    // Probe ALL nodes with ntok_, regardless of other issues — the migrateNode
    // pass above only re-issues when token is missing / utok_ / atok_ /
    // untyped; a hub-rejected ntok_ slips past it (Vincent reported this).
    const staleNtokNodes: string[] = [];
    for (const id of ids) {
      const p = loadProfile(id);
      if (!p?.token?.startsWith("ntok_")) continue;
      try {
        const r = await fetch(`${gc.hub}/api/auth/me`, {
          headers: { Authorization: `Bearer ${p.token}` },
        });
        if (r.status === 401 || r.status === 403) staleNtokNodes.push(id);
      } catch { /* network error — skip, don't false-alarm */ }
    }
    if (staleNtokNodes.length) {
      console.log(`\n  ⚙  Probing ntok_ ... ${staleNtokNodes.length} node(s) rejected by hub. Re-issuing...`);
      for (const id of staleNtokNodes) {
        const p = loadProfile(id);
        if (!p) continue;
        const nodeName = p.node_name || p.name || p.alias || id;
        try {
          const r = await fetch(`${gc.hub}/api/auth/node-token`, {
            method: "POST",
            headers: { Authorization: `Bearer ${gc.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ network_id: gc.network_id, node_name: nodeName, node_id: p.node_id }),
          });
          const body = await r.json() as any;
          if (body?.ok && body.token) {
            p.token = body.token;
            saveProfile(id, p);
            console.log(`     ✅ ${id}: ntok_ re-issued (…${body.token.slice(-6)}), session/channels/role preserved`);
            ok++;
          } else {
            console.log(`     ❌ ${id}: re-issue failed: ${body?.error || r.status}`);
            fail++;
          }
        } catch (e: any) {
          console.log(`     ❌ ${id}: re-issue threw: ${e.message}`);
          fail++;
        }
      }
    }
  }

  // 4. Dependencies
  // 🔴 #1645 —— 原先这三行只检查「在不在」,一个**装着但太旧**的 CLI 会拿到 ✅。
  //    实测:`codex-cli 0.149.1` 解不动上游 models 响应(`unknown variant \`max\``),
  //    rmcp worker 致命退出,用户看到的是 300s 超时 —— 而 doctor 说一切正常。
  //    这里把实际版本摆出来。**不做最低版本判定**:够不够由上游返回什么决定,
  //    不是我们能钉死的常量,猜一个下限会在别人升级后变成误报。
  const cliVer = (cmd: string) => formatCliVersion(String(execSync(cmd, { stdio: "pipe" })));
  try { check("Claude Code CLI", true, cliVer("claude --version")); } catch { warning("Claude Code CLI", "not found (needed for claude-code-cli runtime)"); }
  try { check("Codex CLI", true, cliVer("codex --version")); } catch { warning("Codex CLI", "not found (needed for codex-sdk runtime)"); }
  try { check("Bun runtime", true, cliVer("bun --version")); } catch { warning("Bun", "not found (needed for commhub-server)"); }

  // 5. .mcp.json
  const mcpPath = join(process.cwd(), ".mcp.json");
  if (existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(readFileSync(mcpPath, "utf-8"));
      const hasCommhub = Object.values(mcp.mcpServers || {}).some((s: any) => s.command?.includes("node-server") || JSON.stringify(s).includes("commhub"));
      check(".mcp.json commhub channel", !!hasCommhub, hasCommhub ? "configured" : "missing commhub server entry");
    } catch { warning(".mcp.json", "parse error"); }
  } else {
    info(".mcp.json", "not found in current directory");
  }

  // #1188 — surface SkillHub in `anet doctor` so it is discoverable, not just a
  // page that exists. Reuses loadSkillCatalog (network → cache fallback). Non-
  // fatal: an unreachable catalog is a warning, never a doctor failure.
  try {
    const { catalog, sourceUrl, fromCache, cachedAt } = await loadSkillCatalog(false);
    const nSkills = catalog.skills?.length ?? 0;
    if (fromCache) {
      info("SkillHub catalog", `${nSkills} skill(s) (cached${cachedAt ? ` ${cachedAt}` : ""}; ${sourceUrl}) — browse: anet skill ls`);
    } else {
      check("SkillHub catalog", true, `${nSkills} skill(s) available (${sourceUrl}) — browse: anet skill ls`);
    }
  } catch (e: any) {
    warning("SkillHub catalog", `unreachable (${e?.message || e}); set ANET_SKILL_CATALOG_URL or check network — browse: anet skill ls`);
  }

  // 6. Telegram channel env (silent token loss is a known foot-gun)
  const tgEnv = join(home, ".claude", "channels", "telegram", ".env");
  if (existsSync(tgEnv)) {
    const size = (() => { try { return statSync(tgEnv).size; } catch { return 0; } })();
    if (size === 0 || size === 1) {
      warning("Telegram bot token", `~/.claude/channels/telegram/.env is empty (size=${size}); token lost. Reconfigure: /telegram:configure`);
    } else {
      check("Telegram channel env", true, `~/.claude/channels/telegram/.env (${size}B)`);
    }
  } else {
    info("Telegram channel env", "not configured (no telegram bot token)");
  }

  // 7. #245 — CommHub MCP dependency integrity (the silent "all commhub_* tools
  // vanished" outage) + per-node telegram channel state, so these surface here
  // instead of forcing a dig through ~/.cache MCP logs.
  const anetDir = join(process.cwd(), ".anet");
  if (existsSync(join(anetDir, "node-server.js"))) {
    let sdkOk = false;
    try {
      execSync(`bun -e "import('@modelcontextprotocol/sdk/server/index.js').then(()=>process.exit(0)).catch(()=>process.exit(3))"`, { cwd: anetDir, stdio: "pipe", timeout: 15000 });
      sdkOk = true;
    } catch {}
    if (sdkOk) check("CommHub MCP dependency", true, "@modelcontextprotocol/sdk importable from .anet");
    else check("CommHub MCP dependency", false, `@modelcontextprotocol/sdk missing/partial in .anet — commhub_* tools won't load. Fix: cd "${anetDir}" && bun install`);
  }

  const tgNodeIds = ids.filter(id => existsSync(join(nodesDir(), id, "channels", "telegram", "access.json")));
  if (tgNodeIds.length) {
    info("Telegram channels", `${tgNodeIds.length} node(s) — run 'anet channel status' for resolved paths`);
    for (const id of tgNodeIds) {
      const name = nodeDisplayName(id, loadProfile(id));
      const accessPath = join(nodesDir(), id, "channels", "telegram", "access.json");
      try {
        const a = JSON.parse(readFileSync(accessPath, "utf-8"));
        const allow = Array.isArray(a.allowFrom) ? a.allowFrom.length : 0;
        const pending = a.pending && typeof a.pending === "object" ? Object.keys(a.pending).length : 0;
        info(`    ↳ ${name}`, `allowFrom: ${allow}, pending: ${pending}, policy: ${a.dmPolicy || "?"}`);
      } catch (e: any) {
        warning(`    ↳ ${name}`, `access.json unreadable: ${e?.message || e}`);
      }
    }
  }

  console.log(`\n  Result: ${ok} ok, ${warn} warnings, ${fail} errors\n`);
}

// #135 v3 fix — Wrap the entire dispatch in `async function main()` so the
// module's actual top-level has zero `await` expressions. Node v24 ESM
// strict mode emits "Detected unsettled top-level await" + minified bundle
// stack dump when the module's top-level await chain settles but the event
// loop is still busy. With the dispatch inlined at top level (the original
// pattern), the bundle is compiled with implicit module-level awaits that
// the v24 check considers "unsettled" even after we call process.exit(0)
// (the check runs BEFORE exit takes effect). Moving the dispatch into an
// async function removes the module-level await entirely; only main()'s
// returned promise needs to settle, and an explicit .then/.catch terminator
// gives Node v24 a clean module shutdown signal. preview.0 / preview.1
// fixes (process.exit in createInteractiveCommand / dispatch end) didn't
// help because they don't change the module's top-level await profile.
async function main() {
// #215 (P0) — universal --help / -h intercept: never let a subcommand's
// `--help` argv slip into business logic. Without this, `anet token create
// --help` SIGNS a real token, `anet run --help` STARTS a real SSE listener
// on :9200, `anet hub start --help` STARTS the hub. Convention everywhere
// else (cargo, git, npm, docker) is "see help, no side effect" — match it.
//
// #240 — Original #215 always bounced to global printHelp(), which made
// `anet hub --help` hide hub/stop/status (regression that read like the
// routes had been removed even though they were still wired). Route to
// per-subcommand help printer when one exists; fall back to global for the
// rest (preserves #215 safety against side-effects in token/run/etc.).
if (args.slice(1).some((a) => a === "--help" || a === "-h")) {
  switch (command) {
    case "hub":
    case "server":
      printHubHelp();
      break;
    case "project":
      printProjectUsage();
      break;
    case "grok":
      console.log("Usage: anet grok attach <node>");
      break;
      // #1668 — 同一个 bug 的第三次:opencode / goal / token / batch **各自都在
      // 自己的命令里写了 `sub === "--help"` 分支**,而这个拦截器先命中 default,
      // 于是那四段 help 一次都没被执行过 —— 被写了四遍的死代码。
      //
      // 🔴 这里**不剥 --help**(和下面 daemon 那支不同):`tokenCommand` 的守卫只认
      // `sub === "--help"`,不认 `!sub` —— 剥掉之后它反而不打帮助了。四个的守卫都
      // 直接认这个 flag,原样传进去即可。
      //
      // 🔴 只收这四个是有判据的,不是挑的:它们的 --help 分支是 console.log 之后
      // 直接返回。而 network 一进来就 loadGlobal() 读 hub/token、channel 一进来
      // parseOpts()、session 的 !sub 直接跑 ls —— 那三个没有前置 help 守卫,
      // 路由过去会有副作用,正是 #215 那条 default 要防的东西,留着不动。
    case "opencode": await opencodeCommand(); break;
    case "goal":     await goalCommand();     break;
    case "token":    await tokenCommand();    break;
    case "batch":    await batchCommand();    break;
    case "network":
      await networkCommand();
      break;
    case "channel":
      await channelCommand();
      break;
    case "session":
      sessionCommand();
      break;
    case "daemon":
      // #717 — daemonCommand() already prints its own subcommand help for
      // bare `anet daemon`, but this intercept ran first and bounced to the
      // global printHelp(), so `anet daemon --help` showed the top-level
      // command list. A user following the near-universal `<cmd> --help`
      // convention concluded `anet daemon` had no subcommands and never
      // found init/start/up/list. Drop the help flag and let daemonCommand
      // take the bare-invocation path, which is the help it already has.
      {
        for (const flag of ["--help", "-h"]) {
          const i = args.indexOf(flag);
          if (i >= 0) args.splice(i, 1);
        }
      }
      await daemonCommand();
      process.exit(0);
    case "node":
      // #144 — if it's `anet node loop --help` specifically, delegate
      // to nodeLoopCommand so the user sees the loop-specific help
      // (examples + interval format) rather than the generic node
      // subcommand list. Other `anet node <sub> --help` calls still
      // get the generic node usage.
      if (args[1] === "start") {
        printNodeStartHelp();
      } else if (args[1] === "loop") {
        args.splice(0, 1); // drop "node" so nodeLoopCommand sees args[1] as alias slot (no alias → prints loop help)
        // strip --help so it's not treated as an alias literal
        const hi = args.indexOf("--help");
        if (hi >= 0) args.splice(hi, 1);
        const hi2 = args.indexOf("-h");
        if (hi2 >= 0) args.splice(hi2, 1);
        await nodeLoopCommand();
        process.exit(0);
      } else {
        console.log(`Usage: anet node <create|start|stop|restart|resume|delete|ls|rename|edit|loop|codex|migrate-token-to-envref> [name]`);
      }
      break;
    default:
      printHelp();
  }
  process.exit(0);
}
switch (command) {
  case "init":
    if (args[1] === "project") initProject();
    else if (args[1] === "profile") await initProfile();
    else await initGlobal();
    break;
  case "create": await createCommand(); break;
  case "attach": attachCommand(); break;
  case "server": await serverCommand(); break;
  case "hub": await serverCommand(); break; // anet hub start/dashboard/config
  case "node": // anet node create/start/stop/resume/delete/ls/rename
    switch (args[1]) {
      case "create": args.splice(0, 1); await createCommand(); break;
      case "start": args.splice(0, 1); await startCommand(); break;
      case "stop": args.splice(0, 1); await stopCommand(); break;
      case "resume": args.splice(0, 1); await resumeCommand(); break;
      case "delete": args.splice(0, 1); await deleteCommand(); break;
      case "rename": args.splice(0, 1); await renameCommand(); break;
      case "edit": args.splice(0, 1); await nodeEditCommand(); break;
      case "loop": args.splice(0, 1); await nodeLoopCommand(); break;
      case "ls": case "list": await lsCommand(); break;
      case "restart": {
        // #173 / F7-03 — node restart = stop + start, alias for symmetry
        // with `anet project restart` and `anet batch restart`. We splice off
        // the "restart" verb so stopCommand/startCommand see args[1] as alias.
        args.splice(0, 1);
        await stopCommand();
        await startCommand();
        break;
      }
      case "migrate-token-to-envref": args.splice(0, 1); await migrateTokenToEnvRefCommand(); break;
      case "codex": args.splice(0, 1); await codexLifecycleCommand(); break; // #1856 —— Codex TUI 共存节点生命周期控制器
      default: {
        const sub = args[1];
        if (sub) {
          // 🔴 实测 `anet node state` / `stat` → 建议 `start`(想看状态,被指去启动)。
          const redirect = nodeSubcommandRedirect(sub, args[2]);
          if (redirect) { for (const line of redirect) console.log(line); }
          else {
            const suggestion = suggestSimilar(sub, ["create", "start", "stop", "restart", "resume", "delete", "ls", "rename", "edit", "loop", "codex"]);
            if (suggestion) console.log(`Unknown node subcommand "${sub}". Did you mean: anet node ${suggestion}?`);
          }
        }
        console.log(`Usage: anet node <create|start|stop|restart|resume|delete|ls|rename|edit|loop|codex|migrate-token-to-envref> [name]`);
        break;
      }
    }
    break;
  case "daemon": await daemonCommand(); break; // RFC-026 P2 / #338 — host_supervisor one-cmd
  case "project": await projectCommand(); break;  // #117 — cwd-wide orchestration
  case "grok": await grokCommand(); break;
  case "start": await startCommand(); break;   // backward compat
  case "resume": await resumeCommand(); break; // backward compat
  case "rename": await renameCommand(); break; // backward compat
  case "stop": await stopCommand(); break; // backward compat
  case "delete": await deleteCommand(); break; // backward compat
  case "import": await importCommand(); break;
  case "channel": await channelCommand(); break;
  case "setup": await setupCommand(); break;
  case "upgrade": await upgradeCommand(); break;
  case "session": sessionCommand(); break;
  case "skill": await skillCommand(); break;
  case "ls": case "list": await lsCommand(); break;
  case "status": await statusCommand(); break;
  case "tasks": await tasksCommand(); break;
  case "goal": await goalCommand(); break;
  case "doctor": await doctorCommand(); break;
  case "license": await licenseCommand(); break;
  case "activate": await activateCommand(); break;
  case "passwd": await passwdCommand(); break;
  case "token": await tokenCommand(); break;
  case "demo": await demoCommand(); break;
  case "batch": await batchCommand(); break;
  case "logs": logsCommand(); break;
  case "info": await infoCommand(); break;
  case "config": configShowCommand(); break;
  case "login": await loginCommand(); break;
  case "register": await registerCommand(); break;
  case "quickstart": {
    // Removed per issue #45. Print migration help and exit non-zero so users
    // notice the breakage instead of silently failing.
    console.error(`[anet] ⚠ 'anet quickstart' 已删除（per #45）。改用现代命令组合:
  anet hub start                            # 起 CommHub Server
  anet setup                                # 装 runtime deps + 选 runtime (wizard)
  anet register                             # 创建账号
  anet login                                # 登录
  anet node create <name> # 创建 agent

或一键 demo: cd demos/hello-world && docker compose up`);
    process.exit(1);
  }
  case "logout": logoutCommand(); break;
  case "whoami": await whoamiCommand(); break;
  case "network": await networkCommand(); break;
  case "run": await runCommand(); break;
  case "opencode": await opencodeCommand(); break; // RFC-029 PR③ — upgrade-pin
  case "-v": case "-V": case "--version": case "version": {
    // F7-05 / #192 — accept "-V" (cargo/git convention) as alias for -v.
    printVersionReport();
    break;
  }
  case "--help": case "-h": case "help": case undefined: printHelp(); break;
  default:
    if (resolveNodeRef(command)) { args.unshift("start"); await startCommand(); }
    else {
      // F7-02 / F7-10 — did-you-mean for typo'd top-level commands. List is
      // hand-maintained to avoid scanning the switch at runtime; keep in
      // sync if new top-level commands are added.
      const TOP_COMMANDS = [
        "init", "create", "attach", "server", "hub", "node", "project", "start", "resume",
        "rename", "stop", "delete", "import", "channel", "setup", "upgrade",
        "session", "skill", "ls", "list", "status", "tasks", "goal", "doctor", "license",
        "activate", "passwd", "token", "demo", "batch", "logs", "info", "config",
        "login", "register", "logout", "whoami", "network", "run", "version", "help",
        // 这四个是后加的顶层命令,曾长期漏在本名单外 —— 见 top-commands-coverage.test.ts。
        "daemon", "grok", "opencode", "quickstart",
      ];
      const suggestion = suggestSimilar(command, TOP_COMMANDS);
      if (suggestion) console.error(`Unknown command "${command}". Did you mean: anet ${suggestion}?`);
      else console.error(`Unknown: ${command}`);
      printHelp();
      process.exit(1);
    }
}
}  // end async function main

// #135 v3 — explicit .then/.catch terminator. main()'s returned promise is
// the ONLY top-level promise the module emits; no `await` at module scope
// means Node v24's strict ESM checker has nothing to scan. We exit
// explicitly in both branches so readline / @inquirer signal handlers
// don't keep the event loop alive past the dispatch.
main().then(
  () => { if (process.env.ANET_INTERNAL_KEEP_PROCESS !== "1") process.exit(0); },
  (err: any) => {
    // #237 — Friendly classification for unhandled fetch errors. Replaces
    // the bare "FATAL: TypeError: fetch failed + 10-line Node stack" output
    // Vincent hit on a clean machine where the hub was unreachable. Falls
    // through to the legacy FATAL handler for everything else.
    if (isFetchError(err)) {
      console.error(`[anet] ❌ ${classifyFetchError(err)}`);
      if (process.env.DEBUG || process.env.ANET_DEBUG) {
        console.error(err?.stack || err);
      } else {
        console.error(`[anet]    (set ANET_DEBUG=1 to see the underlying Node stack)`);
      }
      process.exit(1);
    }
    console.error("[anet] FATAL:", err?.stack || err?.message || err);
    process.exit(1);
  },
);
