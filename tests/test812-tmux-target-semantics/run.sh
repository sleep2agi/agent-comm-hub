#!/usr/bin/env bash
set -euo pipefail

# test812 —— tmux target 语义,以及 docs/node-liveness-criterion.md 里那几行命令
#
# 起因:审查指出该文档把 tmux 的 target 写法标成「实测」,但仓里没有对应的
# Docker 套件和留存报告,那条声明重建之后无法复现。
#
# 这个套件的做法不是「另写一份命令来验证文档里的命令」—— 那只能证明两份副本
# 互相自洽。它把命令**从文档里抽出来**,替换掉节点名之后实跑。文档改错就红。

ROOT=/repo
DOC="$ROOT/docs/node-liveness-criterion.md"
export LANG=C.UTF-8 LC_ALL=C.UTF-8

SOURCE_COMMIT=${TEST812_SOURCE_COMMIT:-}
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
  echo "FAIL: SOURCE_COMMIT must be one full lowercase Git SHA" >&2; exit 1; }

# 与 test798 / test823 同:光验 SHA 的格式不够 —— 任何 40 位十六进制都能过,
# 而报告里那个 SHA 可能根本不含镜像里被测的字节。把 run.sh 在该 commit 下的
# git blob 哈希传进来,就地重算并比对。blob = sha1("blob <len>\0" + 内容)。
RUNSH_BLOB=${TEST812_RUNSH_BLOB:-}
[[ "$RUNSH_BLOB" =~ ^[0-9a-f]{40}$ ]] || {
  echo "FAIL: TEST812_RUNSH_BLOB 缺失或格式不对 —— 无法把 SOURCE_COMMIT 绑到被测字节" >&2; exit 1; }
_self="$ROOT/tests/test812-tmux-target-semantics/run.sh"
_actual=$( { printf 'blob %d\0' "$(wc -c < "$_self")"; cat "$_self"; } | sha1sum | cut -d' ' -f1 )
[[ "$_actual" == "$RUNSH_BLOB" ]] || {
  echo "FAIL: 镜像里的 run.sh 与 SOURCE_COMMIT=$SOURCE_COMMIT 声称的不是同一份" >&2
  echo "      期望 blob $RUNSH_BLOB,实际 $_actual" >&2; exit 1; }

echo "# test812 — tmux target semantics, bound to the doc's own commands"
echo "source_commit=$SOURCE_COMMIT"
# 把校验过的 blob 打进报告 —— 否则读报告的人只能看到一个 SHA,无法独立确认
# 这次跑真的把它绑到了被测字节上。有了这一行,任何人都能用
#   git rev-parse <source_commit>:tests/test812-tmux-target-semantics/run.sh
# 自己比对。
echo "runsh_blob=$_actual"
echo "doc_blob=$( { printf 'blob %d\0' "$(wc -c < "$DOC")"; cat "$DOC"; } | sha1sum | cut -d' ' -f1 )"
echo "tmux=$(tmux -V)"

fail() { echo "FAIL: $*" >&2; exit 1; }
kill_all() { tmux kill-server 2>/dev/null || true; sleep 0.2; }
mk() { tmux -u new-session -d -s "$1" "sleep 600"; }

# ---------------------------------------------------------------------------
# L0 — 把命令从文档里抽出来。抽不到就红:那说明文档改了形状,
#      而这道门再跑下去测的就是一份它自己编的命令,不是文档里的那条。
# ---------------------------------------------------------------------------
echo "[L0] extract the commands from the doc"
[[ -f "$DOC" ]] || fail "文档不在镜像里:$DOC"

# 只取 tmux 那两行;ps 那行不测(它依赖真实进程表,不是 tmux 语义)。
CAPTURE_LINE=$(grep -F 'tmux capture-pane' "$DOC" | head -1 || true)
LISTPANES_LINE=$(grep -F 'tmux list-panes' "$DOC" | head -1 || true)
[[ -n "$CAPTURE_LINE" ]]   || fail "文档里找不到 tmux capture-pane 那行"
[[ -n "$LISTPANES_LINE" ]] || fail "文档里找不到 tmux list-panes 那行"
echo "  doc_capture=$CAPTURE_LINE"
echo "  doc_listpanes=$LISTPANES_LINE"

# 抽出 -t 后面那个 target 表达式(允许单双引号)。
DOC_TARGET=$(printf '%s' "$CAPTURE_LINE" | sed -nE 's/.*-t[[:space:]]+"([^"]+)".*/\1/p')
[[ -n "$DOC_TARGET" ]] || DOC_TARGET=$(printf '%s' "$CAPTURE_LINE" | sed -nE "s/.*-t[[:space:]]+'([^']+)'.*/\1/p")
[[ -n "$DOC_TARGET" ]] || fail "从文档那行里抽不出 -t 的 target 表达式"
echo "  doc_target=$DOC_TARGET"

