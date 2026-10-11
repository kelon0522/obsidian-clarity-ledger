/**
 * jsdom 缺的东西的集中补齐。
 *
 * ## 这个文件为什么要到处判断 `window` 在不在
 *
 * 它走 `setupFiles`，**对 `environment: 'node'` 的测试也生效** ——
 * 而默认环境就是 node（见 `vitest.config.ts`），
 * 只有顶部写了 `@vitest-environment jsdom` 的文件才有 DOM。
 * 所以每项都先判断 `typeof window`。
 *
 * ⚠️ **别用 `global` / `globalThis` 绕这个判断。**
 * 这里曾经写过 `typeof window === 'undefined' ? global : window`，
 * 理由是「node 环境下也要拿到全局对象」。但官方规则
 * `obsidianmd/no-global-this` **把 `global` 一起报**（文案是
 * 「Avoid using 'global'. Use 'window' or 'activeWindow'」）——
 * 换来换去只是把报的标识符从 `globalThis` 改成 `global`，
 * 审核那条 Warning 一次都没消掉。
 *
 * 正确的心态是：**没有 `window` 就说明这个环境根本不需要补 DOM**，
 * 那就不补。需要全局对象的地方写 `window`。
 *
 * ## 曾经补过 ResizeObserver，已删
 *
 * 早先这里装过一个 `ResizeObserver` stub —— 轨道高度自适应靠它
 * 实测「视口高 − 固定开销」。后来高度改成 CSS flex 算（`flex-1 min-h-0`），
 * 全仓库再没有一处用 ResizeObserver，`ledger.smoke.test.tsx` 里那条
 * 「view 源码不许出现 ResizeObserver」的断言就是那次改动的守卫。
 * 死掉的 stub 留着只会让人以为还在用。
 */

const hasWindow = typeof window !== 'undefined'

/* jsdom 各个版本对 `matchMedia` 的支持不一样，时有时无 ——
   先判断存在性再装。覆盖掉本来能工作的实现只会引入新的偏差。 */
if (hasWindow && typeof window.matchMedia === 'undefined') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/**
 * 可控的视口高度。
 *
 * jsdom 的 `window.innerHeight` 默认 1024，但**只读** ——
 * 轨道高度那组测试要模拟不同窗口，需要能改。
 * `configurable: true` 才能 defineProperty 覆盖。
 */
if (hasWindow && window.innerHeight === 0) {
  Object.defineProperty(window, 'innerHeight', {
    value: 1024,
    writable: true,
    configurable: true,
  })
}
