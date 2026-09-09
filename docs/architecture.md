# @sleep2agi/agent-network 架构设计

> CLI 名：`anet` | npm 包名：`@sleep2agi/agent-network`
> 当前 stable 通过 npm `latest` tag 发布。四件套（agent-network CLI / commhub-server / agent-node / agent-network-dashboard）的具体版本号以 npm 包页 dist-tags + [changelog](https://anet.sh/changelog) 为准 —— 本文不写死版本号，避免 release 后 stale。
> 本文最早写于 V2 早期（CLI v0.0.x），部分目录结构 / runtime 命名描述仍保留作为历史背景；最新可执行行为以代码 + [anet.sh](https://anet.sh) 文档为准。

---

## 1. 目录结构

```
agent-network/
├── bin/
│   └── cli.ts              # CLI 入口（anet 命令）
├── src/
│   ├── index.ts             # npm 包入口（re-export client + server）
│   ├── client.ts            # CommHub SDK 客户端（EventEmitter + SSE）
│   └── server.ts            # Server 编程启动入口
├── dist/                    # 编译产物（minified，发布到 npm）
│   ├── bin/cli.js
│   ├── src/client.js
│   └── client.d.ts          # TypeScript 类型声明
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

> ⚠️ 上面这棵目录树写于 V2 早期，**已不完整**（例如未列 `dist/bin/cli.cjs`、preview 期新增的 runtime 拆分文件等）。**以仓库当前实际布局为准**（`git ls-tree HEAD -- agent-network/`），本树只作历史背景。

**设计原则**：client.ts 是核心（零外部依赖），server.ts 是薄包装（委托给 `../../server/src/index.ts`），cli.ts 是粘合层。

### Runtime 列表

Profile 的 `runtime` 字段：**stable 4 runtime + preview 额外 2 runtime**。**`claude-agent-sdk` / `codex-sdk` / `grok-build-acp` / `codex-app-server` / `opencode-cli` 由 `@sleep2agi/agent-node` 驱动**（`RUNTIME_MAP` 见 `agent-node/src/cli.ts`）；**`claude-code-cli` 不走 agent-node** —— `anet node start` 直接 spawn 本机 `claude` 二进制。**权威表（stable + preview）以 [anet.sh/guide/runtimes](https://anet.sh/guide/runtimes) 为准**，下面只作背景速览：

| Runtime | 通道 | 说明 |
|------|------|------|
| `claude-code-cli` | stable | Claude Code CLI（用本机 Claude Pro/Team/Max 订阅，零配置最稳） |
| `claude-agent-sdk` | stable | Anthropic Agent SDK + 任意 Anthropic 兼容 endpoint（provider 表见 [anet.sh / multi-model](https://anet.sh/guide/multi-model)） |
| `codex-sdk` | stable | OpenAI Codex SDK（`codex login`） |
| `grok-build-acp` | stable | xAI Grok Build ACP server（`grok login`） |
| `codex-app-server` | preview | Codex app-server 桥接（RFC-030 in-flight） |
| `opencode-cli` | preview | OpenCode CLI 共存（RFC-029 in-flight） |

早期文档里的 `claude-code` / `codex` / `agent-sdk` 已重命名（`anet doctor --fix` 自动迁移）。

> R268 校准：原本这里另列了一段 4 行「支持的模型列表」(MiniMax M2.7 / 书生 Intern-S1-Pro / Claude / Codex)，跟上方 runtime 表重复且写死了 `M2.7` 这种快速 rotate 的版本号（违反 R175/R245/R253/R257 chain「doc 不 pin model 版本」规则）。删；完整 provider × runtime 列表见上表 + [anet.sh / multi-model](https://anet.sh/guide/multi-model)。

### 隔离策略

agent-node 调 claude-agent-sdk 的 `query()` 时传 `settingSources: []`，隔离 SDK 防止读取用户全局配置（[`agent-node/src/cli.ts:558-598`](https://github.com/sleep2agi/agent-network/blob/main/agent-node/src/cli.ts)）：

```typescript
const options = {
  model: MODEL || undefined,
  settingSources: [],  // 完全隔离，不读 ~/.claude/ 等全局配置
  // permissionMode / mcpServers / env ...
};
for await (const message of query({ prompt, options })) { /* ... */ }
```

这确保每个 agent-node 实例独立运行，不受宿主机的 Claude Code 配置影响。注意是给 `query()` 传 options，不是 `new Agent({...})` 类（claude-agent-sdk 的入口是 `query()` 函数）。

---

## 2. 配置文件 — R222 校准（v0.8 实际 schema）

### 路径和优先级（项目→全局 字段级合并）

```
环境变量（COMMHUB_URL / COMMHUB_TOKEN / COMMHUB_ALIAS）
  ↓ 未设置时
命令行参数（--hub / --token / --alias / --runtime / --model 等）
  ↓ 未指定时
项目配置 {cwd}/.anet/nodes/<alias>/config.json   ← R222 校准: per-node 子目录, 不是 .anet/config.json
  ↓ 字段缺失 fallback
全局配置 ~/.anet/config.json
  ↓ 未找到时
默认值（hub=http://127.0.0.1:9200, runtime=claude-agent-sdk）
```

verify [`cli.ts`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/bin/cli.ts) —— 搜 `function loadProfile(`:
```ts
const p = join(nodesDir(), id, "config.json");  // .anet/nodes/<id>/config.json
```
跟 [feedback_config_priority] memory 一致："项目 config 字段级覆盖全局，缺失字段 fallback 到全局"。

### 全局配置 `~/.anet/config.json`

跨项目共享，`anet init` / `anet login` 首次运行时创建（不是旧 doc 写的 `anet setup` —— V2 命名已废）。

```json
{
  "hub": "http://YOUR_COMMHUB_IP:9200",
  "token": "utok_xxxxxx",
  "network_id": "net_xxxxx"
}
```

| 字段 | 必需 | 说明 |
|------|------|------|
| hub | ✅ | CommHub Server URL |
| token | | User token (`utok_` prefix per v0.8 双 Token 体系) |
| network_id | | 当前激活 network (由 `anet network use <name>` 写入) |

### 项目 Node 配置 `{cwd}/.anet/nodes/<alias>/config.json`

每个 node 独立目录，`anet node create <alias>` 运行时创建（不是 V2 时代单 `.anet/config.json`）。

```json
{
  "anet_version": "0.1.0",
  "node_id": "n_a1b2c3d4",
  "node_name": "开发马",
  "alias": "开发马",
  "runtime": "claude-agent-sdk",
  "model": "<model-id>",
  "network_id": "net_a1b2c3d4",
  "channels": ["server:commhub"],
  "env": {},
  "flags": { "dangerouslySkipPermissions": true }
}
```

> 上例是 `anet node create 开发马 --runtime claude-agent-sdk --model <id>`（已登录）实际生成的最小集。条件字段：`teammateMode`（仅 `claude-code-cli`）、`session`（仅 `claude-code-cli` 或 `--session`）、`maxTurns`（仅 `--max-turns`）、`tools`（仅 `--tools`）；`logLevel` 是 **top-level** 字段（不在 `flags` 里），且 `createCommand` 不写它（用户可选加）。

verify [`cli.ts`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/bin/cli.ts) —— 搜 `function saveProfile(`:
```ts
const toSave: Record<string, any> = {
  anet_version, node_id, node_name, runtime,
  ...(hub ? { hub } : {}), ...(token ? { token } : {}),
  ...(model ? { model } : {}), ...(tools ? { tools } : {}),
  channels: ..., env: ..., flags: ...,
  ...(session ? { session } : {}),
};
```

| 字段 | 必需 | 说明 |
|------|------|------|
| `anet_version` | ✅ | schema 版本 (`0.1.0`) |
| `node_id` | ✅ | 不可变 `n_` + 8 hex (R219 chain) |
| `node_name` | ✅ | Agent 别名 = hub 端 alias (可 `anet node rename`) |
| `runtime` | ✅ | `claude-agent-sdk` (默认) / `codex-sdk` / `claude-code-cli` |
| `model` | | LLM model id |
| `session` | | 续会话 ID (claude-code-cli: Claude Code session UUID; codex-sdk: Codex Thread id, 详见 [feedback_anet_session_field]) |
| `channels` | | array, 例 `["server:commhub", "telegram"]` |
| `tools` | | array, claude-agent-sdk allowlist |
| `env` | | object, agent-node 启动时 inject 子进程 env |
| `flags` | | object, runtime-specific flags (`dangerouslySkipPermissions` / `teammateMode` / `maxTurns` / `claudeTimeoutMs` ...). 注意 `logLevel` 是 **top-level 字段**，不在 `flags` 里 |
| `hub` | | 覆盖全局 hub（跨网络场景） |
| `token` | | 覆盖全局 token（per-node ntok_ 场景） |

R222 校准：原 doc 写「`{alias, type}` 2 字段」是 V2 早期 schema，当前 schema 12+ 字段 + 路径是 `.anet/nodes/<alias>/config.json` 不是 `.anet/config.json`。

---

## 3. CLI 命令详细设计

> **命名约定升级（v0.6+）**：
> - `anet server` → **`anet hub start`** （这里下面整段保留 V2 命名做历史参考）
> - `anet setup` / `anet run` 大部分语义已合并到 `anet init` + `anet login` + `anet node create / start`
> - `--token` 参数 → v0.8 起 `--username` / `--password` + 自动 bootstrap admin
> - `COMMHUB_AUTH_TOKEN` env → v0.8 软废弃（[RFC-001](rfcs/RFC-001-deprecate-commhub-auth-token.md) Phase 2）
>
> 最新命令清单见 [anet.sh/guide/cli](https://anet.sh/guide/cli)。

### `anet server`（V2 命名 → 现 `anet hub start`）

启动 CommHub 通信中枢。

```bash
anet server [--port 9200] [--token xxx] [--db path] [--cors origins]
```

**流程**：
1. 读取 `~/.anet/config.json` 中的 token（如果 CLI 未指定）
2. 设置环境变量
3. 动态 import `../../server/src/index.ts`
4. Bun.serve 启动 HTTP server

**端点**：

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| /mcp | POST | 否 | MCP Streamable HTTP |
| /events/:alias | GET | 是 | SSE 实时推送 |
| /health | GET | 否 | 健康检查 |
| /api/status | GET | 是 | 所有 session 状态 |
| /api/task | POST | 是 | REST 发任务 |
| /api/broadcast | POST | 是 | 广播 |
| /api/completions | GET | 是 | 最近完成记录 |
| /api/messages | GET | 是 | 查询 inbox 消息（支持按 alias 过滤） |
| /ws/tmux/:name | WS | 是 | tmux 终端流 |

### `anet setup`

R511 校准：旧 doc 写「`anet setup --hub --alias --type`，配置新 Agent 加入网络」是 V2 早期签名 —— 当前 `anet setup`（[`cli.ts`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/bin/cli.ts) —— 搜 `async function setupCommand(`）是**交互式 runtime 依赖安装器**，不带参数，也不写网络配置（入网走 `anet node create`）。

```bash
anet setup
```

**流程**：
1. `checkbox` 勾选要用的 runtime：`claude-code-cli` / `codex-sdk` / `claude-agent-sdk`（已就绪的标 ✅）
2. `confirm` 是否顺带装 CommHub Server（本地开发 / 测试用）
3. 按勾选项算出缺哪些包（`@anthropic-ai/claude-code` / `@sleep2agi/agent-node` / `@openai/codex` / `@sleep2agi/commhub-server`），列出 `npm install -g` 命令
4. `confirm` 后执行安装
5. 验证安装结果，提示 `codex login` / `claude auth login`（如选了对应 runtime）
6. 完成 → 提示下一步 `anet node create <node-name>`

### `anet run`

R511 校准：旧 doc 写的 `[--handler script.ts]` flag + 「handler 协议」是 V2 设计草稿，**当前不存在**。当前 `anet run`（[`cli.ts`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/bin/cli.ts) —— 搜 `async function runCommand(`）是用 Client SDK 起的**极简 standalone SSE agent**：连 hub、监听 task、自动 echo「收到」回复 —— **不跑 LLM**，区别于 `anet node start`（跑真实 AI runtime）。

```bash
anet run --alias <name> [--hub <url>]
```

**流程**：
1. 读 `--alias`（必需）/ `--hub`（可选，默认 `http://127.0.0.1:9200`）/ `COMMHUB_URL`、`COMMHUB_ALIAS` env
2. `new CommHub({ url, alias })` 建 SSE 长连接
3. `on("task")` → 收到任务直接 echo `[alias] 收到: <内容>` 回发起方
4. `on("connected")` / `on("disconnected")` 打日志（断线自动重连）
5. SIGINT → `disconnect()` → 退出

---

## 4. SDK API 设计

### Client（核心）

```typescript
import { CommHub } from '@sleep2agi/agent-network';

const hub = new CommHub(options: CommHubOptions);
```

**CommHubOptions**：

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| url | string | ✅ | — | CommHub Server URL |
| alias | string | ✅ | — | Session 别名 |
| token | string | | — | Auth token |
| agent | string | | "sdk" | Agent 类型标识 |
| heartbeatInterval | number | | 180000 | 心跳间隔（ms） |
| reconnectDelay | number | | 3000 | SSE 重连基础延迟（ms） |
| autoConnect | boolean | | true | 创建时自动连接 |

**方法**：

| 方法 | 返回 | 说明 |
|------|------|------|
| `connect()` | Promise | 连接 + 注册 + SSE + 心跳 |
| `disconnect()` | Promise | 断开 + 上报 offline |
| `send(alias, content, priority?)` | Promise | 发任务 |
| `message(alias, content)` | Promise | 发消息（无生命周期） |
| `reply(taskId, text, status?)` | Promise | 回复任务状态 |
| `status(state, extra?)` | Promise | 更新 session 状态 |
| `getAllStatus()` | Promise | 获取所有 session 状态 |
| `broadcast(content, filter?)` | Promise | 广播 |

**事件**：

| 事件 | 参数 | 说明 |
|------|------|------|
| task | InboxMessage | 收到任务（已自动 ACK） |
| message | InboxMessage | 同 task（别名） |
| connected | — | SSE 连接成功 |
| disconnected | — | SSE 断开 |
| error | Error | 错误 |

**InboxMessage**：

```typescript
interface InboxMessage {
  id: string;
  content: string;
  from_session: string;
  priority: string;
  created_at: string;
}
```

### Server（编程入口 — R257 校准：仅 monorepo 开发可用，npm 包不暴露）

::: warning npm 包不暴露 `./server` export
verify [`agent-network/package.json`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/package.json):
```json
"exports": { ".": { "import": "./dist/src/client.js", "types": "./dist/client.d.ts" } },
"files": ["dist"]
```

`exports` 只有 `.` 一个 entry，`files: ["dist"]` 不含 `src/server.ts`，所以 npm 包消费者**不能** `import { startServer } from '@sleep2agi/agent-network/server'`（会 `MODULE_NOT_FOUND`）。`src/server.ts` 只在 monorepo 开发场景下 import `../../server/src/index.ts` 作 dev 入口，不对外发布。

生产环境用户跑 hub 走 `anet hub start`（通过 bunx 拉独立 `@sleep2agi/commhub-server` PIN 版，跟 R221/R223/R250 chain 一致）。
:::

```typescript
// monorepo 开发：直接从 src 用，跳过 npm 包
import { startServer } from './agent-network/src/server.ts';

await startServer({
  port: 9200,
  token: 'secret',
  db: '~/.commhub/commhub.db',
  corsOrigins: ['http://localhost:3000'],
});
```

---

## 5. Channel 插件自动配置 — R221 校准

`anet node start` 检测到 `runtime: "claude-code-cli"` 时，自动确保 Channel 插件可用（[`cli.ts`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/bin/cli.ts) —— 搜 `function ensureMcpJson(`）：

1. 从 npm 包 (`dist/src/node-server.js` 优先 / `src/node-server.ts` 兜底) 复制到 `{项目}/.anet/node-server.js`（**注意：是 `.js` 不是 `.ts`** —— [R216 chain](https://github.com/sleep2agi/agent-network/issues/10#issuecomment-4438192170)）
2. 安装依赖（`@modelcontextprotocol/sdk ^1.12.0` 通过 `bun install`）
3. 写入 `.mcp.json`：`commhub → .anet/node-server.js`（[`cli.ts`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/bin/cli.ts) —— 搜 `.mcp.json: commhub → .anet/node-server.js`）

```
{项目}/
├── .mcp.json                # {"mcpServers":{"commhub":{"type":"stdio","command":"bun","args":[".anet/node-server.js"]}}}
└── .anet/
    ├── node-server.js       # Channel 插件（MCP server + SSE 长连接）
    └── package.json         # @modelcontextprotocol/sdk ^1.12.0
```

已配置过且内容一致直接跳过（compare-by-content：`if (src !== dst) writeFileSync(...)`，[`cli.ts`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/bin/cli.ts) —— 搜 `if (src !== dst)`）。`anet init project` 也做同样的事（另外还写 CLAUDE.md）。

R221 校准：原 doc 写「`runtime: "claude-code"`」+「`.anet/node-server.ts`」+「`.mcp.json args:[".anet/node-server.ts"]`」三处都是 V2 早期命名/文件名，当前 runtime name 是 `claude-code-cli`（RuntimeName type —— 已移出 cli.ts,现在在 [`agent-network/src/normalize-runtime.ts`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/src/normalize-runtime.ts),搜 `export type RuntimeName =`），落盘文件名是 `.js`。

---

## 6. 与现有包的关系 — R221 校准（v0.8 实际 4 包）

verify monorepo `find . -name "package.json" -not -path "*/node_modules/*"`：

```
@sleep2agi/agent-network          CLI + Client SDK 入口 + Server 编程入口 (anet/)
  ├── bin/cli.ts                   # anet 命令 (39 commands per package.json)
  ├── src/client.ts                # CommHub client (`new CommHub(...)`)
  └── src/server.ts                # 动态 import ../../server/src/index.ts

@sleep2agi/agent-node              Agent 运行时 (claude-agent-sdk / codex-sdk / claude-code-cli)
  └── src/cli.ts                   # agent-node 命令 (npx-spawn 给 anet node start)

@sleep2agi/commhub-server          CommHub backend (bun-only, Streamable HTTP + SSE + SQLite WAL)
  ├── src/index.ts                 # Bun.serve 主入口
  └── src/tools.ts                 # 17 MCP tools (4 agent + 13 hub)

@sleep2agi/agent-network-dashboard Next.js UI (独立部署, R220 chain)
```

⚠ **`@sleep2agi/commhub-sdk` 不是独立 npm 包** —— Client SDK (`CommHub` class) 只在 `agent-network/src/client.ts`，通过 `import { CommHub } from '@sleep2agi/agent-network'` 使用。原 doc「三个包共存」声明 `@sleep2agi/commhub-sdk` 错。

代码复用关系（实际）：
- `agent-network/src/client.ts` → 唯一 Client SDK source
- `agent-network/src/server.ts` → 动态 import `server/src/index.ts`（开发期 monorepo path；npm 包不直接 ship server，靠 `anet hub start` 通过 bunx 拉 `@sleep2agi/commhub-server` PIN 版）
- `agent-network/bin/cli.ts` → 引用 client.ts；CommHub Server 不在 dist，靠 `anet hub start` 拉
- `agent-node/src/cli.ts` → agent 进程入口，依赖 `@anthropic-ai/claude-agent-sdk` (regular dep) + `@openai/codex-sdk` (optional peer dep) — R212 chain

---

## 7. npm 发布结构 — R223 校准

### 发布内容（v0.8 实际）

verify [`agent-network/package.json`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/package.json) `"files": ["dist"]`：

```
dist/
├── bin/cli.js              # CLI 入口（minified + javascript-obfuscator）
├── src/client.js           # Client SDK（minified + obfuscator）
├── src/node-server.js      # Channel 插件（minified + obfuscator）
└── client.d.ts             # TypeScript 类型声明
package.json
README.md
```

::: warning R223 校准
旧 doc 列「`src/server.ts` 保留 .ts 源码」+ `files: ["dist", "src/server.ts"]` —— **实际 `files` 只包含 `["dist"]`**，`src/server.ts` 不发到 npm。Server 编程入口走的是开发期 monorepo path，npm 包不直接 ship server；用户跑 `anet hub start` 时通过 bunx 拉 `@sleep2agi/commhub-server` PIN 版（R213 chain）。
:::

### package.json 关键字段（实际）

```json
{
  "name": "@sleep2agi/agent-network",
  "type": "module",
  "main": "dist/src/client.js",
  "types": "dist/client.d.ts",
  "exports": {
    ".": { "import": "./dist/src/client.js", "types": "./dist/client.d.ts" }
  },
  "bin": { "anet": "dist/bin/cli.js" },
  "files": ["dist"],
  "engines": { "bun": ">=1.2.0", "node": ">=22.13.0" },
  "dependencies": { "@inquirer/prompts": "^8.4.3" }
}
```

R223 校准：旧 doc 写「`exports[./server]: import src/server.ts`」**不存在**（只有 `.` 一个 export）。`engines.bun` ≥ 1.2.0 是新增字段（旧 doc 漏）。

### 构建（实际）

verify [`package.json#scripts.build`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/package.json) — 三步链：

```bash
# 1. bun build (3 个 entry，分别 minify + 标 external)
bun build src/client.ts --outdir dist/src --target node --minify
bun build bin/cli.ts    --outdir dist/bin --target node --minify \
  --external @sleep2agi/commhub-server --external bun:sqlite --external '../../server/*'
bun build src/node-server.ts --outdir dist/src --target node --minify \
  --external @modelcontextprotocol/sdk

# 2. tsc: 生成 client 类型声明
tsc --emitDeclarationOnly --declaration --outDir dist

# 3. javascript-obfuscator: 3 个产物分别做字符串数组 + base64 混淆
npx javascript-obfuscator dist/bin/cli.js          --output dist/bin/cli.js          --compact true --string-array true --string-array-encoding base64
npx javascript-obfuscator dist/src/client.js       --output dist/src/client.js       --compact true --string-array true
npx javascript-obfuscator dist/src/node-server.js  --output dist/src/node-server.js  --compact true --string-array true
```

R223 校准：旧 doc 只写 `bun build src/client.ts bin/cli.ts --outdir dist --target node --minify` 一行 —— 实际 3 个 entry 分别 build + 不同 externals + 加 obfuscator + 加 node-server.js 第三个 entry。`commhub-server` / `bun:sqlite` / `../../server/*` external 是为了让 server 不进 dist。

---

## 8. 安全考虑

> **v0.8 安全升级（2026-05 对齐）**：本节原写于 V2 era，鉴权部分已升级到 [RFC-001 Phase 2](rfcs/RFC-001-deprecate-commhub-auth-token.md) 落地的双 token 体系：utok_（用户级，登录获取）+ ntok_（节点级，agent 绑定单个 network）。`COMMHUB_AUTH_TOKEN` 全局 master token 软废弃（仅 `/api/*` 只读 + deprecation warning），v1.0 完全移除。完整 v0.8 安全模型见 [anet.sh/concepts/security](https://anet.sh/concepts/security) 和根级 [`SECURITY.md`](../SECURITY.md)。

### 代码安全
- 零硬编码 IP/token/key（全部通过 config 或 env）
- npm 发布前自动 grep 检查敏感信息
- dist/ 只包含 minified JS，不含 .ts 源码（server.ts 除外，因 Bun-only）

### 通信安全（v0.8 现状）
- **双 token 鉴权**：utok_（用户）+ ntok_（节点 × 网络），自动 bootstrap admin utok_
- **密码强度**：≥ 8 字符 + 弱密码字典拦截（首次 bootstrap admin 例外允许 ≥ 4）
- **服务端网络绑定**：ntok_ 在 hub 锁住 network_id，客户端无法跨 network
- CORS 白名单（COMMHUB_CORS_ORIGINS）
- 建议防火墙 IP 白名单（9200 端口）
- SSE 连接同样用 utok_/ntok_ 鉴权（401 自动 reload token）
- ⚠️ 旧 `COMMHUB_AUTH_TOKEN` 仅 `/api/*` 读类兼容（v1.0 移除）

### 配置安全 — R223 校准
- `~/.anet/server/admin-utok.json` 自动 chmod 600（[`cli.ts`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/bin/cli.ts) —— 搜 `function saveAdminUtok(` `writeFileSync(..., {mode: 0o600})` + `chmodSync(..., 0o600)`，v0.8 bootstrap 写入 admin token）
- `~/.anet/server/config.json` 自动 chmod 600（[`cli.ts`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/bin/cli.ts) —— 搜 `function saveServerConfig(`）
- ⚠️ `~/.anet/config.json` **不是 600** —— [`cli.ts`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/bin/cli.ts) —— 搜 `function saveGlobal(` 用默认 `writeFileSync` 无 mode 选项，实际权限通常 `644` (`rw-r--r--`)。在多用户机器上其他本地用户可读你的 utok_。**单用户 host 影响有限，多用户共享 host 建议手动 `chmod 600 ~/.anet/config.json`**（v0.9 RFC 待修）
- 项目 `.anet/nodes/<alias>/config.json` 不应包含 token（放全局配置；R222 chain 说明项目 config 用 hub/token 字段覆盖全局是 advanced use case）
- `.anet/` 应加入 `.gitignore` 防止提交

### 运行时安全
- SQLite WAL 模式 + busy_timeout 防并发冲突
- inbox 消息 ACK 机制防重复处理
- 心跳机制检测 zombie session
- graceful shutdown 上报 offline

---

## 9. 通信协议流程图 — R256 校准（v0.8 V3 send_reply）

### Agent 注册和任务处理

```
Agent                    CommHub Server              Hub/指挥室
  │                          │                          │
  │  report_status(idle)     │                          │
  ├─────────────────────────►│                          │
  │                          │                          │
  │  SSE /events/:alias      │                          │
  ├─────────────────────────►│ (长连接保持)               │
  │                          │                          │
  │                          │  send_task(alias,task)   │
  │                          │◄─────────────────────────┤
  │                          │                          │
  │  SSE: new_task event     │                          │
  │◄─────────────────────────┤                          │
  │                          │                          │
  │  get_inbox(alias)        │                          │
  ├─────────────────────────►│                          │
  │  [{id,content,from}]     │                          │
  │◄─────────────────────────┤                          │
  │                          │                          │
  │  ack_inbox(id)           │                          │
  ├─────────────────────────►│                          │
  │                          │                          │
  │  (处理任务...)            │                          │
  │                          │                          │
  │  send_reply(hub,result,  │                          │
  │             task_id)     │  SSE: new_reply          │
  ├─────────────────────────►│─────────────────────────►│
  │                          │  (不触发对方 think)        │
  │                          │                          │
  │  report_status(idle)     │  (每 3 分钟心跳)          │
  ├─────────────────────────►│                          │
```

R256 校准：旧 doc 用 `send_task(hub, result)` 回复任务结果 —— 这会触发指挥室 think 循环（A 给 B 派任务，B 给 A 回复，A 又 think 又给 B 派任务，A→B→A→B 无限）。V3 已经引入 `send_reply` MCP tool（[tools.ts:2064](https://github.com/sleep2agi/agent-network/blob/main/server/src/tools.ts#L2064)），关联 `in_reply_to=task_id`，SSE 推 `new_reply` 不是 `new_task`，**接收方不触发 think**（R218 chain message-lifecycle.md 校准）。

### 三种接入方式对比

```
方式 A: Claude Code + Channel（最优, 现役）
  Agent ←SSE Push→ CommHub    实时，零延迟
  通过 commhub-channel MCP server 暴露 5 个 commhub_* MCP tool 给 Claude Code
  🔴 实际随包发布并运行的是 agent-network/src/node-server.ts（本机 ~/.anet/node-server.js）；
     channel/commhub-channel.ts 是同名的**分叉副本**，不在任何包的 files: 里、无源码 import，
     只被文档引用。改行为请改前者。分叉已登记为 docs/claude-code-cleanup-review.md 的 C3。

方式 B: agent-node SDK runtime（现役）
  Agent ←SSE Push→ CommHub    实时，agent-node 内部用 claude-agent-sdk / codex-sdk 跑
  入口: anet node create / start

方式 C: anet run 独立 SSE Agent（minimal）
  Agent ←SSE Push→ CommHub    极简 echo「收到」回复，不跑 LLM（无 handler 机制）
  仍在 cli.ts:2044 (runCommand) 注册, 但 V3 推荐用方式 B（anet node create）
```

---

## 10. Web Dashboard

> **R220 校准（2026-05-13）**：本节的「内置轻量 UI」+「`http://YOUR_IP:9200/dashboard`」是 V2 早期设计草稿，**v0.8 实际未实现** —— commhub-server `server/src/index.ts` 没有 `/dashboard` 路由（`server/src/index.ts` 里 `/dashboard` 0 hit；[`server/src/server.ts`](https://github.com/sleep2agi/agent-network/blob/main/server/src/server.ts) 里有且只有 1 处，是第 287 行的注释 `any future HEAD/Range/dashboard-proxy`，不是路由 —— 写清楚是因为下一个人 grep 到它会以为这句话错了）。当前**唯一 Dashboard 是独立的 Next.js 包 `@sleep2agi/agent-network-dashboard`**，通过 `anet hub dashboard` 子命令拉起（[`agent-network/bin/cli.ts:8058`](https://github.com/sleep2agi/agent-network/blob/main/agent-network/bin/cli.ts#L8468) `sub === "dashboard"` 分支，默认端口 3000；版本不再 hardcode pin —— [`dashboardReleaseTag()` cli.ts:2499](https://github.com/sleep2agi/agent-network/blob/main/agent-network/bin/cli.ts#L2577) 默认拉 `@preview` tag，可用 `ANET_DASHBOARD_VERSION` env 覆盖，跟 anet release channel 对齐 — 见 #61）。🔴 上面两个行号锚 2026-08-28 修过一次、2026-08-30 又修两次：`dashboardReleaseTag()` 2452→2489→2449→2452→2486→2499（最后一次是 #1137 Windows 修复的 rebase 加了 posix-modes 相关文件，`bin/cli.ts` 上移了几行），`sub === "dashboard"` 7326→7757→7780→7845→7882→7898→7914→7927→7981→**7985**（🔴 **7845 那次之后它在 main 上又漂了 36 行而没人发现** —— #1545 改 cli.ts 时手动核出来的：main 上它实际在 7881，文档还写着 7845。这正是下面那句「跳过的不是通过」的现场证据：这个锚**当时从来没有被判定过**，所以它可以静静地错 36 行。🔴 **这一句现在过期了**：`scripts/check-doc-symbol-pins.py` 已经能判它 —— 2026-08-31 在 #1622 上它红了，报的正是「锚文本逐字点名 `sub === "dashboard"`，钉在 #L7882，而该片段在第 7900 行」。所以下面那句「每次改 cli.ts 都得手动核」也**不再必要**：门会告诉你，该脚本自己在输出里写着**跳过的不是通过**——所以每次改动 cli.ts 都得手动核这一处，直到 checker 支持字面量文本形态的 pin）。最新部署方式见 [anet.sh/guide/dashboard](https://anet.sh/guide/dashboard)。下面的「两种 Dashboard」/「内置 UI 设计原则」/「实现方案」/「HTML 结构」全是 V2 设计草稿，仅保留历史背景，**当前不适用**。

### 当前 Dashboard

| 维度 | 实际值 |
|------|------|
| 技术栈 | Next.js + Vercel-friendly build |
| npm 包 | `@sleep2agi/agent-network-dashboard` |
| 启动 | `anet hub dashboard` (npx-spawn pin 版) |
| 默认地址 | `http://127.0.0.1:3000`（`--ip 0.0.0.0` 暴露 LAN） |
| 认证 | 浏览器 cookie 透传 `utok_` |
| Hub 连接 | `NEXT_PUBLIC_COMMHUB_URL` env 注入 hub URL |

### ~~两种 Dashboard~~（V2 设计草稿，未实现）

| ~~Dashboard~~ | ~~技术栈~~ | ~~部署~~ | ~~地址~~ |
|---|---|---|---|
| ~~内置轻量 UI~~ | ~~纯 HTML + vanilla JS~~ | ~~内嵌 `anet server`~~ | ~~`http://YOUR_IP:9200/dashboard`~~ |
| 独立 Dashboard | Next.js + Vercel | 独立部署 | 见上「当前 Dashboard」表 |

### ~~内置轻量 UI 设计原则~~（V2 设计草稿，未实现）

- ~~纯 HTML + CSS + vanilla JS，零框架~~
- ~~内嵌到 `anet server`，不需要额外部署~~
- ~~SSE 实时更新，不用 WebSocket~~
- ~~一个 HTML 文件搞定~~

### 访问方式（当前 stable）

```bash
anet hub start            # 起 commhub-server (9200)
anet hub dashboard        # 起独立 Dashboard (Next.js, 3000)

# 浏览器访问 http://127.0.0.1:3000，用 admin/anethub 登录
```

### 页面功能

**节点列表（主视图）**

```
┌─────────────────────────────────────────────┐
│  Agent Network Dashboard         ● 17 online │
├─────────────────────────────────────────────┤
│                                             │
│  🟢 指挥室      working   硅谷ECS   3s ago  │
│  🟢 通信龙      idle      硅谷ECS   15s ago │
│  🟢 开发马      working   硅谷ECS   2m ago  │
│  🔵 大猫        idle      96GB      1m ago  │
│  🔵 P站MiniMax马 idle     Paper     5m ago  │
│  ⚪ VL牛        offline   A100      2h ago  │
│                                             │
│  [发任务]  [广播]  [刷新]                     │
└─────────────────────────────────────────────┘
```

节点颜色：
- 🟢 绿色：Channel SSE 连接（实时）
- 🔵 蓝色：Poller 模式（近实时）
- 🟡 黄色：最近有活动但无 SSE
- ⚪ 灰色：offline

**消息流（实时）**

```
┌─────────────────────────────────────────────┐
│  Message Stream                    [暂停]    │
├─────────────────────────────────────────────┤
│  15:00:42  指挥室 → 通信龙: 计时测试        │
│  15:00:59  通信龙 → 指挥室: 收到！延迟17s    │
│  15:01:05  指挥室 → 大猫: SSE Poller测试     │
│  15:01:06  [SSE] 大猫 收到推送               │
└─────────────────────────────────────────────┘
```

通过 SSE `/events/dashboard` 订阅所有事件。

**任务管理（简易）**

- 发任务：选目标 alias + 输入内容 + 优先级 → POST /api/task
- 广播：输入内容 → POST /api/broadcast

### ~~实现方案~~（V2 设计草稿，未实现）

::: warning 本节不要照抄实现
此段「Server 端新增 `/dashboard` 路由」是 V2 早期设计草稿，**v0.8 不打算这么做** —— commhub-server 维持 backend-only 不内嵌 UI，独立 Next.js Dashboard 已经覆盖所有用例。如有人考虑加内置 UI，先开 RFC 讨论必要性。
:::

~~Server 端新增一个路由：~~

~~```typescript
// GET /dashboard → 返回内嵌 HTML
if (url.pathname === "/dashboard") {
  return new Response(DASHBOARD_HTML, { ... });
}
```~~

### ~~HTML 结构~~（V2 设计草稿，未实现）

省略 V2 设计草稿 HTML 模板（深色主题 + vanilla JS + SSE poll）—— 实际 Dashboard 用 Next.js + React，看 [`@sleep2agi/agent-network-dashboard` 源码](https://github.com/sleep2agi/agent-network-dashboard)。

### 原设计声明"不做的事"（v0.8 阶段实际已全部超越）

> **更新（2026-05-12 v0.8.2 对齐）**：以下条目是 V2 早期写设计文档时的取舍声明，但 Dashboard 在 v0.6 ~ v0.8.2 已经完整建成，下面这些"不做"全部反过来了。最新 Dashboard 行为见 [anet.sh/guide/dashboard](https://anet.sh/guide/dashboard)。

- ~~不做用户认证（复用 COMMHUB_AUTH_TOKEN，URL 带 token 参数）~~ → **已做**：浏览器 cookie 透传 + utok_ 鉴权，COMMHUB_AUTH_TOKEN 软废弃
- ~~不做 session 管理（只读展示 + 发任务）~~ → **已做**：完整任务面板 + ChatPanel + 节点详情
- ~~不做历史查询（只显示最近 100 条）~~ → **已做**：tasks/messages/audit-log 三类查询
- ~~不做移动端适配（桌面浏览器即可）~~ → **已做**：N站马 polish loop 中加了 mobile audit（banner 让位 hamburger / UserBar 图标化）

### 优先级

Dashboard 已成为 v0.8 主线功能（package `@sleep2agi/agent-network-dashboard@0.4.2` stable / `0.4.5-preview.1` preview channel）。
