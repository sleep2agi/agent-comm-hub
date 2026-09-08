import { describe, expect, test } from "bun:test";
import {
  validateFlagValueDaemon,
  buildAnetArgsDaemon,
  minimalEnv,
  loadAndVerifyAnetBin,
  probeAnetBinReadiness,
  ensureGlobalAnetConfig,
  reconcilePendingCreateRequestsOnConnect,
  resolveChildHome,
  defaultPathConf,
  _resetWindowsPosixModeWarnLatchForTest,
} from "./create-node-daemon.js";
import { win32 as pathWin32 } from "node:path";
import { writeFileSync, mkdirSync, symlinkSync, chmodSync, unlinkSync, rmSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

describe("create_node pending reconciliation after SSE connect", () => {
  test("pulls and handles pending requests that arrived while SSE was disconnected", async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const handled: string[] = [];

    await reconcilePendingCreateRequestsOnConnect({
      callCommHub: async (tool, args) => {
        calls.push({ tool, args });
        if (tool === "list_my_pending_create_requests") {
          return { ok: true, count: 1, requests: [{ request_id: "cr_missed_doorbell" }] };
        }
        throw new Error(`unexpected tool ${tool}`);
      },
      handleCreateNodeDoorbell: async (event) => {
        handled.push(event.request_id);
      },
      log: () => {},
      warn: () => {},
    });

    expect(calls.map((c) => c.tool)).toEqual(["list_my_pending_create_requests"]);
    expect(handled).toEqual(["cr_missed_doorbell"]);
  });

  test("deduplicates request_ids already handled from the live SSE doorbell path", async () => {
    const handled: string[] = [];

    await reconcilePendingCreateRequestsOnConnect({
      callCommHub: async () => ({
        ok: true,
        count: 3,
        requests: [
          { request_id: "cr_live" },
          { request_id: "cr_live" },
          { request_id: "cr_pending" },
        ],
      }),
      handleCreateNodeDoorbell: async (event) => {
        handled.push(event.request_id);
      },
      recentlyHandledRequestIds: new Set(["cr_live"]),
      log: () => {},
      warn: () => {},
    });

    expect(handled).toEqual(["cr_pending"]);
  });
});

describe("#633 daemon private state", () => {
  const fixture = "/tmp/anet-test633-daemon-private";

  test("global config repair and replacement converge to private state", () => {
    rmSync(fixture, { recursive: true, force: true });
    const parent = join(fixture, ".anet");
    const config = join(parent, "config.json");
    mkdirSync(parent, { recursive: true, mode: 0o755 });
    writeFileSync(config, JSON.stringify({ token: "ntok_fixture", hub: "old" }), { mode: 0o666 });
    chmodSync(config, 0o666);

    ensureGlobalAnetConfig(fixture, "http://hub.test");

    expect(statSync(parent).mode & 0o777).toBe(0o700);
    expect(statSync(config).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
      token: "ntok_fixture",
      hub: "http://hub.test",
    });
    rmSync(fixture, { recursive: true, force: true });
  });

  test("global config read refuses a symlink without touching its target", () => {
    rmSync(fixture, { recursive: true, force: true });
    const parent = join(fixture, ".anet");
    const config = join(parent, "config.json");
    const victim = join(fixture, "victim.json");
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    writeFileSync(victim, '{"sentinel":"unchanged"}\n', { mode: 0o600 });
    symlinkSync(victim, config);

    expect(() => ensureGlobalAnetConfig(fixture, "http://hub.test")).toThrow(/linked|refuses/);
    expect(readFileSync(victim, "utf8")).toBe('{"sentinel":"unchanged"}\n');
    rmSync(fixture, { recursive: true, force: true });
  });
});

describe("§4.2.2 daemon-side flag VALUE validator (BLOCKER #2 — defense in depth)", () => {
  test("permissionMode enum", () => {
    expect(() => validateFlagValueDaemon("permissionMode", "default")).not.toThrow();
    expect(() => validateFlagValueDaemon("permissionMode", "plan")).not.toThrow();
    expect(() => validateFlagValueDaemon("permissionMode", "bogus")).toThrow(/flag_value_invalid/);
    expect(() => validateFlagValueDaemon("permissionMode", 123)).toThrow(/flag_value_invalid/);
  });
  test("dangerouslySkipPermissions boolean (string 'true' must be rejected)", () => {
    expect(() => validateFlagValueDaemon("dangerouslySkipPermissions", true)).not.toThrow();
    expect(() => validateFlagValueDaemon("dangerouslySkipPermissions", false)).not.toThrow();
    expect(() => validateFlagValueDaemon("dangerouslySkipPermissions", "true")).toThrow(/flag_value_invalid/);
    expect(() => validateFlagValueDaemon("dangerouslySkipPermissions", 1)).toThrow(/flag_value_invalid/);
  });
  test("maxTurns integer range — 'DROP TABLE' / float / out-of-range rejected", () => {
    expect(() => validateFlagValueDaemon("maxTurns", 50)).not.toThrow();
    expect(() => validateFlagValueDaemon("maxTurns", 1)).not.toThrow();
    expect(() => validateFlagValueDaemon("maxTurns", 9999)).not.toThrow();
    expect(() => validateFlagValueDaemon("maxTurns", "DROP TABLE")).toThrow(/flag_value_invalid/);
    expect(() => validateFlagValueDaemon("maxTurns", 0)).toThrow(/flag_value_invalid/);
    expect(() => validateFlagValueDaemon("maxTurns", 10000)).toThrow(/flag_value_invalid/);
    expect(() => validateFlagValueDaemon("maxTurns", 5.5)).toThrow(/flag_value_invalid/);
  });
  test("budget number with decimals allowed; out-of-range rejected", () => {
    expect(() => validateFlagValueDaemon("budget", 0)).not.toThrow();
    expect(() => validateFlagValueDaemon("budget", 5.5)).not.toThrow();
    expect(() => validateFlagValueDaemon("budget", 1000)).not.toThrow();
    expect(() => validateFlagValueDaemon("budget", -1)).toThrow(/flag_value_invalid/);
    expect(() => validateFlagValueDaemon("budget", 1001)).toThrow(/flag_value_invalid/);
    expect(() => validateFlagValueDaemon("budget", "free")).toThrow(/flag_value_invalid/);
    expect(() => validateFlagValueDaemon("budget", Infinity)).toThrow(/flag_value_invalid/);
  });
  test("timeout integer range", () => {
    expect(() => validateFlagValueDaemon("timeout", 600)).not.toThrow();
    expect(() => validateFlagValueDaemon("timeout", 1)).not.toThrow();
    expect(() => validateFlagValueDaemon("timeout", 86400)).not.toThrow();
    expect(() => validateFlagValueDaemon("timeout", 0)).toThrow(/flag_value_invalid/);
    expect(() => validateFlagValueDaemon("timeout", 86401)).toThrow(/flag_value_invalid/);
  });
  test("unknown key rejected", () => {
    expect(() => validateFlagValueDaemon("evilKey", true)).toThrow(/flag_key_unknown/);
  });
});

