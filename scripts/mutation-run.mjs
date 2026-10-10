/**
 * 变异测试：apply / judge 两步 —— 由 `scripts/mutation.sh` 逐个调用。
 *
 * ## 为什么拆成两步 + 一个 shell 脚本
 *
 * **这个环境里 node 跑不了子进程** —— `spawnSync` 撞 `EBUSY`（git）或返回
 * `status: null` 一个字节收不到（vitest）。两条都试过。
 * 而从 shell 直接跑 `git` / `npx vitest run` 完全正常。
 *
 * 所以职责切开：
 * - 本模块：**改文件** + **解析日志**（纯逻辑）
 * - `mutation.sh`：跑 vitest、跑 git、判断工作区是否干净
 *
 * ## 还原为什么走 git checkout
 *
 * 早先用「备份到 .json 文件」还原，结果某个变异没 collect 成功时，
 * 下一次 apply 会把备份覆盖掉 —— **污染永久留在工作区**。
 * 实测这样把 vault.ts（硬编码回「清晰力」）和 index.css（spacing-row 变 23px）
 * 改坏了两轮，测试从「本来该红的」变成「红的是被污染的代码」。
 * `git checkout` 无条件可靠。
 *
 * **前提：工作区必须先提交干净**，shell 会检查。
 *
 * 用法：`npm run mutation`
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MUTATIONS, applyMutation, parseFailures, suiteCrashed, root, LOG } from './mutation-check.mjs'

const [, , cmd, argRaw] = process.argv
const idx = argRaw == null ? -1 : Number(argRaw)

if (cmd === 'apply') {
  const m = MUTATIONS[idx]
  if (!m) {
    console.error(`没有第 ${idx} 个变异（共 ${MUTATIONS.length} 个）`)
    process.exit(2)
  }
  const { mutated, path, changed } = applyMutation(m)
  if (!changed) {
    // 变异没生效 —— 意味着**这条断言从未被验证过**，必须报出来。
    // 绝不能把它算成「断言有效」或「断言无效」，那是两回事
    console.error(`第 ${idx} 个变异没匹配上 ${m.file} —— 这个变异是假的`)
    process.exit(3)
  }
  writeFileSync(path, mutated)
  process.exit(0)
}

if (cmd === 'judge') {
  const m = MUTATIONS[idx]
  let log = ''
  try {
    log = readFileSync(LOG, 'utf8')
  } catch {
    /* 日志不存在 = shell 那步没跑成 */
  }
  rmSync(LOG, { force: true })

  const failed = parseFailures(log)
  const crashed = suiteCrashed(log)

  // 四种结果必须分清，不能都算成「红」
  //   caught   预期的断言红了 → 断言有效
  //   wrong    红了但红的是别的断言 → 变异落点或断言位置有问题
  //   crashed  套件整体崩了 → 变异把文件改坏了，这个变异不算数
  //   green    全绿 → 断言抓不到，等于没写
  let verdict
  if (failed.length === 0) verdict = crashed ? 'crashed' : 'green'
  else if (failed.some((t) => m.expectRed.some((kw) => t.includes(kw)))) verdict = 'caught'
  else verdict = 'wrong-assertion'

  process.stdout.write(JSON.stringify({ verdict, failed }) + '\n')
  process.exit(0)
}

console.log('用法：mutation-run.mjs apply|judge <索引>')
console.log(`共 ${MUTATIONS.length} 个变异：`)
for (const [i, m] of MUTATIONS.entries()) console.log(`  ${i}: ${m.name}`)
process.exit(2)
