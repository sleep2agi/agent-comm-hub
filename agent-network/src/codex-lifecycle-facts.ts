// #1856 —— 给 preflight / verify 量事实的 IO 层。只读:不写节点目录、不碰进程、不发探针。
// 所有原语可注入(tmux / /proc / hub / fs),真机默认实现在下面;非 Linux 上读不到的项返回 null,
// 由纯判定层报 unknown —— 不冒充「量到了」。
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { shortFingerprint } from "./codex-lifecycle-receipt";
import type { PreflightFacts, ProcessFact, RolloutFact } from "./codex-lifecycle-preflight";

export interface FactPrimitives {
  /** tmux pane pid of a session, or null when the session is not running. */
  tmuxPanePid(session: string): number | null;
  /** all pids (Linux /proc); [] elsewhere */
  listPids(): number[];
  procStatPpid(pid: number): number | null;
  procCwd(pid: number): string | null;
  procArgv(pid: number): string[] | null;
  procEnviron(pid: number): Record<string, string> | null;
  /** pid listening on a loopback TCP port, or null (free / unknown) */
  listeningPid(port: number): number | null;
  /** hub roster: alias → node_id, or null when unreachable */
  hubNodeIdFor(alias: string): Promise<string | null>;
}

export function realPrimitives(opts: { hub: string; token: string; networkId?: string }): FactPrimitives {
  const linux = process.platform === "linux";
  return {
    tmuxPanePid(session) {
      // 🔴 不用 `-t =name`:tmux 3.4 上对这类会话名(含 CJK)精确匹配返回空;`-t name` 又是前缀匹配,
      //    「通信牛」会命中「通信牛-appsrv」。列出全部 pane 后按 session_name **逐字相等**挑,不做任何前缀猜测。
      try {
        const out = execFileSync("tmux", ["list-panes", "-a", "-F", "#{session_name}\t#{pane_pid}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 });
        for (const line of out.split("\n")) {
          const tab = line.indexOf("\t");
          if (tab < 0 || line.slice(0, tab) !== session) continue;
          const pid = Number(line.slice(tab + 1).trim());
          return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
        }
        return null;
      } catch { return null; }
    },
    listPids() {
      if (!linux) return [];
      try { return readdirSync("/proc").map(Number).filter((n) => Number.isInteger(n) && n > 0); } catch { return []; }
    },
    procStatPpid(pid) {
      if (!linux) return null;
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/);
        const ppid = Number(fields[1]);
        return Number.isSafeInteger(ppid) ? ppid : null;
      } catch { return null; }
    },
    procCwd(pid) {
      if (!linux) return null;
      try { return realpathSync(readlinkSync(`/proc/${pid}/cwd`)); } catch { return null; }
    },
    procArgv(pid) {
      if (!linux) return null;
      try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter((s) => s.length > 0); } catch { return null; }
    },
    procEnviron(pid) {
      if (!linux) return null;
      try {
        const raw = readFileSync(`/proc/${pid}/environ`, "utf8");
        const env: Record<string, string> = {};
        for (const kv of raw.split("\0")) { const i = kv.indexOf("="); if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1); }
        return env;
      } catch { return null; }
    },
    listeningPid(port) {
      if (!linux) return null;
      try {
        const out = execFileSync("ss", ["-ltnpH"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 });
        for (const line of out.split("\n")) {
          if (!new RegExp(`:${port}\\s`).test(line)) continue;
          const m = /pid=(\d+)/.exec(line);
          if (m) return Number(m[1]);
        }
        return null;
      } catch { return null; }
    },
    async hubNodeIdFor(alias) {
      try {
        const q = opts.networkId ? `?network_id=${encodeURIComponent(opts.networkId)}` : "";
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8_000);
        const res = await fetch(`${opts.hub}/api/nodes${q}`, { headers: { Authorization: `Bearer ${opts.token}` }, signal: ctl.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const body = await res.json() as { nodes?: Array<{ alias?: string; node_id?: string }> };
        const hit = (body.nodes ?? []).find((n) => n.alias === alias);
        return hit?.node_id ?? null;
      } catch { return null; }
    },
  };
}

function modeOf(path: string): number | null { try { return lstatSync(path).mode & 0o777; } catch { return null; } }
function bytesOf(path: string): number | null { try { return statSync(path).size; } catch { return null; } }

export function envFileTokenFingerprint(codexHome: string): string | null {
  try {
    const raw = readFileSync(join(codexHome, ".anet-copresence.env"), "utf8");
    const m = /ANET_CODEX_COMMHUB_TOKEN=(?:'([^']*)'|"([^"]*)"|(\S+))/.exec(raw);
    return shortFingerprint(m?.[1] ?? m?.[2] ?? m?.[3] ?? null);
  } catch { return null; }
}

