# Codex TUI 人机共存（`codex-app-server`，preview）

`codex-app-server` runtime 让**人和 Agent 共用同一个 Codex 会话**：人在原生 Codex TUI 里输入、看输出、处理审批，Agent Network 的任务经 CommHub 注入**同一个 Codex thread**。双方看到同一段历史和同一组实时事件。（[RFC-030](https://github.com/sleep2agi/agent-network/blob/main/docs/rfcs/RFC-030-codex-tui-bridge.md)，Phase 0A。）

> 与无头的 `codex-sdk` 不同：`codex-sdk` 是后台工作器、没有可共存的活 TUI；`codex-app-server` 才提供 Codex TUI 人机共存。

::: warning Preview
这是 **preview-only** 功能。npm `latest` 当前完全不含 `codex-app-server`、`--copresence` 或 `codexAppServerUrl`；装了 `latest` 的用户无法使用本页命令。当前实现还是单机可信形态，不是生产 Policy Gateway；只连接可信 Hub、只接收可信任务。
:::

## 前置

- 安装并登录 Codex CLI（协议验证基线为 `codex-cli 0.144.x`）：

```bash
npm install -g @openai/codex
codex login
```

- 安装或切换到 preview 频道：

```bash
npm install -g @sleep2agi/agent-network@preview @sleep2agi/agent-node@preview
# 已装 anet 时也可让整组组件切到 preview：
anet upgrade --channel preview

# 自检：输出必须显示 preview 版本，help 必须出现 Co-presence / --copresence
anet -v
anet --help
```

- Linux、macOS 与 WSL 的一键路径还需要 `bash` 和 **tmux 3.2+**。原生 Windows 使用受管后台进程与当前 PowerShell/Windows Terminal，不需要 tmux。
- 节点必须持有 network-scoped `ntok_`。旧节点缺 token 时先运行 `anet doctor --fix`，或重新创建节点。

## 推荐：创建时选定共存，之后一键启动/恢复

```bash
# 0. 在外部干净 shell 中进入节点要操作的项目
cd /path/to/project

# 清掉调用方继承的全部 COMMHUB_* 身份，不能只逐个删已知变量
for v in $(env | sed -n 's/^\(COMMHUB_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done

# 1. 交互创建：输入节点名，然后在 runtime 菜单选择“codex-cli — Codex 共存 TUI”
anet node create

# 2. 一键启动 app-server、bridge 和可 attach 的 Codex TUI
anet node start codex-human

# 3. Linux/macOS/WSL：进入人机共用的 TUI
tmux attach -t =codex-human
```

原生 Windows 的第 2 条命令会直接在当前 PowerShell/Windows Terminal 打开 Codex TUI；无需第 3 条命令。要停止整套进程，请保留 TUI 窗口并在另一个终端运行 `anet node stop codex-human`。

Codex thread 的工作目录继承自 **app-server 进程启动时的 cwd**，不是 bridge 的 cwd；因此要在运行 `--copresence` **之前**先 `cd` 到目标项目。Linux 上可用 `readlink /proc/<app-server-pid>/cwd` 复核，不能只检查 bridge。

`create --copresence` 会把选择写入节点配置；此后普通 `node start`（包括停止或中断后的恢复）都会重建同一套共存拓扑，无需重复 flag。旧节点也可第一次运行 `anet node start codex-human --copresence`，CLI 会记住选择，后续同样只需 `anet node start codex-human`。

交互菜单里的 `codex-cli` 就是共存模式：选中后直接写入 `codexCopresence: true`，不再要求第二次选择。`codex-sdk` 是后台无头 Codex 节点。脚本可使用等价命令 `anet node create codex-human --runtime codex-cli`；旧的 `--runtime codex-app-server --copresence` 继续兼容。

::: warning 发布渠道
交互选项从 **preview.42** 起可用；原生 Windows 一键编排从 **preview.43** 起可用。Windows 路径已在 `windows-latest` 通过真实 ConPTY 测试：交互创建、首次启动、停止、重启和再次停止，并验证重启恢复同一个 thread。
:::

Linux/macOS/WSL 启动会创建三个带同一身份标记的 tmux session；Windows 创建两个受管后台进程，并把 TUI 留在当前控制台：

| Session | 作用 |
|---|---|
| `codex-human-appsrv` | 只监听 loopback 的 `codex app-server`，并注入 CommHub MCP |
| `codex-human-桥` | `agent-node` bridge，接收网络派工并投进同一 thread |
| `codex-human` | 人类可 attach 的原生 Codex TUI |

Windows 会把 app-server 与 bridge 的 PID、进程创建时间和日志位置写入节点私有状态。`stop` 只有在 PID 与创建时间同时匹配时才会调用 `taskkill /T`，避免 PID 复用时误杀无关进程；凭据目录用 Windows ACL 限制为当前用户、SYSTEM 与 Administrators。

### tmux 目标必须精确匹配

`codex-human` 同时也是另外两个 session 名的前缀。tmux 的普通 `-t codex-human`
可能在 TUI session 已退出时静默匹配到 `codex-human-appsrv` 或 bridge。操作前先列出
session 与 pane 复核：

```bash
tmux list-sessions -F '#{session_name}'
tmux list-panes -t =codex-human -F '#{pane_id} #{pane_current_command}'
tmux attach -t =codex-human
```

`capture-pane`、`send-keys` 等操作也应使用 `-t =codex-human` 强制精确匹配，或直接使用
`%42` 这类 pane ID。三个 session 中有一个消失时尤其要避免前缀匹配。

在 TUI 中按 `Ctrl-B D` 只会 detach，不会停节点。停止时请先 detach，再从**共存进程树外的终端**运行：

```bash
anet node stop codex-human
```

停止流程会用持久身份标记收拢这三个 session 及其子进程；从共存 session 内调用 `stop` 会 fail closed，避免把当前 shell 一起杀掉。

::: info macOS 的停止保障差异
macOS 的启动、连接与 TUI 共存路径和 Linux 相同，但 P3 进程身份清理依赖 Linux `/proc`，因此 macOS 停止时会降级为 legacy sweep。功能仍可用，但清理保证弱于 Linux；请从共存进程树外运行 `anet node stop`，并确认三个 tmux session 都已退出。
:::

::: danger 断线恢复要先停止旧进程树
节点配置会记住共存模式，因此普通 `anet node start codex-human` 会重新进入共存编排，不会降级成无头节点。但在旧 bridge 仍存活时不要直接再启动；应在外部 shell 中先停止旧树、清空 `COMMHUB_*`，再运行：

```bash
anet node stop codex-human
cd /path/to/project
for v in $(env | sed -n 's/^\(COMMHUB_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done
anet node start codex-human
```

这不是理论风险：生产节点 `TM副责人` 因此静默重复运行约 2 天，`A站副责人` 则持续约 9 天（[#535](https://github.com/sleep2agi/agent-network/issues/535)）。
:::

### 首次派活前必须看一眼 TUI 是否卡在审批框

::: danger 节点会「看起来完全健康」却什么都干不了
`--copresence` 起完之后，TUI 一旦接上，MCP 工具调用就变成**要人确认**。如果没人在 TUI 前面点，节点会永远停在：

```
Allow the commhub MCP server to run tool "get_task"?
› 1. Allow   2. Allow for this session   3. Always allow   4. Cancel
```

**此时 hub 上的所有信号都是健康的**：`status=idle`、SSE 已连接、`last_seen_at` 持续更新。派活方看不出任何异常，只会以为它闲着。

**唯一能发现的方法**（hub 的任何字段都查不出来）：

```bash
tmux capture-pane -t =<alias> -p | grep "Allow the commhub MCP"
```

**处置**：选 `3. Always allow`（commhub 那几个工具是节点自身运转必需的）；或在 app-server 启动参数里带 `-c approval_policy=never`，从源头避免。

实测（2026-07-31）：新建 TUI 的节点复现；同宿主既有共存节点未受影响（它们的 app-server 启动时带了 `approval_policy=never`）。**所以这是「新建 TUI 时」的坑，不是存量问题。**
:::

## 生命周期命令：`anet node codex …`

重启 / 恢复共存节点以前靠人肉 runbook(见「Codex TUI 节点安全重启」);现在把每一步「核什么」做成确定性的 CLI,正常流程不调用任何 LLM,只出机器可读 receipt。第一批两个只读命令:

```bash
anet node codex preflight <alias>          # 只读核对,exit 0 = PASS / exit 2 = FAIL
anet node codex verify    <alias> --json   # preflight + 子进程环境核对 + 跨节点身份验收;JSON 供自动化消费
```

### 重启 / 启动 / 恢复:确定性状态机,零 LLM

```bash
anet node codex restart <alias> --probe-from <另一个本地节点>   # 停 Bridge→TUI→App Server,再起,再核对
anet node codex start   <alias> --probe-from <peer>              # 三段都不在时才允许;否则要求用 restart
anet node codex resume  <alias> --thread <36 位 thread id> --probe-from <peer>
```

`restart` 的每一步顺序固定、不做推理:**preflight(before)** 任一项 fail 就不碰进程 → 读 **goal 状态**(读不到或 schema 不认识 = 不明,直接 STOP)→ 按依赖反向 **停 Bridge → TUI → App Server**(先断任务入口,再让 TUI 把 rollout 刷完,最后放掉端口)→ 等 rollout 字节数稳定(大会话慢刷盘)→ 等端口空闲(占用者若核实是本节点残留的 app-server 才定向 TERM,外来进程一律 FAIL 不动)→ 交给启动器 `anet node start --copresence --tui-first`(**App Server → 端口就绪 → exact-session TUI 完全恢复 → Bridge**;bridge 晚于 TUI,任务不会落到人看不见的会话上)→ **verify(after)**:preflight 全项 + 子进程环境 + rollout 前后比对(同一文件、字节只增不减)+ goal 文件未变 + hub 回到在线 + 跨节点 nonce 验收。启动失败自动回滚一次(按原配置再起);再失败就停在已停状态,receipt 记到哪一步。

`--probe-from <peer>`(peer 住在别的 `.anet` 根时加 `--probe-root <dir>`)用另一个本地节点通过 hub 给目标发一条带随机 nonce 的任务,等目标回复经 hub 落到 peer 的收件箱,且 hub 标注的发送者正是目标 alias,`identity_attested` 才算 pass;不给 peer 时该项 unknown,整体 **FAIL**(有意:不许「大概是它」)。`resume --thread` 只接受完整 36 位 id 且该 id 在本节点 CODEX_HOME 下恰有一个 rollout,才写进 config;不接受前缀,不猜「最近一个」。

`--json` 输出整份 receipt(含 `stoppedAt` / `rolledBack`),供 Dashboard「体检」按钮消费。

### fork:继承历史,其余全新

```bash
anet node codex fork <source> --name <target> --workdir <dir> [--inherit-full-access]
cd <dir> && anet node codex start <target> --probe-from <source>      # 首次启动 = verify + nonce 验收
```

fork 只读源节点(它的 auth.json / config.toml 和**那一个** rollout),在 `<dir>/.anet/nodes/<target>/` 造一个全新节点:新 `node_id` 与 CommHub 身份、新 `CODEX_HOME`(0700,auth.json 0600)、新 thread id(UUIDv7)、新工作目录、新 tmux 名;端口在首次启动时分配。rollout 是**流式复制并逐处改写 thread id**(定长 36 字符,字节数不变),不是共享同一文件;第一行必须是源 thread 的 `session_meta`,否则一个字节都不写。源节点的 `.anet-copresence.env`(含它的 CommHub token)、history、sqlite、缓存一律不带;完整访问也不继承,除非显式 `--inherit-full-access` 且源节点本来就开着。

receipt 的 `fork_isolation` 要求身份 / HOME / thread / rollout 文件 / tmux 名五处都不同、rollout 等长复制且目标 HOME 里没有 token 文件;`identity_attested` 在 fork 阶段为 unknown(不阻塞),由首次 `start --probe-from` 闭环。`start` / `restart` / `resume` 必须在 `config.codexProjectDir` 记的目录里执行,否则拒绝(三段 tmux 的工作目录与 `.anet/nodes` 都是相对当前目录的)。

### 账号迁移:`account install` 与 `rollback`

```bash
CODEX_HOME=/some/home codex login                                   # 人先在任意 HOME 登录一次(ChatGPT)
anet node codex account register team-a --from-codex-home /some/home  # 登记进本机受控 registry(host-bound)
anet node codex account list
anet node codex account install <alias> --source codex-login:team-a --probe-from <peer>
anet node codex rollback <alias> --receipt <install-receipt-id> --probe-from <peer>
```

登录源只接受 **不透明引用** `codex-login:<profile-id>`:CLI 不收路径、stdin、环境变量。profile 由本机 `~/.anet/codex-login/registry.json`(0600)解析,凭据正文存 `profiles/<id>/auth.json`(0600),条目绑定 `host_id`(machine-id + 主机名的摘要),拷到别的机器不认;PR-D 只认 ChatGPT 登录(`auth_mode=chatgpt`)。receipt、registry、日志里只出现 `profile_id` 与不可逆的 `account_fingerprint`(sha256(account_id) 前 16 位)以及 `backup_ref`,不出现 token、auth 内容或真实路径。

`install` 是确定性状态机:目标 preflight(fail 即停)→ 在隔离的临时 HOME 里用该 profile 发一次 **fresh 模型请求**(`codex exec`,固定回句;401 / 凭据失效 → auth,配额 / 429 → quota,模型不兼容 → model,归不了类 → unknown,四种都 STOP 且目标一字未动,探针结果回写 registry)→ 备份目标 auth.json 到 `receipt:<id>`(0600)→ 0600 原子安装 → **完整重启**(PR-B 状态机,含 verify + nonce 验收)→ 目标指纹必须等于源指纹。安装后任一步失败 → 自动恢复备份并再重启一次,receipt 记录两段。

`rollback` 只接受原 install receipt 里的 `backup_ref`,不接受调用方另传文件:恢复 → 完整重启 → 指纹回到 receipt 记的 `targetPreviousFingerprint`。

`preflight` 核的项(每项 pass / fail / unknown,**任一非 pass 整体 FAIL**,不许部分成功):alias 与 hub 名册里的 `node_id` 精确匹配;节点自己的 `CODEX_HOME` 0700、`auth.json` 0600、CommHub token 指纹一致;工作目录在 config、TUI 进程 cwd、TUI `-C`、Bridge 进程四处一致;`codexThreadId` 是完整 36 位且 `CODEX_HOME` 里恰有一个对应 rollout(记下绝对路径、inode、字节数、mtime;不接受前缀或「最近的文件」);app-server 端口的占用者确实是本节点的进程(否则视为 foreign PID,不会去动它);tmux 三段(app-server / TUI / bridge)都在跑且子进程都带本节点的身份 marker。

receipt 写在 `.anet/nodes/<id>/receipts/<id>.json`(0600):凭据只记不可逆短指纹,token 不会出现在 receipt、日志或参数里。`verify` 在跨节点 nonce 探针落地前 `identity_attested` 恒为 unknown,因此恒 FAIL —— 这是有意的。start / restart / resume / fork / account / rollback 分批落地,合同见仓库 issue #1856。

## 权限：默认只读，完整访问必须双重确认

共存默认使用 `sandbox_mode=read-only` 与按需审批。需要 Codex 写文件、跑完整网络/命令工具时，必须显式选择：

```bash
anet node start codex-human --copresence --dangerously-allow-full-access
```

- 交互式终端会要求手工输入 `yes`。
- 非 TTY 的脚本、CI 或 Docker 还必须再传 `--yes-danger-full-access`：

```bash
anet node start codex-human --copresence \
  --dangerously-allow-full-access \
  --yes-danger-full-access
```

第二个 flag 只用于无法交互的调用方，不能省略；它防止管道输入绕过确认。完整访问会关闭文件系统/网络沙箱，只应在可信工作区和可信任务上启用。

## 普通 `codex-app-server` 节点不是共存

不带 `--copresence` 时：

```bash
anet node create codex-worker --runtime codex-app-server
anet node start codex-worker
```

节点会自己 spawn 私有 app-server 和新 thread，适合作为 codex 驱动的后台 Agent；由于没有人类可 attach 的 TUI，这条路径**不是人机共存**。

## 高级接管：手工共享 WS

日常使用原生 Windows 请直接运行前面的一键命令。本节只用于接管已有 app-server 或调试。**每个节点使用独立 app-server/端口，不要让多个节点共用**：CommHub bearer token 是 app-server 的进程级环境，复用会造成 thread 身份混淆，也会制造单点故障。

```powershell
# 起前先找空闲端口；示例端口仅占位
# Windows PowerShell:
Get-NetTCPConnection -LocalPort <free-port> -ErrorAction SilentlyContinue

# Terminal 1：先 cd 到目标项目，再起独立 app-server
cd C:\path\to\project
$env:CODEX_HOME = "C:\path\to\project\.anet\nodes\codex-human\codex-home"
codex app-server --listen ws://127.0.0.1:<free-port>

# Terminal 2：先启动 bridge，让 runtime 创建/捕获 thread 并写回 codexThreadId
Get-ChildItem Env:COMMHUB_* | ForEach-Object { Remove-Item "Env:$($_.Name)" }
$env:CODEX_HOME = "C:\path\to\project\.anet\nodes\codex-human\codex-home"
anet node create codex-human --runtime codex-app-server --codex-app-server-url ws://127.0.0.1:<free-port>
anet node start codex-human

# 从节点 config.json 读取 codexThreadId/model 后，让 Terminal 3 接入同一条
# thread；必须使用该节点自己的 CODEX_HOME
$env:CODEX_HOME = "C:\path\to\project\.anet\nodes\codex-human\codex-home"
codex resume --remote ws://127.0.0.1:<free-port> <codexThreadId> -m <model>
```

`codex resume --remote` 必须同时对齐节点的独立 `CODEX_HOME`、`codexAppServerUrl`、`codexThreadId` 与 `model`。省略 thread id 会进入历史会话 picker，容易接错线程；省略 `CODEX_HOME` 更危险：Codex 可能使用默认 `~/.codex` 并静默连接外网 443，留下一个空白 pane，看起来像已成功接入，实际却是独立云端会话。bridge 首次写回 `codexThreadId` 时会打印可直接复制的 POSIX 与 PowerShell resume 命令。创建节点时也可加 `--codex-thread-id <id>` 接管指定 thread；不传时 runtime 自动捕获并写回配置。

手工启动后不要只看空 pane 判断成功：检查 TUI 进程的 socket，确认它连接的是配置中的 loopback `codexAppServerUrl`（而不是外网 `:443`），再在 TUI 与 bridge 两侧核对同一个 thread id。Linux/macOS 同样必须先 `export CODEX_HOME='<节点目录>/codex-home'`，再执行带 `--remote`、thread id 与 `-m` 的 `codex resume`。

手工拓扑的三个终端还必须显式使用**同一个节点专属 `CODEX_HOME`**。漏掉任意一处时，Codex 可能静默使用用户默认 `~/.codex`，TUI 看起来已经启动，实际却连到另一套云端会话而不是这个 loopback app-server。不要让持久化节点与主 Codex 会话共享 `CODEX_HOME`。

Linux/macOS 的高级用户也可用这一拓扑连接已存在的 app-server，但日常使用优先 `--copresence`，它会统一处理 loopback、独立 `CODEX_HOME`、MCP 注入、tmux 生命周期与停止身份。若本机 24700–24720 等常用范围已被其他共存节点占用，继续选新的空闲 loopback 端口，启动前先查占用。

上一段说的「检查 socket」，具体是这条，判据是**连接对数**：

```bash
ss -tnp | grep '127.0.0.1:<app-server 端口>'
```

正常应当看到**两对** ESTAB —— bridge 一对、TUI 一对。**只有一对就是 TUI 没接上**（此时 pane 同样是空的，看不出区别）。实测（2026-08-26，Linux）：缺 `CODEX_HOME` 起的 TUI，其 codex 子进程唯一的 TCP 连接是到公网 `:443`。

app-server **支持多客户端**，所以 bridge 连着的时候 TUI 照样能 join 同一条 thread，**不需要先停 bridge**（本机实测：接上新 TUI 后 bridge 6 秒往返照常）。

手工启动的 app-server 不会自动获得 `--copresence` 注入的 CommHub MCP；若希望人类 TUI 直接调用 `commhub_*`，必须在 **app-server 创建 thread 之前**按 RFC-030 配好 MCP URL 与 bearer-token 环境变量。既有 thread 会快照工具集，事后补 MCP 不会生效。不要把 token 放进命令行或聊天。

::: warning Codex CLI 升级提示
TUI 启动时可能出现 `Update available`，且默认高亮立即升级。共享宿主上请选“跳过/稍后”，把 Codex CLI 升级安排到维护窗口；全局升级二进制可能同时影响这台机器上的所有共存节点。
:::

## 长任务与 600 秒提示

一条 thread 同一时刻只能有一个 active turn；后续网络任务会 FIFO 排队。当前网络任务等待最终回复的窗口**默认**是 600 秒（runtime 选项可覆盖，并非不可变的硬上限）：

- 看到“`600s 内无最终回复`”**不等于节点已死**，也不会自动取消正在 Codex 中执行的 turn。
- 不要立刻重复派同一任务；先看 `tmux capture-pane -t =codex-human -p | tail -30` 和工作区是否仍在变化。
- 重代码/长工具链任务尽量拆成可在 10 分钟内完成并回报的小步；若确认静默卡死，按 [codex-app-server 卡死诊断与重启 SOP](https://github.com/sleep2agi/agent-network/blob/main/docs/sop/codex-app-server-jam-restart.md) 先保全工作再重启。

## 安全与已知边界

- app-server 只监听 `127.0.0.1`；token/密钥不进 argv、git 或聊天。
- 一条 thread 同一时刻只有一个 active turn；“同时通信”表示多生产者可以投递，不表示多个 turn 并行执行。
- 默认模式下桥不代答审批，需要审批的 turn 交给人类 TUI；完整访问模式则是用户显式选择的高风险例外。
- Phase 0A 仍是 TUI 与 bridge 直接双客户端连接。生产形态所需的单 upstream Policy Gateway、强制仲裁和最小控制面尚未完成。

## 参考

- [RFC-030 Codex TUI Bridge](https://github.com/sleep2agi/agent-network/blob/main/docs/rfcs/RFC-030-codex-tui-bridge.md)
- [节点 Runtime](/guide/runtimes)
- [CLI：`anet node start`](/guide/cli#anet-node-start)
- [Grok 人机共存 TUI](/guide/grok-copresence)
