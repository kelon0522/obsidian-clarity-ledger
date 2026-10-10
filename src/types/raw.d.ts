/**
 * Vite 的 `?raw` 导入类型。
 *
 * 测试里想读源码/样式原文做断言（比如「全局 CSS 里不能有
 * overscroll-behavior: none」），但装 @types/node 装不上 ——
 * 用 Vite 自带的 ?raw 导入绕开 node:fs，类型也要补上。
 */
declare module '*?raw' {
  const content: string
  export default content
}