describe("buildAnetArgsDaemon now reaches flag value validation", () => {
  test("happy path with mixed flags", () => {
    const args = buildAnetArgsDaemon({
      name: "x", runtime: "claude-agent-sdk", model: "claude-opus-4.6",
      flags: { maxTurns: 50, budget: 5.5, permissionMode: "plan" },
    });
    expect(args).toContain("--max-turns");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("50");
    expect(args[args.indexOf("--budget") + 1]).toBe("5.5");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan");
  });
  test("omitted model is allowed and does not emit --model", () => {
    const args = buildAnetArgsDaemon({
      name: "x", runtime: "claude-agent-sdk",
      flags: { maxTurns: 50 },
    });
    expect(args).toEqual(["node", "create", "x", "--runtime", "claude-agent-sdk", "--max-turns", "50"]);
  });
  test("empty model is still rejected", () => {
    expect(() => buildAnetArgsDaemon({
      name: "x", runtime: "claude-agent-sdk", model: "",
    })).toThrow(/model_invalid/);
  });
  test("provider/model (OpenCode co-presence) passes; two slashes, edge slashes and dot-only segments are rejected", () => {
    const args = buildAnetArgsDaemon({ name: "x", runtime: "opencode-cli", model: "opencode/mimo-v2.5-free" });
    expect(args).toContain("opencode/mimo-v2.5-free");
    for (const bad of ["a/b/c", "/model", "provider/", "../x", "x/.", "open code/m"]) {
      expect(() => buildAnetArgsDaemon({ name: "x", runtime: "opencode-cli", model: bad })).toThrow(/model_invalid/);
    }
  });
  test("smuggled string maxTurns rejected by daemon even if hub missed", () => {
    expect(() => buildAnetArgsDaemon({
      name: "x", runtime: "claude-agent-sdk", model: "x",
      flags: { maxTurns: "DROP TABLE" as any },
    })).toThrow(/flag_value_invalid/);
  });
  test("smuggled string dangerouslySkipPermissions rejected", () => {
    expect(() => buildAnetArgsDaemon({
      name: "x", runtime: "claude-agent-sdk", model: "x",
      flags: { dangerouslySkipPermissions: "true" as any },
    })).toThrow(/flag_value_invalid/);
  });
  test("name shell-metachar still rejected (existing validateName, F2)", () => {
    expect(() => buildAnetArgsDaemon({
      name: ";rm -rf /", runtime: "claude-agent-sdk", model: "x",
    })).toThrow(/node_name_invalid/);
  });
  test("runtime enum still enforced", () => {
    expect(() => buildAnetArgsDaemon({
      name: "x", runtime: "bash", model: "x",
    })).toThrow(/runtime_invalid/);
  });
  test("channels non-empty rejected (P1 fail-closed)", () => {
    expect(() => buildAnetArgsDaemon({
      name: "x", runtime: "claude-agent-sdk", model: "x",
      channels: ["telegram"] as any,
    })).toThrow(/channels_not_supported_in_p1/);
  });
});

