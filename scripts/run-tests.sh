#!/bin/bash
# 测试 runner —— 不直接用 `vitest run`。
#
# ## 为什么要有这个
#
# **vitest 会报假绿。** 踩过的现象：
#
# ```
#  Test Files  1 failed | 4 passed (5)
#       Tests  125 passed (125)
# ```
#
# `alias.test.ts` 因语法错误**整个套件加载失败**（0 条用例执行），
# 但摘要里既没有 failed 计数、也没把它算进 Tests 总数，**退出码还是 0**。
# 只看最后一行会得出「125 全绿」—— 而实际上有 25 条用例根本没跑。
#
# 所以做三道校验（`run-tests.mjs` 负责解析，这层负责跑）：
#
# 1. **退出码非 0** → 直接失败
# 2. **有文件失败但用例零失败** → 典型的套件加载失败，摘要看不出来
# 3. **用例总数为 0** → 全部套件都没加载
#
# 另外 `vitest.config.ts` 里的 `fileParallelism: false` + `singleFork`
# 是 vitest 侧的配置，绕开 Windows 上偶发的 EPERM。
#
# ## 为什么在 shell 层重定向而不是 node 接管道
#
# **这个环境里 node 接子进程的 stdout 会拿到空串**（见 mutation-check.mjs）。
# 所以跑测试 + 拿输出这两件事都在 shell 里做，node 只解析文件。
#
# 用法：`npm test`

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
