/**
 * 测试结果校验 —— 只解析，不跑测试（跑测试在 shell 层，见 run-tests.sh）。
 *
 * ## 为什么需要它
 *
 * **vitest 会报假绿。** 踩过的现象：
 *
 * ```
 *  Test Files  1 failed | 4 passed (5)
 *       Tests  125 passed (125)
 * ```
 *
 * `alias.test.ts` 因语法错误**整个套件加载失败**，0 条用例执行。
 * 但摘要里既没有 failed 计数、也没把它算进 Tests 总数，
 * **退出码还是 0**。只看 `vitest run` 的最后一行会得出「125 全绿」——
 * 而实际上有 25 条用例根本没跑。
 *
 * 这个静默失败比红更危险：红会停下来，绿会继续往下走。
 * 所以三道校验：
 *
 * 1. **退出码非 0** → 直接失败
 * 2. **有文件失败但用例零失败** → 套件加载失败的特征，摘要看不出来
 * 3. **用例总数为 0** → 全部套件都没加载
 *
 * 用法：`node scripts/run-tests.mjs <退出码> <日志路径>`
 */

import { readFileSync } from 'node:fs'

const [, , exitCodeRaw, logPath] = process.argv
const exitCode = Number(exitCodeRaw ?? 1)

if (!logPath) {
  console.error('用法：run-tests.mjs <退出码> <日志路径>')
  process.exit(1)
}

let text = ''
try {
  text = readFileSync(logPath, 'utf8')
} catch {
  console.error(`读不到日志 ${logPath} —— 测试可能整个没跑起来`)
  process.exit(1)
}

// 剥 ANSI —— 颜色码会插在数字中间，不剥的话正则匹配不到
const clean = text.replace(/\x1b\[[0-9;]*m/g, '')

const fileLine = clean.match(/Test Files\s+(.+)/)
const testLine = clean.match(/Tests\s+(.+)/)

if (!fileLine || !testLine) {
  console.error('读不到 vitest 摘要 —— 可能是套件整体加载失败')
  console.error(clean.slice(-2000))
  process.exit(1)
}

const files = fileLine[1].trim()
const tests = testLine[1].trim()

const failedFiles = Number(files.match(/(\d+)\s+failed/)?.[1] ?? 0)
const passedFiles = Number(files.match(/(\d+)\s+passed/)?.[1] ?? 0)
const failedTests = Number(tests.match(/(\d+)\s+failed/)?.[1] ?? 0)
const totalTests = Number(tests.match(/(\d+)\s+passed/)?.[1] ?? 0)

console.log(`Test Files  ${files}`)
console.log(`Tests        ${tests}`)

const problems = []
if (exitCode !== 0) problems.push(`vitest 退出码是 ${exitCode}`)
if (failedFiles > 0) problems.push(`有 ${failedFiles} 个测试文件失败`)
if (failedTests > 0) problems.push(`有 ${failedTests} 条用例失败`)
if (totalTests === 0) problems.push('用例总数为 0 —— 全部套件可能都没加载')
if (passedFiles === 0) problems.push('没有任何测试文件通过')
if (failedFiles > 0 && failedTests === 0) {
  problems.push('**文件失败但用例零失败 —— 典型的「套件加载失败」，摘要里看不出来**')
}

if (problems.length) {
  console.error('')
  console.error('校验不通过：')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('')
  console.error('--- 输出尾部 ---')
  console.error(clean.slice(-3000))
  process.exit(1)
}

console.log('')
console.log(`校验通过：${passedFiles} 个文件、${totalTests} 条用例全部成功`)