describe("§4.2.6 B2 loadAndVerifyAnetBin — install-time pin 5-check (BLOCKER #3 hardened)", () => {
  const FIXTURE_DIR = "/tmp/anet-bin-test-fixtures";

  function setup(name: string, body = "#!/bin/sh\necho real"): string {
    const pkgDir = join(FIXTURE_DIR, `${name}-pkg`);
    const binDir = join(pkgDir, "dist", "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({
      name: "@sleep2agi/agent-network",
      bin: { anet: "dist/bin/anet.cjs" },
    }));
    const p = join(binDir, "anet.cjs");
    writeFileSync(p, body, { mode: 0o755 });
    return p;
  }
  function cleanup() {
    try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  }

  test("happy path with hash witness", () => {
    cleanup();
    const p = setup("good", "fake-binary-bytes");
    const expectedHash = createHash("sha256").update("fake-binary-bytes").digest("hex");
    const got = loadAndVerifyAnetBin({
      ANET_BIN_ABS: p,
      ANET_BIN_SHA256: expectedHash,
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
      ANET_DAEMON_ALLOW_NON_ROOT_BIN: "1",  // test runs as non-root
    });
    expect(got).toBe(p);
    cleanup();
  });

  test("REJECT: no ANET_BIN_ABS at all", () => {
    expect(() => loadAndVerifyAnetBin({
      ANET_DAEMON_PATH_CONF: "/nonexistent",
    })).toThrow(/anet_bin_unsafe_path.*no ANET_BIN_ABS/);
  });

  // #1353 —— anet_bin_source 的 `Fix:` 那半是用户唯一拿到的修法。它在 2026-08-30 之前
  // **两处都坏**：shell 语法就不成立（`$( )` 里的 `\"`），以及 `install -d /etc/...` 少了
  // sudo 导致 `&&` 断链、后面的 `sudo tee` 永不执行。两个坏法的共同点是
  // **照敲一遍不会报"你没权限"，而是留下一个仍然没修好的系统** —— 用户以为修过了。
  //
  // 所以这里断言的不是"文案里有 sudo"这种字面，而是**这条命令的结构性质**：
  //   ① 创建目录那一步必须带 sudo（否则断链）
  //   ② 不出现 `$( … \" … )` 这种在命令替换里反斜杠转义引号的形状（bash 直接语法错误）
  // 平台分支只测 POSIX —— Windows 那条是 PowerShell，不适用本判据。
  test("anet_bin_source 的修复命令必须可执行：sudo 盖住建目录 + 无 $( \" ) 语法错误 (#1353)", () => {
    const posixFix = (): string => {
      try {
        loadAndVerifyAnetBin({ ANET_DAEMON_PATH_CONF: "/nonexistent" }, "linux");
      } catch (e: any) {
        return String(e?.message ?? "");
      }
      throw new Error("expected loadAndVerifyAnetBin to throw");
    };
    const msg = posixFix();
    expect(msg).toMatch(/anet_bin_unsafe_path/);

    // ① 建目录必须在 sudo 之下。裸 `install -d /etc/anet-daemon` 普通用户 exit 1。
    expect(msg).toContain("sudo install -d -m 0755 /etc/anet-daemon");
    expect(msg).not.toMatch(/(^|[^o] )install -d -m 0755 \/etc\/anet-daemon/);

    // ② node 的内联脚本必须用**单引号**包。坏掉的那一版写成
    //    `node -e \"console.log(require('fs')…)\"`，而它整个又处在 `$( )` 里、
    //    外层还有双引号 —— bash 看到的是 `$(node -e \"…`，直接
    //    `syntax error near unexpected token '('`（实测 `bash -n` rc=2）。
    //    单引号包脚本、脚本内部用 "fs"，两层引号才不打架。
    //    🔴 这条断言的第一版写成「命令替换里不出现 \\" 」，看着更"直指语法"，
    //       但**变异后仍然全绿** —— 因为运行时字符串里根本没有反斜杠，
    //       那个形状只存在于 TS 源码里。断言要钉运行时真有的性质。
    const cmd = msg.slice(msg.indexOf("Fix: ") + 5);
    expect(cmd).toContain("node -e 'console.log(require(");
    expect(cmd).not.toContain('node -e "console.log');
  });

  // #1353 续 —— `no ANET_BIN_ABS resolved` 这一支（既没有 path.conf、也没有环境变量）
  // 是实际最常撞到的一支：DEV 上一台已连续在线 15h 的 daemon 就正处在这个状态。
  // 它原先**只给出那条要 root 的 path.conf 命令**，而代码里其实还有一条不需要任何
  // 权限的路：`prepareDaemonAnetBin()`（agent-network/bin/cli.ts:8284）会设置
  // ANET_BIN_ABS + ANET_DAEMON_ALLOW_ENV_BIN，并由 cli.ts:6336 透传进子进程 env；
  // 而它**只在 `anet daemon init|start|up` 三条命令上被调用**（cli.ts:8346-8348）。
  // ⇒ 用 `anet node start` / pm2 / systemd 起的 daemon 永远拿不到 pin，
  //   而重新用 `anet daemon start` 起一次就可能修好，不需要 root。
  //
  // 只给一条需要 root 的修法，会把人推去在生产机上求 sudo —— 而更省的那条就在代码里。
  test("anet_bin_source (no pin at all) 必须同时给出不需要 root 的那条路 (#1353)", () => {
    let msg = "";
    try {
      loadAndVerifyAnetBin({ ANET_DAEMON_PATH_CONF: "/nonexistent" }, "linux");
      throw new Error("expected loadAndVerifyAnetBin to throw");
    } catch (e: any) { msg = String(e?.message ?? ""); }

    // 走的确实是「什么 pin 都没有」那一支，不是 env-fallback-disabled 那支
    expect(msg).toContain("no ANET_BIN_ABS resolved");

    // 需要 root 的那条仍然在（不是替换，是补充）
    expect(msg).toContain("sudo install -d -m 0755 /etc/anet-daemon");
    // 不需要 root 的那条必须点名具体命令，且说清为什么它可能有效
    expect(msg).toContain("anet daemon start");
    expect(msg).toMatch(/anet daemon init\|start\|up/);
    expect(msg).toContain("pm2");
  });

  test("REJECT: ANET_BIN_ABS env fallback without explicit opt-in", () => {
    cleanup();
    const p = setup("env-fallback-disabled");
    expect(() => loadAndVerifyAnetBin({
      ANET_BIN_ABS: p,
      ANET_DAEMON_PATH_CONF: "/nonexistent",
    })).toThrow(/ANET_BIN_ABS env fallback disabled.*ANET_DAEMON_ALLOW_ENV_BIN=1/);
    cleanup();
  });

  test("ACCEPT: ANET_BIN_ABS env fallback when explicitly opted in", () => {
    cleanup();
    const p = setup("env-fallback-enabled");
    expect(loadAndVerifyAnetBin({
      ANET_BIN_ABS: p,
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
      ANET_DAEMON_PATH_CONF: "/nonexistent",
    })).toBe(p);
    cleanup();
  });

  test("path.conf wins over ANET_BIN_ABS env fallback", () => {
    cleanup();
    const confBin = setup("conf-bin");
    const envBin = setup("env-bin");
    const conf = join(FIXTURE_DIR, "path.conf");
    writeFileSync(conf, `ANET_BIN_ABS=${confBin}\n`);
    expect(loadAndVerifyAnetBin({
      ANET_DAEMON_PATH_CONF: conf,
      ANET_BIN_ABS: envBin,
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
    })).toBe(confBin);
    cleanup();
  });

  test("REJECT: relative path", () => {
    expect(() => loadAndVerifyAnetBin({
      ANET_BIN_ABS: "anet",
      ANET_DAEMON_PATH_CONF: "/nonexistent",
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
    })).toThrow(/anet_bin_unsafe_path.*not absolute/);
  });

  test("REJECT: symlink (contains symlink component)", () => {
    cleanup();
    const realBin = setup("real", "real-content");
    const symlinkPath = join(FIXTURE_DIR, "via-symlink");
    try { unlinkSync(symlinkPath); } catch { /* ok */ }
    symlinkSync(realBin, symlinkPath);
    expect(() => loadAndVerifyAnetBin({
      ANET_BIN_ABS: symlinkPath,
      ANET_DAEMON_PATH_CONF: "/nonexistent",
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
      ANET_DAEMON_ALLOW_NON_ROOT_BIN: "1",
    })).toThrow(/anet_bin_unsafe_path.*symlink/);
    cleanup();
  });

  test("REJECT: non-anet absolute path is not chmodded", () => {
    cleanup();
    mkdirSync(FIXTURE_DIR, { recursive: true });
    const p = join(FIXTURE_DIR, "not-anet");
    writeFileSync(p, "#!/bin/sh\necho nope", { mode: 0o777 });
    chmodSync(p, 0o777);
    expect(() => loadAndVerifyAnetBin({
      ANET_BIN_ABS: p,
      ANET_DAEMON_PATH_CONF: "/nonexistent",
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
    })).toThrow(/anet_bin_unsafe_path.*not an anet package bin/);
    expect(statSync(p).mode & 0o777).toBe(0o777);
    cleanup();
  });

  test("REJECT: forged agent-network package bin is not chmodded", () => {
    cleanup();
    const p = setup("forged", "#!/usr/bin/env node\n// fake\n");
    chmodSync(p, 0o777);
    expect(() => loadAndVerifyAnetBin({
      ANET_BIN_ABS: p,
      ANET_DAEMON_PATH_CONF: "/nonexistent",
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
    })).toThrow(/anet_bin_unsafe_path.*writable by group\/other/);
    expect(statSync(p).mode & 0o777).toBe(0o777);
    cleanup();
  });

  test("REJECT: world-writable (mode 0o777) without chmodding", () => {
    cleanup();
    const p = setup("world-writable");
    chmodSync(p, 0o777);
    expect(() => loadAndVerifyAnetBin({
      ANET_BIN_ABS: p,
      ANET_DAEMON_PATH_CONF: "/nonexistent",
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
      ANET_DAEMON_ALLOW_NON_ROOT_BIN: "1",
    })).toThrow(/anet_bin_unsafe_path.*writable by group\/other/);
    expect(statSync(p).mode & 0o777).toBe(0o777);
    cleanup();
  });

  test("REJECT: group-writable (mode 0o775) without chmodding", () => {
    cleanup();
    const p = setup("group-writable");
    chmodSync(p, 0o775);
    expect(() => loadAndVerifyAnetBin({
      ANET_BIN_ABS: p,
      ANET_DAEMON_PATH_CONF: "/nonexistent",
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
      ANET_DAEMON_ALLOW_NON_ROOT_BIN: "1",
    })).toThrow(/anet_bin_unsafe_path.*writable by group\/other/);
    expect(statSync(p).mode & 0o777).toBe(0o775);
    cleanup();
  });

  test("REJECT: not executable (mode 0o644)", () => {
    cleanup();
    const p = setup("not-exec");
    chmodSync(p, 0o644);
    expect(() => loadAndVerifyAnetBin({
      ANET_BIN_ABS: p,
      ANET_DAEMON_PATH_CONF: "/nonexistent",
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
      ANET_DAEMON_ALLOW_NON_ROOT_BIN: "1",
    })).toThrow(/anet_bin_unsafe_path.*not executable/);
    cleanup();
  });

  test("ACCEPT: owner not root by default for nvm/homebrew/user installs", () => {
    cleanup();
    const p = setup("non-root-owner");
    // test runs as non-root by default; owner=current uid (not 0)
    expect(() => loadAndVerifyAnetBin({
      ANET_BIN_ABS: p,
      ANET_DAEMON_PATH_CONF: "/nonexistent",
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
    })).not.toThrow();
    cleanup();
  });

  // (removed in #1394) the "strict root mode" case tested ANET_DAEMON_STRICT_ROOT_BIN,
  // a behavior that lives in the intentionally-skipped env-fallback commit (see PR body);
  // it only reddened inside root containers where chown to nobody actually works.

  test("REJECT: sha256 mismatch with install witness", () => {
    cleanup();
    const p = setup("hash-changed", "current-bytes");
    const installTimeHash = createHash("sha256").update("install-time-bytes-different").digest("hex");
    expect(() => loadAndVerifyAnetBin({
      ANET_BIN_ABS: p,
      ANET_BIN_SHA256: installTimeHash,
      ANET_DAEMON_PATH_CONF: "/nonexistent",
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
      ANET_DAEMON_ALLOW_NON_ROOT_BIN: "1",
    })).toThrow(/anet_bin_unsafe_path.*sha256 mismatch/);
    cleanup();
  });
});

