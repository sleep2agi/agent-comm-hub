// RFC-026 v4 daemon-side — handles SSE doorbell `type: create_node`,
// pulls the request from hub, validates again (defense in depth),
// fork-exec `anet node create + start` with strict env, acks hub.
//
// Only registered/active when this agent-node's config has
// `role: "host_supervisor"`. The supervisor wrap (RFC-024 W1) keeps
// the daemon itself respawning on crash; child nodes spawned here run
// in their own processes (detached) and get their own supervisor wrap
// once they hit `anet node start`.

import { execFileSync, spawn } from "node:child_process";
import { statSync, realpathSync, readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { isReservedEnvKey } from "../shared/reserved-env.js";
import {
  atomicWriteJson,
  atomicWritePrivateText,
  repairPrivateConfigPermissions,
} from "./config-apply.js";

// ── §4.2.6 B2 — ANET_BIN install-time pin + boot 4-check ──────────
//
// Resolution order (first-match wins):
//   1. `/etc/anet-daemon/path.conf` (KEY=VALUE format; install scripts
//      write this on systemd-managed hosts)
//   2. `ANET_BIN_ABS` env var only when `ANET_DAEMON_ALLOW_ENV_BIN=1`
//      (Docker/dev/manual-ops convenience, not a production trust root)
//
// Runtime fork ALWAYS uses the resolved path. Daemon NEVER calls
// `which anet` or any other PATH lookup. CI lint guard greps
// `execFile.*"[^/"` to enforce.

interface PathPin {
  abs: string;
  sha256?: string;
}

function quoteSh(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** #1353 —— 二进制 pin 校验失败的**机器可读**类别。
 *
 * 在此之前 11 个语义完全不同的失败全部汇成同一条 `anet_bin_unsafe_path`,而修法差得很远:
 *   permission → 一行 `chmod go-w`
 *   source     → 写 `/etc/anet-daemon/path.conf`(**要 sudo,改系统配置**)
 *   identity   → 重装 anet 或 unset ANET_BIN_ABS
 *   shape      → 换成 realpath
 *
 * 🔴 2026-08-28 一天里撞到其中两类(source 和 permission),看到的是**同一条错误**。
 *    第一反应是去建 /etc/anet-daemon/path.conf —— 而那次实际只要 chmod。
 *    **把"要 sudo 改系统"和"一行 chmod"盖成同一句话,会让人修错方向。**
 */
export type AnetBinFailureCode =
  | "anet_bin_identity"
  | "anet_bin_source"
  | "anet_bin_shape"
  | "anet_bin_permission";

export interface AnetBinError extends Error { anetBinCode?: AnetBinFailureCode }

/** 🔴 消息前缀 `anet_bin_unsafe_path:` **保持不变**。全仓 10 个文件依赖它,
 *  其中 create-node-daemon.test.ts 有 6 条 `toThrow(/anet_bin_unsafe_path.*.../)`。
 *  改前缀会把它们全打断,而那和本次要解决的问题无关。
 *  **机器可读的类别挂在 Error 属性上,不动人读的那一句。** */
function unsafePathHelp(code: AnetBinFailureCode, reason: string, fix: string): AnetBinError {
  const e = new Error(`anet_bin_unsafe_path: ${reason}. Fix: ${fix}`) as AnetBinError;
  e.anetBinCode = code;
  return e;
}

function findPackageJsonDir(start: string): string | null {
  let dir = dirname(start);
  for (;;) {
    try {
      const pkg = join(dir, "package.json");
      statSync(pkg);
      return dir;
    } catch { /* keep walking */ }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function verifyAnetBinIdentity(abs: string): void {
  const pkgDir = findPackageJsonDir(abs);
  if (!pkgDir) {
    throw unsafePathHelp("anet_bin_identity", `not an anet package bin: no package.json above ${abs}`, "re-run via the installed anet command: anet daemon up");
  }
  let pkg: any;
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
  } catch (e: any) {
    throw unsafePathHelp("anet_bin_identity", `not an anet package bin: cannot read package.json (${e?.message || e})`, "reinstall anet: npm i -g @sleep2agi/agent-network@latest");
  }
  if (pkg?.name !== "@sleep2agi/agent-network") {
    throw unsafePathHelp("anet_bin_identity", `not an anet package bin: package name is ${JSON.stringify(pkg?.name)}`, "unset ANET_BIN_ABS and re-run: anet daemon up");
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

  throw unsafePathHelp("anet_bin_identity", `not an anet package bin: package.json bin.anet does not point at ${abs}`, "unset ANET_BIN_ABS and re-run: anet daemon up");
}

function readPathConf(path: string): PathPin | null {
  try {
    const buf = readFileSync(path, "utf-8");
    const out: Record<string, string> = {};
    for (const line of buf.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+)\s*$/);
      if (m) out[m[1]] = m[2];
    }
    if (!out.ANET_BIN_ABS) return null;
    return { abs: out.ANET_BIN_ABS, sha256: out.ANET_BIN_SHA256 };
  } catch { return null; }
}

/** §4.2.6 B2 hardened — install-time pin + 5-check (PR #299 BLOCKER #3).
 *  All five gates throw `anet_bin_unsafe_path:<reason>` and fail-fast
 *  the daemon on boot (RFC: better to lose 1 host than fork a poisoned
 *  binary). Non-root owners are allowed by default because nvm/homebrew
 *  installs intentionally place the user's own anet binary outside root
 *  ownership. */
/** Case-aware equality for a realpath round-trip.
 *  POSIX: byte-exact equality (`realpathSync` returns the canonical form
 *    and we require the input to already be that form).
 *  Windows: filesystem is case-insensitive and paths flow through junctions
 *    / short-name aliases, so `realpathSync` can return the same directory
 *    with a different case or resolved junction target. Normalize both via
 *    the win32 path helpers and compare case-folded — this preserves the
 *    "no symlink component" invariant without a false-positive on `C:\Users`
 *    vs `C:\users`. See #1290 for the realpath-on-Windows discussion.
 */
function realpathEquivalent(a: string, b: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") {
    return win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase();
  }
  return a === b;
}

// #1290 — Windows `statSync().mode` is a value Node SYNTHESIZES from Windows
// file attributes (ReadOnly bit + extension-based execute guess), not the
// actual filesystem ACL. `mode & 0o022` and `mode & 0o111` therefore either
// throw on files that are actually secure (a `.cjs` file that Node maps to
// 0o666 fails the group/other-writable check even though ACLs restrict it
// to Administrators + the current user), or silently accept files that
// aren't (a script pushed there by an unprivileged user gets the same
// 0o666 and passes). Neither direction expresses a real security property
// on Windows.
//
// This flag makes that skip visible + shown once per process, so the fact
// that Windows daemons are running WITHOUT the POSIX-mode supply-chain
// gate is not a silent security regression. An ACL-based Windows
// equivalent (icacls / SDDL check via the same `restrictWindowsAcl`
// pattern that ships in agent-network/src/private-state.ts as of #1137)
// is filed separately as a follow-up.
let _windowsPosixModeCheckWarned = false;
function warnOnceWindowsPosixModeSkipped(warn: (msg: string) => void = console.warn.bind(console)): void {
  if (_windowsPosixModeCheckWarned) return;
  _windowsPosixModeCheckWarned = true;
  warn(
    `[anet-daemon] #1290 — Windows POSIX-mode supply-chain checks ` +
    `(group/other writability, executability) SKIPPED. Node's synthetic ` +
    `st.mode does not reflect Windows filesystem ACLs; enforce with ` +
    `icacls that ANET_BIN_ABS is owned + writable only by trusted principals.`,
  );
}
/** Test-only: reset the once-per-process warning latch so a test can
 *  observe the warning firing on the first Windows-platform call. */
export function _resetWindowsPosixModeWarnLatchForTest(): void {
  _windowsPosixModeCheckWarned = false;
}

/** #1491 — platform-aware default for the ANET path.conf trust root.
 *
 *  POSIX: `/etc/anet-daemon/path.conf` (unchanged — the value that has
 *   shipped since RFC-026 §4.2.6 B2 and that install scripts write).
 *
 *  Windows: `%ProgramData%\anet-daemon\path.conf`, falling back to
 *   `C:\ProgramData\anet-daemon\path.conf` if `PROGRAMDATA` isn't set
 *   (rare — Windows always sets it on interactive sessions, but a
 *   stripped-env service context can lack it). `%ProgramData%` is the
 *   documented Windows location for system-wide daemon config
 *   (equivalent role to `/etc` on POSIX).
 *
 *  Before this fix the POSIX literal was the default on every platform,
 *  so on Windows the default `confPath` pointed at `/etc/anet-daemon/...`
 *  — a path that cannot exist on Windows filesystems and never
 *  resolves. Users had to know about the `ANET_BIN_ABS` +
 *  `ANET_DAEMON_ALLOW_ENV_BIN=1` env fallback (documented per #1291) to
 *  get anywhere. This makes the default do the right thing.
 */
export function defaultPathConf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    const programData = env.PROGRAMDATA || "C:\\ProgramData";
    return win32.join(programData, "anet-daemon", "path.conf");
  }
  return "/etc/anet-daemon/path.conf";
}

