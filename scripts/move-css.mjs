/**
 * Vite 把 CSS 产出到临时目录（避免和 main.js 混在一起），
 * 移回插件根目录 —— Obsidian 只会读插件根下的 styles.css。
 *
 * 文件名可能带 hash，所以**按内容找 .css 而不是按固定名字**。
 */
import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(new URL('.', import.meta.url)))
const buildDir = join(here, '.css-build')

function findCss(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      const hit = findCss(p)
      if (hit) return hit
    } else if (name.endsWith('.css')) {
      return p
    }
  }
  return null
}

if (!existsSync(buildDir)) {
  console.error(`找不到 ${buildDir}，CSS 构建没成功`)
  process.exit(1)
}
const from = findCss(buildDir)
if (!from) {
  console.error('CSS 构建产物里没有 .css 文件')
  process.exit(1)
}
renameSync(from, join(here, 'styles.css'))
rmSync(buildDir, { recursive: true, force: true })
console.log('styles.css 已就位')
