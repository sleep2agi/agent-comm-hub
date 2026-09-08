# Getting Started (5 steps)

<!-- 🔴 Two machine-readable stamps, read by scripts/check-doc-version-claims.py; invisible when rendered.
     This page makes several **version-scoped behavioural claims** (what the very first command does on a
     given version). They all become false the moment a new version ships. The release gate compares the
     version being published against these stamps and blocks the release, listing every line to update.
     Change the prose, change the stamp — the gate also fails when the two disagree.
     Only "current state" claims are stamped; historical references (e.g. `<= 2.3.0-preview.37`) are not. -->
<!-- version-claim: package=agent-network channel=latest version=2.3.0-preview.76 -->
<!-- version-claim: package=agent-network channel=preview version=2.3.0-preview.88 -->

The minimum path for a brand-new user — **5 steps, 5 minutes**. One command + one verification per step.

::: tip Fastest path (recommended) — zero config if you have a Claude subscription
The easiest route: with Claude Code CLI installed (`npm i -g @anthropic-ai/claude-code`) and `claude auth login` done, pick the **`claude-code-cli` runtime** in Step 4 — no API key, no model picker, just one command to bring a personal AI employee online that does real work and takes orders from your phone. This is the **most stable, least error-prone** path.

No Claude subscription? Use `claude-agent-sdk` + one model API key (MiniMax / DeepSeek / InternLM / Xiaomi), see Step 4.
:::

::: tip Already have anet installed?
Skip this page and go to the [Upgrade Guide](/en/guide/upgrade) (usually `anet upgrade` + `anet project restart` to restart cwd nodes).
:::

**Prerequisites** (install both):

- **Node.js ≥ 22.13.0**
- **Bun ≥ 1.2.0** — install with `npm i -g bun` (or `curl -fsSL https://bun.sh/install | bash`). Step 2's `anet hub start` launches `commhub-server` via `bunx`, so **without Bun that step always fails**, but how depends on the channel:
  · **builds that carry the preflight** (measured 2026-08-30 on `2.3.0-preview.47`; since 2026-09-02 both `latest` and `preview` are `2.3.0-preview.76`, and the preflight has been present since `.47`): refused before launch with `❌ anet hub start requires the Bun runtime` (exit code 1);
  · **older builds without it** (measured on `2.2.21`): a bare `Error: spawn bunx ENOENT` plus a Node stack trace.
  After installing, `bun --version` should print a version.

With both installed, `commhub-server` / `agent-node` are auto-fetched on first use — you don't install them manually.

---

## 1. Install the CLI

```bash
npm install -g @sleep2agi/agent-network
```

Verify:

```bash
anet -v
```

---

## 2. Start the Hub

Open terminal #1, **keep it running**:

```bash
anet hub start
```

The hub listens on `http://127.0.0.1:9200` by default, the SQLite DB lives at `~/.commhub/commhub.db`, and the default admin account **admin / anethub** is created automatically.

::: warning `@preview` prints a **one-time random password** on first start
This page describes the npm `latest` channel. On `@preview` (`npm install -g @sleep2agi/agent-network@preview`) the first `anet hub start` **prints a freshly generated random password once** (shown once, not recoverable later); log in with it, then `anet passwd` to your own strong password. **Do NOT hard-code `anethub` for preview** — the fixed password only holds on `latest`.
:::

::: warning Change the password before going public
The default `admin / anethub` is for local quickstart only (latest channel). **Any `--host 0.0.0.0` public deployment must `anet passwd` to a strong password immediately.** Preview channel has no fixed password — see the note above.
:::

::: tip Stop / status
`anet hub status` / `anet hub stop` (no more `lsof + kill`).
:::

---

## 3. Start the Dashboard + log in

Open terminal #2, **keep it running**:

```bash
anet hub dashboard
```

Open `http://localhost:3000` in your browser and log in as `admin` with **the password your own `anet hub start` printed**.

::: warning Take the password from your own `anet hub start` output — do not copy it from this page
The first `anet hub start` prints the admin credentials once:

```
✅ Admin account created
   username: admin
   password: <the string printed there>
   Store this password now; it will not be shown again.
```

