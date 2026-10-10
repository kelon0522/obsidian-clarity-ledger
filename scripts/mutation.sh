#!/bin/bash
# 变异测试 —— shell 版本。
#
# # ⚠️ 这是**回退路径**，主入口是 `node scripts/mutation.mjs`
#
# 保留原因：`scripts/mutation.mjs` 在少数受限环境里拿不到子进程输出
# （spawnSync EBUSY），撞上时整个交给本文件跑。
#
# **不要再把它挂回 `npm run mutation`** —— 早先就是这么写的，
# 于是没装 Git Bash 的 Windows 贡献者跑不了这条命令。
#
# 本文件与 `scripts/mutation.mjs` 行为一致，但各写一份。
# **改流程时两处都要改** —— 或者更好的做法是把变更同步过去，
# 别让它们悄悄分叉（分叉之后「mutation.sh 说过了、mutation.mjs 没过」
# 是很难查的问题）。
#
# ## 为什么所有外部命令都在 shell 里跑
#
# **有些环境里从 node spawn 子进程拿不到 stdout/stderr** ——
# `spawnSync` 返回 `status: null`，一个字节都收不到。
# 而从 shell 直接跑 `npx vitest run > log 2>&1` 完全正常。
#
# ## 文件还原为什么走 git checkout
#
# 早先用「备份文件」还原，某变异没 collect 成功时下一次 apply 会覆盖备份，
# 污染永久留在工作区 —— 实测把 vault.ts 和 index.css 改坏了两轮。
# git checkout 无条件可靠，代价是要求工作区先干净（本脚本会检查）。

set -u
cd "$(dirname "$0")/.."

LOG=".vitest-mutation.log"

if [ ! -f scripts/mutation-run.mjs ]; then
  echo "找不到 scripts/mutation-run.mjs"
  exit 1
fi

DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
  echo "工作区不干净。先提交或 stash："
  echo "$DIRTY" | head -5
  echo ""
  echo "还原步骤用 git checkout，工作区不干净会把你的改动一起丢掉。"
  exit 1
fi

LIST=$(node scripts/mutation-run.mjs 2>&1)
COUNT=$(echo "$LIST" | grep -oE '共 [0-9]+ 个变异' | grep -oE '[0-9]+')
if [ -z "${COUNT:-}" ]; then
  echo "拿不到变异清单："
  echo "$LIST" | head -10
  exit 1
fi

echo "变异测试 —— $COUNT 个变异，每个都该让断言变红"
echo ""

survived=0
NOTES=""

for i in $(seq 0 $((COUNT - 1))); do
  NAME=$(echo "$LIST" | grep -E "^  $i:" | sed "s/^  $i: //")
  [ -z "$NAME" ] && NAME="（第 $i 个）"
  FILE=$(node -e "
    import('./scripts/mutation-check.mjs').then(m => process.stdout.write(m.MUTATIONS[$i].file))
  ")

  # --- apply ---
  ERR=$(node scripts/mutation-run.mjs apply "$i" 2>&1)
  RC=$?
  if [ $RC -ne 0 ]; then
    echo "✗ $NAME"
    if echo "$ERR" | grep -q "这个变异是假的"; then
      echo "    变异没生效 —— 匹配不上，这个变异从未被验证过"
      NOTES="$NOTES\n  - $NAME （变异是假的，从未被验证过）"
    else
      echo "    apply 失败：$(echo "$ERR" | tr -d '\r' | head -2)"
      NOTES="$NOTES\n  - $NAME （apply 失败）"
    fi
    survived=$((survived + 1))
    continue
  fi

  # --- 跑测试 ---
  npx vitest run > "$LOG" 2>&1

  # --- 还原（无条件，先跑再说）---
  git checkout -- "$FILE" 2>/dev/null || NOTES="$NOTES\n  ! $FILE 还原失败，需手动 git checkout"

  # --- 判断 ---
  RESULT=$(node scripts/mutation-run.mjs judge "$i")
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
      NOTES="$NOTES\n  - $NAME （变异改坏了文件）"
      survived=$((survived + 1))
      ;;
    *)
      echo "✗ $NAME"
      echo "    **全绿 —— 这条断言抓不到这个 bug，等于没写**"
      NOTES="$NOTES\n  - $NAME （断言无效）"
      survived=$((survived + 1))
      ;;
  esac
done

rm -f "$LOG" /tmp/mut-err.txt

echo ""
echo "剩余未提交改动："
git status --short | head -5
echo ""

if [ "$survived" -gt 0 ]; then
  echo "$survived 个变异没被正确抓到："
  echo -e "$NOTES"
  exit 1
fi

echo "全部 $COUNT 个变异都被抓到 —— 断言还活着"