export function loadAndVerifyAnetBin(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  let pin: PathPin | null = null;
  const trustRoot = defaultPathConf(env, platform);
  const confPath = env.ANET_DAEMON_PATH_CONF || trustRoot;
  pin = readPathConf(confPath);
  if (!pin && env.ANET_BIN_ABS && env.ANET_DAEMON_ALLOW_ENV_BIN === "1") {
    pin = { abs: env.ANET_BIN_ABS, sha256: env.ANET_BIN_SHA256 };
  }
  if (!pin && env.ANET_BIN_ABS) {
    throw unsafePathHelp("anet_bin_source",
      `ANET_BIN_ABS env fallback disabled (set ANET_DAEMON_ALLOW_ENV_BIN=1 only for Docker/dev/manual ops; production trust root is ${trustRoot})`,
      platform === "win32"
        ? `New-Item -ItemType Directory -Force -Path "${win32.dirname(trustRoot)}" | Out-Null; "ANET_BIN_ABS=<absolute path to anet.cjs>" | Set-Content -Path "${trustRoot}" -Encoding ascii`
        // 🔴 这条命令在 2026-08-30 之前**两处都坏**，而它是 anet_bin_source 唯一给出的修法：
        //   ① **语法就不成立**：`"$(node -e \\"…\\" …)"` 里的 `\\"` 在 `$( )` 内不是转义、是语法错误，
        //      `bash -n` 直接 rc=2 —— 用户粘贴进去只会看到 `syntax error near unexpected token '('`。
        //      改用单引号包 node 脚本，脚本内部才用 `"fs"`，两层引号不再打架。
        //   ② **sudo 盖错了半边**：`install -d /etc/anet-daemon` 没有 sudo，普通用户下 exit 1
        //      （实测 `install: cannot change permissions of '/etc/anet-daemon'`），`&&` 当场断链，
        //      后面的 `sudo tee` **根本不执行**。用户照敲之后 path.conf 依旧不存在。
        //   一条跑不通的修复建议比没有建议更糟：它让人以为自己已经修过了。
        //   realpath 先在 sudo **之前**算好并存进变量 —— 否则 root 环境里 `command -v anet`
        //   可能解析到另一个（或找不到）二进制。
        //   🔴 说明文字走 `#` 注释行、命令各占一行 —— **整条 Fix 都要能 bash -n 过**。
        //   2026-08-31 的教训：我曾把说明直接拼在命令后面（`(no /etc, no sudo)` 里的
        //   括号不配对），整条从 rc=0 变成 rc=2；而当时那条 bash -n 测试只切了我新加的
        //   那半句去验，**结构上看不见自己要防的缺陷**。现在验的是整条 Fix 尾巴。
        //   同 CLI 侧 daemon-capability-display.ts 的结论：说明和命令拼成一句之后，
        //   没有一条能通过 bash -n。
        : "\n# needs root:\nANET_BIN_REAL=\"$(node -e 'console.log(require(\"fs\").realpathSync(process.argv[1]))' \"$(command -v anet)\")\" && sudo install -d -m 0755 /etc/anet-daemon && printf 'ANET_BIN_ABS=%s\\n' \"$ANET_BIN_REAL\" | sudo tee /etc/anet-daemon/path.conf >/dev/null\n# or keep the pin in a file you own (no /etc, no sudo) — put ANET_DAEMON_PATH_CONF in the daemon environment so it survives a restart:\nANET_BIN_REAL=\"$(node -e 'console.log(require(\"fs\").realpathSync(process.argv[1]))' \"$(command -v anet)\")\" && mkdir -p \"$HOME/.anet\" && printf 'ANET_BIN_ABS=%s\\n' \"$ANET_BIN_REAL\" > \"$HOME/.anet/path.conf\" && export ANET_DAEMON_PATH_CONF=\"$HOME/.anet/path.conf\"",
    );
  }
  if (!pin) {
    throw unsafePathHelp("anet_bin_source",
      `no ANET_BIN_ABS resolved from ${confPath}; env fallback is Docker/dev/manual-ops convenience and requires ANET_DAEMON_ALLOW_ENV_BIN=1`,
      platform === "win32"
        ? `New-Item -ItemType Directory -Force -Path "${win32.dirname(trustRoot)}" | Out-Null; "ANET_BIN_ABS=<absolute path to anet.cjs>" | Set-Content -Path "${trustRoot}" -Encoding ascii`
        // 🔴 这条命令在 2026-08-30 之前**两处都坏**，而它是 anet_bin_source 唯一给出的修法：
        //   ① **语法就不成立**：`"$(node -e \\"…\\" …)"` 里的 `\\"` 在 `$( )` 内不是转义、是语法错误，
        //      `bash -n` 直接 rc=2 —— 用户粘贴进去只会看到 `syntax error near unexpected token '('`。
        //      改用单引号包 node 脚本，脚本内部才用 `"fs"`，两层引号不再打架。
        //   ② **sudo 盖错了半边**：`install -d /etc/anet-daemon` 没有 sudo，普通用户下 exit 1
        //      （实测 `install: cannot change permissions of '/etc/anet-daemon'`），`&&` 当场断链，
        //      后面的 `sudo tee` **根本不执行**。用户照敲之后 path.conf 依旧不存在。
        //   一条跑不通的修复建议比没有建议更糟：它让人以为自己已经修过了。
        //   realpath 先在 sudo **之前**算好并存进变量 —— 否则 root 环境里 `command -v anet`
        //   可能解析到另一个（或找不到）二进制。
        //   🔴 说明文字走 `#` 注释行、命令各占一行 —— **整条 Fix 都要能 bash -n 过**。
        //   2026-08-31 的教训：我曾把说明直接拼在命令后面（`(no /etc, no sudo)` 里的
        //   括号不配对），整条从 rc=0 变成 rc=2；而当时那条 bash -n 测试只切了我新加的
        //   那半句去验，**结构上看不见自己要防的缺陷**。现在验的是整条 Fix 尾巴。
        //   同 CLI 侧 daemon-capability-display.ts 的结论：说明和命令拼成一句之后，
        //   没有一条能通过 bash -n。
        : "\n# needs root:\nANET_BIN_REAL=\"$(node -e 'console.log(require(\"fs\").realpathSync(process.argv[1]))' \"$(command -v anet)\")\" && sudo install -d -m 0755 /etc/anet-daemon && printf 'ANET_BIN_ABS=%s\\n' \"$ANET_BIN_REAL\" | sudo tee /etc/anet-daemon/path.conf >/dev/null\n# no-root alternative to try first: only `anet daemon init|start|up` auto-declares the pin, so a daemon started via `anet node start` / pm2 / systemd never receives it. Restart it with:\n# anet daemon start <name>\n\n# or keep the pin in a file you own (no /etc, no sudo) — put ANET_DAEMON_PATH_CONF in the daemon environment so it survives a restart:\nANET_BIN_REAL=\"$(node -e 'console.log(require(\"fs\").realpathSync(process.argv[1]))' \"$(command -v anet)\")\" && mkdir -p \"$HOME/.anet\" && printf 'ANET_BIN_ABS=%s\\n' \"$ANET_BIN_REAL\" > \"$HOME/.anet/path.conf\" && export ANET_DAEMON_PATH_CONF=\"$HOME/.anet/path.conf\"",
    );
  }
  // ① absolute — cross-platform. Was `startsWith("/")` which returned
  //    false for every Windows drive-letter path (`C:\...`), so the
  //    Windows daemon could register + heartbeat + receive doorbells
  //    but silently refused to fork any node. See #1290.
  if (!isAbsolute(pin.abs)) {
    throw unsafePathHelp("anet_bin_shape",
      `not absolute: ${pin.abs}`,
      `export ANET_BIN_ABS=$(node -e "console.log(require('fs').realpathSync(process.argv[1]))" ${quoteSh(pin.abs)})`,
    );
  }
  // ② no symlink path component (realpath equals self). Case-aware on
  //    Windows so a junction- or case-normalized `realpathSync` result
  //    doesn't fail this check on an otherwise-correct absolute path.
  const real = realpathSync(pin.abs);
  if (!realpathEquivalent(real, pin.abs, platform)) {
    throw unsafePathHelp("anet_bin_shape",
      `contains symlink: ${pin.abs} -> ${real}`,
      `export ANET_BIN_ABS=${quoteSh(real)}`,
    );
  }
  verifyAnetBinIdentity(pin.abs);
  const st = statSync(pin.abs);
  if (platform === "win32") {
    // Windows: st.mode is synthetic; POSIX bit checks don't apply. See
    // the docblock on warnOnceWindowsPosixModeSkipped for the rationale +
    // the ACL-based follow-up. Print the visible acknowledgement once
    // and skip ③④⑤ entirely on Windows.
    warnOnceWindowsPosixModeSkipped();
  } else {
    // ③ stat: non-root owner is acceptable for nvm/homebrew/user installs.
    if (st.uid !== 0 && env.ANET_DAEMON_STRICT_ROOT_BIN === "1") {
      throw unsafePathHelp("anet_bin_permission",
        `owner not root (uid=${st.uid})`,
        `sudo chown root:root ${quoteSh(pin.abs)} || unset ANET_DAEMON_STRICT_ROOT_BIN`,
      );
    }
    // ④ not group/other writable
    //
    // 🔴 #1353 —— `chmod go-w` 修的是**结果**,不是原因。若这个二进制是 npm 装的,
    //    它的权限由**安装时那个 shell 的 umask** 决定:npm 以 0777/0666 建文件再由
    //    umask 掩掉,所以 `umask 0002` 恒得 775/664(实测:775 的可执行 + 664 的
    //    package.json 就是这一对的指纹),而 775 & 0o022 !== 0 必然落到这里。
    //    ⇒ chmod 之后**下一次 `npm install -g` 会原样改回去**。持久修法是让安装
    //    发生在 `umask 0022` 下。两条都给,让读的人知道自己在选哪一种。
    if ((st.mode & 0o022) !== 0) {
      const before = (st.mode & 0o777).toString(8);
      const groupWritable = (st.mode & 0o020) !== 0;
      throw unsafePathHelp("anet_bin_permission",
        `writable by group/other (mode=${before})`,
        `chmod go-w ${quoteSh(pin.abs)}` +
        (groupWritable
          ? `   # 立即可用,但若它是 npm 装的,下次 \`npm install -g\` 会按安装时的 umask 改回去;` +
            ` 持久修法是在 \`umask 0022\` 下重装(见 #1353)`
          : ""),
      );
    }
    // ⑤ executable
    if ((st.mode & 0o111) === 0) {
      throw unsafePathHelp("anet_bin_permission", "not executable", `chmod +x ${quoteSh(pin.abs)}`);
    }
  }
  // hash match install-time witness (when provided, REQUIRED to match).
  // Runs on all platforms — sha256 is the strongest cross-platform
  // integrity check we have and does not care about mode bits or ACLs.
  if (pin.sha256) {
    const actual = createHash("sha256").update(readFileSync(pin.abs)).digest("hex");
    if (actual !== pin.sha256) {
      throw new Error(`anet_bin_unsafe_path: sha256 mismatch (install=${pin.sha256.slice(0,8)} vs now=${actual.slice(0,8)})`);
    }
  }
  return pin.abs;
}