// #1290 — Windows daemon ANET_BIN path check was POSIX-only. On Windows,
// C:\... never starts with "/" so gate ① threw `not absolute` unconditionally,
// blocking every create_node while the daemon appeared healthy (SSE ok,
// doorbells received). Gates ④+⑤ also don't apply on Windows because
// Node's st.mode is synthesized from Windows file attributes, not
// filesystem ACLs.
//
// These tests exercise the platform parameter directly (unit isolation).
// The bulk of the coverage above already re-verifies POSIX behavior via
// the real fixture; here we only add the Windows-specific branches.
describe("#1290 loadAndVerifyAnetBin — cross-platform path/mode checks", () => {
  const FIXTURE_DIR = "/tmp/anet-bin-1290-fixtures";

  function setup(name: string, body = "#!/bin/sh\necho real"): string {
    const pkgDir = join(FIXTURE_DIR, `${name}-pkg`);
    const binDir = join(pkgDir, "dist", "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({
      name: "@sleep2agi/agent-network",
      bin: { anet: "dist/bin/anet.cjs" },
    }));
    const p = join(binDir, "anet.cjs");
    writeFileSync(p, body, { mode: 0o755 });
    return p;
  }
  function cleanup() { try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch { /* ok */ } }

  test("🔴 witnessed-red for the reported #1290 symptom: a Windows drive-letter path is accepted", () => {
    // The bug: `pin.abs.startsWith("/")` returned false for `C:\Program Files\...`,
    // so the daemon threw `not absolute: C:\...` on every create_node call.
    // Fix: `path.isAbsolute()` — cross-platform. Because Node's default
    // `path.isAbsolute` is host-platform-aware, on the CI Linux runner it
    // returns false for a Windows path even after the fix (correct: that
    // host doesn't consider `C:\...` absolute). We assert the rationale via
    // path.win32.isAbsolute directly, which is the criterion the Windows
    // daemon will exercise at runtime.
    expect(pathWin32.isAbsolute("C:\\Program Files\\nodejs\\node_modules\\@sleep2agi\\agent-network\\dist\\bin\\anet.cjs")).toBe(true);
    expect(pathWin32.isAbsolute("D:/user/anet/dist/bin/anet.cjs")).toBe(true);
    // Sanity — the pre-fix check would have rejected these:
    expect("C:\\Program Files\\nodejs\\...".startsWith("/")).toBe(false);
    expect("D:/user/anet/...".startsWith("/")).toBe(false);
  });

  test("Windows path with `platform: 'win32'` param skips POSIX-mode gates + prints the one-time warn", () => {
    cleanup();
    _resetWindowsPosixModeWarnLatchForTest();
    const p = setup("win-skip");
    // A POSIX-style writable-by-group mode would normally throw at gate ④.
    // On Windows, that gate is skipped (st.mode is synthetic and does not
    // reflect ACLs — see the docblock on warnOnceWindowsPosixModeSkipped).
    // Give the file a mode that WOULD fail ④ on POSIX to prove the skip
    // path is what accepts it here.
    chmodSync(p, 0o666);  // group+other writable → would throw on POSIX
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string, ..._rest: unknown[]) => { warnings.push(String(msg)); };
    try {
      const got = loadAndVerifyAnetBin({
        ANET_DAEMON_PATH_CONF: "/nonexistent",
        ANET_BIN_ABS: p,
        ANET_DAEMON_ALLOW_ENV_BIN: "1",
      }, "win32");
      expect(got).toBe(p);
    } finally {
      console.warn = origWarn;
    }
    // The visible acknowledgement must fire (once) so a Windows operator
    // sees that the POSIX check was skipped, not silently passed.
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/#1290/);
    expect(warnings[0]).toMatch(/SKIPPED|skipped/);
    cleanup();
  });

  test("Windows-skip warn is once per process (subsequent calls do not re-warn)", () => {
    cleanup();
    _resetWindowsPosixModeWarnLatchForTest();
    const p = setup("win-once");
    chmodSync(p, 0o644);
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string, ..._rest: unknown[]) => { warnings.push(String(msg)); };
    try {
      loadAndVerifyAnetBin({
        ANET_DAEMON_PATH_CONF: "/nonexistent",
        ANET_BIN_ABS: p,
        ANET_DAEMON_ALLOW_ENV_BIN: "1",
      }, "win32");
      loadAndVerifyAnetBin({
        ANET_DAEMON_PATH_CONF: "/nonexistent",
        ANET_BIN_ABS: p,
        ANET_DAEMON_ALLOW_ENV_BIN: "1",
      }, "win32");
    } finally {
      console.warn = origWarn;
    }
    // Two calls, exactly ONE warning (once per process latch).
    expect(warnings.length).toBe(1);
    cleanup();
  });

  test("POSIX platform (default) STILL rejects group/other-writable modes — Windows skip must not leak", () => {
    cleanup();
    _resetWindowsPosixModeWarnLatchForTest();
    const p = setup("posix-still-strict");
    chmodSync(p, 0o666);
    // Explicit "linux" here so if a future refactor accidentally defaults
    // to platform="win32", this fails loudly. The regression it protects
    // against: "Windows-skip logic accidentally applied to Linux".
    expect(() => loadAndVerifyAnetBin({
      ANET_DAEMON_PATH_CONF: "/nonexistent",
      ANET_BIN_ABS: p,
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
      ANET_DAEMON_ALLOW_NON_ROOT_BIN: "1",
    }, "linux")).toThrow(/anet_bin_unsafe_path.*writable by group\/other/);
    cleanup();
  });

  test("realpath equivalence: POSIX byte-exact, Windows case-insensitive normalize", () => {
    // Direct exercise of the helper via loadAndVerifyAnetBin is awkward
    // (needs a fixture where realpathSync returns a different case). The
    // helper is small enough that its two branches are the whole
    // semantics — verify each via the platform param plumbed through
    // loadAndVerifyAnetBin's ② gate is the right unit for a follow-up
    // integration test on a Windows CI runner.
    //
    // What we CAN assert here: the helper's inputs match at the string
    // level for the canonical POSIX case (byte-exact), which is the
    // pre-fix behavior we must not regress.
    cleanup();
    const p = setup("realpath-posix");
    // Default platform (host) — canonical path, no symlink → passes ②.
    const got = loadAndVerifyAnetBin({
      ANET_DAEMON_PATH_CONF: "/nonexistent",
      ANET_BIN_ABS: p,
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
      ANET_DAEMON_ALLOW_NON_ROOT_BIN: "1",
    });
    expect(got).toBe(p);
    cleanup();
  });
});

