# 上手指南（5 步跑通）

<!-- 🔴 下面这两条戳被 scripts/check-doc-version-claims.py 读取,渲染出来看不见。
     本页有多处**带版本号的行为断言**(某个版本上第一条命令会怎样),它们在发版那一刻
     同时变假。release gate 会拿正在发的版本和这两条戳比对,不一致就拦下发布并列出
     每一处需要改的行。改了正文也要改戳,反之亦然 —— 两边不一致时门同样会红。
     只标"现状"断言;讲历史的版本引用(如 `≤ 2.3.0-preview.37`)故意不标。 -->
<!-- version-claim: package=agent-network channel=latest version=2.3.0-preview.76 -->
<!-- version-claim: package=agent-network channel=preview version=2.3.0-preview.88 -->

新用户首次跑通的最小路径——**5 步, 5 分钟**。每步一条命令 + 一句验证。

::: tip 最快路径（推荐）— 有 Claude 订阅就 0 配置
最省事的走法：本机装好 Claude Code CLI（`npm i -g @anthropic-ai/claude-code`）并 `claude auth login` 后，第 4 步**选 `claude-code-cli` runtime**——全程不用填 API key、不用选模型，一条命令就上线一个"能干活、手机也能指挥"的私人 AI 员工。这是**最稳、最少踩坑**的路径。

没有 Claude 订阅？走 `claude-agent-sdk` + 一个模型 API key（MiniMax / DeepSeek / 书生 / 小米），见第 4 步。
:::

::: tip 已经装过 anet?
跳过本页, 走 [升级指南](/guide/upgrade)（通常 `anet upgrade` 一键 + `anet project restart` 重启 cwd 节点）。
:::

**前置**（两个都要装）：

- **Node.js ≥ 22.13.0**
- **Bun ≥ 1.2.0** —— 装法 `npm i -g bun`（或 `curl -fsSL https://bun.sh/install | bash`）。第 2 步 `anet hub start` 底层用 `bunx` 起 `commhub-server`，**没装 Bun 时第 2 步一定失败**，但表现分两条线:
  · **含 preflight 的构建**（2026-08-30 在 `2.3.0-preview.47` 上实测；2026-09-02 起 `latest` 与 `preview` 都是 `2.3.0-preview.76`，preflight 自 `.47` 起一直在）:启动前被拦下，报 `❌ anet hub start requires the Bun runtime`（退出码 1）；
  · **更早、不含 preflight 的构建**（实测 `2.2.21`）:裸崩 `Error: spawn bunx ENOENT` + Node 堆栈。
  装完 `bun --version` 应有输出。

这俩装好就行；`commhub-server` / `agent-node` 首次用时自动拉取，不用手动装。

---

## 1. 安装 CLI

```bash
npm install -g @sleep2agi/agent-network
```

验证：

```bash
anet -v
```

---

## 2. 启动 Hub

打开第一个终端, **保持开着**：

```bash
anet hub start
```

启动后默认监听 `http://127.0.0.1:9200`, SQLite 数据库在 `~/.commhub/commhub.db`, 自动创建默认管理员 **admin / anethub**。

::: warning `@preview` 首次启动打印**一次性随机密码**
本文档描述的是 npm `latest` 通道的行为。`@preview` (`npm install -g @sleep2agi/agent-network@preview`) 首次 `anet hub start` 会**打印一次生成的随机密码**（只显示一次，之后无处查回），登录后用 `anet passwd` 改成自己的强密码。**preview 上不要写死 `anethub`**——固定密码只在 `latest` 通道成立。
:::

::: warning 公网部署立刻改密
默认 `admin / anethub` 仅本机用（latest 通道）。任何 `--host 0.0.0.0` 公网部署立刻 `anet passwd` 改强密码。preview 通道无固定密码，见上一条。
:::

::: tip 停止 / 查看状态
`anet hub status` / `anet hub stop`（不用 `lsof + kill`）。
:::

---

## 3. 启动 Dashboard + 登录

开第二个终端, **保持开着**：

```bash
anet hub dashboard
```

浏览器访问 `http://localhost:3000`, 用 `admin` 加**你自己那次 `anet hub start` 打印的密码**登录。

::: warning 密码从 `anet hub start` 的输出里取,不要照抄这里
`anet hub start` 第一次跑的时候会打印一次管理员凭据:

```
✅ Admin account created
   username: admin
   password: <这里打印的那个串>
   Store this password now; it will not be shown again.
```