🔴 **Do not copy the `anethub` in the command below.** Both `latest` and `preview`
currently install versions that print a **random** password, so copying it will fail —
the only reliable move is to read your own startup output.

Measured 2026-08-27 (one `anet hub start` per version in a clean container, no `--password`):

| installed version | printed password |
|---|---|
| `2.3.0-preview.47` (`latest` at the time) | `anet-3ce2750defe04d9ab3baf0` — **random**, with a change-on-first-login notice |
| `2.3.0-preview.49` (`preview` at the time) | `anet-7fe4eddb08f648dcbd7fcd` — **random**, same notice |
| `2.3.0-preview.76` (current `latest`) | Also **random** — not re-measured per version: `server/src/auth.ts`, which generates it, has had **zero commits** since `.49` shipped (2026-08-27T02:25Z); the logic is byte-identical |
| `2.3.0-preview.88` (current `preview`) | Also **random** — not re-measured per version: `server/src/auth.ts`, which generates it, has had **zero commits** since `.49` shipped (2026-08-27T02:25Z); the logic is byte-identical |

Neither run printed the literal `anethub` anywhere.

The fixed `anethub` only exists on `2.2.x` and earlier. **This table names versions rather
than channels on purpose**: `latest` moves — before 2026-08 it pointed at `2.2.21` (which
really did use a fixed password), and it now points at a preview build. **"latest uses a
fixed password" is not merely stale; it becomes wrong when the channel moves.**

The credentials are also written to `~/.anet/server/admin-utok.json`, which holds only
`username` / `user_id` / `token` / `created_at` — **the password is not in there**, so if you
miss that one line of output you have to bootstrap again.

