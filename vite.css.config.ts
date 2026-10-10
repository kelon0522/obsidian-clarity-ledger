/**
 * 样式单独构建：src/index.css → styles.css
 *
 * ## 为什么 CSS 走 Vite 而 JS 走 esbuild
 *
 * Tailwind v4 **没有独立 CLI**，它是一个 Vite 插件（`@tailwindcss/vite`）。
 * Obsidian 插件要求 `main.js` + `styles.css` 两个文件，
 * 所以这里借 Vite 产出 CSS，esbuild 产出 JS。
 *
 * `styles.css` 放在插件根目录，Obsidian 会自动加载 —— 官方机制，
 * 不用在 main.js 里 import。
 *
 * ## 为什么 root 不再抬到上一级
 *
 * 早先插件和 Web 版共用组件，Tailwind 的 `@source` 必须指向仓库外的
 * `app/src/components`，而**指向 Vite root 之外的目录会被静默忽略** ——
 * 不报错、不警告，产物从 31 KB 掉到 9 KB，只剩变量壳，界面完全没有样式。
 * 当时被迫把 root 抬到仓库根绕开。
 *
 * 独立仓库后所有被扫的目录都在自己的 src 下，默认 root 就够 ——
 * 那套 workaround 连同它的静默失败风险一起消失了。
 */

import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    outDir: path.join(here, '.css-build'),
    emptyOutDir: true,
    lib: false,
    css: {
      // Obsidian 加载的是 styles.css，名字要固定，不带 hash
      outputFilename: 'styles.css',
    },
    rollupOptions: {
      input: path.join(here, 'src', 'index.css'),
    },
  },
})