🔴 **不要照抄下面命令里的 `anethub`。** 现在 `latest` 和 `preview` 两条通道装到的版本
**都会打印一个随机串**,照抄一定登不进去 —— 唯一可靠的做法是看你自己那次启动的输出。

实测 2026-08-27(在干净容器里各起一次 `anet hub start`,不传 `--password`):

| 装到的版本 | 打印出来的密码 |
|---|---|
| `2.3.0-preview.47`(当时的 `latest`) | `anet-3ce2750defe04d9ab3baf0` —— **随机串**,并提示首次登录后要改 |
| `2.3.0-preview.49`(当时的 `preview`) | `anet-7fe4eddb08f648dcbd7fcd` —— **随机串**,同上 |
| `2.3.0-preview.76`(当前 `latest`) | 同为**随机串** —— 未逐版本重测:生成密码的 `server/src/auth.ts` 自 `.49` 发布(2026-08-27T02:25Z)起**零提交**,逻辑逐字未变 |
| `2.3.0-preview.88`(当前 `preview`) | 同为**随机串** —— 未逐版本重测:生成密码的 `server/src/auth.ts` 自 `.49` 发布(2026-08-27T02:25Z)起**零提交**,逻辑逐字未变 |

两次都没有出现字面量 `anethub`。

固定的 `anethub` 只存在于 `2.2.x` 及更早的版本。**这一行按版本写而不按通道写**是有原因的:
`latest` 会移动 —— 2026-08 之前它指着 `2.2.21`(那时确实是固定密码),现在指着一个
preview 构建。**"latest 上是固定密码"这句话不是过期,是会随通道移动而变成错的。**

凭据也落在 `~/.anet/server/admin-utok.json`,里面只有
`username` / `user_id` / `token` / `created_at` —— **密码不在里面**,所以错过了那次输出
就只能重新 bootstrap。