// Cached once at module-load time. Throws if unsafe → daemon exits.
// Lazy so unit tests can mock env without firing on import; the cli
// boot path calls this explicitly + stashes the result.
let _anetBinAbs: string | null = null;
export function getAnetBinAbs(): string {
  if (_anetBinAbs) return _anetBinAbs;
  _anetBinAbs = loadAndVerifyAnetBin();
  return _anetBinAbs;
}
export function _resetAnetBinAbsForTest(): void { _anetBinAbs = null; }

// ── §4.2.6 B1 — minimalEnv (filter + fixed-keys-last + throw-on-collision) ──

const SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
// #1490 — fixed env keys split by platform. Windows children need
// USERPROFILE / HOMEDRIVE / HOMEPATH populated to resolve the home
// directory; POSIX children only need HOME. Both platforms get PATH +
// HOME + LANG. Extra keys passed to minimalEnv must NOT collide with any
// key we own — smuggling USERPROFILE on Windows would let an untrusted
// caller point the child at a different home, so it's fixed there too.
const FIXED_ENV_KEYS_POSIX = new Set(["PATH", "HOME", "LANG"]);
const FIXED_ENV_KEYS_WIN32 = new Set(["PATH", "HOME", "LANG", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"]);
function fixedEnvKeysFor(platform: NodeJS.Platform): ReadonlySet<string> {
  return platform === "win32" ? FIXED_ENV_KEYS_WIN32 : FIXED_ENV_KEYS_POSIX;
}
// Back-compat export for anything still reading the old constant (kept
// as the union of both sets — matches "what keys minimalEnv WILL fix"
// across all supported platforms, which is what a caller sanity-checking
// the denylist actually wants).
const FIXED_ENV_KEYS = new Set([...FIXED_ENV_KEYS_POSIX, ...FIXED_ENV_KEYS_WIN32]);

/** #1490 — resolve the correct home directory for a spawned child, per
 *  platform. Windows populates USERPROFILE / HOMEDRIVE+HOMEPATH, NOT
 *  HOME — the existing `process.env.HOME!` was undefined-passed-through
 *  and crashed the child on the first path operation. Precedent + comment
 *  in agent-node/src/runtime/grok-child-env.ts:53-58.
 *
 *  Throws when no home can be resolved (rare — stripped env / non-root
 *  container / etc). Fail-closed is correct here: silently forking a
 *  child with an unresolved home leads to the same undefined-path crash
 *  we're trying to eliminate, just later.
 *
 *  Takes env as a parameter (not process.env directly) so the Windows
 *  branch can be exercised on a Linux CI runner via unit test injection —
 *  same testability pattern used by #1290's platform-param plumb-through.
 */
export function resolveChildHome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    const home = env.USERPROFILE
      || env.HOME
      || (env.HOMEDRIVE && env.HOMEPATH ? env.HOMEDRIVE + env.HOMEPATH : "");
    if (!home) {
      throw new Error(
        "minimalEnv: cannot resolve Windows child HOME " +
        "(USERPROFILE, HOME, and HOMEDRIVE+HOMEPATH all missing). " +
        "Configure at least USERPROFILE for the daemon service account.",
      );
    }
    return home;
  }
  const home = env.HOME;
  if (!home) {
    throw new Error(
      "minimalEnv: cannot resolve POSIX child HOME (env.HOME missing). " +
      "Ensure the daemon service unit sets HOME.",
    );
  }
  return home;
}

