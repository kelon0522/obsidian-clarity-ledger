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

/**
 * 找出所有需要补的条目。
 *
 * ## 两类坏条目，症状不同
 *
 * **A. 连 version 都没有**（`{}` 空壳）
 *   22 个 esbuild 平台二进制。`npm ci` 报 `TypeError: Invalid Version`
 *   （arborist 的 canDedupe 里 `new SemVer(undefined)`）。
 *
 * **B. 有 version，但缺 `resolved` / `integrity`**
 *   ```
 *   { "version": "4.0.2", "dev": true, "optional": true, "peer": true, ... }
 *   ```
 *   npm 装这类包（`@csstools/css-tokenizer`）要解析 peer 依赖元数据，
 *   受限环境里拿不到，于是这两个字段整个缺失。
 *   症状不同：报的是
 *     `Missing: @csstools/css-tokenizer@4.0.2 from lock file`
 *   而**本地 npm install 会悄悄把它补上** → 「本地好好的、CI 挂了」。
 *
 * 早先只处理 A，B 漏了 —— 于是「lock 看着完整（version 都在）」
 * 但 `npm ci` 照样失败。判据因此不能只看 `!v.version`。
 *
 * **C. 缺整条平台条目**（本机平台的兄弟条目根本没被收录）
 *   ```
 *   lock 里只有：lightningcss-win32-x64-msvc
 *   但它声明了 11 个平台：linux-x64-gnu / darwin-arm64 / …
 *   ```
 *   症状：`npm ci` **在这台机器上完全正常**（装的是本机平台那份），
 *   但 CI 跑在 Ubuntu 上 →
 *     `Error: Cannot find module '../lightningcss.linux-x64-gnu.node'`
 *   然后 esbuild/vite 打包失败。
 *
 *   C 与 A/B 的区别：A/B 是「条目在但字段缺」，C 是「条目根本不在」——
 *   同一个 `lock:fix` 必须一起处理，否则「本机绿的、CI 红的」没完。
 */
const todo = []
for (const [p, v] of Object.entries(lock.packages ?? {})) {
  if (!p || p === '') continue
  if (v.link) continue
  // A：连 version 都没有
  if (!v.version) {
    todo.push({ path: p, name: pkgNameOf(p), why: '缺 version' })
    continue
  }
  // B：有 version 但没 resolved —— 装不了（npm ci 会认为 lock 不同步）
  // registry 直接给的包（`https://registry.npmjs.org/...`）才需要 resolved；
  // 少数条目靠 `link` 或本地路径，那类已在上面对掉。
  if (!v.resolved && !v.link) {
    todo.push({ path: p, name: pkgNameOf(p), version: v.version, why: '缺 resolved/integrity' })
  }
}

/* ---------- C：补齐缺失的平台二进制条目 ----------
 *
 * 遍历所有声明了 `optionalDependencies` 的包，把lock 里缺失的兄弟平台加进去。
 *
 * 判据：某包的 optionalDependencies 里列了 N 个平台，
 * 而 lock 的 `node_modules/` 下只收录了其中一部分 → 缺的那部分就是 C 类。
 *
 * 只处理「同名 + 看起来是平台后缀」的 optional 依赖
 * （esbuild-* / lightningcss-* / @rollup/rollup-* / @esbuild/* / @napi-rs/lzma-*），
 * 避免把普通的可选功能依赖（fsevents 之类）也塞进去 ——
 * 那些是**故意不给某些平台装**的，加进 lock 反而会让 npm ci 报错。
 *
 * ⚠️ `@napi-rs/lzma-` 是 2026-10-11 补进来的，**漏了它导致社区目录一直不过**：
 * `rollup` 的 optionalDependencies 里有 `@napi-rs/lzma-linux-x64-gnu`
 * （rollup 在 Linux 上用它做 brotli 压缩），
 * 而 **npm 10 不会把它写进 lock、npm 11 会** ——
 * 社区目录的 runner 默认 Node 24（npm 11），跑 `npm install` 时发现少这一条，
 * 就报「The npm lockfile is out of date」。
 * 这条正则漏了它，C 类复查自然也就查不出来。*/
const PLATFORM_SUFFIX =
  /^(?:@(?:esbuild|rollup)\/rollup-|@esbuild\/|@napi-rs\/lzma-|lightningcss-|esbuild-|rollup-|@swc\/core-|@tailwindcss\/oxide-)/

