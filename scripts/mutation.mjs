/**
 * 变异测试 driver（跨平台）。
 *
 * ## 与 mutation.sh 的关系
 *
 * `npm run mutation` 原来写的是 `bash scripts/mutation.sh`，理由和测试一样：
 * **没装 Git Bash 的 Windows 贡献者跑不了。** 现在改成
 * `node scripts/mutation.mjs`，行为逐条对齐 mutation.sh，shell 版保留作回退。
 *
 * `mutation-check.mjs`（变异定义 + 判定规则）和 `mutation-run.mjs`
 * （apply / judge 两个子命令）都**复用不���** —— 那是踩坑踩出来的资产。
 *
 * ## node / shell 的分工
 *
 * 这个环境里 node 拿不到子进程输出（spawnSync EBUSY），所以：
 *
 * - **能拿到** → 全程 node：apply → 跑 vitest → git checkout → judge
 * - **拿不到** → 整段交给 `scripts/mutation.sh`，它已经实现了同样的流程
 *
 * 与 test.mjs 同一套思路：驱动层是谁不重要，判定结果一致才重要。
 *
 * 用法：`npm run mutation`
 */

import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MUTATIONS, applyMutation, parseFailures, suiteCrashed } from './mutation-check.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const LOG = join(root, '.vitest-mutation.log')

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

/* ---------- 预检：能不能拿到子进程 ---------- */

const probe = spawnSync(npmCmd, ['exec', '--', 'vitest', '--version'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
const canSpawn = !!(probe.stdout || probe.stderr)

if (!canSpawn) {
  const sh = process.platform === 'win32' ? findBash() : 'sh'
  if (!sh) {
    console.error(
      '变异测试需要能启动子进程，但 node 拿不到输出，也找不到 shell 兜底。\n' +
        '请手动检查：npx vitest --version',
    )
    process.exit(1)
  }
  console.error(`（node 拿不到子进程输出，改用 ${sh} 跑 mutation.sh）\n`)
  const r = spawnSync(`${sh} scripts/mutation.sh`, { cwd: root, stdio: 'inherit', shell: true })
  process.exit(r.status === null ? 1 : r.status)
}

/* ---------- 预检：工作区必须干净 ----------
 *
 * 还原步骤是 `git checkout -- <file>`，脏工作区会连用户的改动一起丢掉。
 * 这个保护在 mutation.sh 里也有，这里必须有 —— 因为现在默认走 node 这条路。 */
const dirty = spawnSync('git', ['status', '--porcelain'], {
  cwd: root,
  encoding: 'utf8',
})
if ((dirty.stdout ?? '').trim()) {
  console.error('工作区不干净。先提交或 stash：')
  console.error((dirty.stdout ?? '').split('\n').slice(0, 5).join('\n'))
  console.error('')
  console.error('还原步骤用 git checkout，工作区不干净会把你的改动一起丢掉。')
  process.exit(1)
}

console.log(`变异测试 —— ${MUTATIONS.length} 个变异，每个都该让断言变红\n`)

let survived = 0
const notes = []

for (const [i, m] of MUTATIONS.entries()) {
  /* --- apply --- */
  const applied = applyMutation(m)
  if (!applied.changed) {
    /* 没匹配上 = 这条变异是假的 = **这条断言从未被验证过**。
       这比「断言无效」更严重：它意味着你以为测了的东西根本没测。
       早先有两条变异因为正则里的 `+` 被当量词，一直是假绿。*/
    console.log(`✗ ${m.name}`)
    console.log('    变异没生效 —— 匹配不上，这个变异从未被验证过')
    notes.push(`${m.name}（变异是假的，从未被验证过）`)
    survived++
    continue
  }
  writeFileSync(applied.path, applied.mutated)

  /* --- 跑测试 --- */
  const run = spawnSync(npmCmd, ['exec', '--', 'vitest', 'run'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  let log = `${run.stdout ?? ''}${run.stderr ?? ''}`

  /* --- 还原（无条件，先跑再说）--- */
  const back = spawnSync('git', ['checkout', '--', m.file], { cwd: root, encoding: 'utf8' })
  if (back.status !== 0) notes.push(`${m.file} 还原失败，需手动 git checkout`)

  /* --- 落盘给判定（沿用 mutation-run.mjs 的解析规则）--- */
  writeFileSync(LOG, log)

  const failed = parseFailures(log)
  const crashed = suiteCrashed(log)

  /* 四种结果必须分清，不能都算成「红」——
     与 mutation-run.mjs 的 judge 分支保持一致。*/
  let verdict
  if (failed.length === 0) verdict = crashed ? 'crashed' : 'green'
  else if (failed.some((t) => m.expectRed.some((kw) => t.includes(kw)))) verdict = 'caught'
  else verdict = 'wrong-assertion'

  switch (verdict) {
    case 'caught':
      console.log(`✓ ${m.name}`)
      break
    case 'wrong-assertion':
      console.log(`~ ${m.name}`)
      console.log(`    变红了，但红的不是预期的断言。实际：${failed.join('; ')}`)
      break
    case 'crashed':
      console.log(`✗ ${m.name}`)
      console.log('    **套件整体崩了（变异把文件改坏），这个变异不算数**')
      notes.push(`${m.name}（变异改坏了文件）`)
      survived++
      break
    default:
      console.log(`✗ ${m.name}`)
      console.log('    **全绿 —— 这条断言抓不到这个 bug，等于没写**')
      notes.push(`${m.name}（断言无效）`)
      survived++
      break
  }
}

rmSync(LOG, { force: true })

console.log('')
console.log('剩余未提交改动：')
const left = spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })
console.log((left.stdout ?? '').trim().split('\n').slice(0, 5).join('\n'))

if (survived > 0) {
  console.log('')
  console.log(`${survived} 个变异没被正确抓到：`)
  for (const n of notes) console.log(`  - ${n}`)
  process.exit(1)
}

console.log('')
console.log(`全部 ${MUTATIONS.length} 个变异都被抓到 —— 断言还活着`)

function findBash() {
  for (const c of [
    'C:/Program Files/Git/bin/bash.exe',
    'C:/Program Files (x86)/Git/bin/bash.exe',
    `${process.env.LOCALAPPDATA ?? ''}/Programs/Git/bin/bash.exe`,
  ]) {
    if (c && existsSync(c)) return `"${c}"`
  }
  return null
}