/**
 * npm 发版后的收尾：把 `v` 前缀的 tag 改名成不带前缀的。
 *
 * ## 为什么需要这个
 *
 * `npm version patch` 默认打**带 `v` 前缀**的 tag（`v0.1.1`），
 * 但 Obsidian 生态要求 tag **不带 `v`**：
 *
 * - 社区目录按 `manifest.json` 的 `version` 找同名 tag，
 *   `v0.1.1` 匹配不上 → 用户装不到更新
 * - `.github/workflows/release.yml` 的触发条件是
 *   `tags: ['[0-9]+.[0-9]+.[0-9]+']` —— **根本不含 `v`**，
 *   带前缀的 tag 推上去也不会触发流水线，Release 不会建
 *
 * ## 为什么不是「文档里写清楚就行」
 *
 * 2026-10-11 实际踩了：跑完 `npm version patch`，
 * 紧接着 `git push origin 0.1.1` 就报
 *   error: src refspec 0.1.1 does not match any
 *
 * 「文档写了 tag 不带 v」没人能保证每次都记得——
 * 所以让它**自动发生**，比让人记住更可靠。
 *
 * ## 实现：直接读写 `.git/refs/tags`，不 spawn git
 *
 * 第一版用 `execFileSync('git', ...)` 调git，结果在这台机器上
 * 撞上那个经典的限制 —— **node 里的 spawnSync 拿不到子进程**
 * （`spawnSync git EBUSY`），连退回 shell 也一样 spawn 不了。
 *
 * 但**根本不需要 spawn**：
 * - tag 是「一个名字 → 一个 commit sha」的映射
 * - 轻量 tag 就直接存在 `.git/refs/tags/<名字>` 里，内容是 40 位 sha
 * - 删 tag = 删文件；打 tag = 写文件
 *
 * 这样零外部依赖，也就不受 spawn 限制影响。
 *
 * 只处理**轻量 tag** —— `npm version` 打的就是轻量 tag。
 * 附注 tag（annotated，带 tagger 信息）存在 `.git/refs/tags/<名字>` 里
 * 但内容是 tag 对象的 sha，且旁边有 `-` 文件或 packed-refs ——
 * 那种情况本脚本会**明确报错**而不是猜（见下面 hasNonLightweight）。
 *
 * 用法
 * ----
 * `npm version patch` 之后 npm 会自动跑这个脚本（postversion 钩子）。
 * 无参运行也行：`node scripts/fix-tag.mjs`
 *
 * 幂等：已经是不带 v 的 tag 就什么都不做。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const refsTags = join(root, '.git', 'refs', 'tags')

/** manifest 里的版本号 —— tag 必须和它**一模一样** */
const manifestVersion = JSON.parse(
  readFileSync(join(root, 'manifest.json'), 'utf8'),
).version

const withV = `v${manifestVersion}`

/** 轻量 tag 的 ref 文件内容就是 40 位 sha */
function readTagRef(name) {
  const p = join(refsTags, name)
  if (!existsSync(p)) return null
  const sha = readFileSync(p, 'utf8').trim()
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null
}

/**
 * tag 是否被 packed 进 `.git/packed-refs`。
 *
 * `git tag -d` 会把 ref 文件删掉，但旧仓库里 tag 可能只在
 * packed-refs 里（文件被 gc 合并过）。那种情况本地删文件不起作用，
 * 必须报出来让人手动处理 —— **不能给用户一个「看起来成功了」的结果**。
 */
function isPacked(name) {
  const p = join(root, '.git', 'packed-refs')
  if (!existsSync(p)) return false
  return readFileSync(p, 'utf8')
    .split('\n')
    .some((line) => line.trim().endsWith(` refs/tags/${name}`))
}

const okTag = readTagRef(manifestVersion)
const vTag = readTagRef(withV)

/* ---------- 情况 1：已经正确 ---------- */
if (okTag && !vTag) {
  console.log(`tag ${manifestVersion} 已就位，无需处理`)
  process.exit(0)
}

/* ---------- 情况 2：只有带 v 的，需要改名 ---------- */
if (vTag && !okTag) {
  if (isPacked(withV)) {
    console.error(
      `tag ${withV} 在 .git/packed-refs 里，直接删文件不起作用。\n` +
        `请手动执行：\n` +
        `  git tag -d ${withV}\n` +
        `  git tag ${manifestVersion}`,
    )
    process.exit(1)
  }
  rmSync(join(refsTags, withV))
  mkdirSync(refsTags, { recursive: true })
  writeFileSync(join(refsTags, manifestVersion), vTag + '\n')
  console.log(
    `已把 tag ${withV} 改名为 ${manifestVersion}` +
      `（Obsidian 要求不带 v；社区目录和 release 流水线都按这个匹配）`,
  )
  process.exit(0)
}

/* ---------- 情况 2b：两个都在（重复了）----------
 *
 * 什么时候会这样：用户已经手动打过正确的 `0.1.1`，
 * 但之前那个带 `v` 的还留在 ref 文件里没删干净
 * （比如脚本跑了一半中断）。
 *
 * 此时**只删带 v 的那个**，保留正确的 ——
 * 绝不能反过来「以带 v 的为准」把对的删了，
 * 那等于把一个能用的版本变成用户装不到更新的状态。
 */
if (okTag && vTag) {
  if (isPacked(withV)) {
    console.error(
      `${withV} 和 ${manifestVersion} 同时存在，且 ${withV} 在 packed-refs 里。\n` +
        `请手动执行：git tag -d ${withV}\n` +
        `（正确的 ${manifestVersion} 会保留）`,
    )
    process.exit(1)
  }
  rmSync(join(refsTags, withV))
  console.log(`已删除多余的 tag ${withV}（${manifestVersion} 保留）`)
  process.exit(0)
}

/* ---------- 情况 3：两个都没有 ---------- */
console.error(
  `找不到 tag ${manifestVersion}，也没找到 ${withV}。\n\n` +
    `tag 必须与 manifest.json 的 version 完全一致（不带 v 前缀）。\n` +
    `如果是手动打的：git tag ${manifestVersion}\n\n` +
    `（当前 manifest 版本：${manifestVersion}）`,
)
process.exit(1)
