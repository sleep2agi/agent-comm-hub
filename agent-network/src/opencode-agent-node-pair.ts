// RFC-029 release pairing. agent-network must never hand `opencode-cli` to
// an older agent-node that treats an unknown runtime as its legacy default.
// Keep this exact pair in lockstep with the two preview package versions; the
// unit test intentionally fails when either package is bumped independently.

import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "fs";
import type { Stats } from "fs";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "path";
import { opencodeOwnedPathModeIsSafe } from "./opencode-owner-mode";
import { describeUnsafePath } from "./unsafe-package-path-reason";

export const PAIRED_AGENT_NETWORK_VERSION = "2.3.0-preview.88";
export const PAIRED_AGENT_NODE_VERSION = "2.5.0-preview.68";
export const PAIRED_AGENT_NODE_SPEC = `@sleep2agi/agent-node@${PAIRED_AGENT_NODE_VERSION}`;
// Backward-compatible names for the first consumer of the shared pair.
export const OPENCODE_AGENT_NETWORK_VERSION = PAIRED_AGENT_NETWORK_VERSION;
export const OPENCODE_AGENT_NODE_VERSION = PAIRED_AGENT_NODE_VERSION;
export const OPENCODE_AGENT_NODE_SPEC = PAIRED_AGENT_NODE_SPEC;

export type PairedAgentNodeResolution = {
  spec: string;
  args: string[];
  allowPathGlobal: false;
};

/** The codex bridge must resolve the immutable release pair, independent of PATH. */
export function pairedAgentNodeResolution(): PairedAgentNodeResolution {
  return {
    spec: PAIRED_AGENT_NODE_SPEC,
    args: ["-y", PAIRED_AGENT_NODE_SPEC, "--print-entrypoint"],
    allowPathGlobal: false,
  };
}

export function agentNodeHelpSupportsCodexAppServer(help: string): boolean {
  return help.includes("codex-app-server");
}

export function opencodeExactPairInstallCommand(): string {
  return `npm install -g @sleep2agi/agent-network@${OPENCODE_AGENT_NETWORK_VERSION} ${OPENCODE_AGENT_NODE_SPEC}`;
}

/** Runtime capability advertised by agent-node's operator-facing help. */
export function agentNodeHelpSupportsOpencode(help: string): boolean {
  return help.includes("opencode-cli");
}