describe("minimalEnv defensive compose (BLOCKER #1+#2 lineage — kept stable)", () => {
  test("happy path: no extra → PATH includes daemon's own node bin dir + SAFE_PATH (issue #301 nvm fix)", () => {
    const env = minimalEnv();
    // PATH now starts with daemon's process.execPath dirname so spawned
    // children's `#!/usr/bin/env node` shebang can find node under nvm /
    // pnpm / Bun installs. SAFE_PATH follows; if execDir is already a
    // canonical SAFE_PATH entry (e.g. /usr/local/bin), no duplicate.
    const SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
    const execDir = require("node:path").dirname(process.execPath);
    if (SAFE_PATH.split(":").includes(execDir)) {
      expect(env.PATH).toBe(SAFE_PATH);
    } else {
      expect(env.PATH).toBe(`${execDir}:${SAFE_PATH}`);
      // Critically: execDir is FIRST so spawned child's env node resolves
      // to daemon's own node (anti shebang-fail in nvm context).
      expect(env.PATH!.startsWith(execDir)).toBe(true);
    }
    expect(env.HOME).toBeDefined();
    expect(env.LANG).toBeDefined();
  });
  test("legitimate extra key passes + fixed PATH keeps execPath prepend (issue #301)", () => {
    const env = minimalEnv({ ANTHROPIC_API_KEY: "x" });
    expect(env.ANTHROPIC_API_KEY).toBe("x");
    // PATH still includes SAFE_PATH segment
    expect(env.PATH).toContain("/usr/local/bin");
    expect(env.PATH).toContain("/usr/bin");
  });
  test("THROWS on reserved key in extra (LD_PRELOAD smuggled by attacker)", () => {
    expect(() => minimalEnv({ LD_PRELOAD: "/tmp/evil.so" })).toThrow(/reserved env key/);
  });
  test("THROWS on fixed key in extra (PATH smuggled — caller cannot override the trust-root execPath prepend)", () => {
    expect(() => minimalEnv({ PATH: "/tmp/evil-bin" })).toThrow(/reserved env key|fixed env key/);
  });
  test("C1 invariant — issue #301 fix does NOT widen attacker surface: PATH source is process.execPath (daemon's already-resolved node), NOT env.PATH (attacker C1 surface)", () => {
    // We do NOT read process.env.PATH; we use process.execPath.
    // Sanity proof: read the source file, confirm no env.PATH reference
    // in computeChildPath / minimalEnv code path.
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "create-node-daemon.ts"), "utf-8",
    );
    // Extract computeChildPath function body
    const m = src.match(/function computeChildPath\(\)[\s\S]+?\n\}/);
    expect(m).toBeTruthy();
    if (m) {
      expect(m[0]).toContain("process.execPath");
      expect(m[0]).not.toMatch(/process\.env\.PATH/);   // explicit anti-C1 invariant
    }
  });
});

// #1490 — Windows daemon spawned children got HOME=undefined because
// Windows doesn't populate env.HOME (USERPROFILE / HOMEDRIVE+HOMEPATH
// instead). Same class as #1290: POSIX-only assumption in code that
// must also run on Windows. Follow #1290's platform-param injection so
// the Windows branch runs on the Linux CI runner too.
describe("#1490 minimalEnv — cross-platform HOME resolution", () => {
  // 🔴 witnessed-red: Windows env cascade must find USERPROFILE.
  // Under the old `process.env.HOME!` it would have returned undefined
  // for a Windows parent env that has no HOME key.
  test("🔴 witnessed-red: Windows parent env with USERPROFILE only → child HOME = USERPROFILE", () => {
    const parentEnv = { USERPROFILE: "C:\\Users\\alice" };
    const env = minimalEnv({}, "win32", parentEnv);
    expect(env.HOME).toBe("C:\\Users\\alice");
    expect(env.USERPROFILE).toBe("C:\\Users\\alice");
    // HOMEDRIVE / HOMEPATH derived from the drive-letter split so
    // .bat wrappers and legacy Windows APIs still resolve %HOMEPATH%.
    expect(env.HOMEDRIVE).toBe("C:");
    expect(env.HOMEPATH).toBe("\\Users\\alice");
  });

  test("Windows: HOMEDRIVE+HOMEPATH-only parent env resolves via that cascade branch", () => {
    const parentEnv = { HOMEDRIVE: "D:", HOMEPATH: "\\Users\\bob" };
    const env = minimalEnv({}, "win32", parentEnv);
    expect(env.HOME).toBe("D:\\Users\\bob");
    expect(env.USERPROFILE).toBe("D:\\Users\\bob");
    expect(env.HOMEDRIVE).toBe("D:");
    expect(env.HOMEPATH).toBe("\\Users\\bob");
  });

  test("Windows: stripped env (no USERPROFILE / HOME / HOMEDRIVE) THROWS with a diagnostic message", () => {
    // Fail-closed. A silently-empty HOME just moves the crash from
    // minimalEnv() to the child's first path operation; catching it
    // here makes the misconfiguration attributable.
    expect(() => minimalEnv({}, "win32", {})).toThrow(/cannot resolve Windows child HOME/);
  });

  test("POSIX (explicit 'linux'): env.HOME resolution unchanged, no Windows-only keys leak", () => {
    // Explicit 'linux' param so a future refactor that accidentally
    // defaults to 'win32' fails here loudly — same defensive pattern
    // as #1290's POSIX-mode gate test.
    const env = minimalEnv({}, "linux", { HOME: "/home/user" });
    expect(env.HOME).toBe("/home/user");
    expect(env.USERPROFILE).toBeUndefined();
    expect(env.HOMEDRIVE).toBeUndefined();
    expect(env.HOMEPATH).toBeUndefined();
  });

  test("POSIX (explicit 'linux'): missing env.HOME THROWS (fail-closed, not undefined-passthrough)", () => {
    expect(() => minimalEnv({}, "linux", {})).toThrow(/cannot resolve POSIX child HOME/);
  });

  test("Windows: USERPROFILE is a fixed key on that platform — smuggling it in extra THROWS", () => {
    // Same guarantee as PATH on POSIX: a caller cannot override the
    // trust-root home path via extra. On POSIX USERPROFILE is not fixed
    // (POSIX doesn't use it) so the check must be platform-branched.
    expect(() =>
      minimalEnv(
        { USERPROFILE: "C:\\Users\\attacker" },
        "win32",
        { USERPROFILE: "C:\\Users\\alice" },
      ),
    ).toThrow(/fixed env key/);
  });

  test("POSIX (explicit 'linux'): USERPROFILE is NOT fixed there — passes through as ordinary extra", () => {
    // Symmetric to the previous test: platform-branched fixed set.
    // A POSIX child that happens to want USERPROFILE forwarded (unusual,
    // but not a supply-chain risk on POSIX) can receive it.
    const env = minimalEnv(
      { USERPROFILE: "/some/path" },
      "linux",
      { HOME: "/home/user" },
    );
    expect(env.USERPROFILE).toBe("/some/path");
    expect(env.HOME).toBe("/home/user");
  });

  test("resolveChildHome: Windows cascade priority USERPROFILE > HOME > HOMEDRIVE+HOMEPATH", () => {
    // Direct unit test on the helper. USERPROFILE wins because that's
    // what os.homedir() and every modern Windows tool reads first.
    expect(
      resolveChildHome(
        {
          USERPROFILE: "C:\\Users\\up",
          HOME: "C:\\Users\\h",
          HOMEDRIVE: "D:",
          HOMEPATH: "\\Users\\hd",
        },
        "win32",
      ),
    ).toBe("C:\\Users\\up");
    // Missing USERPROFILE: HOME wins.
    expect(
      resolveChildHome(
        { HOME: "C:\\Users\\h", HOMEDRIVE: "D:", HOMEPATH: "\\Users\\hd" },
        "win32",
      ),
    ).toBe("C:\\Users\\h");
    // Missing USERPROFILE + HOME: HOMEDRIVE+HOMEPATH is the last resort.
    expect(
      resolveChildHome({ HOMEDRIVE: "D:", HOMEPATH: "\\Users\\hd" }, "win32"),
    ).toBe("D:\\Users\\hd");
  });
});

