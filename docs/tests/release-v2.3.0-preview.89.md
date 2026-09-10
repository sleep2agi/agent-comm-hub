# `@sleep2agi/agent-network@2.3.0-preview.89`

## 为什么发这一版:Codex TUI 共存节点的生命周期控制器(#1856 A–E1)

`.88` 之后 `agent-network/bin|src` 合入五个 PR(#1857 / #1858 / #1859 / #1860 / #1863),都在包的 `dist` 里:

| 用户看到的 | `.88` | `.89` |
|---|---|---|
| `anet node codex preflight\|verify <alias>` | 无 | 只读体检,receipt 落 `.anet/nodes/<id>/receipts/`,exit 0/2 |
| `anet node codex start\|restart\|resume` | 无 | 确定性状态机:停 Bridge→TUI→App Server,起 App Server→端口→exact TUI→Bridge(`--tui-first`),失败回滚一次,`--probe-from <peer>` nonce 验收 |
| `anet node codex fork <源> --name <新> --workdir <目录>` | 无 | 继承历史(rollout 复制改写 id/cwd),其余全新 |
| `anet node codex account register\|list\|install` / `rollback` | 无 | `codex-login:<profile-id>` host-bound registry;fresh 探针 → 备份 → 0600 安装 → 完整重启 → 指纹核对;失败回滚 |
| `anet node codex canary <alias>...` | 无 | 顺序 verify,第一个 FAIL 即停 |
| `anet node edit --workdir <dir>` | 无 | 给旧共存节点补 `codexProjectDir` |
| 共存桥再入 | PATH 上的 `anet` | 当前这份 anet 自调用(PATH 上另一版本时不再把桥起错) |
| codex 更新提示 | 重启卡住 | 受控启动前记 `version.json` 的 `dismissed_version` |

真机(DEV,#1856 记录):fork 通信牛 → start 52s → account install 39s → rollback 34s 全 PASS;通信牛 preflight 8/8。

## Install

```bash
npm i -g @sleep2agi/agent-network@2.3.0-preview.89
```

## Upgrade

```bash
npm i -g @sleep2agi/agent-network@2.3.0-preview.89
```

## 边界

- 配对 agent-node 仍为 `2.5.0-preview.68`(agent-node 本版未动)。
- 生命周期命令只作用于 `runtime=codex-app-server` 的共存节点;其它运行时行为与 `.88` 逐字相同。
- 已在跑的节点不需要重启;`anet node codex …` 在节点的 workdir(含 `.anet` 的目录)里执行。
