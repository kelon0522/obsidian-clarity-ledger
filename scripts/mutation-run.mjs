/**
 * 变异测试的 apply / collect 两步 —— 由 `scripts/mutation.sh` 逐个调用。
 *
 * ## 为什么要拆成两步 + 一个 shell 脚本
 *
 * **这个环境里从 node spawn 子进程拿不到 stdout/stderr** ——
 * `spawnSync` 返回 `status: null`（被信号杀掉），一个字节都收不到；
 * `execFileSync` 抛异常时 `e.stdout` 是空串。而从 shell 直接跑完全正常。
 *
 * 所以：shell 负责跑 vitest 并重定向，本模块只做纯逻辑。
 *
 * ## 还原为什么走 git
 *
 * 早先用「备份到 .mutation-bak.json」，结果一个变异没 collect 成功时，
 * 下一次 apply 会把备份覆盖掉 —— **污染永久留在工作区**。
 * 实测这样把 vault.ts（硬编码了「清晰力」）和 index.css（spacing-row 变 23px）
 * 改坏了两轮，测试从「本来该红的」变成「红的是被污染的代码」。
 * `git checkout` 让还原变成无条件可靠。
 *
 * **前提：工作区必须先提交干净。** `apply` 会检查这一点。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MUTATIONS, applyMutation, parseFailures, suiteCrashed, root, LOG } from './mutation-check.mjs'

const [, , cmd, argRaw] = process.argv
const idx = argRaw == null ? -1 : Number(argRaw)

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

/** 工作区必须干净 —— 否则 git checkout 会把用户的改动一起丢掉 */
function assertClean() {
  const dirty = git('status', '--porcelain').trim()
  return dirty === ''
}

if (cmd === 'apply') {
  const m = MUTATIONS[idx]
  if (!m) {
    console.error(`没有第 ${idx} 个变异（共 ${MUTATIONS.length} 个）`)
    process.exit(2)
  }
  if (!assertClean()) {
    console.error('工作区不干净。先提交或 stash —— 否则还原步骤会连你的改动一起丢。')
    process.exit(2)
  }

  const { mutated, path, changed } = applyMutation(m)
  if (!changed) {
    // 变异没生效 = 正则没匹配上。必须报出来，否则会误判成「断言无效」
    console.error(`第 ${idx} 个变异的正则没匹配上 ${m.file} —— 这个变异是假的`)
    process.exit(3)
  }
  writeFileSync(path, mutated)
  process.exit(0)
}

if (cmd === 'collect') {
  const m = MUTATIONS[idx]

  // 先还原，再解析 —— 顺序不能反：解析失败也要保证文件回到原状
  let restored = true
  try {
    git('checkout', '--', m.file)
  } catch {
    restored = false
  }

  let log = ''
  try {
    log = readFileSync(LOG, 'utf8')
  } catch {
    /* 日志不存在 = shell 那步没跑 */
  }
  rmSync(LOG, { force: true })

  const failed = parseFailures(log)
  const crashed = suiteCrashed(log)

  // 三种结果要分清，不能都算成「红」
  //   caught   预期的断言红了 → 断言有效
  //   wrong    红了但红的是别的断言 → 变异可能有问题，或断言落错了地方
  //   crashed  套件整体崩了 → 变异把文件改坏了，这个变异不算数
  //   全绿→ 断言抓不到，等于没写
  let verdict = 'green'
  if (crashed && failed.length === 0) verdict = 'crashed'
  else if (failed.length === 0) verdict = 'green'
  else if (failed.some((t) => m.expectRed.some((kw) => t.includes(kw)))) verdict = 'caught'
  else verdict = 'wrong-assertion'

  process.stdout.write(JSON.stringify({ restored, failed, verdict }) + '\n')
  process.exit(restored ? 0 : 1)
}

console.log('用法：mutation-run.mjs apply|collect <索引>')
console.log(`共 ${MUTATIONS.length} 个变异：`)
for (const [i, m] of MUTATIONS.entries()) console.log(`  ${i}: ${m.name}`)
process.exit(2)