// #1491 — Windows daemon default ANET_DAEMON_PATH_CONF was
// `/etc/anet-daemon/path.conf` — a POSIX-only path that never resolves
// on Windows filesystems, so the default silently failed and users
// had to know about the ANET_BIN_ABS + ANET_DAEMON_ALLOW_ENV_BIN=1
// env fallback (documented per #1291) to make anything work. Same
// class as #1290 / #1490 — POSIX-only default in code that must also
// run on Windows.
describe("#1491 defaultPathConf — platform-aware ANET path.conf trust root", () => {
  // 🔴 witnessed-red — the reported symptom is that the default on
  // Windows was the POSIX literal. Assert the platform-branch fixes it.
  test("🔴 witnessed-red: Windows default is under %ProgramData%, NOT /etc/", () => {
    const conf = defaultPathConf({ PROGRAMDATA: "C:\\ProgramData" }, "win32");
    // Cross-platform assertion: win32.join produces backslash separators
    // on any host, so this check is portable to Linux CI.
    expect(conf).toBe("C:\\ProgramData\\anet-daemon\\path.conf");
    expect(conf).not.toBe("/etc/anet-daemon/path.conf");
    expect(conf.startsWith("/etc/")).toBe(false);
  });

  test("Windows: PROGRAMDATA unset falls back to C:\\ProgramData", () => {
    // Stripped-env service context — Windows normally sets PROGRAMDATA
    // but a bare fork/exec with a scrubbed env can lose it. The fallback
    // keeps the daemon addressable rather than throwing.
    const conf = defaultPathConf({}, "win32");
    expect(conf).toBe("C:\\ProgramData\\anet-daemon\\path.conf");
  });

  test("Windows: non-default PROGRAMDATA is honored (Server Core / relocated system drive)", () => {
    // Some Windows Server installs relocate ProgramData to D:\ etc.
    // The default must follow the OS's own PROGRAMDATA, not hardcode C:.
    const conf = defaultPathConf({ PROGRAMDATA: "D:\\ProgramData" }, "win32");
    expect(conf).toBe("D:\\ProgramData\\anet-daemon\\path.conf");
  });

  test("POSIX (explicit 'linux'): default is /etc/anet-daemon/path.conf (unchanged from pre-#1491)", () => {
    // Explicit 'linux' so a future refactor that accidentally defaults
    // to 'win32' fails here loudly — same defensive pattern as #1290 /
    // #1490's POSIX-branch tests. PROGRAMDATA is (rightly) ignored on POSIX.
    expect(defaultPathConf({}, "linux")).toBe("/etc/anet-daemon/path.conf");
    expect(defaultPathConf({ PROGRAMDATA: "C:\\ProgramData" }, "linux")).toBe(
      "/etc/anet-daemon/path.conf",
    );
  });

  test("POSIX (explicit 'darwin'): default is /etc/anet-daemon/path.conf (unchanged)", () => {
    // macOS daemons follow the POSIX branch — no separate macOS path
    // (there's no equivalent to the POSIX-vs-Windows split for macOS
    // that would warrant a third case).
    expect(defaultPathConf({}, "darwin")).toBe("/etc/anet-daemon/path.conf");
  });

  test("loadAndVerifyAnetBin: Windows error mentions the %ProgramData% trust root, NOT /etc/", () => {
    // The diagnostic thrown when no pin resolves. Before this fix the
    // message hardcoded /etc/anet-daemon/path.conf, which is nonsense
    // to a Windows operator trying to figure out where to write it.
    // Env fallback disabled + no ANET_BIN_ABS → the "no ANET_BIN_ABS
    // resolved from <trust root>" branch fires.
    try {
      loadAndVerifyAnetBin(
        { PROGRAMDATA: "C:\\ProgramData" },
        "win32",
      );
      throw new Error("expected loadAndVerifyAnetBin to throw");
    } catch (e: any) {
      expect(e.message).toMatch(/C:\\ProgramData\\anet-daemon\\path\.conf/);
      // 🔴 anti-regression: the message must NOT still carry the POSIX
      // literal on Windows. Catching this if a future refactor
      // inlines the string constant back.
      expect(e.message).not.toMatch(/\/etc\/anet-daemon/);
    }
  });

  test("loadAndVerifyAnetBin: POSIX error still mentions /etc/anet-daemon (unchanged)", () => {
    try {
      loadAndVerifyAnetBin({}, "linux");
      throw new Error("expected loadAndVerifyAnetBin to throw");
    } catch (e: any) {
      expect(e.message).toMatch(/\/etc\/anet-daemon\/path\.conf/);
      // Anti-cross-contamination: the POSIX branch must NOT leak
      // Windows path syntax.
      expect(e.message).not.toMatch(/ProgramData/);
    }
  });

  test("loadAndVerifyAnetBin: Windows Fix command uses PowerShell (Set-Content), NOT sudo/tee", () => {
    // Downstream of the trust-root platform branch: telling a Windows
    // operator to run `sudo tee /etc/...` is nonsense. Anti-regression
    // for the paired Fix command.
    try {
      loadAndVerifyAnetBin({ PROGRAMDATA: "C:\\ProgramData" }, "win32");
      throw new Error("expected loadAndVerifyAnetBin to throw");
    } catch (e: any) {
      expect(e.message).toMatch(/Set-Content/);
      expect(e.message).not.toMatch(/sudo tee/);
      expect(e.message).not.toMatch(/install -d -m 0755/);
    }
  });

  test("loadAndVerifyAnetBin: POSIX Fix command is unchanged sudo/tee shell recipe", () => {
    try {
      loadAndVerifyAnetBin({}, "linux");
      throw new Error("expected loadAndVerifyAnetBin to throw");
    } catch (e: any) {
      expect(e.message).toMatch(/sudo tee/);
      expect(e.message).toMatch(/install -d -m 0755/);
      expect(e.message).not.toMatch(/Set-Content/);
    }
  });
});