/** #301 nvm fix (issue: spawned child shebang `#!/usr/bin/env node`
 *  finds no node when daemon runs under nvm / pnpm / Bun / custom
 *  installs where node is not in SAFE_PATH). Prepend daemon's own
 *  node bin dir to PATH for spawned children.
 *
 *  Trust root: process.execPath is daemon's own already-resolved
 *  node binary path (boot-time canonicalize, attacker can't change
 *  the running process's own argv0 dirname). NOT trusting env.PATH
 *  (that's C1 attacker surface). So no C1 / PATH-poison regression:
 *  hub-side validateEnvRefs still rejects env_refs:["PATH"] /
 *  ["LD_PRELOAD"] (G7/G8 invariant unchanged) — the only thing we
 *  add is a fixed dir name that the daemon process itself defines.
 */
function computeChildPath(): string {
  const execDir = dirname(process.execPath);
  // Skip prepend if execDir is already an early SAFE_PATH entry
  // (avoid duplicate path; canonical SAFE_PATH wins).
  const safeParts = SAFE_PATH.split(":");
  if (safeParts.includes(execDir)) return SAFE_PATH;
  return `${execDir}:${SAFE_PATH}`;
}

export function minimalEnv(
  extra: Record<string, string> = {},
  platform: NodeJS.Platform = process.platform,
  parentEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const filtered: Record<string, string> = {};
  const fixedKeys = fixedEnvKeysFor(platform);
  for (const [k, v] of Object.entries(extra)) {
    if (isReservedEnvKey(k)) {
      throw new Error(`minimalEnv: reserved env key ${k} reached fork (denylist gap — investigate)`);
    }
    if (fixedKeys.has(k)) {
      throw new Error(`minimalEnv: fixed env key ${k} reached fork`);
    }
    filtered[k] = v;
  }
  const home = resolveChildHome(parentEnv, platform);
  const base: NodeJS.ProcessEnv = {
    ...filtered,
    PATH: computeChildPath(),
    HOME: home,
    LANG: parentEnv.LANG || "C.UTF-8",
  };
  if (platform === "win32") {
    // #1490 — Windows-only. Node's os.homedir() and most tools read
    // USERPROFILE first; grok / claude / codex CLIs invoked as
    // grandchildren also need HOMEDRIVE+HOMEPATH to resolve %HOMEPATH%
    // in .bat wrappers and legacy Windows APIs.
    base.USERPROFILE = home;
    if (/^[A-Za-z]:/.test(home)) {
      // Standard drive-letter path — split at the 2nd char.
      // C:\Users\alice → HOMEDRIVE=C: HOMEPATH=\Users\alice
      base.HOMEDRIVE = home.slice(0, 2);
      base.HOMEPATH = home.slice(2);
    } else if (parentEnv.HOMEDRIVE && parentEnv.HOMEPATH) {
      // Non-drive-letter home (UNC path, weird service context) — fall
      // back to whatever the daemon inherited, on the assumption that
      // if the daemon is running with those values the child needs the
      // same. If neither branch fires the child just doesn't get
      // HOMEDRIVE/HOMEPATH — tools that need them will fail loudly.
      base.HOMEDRIVE = parentEnv.HOMEDRIVE;
      base.HOMEPATH = parentEnv.HOMEPATH;
    }
  }
  return base;
}

