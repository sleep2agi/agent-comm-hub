# 节点存活判据

判断一个节点「是不是还在干活」。这份文档的第一版给了三条判据,**三条都是错的**
——它们全部是「桥还活着」就会满足的信号,而桥可以活着 9.5 天、同时一个任务都
处理不了。改法与证据见本文末尾的「第一版为什么全错」。

## 不能用的信号

| 信号 | 为什么不能用 |
|---|---|
| 进程还在 / `pgrep` 有命中 | 桥进程可以活着 9.5 天,同时一个任务都处理不了 |
| tmux session 还在 | session 存在,pane 里的前台命令可能早就落回 `bash` 了 |
| 超时次数 | 长任务本身可能十几分钟;600s 是桥的同步等待上限,**桥放弃 ≠ 节点死** |
| `sessions.updated_at` 在动 | 桥每 3 分钟 `reportStatus("idle")`;派任务也会从服务端侧更新时间戳。**只证明桥↔Hub 连通** |
| `task_events` 里 `actor == 该节点` | `processTask`(`agent-node/src/cli.ts`)一进函数就 `reportStatus("working")`,**早于任何运行时调用**。运行时已死的节点照样产生新鲜且匹配的事件 |
| 桥日志出现 `processTask returned` | **超时也会打这一行**,见下方实例 |

## 唯一可用的正向判据:`tasks.consumed_at`

`#520` 给 exact 任务定义了两级运行时证据(见 `server/src/tools.ts` 里 `markTaskRuntimeEvidence` 上方的 `#520` 注释):

| 字段 | 含义 |
|---|---|
| `runtime_submitted_at` | agent-node 把正文**交给**了厂商运行时 |
| `consumed_at` | **更强**:一个可归因的 turn-start / 首个活动事件**回流**了 |

源码注释里的两句是这条判据成立的全部理由:

> **Merely fetching/acking an inbox row sets neither.**
> **Node identity comes exclusively from the ntok; callers cannot self-report an alias or node_id.**

第一句正是上表所有信号缺的:取任务、ack、回状态都点不亮它。
第二句意味着它**伪造不了** —— 身份只来自 ntok。