/** rollout-*-<threadId>.jsonl under CODEX_HOME/sessions/**;精确后缀匹配,不做前缀/最近猜测。 */
export function findRollouts(codexHome: string, threadId: string | null): RolloutFact[] {
  if (!threadId) return [];
  const root = join(codexHome, "sessions");
  const out: RolloutFact[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const p = join(dir, name);
      let st; try { st = lstatSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (st.isFile() && name.endsWith(`-${threadId}.jsonl`)) out.push({ path: p, inode: st.ino, bytes: st.size, mtimeMs: st.mtimeMs });
    }
  };
  walk(root, 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** 从 pane pid 往下找子孙进程(含自身),按 pid 升序。 */
export function descendants(prim: FactPrimitives, rootPid: number): number[] {
  const all = prim.listPids();
  const byParent = new Map<number, number[]>();
  for (const pid of all) { const pp = prim.procStatPpid(pid); if (pp !== null) byParent.set(pp, [...(byParent.get(pp) ?? []), pid]); }
  const out: number[] = []; const stack = [rootPid];
  while (stack.length) { const p = stack.pop()!; out.push(p); for (const c of byParent.get(p) ?? []) stack.push(c); }
  return [...new Set(out)].sort((a, b) => a - b);
}

export function processFact(prim: FactPrimitives, pid: number): ProcessFact {
  const env = prim.procEnviron(pid);
  return {
    pid,
    cwd: prim.procCwd(pid),
    codexHome: env?.CODEX_HOME ? safeReal(env.CODEX_HOME) : null,
    tokenFingerprint: shortFingerprint(env?.ANET_CODEX_COMMHUB_TOKEN ?? null),
    markerUuid: env?.ANET_NODE_MARKER ?? null,
    argv: prim.procArgv(pid) ?? [],
  };
}

function safeReal(p: string): string { try { return realpathSync(p); } catch { return p; } }

function argvDirAfterC(argv: readonly string[]): string | null {
  const i = argv.indexOf("-C");
  if (i >= 0 && argv[i + 1]) return safeReal(argv[i + 1]);
  const eq = argv.find((a) => a.startsWith("-C=") || a.startsWith("--cd="));
  return eq ? safeReal(eq.slice(eq.indexOf("=") + 1)) : null;
}

export interface GatherInput {
  alias: string;
  nodeId: string | null;
  nodeDir: string;
  codexHome: string;
  configToken: string | null;
  codexProjectDir: string | null;
  codexThreadId: string | null;
  codexAppServerUrl: string | null;
  sessions: { appsrv: string; bridge: string; tui: string };
  recordedPids: { appsrv: number | null; bridge: number | null; tui: number | null };
  markerUuid: string | null;
}

export async function gatherCodexFacts(prim: FactPrimitives, input: GatherInput): Promise<PreflightFacts> {
  const configTokenFingerprint = shortFingerprint(input.configToken);
  const live = {
    appsrv: prim.tmuxPanePid(input.sessions.appsrv),
    bridge: prim.tmuxPanePid(input.sessions.bridge),
    tui: prim.tmuxPanePid(input.sessions.tui),
  };
  const treeOf = (pid: number | null) => (pid === null ? [] : descendants(prim, pid).map((p) => processFact(prim, p)));
  const tuiTree = treeOf(live.tui), bridgeTree = treeOf(live.bridge), appsrvTree = treeOf(live.appsrv);
  const codexTui = [...tuiTree].reverse().find((p) => p.argv.some((a) => /codex/.test(a)) && !p.argv.some((a) => /app-server/.test(a))) ?? null;
  const bridgeProc = [...bridgeTree].reverse().find((p) => p.argv.some((a) => /agent-node|bridge/.test(a))) ?? bridgeTree[bridgeTree.length - 1] ?? null;
  const port = (() => { try { return input.codexAppServerUrl ? Number(new URL(input.codexAppServerUrl).port) || null : null; } catch { return null; } })();
  const ownerPid = port ? prim.listeningPid(port) : null;
  // 子进程环境:三段各取「带 CODEX_HOME 的最深进程」;wrapper(tmux 的 shell)没有 CODEX_HOME 就不算证据。
  const children = [...appsrvTree, ...tuiTree, ...bridgeTree].filter((p) => p.codexHome !== null || p.tokenFingerprint !== null);
  return {
    alias: input.alias,
    configNodeId: input.nodeId,
    hubNodeId: await prim.hubNodeIdFor(input.alias),
    home: {
      dir: safeReal(input.codexHome),
      dirMode: modeOf(input.codexHome),
      authMode: modeOf(join(input.codexHome, "auth.json")),
      authBytes: bytesOf(join(input.codexHome, "auth.json")),
      configTokenFingerprint,
      envFileTokenFingerprint: envFileTokenFingerprint(input.codexHome),
    },
    workdir: {
      configProjectDir: input.codexProjectDir ? safeReal(input.codexProjectDir) : null,
      tuiCwd: codexTui?.cwd ?? null,
      tuiArgvDir: codexTui ? argvDirAfterC(codexTui.argv) : null,
      bridgeProjectDir: bridgeProc?.cwd ?? null,
      statusBarDir: null,
    },
    session: { threadId: input.codexThreadId, rolloutMatches: findRollouts(input.codexHome, input.codexThreadId) },
    port: { port, owner: ownerPid ? processFact(prim, ownerPid) : null },
    topology: {
      markerUuid: input.markerUuid,
      recorded: input.recordedPids,
      live,
      liveMarkers: { appsrv: appsrvTree.map((p) => p.markerUuid), bridge: bridgeTree.map((p) => p.markerUuid), tui: tuiTree.map((p) => p.markerUuid) },
      liveHomes: { appsrv: appsrvTree.map((p) => p.codexHome), bridge: bridgeTree.map((p) => p.codexHome), tui: tuiTree.map((p) => p.codexHome) },
    },
    goal: { state: "unknown" },
    children,
    expectedTokenFingerprint: configTokenFingerprint,
  };
}
