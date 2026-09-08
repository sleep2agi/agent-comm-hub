# agent-node 2.5.0-preview.68

`.67` 之后 `agent-node/` 一个提交:

| 提交 | PR | 内容 |
|---|---|---|
| `a2831ecc` | #1853 | daemon 侧 `create-node-daemon.ts` 的 MODEL_RE 与 hub 镜像同改:允许 `provider/model` 一个斜杠;纯点段等仍拒 |

## 这一版带给用户什么

配合 commhub-server `.53` 与桌面端 ≥ 0.2.62,向导建 OpenCode 共存节点(带 `opencode/…` 模型)不再被 daemon 拒。

## Install

```bash
npm i -g @sleep2agi/agent-node@2.5.0-preview.68
```

## Upgrade

```bash
npm i -g @sleep2agi/agent-node@2.5.0-preview.68
anet daemon restart <daemon>        # 或 anet node stop <name> && anet node start <name>
```

## 证据

- `create-node-daemon.test.ts` 73/73(+1:正例 + 6 反例)。

## promote 时的 must_contain

`"version": "2.5.0-preview.68"`(闸 4 对整个 `package/` 目录 `grep -rq`,命中 package.json)。
