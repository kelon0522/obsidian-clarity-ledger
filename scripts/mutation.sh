#!/bin/bash
# 变异测试：逐个注入错误，确认对应断言会红。
#
# ## 为什么用 shell 跑 vitest
#
# **这个环境里从 node spawn 子进程拿不到 stdout/stderr** ——
# `spawnSync` 返回 `status: null`（被信号杀掉），`execFileSync` 抛异常时
# `e.stdout` 是空串。而在这里直接跑 `npx vitest run > log` 完全正常。
#
# 试过 `--reporter=json --outputFile=` —— 根本不产出文件。
# 所以只能走shell 重定向这一条路。
#
# ## 文件还原为什么走 git
#
# 早先用「备份文件」还原，结果某个变异没 collect 成功时，
# 下一次 apply 把备份覆盖掉 —— 污染永久留在工作区，
# 实测把 vault.ts 和 index.css 改坏了两轮。
# `git checkout` 无条件可靠，代价是要求工作区先干净。
#
# 用法：npm run mutation   （或在仓库根直接 bash scripts/mutation.sh）

set -u
cd "$(dirname "$0")/.."

LOG=".vitest-mutation.log"

if [ ! -f scripts/mutation-run.mjs ]; then
  echo "找不到 scripts/mutation-run.mjs"
  exit 1
fi

# 变异清单由 node 打印，避免两处维护
COUNT=$(node scripts/mutation-run.mjs 2>&1 | grep -E '^共 [0-9]+ 个变异' | grep -o '[0-9]\+')
COUNT=${COUNT:-0}
if [ "$COUNT" = "0" ]; then
  echo "拿不到变异清单，先单独跑 node scripts/mutation-run.mjs 看报错"
  exit 1
fi

echo "变异测试 —— $COUNT 个变异，每个都该让断言变红"
echo ""

survived=0
declare -a SURVIVED_LIST=()

for i in $(seq 0 $((COUNT - 1))); do
  NAME=$(node scripts/mutation-run.mjs 2>&1 | grep -E "^  $i:" | sed "s/^  $i: //")
  [ -z "$NAME" ] && NAME="（第 $i 个）"

  if ! node scripts/mutation-run.mjs apply "$i" 2>/tmp/mut-err.txt; then
    if grep -q "正则没匹配上" /tmp/mut-err.txt; then
      echo "✗ $NAME"
      echo "    变异没生效 —— 正则没匹配上，这个变异是假的"
      survived=$((survived + 1))
      SURVIVED_LIST+=("$NAME （变异是假的）")
    else
      echo "✗ $NAME"
      echo "    $(cat /tmp/mut-err.txt | tr -d '\r')"
      survived=$((survived + 1))
      SURVIVED_LIST+=("$NAME （apply 失败）")
    fi
    continue
  fi

  npx vitest run > "$LOG" 2>&1
  RESULT=$(node scripts/mutation-run.mjs collect "$i")
  VERDICT=$(echo "$RESULT" | sed 's/.*"verdict":"\([^"]*\)".*/\1/')
  FAILED=$(echo "$RESULT" | sed 's/.*"failed":\[\([^]]*\)\].*/\1/')

  case "$VERDICT" in
    caught)
      echo "✓ $NAME"
      ;;
    wrong-assertion)
      echo "~ $NAME"
      echo "    变红了，但红的不是预期的断言。实际：$FAILED"
      ;;
    crashed)
      echo "✗ $NAME"
      echo "    **套件整体崩了（变异把文件改坏），这个变异不算数**"
      survived=$((survived + 1))
      SURVIVED_LIST+=("$NAME （变异改坏了文件）")
      ;;
    *)
      echo "✗ $NAME"
      echo "    **全绿 —— 这条断言抓不到这个 bug，等于没写**"
      survived=$((survived + 1))
      SURVIVED_LIST+=("$NAME （断言无效）")
      ;;
  esac
done

echo ""
if [ "$survived" -gt 0 ]; then
  echo "$survived 个变异没被正确抓到："
  for s in "${SURVIVED_LIST[@]}"; do echo "  - $s"; done
  echo ""
  echo "注意：工作区已通过 git checkout 还原，git status 应该是干净的。"
  exit 1
fi

echo "全部 $COUNT 个变异都被抓到 —— 断言还活着"
git status --short | head -5