写入点 `markTaskRuntimeEvidence()`(`server/src/tools.ts`);读出侧 `server/src/server.ts`
有 `consumedAt` 投影。**这里刻意只钉符号不钉行号** —— 行号每次重构都会漂,见 [#831](https://github.com/sleep2agi/agent-network/issues/831)。

> 🔴 **`consumed_at` 只在正方向可信,而且它指向的是「任务」不是「节点」。**
> **有值且新** → **这个任务**确实被某个当时的属主开工过,可跨 vantage,不需要 SSH。
> **为空** → **不能推出任何结论**,原因见下面第二节。
> **要把它算到某个具体节点头上,先读下面第一节。**

### 归属:`consumed_at` 不跟着任务改派走

`reassign_task` 改派任务时,只动归属与投递字段,**不清运行时证据**
(`server/src/tools.ts`,那条 `UPDATE tasks SET to_name = ?1, to_node_id = ?2,
status = 'delivered', started_at = NULL, delivered_at = datetime('now')`):

```
to_name / to_node_id   → 改成新属主
started_at             → 置 NULL
delivered_at           → 刷新
runtime_submitted_at   → 不动    ← 仍是旧属主盖的
consumed_at            → 不动    ← 仍是旧属主盖的
```

这不是疏漏,是被测试钉住的契约 —— `server/src/task-consumption.test.ts` 的
「reassign preserves task-lifetime evidence and binds the new inbox row to the
same task」逐字断言改派后 `consumedAt(taskId)` 与改派前**相等**。

**后果:一个任务可以同时满足「`consumed_at` 新鲜」和「当前属主一次都没开工」。**
按上面那条判据去看,新属主会被判成正在干活,于是该做的恢复被压掉。
盖章本身是有权限的(只有当前属主能盖 —— 旧属主改派后再调
`mark_tasks_consumed` 会拿到 `task_not_owned`),但**已经盖下的章会留在原地**。

> 🔴 **所以准确的读法是:`consumed_at` 证明「这个逻辑任务被消费过至少一次」,
> 不证明「`to_name` 现在指的那个节点开过工」。**
> 拿它判某个节点是否存活之前,先确认这个任务**没有被改派过**。

一条**尚未验证**的线索:改派会把 `started_at` 置 NULL,而正常开工路径会把它写成
`datetime('now')`(同文件那条 `UPDATE tasks SET status = 'running', started_at = datetime('now')`)。
所以「`consumed_at` 有值 + `started_at` 为空」**看起来**能识别出「章是前任盖的」。
**但我没有测过它**,而且 requeue 路径也会把 `started_at` 置 NULL ——
**在有人真正测出它之前,不要把这条当判据用。**

这一段是审查指出来的,不是我自己查出来的;第一版把一个任务级的时间戳当成了
节点级的判据 —— 与本文末尾「第一版为什么全错」里那个根因**是同一个**:
没有回到源码确认这个字段是谁写的、跟着谁走。

## 为什么「`consumed_at` 为空」现在不能当故障证据

`agent-node/src/cli.ts` 里 `evidence?.submitted()` 上方的注释(codex 直连 stdio 通道):

```
// Direct stdio does not yet send/echo clientUserMessageId, so the
// response turn id is admission evidence only (the #587 race proved it
// is not authoritative ownership). Report submitted, never consumed,
// until this lane grows an exact identity echo.
evidence?.submitted();
```

**这条通道按设计永不报 consumed。** 所以它上面一个完全健康的节点,长期表现为
`runtime_submitted_at` 有值 + `consumed_at` 为空 —— 与「桥交出去了、下游运行时死了」
**无法区分**。

而通道是不是这一条,**hub 侧看不到**:它由节点本地环境变量
`ANET_CODEX_STDIO_DIRECT`(`agent-node/src/cli.ts`)决定,服务端对此零感知
(`git grep -nE 'codex-stdio|codexStdio' -- 'server/src/**'` 为空),上报的 `RUNTIME`
只到 `claude`/`codex`/`grok`/`opencode` 家族粒度。

**跟踪:[#832](https://github.com/sleep2agi/agent-network/issues/832)** —— 在节点自报
「本通道是否发 consumed 级证据」之前,负向判据无法从 hub 侧给出。

> 🔴 **在此之前:不要用「`consumed_at` 为空」去判定运行时已死。**
> 这个方向的误判会把一个健康节点判成故障,而下一步动作通常是重启。
> **宁可判不出,不要判错这一边。**

## 一条容易漏的:桥活着 ≠ 运行时活着

```
桥进程         pid 2408382,连续运行 818134s ≈ 9.5 天    ← 活着
```

桥日志把机制写得很清楚:

```
[07:09:21] [codex-app-server] task 893fdbf4 queued (a turn is in flight)
[07:19:21] processTask returned: "…超时(600s 内无最终回复)"
```

任务是**被排队、根本没开始处理**。

> ⚠️ 措辞要收住:`queued` + 600s 超时只证明**排队了、且超时了**,
> **不单独证明**「那一轮永远飞不完」—— 超时也可能是下游很慢,或那一轮本来就长。
> 这个例子里「下游没有人」是由**结构性缺席**(有桥、无 appsrv)支持的,不是由超时推出的。
> **两条证据合起来才指向这个故障,单独任何一条都不够。**

**注意第二行:`processTask returned` 在这里出现了,而这正是运行时已死的情形。**
所以它不能当存活证据 —— 上表已列。

在 `#832` 落地之前,判这类故障只能靠**结构性对照**(不是判据,是旁证):本机
21 个 `<名字>-桥`,19 个有对应的 `<名字>-appsrv` 且跑着 node。缺的两个里,
`opencode-指挥狗` 是 opencode 运行时、本就不需要 codex app-server(正常),
另一个是**可疑对象**。

> ⚠️ 「有桥、无 appsrv」**不等于**「就是这个故障」。准确的说法是:
> **对于 codex、且契约上应当有 appsrv 的节点,长期有桥无 appsrv,高度可疑为此故障类。**
> 定性仍要结合上面的运行时证据 —— 单凭结构性缺席不足以下结论。

**这条旁证只在同机、同运行时的节点之间成立**,跨机器或跨运行时不能这样比。

## 只读排查三步

```bash
node=<别名>

# 1. 进程还在不在(只说明"在",不说明"在干活")
ps -eo pid,etimes,args --no-headers | grep -F "$node" | grep -v grep

# 2. 桥与 app-server 的结构性对照
#    行格式是 <session_name>|<pane_current_command>,所以要匹配 `桥\|` 而不是 `桥$`
tmux list-panes -a -F '#{session_name}|#{pane_current_command}' | grep -E '桥\||appsrv'

# 3. 桥最近在做什么
#    -t 要用 = 精确匹配,并且**要带窗口索引**:
#    `-t '=名字-桥'` 会报 can't find pane,`-t '=名字-桥:0'` 才可用。
#    这两条都由 tests/test812-tmux-target-semantics 在容器里跑出来,
#    报告在 docs/tests/report-test812.txt。
tmux capture-pane -p -t "=${node}-桥:0" | tail -20
```

三步都是只读的。**看完再决定动不动。**

> 🔴 **第 3 步会把 pane 里的内容原样打出来 —— 那里面有任务正文和回执正文。**
> 实测一个真实节点是 **71 行、首行 102 字符**。任务正文里可能有调用方粘进来的凭据、
> 内部地址、他人对话。**别把它整段贴进 issue / 聊天 / 汇报**;要引用就只引你确实
> 需要的那一两行,并先看一眼有没有该遮的东西。
> (写这一条时我自己就没打印那 71 行 —— 只报了退出码和行数。)

> 🔴 **`=` 挡的到底是什么(实测,别按直觉猜)**
>
> 它**不是**在防「节点名互为前缀」。`A站狗-桥` 并不是 `A站狗2-桥` 的前缀 ——
> 这套 `<别名>-桥` 命名本身就把那个危险削掉了,两种写法都会红。
> 名字歧义要靠上面第 2 步的 session 名对照解决。
>
> 它防的是**残留 session**:存在 `<节点>-桥-old` 而 `<节点>-桥` 已经没了。
> 这时不带 `=` 的前缀匹配会解析到那个残留 session,**退出码 0**,
> 把一个陈旧 pane 的内容当成活节点的现状交给你:
>
> ```
> 只存在 A站狗-桥-old 时
>   -t  'A站狗-桥:0'   rc=0   ← 静默抓到 A站狗-桥-old
>   -t '=A站狗-桥:0'   rc=1   can't find session: A站狗-桥
> ```
>
> `=` 顺带还会关掉 fnmatch:`-t '甲-*:0'` 能命中 `甲-桥`,`-t '=甲-*:0'` 不会。
>
> 以上每一条都是 `tests/test812-tmux-target-semantics` 的断言,去掉 `=` 那道
> witnessed-red 会让「静默抓错」重新出现。

> 🔴 **别把 `capture-pane` 换成 `display-message`。**
> 同一个缺 `:0` 的畸形 target,`capture-pane` 是 rc=1 报错,而
> `display-message` 是 **rc=0 + 空输出** —— 一个响一个哑。哑的那个会让
> 「查不到」看起来像「查到了、内容是空」。

> ⚠️ 另外两条使用边界:
> - 第 1 步的 `grep -F "$node"` 是**子串匹配**,节点名互为前缀时会互相命中
>   (`A站狗` 会匹配到 `A站狗2`)。名字有歧义时用第 2 步的 session 名对照确认;
> - 第 2 步只看得到**当前存在的 pane**。命名不符合 `<名字>-桥` / `<名字>-appsrv`
>   约定的节点根本不会出现在结果里 —— **它的「缺席」不是证据**。

> ⚠️ **不要照抄第一版里那句「重启桥会丢 threadId」——那是错的。**
> `codexThreadId` 持久化在 `config.json`(`agent-network/bin/cli.ts` 里 `rawCfg.codexThreadId = threadId`
> 一带,注释写明重启路径从 config 读回;`agent-node/src/cli.ts` 亦落盘),
> **重启桥会读回并 resume,不丢。**
> 另外「起回缺失的 app-server」**没有对应的支持命令** —— app-server 由
> `anet node start <alias> --copresence` 作为 `{appsrv, bridge, tui}` 三件套一起创建
> (`agent-network/bin/cli.ts` 的 `copresenceTmuxSessions()`),没有单独入口。

## 第一版为什么全错

第一版的三条判据是 `task_events.actor` 匹配、桥日志 `processTask returned`、
`sessions.updated_at` 差分,并且把第一条标成「最强、伪造不了」。

三条全部是**桥或服务端在运行时之外**产生的信号:

- `actor` 事件在 `reportStatus("working")` 时就写,早于运行时调用;
- `processTask returned` 超时也打 —— **被本文档自己举的死亡实例推翻**;
- `updated_at` 由 3 分钟一次的 idle 心跳推进。

**这份文档的立意是「别看进程数,看产物推进」,而第一版选的三个"产物"没有一个
是产物。** 根因是写的时候没有回到源码确认:每条信号是谁写的、什么时候写的。

`#520` 早就建好了满足这个要求的机制,第一版没有用它。
