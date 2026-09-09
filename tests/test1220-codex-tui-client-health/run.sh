#!/usr/bin/env bash
set -euo pipefail

echo "TEST1220 source=${TEST1220_SOURCE_COMMIT:-unknown}"

expect_red() {
  local label=$1
  shift
  set +e
  "$@" >/tmp/test1220-red.log 2>&1
  local rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    echo "MUTATION_FALSE_GREEN: $label"
    cat /tmp/test1220-red.log
    exit 1
  fi
  echo "MUTATION_RED: $label rc=$rc"
}

echo "L1 build and focused contracts"
(cd agent-node && bun run build)
(cd agent-network && bun run build)
bun test \
  agent-network/src/codex-tui-client-health.test.ts \
  agent-network/src/posix-codex-copresence.test.ts \
  agent-network/src/codex-copresence-launch-readiness.test.ts \
  agent-network/src/codex-copresence-recovery.test.ts \
  agent-network/src/windows-codex-copresence.test.ts \
  agent-node/src/runtime/codex-app-server/session-manager.test.ts \
  agent-node/src/runtime/codex-app-server-bridge.test.ts \
  agent-node/src/runtime/codex-app-server/pending-thread.test.ts

echo "L2 witnessed-red: socket attribution and exact identity cannot be bypassed"
cp agent-network/bin/cli.ts /tmp/test1220-cli.ts
echo "L2a witnessed-red: wrapped exact receipt requires capture-pane -J"
bun /mutate.ts agent-network/bin/cli.ts \
  '"-p", "-J", "-S", "-200"' \
  '"-p", "-S", "-200"'
expect_red wrapped-receipt bun test agent-network/src/codex-copresence-launch-readiness.test.ts
cp /tmp/test1220-cli.ts agent-network/bin/cli.ts

echo "L2f witnessed-red: fresh launcher cannot create a thread"
bun /mutate.ts agent-network/bin/cli.ts \
  'return { threadId: "", freshDeferred: true };' \
  'await request("thread/start", {}, 15_000); return { threadId: "", freshDeferred: true };'
expect_red fresh-thread-create bun test agent-network/src/codex-copresence-launch-readiness.test.ts
cp /tmp/test1220-cli.ts agent-network/bin/cli.ts

echo "L2g witnessed-red: pre-bind tasks cannot start a turn"
cp agent-node/src/runtime/codex-app-server-bridge.ts /tmp/test1220-bridge.ts
bun /mutate.ts agent-node/src/runtime/codex-app-server-bridge.ts \
  'if (!this.threadId) { throw new CodexBridgeNotReadyError(); }' \
  'if (false) { throw new CodexBridgeNotReadyError(); }'
bun /mutate.ts agent-node/src/runtime/codex-app-server-bridge.ts \
  'if (!this.threadId) throw new CodexBridgeNotReadyError();' \
  'if (false) throw new CodexBridgeNotReadyError();'
expect_red deferred-not-ready bun test agent-node/src/runtime/codex-app-server-bridge.test.ts
cp /tmp/test1220-bridge.ts agent-node/src/runtime/codex-app-server-bridge.ts

echo "L2h witnessed-red: durable candidate remote/marker validation cannot be bypassed"
cp agent-node/src/runtime/codex-app-server/pending-thread.ts /tmp/test1220-pending.ts
bun /mutate.ts agent-node/src/runtime/codex-app-server/pending-thread.ts \
  '|| typeof p.serverUrl !== "string" || p.serverUrl !== serverUrl' \
  '|| typeof p.serverUrl !== "string"'
expect_red pending-remote-binding bun test agent-node/src/runtime/codex-app-server/pending-thread.test.ts
cp /tmp/test1220-pending.ts agent-node/src/runtime/codex-app-server/pending-thread.ts

# #1342: 上面那个守卫被拆成了两个 if(「拿不到 pid」和「拿到了但没连接」原本
# 折叠成同一条报错,指错排查方向)。变异的**意图不变** —— 让 pid 归属探测不再守门,
# 确认 launch-readiness 会红;只是锚点跟着新形状走。
# 🔴 这条锚 2026-08-28 因为产品拆 if 而 count=0 红过一次。变异测试锚的是**代码形状**,
#    任何改动那几行的人都要同步这里 —— 门会说 `mutation anchor count=0, expected=1`,
#    不会静默放过。
bun /mutate.ts agent-network/bin/cli.ts \
  'if (!probePosixOwnedLoopbackConnection(tuiIdentity.pid, port)) {' \
  'if (false) {'
expect_red posix-pid-attribution bun test agent-network/src/codex-copresence-launch-readiness.test.ts
cp /tmp/test1220-cli.ts agent-network/bin/cli.ts

echo "L2b witnessed-red: Linux and macOS native socket probes cannot be removed"
cp agent-network/src/posix-codex-copresence.ts /tmp/test1220-posix.ts
bun /mutate.ts agent-network/src/posix-codex-copresence.ts \
  'if (platform === "linux") {' 'if (false) {'