// PR3 #338 / RFC-026 §9.3 D2 — fail-fast spawn detection primitive.
// 通信龙 mandate: "真起子进程测——按你说的需要真 binary / Docker 就走 Docker，
// 别 mock 糊弄". claimAndSpawnChild's full path is wired through hub MCP +
// SSE doorbell; that's covered by the integration test fixture. These two
// tests pin the BEHAVIORAL PRIMITIVE my new 5s window relies on, using real
// `node` subprocesses (no mocks): kill-0 raises ESRCH if pid is dead, succeeds
// if alive. If Node's child_process / process.kill semantics ever drift, the
// fail-fast code silently breaks — these tests catch that.
describe("FAIL_FAST_MS primitive — real subprocess kill-0 lifecycle", () => {
  test("child that exits within window → process.kill(pid, 0) raises ESRCH after wait", async () => {
    const { spawn } = await import("node:child_process");
    // Real Node subprocess; exits ~50ms after spawn.
    const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(1), 50)"], {
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    const pid = child.pid!;
    expect(pid).toBeGreaterThan(0);
    child.unref();
    // Wait 500ms — well past the 50ms child exit.
    await new Promise(r => setTimeout(r, 500));
    // kill-0 must raise (child is dead → ESRCH).
    let threw = false;
    try { process.kill(pid, 0); } catch { threw = true; }
    expect(threw).toBe(true);
  });

  test("child that survives window → process.kill(pid, 0) succeeds", async () => {
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 10000)"], {
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    const pid = child.pid!;
    expect(pid).toBeGreaterThan(0);
    child.unref();
    // 200ms wait — child still in its 10s sleep.
    await new Promise(r => setTimeout(r, 200));
    // kill-0 must succeed (child alive).
    expect(() => process.kill(pid, 0)).not.toThrow();
    // cleanup so the test doesn't leave a child running 10s post-suite.
    try { process.kill(pid, "SIGKILL"); } catch { /* may already exit */ }
  });
});

// RFC-027 PR1 v3 — BLOCKER-1 lock. The recorded child_node_id MUST match
// the hub's canonical derivation `node_${request_id.replace(/^cr_/,"")}`
// (server/src/tools.ts ~363 mints the child config with this exact id,
// and the child's later register call uses it as the nodes.node_id; the
// same string flows back to the daemon via get_stop_request as
// child_node_id). PR1 v2 fell back to `node_${alias}` when an absent
// child_node_id field was missing from get_create_request — every stop
// dispatch then noop'd at the daemon. This test pins the key shape so
// the fallback can't drift back in.
describe("RFC-027 BLOCKER-1 — childrenMap key shape matches hub canonical node_id", () => {
  test("derive key from request_id, not alias", () => {
    const request_id = "cr_abc123def456";
    const expected = `node_${request_id.replace(/^cr_/, "")}`;
    expect(expected).toBe("node_abc123def456");
    // Hub server/src/tools.ts:363 writes EXACTLY this expression into
    // the child's config.json node_id — keep them byte-identical or
    // stop/delete will silently no-op.
  });

  // #1293 —— 记录必须在 +5000ms 能力检查**之前**发生,否则 hub 认识子节点、
  // daemon 不认,中间约 5 秒里 stop/delete 全部 ack `noop_not_my_child`。
  // 提前记录必须配一次回滚,否则能力检查失败会留一条指向死 pid 的条目。
  test("#1293 forgetSpawnedChild undoes an early record (capability-fail rollback)", async () => {
    const { recordSpawnedChild, forgetSpawnedChild, getChildrenSnapshot, _resetChildrenMapForTest } =
      await import("./stop-daemon");
    _resetChildrenMapForTest();
    const id = "node_cap_fail_rollback";
    recordSpawnedChild(id, "doomed-child", 4242);
    expect(getChildrenSnapshot().length).toBe(1);

    // 回滚:返回 true 表示确实删掉了一条 —— 调用方据此判断「我记过吗」,不靠假设
    expect(forgetSpawnedChild(id)).toBe(true);
    expect(getChildrenSnapshot().length).toBe(0);

    // 🔴 幂等 + 诚实:再删一次必须返回 false,而不是静默成功。
    //    一个「删不存在的东西也说成功」的 API,会让调用方无法区分
    //    「我记过并撤销了」和「我根本没记上」。
    expect(forgetSpawnedChild(id)).toBe(false);

    // 只删指定的那一条,不误伤兄弟
    recordSpawnedChild("node_a", "a", 1);
    recordSpawnedChild("node_b", "b", 2);
    expect(forgetSpawnedChild("node_a")).toBe(true);
    const rest = getChildrenSnapshot();
    expect(rest.length).toBe(1);
    expect(rest[0].child_node_id).toBe("node_b");
    _resetChildrenMapForTest();
  });

  // 🔴 源码级断言:证明 record 真的排在能力检查之前。
  //    上面那个用例只测 forgetSpawnedChild 这个零件 —— 它在旧代码上**照样会绿**,
  //    因为顺序错不影响这个函数本身。顺序是这条 issue 的全部内容,必须单独钉。
  test("#1293 recordSpawnedChild is invoked BEFORE the FAIL_FAST capability wait", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./create-node-daemon.ts", import.meta.url), "utf8");
    const iRecord = src.indexOf("recordSpawnedChild(child_node_id");
    const iWait = src.indexOf("const FAIL_FAST_MS");
    const iRollback = src.indexOf("forgetSpawnedChild(`node_${request_id");
    expect(iRecord).toBeGreaterThan(-1);
    expect(iWait).toBeGreaterThan(-1);
    expect(iRollback).toBeGreaterThan(-1);
    expect(iRecord).toBeLessThan(iWait);      // 记录在等待之前
    expect(iRollback).toBeGreaterThan(iWait); // 回滚在等待之后的失败路径上
  });

  test("recordSpawnedChild end-to-end with the canonical key — stop-daemon can find it", async () => {
    const { recordSpawnedChild, getChildrenSnapshot, _resetChildrenMapForTest } =
      await import("./stop-daemon");
    _resetChildrenMapForTest();
    const request_id = "cr_e2e_lookup_test";
    const child_node_id = `node_${request_id.replace(/^cr_/, "")}`;
    recordSpawnedChild(child_node_id, "alias-xyz", 12345);
    const snap = getChildrenSnapshot();
    expect(snap.length).toBe(1);
    expect(snap[0].child_node_id).toBe("node_e2e_lookup_test");
    expect(snap[0].alias).toBe("alias-xyz");
    expect(snap[0].pid).toBe(12345);
    _resetChildrenMapForTest();
  });
});