// ── §4.2.2 daemon-side spec validators (mirror of create-node-validate) ──
// We duplicate the structural validation here so an attacker who
// compromises hub still can't smuggle a bad spec past the daemon.

const NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;
// 与 server/src/create-node-validate.ts 同镜像:允许恰好一个 `/` 分隔的 provider/model(OpenCode 共存,
// 桌面向导 0.2.61 起发 `opencode/mimo-v2.5-free`),每段仍是原字符集且不能是纯点段。
const MODEL_SEGMENT = "[a-zA-Z0-9._:\\-]+";
const MODEL_RE = new RegExp(`^${MODEL_SEGMENT}(?:/${MODEL_SEGMENT})?$`);
const MODEL_DOT_ONLY_SEGMENT = /(^|\/)\.+(\/|$)/;
// #1298 — 必须与 agent-network/src/normalize-runtime.ts 的 SUPPORTED_RUNTIME_NAMES
// 逐字一致。两个包之间没有依赖关系（agent-node 不 import agent-network），所以这里
// 只能是一份副本；而副本靠纪律会漂 —— 本仓 im/access-resolve.ts 那对镜像就没有门。
// 因此 runtime-set-parity.test.ts 会跨包 import 两边并断言相等：改了 canonical 而
// 忘了这里，那条测试立刻红并告诉你差哪几个。
//
// 🔴 这个集合不能删。agent-network 的 createCommand 对未知 runtime 走的是
// else 分支（当作 claude-agent-sdk 继续），也就是**静默降级不报错**，所以
// launcher 目前不是权威。让 launcher 走 normalizeRuntimeStrict 是独立的一条。
const VALID_RUNTIMES = new Set([
  "claude-agent-sdk",
  "claude-code-cli",
  "codex-sdk",
  "codex-app-server",
  "grok-build-acp",
  "grok-build-cli",
  "opencode-cli",
]);
/** 测试钩子 —— 让 runtime-set-parity.test.ts 能拿到这份副本做跨包等价断言。
 *  只读用途，不要在产品代码里用它绕过 VALID_RUNTIMES 本身的检查。 */
export const _internals = { VALID_RUNTIMES };

const PERMISSION_MODES = new Set(["default", "acceptEdits", "plan", "bypassPermissions"]);

// §4.2.2 daemon-side flag VALUE validator — defense in depth, mirrors
// hub-side validateFlagValue (server/src/create-node-validate.ts). A
// compromised hub or mid-flight tampering could smuggle `maxTurns:
// "DROP TABLE"` or `dangerouslySkipPermissions: "true"` (string!) past
// hub's check; daemon catches it before the value reaches child config
// or fork argv. Per 通信牛 PR #299 BLOCKER #2.
export function validateFlagValueDaemon(k: string, v: unknown): void {
  switch (k) {
    case "permissionMode":
      if (typeof v !== "string" || !PERMISSION_MODES.has(v)) {
        throw new Error(`flag_value_invalid:${k}:must be default/acceptEdits/plan/bypassPermissions`);
      }
      return;
    case "dangerouslySkipPermissions":
      if (typeof v !== "boolean") throw new Error(`flag_value_invalid:${k}:must be boolean`);
      return;
    case "maxTurns":
      if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 9999) {
        throw new Error(`flag_value_invalid:${k}:must be integer 1..9999`);
      }
      return;
    case "budget":
      if (typeof v !== "number" || !Number.isFinite(v) || (v as number) < 0 || (v as number) > 1000) {
        throw new Error(`flag_value_invalid:${k}:must be number 0..1000`);
      }
      return;
    case "timeout":
      if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 86400) {
        throw new Error(`flag_value_invalid:${k}:must be integer 1..86400`);
      }
      return;
    default:
      throw new Error(`flag_key_unknown:${k}`);
  }
}

export interface DaemonNodeSpec {
  name: string;
  runtime: string;
  model?: string | null;
  flags?: Record<string, unknown>;
  channels?: unknown;
}

function kebab(k: string): string { return k.replace(/([A-Z])/g, "-$1").toLowerCase(); }

export function buildAnetArgsDaemon(spec: DaemonNodeSpec): string[] {
  if (!spec.name || !NAME_RE.test(spec.name)) throw new Error("node_name_invalid");
  if (!VALID_RUNTIMES.has(spec.runtime)) throw new Error("runtime_invalid");
  if (spec.model !== undefined && spec.model !== null &&
      (spec.model.length === 0 || spec.model.length > 100 || !MODEL_RE.test(spec.model) || MODEL_DOT_ONLY_SEGMENT.test(spec.model))) throw new Error("model_invalid");
  if (Array.isArray(spec.channels) && spec.channels.length > 0) throw new Error("channels_not_supported_in_p1");
  const args: string[] = ["node", "create", spec.name, "--runtime", spec.runtime];
  if (spec.model) args.push("--model", spec.model);
  for (const [k, v] of Object.entries(spec.flags || {})) {
    if (!["permissionMode", "dangerouslySkipPermissions", "maxTurns", "budget", "timeout"].includes(k)) {
      throw new Error(`flag_key_unknown:${k}`);
    }
    // §4.2.2 daemon double-layer: defense in depth (per 通信牛 PR
    // #299 BLOCKER #2). hub already filters, but a compromised hub
    // could smuggle `maxTurns: "DROP TABLE"` etc; we type/range
    // check before String() coerces into argv.
    validateFlagValueDaemon(k, v);
    args.push(`--${kebab(k)}`, String(v));
  }
  return args;
}

