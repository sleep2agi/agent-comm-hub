import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, statSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  accountFingerprint, backupPathFor, backupRefFor, classifyProbe, credentialRefFor, hostIdOf, parseSourceRef,
  readRegistry, resolveProfile, runAccountInstall, runRollback, writeRegistry, type InstallActions, type Registry, type RegistryEntry, type RollbackActions,
} from "./codex-lifecycle-account.js";
import type { RestartOutcome } from "./codex-lifecycle-restart.js";

describe("#1856 PR-D source ref", () => {
  test("accepts only codex-login:<profile-id>", () => {
    expect(parseSourceRef("codex-login:team-a")).toEqual({ kind: "codex-login-profile", profileId: "team-a" });
    for (const bad of ["/home/x/auth.json", "./auth.json", "~/.codex/auth.json", "env:OPENAI", "-", "codex-login:", "codex-login:../x", "vault:abc", ""]) {
      expect(() => parseSourceRef(bad)).toThrow();
    }
    expect(() => parseSourceRef("/tmp/auth.json")).toThrow(/paths, stdin and env are not accepted/);
  });
});

describe("#1856 PR-D fingerprint / host id", () => {
  test("chatgpt auth → sha256(account_id) prefix; other modes refused; irreversible (no account id in output)", () => {
    const acct = "11111111-2222-4333-8444-555555555555";
    const fp = accountFingerprint({ auth_mode: "chatgpt", tokens: { account_id: acct } });
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(fp).not.toContain("1111");
    expect(accountFingerprint({ auth_mode: "chatgpt", tokens: { account_id: acct } })).toBe(fp);
    expect(() => accountFingerprint({ auth_mode: "apikey", OPENAI_API_KEY: "sk-x" })).toThrow(/only handles ChatGPT/);
    expect(() => accountFingerprint({ auth_mode: "chatgpt", tokens: {} })).toThrow(/account_id/);
  });
  test("host id binds machine-id + hostname", () => {
    expect(hostIdOf("m1", "h1")).not.toBe(hostIdOf("m2", "h1"));
    expect(hostIdOf(null, "h1")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("#1856 PR-D registry", () => {
  const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
    schema_version: 1, profile_id: "p1", provider: "openai-chatgpt", host_id: "host-a", credential_ref: credentialRefFor("p1"),
    account_fingerprint: "abcd", created_at: "2026-09-09T00:00:00Z", last_model_probe_at: null, last_model_probe_status: null, revoked: false, disabled: false, ...over,
  });
  function registryDir(): string {
    const d = mkdtempSync(join(tmpdir(), "anet-reg-"));
    mkdirSync(join(d, "profiles", "p1"), { recursive: true, mode: 0o700 });
    writeFileSync(join(d, "profiles", "p1", "auth.json"), "{}", { mode: 0o600 });
    return d;
  }
  test("write is 0600 and round-trips; missing file reads as empty registry", () => {
    const d = registryDir();
    expect(readRegistry(d, "host-a").profiles).toEqual({});
    const reg: Registry = { schema_version: 1, host_id: "host-a", profiles: { p1: entry() } };
    writeRegistry(d, reg);
    expect(statSync(join(d, "registry.json")).mode & 0o777).toBe(0o600);
    expect(readRegistry(d, "host-a")).toEqual(reg);
  });
  test("resolveProfile: ok / unknown / revoked / disabled / other host / loose credential mode", () => {
    const d = registryDir();
    const reg: Registry = { schema_version: 1, host_id: "host-a", profiles: { p1: entry() } };
    expect(resolveProfile(d, reg, "p1", "host-a").credentialFile).toBe(join(d, "profiles", "p1", "auth.json"));
    expect(() => resolveProfile(d, reg, "nope", "host-a")).toThrow(/not registered/);
    expect(() => resolveProfile(d, { ...reg, profiles: { p1: entry({ revoked: true }) } }, "p1", "host-a")).toThrow(/revoked/);
    expect(() => resolveProfile(d, { ...reg, profiles: { p1: entry({ disabled: true }) } }, "p1", "host-a")).toThrow(/disabled/);
    expect(() => resolveProfile(d, reg, "p1", "host-b")).toThrow(/another host/);
    chmodSync(join(d, "profiles", "p1", "auth.json"), 0o644);
    expect(() => resolveProfile(d, reg, "p1", "host-a")).toThrow(/owner-only/);
  });
  test("backup refs are receipt-scoped and resolve only inside the node's receipts dir", () => {
    expect(backupRefFor("2026-x-abc")).toBe("receipt:2026-x-abc");
    expect(backupPathFor("/n", "receipt:2026-x-abc")).toBe("/n/receipts/2026-x-abc.auth.bak");
    expect(() => backupPathFor("/n", "/etc/passwd")).toThrow(/only receipt:<id>/);
    expect(() => backupPathFor("/n", "receipt:../../x")).toThrow();
  });
});

describe("#1856 PR-D probe classifier", () => {
  test("ok needs exit 0 + sentinel; 401/quota/model map; everything else unknown", () => {
    expect(classifyProbe(0, "ANET-PROBE-OK", "")).toBe("ok");
    expect(classifyProbe(0, "sure thing", "")).toBe("unknown");
    expect(classifyProbe(1, "", "Error: 401 Unauthorized")).toBe("auth");
    expect(classifyProbe(1, "", "token has expired, please login")).toBe("auth");
    expect(classifyProbe(1, "", "insufficient_quota: you exceeded your usage limit")).toBe("quota");
    expect(classifyProbe(1, "", "HTTP 429 Too Many Requests")).toBe("quota");
    expect(classifyProbe(1, "", "model gpt-x not found")).toBe("model");
    expect(classifyProbe(1, "", "segfault")).toBe("unknown");
    expect(classifyProbe(null, "", "")).toBe("unknown");
  });
});

const done = (): RestartOutcome => ({ verb: "restart", checks: [{ key: "identity_match", status: "pass", detail: "ok" }, { key: "start_order", status: "pass", detail: "ok" }], stoppedAt: "done", rolledBack: false });
const stuck = (): RestartOutcome => ({ verb: "restart", checks: [{ key: "start_order", status: "fail", detail: "launcher failed" }], stoppedAt: "start", rolledBack: true });

function installActions(over: Partial<InstallActions> = {}, state = { fp: "old0000000000000", log: [] as string[] }): InstallActions & { state: typeof state } {
  const a: InstallActions = {
    preflightBlocks: async () => [],
    currentFingerprint: async () => state.fp,
    probe: async () => ({ status: "ok", detail: "answered in 4s" }),
    backup: async () => { state.log.push("backup"); return { backupRef: "receipt:r1" }; },
    install: async () => { state.log.push("install"); state.fp = "new0000000000000"; },
    restart: async () => { state.log.push("restart"); return done(); },
    restore: async (ref) => { state.log.push(`restore:${ref}`); state.fp = "old0000000000000"; },
    recordProbe: async (s) => { state.log.push(`probe:${s}`); },
    ...over,
  };
  return Object.assign(a, { state });
}
const INPUT = { profileId: "p1", sourceFingerprint: "new0000000000000" };

describe("#1856 PR-D install state machine", () => {
  test("happy path: probe → backup → install → restart → fingerprint matches → done", async () => {
    const a = installActions();
    const out = await runAccountInstall(INPUT, a);
    expect(out.stoppedAt).toBe("done");
    expect(out.rolledBack).toBe(false);
    expect(out.backupRef).toBe("receipt:r1");
    expect(a.state.log).toEqual(["probe:ok", "backup", "install", "restart"]);
    expect(out.checks.map((c) => c.key)).toEqual(["account_probe", "account_backup", "account_installed", "identity_match", "start_order", "account_verified"]);
    const verified = out.checks.find((c) => c.key === "account_verified")!;
    expect(JSON.stringify(verified.evidence)).not.toContain("auth.json");
  });
  test("preflight fail → nothing probed, nothing touched", async () => {
    const a = installActions({ preflightBlocks: async () => ["identity_match"] });
    const out = await runAccountInstall(INPUT, a);
    expect(out.stoppedAt).toBe("preflight_before");
    expect(a.state.log).toEqual([]);
  });
  test("probe auth/quota/model/unknown → STOP before backup, status recorded in registry", async () => {
    for (const status of ["auth", "quota", "model", "unknown"] as const) {
      const a = installActions({ probe: async () => ({ status, detail: "x" }) });
      const out = await runAccountInstall(INPUT, a);
      expect(out.stoppedAt).toBe(`probe_${status}`);
      expect(a.state.log).toEqual([`probe:${status}`]);
      expect(out.checks.find((c) => c.key === "account_probe")!.status).toBe("fail");
    }
  });
  test("restart fails after install → restore backup + restart again (rolled back)", async () => {
    let n = 0;
    const state = { fp: "old0000000000000", log: [] as string[] };
    const a = installActions({ restart: async () => { state.log.push("restart"); return n++ === 0 ? stuck() : done(); } }, state);
    const out = await runAccountInstall(INPUT, a);
    expect(out.rolledBack).toBe(true);
    expect(out.stoppedAt).toBe("restart(start)");
    expect(a.state.log.slice(-2)).toEqual(["restore:receipt:r1", "restart"]);
    expect(out.checks.find((c) => c.key === "rollback_restart")!.status).toBe("pass");
    expect(out.checks.find((c) => c.key === "restart:start_order")!.status).toBe("fail");
  });
  test("fingerprint after restart ≠ source → rolled back", async () => {
    const a = installActions({ install: async () => { /* wrote nothing */ } });
    const out = await runAccountInstall(INPUT, a);
    expect(out.stoppedAt).toBe("fingerprint_mismatch");
    expect(out.rolledBack).toBe(true);
  });
  test("install throws → restore without restart", async () => {
    const a = installActions({ install: async () => { throw new Error("EACCES"); } });
    const out = await runAccountInstall(INPUT, a);
    expect(out.stoppedAt).toBe("install");
    expect(a.state.log).toEqual(["probe:ok", "backup", "restore:receipt:r1"]);
  });
});

describe("#1856 PR-D rollback state machine", () => {
  function rb(over: Partial<RollbackActions> = {}): RollbackActions & { log: string[] } {
    const log: string[] = [];
    const a: RollbackActions = {
      readInstallReceipt: async () => ({ backupRef: "receipt:r1", targetPreviousFingerprint: "old0000000000000" }),
      backupExists: async () => true,
      restore: async (ref) => { log.push(`restore:${ref}`); },
      restart: async () => { log.push("restart"); return done(); },
      currentFingerprint: async () => "old0000000000000",
      ...over,
    };
    return Object.assign(a, { log });
  }
  test("restores from the receipt's backup, restarts, verifies fingerprint", async () => {
    const a = rb();
    const out = await runRollback(a);
    expect(out.stoppedAt).toBe("done");
    expect(a.log).toEqual(["restore:receipt:r1", "restart"]);
  });
  test("non-install receipt or missing backup → refuses without touching", async () => {
    const a = rb({ readInstallReceipt: async () => null });
    expect((await runRollback(a)).stoppedAt).toBe("receipt");
    const b = rb({ backupExists: async () => false });
    expect((await runRollback(b)).stoppedAt).toBe("backup_missing");
    expect(a.log).toEqual([]); expect(b.log).toEqual([]);
  });
  test("fingerprint after rollback differs from the recorded previous → verify fail", async () => {
    const a = rb({ currentFingerprint: async () => "zzz" });
    const out = await runRollback(a);
    expect(out.stoppedAt).toBe("verify");
    expect(out.checks.find((c) => c.key === "account_verified")!.status).toBe("fail");
  });
});