/* #1545 PR1 —— 探针必须**两向都被见证**:blocked 那侧本来就有 6 条 toThrow 在守,
 * 真正没人守的是「ready 时它确实说 ready」。只验 blocked 一侧的话,一个恒返回
 * blocked 的实现能全绿通过 —— 而那正是 #1545 里最坏的形态:一个永远说"不行"
 * 的探针和一个永远沉默的 daemon,对用户是同一件事。 */
describe("#1545 probeAnetBinReadiness —— 不抛异常地回答「现在能不能起节点」", () => {
  const FIXTURE_DIR = "/tmp/anet-probe-test-fixtures";

  function setup(name: string, body = "fake-binary-bytes"): string {
    const binDir = join(FIXTURE_DIR, `${name}-pkg`, "dist", "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(FIXTURE_DIR, `${name}-pkg`, "package.json"), JSON.stringify({
      name: "@sleep2agi/agent-network",
      bin: { anet: "dist/bin/anet.cjs" },
    }));
    const p = join(binDir, "anet.cjs");
    writeFileSync(p, body, { mode: 0o755 });
    return p;
  }
  function cleanup() {
    try { rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  }

  // ── 方向一:ready。这条是本 PR 唯一新增的**正向**见证。
  test("READY: 合法 pin 下返回 state=ready 且带出解析到的绝对路径", () => {
    cleanup();
    const p = setup("ready");
    const got = probeAnetBinReadiness({
      ANET_BIN_ABS: p,
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
      ANET_DAEMON_PATH_CONF: "/nonexistent",
    }, "linux");
    expect(got.state).toBe("ready");
    expect(got).toEqual({ state: "ready", abs: p });
    cleanup();
  });

  // ── 方向二:blocked,且**类别要说对**。#1545 的痛点不是"有没有报错",
  //    是报错指错方向(source 让人去建 /etc/…,permission 只要一行 chmod)。
  test("BLOCKED: env 兜底未显式开启 → code=anet_bin_source,detail 里带得出修法", () => {
    cleanup();
    const p = setup("blocked-source");
    const got = probeAnetBinReadiness({
      ANET_BIN_ABS: p,
      ANET_DAEMON_PATH_CONF: "/nonexistent",
    }, "linux");
    expect(got.state).toBe("blocked");
    if (got.state !== "blocked") throw new Error("unreachable");
    expect(got.code).toBe("anet_bin_source");
    expect(got.detail).toContain("ANET_DAEMON_ALLOW_ENV_BIN=1");
    expect(got.detail).toContain("Fix:");
    cleanup();
  });

  test("BLOCKED: 完全没有 ANET_BIN_ABS —— 探针照样返回值而不是抛", () => {
    const got = probeAnetBinReadiness({ ANET_DAEMON_PATH_CONF: "/nonexistent" }, "linux");
    expect(got.state).toBe("blocked");
    if (got.state !== "blocked") throw new Error("unreachable");
    expect(got.detail).toContain("anet_bin_unsafe_path");
  });

  /* 🔴 这条不是补齐分类,是**把一个真实的空白钉住**:sha256 不匹配那条抛的是裸
   * Error、没挂 anetBinCode。所以它只能是 unclassified。哪天有人给它挂上类别,
   * 这条会红 —— 那正是应该有人来读一眼的时刻(而不是让显示层默默替它选一类)。 */
  test("BLOCKED: sha256 不匹配 → 目前无类别可挂,如实报 anet_bin_unknown", () => {
    cleanup();
    const p = setup("hash-mismatch", "actual-bytes");
    const got = probeAnetBinReadiness({
      ANET_BIN_ABS: p,
      ANET_BIN_SHA256: createHash("sha256").update("different-bytes").digest("hex"),
      ANET_DAEMON_ALLOW_ENV_BIN: "1",
      ANET_DAEMON_PATH_CONF: "/nonexistent",
    }, "linux");
    expect(got.state).toBe("blocked");
    if (got.state !== "blocked") throw new Error("unreachable");
    expect(got.code).toBe("anet_bin_unknown");
    expect(got.detail).toContain("sha256 mismatch");
    cleanup();
  });

  /* 🔴 判据只有一个作者 —— 这条直接断言这件事,而不是断言两边"看起来一致":
   * 同一份 env 喂给两者,「探针说 blocked」必须**恰好**等于「解析器抛了」。
   * 有了它,以后任何人想给探针加一条自己的判断,都会在这里撞红。 */
  test("PARITY: probe 的 blocked ⟺ loadAndVerifyAnetBin 抛异常(同一份 env)", () => {
    cleanup();
    const ok = setup("parity-ok");
    const cases: Array<NodeJS.ProcessEnv> = [
      { ANET_BIN_ABS: ok, ANET_DAEMON_ALLOW_ENV_BIN: "1", ANET_DAEMON_PATH_CONF: "/nonexistent" },
      { ANET_BIN_ABS: ok, ANET_DAEMON_PATH_CONF: "/nonexistent" },
      { ANET_DAEMON_PATH_CONF: "/nonexistent" },
      { ANET_BIN_ABS: "/definitely/not/here/anet.cjs", ANET_DAEMON_ALLOW_ENV_BIN: "1", ANET_DAEMON_PATH_CONF: "/nonexistent" },
    ];
    let readyCount = 0;
    let blockedCount = 0;
    for (const env of cases) {
      let threw = false;
      try { loadAndVerifyAnetBin(env, "linux"); } catch { threw = true; }
      const probed = probeAnetBinReadiness(env, "linux");
      expect(probed.state === "blocked").toBe(threw);
      if (probed.state === "ready") readyCount += 1; else blockedCount += 1;
    }
    // 分母自证:这组用例**两侧都有**。全 blocked 的话上面那个等式恒成立、什么也没测。
    expect(readyCount).toBe(1);
    expect(blockedCount).toBe(3);
    cleanup();
  });
});