for (const [p, entry] of Object.entries(lock.packages ?? {})) {
  if (!entry?.optionalDependencies) continue
  const parentName = pkgNameOf(p)

  for (const [optName, optVer] of Object.entries(entry.optionalDependencies)) {
    if (typeof optVer !== 'string' || !PLATFORM_SUFFIX.test(optName)) continue

    // 顶层路径：跟父包同级（多数情况）或挂在父包自己的 node_modules 下
    const candidates = [`node_modules/${optName}`, `${p}/node_modules/${optName}`]
    if (candidates.some((c) => lock.packages[c])) continue

    // 只补一个位置：顶层。嵌套位置 npm 会自己解析。
    todo.push({
      path: `node_modules/${optName}`,
      name: optName,
      version: optVer,
      why: '缺整条平台条目（C）',
      dev: entry.dev,
      from: parentName,
    })
  }
}

if (!todo.length) {
  console.log('lock 里没有坏条目，不用补')
  process.exit(0)
}

console.log(`要补 ${todo.length} 个条目`)

let fixed = 0
const failed = []

for (const item of todo) {
  const { name, path: p } = item
  /* 版本从三处取（优先级从高到低）：
     1. 条目自带（情况 B）
     2. 父包（情况 A：平台二进制与父包同版本）
     3. 都没有 → 只能从 registry 取该包的全部版本，取最新的 —— 有风险，
     所以宁可报错也不猜。 */
  let version = item.version ?? lock.packages[parentPathOf(p)]?.version
  if (!version) {
    failed.push([name, '推不出版本号'])
    continue
  }

  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/${version}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const meta = await res.json()

    if (item.why === '缺 resolved/integrity') {
      /* 情况 B：**就地补字段，不整条替换**。
         这些条目身上有 `peer: true`、`dev: true`、`engines` 等字段 ——
         整条覆盖会把它们抹掉，npm 重新计算 peer 依赖树，
         结果 lock 依然「不同步」。
         尤其 `peer: true` 抹掉后，npm 会认为它是个普通依赖。 */
      const cur = lock.packages[p]
      cur.resolved = meta.dist.tarball
      cur.integrity = meta.dist.integrity
      // 有可能连 tarball 都缺（少数包），补上
      if (!cur.version) cur.version = meta.version
      fixed++
      continue
    }

    /* 情况 A（空壳）与 C（缺整条）：都按 registry 元数据重建。 */
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
       标错会让 `npm ci --omit=dev` 装一堆用不到的东西。
       C 类的 dev 从声明它的那一层拿（父包可能不存在于顶层）。*/
    if (item.dev ?? lock.packages[parentPathOf(p)]?.dev) entry.dev = true
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

/* ---------- 复查：两类坏条目都要清掉 ----------
   只查「缺 version」是不够的 —— 早先就是漏了缺 resolved 那类，
   lock 看着完整（version 都在）而 `npm ci` 照样报 Missing。 */
const stillBroken = Object.entries(lock.packages).filter(([p, v]) => {
  if (p === '' || v.link) return false
  if (!v.version) return true
  if (!v.resolved) return true
  return false
})

if (stillBroken.length) {
  console.error(`\n仍剩 ${stillBroken.length} 个坏条目：`)
  for (const [p, v] of stillBroken.slice(0, 10)) {
    console.error(`  ${p} → version=${v.version ?? '(无)'} resolved=${v.resolved ?? '(无)'}`)
  }
  process.exit(1)
}

/* C 类复查：声明了平台二进制的包，lock 里必须**每一个平台都有条目**。
   漏一个的表现是「本机绿的、CI 红的」—— 本机装的是本机平台那份，
   别的平台那条根本没进lock，于是构建时报
   `Cannot find module '../xxx.linux-x64-gnu.node'`。 */
const missingPlatform = []
for (const [p, entry] of Object.entries(lock.packages)) {
  if (!entry?.optionalDependencies) continue
  for (const [optName, optVer] of Object.entries(entry.optionalDependencies)) {
    if (typeof optVer !== 'string' || !PLATFORM_SUFFIX.test(optName)) continue
    const has = lock.packages[`node_modules/${optName}`] || lock.packages[`${p}/node_modules/${optName}`]
    if (!has) missingPlatform.push(`${pkgNameOf(p)} → 缺 ${optName}@${optVer}`)
  }
}
if (missingPlatform.length) {
  console.error(`\n还有 ${missingPlatform.length} 个平台条目没进 lock：`)
  for (const m of missingPlatform.slice(0, 12)) console.error(`  ${m}`)
  console.error('\n（CI 会在别的平台上失败：Cannot find module ...）')
  process.exit(1)
}

console.log('校验通过：所有条目都有 version + resolved，且平台二进制齐全')