# 文档里写的是 ${node}-桥:0,这里把 node 绑成一个测试名再展开。
render_target() { node="$1" eval "printf '%s' \"$DOC_TARGET\""; }

# ---------------------------------------------------------------------------
# L1 — 文档那条 target 对存在的 session 必须真的能抓到
# ---------------------------------------------------------------------------
echo "[L1] the doc's target resolves a session that exists"
kill_all
mk "测试-桥"
T=$(render_target "测试")
echo "  rendered=$T"
tmux -u capture-pane -p -t "$T" >/dev/null 2>/tmp/e1 \
  || fail "文档那条 target 抓不到已存在的 session:rc≠0,stderr=[$(cat /tmp/e1)]"
echo "  OK rc=0"

# ---------------------------------------------------------------------------
# L2 — 缺窗口索引会报错(这正是文档里那句 ':0 才可用' 说的事)
#      注意 capture-pane 在这里是**响的**(rc=1),下面 L4 会看到不是所有
#      tmux 子命令都这么友好。
# ---------------------------------------------------------------------------
echo "[L2] dropping the window index makes capture-pane fail loudly"
set +e
out=$(tmux -u capture-pane -p -t "=测试-桥" 2>&1); rc=$?
set -e
[[ "$rc" -ne 0 ]] || fail "缺 :0 时 capture-pane 竟然成功了 —— 文档那句 ':0 才可用' 就不成立了"
printf '%s' "$out" | grep -qF "can't find pane" \
  || fail "缺 :0 时红了,但不是红在 'can't find pane' 上,而是:[$out]"
echo "  OK rc=$rc msg=can't find pane"

# ---------------------------------------------------------------------------
# L3 — '=' 到底挡住了什么。
#      先说清楚它**挡不住**什么:节点名互为前缀(A站狗 / A站狗2)在这套
#      `<别名>-桥` 命名下并不构成危险 —— A站狗-桥 不是 A站狗2-桥 的前缀,
#      两种写法都会红。第一版这道断言就是照着那个错场景写的。
#
#      真正的危险是**残留 session**:存在 <节点>-桥-old 而 <节点>-桥 已经没了。
#      这时 tmux 的前缀匹配会把 <节点>-桥 解析到 <节点>-桥-old,**退出码 0**,
#      把一个陈旧 pane 的内容当成活节点的现状交给你。'=' 让它红。
# ---------------------------------------------------------------------------
echo "[L3] '=' guards against a stale session that has your target as a prefix"
kill_all
mk "A站狗-桥-old"        # 残留;真正的 A站狗-桥 不存在

set +e
tmux -u capture-pane -p -t "A站狗-桥:0" >/dev/null 2>/tmp/e3; rc_loose=$?
set -e
[[ "$rc_loose" -eq 0 ]] \
  || fail "前提不成立:不带 = 时本应前缀命中残留的 A站狗-桥-old 并 rc=0,实际 rc=$rc_loose"
echo "  loose  -t 'A站狗-桥:0'  rc=0   ← 抓到的是残留的 A站狗-桥-old,不报错"

T2=$(render_target "A站狗")
set +e
tmux -u capture-pane -p -t "$T2" >/dev/null 2>/tmp/e4; rc_exact=$?
set -e
[[ "$rc_exact" -ne 0 ]] \
  || fail "文档那条 target 在节点不存在时竟然 rc=0 —— 它没能挡住前缀命中残留 session"
grep -qF "can't find session" /tmp/e4 \
  || fail "精确形式红了,但不是红在 \"can't find session\" 上:[$(cat /tmp/e4)]"
echo "  exact  -t '$T2' rc=$rc_exact msg=can't find session"

# 对照:节点名互为前缀时,两种写法都红 —— 记下来是为了不让人以为 '=' 是在
# 防这个。名字歧义要靠文档里第 2 步的 session 名对照,不是靠 '='。
kill_all
mk "A站狗2-桥"
set +e
tmux -u capture-pane -p -t "A站狗-桥:0" >/dev/null 2>&1; rc_a=$?
tmux -u capture-pane -p -t "=A站狗-桥:0" >/dev/null 2>&1; rc_b=$?
set -e
[[ "$rc_a" -ne 0 && "$rc_b" -ne 0 ]] \
  || fail "对照场景变了:A站狗2-桥 在场时问 A站狗-桥 本应两种写法都红,实际 loose=$rc_a exact=$rc_b"
echo "  对照:A站狗2-桥 在场时问 A站狗-桥 → 两种写法都红(= 不是防这个的)"