// §4.4.7 — duplicate of hub serializeEnvLocal (same escape rules).
export function serializeEnvLocalDaemon(env: Record<string, string>): string {
  return Object.entries(env).map(([k, v]) => {
    const esc = String(v)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r");
    return `${k}="${esc}"`;
  }).join("\n") + "\n";
}

// ── §2.5 step 3 — handle SSE doorbell ──────────────────────────────
// Caller (cli.ts SSE handler) invokes this when an SSE event of
// type=create_node arrives. We pull the request from hub, run +
// wait for child, then ack.

export interface CreateNodeDeps {
  callCommHub: (tool: string, args: Record<string, unknown>) => Promise<any>;
  workDir: string;                     // §4.2.3 WORK_DIR enforced cwd
  hubUrl: string;                       // daemon propagates its hub to child via global config
  log: (msg: string) => void;
  warn: (msg: string) => void;
  serializeEnvLocal: (env: Record<string, string>) => string;
  // §4.2 belt-and-suspenders: hub already filters runtime via the
  // daemon_capabilities.allowed_runtimes snapshot, but daemon repeats
  // the check using its own config — if hub is compromised or stale,
  // daemon still refuses runtimes the host operator hasn't whitelisted.
  // null/empty = accept any in the global enum (P1 default).
  allowedRuntimes?: ReadonlyArray<string> | null;
}

interface PendingCreateRequest {
  request_id?: unknown;
}

interface ListPendingCreateRequestsResult {
  ok?: boolean;
  error?: string;
  requests?: PendingCreateRequest[];
}

export interface ReconcilePendingCreateRequestsDeps {
  callCommHub: (tool: string, args: Record<string, unknown>) => Promise<any>;
  handleCreateNodeDoorbell: (event: { request_id: string }) => Promise<void>;
  recentlyHandledRequestIds?: Set<string>;
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

export async function reconcilePendingCreateRequestsOnConnect(
  deps: ReconcilePendingCreateRequestsDeps,
): Promise<void> {
  const res: ListPendingCreateRequestsResult = await deps.callCommHub("list_my_pending_create_requests", {});
  if (!res?.ok) {
    deps.warn(`[create-node] pending reconcile failed: ${res?.error || "unknown"}`);
    return;
  }
  const requests = Array.isArray(res.requests) ? res.requests : [];
  let handled = 0;
  for (const row of requests) {
    const requestId = typeof row?.request_id === "string" ? row.request_id : "";
    if (!requestId) continue;
    if (deps.recentlyHandledRequestIds?.has(requestId)) continue;
    deps.recentlyHandledRequestIds?.add(requestId);
    try {
      await deps.handleCreateNodeDoorbell({ request_id: requestId });
      handled += 1;
    } catch (e: any) {
      deps.recentlyHandledRequestIds?.delete(requestId);
      deps.warn(`[create-node] pending reconcile handler failed for ${requestId}: ${e?.message || e}`);
    }
  }
  if (handled > 0) deps.log(`[create-node] pending reconcile handled ${handled} request(s)`);
}

/** §2.5 step 3 helper — ensure $HOME/.anet/config.json carries the
 *  daemon's hub URL so the spawned `anet node create + start` doesn't
 *  bail with `未找到 CommHub Server`. Idempotent. */
export function ensureGlobalAnetConfig(home: string, hubUrl: string): void {
  const dir = join(home, ".anet");
  const path = join(dir, "config.json");
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* ok */ }
  repairPrivateConfigPermissions(path);
  let cur: Record<string, any> = {};
  try { cur = JSON.parse(readFileSync(path, "utf-8")); } catch { /* fresh */ }
  if (cur.hub !== hubUrl) {
    cur.hub = hubUrl;
    atomicWriteJson(path, cur);
  }
}

interface GetCreateRequestResult {
  ok: boolean;
  error?: string;
  request_id?: string;
  node_spec?: DaemonNodeSpec;
  child_token?: string;
  env_blob?: Record<string, string>;
}