expect_red linux-native-probe bun test agent-network/src/posix-codex-copresence.test.ts
cp /tmp/test1220-posix.ts agent-network/src/posix-codex-copresence.ts
bun /mutate.ts agent-network/src/posix-codex-copresence.ts \
  'if (platform === "darwin") {' 'if (false) {'
expect_red macos-native-probe bun test agent-network/src/posix-codex-copresence.test.ts
cp /tmp/test1220-posix.ts agent-network/src/posix-codex-copresence.ts

echo "L2c witnessed-red: bridge receipt cannot lose exact remote/thread"
cp agent-network/src/codex-tui-client-health.ts /tmp/test1220-health.ts
echo "L2i witnessed-red: crash-window marker, promotion, and resume argv are mandatory"
bun /mutate.ts agent-network/src/codex-tui-client-health.ts \
  '|| typeof p.marker !== "string" || p.marker !== expectedOldMarker' \
  '|| typeof p.marker !== "string"'
expect_red pending-old-marker bun test agent-network/src/codex-tui-client-health.test.ts
cp /tmp/test1220-health.ts agent-network/src/codex-tui-client-health.ts
bun /mutate.ts agent-network/src/codex-tui-client-health.ts \
  '|| cfg.codexPendingThread !== undefined)' \
  ')'
expect_red pending-promote-atomic bun test agent-network/src/codex-tui-client-health.test.ts
cp /tmp/test1220-health.ts agent-network/src/codex-tui-client-health.ts
bun /mutate.ts agent-network/src/codex-tui-client-health.ts \
  '? (THREAD_ID.test(threadId) ? ["resume", "--remote", remote, threadId, "-m", model] : [])' \
  '? (THREAD_ID.test(threadId) ? ["--remote", remote, "-m", model] : [])'
expect_red pending-resume-argv bun test agent-network/src/codex-tui-client-health.test.ts
cp /tmp/test1220-health.ts agent-network/src/codex-tui-client-health.ts
bun /mutate.ts agent-network/src/codex-tui-client-health.ts \
  '|| await isListening(port))' \
  ')'
expect_red pending-old-server-live bun test agent-network/src/codex-tui-client-health.test.ts
cp /tmp/test1220-health.ts agent-network/src/codex-tui-client-health.ts
bun /mutate.ts agent-network/src/codex-tui-client-health.ts \
  'return `[codex-app-server] client-health role=bridge remote=${remote} thread=${threadId}`;' \
  'return `[codex-app-server] client-health role=bridge`;'
expect_red bridge-identity bun test agent-network/src/codex-tui-client-health.test.ts
cp /tmp/test1220-health.ts agent-network/src/codex-tui-client-health.ts

echo "L2d witnessed-red: Windows PID attribution cannot be skipped"
# 🔴 2026-08-31:锚点随 #1342 的诊断改动挪了位置。原来那一行是
#    `if (probeWindowsOwnedLoopbackConnection(...)) {`;为了给失败诊断记下
#    **探测本身的耗时**,它被拆成 `const hit = probe(...)` + `if (hit)`。
#    变异的**语义没变**:把那次探测换成一个不做 PID 归属校验的廉价判断,
#    于是 windows-codex-copresence.test.ts 里那条按源码文本钉顺序的断言
#    (它 indexOf 的正是 `probeWindowsOwnedLoopbackConnection(tui.pid, tuiCreationDate, port)`)
#    找不到该子串 ⇒ 红。
#    ⚠ 这道变异在锚点找不到时会 `mutation anchor count=0` **大声报错**而不是
#    静默跳过 —— 那正是它这次抓住我的方式。改 cli.ts 里这一段之前先看这里。
bun /mutate.ts agent-network/bin/cli.ts \
  'const hit = probeWindowsOwnedLoopbackConnection(tui.pid, tuiCreationDate, port);' \
  'const hit = !!tui.pid;'
expect_red windows-pid-attribution bun test agent-network/src/windows-codex-copresence.test.ts
cp /tmp/test1220-cli.ts agent-network/bin/cli.ts
cp agent-network/src/windows-codex-copresence.ts /tmp/test1220-windows.ts
bun /mutate.ts agent-network/src/windows-codex-copresence.ts \
  'if($hit-and$after-eq$birth)' \
  'if($hit)'
expect_red windows-birth-recheck bun test agent-network/src/windows-codex-copresence.test.ts
cp /tmp/test1220-windows.ts agent-network/src/windows-codex-copresence.ts

echo "L2e witnessed-red: wrong TUI CODEX_HOME cannot pass source health contract"
bun /mutate.ts agent-network/bin/cli.ts \
  $'const tuiCmd = [\n      `export CODEX_HOME=${shellQuote(opts.codexHome)}`,' \
  $'const tuiCmd = [\n      `export CODEX_HOME=/tmp/test1220-wrong-home`,'
expect_red wrong-home bun test agent-network/src/codex-copresence-launch-readiness.test.ts
cp /tmp/test1220-cli.ts agent-network/bin/cli.ts

echo "RESULT: PASS"