🔴 另外:**`anet login` 失败时目前仍然退出码 0**(`latest` 与 `preview` 都是,修复已在 main 上,见 #716 / #722)。
⇒ **不要用 `anet login && 下一步` 来判断登录成功** —— 它会在失败时继续往下走。用 `anet whoami` 确认。
:::

第三个终端给 CLI 也登录一次（后续 `anet node ...` 命令带凭证）：

```bash
anet login --hub http://127.0.0.1:9200 --username admin --password anethub
```

`anet whoami` 确认身份。

---

## 4. 创建并启动节点

```bash
anet node create my-bot
```

向导按这个顺序问你：runtime → (仅 `claude-agent-sdk`) vendor → model → API Key。

::: tip 新手最省事 — 手动选 `claude-code-cli`
向导**默认高亮 `claude-agent-sdk`**, 一路 Enter 会落到要填 vendor + API Key 的复杂路径。如果已经 `claude auth login`, **手动选 `claude-code-cli`** = 零配置最快路径。

stable 版 `anet node create` 列出正式版的 runtime（`claude-agent-sdk` / `claude-code-cli` / `codex-sdk` / `grok-build-acp`）；完整对照（含预览版 `opencode-cli`，stable 选择器暂不含）见 [Runtime 对比](/guide/runtimes#runtime-对比-canonical-表)。
:::

启动节点：

::: warning 全新安装选了 claude-agent-sdk / codex-sdk？先装 agent-node
这两个 runtime 依赖 `agent-node` 包。首次 `node start` 的 npx 自动拉取需要约 1 分钟，而 **`≤ 2.3.0-preview.37` 的构建**（含旧的 `2.2.21`）的启动检查**不等它拉完**就报 `agent-node is not installed or cannot report a version` 退出（真机复现，[#450](https://github.com/sleep2agi/agent-network/issues/450) 精确立案，#237 为同族）。**根因修复**见 [PR #239](https://github.com/sleep2agi/agent-network/pull/239)（commit `1eff3a4d`, merged 2026-06-28），Vincent 2026-08-09 audit 在 `2.3.0-preview.38` 隔离 Docker 里 verified 抵达 SSE connected；**该 fix 自 `2.3.0-preview.38` 起含在构建里**（查自己装的：`anet -v`；查通道当前指向：`npm view @sleep2agi/agent-network dist-tags` —— 2026-08-30 实测 `latest` 已是 `2.3.0-preview.47`，即**已越过这条下界**） —— [#450](https://github.com/sleep2agi/agent-network/issues/450) 仍 `open`，因 promote 到 latest 待 4 项 acceptance gate 真绿。**变通**（按 verified 强度）：升到 `@sleep2agi/agent-network@preview`；或用 `@latest` 但先跑一句让二进制预先就位：

```bash
npm install -g @sleep2agi/agent-node
```
:::

```bash
anet node start my-bot
```

看到 `SSE connected` 即上线, 终端保持开着。

::: warning vendor 选择中段 Ctrl+C 可能留半成品节点
半成品节点用 `anet node delete <alias>`（不带 `--force` 先看 will-delete 预览, 再加 `--force` 真删）清掉重来。
:::

---

## 5. 用起来 — 从 Dashboard 派任务

回浏览器 `http://localhost:3000`：

1. 进 **Overview**, 点击在线的 `my-bot` 卡片，打开内嵌 ChatPanel（Dashboard 没有单独的 Chat 导航页）
2. 输入框写一句话（"现在几点？" / "做个 hello world"）, 回车
3. 自己消息立刻乐观回显（`You` 标签）
4. Agent 调用 LLM 后回复, markdown 完整渲染（`↳ my-bot` 标签）

刷新页面, 聊天历史保留。

✅ **5 步跑通**。

---

## 已验证 vs 未验证

::: info 已验证 (当前 stable，真机走查)
详细测试报告见 [更新日志](/changelog) + [测试报告](https://github.com/sleep2agi/agent-network/tree/main/docs/tests)。

- `anet hub start` + 默认账号自动创建 / `anet hub dashboard`
- `anet login`（带 `--hub`）/ `anet register` / `anet logout` / `anet whoami`
- **`claude-code-cli` runtime 端到端** —— 生产 fleet 每天在跑（最省事路径，见步骤 4 推荐）；首跑 dev-channels 确认框需 TTY
- `claude-agent-sdk` 的 `node create`（含 vendor 路径：Anthropic / MiniMax / 书生 Intern / 小米 MiMo — verified-with-real-call）+ `node ls / delete`
- Dashboard Chat（markdown / Enter 发 / 乐观回显 / 来源标签 / 错误兜底 / 历史持久）
:::

::: warning 带坑 / 未验证 (请自行评估)
- **`claude-agent-sdk` / `codex-sdk` 的首次 `node start`**：latest 上 `agent-node` 懒加载没拉完就退（`agent-node is not installed...`，[#450](https://github.com/sleep2agi/agent-network/issues/450)）。先 `npm i -g @sleep2agi/agent-node` 再启动即可（见上方步骤 4 提示）。
- `codex-sdk` runtime 端到端（LLM 真回话）—— 缺 OpenAI 测试 key，后半程待补验
- `anet license` / `anet activate` — v0.6 legacy, OSS 用户无需操作（详 [troubleshooting](/troubleshooting#license-expired-授权过期-legacy-行为)）
- `anet network create` 跨用户网络共享 — 代码已合并但未做 E2E 回归
- **一键安装脚本 `setup-anet.sh`** — 已退役停用, 不要运行旧副本, 见 [退役说明](/guide/one-shot-install)
:::

::: tip 没有官方托管
项目方向 = **Apache 2.0 开源 + 自部署 + 课程 / 服务咨询**, 不做 SaaS 托管。生产部署见 [Docker](/deploy/docker) / [生产部署](/deploy/production)。
:::

---

## 下一步

**进阶**:
- [多 Agent 协作](/guide/architecture#agent-node) — peer agents 通过 `get_all_status` / `send_task` / `get_task` 自治协调
- [批量节点管理 `anet project up/restart/down`](/guide/batch) — cwd 下所有节点一键起停, reboot 后零键盘恢复
- [局域网共用 Hub](/deploy/clean-server#_2-起-hub-推荐-tmux-挂着) — `anet hub start --host 0.0.0.0` 让其他机器加入

**实战 demo（实验性，仅供体验）**:
```bash
anet demo                  # 列出可用 demo
anet demo pr-review        # PR 评审室 — 3 reviewer（安全/性能/风格）+ judge
```

**深入**:
- [CLI 命令清单](/guide/cli)
- [Agent Node 配置](/guide/agent-node) — config.json 字段 + ANet 循环任务 `/aloop`
- [多模型配置](/guide/multi-model) — DeepSeek / Kimi / Claude / MiniMax / 自部署
- [架构概览](/guide/architecture)
- [升级指南](/guide/upgrade) — 任意旧版 → latest 一键 `anet upgrade`
