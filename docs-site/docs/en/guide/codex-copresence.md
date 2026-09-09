# Codex TUI Co-presence (`codex-app-server`, preview)

The `codex-app-server` runtime lets a **human and an Agent share one Codex session**: the human types, reads output, and handles approvals in the native Codex TUI while Agent Network tasks arrive through CommHub in the **same Codex thread**. Both sides see the same history and live events. ([RFC-030](https://github.com/sleep2agi/agent-network/blob/main/docs/rfcs/RFC-030-codex-tui-bridge.md), Phase 0A.)

> Unlike the headless `codex-sdk`, which is a background worker without a shareable live TUI, `codex-app-server` provides Codex TUI co-presence.

::: warning Preview
This is **preview-only**. npm `latest` currently contains none of `codex-app-server`, `--copresence`, or `codexAppServerUrl`; commands on this page will not work with a `latest` installation. The current implementation is still a trusted single-machine shape, not the production Policy Gateway. Connect only to a trusted Hub and accept only trusted tasks.
:::

## Prerequisites

- Install and authenticate the Codex CLI (protocol verification baseline: `codex-cli 0.144.x`):

```bash
npm install -g @openai/codex
codex login
```

- Install or switch to the preview channel:

```bash
npm install -g @sleep2agi/agent-network@preview @sleep2agi/agent-node@preview
# If anet is already installed, switch the whole component set:
anet upgrade --channel preview

# Verify: versions must say preview and help must include Co-presence / --copresence
anet -v
anet --help
```

- On Linux, macOS, and WSL, the one-command path also needs `bash` and **tmux 3.2+**. Native Windows uses managed background processes plus the current PowerShell/Windows Terminal and does not need tmux.
- The node must have a network-scoped `ntok_`. Run `anet doctor --fix` for an old node with no token, or recreate it.

## Recommended: choose co-presence at creation, then start or resume with one command

```bash
# 0. From an external clean shell, enter the project the node should operate on
cd /path/to/project

# Remove every inherited COMMHUB_* identity; do not enumerate only known names
for v in $(env | sed -n 's/^\(COMMHUB_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done

# 1. Interactive creation: enter a node name, then choose “codex-cli — Codex co-presence TUI”
anet node create

# 2. Start the app-server, bridge, and attachable Codex TUI
anet node start codex-human

# 3. Linux/macOS/WSL: enter the shared human/agent TUI
tmux attach -t =codex-human
```

On native Windows, step 2 opens the Codex TUI directly in the current PowerShell/Windows Terminal. There is no step 3. To stop the complete topology, keep the TUI open and run `anet node stop codex-human` from another terminal.

A Codex thread inherits its working directory from the **app-server process cwd**, not the bridge cwd. `cd` into the target project **before** `--copresence`. On Linux, verify with `readlink /proc/<app-server-pid>/cwd`; checking only the bridge is insufficient.

`create --copresence` records the choice in the node profile. After that, plain `node start` rebuilds the same co-presence topology after a stop or interruption; the flag does not need to be repeated. For an existing node, run `anet node start codex-human --copresence` once and later starts can use the plain command.

`codex-cli` in the interactive runtime menu means co-presence mode: selecting it writes `codexCopresence: true` immediately, with no second question. `codex-sdk` is the headless Codex worker. Scripts can use the equivalent `anet node create codex-human --runtime codex-cli`; the older `--runtime codex-app-server --copresence` form remains compatible.

::: warning Release channel
The interactive choice ships from **preview.42**; native Windows one-command orchestration ships from **preview.43**. The Windows path passed a real `windows-latest` ConPTY test covering interactive creation, first start, stop, restart, and a second stop, with the restart proven to resume the same thread.
:::

Linux/macOS/WSL startup creates three tmux sessions carrying one shared identity marker. Windows creates two managed background processes and keeps the TUI in the current console:

| Session | Role |
|---|---|
| `codex-human-appsrv` | loopback-only `codex app-server` with CommHub MCP injected |
| `codex-human-桥` | the `agent-node` bridge that receives network tasks and submits them to the thread |
| `codex-human` | the native Codex TUI that a human can attach to |

On Windows, anet records each app-server/bridge PID, process creation time, and log path in private node state. `stop` calls `taskkill /T` only when both PID and creation time still match, preventing PID reuse from killing an unrelated process. Native Windows ACLs restrict credential state to the current user, SYSTEM, and Administrators.

### Use exact tmux targets

`codex-human` is also a prefix of the other two session names. A normal
`-t codex-human` selector can silently match `codex-human-appsrv` or the bridge after
the TUI session exits. List the sessions and panes before operating:

```bash
tmux list-sessions -F '#{session_name}'
tmux list-panes -t =codex-human -F '#{pane_id} #{pane_current_command}'
tmux attach -t =codex-human
```

Use `-t =codex-human` for exact matching—or a pane ID such as `%42`—with
`capture-pane`, `send-keys`, and similar commands. Prefix matching is especially risky
after one of the three sessions dies.

Pressing `Ctrl-B D` in the TUI only detaches; it does not stop the node. Detach first, then stop it from a terminal **outside the co-presence process tree**:

```bash
anet node stop codex-human
```

The stop path uses a persistent identity marker to reap all three sessions and their children. Calling `stop` from inside the co-presence session fails closed so it cannot kill the caller's own shell.

::: info macOS stop guarantee
macOS uses the same startup, attachment, and TUI co-presence path as Linux, but P3 process-identity teardown depends on Linux `/proc`, so stopping on macOS degrades to the legacy sweep. The feature remains usable, but cleanup is less strongly guaranteed than on Linux. Run `anet node stop` outside the co-presence process tree and confirm that all three tmux sessions have exited.
:::

::: danger Stop the old process tree before recovery
The node profile remembers co-presence, so plain `anet node start codex-human` re-enters co-presence orchestration rather than downgrading to a headless node. Do not start again while an old bridge survives. From an external shell, stop the old tree, clear every `COMMHUB_*` variable, and restart with:

```bash
anet node stop codex-human
cd /path/to/project
for v in $(env | sed -n 's/^\(COMMHUB_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done
anet node start codex-human
```

This is not theoretical: the production node `TM副责人` ran a silent duplicate for about two days, and `A站副责人` did so for about nine days after operators followed the generic hint ([#535](https://github.com/sleep2agi/agent-network/issues/535)).
:::

### Check the TUI for a pending approval before the first dispatch

::: danger The node can look completely healthy while doing nothing
Once a TUI attaches, MCP tool calls become interactive. With nobody watching the pane, the node stalls forever on:

```
Allow the commhub MCP server to run tool "get_task"?
› 1. Allow   2. Allow for this session   3. Always allow   4. Cancel
```

**Every signal the hub exposes still reads healthy**: `status=idle`, SSE connected, `last_seen_at` ticking. A dispatcher sees nothing wrong and assumes the node is simply free.

**The only way to detect it** (no hub field reveals this):

```bash
tmux capture-pane -t =<alias> -p | grep "Allow the commhub MCP"
```

**Fix**: choose `3. Always allow` — the commhub tools are what the node needs to function — or start the app-server with `-c approval_policy=never` so the prompt never appears.

Measured 2026-07-31: reproduced on a freshly created TUI; pre-existing co-presence nodes on the same host were unaffected because their app-servers were started with `approval_policy=never`. **This is a new-TUI hazard, not a latent fleet problem.**
:::

## Lifecycle commands: `anet node codex …` (read-only checks land first)

Restarting or resuming a co-presence node used to be a manual runbook ("Codex TUI safe restart"). Every check in it is becoming a deterministic CLI step: no LLM on the happy path, machine-readable receipts only. The first two commands are read-only:

```bash
anet node codex preflight <alias>          # read-only checks, exit 0 = PASS / exit 2 = FAIL
anet node codex verify    <alias> --json   # preflight + child-process environment + cross-node identity attestation; JSON for automation
```

### restart / start / resume: a deterministic state machine, zero LLM calls

```bash
anet node codex restart <alias> --probe-from <another local node>   # stop Bridge→TUI→App Server, relaunch, re-verify
anet node codex start   <alias> --probe-from <peer>                  # only when none of the three is alive; otherwise use restart
anet node codex resume  <alias> --thread <36-char thread id> --probe-from <peer>
```

Every step of `restart` runs in a fixed order with no reasoning: **preflight (before)** — any fail means no process is touched → read the **goal state** (unreadable or unknown schema = unknown → STOP) → stop in reverse dependency order **Bridge → TUI → App Server** (cut the task inlet first, let the TUI flush its rollout, release the port last) → wait for the rollout byte count to settle (large sessions flush slowly) → wait for the port to free (a holder is only sent a targeted TERM when it is verified to be this node's own leftover app-server; a foreign pid is a FAIL and is never touched) → hand over to the launcher, `anet node start --copresence --tui-first` (**App Server → port ready → exact-session TUI fully restored → Bridge**, so no task can land on a session the human cannot see yet) → **verify (after)**: every preflight item + child-process environment + rollout before/after comparison (same file, bytes may only grow) + goal file unchanged + hub back online + cross-node nonce attestation. A failed launch is rolled back once (relaunch with the original config); if that fails too the node stays stopped and the receipt records the step.

`--probe-from <peer>` makes another local node send the target a task carrying a random nonce through the hub; `identity_attested` passes only when the reply reaches the peer's inbox with the hub-attributed sender equal to the target alias. Without a peer the item is unknown and the verdict is **FAIL** on purpose — "probably it" is not accepted. `resume --thread` takes a full 36-character id only, and only writes it to the config when exactly one rollout for that id exists under this node's CODEX_HOME: no prefixes, no "latest" guessing.

`--json` prints the whole receipt (with `stoppedAt` / `rolledBack`) for the Dashboard health-check button.

What `preflight` checks (each pass / fail / unknown; **anything but pass fails the whole receipt** — no partial success): the alias maps exactly to the `node_id` the hub roster holds; the node's own `CODEX_HOME` is 0700, `auth.json` 0600, and the CommHub token fingerprint matches; the working directory agrees across the config, the TUI process cwd, the TUI `-C` argument and the Bridge process; `codexThreadId` is a full 36-character id with exactly one rollout in that `CODEX_HOME` (absolute path, inode, bytes and mtime are recorded; prefixes or "the newest file" are refused); the app-server port is held by this node's own process (anything else is a foreign PID and is never touched); all three tmux segments (app-server / TUI / bridge) are running and their child processes carry this node's identity marker.

Receipts are written to `.anet/nodes/<id>/receipts/<id>.json` (0600): credentials appear only as irreversible short fingerprints, never in receipts, logs or arguments. Until the cross-node nonce probe lands, `verify` reports `identity_attested` as unknown and therefore always FAILs — by design. start / restart / resume / fork / account / rollback follow in batches; the contract lives in repository issue #1856.

## Permissions: read-only by default, explicit double opt-in for full access

Co-presence defaults to `sandbox_mode=read-only` with on-request approvals. If Codex must write files or use unrestricted command/network tools, opt in explicitly:

```bash
anet node start codex-human --copresence --dangerously-allow-full-access
```

- An interactive terminal requires you to type `yes`.
- A non-TTY script, CI job, or Docker caller must also pass `--yes-danger-full-access`:

```bash
anet node start codex-human --copresence \
  --dangerously-allow-full-access \
  --yes-danger-full-access
```

The second flag is only for non-interactive callers and cannot be omitted; it prevents piped input from bypassing confirmation. Full access disables the filesystem/network sandbox, so use it only in a trusted workspace with trusted tasks.

## A normal `codex-app-server` node is not co-presence

Without `--copresence`:

```bash
anet node create codex-worker --runtime codex-app-server
anet node start codex-worker
```

The node spawns a private app-server and a fresh thread. This is useful as a codex-backed background Agent, but there is no human-attachable TUI, so this path **is not co-presence**.

## Advanced adoption: manual shared WebSocket

For everyday native Windows use, run the one-command flow above. This section is only for adopting an existing app-server or debugging. Give **each node its own app-server and port; never share one across nodes**: the CommHub bearer token is app-server process state, so sharing mixes thread identities and creates a single point of failure.

```powershell
# Check that the chosen port is free; this is a placeholder
# Windows PowerShell:
Get-NetTCPConnection -LocalPort <free-port> -ErrorAction SilentlyContinue

# Terminal 1: enter the target project before starting the dedicated app-server
cd C:\path\to\project
$env:CODEX_HOME = "C:\path\to\project\.anet\nodes\codex-human\codex-home"
codex app-server --listen ws://127.0.0.1:<free-port>

# Terminal 2: start the bridge first so it creates/captures a thread
# and writes codexThreadId to the node config
Get-ChildItem Env:COMMHUB_* | ForEach-Object { Remove-Item "Env:$($_.Name)" }
$env:CODEX_HOME = "C:\path\to\project\.anet\nodes\codex-human\codex-home"
anet node create codex-human --runtime codex-app-server --codex-app-server-url ws://127.0.0.1:<free-port>
anet node start codex-human

# Read codexThreadId/model from config.json, then attach Terminal 3 to that
# exact thread while using this node's CODEX_HOME
$env:CODEX_HOME = "C:\path\to\project\.anet\nodes\codex-human\codex-home"
codex resume --remote ws://127.0.0.1:<free-port> <codexThreadId> -m <model>
```

`codex resume --remote` must align all four values: the node-isolated `CODEX_HOME`, `codexAppServerUrl`, `codexThreadId`, and `model`. Omitting the thread id opens a historical-session picker. Omitting `CODEX_HOME` is more deceptive: Codex can use the default `~/.codex` and silently connect to external port 443, leaving an empty pane that looks successfully attached while it is actually an independent cloud session. When the bridge first writes `codexThreadId`, it prints copyable POSIX and PowerShell resume commands. You may also pass `--codex-thread-id <id>` when creating the node to adopt a specific thread; otherwise the runtime captures one and writes it back.

Do not treat an empty pane as proof. After manual startup, inspect the TUI process socket and verify it connects to the configured loopback `codexAppServerUrl` rather than external `:443`, then verify the same thread id from both the TUI and bridge sides. Linux/macOS also must run `export CODEX_HOME='<node-directory>/codex-home'` before `codex resume` with `--remote`, the thread id, and `-m`.

All three terminals in a manual topology must also set the **same node-specific `CODEX_HOME`** explicitly. If any terminal omits it, Codex can silently fall back to the user's default `~/.codex`: the TUI appears to start but belongs to a different cloud session instead of this loopback app-server. Do not share a persistent node's `CODEX_HOME` with the primary Codex session.

Advanced Linux/macOS users can also use this topology with an existing app-server, but prefer `--copresence` for everyday use because it manages loopback binding, isolated `CODEX_HOME`, MCP injection, tmux lifecycle, and stop identity together. If common ports such as 24700–24720 are occupied by other co-presence nodes, choose another free loopback port and check it before starting.

Concretely, "inspect the TUI process socket" means this, and the criterion is the **number of connection pairs**:

```bash
ss -tnp | grep '127.0.0.1:<app-server-port>'
```

A healthy attach shows **two** ESTAB pairs — one for the bridge, one for the TUI. **Only one pair means the TUI did not attach**, and the pane looks identical either way. Measured 2026-08-26 on Linux: a TUI started without `CODEX_HOME` had exactly one TCP connection from its codex child, and it went to public `:443`.

The app-server **accepts multiple clients**, so the TUI can join the same thread while the bridge is connected. **There is no need to stop the bridge first** (measured on the same host: the bridge kept its 6-second round trip after a new TUI attached).

A manually started app-server does not automatically get the CommHub MCP injection supplied by `--copresence`. If the human TUI needs direct `commhub_*` tools, configure the RFC-030 MCP URL and bearer-token environment variable **before the app-server creates the thread**. Existing threads snapshot their tool set, so adding MCP later does not work. Never put the token in argv or chat.

::: warning Codex CLI update prompt
The TUI may show `Update available` with upgrade-now selected by default. On a shared host, choose skip/later and schedule Codex CLI upgrades for a maintenance window; replacing the global binary may affect every co-presence node on that machine.
:::

## Long tasks and the 600-second message

Only one turn can be active in a thread; later network tasks queue FIFO. The current network-task wait for a final answer **defaults** to 600 seconds (runtime options can override it; it is not an immutable hard cap):

- “No final reply within 600s” **does not prove the node is dead** and does not cancel the Codex turn already running.
- Do not immediately dispatch the same task again. First inspect `tmux capture-pane -t =codex-human -p | tail -30` and whether the workspace is still changing.
- Break code-heavy or tool-heavy work into steps that can report within ten minutes. If the turn is genuinely stuck, follow the [codex-app-server jam diagnosis and restart SOP](https://github.com/sleep2agi/agent-network/blob/main/docs/sop/codex-app-server-jam-restart.md): preserve work before restarting.

## Security and known limits

- The app-server binds to `127.0.0.1`; tokens and secrets must not enter argv, git, or chat.
- A thread has one active turn at a time. “Concurrent communication” means multiple producers can enqueue work, not that turns execute in parallel.
- In the default mode the bridge never answers approvals; approval-requiring turns wait for the human TUI. Full access is the explicit high-risk exception.
- Phase 0A still connects the TUI and bridge as direct clients. The production single-upstream Policy Gateway, mandatory arbitration, and minimal control plane are not implemented yet.

## References

- [RFC-030 Codex TUI Bridge](https://github.com/sleep2agi/agent-network/blob/main/docs/rfcs/RFC-030-codex-tui-bridge.md)
- [Node runtimes](/en/guide/runtimes)
- [CLI: `anet node start`](/en/guide/cli#anet-node-start)
- [Grok Co-presence TUI](/en/guide/grok-copresence)
