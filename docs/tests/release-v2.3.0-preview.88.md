# `@sleep2agi/agent-network@2.3.0-preview.88`

## 为什么发这一版:配对 agent-node `.68`(同日成对规则)

`.87` 之后 `agent-network/bin|src` 没有功能提交;本版只把配对版本推到 agent-node `.68`(#1853 daemon 侧模型名镜像),让 `anet node create` 装到带修复的 agent-node,并让 published-pins 门与 main 一致。

| 用户看到的 | `.87` | `.88` |
|---|---|---|
| `anet node create` 配对装的 agent-node | `.67` | `.68` |

## Install

```bash
npm i -g @sleep2agi/agent-network@2.3.0-preview.88
```

## Upgrade

```bash
npm i -g @sleep2agi/agent-network@2.3.0-preview.88
```

## 边界

- anet 自身行为与 `.87` 逐字相同;不需要重启节点。