# '=' 同时会关掉 fnmatch。不带 '=' 时 '甲-*' 能解析成 '甲-桥'。
kill_all
mk "甲-桥"
set +e
tmux -u capture-pane -p -t "甲-*:0" >/dev/null 2>&1; rc_glob=$?
tmux -u capture-pane -p -t "=甲-*:0" >/dev/null 2>&1; rc_noglob=$?
set -e
[[ "$rc_glob" -eq 0 ]]    || fail "不带 = 时 '甲-*:0' 本应 fnmatch 命中 甲-桥,实际 rc=$rc_glob"
[[ "$rc_noglob" -ne 0 ]]  || fail "带 = 时 '甲-*:0' 不应再被当成通配,实际 rc=$rc_noglob"
echo "  glob   -t '甲-*:0' rc=0 / -t '=甲-*:0' rc=$rc_noglob   ← '=' 也关掉 fnmatch"

# ---------------------------------------------------------------------------
# L4 — 同一个畸形 target,不同子命令红得不一样。
#      capture-pane 缺 :0 会 rc=1 报错(L2);display-message 缺 :0 却是
#      **rc=0 + 空输出**。照着文档抄命令的人如果把 capture-pane 换成
#      display-message,就会拿到一个静默的空结果。
# ---------------------------------------------------------------------------
echo "[L4] the same malformed target fails loudly for capture-pane, silently for display-message"
kill_all
mk "A站狗-桥"
set +e
o_nowin=$(tmux -u display-message -p -t "=A站狗-桥" "#{session_name}" 2>/dev/null); rc_nowin=$?
o_win=$(tmux -u display-message -p -t "=A站狗-桥:0" "#{session_name}" 2>/dev/null); rc_win=$?
set -e
[[ "$rc_nowin" -eq 0 && -z "$o_nowin" ]] \
  || fail "display-message 缺 :0 的行为变了:rc=$rc_nowin out=[$o_nowin](本套件记录的是 rc=0 + 空)"
[[ "$rc_win" -eq 0 && "$o_win" == "A站狗-桥" ]] \
  || fail "display-message 带 :0 应返回 session 名,实际 rc=$rc_win out=[$o_win]"
echo "  display-message -t '=A站狗-桥'   rc=0 out=(空)   ← 静默"
echo "  display-message -t '=A站狗-桥:0' rc=0 out=A站狗-桥"

# ---------------------------------------------------------------------------
# L5 — 文档里 list-panes 那行的过滤形状:行是 <session>|<cmd>,
#      所以锚 '桥$' 匹配不到,必须匹配 '桥\|'。文档正文里解释了这一点,
#      这里把它变成可执行的断言。
# ---------------------------------------------------------------------------
echo "[L5] list-panes rows are <session>|<cmd>, so a '桥\$' anchor misses them"
kill_all
mk "甲-桥"; mk "甲-appsrv"
rows=$(tmux -u list-panes -a -F '#{session_name}|#{pane_current_command}')
printf '%s\n' "$rows" | grep -qE '桥\|' || fail "'桥\\|' 匹配不到任何行,实际内容:[$rows]"
if printf '%s\n' "$rows" | grep -qE '桥$'; then
  fail "'桥\$' 竟然匹配到了 —— 说明行格式不再是 <session>|<cmd>,文档那句解释就过期了"
fi
echo "  rows=$(printf '%s' "$rows" | tr '\n' ' ')"
echo "  OK  '桥\\|' 命中,'桥\$' 不命中"

# ---------------------------------------------------------------------------
# L6 — witnessed-red:证明这道门真的绑在文档上,而不是自说自话。
#      把从文档抽出来的 target 去掉 '=',用 L3 的场景重跑 —— 必须由红转绿,
#      也就是「静默抓错人」重新出现。它要是仍然红,说明 L3 根本没在测 '='。
# ---------------------------------------------------------------------------
echo "[L6] witnessed-red: strip '=' from the doc's own target and the silent-wrong-node bug returns"
MUT_TARGET=${DOC_TARGET/=/}
[[ "$MUT_TARGET" != "$DOC_TARGET" ]] || fail "变异是字节 no-op —— 文档那条 target 里根本没有 '='"
kill_all
mk "A站狗-桥-old"
render_mut() { node="$1" eval "printf '%s' \"$MUT_TARGET\""; }
TM=$(render_mut "A站狗")
set +e
tmux -u capture-pane -p -t "$TM" >/dev/null 2>&1; rc_mut=$?
set -e
[[ "$rc_mut" -eq 0 ]] \
  || fail "去掉 '=' 之后仍然红(rc=$rc_mut)—— 那 L3 的绿就不是 '=' 挣来的"
echo "  MUTATION_RED doc-target-without-equals target='$TM' rc=$rc_mut (静默命中残留的 A站狗-桥-old)"

kill_all
echo "RESULT: PASS"
