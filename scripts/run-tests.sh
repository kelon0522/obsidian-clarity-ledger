#!/bin/bash
# 测试 runner —— shell 版本。
#
# # ⚠️ 这是**回退路径**，主入口是 `node scripts/test.mjs`
#
# 保留这个文件有两个原因：
#
# 1. `scripts/test.mjs` 在少数受限环境里拿不到子进程输出
#    （spawnSync EBUSY，见那边注释），撞上时整个交给本文件跑。
# 2. 它是这个逻辑最早的实现，判定规则（run-tests.mjs 里的三条）
#    在这里也能独立跑通 —— 交叉验证。
#
# **不要再把它挂回 `npm test`** —— 早先就是这么写的，
# 于是没装 Git Bash 的 Windows 贡献者根本跑不了测试。
#
# 本文件只管「跑 vitest + 落日志 + 调校验器」，判定规则全在
# `scripts/run-tests.mjs`（node，跨平台），shell 与 node 不重复实现。
#
# ## 为什么测试要过 shell 层重定向而不是 node 接管道
#
# **有些环境里 node 接子进程的 stdout 会拿到空串**（见 mutation-check.mjs）。
# 所以跑测试 + 拿输出这两件事都在 shell 里做，node 只解析文件。
#
# 用法：`npm test`（走 node 入口，必要时自动落到这里）

set -u
cd "$(dirname "$0")/.."

LOG=".vitest-run.log"
npx vitest run "$@" > "$LOG" 2>&1
RC=$?

node scripts/run-tests.mjs "$RC" "$LOG"
CHECK_RC=$?

# 校验不通过时把完整输出打出来 —— 那时候摘要不足以定位问题
if [ $CHECK_RC -ne 0 ]; then
  echo ""
  echo "--- vitest 完整输出 ---"
  cat "$LOG"
fi

rm -f "$LOG"
exit $CHECK_RC