🔴 Also: **`anet login` currently exits 0 even when it fails** (both `latest` and `preview`; fixed on main — see #716 / #722).
⇒ **Do not use `anet login && <next step>` to decide whether login worked** — it will carry on after a failure. Confirm with `anet whoami`.
:::

In terminal #3, log the CLI in too (so subsequent `anet node ...` commands carry the credentials):

```bash
anet login --hub http://127.0.0.1:9200 --username admin --password anethub
```

`anet whoami` confirms your identity.

---

## 4. Create and start a node

```bash
anet node create my-bot
```

The wizard asks: runtime → (only for `claude-agent-sdk`) vendor → model → API key.

::: tip Easiest path for newcomers — pick `claude-code-cli` manually
The wizard **defaults to highlighting `claude-agent-sdk`**; pressing Enter all the way lands you on the vendor + API-key path. If you've already done `claude auth login`, **manually picking `claude-code-cli`** is the zero-config fastest path.

On stable, `anet node create` lists **4 production runtimes** (`claude-agent-sdk` / `claude-code-cli` / `codex-sdk` / `grok-build-acp`); the full comparison (including the preview-only `opencode-cli`, not yet in the stable picker) is here: [Runtime comparison](/en/guide/runtimes#runtimes-—-canonical-table).
:::

Start the node:

::: warning Fresh install + claude-agent-sdk / codex-sdk? Install agent-node first
These runtimes depend on the `agent-node` package. The first `node start` triggers an npx auto-fetch that takes ~1 minute, but on **builds `≤ 2.3.0-preview.37`** (including the older `2.2.21`) the startup check **doesn't wait for it** and exits with `agent-node is not installed or cannot report a version` (reproduced on real hardware — [#450](https://github.com/sleep2agi/agent-network/issues/450) is the precise filing, #237 is the umbrella). **Root fix** is [PR #239](https://github.com/sleep2agi/agent-network/pull/239) (commit `1eff3a4d`, merged 2026-06-28); Vincent's 2026-08-09 audit verified the fix in an isolated Docker probe on `2.3.0-preview.38` reaching SSE connected. **the fix has been in builds since `2.3.0-preview.38`** (check yours with `anet -v`; check where the channels point with `npm view @sleep2agi/agent-network dist-tags` — measured 2026-08-30, `latest` is already `2.3.0-preview.47`, i.e. **past that floor**) — [#450](https://github.com/sleep2agi/agent-network/issues/450) is still `open` pending 4 acceptance gates before latest promotion. **Workarounds** (in verified-strength order): upgrade to `@sleep2agi/agent-network@preview`; or stay on `@latest` but pre-install `agent-node` so the binary is already there:

```bash
npm install -g @sleep2agi/agent-node
```
:::

```bash
anet node start my-bot
```

When you see `SSE connected`, the node is online. Keep the terminal running.

::: warning Ctrl+C during vendor selection can leave a half-baked node
Clean a half-baked node with `anet node delete <alias>` (run once without `--force` to see the will-delete preview, then add `--force` to actually delete).
:::

---

## 5. Use it — dispatch a task from the Dashboard

Back in your browser at `http://localhost:3000`:

1. Open **Overview** and click the online `my-bot` card to open its embedded ChatPanel (there is no standalone Chat navigation page)
2. Type a message in the input ("what time is it?" / "write hello world"), hit Enter
3. Your message appears immediately with an optimistic echo (`You` label)
4. After the agent calls the LLM, the reply appears with full markdown rendering (`↳ my-bot` label)

Refresh the page — chat history is preserved.

✅ **5 steps done**.

---

## Verified vs not verified

::: info Verified (current stable, real-machine walkthrough)
Detailed test reports: [Changelog](/en/changelog) + [test reports](https://github.com/sleep2agi/agent-network/tree/main/docs/tests).

- `anet hub start` + automatic default account creation / `anet hub dashboard`
- `anet login` (with `--hub`) / `anet register` / `anet logout` / `anet whoami`
- **`claude-code-cli` runtime end-to-end** — runs daily on the production fleet (the easiest path, recommended in Step 4); first run needs a TTY for the dev-channels confirmation
- `claude-agent-sdk` `node create` (incl. the vendor path: Anthropic / MiniMax / InternLM / Xiaomi MiMo — verified-with-real-call) + `node ls / delete`
- Dashboard Chat (markdown / Enter-to-send / optimistic echo / source labels / error fallback / persistent history)
:::

::: warning Has caveats / not verified (use at your own risk)
- **`claude-agent-sdk` / `codex-sdk` first `node start`**: on latest, `agent-node`'s lazy-fetch isn't awaited and it exits early (`agent-node is not installed...`, [#450](https://github.com/sleep2agi/agent-network/issues/450)). Run `npm i -g @sleep2agi/agent-node` first, then start (see the Step 4 note above).
- `codex-sdk` runtime end-to-end (real LLM reply) — no OpenAI test key yet, the second half is pending verification
- `anet license` / `anet activate` — v0.6 legacy, OSS users don't need to touch these (see [troubleshooting](/en/troubleshooting#license-expired-license-expired-legacy-behavior))
- `anet network create` and cross-user network sharing — code merged but no E2E regression
- **One-shot install script `setup-anet.sh`** — retired and disabled, do not run an old copy, see [retirement notice](/en/guide/one-shot-install)
:::

::: tip No hosted service
The project direction is **Apache 2.0 open source + self-host + courses / consulting**, **no SaaS**. For production deployments see [Docker](/en/deploy/docker) / [Production](/en/deploy/production).
:::

---

## Next steps

**Advanced**:
- [Multi-agent coordination](/en/guide/architecture#agent-node) — peer agents auto-coordinate via `get_all_status` / `send_task` / `get_task`
- [Batch node management with `anet project up/restart/down`](/en/guide/batch) — start/stop every node under cwd in one command; zero-keyboard recovery after reboot
- [LAN-shared hub](/en/deploy/clean-server#_2-start-the-hub-recommended-under-tmux) — `anet hub start --host 0.0.0.0` lets other machines join

**Demos** (experimental, for a quick taste):
```bash
anet demo                  # list available demos
anet demo pr-review        # PR review room — 3 reviewers (security/perf/style) + judge
```

**Deeper**:
- [CLI command reference](/en/guide/cli)
- [Agent Node config](/en/guide/agent-node) — config.json fields + `/aloop` scheduler
- [Multi-model config](/en/guide/multi-model) — DeepSeek / Kimi / Claude / MiniMax / self-hosted
- [Architecture overview](/en/guide/architecture)
- [Upgrade Guide](/en/guide/upgrade) — any older version → latest with a single `anet upgrade`
