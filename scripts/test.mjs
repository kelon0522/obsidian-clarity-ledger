/**
 * 跨平台测试 runner。
 *
 * ## 为什么要新写一个，而不是改 run-tests.mjs
 *
 * 原来的驱动是 `scripts/run-tests.sh`，`npm test` 写的是 `bash scripts/run-tests.sh`。
 * **bash 在 Windows 上不是标配** —— 于是「没装 Git Bash 的 Windows 贡献者」
 * 根本跑不了测试。一个社区插件的测试跑不起来，等于没有测试。
 *
 * 所以驱动层换成 node：`npm test` → `node scripts/test.mjs`。
 * 而 `run-tests.mjs`（那三条假绿校验）**一个字都不动** —— 那是踩坑踩出来的规则，
 * 不该在换平台时顺手改。职责切开：本文件负责「跑」，run-tests.mjs 负责「判」。
 *
 * ## 为什么还有 shell 分支
 *
 * 有些受限环境（CI 沙箱、某些容器）里 node 的 spawnSync 拿不到子进程输出：
 *
 * ```
 *   spawnSync C:\Windows\system32\cmd.exe EBUSY
 *   status: null / signal: null / stdout: undefined
 * ```
 *
 * 撞上就交给 shell 跑，**整个判定都在 shell 里做完**（run-tests.sh 本来就会调
 * 同一个 run-tests.mjs）。这条路是等价的，且少一层跨进程的输出搬运。
 *
 * ## 为什么日志落文件而不是直接读 stdout
 *
 * vitest 输出量大且带 ANSI 颜色码，直接在内存里处理容易和终端输出串在一起。
 * 落临时文件 + 事后解析是稳的：解析的和用户看到的是同一份字节。
 *
 * 用法：`npm test`
 */

import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const LOG = join(root, '.vitest-run.log')

/* Windows 上 `npm` / `npx` 不带扩展名会「不是内部或外部命令」，
   spawnSync 找不到直接 ENOENT。`npm exec` 走当前 node 自带的 npm，
   不依赖全局 PATH 里有没有 npx。*/
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const res = spawnSync(npmCmd, ['exec', '--', 'vitest', 'run', ...process.argv.slice(2)], {
  cwd: root,
  encoding: 'utf8',
  /* Windows 上 .cmd 必须经 cmd.exe。*/
  shell: process.platform === 'win32',
})

/* ---------- 分支一：node 跑不了子进程 → 整个交给 shell ----------
 *
 * 判据是「一个字节输出都没拿到」而不是「有没有 error」——
 * 有些环境不抛 error，只是返回空（更隐蔽）。
 * 此时不再试图在 node 里处理，直接 `exec` 掉 shell 让它跑完整流程。*/
if (!res.stdout && !res.stderr) {
  const sh = process.platform === 'win32' ? findBash() : 'sh'
  if (!sh) {
    console.error(
      'vitest 没跑起来，而且找不到可用的 shell 兜底。\n' +
        `  退出码 ${res.status} / 信号 ${res.signal} / 错误 ${res.error?.message ?? '（无）'}\n` +
        '  手动跑一次看看：npx vitest run',
    )
    process.exit(1)
  }
  console.error(`（node 拿不到子进程输出，改用 ${sh} 兜底）`)
  const r = spawnSync(`${sh} scripts/run-tests.sh`, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
  process.exit(r.status === null ? 1 : r.status)
}

/* ---------- 分支二：正常路径 ----------
 *
 * status为 null = 被信号杀掉，当失败处理。
 * **绝不能让它 exit 0** —— 那是假绿。*/
const rc = res.status === null ? 1 : res.status

/* 原始输出先照打：CI 里只看摘要等于让人猜。*/
process.stdout.write(res.stdout ?? '')
process.stderr.write(res.stderr ?? '')

/* 落盘给 run-tests.mjs 解析。
   两路输出都要：摘要走 stdout，报错常走 stderr。*/
const { writeFileSync } = await import('node:fs')
writeFileSync(LOG, `${res.stdout ?? ''}${res.stderr ?? ''}`)

const checker = spawnSync(process.execPath, ['scripts/run-tests.mjs', String(rc), LOG], {
  cwd: root,
  stdio: 'inherit',
})

rmSync(LOG, { force: true })
process.exit(checker.status === null ? 1 : checker.status)

/** Windows 上找 Git 自带的 bash。装了 Git 就有，但路径不固定只能试。 */
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