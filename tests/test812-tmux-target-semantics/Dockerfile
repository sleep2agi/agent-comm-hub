# test812 —— tmux target 语义门
#
# 由 PR #812 的审查发现催生:那份文档把 tmux 的 target 写法标成「实测」,
# 但仓库里既没有覆盖这些命令的 Docker 套件,也没有留存报告 —— 那条声明
# 在别人的机器上无法复现。
#
# 这个套件不测机群,只测 tmux 自身的 target 解析语义。它是自足的:
# 容器里现造 session,不碰任何真实节点。
#
# 🔴 它绑的对象是 docs/node-liveness-criterion.md 里那几行命令**本身** ——
#    命令从文档里抽出来实跑,而不是在套件里另写一份副本。文档改错就红。

FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc

# tmux 的 target 解析在 3.x 内是稳定的,但仍把版本打进报告,便于日后归因。
RUN apk add --no-cache tmux bash coreutils >/dev/null

WORKDIR /repo
ARG TEST812_SOURCE_COMMIT=unknown
ENV TEST812_SOURCE_COMMIT=$TEST812_SOURCE_COMMIT
ARG TEST812_RUNSH_BLOB=unknown
ENV TEST812_RUNSH_BLOB=$TEST812_RUNSH_BLOB

# 被测对象:文档本身
COPY docs/node-liveness-criterion.md /repo/docs/node-liveness-criterion.md
COPY tests/test812-tmux-target-semantics /repo/tests/test812-tmux-target-semantics
RUN chmod +x /repo/tests/test812-tmux-target-semantics/run.sh

CMD ["bash", "/repo/tests/test812-tmux-target-semantics/run.sh"]
