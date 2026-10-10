import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * 早先这个配置里有两样东西，现在都不需要了 ——
 *
 * 1. **单例锁**（react / react-dom / @dnd-kit 强制从本地 node_modules 解析）
 *    那是为「和 Web 版共用一份源码、两份 node_modules」准备的。
 *    esbuild 按**路径**去重，两条路径就算两个模块 → react 被打两份 →
 *    hook 找不到 dispatcher → `Cannot read properties of null (reading 'useRef')`
 *    → createRoot 卸载整棵树 → **真机白屏，控制台只在 dev 模式报错**。
 *    独立仓库后只有一份 node_modules，前提消失，锁没必要。
 *
 * 2. **顺序尝试的 alias resolver**（先查插件 src、再落到 app/src）
 *    Vite 的 `resolve.alias` 一条命中就直接替换、没有 fallback，
 *    所以当年是自己写 `resolveId` 按序试。现在只有一种来源，
 *    官方 alias 就够。
 *
 * 顺带一个仍然生效的配置：`fileParallelism: false` + `singleFork`。
 * vitest 遇 Windows 上偶发的 EPERM 会少跑文件却仍报 passed，
 * 退出码0 —— 环境给的「假绿」。串行跑能规避。
 */
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: path.join(here, 'src') + '/' }],
  },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    fileParallelism: false,
    singleFork: true,
    /**
     * jsdom 缺 `ResizeObserver`（轨道高度自适应要用它实测固定开销）。
     * setupFiles 对**所有**测试文件生效，包括 `environment: 'node'` 的那些 ——
     * 那个环境下没有 `window`，所以 stub 里每项都先判断存在性。
     */
    setupFiles: ['src/test-setup.ts'],
  },
})
