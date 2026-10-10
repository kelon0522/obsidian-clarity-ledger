/**
 * 补全 package-lock.json 里缺 version 的 optionalDependencies 条目。
 *
 * ## 为什么要这个脚本
 *
 * `npm install --package-lock-only` 在部分环境（sandbox、受限网络）下
 * 解析 `optionalDependencies` 会失败，lock 里留下一堆空壳条目：
 *
 * ```json
 * "node_modules/vite-node/node_modules/esbuild/node_modules/@esbuild/win32-x64": {}
 * ```
 *
 * 没有 version 的条目会让 `npm ci` 直接炸：
 * `TypeError: Invalid Version:` （arborist 的 canDedupe 里new SemVer(undefined)）。
 * 而 release.yml 和 CI 都用 `npm ci` —— 所以这是**阻断发版**的。
 *
 * 这些包都是 esbuild / rollup 的**平台二进制**，按平台分（win32-x64、linux-arm64…），
 * 在本机之外的平台上根本装不上，`optionalDependencies` 的语义就是「装不上就算了」。
 * npm 解析不出来时留下空壳，而 npm ci 恰好不容忍空壳。
 *
 * ## 修法
 *
 * 直接从 registry 拉每个包的元数据，把 version / resolved / integrity / cpu / os
 * 补回去。这些字段是确定的（同一个版本永远同一份），补出来的 lock 与
 * 正常 `npm install` 生成的等价。
 *
 * 幂等：已经是完整的条目会跳过。
 *
 * 用法：`node scripts/fix-lock-optional.mjs`
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCK = join(root, 'package-lock.json')

const lock = JSON.parse(readFileSync(LOCK, 'utf8'))

/** 从条目路径反推包名：`node_modules/a/node_modules/b`→ `b` */
function pkgNameOf(p) {
  const parts = p.split('node_modules/')
  return parts[parts.length - 1]
}

/**
 * 反推「谁依赖它」—— 也就是父包的 lock 路径。
 *
 * 条目路径形如：
 *   `node_modules/vite-node/node_modules/esbuild/node_modules/@esbuild/win32-x64`
 *                                                     ^^^^^^^^^^^^^^^^^^^^^^^^
 * 父包是最后那个 `node_modules/` 之前的部分，即 `.../esbuild`。
 *
 * 所以要剥掉的是**末尾两段**：`node_modules/@esbuild/win32-x64`。
 * 早先只剥一段（正则 `/node_modules\/[^/]+$/`），得到 `.../@esbuild`
 * —— 那是 scoped 包的目录，不是包条目，查不到 version，于是「推不出父包版本」。
 */
function parentPathOf(p) {
  const at = p.lastIndexOf('node_modules/')
  if (at < 0) return null
  return p.slice(0, at).replace(/\/$/, '')
}

/** 找出所有需要补的条目 */
const todo = []
for (const [p, v] of Object.entries(lock.packages ?? {})) {
  if (!p || p === '') continue
  if (v.link) continue
  if (v.version) continue
  todo.push({ path: p, name: pkgNameOf(p) })
}

if (!todo.length) {
  console.log('lock 里没有空壳条目，不用补')
  process.exit(0)
}

console.log(`要补 ${todo.length} 个条目`)

let fixed = 0
const failed = []

for (const item of todo) {
  const { name, path: p } = item
  // 平台二进制包的版本永远和它的父包一致（esbuild 的发布机制就是这样）
  const parentPath = parentPathOf(p)
  const parent = parentPath ? lock.packages[parentPath] : null
  const version = parent?.version

  if (!version) {
    failed.push([name, '推不出父包版本'])
    continue
  }

  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/${version}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const meta = await res.json()
    const entry = {
      version: meta.version,
      resolved: meta.dist.tarball,
      integrity: meta.dist.integrity,
    }
    /* cpu / os —— 平台二进制靠这两个字段让 npm 跳过「本机装不上」的包。
       但**光有 cpu/os 不够**：不标 optional，npm 遇到 os 不匹配会直接
       报 `notsup Valid os: aix / Actual os: win32` 然后整个安装失败。
       这两个包在父包的 optionalDependencies 里，天生就是「装不上就算了」。*/
    if (meta.cpu) entry.cpu = meta.cpu
    if (meta.os) entry.os = meta.os
    entry.optional = true
    /* dev 跟着父包走：esbuild 是 vitest 的传递依赖 → 纯 dev。
       标错会让 `npm ci --omit=dev` 装一堆用不到的东西。*/
    if (parent.dev) entry.dev = true
    lock.packages[p] = entry
    fixed++
  } catch (e) {
    failed.push([name, e.message])
  }
}

if (failed.length) {
  console.error(`\n${failed.length} 个没补上：`)
  for (const [n, e] of failed) console.error(`  ${n}: ${e}`)
  console.error('\nlock 未写入（保持原样，避免写出一个半成品）。')
  process.exit(1)
}

writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n')
console.log(`补齐 ${fixed} 个条目`)

/* 复查一遍：不能留下任何空壳 */
const left = Object.entries(lock.packages).filter(
  ([p, v]) => p !== '' && !v.link && !v.version,
)
if (left.length) {
  console.error(`仍剩 ${left.length} 个空壳条目`)
  process.exit(1)
}
console.log('校验通过：没有空壳条目了')