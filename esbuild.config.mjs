import esbuild from 'esbuild'
import process from 'node:process'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Obsidian 插件构建。
 *
 * 产物是**单个** `main.js`（CommonJS），不能有动态 import、不能有外部 chunk
 * —— Obsidian 只认这一个文件。
 *
 * 关键配置：
 * - `external: ['obsidian', 'electron', ...builtins]` Obsidian 运行时提供这些，
 *   不能打包进去。**react / react-dom 不在 external 里** —— 要打进去，
 *   共享一份 React 实例，避免和用户的其他插件打架
 * - `format: 'cjs'` Obsidian 只加载 CommonJS
 * - `target: 'es2018'` Obsidian 内置 Electron 的下限
 * - `jsx: 'automatic'` 与 vitest 对齐。不配的话 esbuild 默认 `transform` 模式，
 *   产物里是 `React.createElement(...)`，而组件只 `import { useState }`，
 *   作用域里没有 `React` 绑定 → `ReferenceError: React is not defined`。
 *   **只在真机渲染时炸**，构建退出码是 0、产物大小也正常。
 *
 * ## 为什么这里没有 React 单例锁
 *
 * 早先这个插件和 Web 版放在同一个仓库、两份 node_modules，
 * esbuild 按**路径**去重 → react 被打成两份 → 一份的 hook 在另一份的
 * dispatcher 上跑 → `Cannot read properties of null (reading 'useRef')`
 * → createRoot 卸载整棵树 → **真机白屏，且控制台只在 dev 模式报错**。
 * @dnd-kit 同病，两份 DndContext 让拖拽完全不响应。
 *
 * 那次靠一份手写 resolver 锁死解析路径绕过去了。现在拆成独立仓库、
 * 只有一份 node_modules，**问题的前提不存在了，锁也就没必要了**。
 * `scripts/verify-build.mjs` 仍会查重复打包，那是回归防线。
 */
const production = process.argv[2] === 'production'

const context = await esbuild.context({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  alias: { '@': path.join(here, 'src') },
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    /* Node 内置模块清单。
       原先 import 自 `builtin-modules` 这个包，官方审核提了
       「should be replaced with an alternative package」——
       而它替代品就是 Node 自带的 `module.builtinModules`（Node 18+）。
       **少一个依赖少一份 lock 条目**，这个包只在这个构建脚本里用，
       换成内置的直接从 node:module 取，连安装都不用了。*/
    ...builtinModules,
  ],
  jsx: 'automatic',
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  metafile: true,
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  minify: production,
  outfile: 'main.js',
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
})

if (production) {
  const r = await context.rebuild()
  // metafile 是模块清单，scripts/verify-build.mjs 靠它查重复打包
  if (r.metafile) writeFileSync('.meta.json', JSON.stringify(r.metafile))
  process.exit(0)
} else {
  await context.watch()
}
