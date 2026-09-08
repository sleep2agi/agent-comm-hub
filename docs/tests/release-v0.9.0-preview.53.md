# `@sleep2agi/commhub-server@0.9.0-preview.53`

## 为什么发这一版:**create_node 的模型名放行 `provider/model`**(#1853)

`.52` 之后 `server/src` 一个功能提交:

| 提交 | PR | 内容 |
|---|---|---|
| `a2831ecc` | #1853 | `create-node-validate.ts` 的 MODEL_RE 允许恰好一个 `/` 分隔的两段(OpenCode 共存的 `opencode/mimo-v2.5-free`);纯点段、多斜杠、首尾斜杠、空格仍拒。daemon 侧镜像同改(agent-node `.68`) |

| 用户看到的 | `.52` | `.53` + agent-node `.68` + 桌面端 ≥ 0.2.62 |
|---|---|---|
| 桌面向导建 OpenCode 共存节点 | 「创建失败:model_invalid」(Vincent 2026-09-08) | 通过校验,daemon 起子节点 |

## Install

```bash
npm i -g @sleep2agi/commhub-server@0.9.0-preview.53
```

## Upgrade

```bash
npm i -g @sleep2agi/commhub-server@0.9.0-preview.53
# 生产 hub 走 deploy/hub/README.md 的六步(改 launcher 的 RUNTIME_DIR 那一行,pm2 restart),不要整文件覆盖
```

## 证据

- `create-node-validate.test.ts` 37/37(+9:正例两条、反例 `a/b/c` `/model` `provider/` `../x` `x/.` 含空格)。

## promote 时的 must_contain

`"version": "0.9.0-preview.53"`(闸 4 对整个 `package/` 目录 `grep -rq`,命中 package.json)。