function sameIdentity(
  left: { dev: number | bigint; ino: number | bigint },
  right: { dev: number | bigint; ino: number | bigint },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertSafePackagePath(path: string, kind: "file" | "directory"): Stats {
  const stat = lstatSync(path) as Stats;
  if (
    (kind === "file" ? !stat.isFile() : !stat.isDirectory())
    || stat.isSymbolicLink()
    // Windows exposes synthetic POSIX uid/mode values; package identity,
    // canonical paths, and the project-root exclusion remain enforceable,
    // while ACL review is left to the OS/npm install boundary.
    || (process.platform !== "win32" && !opencodeOwnedPathModeIsSafe(stat))
  ) {
    // Same reasoning as the grok resolver: on a stock Debian/Ubuntu box the
    // condition that fires is the group-write bit npm inherits from umask
    // 0002, and a message that leads with "ownership" sends the reader to the
    // wrong place. Shape/symlink failures keep their own wording.
    if (kind === "file" && stat.isFile() && !stat.isSymbolicLink() && process.platform !== "win32") {
      throw new Error(
        `resolved agent-node package has unsafe ownership or mode — ` +
        describeUnsafePath(path, { uid: stat.uid, mode: stat.mode, processUid: process.getuid?.() ?? stat.uid }),
      );
    }
    throw new Error("resolved agent-node package has unsafe ownership or mode");
  }
  return stat;
}

function readPackageJsonNoFollow(path: string): any {
  const before = assertSafePackagePath(path, "file");
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = fstatSync(fd) as Stats;
    const current = lstatSync(path) as Stats;
    if (!sameIdentity(before, opened) || !sameIdentity(opened, current)
      || opened.size <= 0 || opened.size > 1024 * 1024) {
      throw new Error("resolved agent-node package.json identity is unsafe");
    }
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function assertSafeAncestors(packageRoot: string): void {
  let current = packageRoot;
  while (true) {
    assertSafePackagePath(current, "directory");
    if (realpathSync(current) !== current) {
      throw new Error("resolved agent-node package has a symlinked ancestor");
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

/**
 * Resolve a package-owned agent-node entrypoint and verify its immutable
 * release identity before it can receive `opencode-cli`. Capability text is
 * not a security boundary: an older preview already advertised the runtime.
 */
export function validateAgentNodePackageEntrypoint(
  rawEntrypoint: string,
  packageSpec: string,
  expectedVersion?: string,
  forbiddenRoots: readonly string[] = [],
): string {
  if (!isAbsolute(rawEntrypoint)) {
    throw new Error(`${packageSpec} returned a non-absolute entrypoint`);
  }
  const entrypoint = realpathSync(rawEntrypoint);
  const packageRoot = dirname(dirname(entrypoint));
  if (
    basename(packageRoot) !== "agent-node"
    || basename(dirname(packageRoot)) !== "@sleep2agi"
    || basename(dirname(dirname(packageRoot))) !== "node_modules"
  ) {
    throw new Error(`${packageSpec} entrypoint is outside node_modules/@sleep2agi/agent-node`);
  }
  const expectedEntrypoint = join(packageRoot, "dist", "cli.js");
  if (entrypoint !== expectedEntrypoint || realpathSync(expectedEntrypoint) !== expectedEntrypoint) {
    throw new Error(`${packageSpec} entrypoint is outside its package payload`);
  }

  assertSafeAncestors(dirname(entrypoint));
  const entryStat = assertSafePackagePath(entrypoint, "file");
  if (process.platform !== "win32" && (entryStat.mode & 0o111) === 0) {
    throw new Error("resolved agent-node package entrypoint is not executable");
  }
  for (const rawRoot of forbiddenRoots) {
    if (!isAbsolute(rawRoot)) throw new Error("agent-node forbidden root must be absolute");
    const root = realpathSync(resolve(rawRoot));
    if (isWithin(root, packageRoot) || isWithin(packageRoot, root)) {
      throw new Error("project/node-local agent-node package payload is not trusted");
    }
  }

  const packageJsonPath = join(packageRoot, "package.json");
  const pkg = readPackageJsonNoFollow(packageJsonPath);
  if (
    pkg?.name !== "@sleep2agi/agent-node"
    || typeof pkg?.version !== "string"
    || (expectedVersion ? pkg.version !== expectedVersion : !pkg.version.includes("-preview."))
    || pkg?.publishConfig?.tag !== "preview"
    || pkg?.bin?.["agent-node"] !== "dist/cli.js"
  ) {
    throw new Error(
      expectedVersion
        ? `resolved agent-node package is not exact version ${expectedVersion}`
        : "resolved agent-node package is not a preview-channel candidate",
    );
  }

  return entrypoint;
}

/** Skip invalid/local PATH shims and return the first exact trusted package. */
export function resolveAgentNodePackageEntrypointFromPath(
  searchPath: string,
  packageSpec: string,
  expectedVersion: string,
  forbiddenRoots: readonly string[] = [],
): string {
  const errors: string[] = [];
  for (const rawDir of searchPath.split(delimiter)) {
    if (!rawDir || !isAbsolute(rawDir) || rawDir.includes("\0")) continue;
    const candidate = join(rawDir, "agent-node");
    if (!existsSync(candidate)) continue;
    try {
      return validateAgentNodePackageEntrypoint(
        candidate,
        packageSpec,
        expectedVersion,
        forbiddenRoots,
      );
    } catch (error: any) {
      errors.push(String(error?.message ?? error).replace(/[\r\n]+/g, " ").slice(0, 200));
    }
  }
  throw new Error(
    `no exact trusted ${packageSpec} package entrypoint found on PATH` +
    (errors[0] ? `; first rejected candidate: ${errors[0]}` : ""),
  );
}
