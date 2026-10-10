/**
 * @vitest-environment jsdom
 *
 * 真机冒烟：把 LedgerView 真的挂一次。
 *
 * ## 为什么必须有这条
 *
 * 主理人装进vault 后是**空白页**。真机环境跑不到，而
 * `createRoot` 遇到渲染异常会把整棵树卸载 —— 表现就是「白屏，
 * 控制台一句报错都没有」。产物自检（require 一遍 main.js）
 * 只能证明「模块能加载」，证明不了「组件能渲染」。
 *
 * 这条测试就是补那个缺口：把视图挂到 jsdom 里，看它到底
 * 渲染出什么、抛什么错。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const here = resolve(process.cwd())
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.stubGlobal(
  'localStorage',
  (() => {
    const m = new Map<string, string>()
    return {
      length: 0,
      clear: () => m.clear(),
      getItem: (k: string) => m.get(k) ?? null,
      key: () => null,
      removeItem: (k: string) => void m.delete(k),
      setItem: (k: string, v: string) => void m.set(k, String(v)),
    }
  })(),
)

/* React 在 jsdom 里会警告一堆 act 环境问题，噪音太大盖住真错误。
   装上 IS_REACT_ACT_ENVIRONMENT 即可，这是官方推荐做法。 */
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
const K = (() => {
  const d = new Date()
  const p = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()

/** 去掉注释，只留代码 —— 断言「某字符串不该出现」时必须用。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

async function setup(state: Record<string, unknown>) {
  const { useStore, bindVault } = await import('@/store')
  const { VaultStore } = await import('@/md/vault')
  bindVault(new VaultStore({} as never), () => {})
  useStore.setState({
    cur: K,
    calMonth: new Date(),
    ready: true,
    toast: null,
    undo: null,
    saving: false,
    ...state,
  } as never)
  const { LedgerView } = await import('@/view/LedgerView')
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(<LedgerView />)
  })
  return host
}

function sampleDay() {
  return {
    [K]: {
      tasks: [{ id: 1, ti: '冒烟任务', est: 60, plan: 480, pd: 60, act: null, ad: 0 }],
      note: '冒烟复盘',
      created: K,
    },
  }
}

describe('LedgerView 真机冒烟', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    document.body.innerHTML = ''
  })

  it('挂载后能渲染出内容（不是空白页）', async () => {
    // 关键：渲染抛错是 createRoot 白屏的唯一原因
    const host = await setup({ db: sampleDay() })
    expect(host.textContent).not.toBe('')
  })


  it('渲染出待办、计划/实际两栏、备注', async () => {
    const host = await setup({ db: sampleDay() })
    const text = host.textContent ?? ''
    expect(text).toContain('待办事项')
    expect(text).toContain('冒烟任务')
    expect(text).toContain('计划完成')
    expect(text).toContain('实际完成')
    expect(text).toContain('冒烟复盘')
  })

  it('空库时也能渲染（不崩）', async () => {
    const host = await setup({ db: {} })
    expect(host.textContent).toContain('待办事项')
  })
})

  /**
   * DndContext 必须存在，否则待办拖不动且**什么都不报**。
   *
   * 实测：无 DndContext 时 `useSortable` 返回的 `listeners` 是**空对象**，
   * React 一个事件都没绑。表现是「拖拽毫无反应」，控制台干干净净。
   *
   * **变异实测**：去掉 DndContext 后，`role` / `aria-roledescription`
   * 这些 attributes 照样有（useSortable 无 context 时也返回），
   * DOM 事件也照样冒泡 —— 只看这些都抓不到。
   * 唯一可靠的信号是**产物的 draggable 行数**和**源码里有 DndContext**。
   */
  it('待办行带 draggable（跨区拖拽的把手）', async () => {
    const host = await setup({ db: sampleDay() })
    expect(host.textContent).toContain('待办事项')
    const rows = document.querySelectorAll('[data-testid="todo-list"] > div')
    expect(rows.length).toBe(1)
    expect((rows[0] as HTMLElement).getAttribute('draggable')).toBe('true')
  })

  it('LedgerView 源码里有 DndContext（搬组件时最容易漏的那层）', () => {
    const src = readFileSync(join(here, 'src', 'view', 'LedgerView.tsx'), 'utf8')
    expect(src).toContain('<DndContext')
    expect(src).toContain('</DndContext>')
  })
/**
 * 轨道高度自适应的**结构性断言**。
 *
 * 主理人报的原始问题：窗口一矮，「每日回顾」就被挤出视口 ——
 * 而回顾区是每天必填的东西，被遮挡等于功能不可用。
 *
 * 这些断言守的是「别再退回写死的值」。
 * 早先 `style={{ height: 560 }}` + `min-h-screen` 两处一起把布局钉死了，
 * 而且它们**静默失效** —— 不报错、测试全绿，只是回顾区不见了。
 */
describe('每日回顾不被遮挡（布局结构）', () => {
  const viewCode = () =>
    stripComments(readFileSync(join(here, 'src', 'view', 'LedgerView.tsx'), 'utf8'))

  it('外层用 h-screen + flex col + overflow-hidden（让内部能分配高度）', () => {
    const c = viewCode()
    expect(c).toContain('cl-root flex h-screen flex-col overflow-hidden')
    /* **不能再用 min-h-screen** —— 那样整页跟着内容变高，
       轨道拿不到「剩余空间」，自适应无从谈起。 */
    expect(c).not.toContain('min-h-screen')
  })

  it('轨道容器不再是写死的 560', () => {
    const c = viewCode()
    expect(c).not.toMatch(/height:\s*560/)
    expect(c).toContain('style={{ height: trackH }}')
  })

  it('轨道高度真的调了 trackHeight，且跟着视口变化重算', () => {
    const c = viewCode()
    expect(c).toContain('trackHeight(')
    expect(c).toContain('ResizeObserver')
    expect(c).toContain("window.addEventListener('resize'")
  })

  it('每日回顾那一段是 flex-none（不被压缩掉）', () => {
    const c = viewCode()
    /* 回顾区必须 flex-none 且不给 min-h-0 ——
       flex 子项默认 min-height:auto，内容比容器高时会撑破而不是让位。 */
    const i = c.indexOf('备注 / 每日回顾')
    expect(i).toBeGreaterThan(-1)
    expect(c.slice(Math.max(0, i - 400), i)).toContain('flex-none')
  })

  it('Sheet 有 flex flex-col + min-h-0（否则内部的 flex-none 无效）', () => {
    const ui = stripComments(readFileSync(join(here, 'src', 'ui', 'index.tsx'), 'utf8')).slice(0, 1200)
    expect(ui).toContain('flex flex-col')
    /* min-h-0 同样必需 —— flex 子项默认 min-height:auto，
       内容比容器高时撑破容器，轨道高度就算错了。 */
    expect(ui).toContain('min-h-0')
  })

  it('滚动到「现在」的偏移从实测高度算，不是写死的 240', () => {
    const src = stripComments(readFileSync(join(here, 'src', 'components', 'TimeGutter.tsx'), 'utf8'))
    expect(src).not.toMatch(/yT\(m\)\s*-\s*240/)
    expect(src).toContain('clientHeight')
  })

  it('轨道上下限是导出的常量（数值验算在 track-height.test.ts）', () => {
    const src = readFileSync(join(here, 'src', 'components', 'TimeGutter.tsx'), 'utf8')
    expect(src).toContain('export const TRACK_MIN')
    expect(src).toContain('export const TRACK_MAX')
  })
})
