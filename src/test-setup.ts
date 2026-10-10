/**
 * jsdom 缺的东西的集中补齐。
 *
 * ## ResizeObserver
 *
 * **jsdom 不实现 ResizeObserver** —— 构造器不存在，
 * `new ResizeObserver(...)` 直接抛 `ReferenceError`。
 *
 * 轨道高度自适应靠它实测固定开销（待办几条、回顾多长都影响），
 * 所以没有它整个 LedgerView 挂不起来 —— 表现为冒烟测试全部报
 * 「ResizeObserver is not defined」，而真机上完全正常。
 *
 * stub 的 `observe` **什么都不做**（不立刻回调）：真实浏览器里
 * ResizeObserver 是异步回调的。测试要的是「能挂载」，
 * 高度算得对不对由 `track-height.test.ts` 负责。
 *
 * ## 为什么只补缺的
 *
 * jsdom 大部分 API 是有的。先判断存在性再装 ——
 * 覆盖掉本来能工作的实现只会引入新的偏差。
 *
 * 注意这个文件走 setupFiles，**对 `environment: 'node'` 的测试也生效**，
 * 那儿没有 `window`，所以每项都要判断。
 */

const g = globalThis as unknown as Record<string, unknown>

if (typeof g.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {
      /* 刻意不回调 —— 真实实现是异步的 */
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  g.ResizeObserver = ResizeObserverStub
}

const hasWindow = typeof window !== 'undefined'

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
