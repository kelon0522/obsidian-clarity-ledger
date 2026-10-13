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
   装上 IS_REACT_ACT_ENVIRONMENT 即可，这是官方推荐做法。
   挂 `window` 而不是 `global` —— 这个文件是 jsdom 环境，
   而 `obsidianmd/no-global-this` 连 `global` 一起报。 */
;(window as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

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

/** 一条没做完 + 一条已完成（act != null）—— 拖拽规则的两个面都要有 */
function dragDay() {
  return {
    [K]: {
      tasks: [
        { id: 1, ti: '没做完的', est: 60, plan: null, pd: 0, act: null, ad: 0 },
        { id: 2, ti: '做完了的', est: 60, plan: 480, pd: 60, act: 480, ad: 60 },
      ],
      note: '',
      created: K,
    },
  }
}

/** 这个月里不等于今天的另一天（月历默认显示本月，目标格一定在） */
function otherDayKey(): string {
  const t = new Date()
  const d = t.getDate() > 1 ? 1 : 2
  const p = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(d)}`
}

/** 月历上某一天的按钮（按格子里显示的数字找；箭头钮不是数字，不会误中） */
function dayCell(k: string): HTMLElement {
  const d = Number(k.slice(8))
  // Array.from 而不是展开 —— tsconfig 没开 DOM.Iterable，NodeList 不能 spread
  const cells = Array.from(document.querySelectorAll('.cl-cal button'))
  const hit = cells.find((b) => b.textContent?.trim() === String(d))
  if (!hit) throw new Error(`月历上找不到 ${k} 的日期格`)
  return hit as HTMLElement
}

/** 伪造 DataTransfer —— jsdom 不实现它，原生 DnD 的落盘测试全靠这个 */
function fakeDT() {
  const store: Record<string, string> = {}
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (k: string, v: string) => {
      store[k] = String(v)
    },
    getData: (k: string) => store[k] ?? '',
  }
}

/**
 * 派发一个会冒泡的拖拽事件。
 * React 18 把监听器挂在根容器上，**不冒泡就收不到** ——
 * cancelable 也要开，否则处理器里的 preventDefault 是空操作。
 */
function fireDrag(el: Element, type: string, dataTransfer: unknown) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  ;(e as unknown as Record<string, unknown>).dataTransfer = dataTransfer
  el.dispatchEvent(e)
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
 * 待办拖拽规则（2026-10-13 新增）：
 * 1. 已完成（act != null）的待办不能拖
 * 2. 未完成的待办可以拖到月历的日期格上 = 整条搬到那天
 *
 * ## 为什么用派发事件而不是只查 DOM 属性
 *
 * 「draggable=false」只证明**开关**关了，证明不了**链路**是通的：
 * payload 通道、日期格的 dragover/drop、store 的搬迁，任何一环断了
 * 都表现为「拖了没反应」。这里把整条链路真的跑一遍。
 */
describe('待办拖拽规则（已完成不可拖 / 可拖到月历日期格）', () => {
  /* 清理必须和第一个 describe 一样 —— 少了它，上一个用例挂着的 root
     不会卸载，host 会越积越多（querySelectorAll 会数到别人的行）。 */
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    document.body.innerHTML = ''
  })

  it('已完成的待办行 draggable=false，未完成的仍是 true', async () => {
    await setup({ db: dragDay() })
    const rows = document.querySelectorAll('[data-testid="todo-list"] > div')
    expect(rows).toHaveLength(2)
    expect((rows[0] as HTMLElement).getAttribute('draggable')).toBe('true')
    expect((rows[1] as HTMLElement).getAttribute('draggable')).toBe('false')
    expect(rows[1]!.getAttribute('aria-label')).toContain('已完成，不能拖动')
  })

  it('对已完成的行派发 dragstart 也不建立拖拽通道', async () => {
    await setup({ db: dragDay() })
    const { getDragPayload } = await import('@/dnd/shared')
    const rows = document.querySelectorAll('[data-testid="todo-list"] > div')
    act(() => fireDrag(rows[1]!, 'dragstart', fakeDT()))
    expect(getDragPayload()).toBeNull()
  })

  it('拖未完成待办到月历日期格 = 整条搬到那天', async () => {
    const K2 = otherDayKey()
    await setup({ db: dragDay() })
    const { useStore } = await import('@/store')
    const { getDragPayload } = await import('@/dnd/shared')
    const row = document.querySelector('[data-testid="todo-list"] > div') as HTMLElement
    const cell = dayCell(K2)
    const dt = fakeDT()

    act(() => fireDrag(row, 'dragstart', dt))
    act(() => fireDrag(cell, 'dragover', dt))
    // 悬停反馈：目标格拿到 drop 高亮
    expect(cell.className).toContain('drop')

    act(() => fireDrag(cell, 'drop', dt))
    const db = useStore.getState().db
    expect(db[K]!.tasks.map((t) => t.ti)).toEqual(['做完了的'])
    expect(db[K2]!.tasks.map((t) => t.ti)).toEqual(['没做完的'])
    // 字段原样搬过去，id 不变（id 是改名 / 撤销的锚点）
    expect(db[K2]!.tasks[0]).toMatchObject({ id: 1, ti: '没做完的', est: 60 })

    // 拖完要清理通道 —— 不清的话下一次拖拽会读到上一个的残留
    act(() => fireDrag(row, 'dragend', dt))
    expect(getDragPayload()).toBeNull()
  })

  it('拖回今天的日期格：不给高亮，也不重排', async () => {
    await setup({ db: dragDay() })
    const { useStore } = await import('@/store')
    const row = document.querySelector('[data-testid="todo-list"] > div') as HTMLElement
    const cell = dayCell(K)
    const dt = fakeDT()

    act(() => fireDrag(row, 'dragstart', dt))
    act(() => fireDrag(cell, 'dragover', dt))
    expect(cell.className).not.toContain('drop')
    act(() => fireDrag(cell, 'drop', dt))
    // 原地不动 —— 不是「移到当天末尾」
    expect(useStore.getState().db[K]!.tasks.map((t) => t.id)).toEqual([1, 2])
    act(() => fireDrag(row, 'dragend', dt))
  })

  it('拖动中源行半透明（opacity-40），松手后恢复', async () => {
    await setup({ db: dragDay() })
    const row = document.querySelector('[data-testid="todo-list"] > div') as HTMLElement
    const dt = fakeDT()

    act(() => fireDrag(row, 'dragstart', dt))
    expect(row.className).toContain('opacity-40')
    act(() => fireDrag(row, 'dragend', dt))
    expect(row.className).not.toContain('opacity-40')
  })

  /**
   * 回归（2026-10-13 主理人截图：移过来的那条是灰字）。
   *
   * 高亮曾经存在 TodoList 的模块变量里、靠行的 onDragEnd 清 —— 而跨天
   * 搬运在 drop 瞬间就把源行卸载了，dragend 到不了根容器，那个 id
   * 永远留着。之后打开目标天，这条待办一挂载就带 opacity-40。
   *
   * **判据挑的是 opacity-40 而不是颜色值**：灰字是半透明的视觉结果，
   * 不是 `text-dim`（那是已完成的灰，会同时带 ✓ 圈号和删除线）。
   */
  it('拖到别的日期后，目标天那条待办不是灰色（不带半透明）', async () => {
    const K2 = otherDayKey()
    await setup({ db: dragDay() })
    const { useStore } = await import('@/store')
    const row = document.querySelector('[data-testid="todo-list"] > div') as HTMLElement
    const cell = dayCell(K2)
    const dt = fakeDT()

    act(() => fireDrag(row, 'dragstart', dt))
    act(() => fireDrag(cell, 'dragover', dt))
    act(() => fireDrag(cell, 'drop', dt))

    // 切到目标天 —— 「移过来的」那条应该正常显示
    act(() => useStore.getState().setCur(K2))
    const rows = document.querySelectorAll('[data-testid="todo-list"] > div')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('没做完的')
    expect(rows[0]!.className).not.toContain('opacity-40')
    // 圈号还是数字（不是 ✓）—— 灰不是「已完成」那个灰
    expect(rows[0]!.textContent).not.toContain('✓')
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
 * 每日回顾不被遮挡 —— **布局结构的禁止性断言**。
 *
 * ## 这组断言经历过一次失败
 *
 * 上一版（用 JS 算高度）8 条断言全绿，而真机上回顾区被挤出视口、
 * 轨道底部拖不到。原因不在断言写得不够多，而在**方向错了**：
 *
 *     轨道越高 → 主区 clientHeight 越小 → 算出的轨道越矮 → 反过来
 *
 * 主区自己就是 flex-1，而它的 clientHeight 正是用轨道高度算出来的。
 * 那条 expect(...toContain("trackHeight(")) 甚至**主动要求了这个自反馈** ——
 * 断言从守门变成了帮凶。
 *
 * ## 所以现在守的是「不许出现 JS 测量」
 *
 * 「自适应」的正确做法是 flex-1，剩余空间由布局引擎分配。
 * 一旦自己动手算，就会出现「算出来的值反过来影响被测量的东西」。
 *
 * **这类 bug 的形态：不报错、测试全绿、真机坏掉。**
 * 断言必须是禁止性的（不许有 ResizeObserver），
 * 而不是存在性的（要调用 trackHeight）。
 */
describe('每日回顾不被遮挡（布局结构）', () => {
  const viewCode = () =>
    stripComments(readFileSync(join(here, 'src', 'view', 'LedgerView.tsx'), 'utf8'))

  it('轨道高度交给 CSS flex（flex-1 min-h-0），不用 JS 算', () => {
    expect(viewCode()).toContain('relative flex-1 min-h-0')
  })

  /**
   * **核心断言：不许自己测高度。**
   *
   * data-cl-main 那套「实测视口减主区高度」的自反馈就是这么来的。
   * 这条断言的意义是：**下一个人想「优化」成 JS 精确计算时，
   * 会先撞到它，然后读到上面那段注释。**
   */
  it('不许用 ResizeObserver / 事件监听自己测高度（自反馈会收敛到错值）', () => {
    const c = viewCode()
    expect(c).not.toContain('ResizeObserver')
    expect(c).not.toContain("addEventListener('resize'")
    expect(c).not.toContain('trackHeight(')
    /* 上一版用来测量的 data-cl-main 标记也不能要 ——
       有了它就很容易写出「读主区高度 → 算轨道高度」这种代码。 */
    expect(c).not.toContain('data-cl-main')
  })

  it('外层用 h-screen + flex col + overflow-hidden（让内部能分配高度）', () => {
    const c = viewCode()
    expect(c).toContain('cl-root flex h-screen flex-col overflow-hidden')
    /* **不能再用 min-h-screen** —— 那样整页跟着内容变高，
       轨道拿不到「剩余空间」，自适应无从谈起。 */
    expect(c).not.toContain('min-h-screen')
  })

  it('轨道上下限用 CSS 声明，不用计算值', () => {
    const c = viewCode()
    expect(c).toContain('minHeight: TRACK_MIN')
    expect(c).toContain('maxHeight: TRACK_MAX')
    /* 不能再有写死的数字高度 */
    expect(c).not.toMatch(/height:\s*\d\d\d/)
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
       内容比容器高时撑破容器，轨道就抢不到该给回顾区的空间。 */
    expect(ui).toContain('min-h-0')
  })

  it('滚动到「现在」的偏移从实测高度算，不是写死的 240', () => {
    const src = stripComments(readFileSync(join(here, 'src', 'components', 'TimeGutter.tsx'), 'utf8'))
    expect(src).not.toMatch(/yT\(m\)\s*-\s*240/)
    /* clientHeight 是**读**，不是「算完再设」——
       读容器实际高度来定位滚动位置不存在自反馈。 */
    expect(src).toContain('clientHeight')
  })

  it('trackHeight 函数已删除（它鼓励自反馈）', () => {
    const src = readFileSync(join(here, 'src', 'components', 'TimeGutter.tsx'), 'utf8')
    expect(src).not.toContain('export function trackHeight')
    // 上下限常量留着 —— CSS 里要用
    expect(src).toContain('export const TRACK_MIN')
    expect(src).toContain('export const TRACK_MAX')
  })
})