export async function handleCreateNodeDoorbell(
  event: { request_id: string },
  deps: CreateNodeDeps,
): Promise<void> {
  const { request_id } = event;
  const req: GetCreateRequestResult = await deps.callCommHub("get_create_request", { request_id });
  if (!req?.ok || !req.node_spec || !req.child_token) {
    deps.warn(`[create-node] get_create_request failed: ${req?.error || "unknown"}`);
    await deps.callCommHub("ack_create_request", {
      request_id, status: "failed", error: req?.error || "get_failed",
    }).catch(() => {});
    return;
  }

  // §4.2 daemon-side runtime allowlist fallback (belt-and-suspenders;
  // hub already enforces, this catches hub-bypass / compromised-hub).
  if (deps.allowedRuntimes && deps.allowedRuntimes.length > 0 &&
      !deps.allowedRuntimes.includes(req.node_spec.runtime)) {
    deps.warn(`[create-node] runtime '${req.node_spec.runtime}' not in daemon's allowed_runtimes: [${deps.allowedRuntimes.join(",")}]`);
    await deps.callCommHub("ack_create_request", {
      request_id, status: "rejected", error: `runtime_not_in_local_allowlist: ${req.node_spec.runtime}`,
    }).catch(() => {});
    return;
  }

  let args: string[];
  try {
    args = buildAnetArgsDaemon(req.node_spec);
  } catch (e: any) {
    deps.warn(`[create-node] spec rejected by daemon-side validate: ${e?.message || e}`);
    await deps.callCommHub("ack_create_request", {
      request_id, status: "rejected", error: `validate: ${e?.message || e}`,
    }).catch(() => {});
    return;
  }

  // Resolve anet binary (install-time pin, never PATH lookup at runtime)
  let anetBin: string;
  try {
    anetBin = getAnetBinAbs();
  } catch (e: any) {
    deps.warn(`[create-node] anet_bin_unsafe_path: ${e?.message || e}`);
    await deps.callCommHub("ack_create_request", {
      request_id, status: "failed", error: `bin: ${e?.message || e}`,
    }).catch(() => {});
    return;
  }

  // Ensure WORK_DIR exists
  try { mkdirSync(deps.workDir, { recursive: true, mode: 0o700 }); } catch { /* ok */ }

  // P1: ensure global ~/.anet/config.json has hub so `anet node start`
  // can resolve the hub even when called from minimalEnv. Idempotent.
  // #1490 — was `process.env.HOME!` which passed undefined on Windows and
  // crashed the write with `undefined/.anet/config.json`. resolveChildHome
  // reads Windows env cascade (USERPROFILE / HOMEDRIVE+HOMEPATH / HOME).
  try { ensureGlobalAnetConfig(resolveChildHome(process.env, process.platform), deps.hubUrl); }
  catch (e: any) { deps.warn(`[create-node] global config write failed (continuing): ${e?.message || e}`); }

  // Step 1 — write child config.json directly.
  //
  // P1 simplification: we bypass `anet node create` (which requires a
  // user-login utok in global config + would mint its own ntok we'd
  // overwrite anyway). Hub already minted the child-ntok via the
  // create_node MCP tool path; we just write a minimal but complete
  // per-node config and let `anet node start` boot from it.
  //
  // The `args` array (validated by buildAnetArgsDaemon) is the source
  // of truth for runtime/model/flags — we map it back to config keys.
  // F2 security: args were already structurally validated; this map
  // is a JSON write, no shell.
  const childDir = join(deps.workDir, ".anet", "nodes", req.node_spec.name);
  try { mkdirSync(childDir, { recursive: true, mode: 0o700 }); } catch { /* ok */ }
  const childCfgPath = join(childDir, "config.json");
  const flagsObj: Record<string, unknown> = req.node_spec.flags || {};
  // Best-effort: also derive `permissionMode` etc into a `flags` block
  // for the agent-node config shape. anet-node consults config.flags +
  // flat keys; flat keys win, so we write flat for safety.
  try {
    const childCfg: Record<string, any> = {
      node_id: `node_${request_id.replace(/^cr_/, "")}`,
      node_name: req.node_spec.name,
      alias: req.node_spec.name,
      runtime: req.node_spec.runtime,
      ...(req.node_spec.model ? { model: req.node_spec.model } : {}),
      hub: deps.hubUrl,
      token: req.child_token,
      ...(Object.keys(flagsObj).length ? { flags: flagsObj } : {}),
    };
    atomicWriteJson(childCfgPath, childCfg);
    deps.log(`[create-node] wrote child config: ${childCfgPath}`);
  } catch (e: any) {
    deps.warn(`[create-node] write child config failed: ${e?.message || e}`);
    await deps.callCommHub("ack_create_request", {
      request_id, status: "failed", error: `write_config: ${e?.message || e}`,
    }).catch(() => {});
    return;
  }
  void args;     // args validated; we'll use them on Phase 2 follow-up if anet node create lands an --unattended flag
  if (req.env_blob && Object.keys(req.env_blob).length > 0) {
    const envFile = join(deps.workDir, ".anet", "nodes", req.node_spec.name, ".env.local");
    try {
      atomicWritePrivateText(envFile, deps.serializeEnvLocal(req.env_blob));
    } catch (e: any) {
      deps.warn(`[create-node] env.local write failed: ${e?.message || e}`);
      // not fatal — proceed to start; hub will see status=succeeded but
      // child might fail on first vendor call. Acceptable for P1.
    }
  }

  // Step 3 — anet node start <name> in background (detached).
  //
  // N站马 N#19 联调 (通信龙 5149126c) — spawn hardening + immediate
  // kill-0 self-verify. Docker repro shows the chain stays alive
  // across daemon SIGTERM, but additive defenses for env-specific
  // edge cases (interactive terminal SIGHUP, inherited fd lifecycle,
  // child insta-crash post-spawn):
  //   - explicit stdio array [ignore, ignore, ignore] (no chance of
  //     ipc/inherit fd lifecycle coupling)
  //   - detached: true (Linux setsid; child becomes new session leader,
  //     immune to terminal SIGHUP + parent death by signal)
  //   - close any returned stream handles (belt — should be null
  //     under stdio:"ignore" array, harmless if not)
  //   - child.unref() removes child from this process's event loop
  //   - kill-0 self-verify: if child crashed in the few ms since spawn
  //     return, process.kill(pid, 0) throws ESRCH and we ack 'failed'
  //     rather than 'started' (catches N站马's "registered then dead"
  //     symptom if the real cause is insta-crash on first vendor call /
  //     missing API key / config issue)
  let childPid = -1;
  try {
    const child = spawn(anetBin, ["node", "start", req.node_spec.name], {
      cwd: deps.workDir,
      env: minimalEnv(),
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    childPid = child.pid || -1;
    try { child.stdin?.destroy(); } catch { /* ok */ }
    try { child.stdout?.destroy(); } catch { /* ok */ }
    try { child.stderr?.destroy(); } catch { /* ok */ }
    child.unref();
    deps.log(`[create-node] spawned child '${req.node_spec.name}' pid=${childPid}`);

    if (childPid > 0) {
      try {
        process.kill(childPid, 0);
        deps.log(`[create-node] post-spawn kill-0 verify OK: pid=${childPid} alive`);
      } catch (kerr: any) {
        const msg = `child died immediately after spawn: ${kerr?.message || kerr}`;
        deps.warn(`[create-node] ${msg}`);
        await deps.callCommHub("ack_create_request", {
          request_id, status: "failed", error: msg,
        }).catch(() => {});
        return;
      }
    }
  } catch (e: any) {
    const msg = (e?.message || String(e)).slice(0, 800);
    deps.warn(`[create-node] fork (start) failed: ${msg}`);
    await deps.callCommHub("ack_create_request", {
      request_id, status: "failed", error: `fork_start: ${msg}`,
    }).catch(() => {});
    return;
  }

  // RFC-027 §2.4 — record the spawned child in the daemon's children_map
  //
  // 🔴 #1293:这一块原本排在下面那个 +5000ms 能力检查**之后**。子节点在 spawn 的
  //    那一刻就已经对 hub 可见,于是「hub 认识它」和「daemon 能操作它」之间有约 5 秒缺口——
  //    这段时间内任何 stop_node / delete_node 都 ack `noop_not_my_child`,hub 侧不收敛。
  //    真机实测:13:17:28 spawned → 13:17:30 stop 找不到 map 条目 → 13:17:33 才记上。
  //
  //    搬到能力检查之前,并在能力检查失败的那条 return 上配一次 forgetSpawnedChild ——
  //    **只搬不配移除会留下死条目**,而 handleStopDoorbell 会照着它去 signal 一个不存在的 pid。
  //    那正是记录原本排在后面的理由,不是疏忽。
  // so a later SSE stop_node doorbell knows which PID to signal.
  //
  // Lookup key MUST exactly match the hub's canonical child node_id.
  // The hub mints it from request_id at child config write time (line
  // 363 above: `node_${request_id.replace(/^cr_/, "")}`); when the
  // child later calls register, that's the node_id row inserted in
  // `nodes`, and the same string flows back to the daemon via
  // get_stop_request as child_node_id (server/src/tools.ts ~2586).
  //
  // PR1 v2 BLOCKER-1 catch (通信龙 deep review): I previously fell back
  // to `node_${req.node_spec.name}` when (req as any).child_node_id was
  // absent — but get_create_request never carries child_node_id at all,
  // so the fallback ALWAYS fired and the recorded key never matched
  // the hub's. Every stop/delete dispatch then noop'd at the daemon
  // ("noop_not_my_child"), the hub never finalized state, and the
  // child process kept running. The fix is to mint the same string the
  // hub uses — request_id is in scope here.
  if (childPid > 0 && typeof req.node_spec.name === "string") {
    try {
      const child_node_id = `node_${request_id.replace(/^cr_/, "")}`;
      const { recordSpawnedChild } = await import("./stop-daemon.js");
      recordSpawnedChild(child_node_id, req.node_spec.name, childPid);
    } catch (e: any) {
      deps.warn(`[create-node] childrenMap record failed (stop-daemon won't see this child): ${e?.message || e}`);
    }
  }

  // RFC-026 §9.3 D2 / #338 PR3 — capability fail-fast.
  // Survives-5-seconds is the real "started" signal: the existing kill-0
  // catches insta-die (binary missing / spawn-exec fail / SIGSEGV), but
  // a daemon that declared `runtimes_supported: ["codex-sdk"]` without
  // the codex binary or `OPENAI_API_KEY` configured produces a child
  // that starts OK then dies mid-bootstrap (vendor adapter init throws).
  // 通信龙 §9.3 nit: "declared ≠ guarantee" — declare is for dashboard
  // candidate filtering, spawn is the truth check.
  //
  // Wait 5s + re-kill-0. Dashboard's create flow tolerates ≤30s.
  // If dead → ack `runtime_capability_check_failed` so hub marks the
  // request failed with the right reason (audit_log "daemon_capability_lied"
  // surfaces the gap between declaration and reality).
  const FAIL_FAST_MS = 5_000;
  await new Promise<void>(resolve => setTimeout(resolve, FAIL_FAST_MS));
  let stillAlive = false;
  if (childPid > 0) {
    try {
      process.kill(childPid, 0);
      stillAlive = true;
      deps.log(`[create-node] +${FAIL_FAST_MS}ms capability check OK: pid=${childPid} still alive`);
    } catch (kerr: any) {
      const msg = `child died within ${FAIL_FAST_MS}ms post-spawn (likely missing runtime binary or auth for runtime='${req.node_spec.runtime}'): ${kerr?.message || kerr}`;
      deps.warn(`[create-node] runtime_capability_check_failed: ${msg}`);
      // #1293:记录已经提前到 spawn 之后,这条失败路径必须把它撤掉,
      // 否则 map 里留一条指向已死 pid 的条目,stop doorbell 会去 signal 它。
      try {
        const { forgetSpawnedChild } = await import("./stop-daemon.js");
        const removed = forgetSpawnedChild(`node_${request_id.replace(/^cr_/, "")}`);
        deps.log(`[create-node] childrenMap rollback after capability failure: removed=${removed}`);
      } catch (e: any) {
        deps.warn(`[create-node] childrenMap rollback failed: ${e?.message || e}`);
      }
      await deps.callCommHub("ack_create_request", {
        request_id,
        status: "runtime_capability_check_failed",
        error: msg.slice(0, 800),
        runtime: req.node_spec.runtime,
      }).catch(() => {});
      return;
    }
  }
  void stillAlive;


  // Step 4 — ack 'started' (success path; hub flips to 'succeeded' on
  // child's first report_status content-match)
  await deps.callCommHub("ack_create_request", {
    request_id, status: "started", child_pid: childPid,
  }).catch((e: any) => deps.warn(`[create-node] ack failed: ${e?.message || e}`));
}

/* ────────────────────────────────────────────────────────────────────────────
 * #1545 PR1 —— 把「能不能起节点」变成一个**可以被问、且会回答**的值。
 *
 * 现状:上面那个解析器只有一种表达方式 —— 抛异常。守护进程启动时它抛,进程就退;
 * 但**没有任何命令能在不引发那次退出的前提下问出同一个判断**,于是 daemon 显示
 * 在线、`node create` 却必失败,而中间每一层都没有话说(#1545 的 B 路)。
 *
 * 🔴 这里**不重写解析逻辑,只把 throw 翻译成 return**。
 *    理由:判据只能有一个作者。如果探针自己再判一遍,两份判据就会各自漂移 ——
 *    到那时「探针说 ready、create 仍然失败」会比现在的沉默更难查,因为它看起来
 *    像已经检查过了。(这是对 problem statement 里「抽出不抛异常的核心」的一处
 *    收窄:包一层比拆开更小、且**逐字不变是构造性的**,不需要靠测试去证明。)
 *
 * 🔴 `code` 的第五个取值**沿用 `anet_bin_unknown`,不新造名字**。#1353 已经在
 *    `config-apply.ts` 的 `create_nodes_blocked_reason` 里定义了它(「拿不到类别时
 *    的兜底」),hub 的 zod enum(`server/src/tools.ts`)也已经收这个值。
 *    我一度想叫 `anet_bin_unclassified` —— 那是**造同义副本**:两个名字同一个含义,
 *    以后只会有一个被改到。
 *    它不是占位:`loadAndVerifyAnetBin` 里 **sha256 mismatch 那条抛的是裸 Error、
 *    没有挂 anetBinCode**(同文件其余 8 个 throw 点都走 `unsafePathHelp`),
 *    所以确实无类别可挂。把它硬塞进四类中任何一类都是编的。
 *
 * 🔴 这里**没有 unknown 态**。unknown 的含义是「daemon 根本没上报过这一格」,
 *    那是传输/显示层的状态(PR2/PR4),探针跑到了就一定有答案。 */
export type AnetBinReadiness =
  | { readonly state: "ready"; readonly abs: string }
  | {
      readonly state: "blocked";
      readonly code: AnetBinFailureCode | "anet_bin_unknown";
      /** 人读的整句,含解析器给出的 `Fix: …` 那半 —— 不另存一份副本,
       *  否则修法会有两处、而只有一处会被改。 */
      readonly detail: string;
    };

export function probeAnetBinReadiness(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): AnetBinReadiness {
  try {
    return { state: "ready", abs: loadAndVerifyAnetBin(env, platform) };
  } catch (error) {
    const code = (error as AnetBinError | null)?.anetBinCode;
    return {
      state: "blocked",
      code: code ?? "anet_bin_unknown",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
