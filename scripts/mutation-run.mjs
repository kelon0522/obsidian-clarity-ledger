/**
 * 变异测试入口 —— 由 shell 逐个调用（见 `npm run mutation`）。
 *
 * ## 为什么拆成两个文件
 *
 * **这个环境里从 node spawn 子进程拿不到 stdout/stderr** ——
 * `spawnSync` 返回 `status: null`（被信号杀），一个字节都收不到；
 * `execFileSync` 的 `e.stdout` 是空串。而从 shell 直接跑完全正常。
 *
 * 所以职责切开：
 * - `mutation-check.mjs` 负责**改文件 / 还原文件 / 解析日志**（纯逻辑，好测）
 * - `mutation-run.mjs`（本文件）负责**循环调用**
 * - **真正跑 vitest 的动作交给 shell**，逐个：
 *     node scripts/mutation-run.mjs apply <i> && npx vitest run > log2>&1; node scripts/mutation-run.mjs collect <i>
 *
 * 用法：`npm run mutation`（见 package.json，走 shell 循环）
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MUTATIONS,
  applyMutation,
  parseFailures,
  suiteCrashed,
  root,
  LOG,
} from './mutation-check.mjs'

const [, , cmd, argRaw] = process.argv
const arg = argRaw == null ? '' : Number(argRaw)

/** 变异期间用的备份目录 */
const BAK = join(root, '.mutation-bak')

if (cmd === 'apply') {
  const m = MUTATIONS[arg]
  if (!m) {
    console.error(`没有第 ${arg} 个变异（共 ${MUTATIONS.length} 个）`)
    process.exit(2)
  }
  const { original, mutated, path, changed } = applyMutation(m)
  if (!changed) {
    // 变异没生效 = 正则没匹配上。必须报出来，否则会误判成「断言无效」
    console.log(JSON.stringify({ ok: false, reason: 'no-change' }))
    process.exit(3)
  }
  rmSync(BAK, { recursive: true, force: true })
  writeFileSync(BAK + '.json', JSON.stringify({ file: path, original }))
  writeFileSync(path, mutated)
  console.log(JSON.stringify({ ok: true }))
  process.exit(0)
}

if (cmd === 'collect') {
  const m = MUTATIONS[arg]
  const log = (() => {
    try {
      return readFileSync(LOG, 'utf8')
    } catch {
      return ''
    }
  })()

  // 还原文件
  try {
    const bak = JSON.parse(readFileSync(BAK + '.json', 'utf8'))
    writeFileSync(bak.file, bak.original)
    rmSync(BAK + '.json', { force: true })
  } catch {
    console.error(`第 ${arg} 个变异没能还原文件 —— 需手动检查 ${m?.file}`)
  }

  const failed = parseFailures(log)
  const crashed = suiteCrashed(log)
  rmSync(LOG, { force: true })

  const hit = !crashed && failed.some((t) => m.expectRed.some((kw) => t.includes(kw)))
  console.log(
    JSON.stringify({
      ok: true,
      hit,
      crashed,
      failed,
      // 「红是红了，但红的不是预期断言」要能区分出来 ——
      // 否则变异把文件改坏导致的整体崩溃，会被算成「断言有效」
      verdict: crashed && failed.length === 0 ? 'crashed' : hit ? 'caught' : 'wrong-assertion',
    }),
  )
  process.exit(0)
}

console.log('用法：mutation-run.mjs apply|collect <索引>')
console.log(`共 ${MUTATIONS.length} 个变异`)
for (const [i, m] of MUTATIONS.entries()) console.log(`  ${i}: ${m.name}`)
process.exit(2)
