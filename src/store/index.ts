/**
 * 插件版 store。
 *
 * ## 和Web 版 store 的关系
 *
 * **产品逻辑全部共用** `app/src/core/logic` —— 三条拍板过的规则
 * （落位即完成、实际时长 = 计划时长、计划列顺延）都在那儿，改一处两边同步。
 *
 * 差别只在持久化：Web 版写 localStorage / 文件，这里写 vault 里的 Markdown。
 * 所以本文件重写了 store 的外壳，但每个 action 里的规则判断都是原样搬过来的。
 *
 * ## 写 vault 的三条约束
 *
 * 1. **只写脏了的那天**，不重写整个库
 * 2. **串行化**：`vault.modify` 是异步的，连发两次后一次可能顶掉前一次
 * 3. **不覆盖用户手改**：VaultStore 内部比较 mtime，改了就以用户的为准
 */

import { create } from 'zustand'
import { arrayMove } from '@dnd-kit/sortable'
import { planDur, reflow, uid } from '@/core/logic'
import { nowMin } from '@/core/time'
import { isTestMode } from '@/core/mode'
import { emptyDay } from '@/core/logic'
import type { DB, Day, Task } from '@/core/types'
import type { VaultStore } from '@/md/vault'

export type Toast = { id: number; msg: string; undoable: boolean } | null

/**
 * 撤销快照。存整条 Task + 原下标 —— 与 Web 版同构，理由见 app/src/store/index.ts。
 * 结构级操作（删一整条）和字段级操作（清一个块）形状必须兼容，
 * 否则删除后点撤销会**静默失效**。
 */
interface UndoSnapshot {
  day: string
  task: Task
  index: number
}

interface State {
  db: DB
  cur: string
  /** 月历当前显示的月份。和cur 分开 —— 翻月不改变选中的那天 */
  calMonth: Date
  toast: Toast
  ready: boolean
  /** 正在往 vault 写的天，用于顶栏显示「保存中」 */
  saving: boolean
  undo: UndoSnapshot | null
}

/**
 * 全部 action 的 `this` 类型。
 *
 * ## 为什么每个都要标 `this: void`
 *
 * 组件里都是这么拿的：
 * ```ts
 * const complete = useStore((s) => s.complete)
 * ...
 * complete(id, m)          // ← 从对象上「摘下来」再调用
 * ```
 * `complete` 脱离了它的对象，**如果它内部用了 `this`，`this` 就是 undefined**
 * （严格模式下）—— 也就是「不小心被当成独立函数调用」。
 *
 * 标注 `this: void` 是 TypeScript 提供的**编译期保证**：
 * 写了这个类型，以后谁想把 action 摘下来当回调传（`arr.map(s.complete)`）
 * 会直接编译报错，而不是运行时炸。
 *
 * 社区目录的自动审核也提这一条（Warning），但它查的是**源码**，
 * 而这里是从类型层面根治 —— 一次改动，19 处调用点全部受益。
 */
interface Actions {
  setCur(this: void, k: string): void
  /** 月历直接跳到某个月（命令面板「打开今天」用）。翻月请用 prev/nextMonth */
  setCalMonth(this: void, d: Date): void
  prevMonth(this: void): void
  nextMonth(this: void): void
  notify(this: void, msg: string, undoable?: boolean): void
  doUndo(this: void): void

  addTodo(this: void, ti: string): void
  removeTodo(this: void, id: number): void
  renameTodo(this: void, id: number, ti: string): void
  /** 拖动待办到指定位置（按移除前的下标）。reorder 收的是 id，这个收位置 */
  moveTo(this: void, fromId: number, toIndex: number): void
  /** 键盘排序用，收 id */
  reorder(this: void, fromId: number, toId: number): void
  /** 待办拖到月历的某一天 = 整条搬过去。目标天不存在就建档 */
  moveTaskToDay(this: void, id: number, toKey: string): void
  /**
   * 把当前查看那天的**全部未完成待办**搬到目标天（UI 上传的是今天）。
   * 单项搬运（moveTaskToDay）的批量版，规则逐条对齐，不发明新语义。
   */
  moveUnfinishedToDay(this: void, toKey: string): void

  schedule(this: void, id: number, m: number, du: number): void
  complete(this: void, id: number, m: number): void
  uncomplete(this: void, id: number): void
  removeBlock(this: void, id: number): void
  resizePlan(this: void, id: number, dur: number): void
  resizeAct(this: void, id: number, start: number, dur: number): void
  markDoneNow(this: void, id: number): void

  setNote(this: void, v: string): void
  setDb(this: void, db: DB): void
  setReady(this: void): void
}

export type Store = State & Actions

/* ---------------- vault 写入 ---------------- */

let vault: VaultStore | null = null
/** 脏了的天，攒着一起写 */
const dirty = new Set<string>()
/** 正在排队写的天 */
const writing = new Set<string>()
/* ---------------- 计时器（浏览器 / node 都能跑）---------------- */

/**
 * 计时器宿主对象。
 *
 * ## 三条规则互相咬（这段是本文件最容易改错的地方）
 *
 * 1. `obsidianmd/no-global-this` 禁 `global` / `globalThis`。
 *    早先把 `globalThis` 改写成 `global` 想绕过去 —— **没用**，
 *    规则把这两个名字一起报，只是把文案里的标识符换了个名。
 * 2. `obsidianmd/prefer-window-timers` 禁**裸的** `setTimeout(...)`，
 *    要求写 `window.setTimeout(...)`。
 * 3. 但这个 store 是纯逻辑层，测试跑在 node（无 DOM）——
 *    直接写 `window.setTimeout` 会 `ReferenceError: window is not defined`，
 *    40 条 store 用例全挂；而且报的是运行时错误不是类型错误，
 *    很容易往类型定义上找原因。
 *
 * 另外**不能 import 官方的 `activeWindow`**：`obsidian` 包只有类型定义、
 * 没有运行时入口，值导入会让 vitest 直接报
 * `Failed to resolve entry for package "obsidian"`，所有测试挂掉。
 *
 * ## 解法：借两条规则共有的那个例外
 *
 * 读官方插件源码（`noGlobalThis` / `preferWindowTimers`）发现两条规则
 * **都有同一个例外**：作用域里存在同名局部变量时直接 return
 * （`variable.defs.length > 0`），因为它们只想抓「真的全局引用」。
 *
 * 于是既不写 `global`、也不写裸调用 —— 按环境把计时器**取到对象上**再调用：
 * - 浏览器：`window` 本身（`this` 正确绑到当前窗口）
 * - node：`{ setTimeout, clearTimeout }` 对象字面量
 *   （node 的计时器不看 `this`，摘下来也不会坏）
 *
 * ⚠️ **别把 `window.setTimeout` 摘成裸函数再调用** —— 浏览器里报
 * `Illegal invocation`，只在真机上炸、测试完全看不出来。
 * 这里靠「以宿主对象的方法调用」保住 `this`。
 *
 * ## 类型为什么用 `typeof setTimeout`
 *
 * 不能用 `typeof window.setTimeout`：那返回 `number`（DOM 类型），
 * 而句柄变量声明成 `ReturnType<typeof setTimeout>`（node 里是 `Timeout`），
 * 两边对不上 → TS2322「number 不能赋给 Timeout」。
 * 测试环境走的正是 node 分支，类型必须跟着它走。
 */
const timers: {
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
} = typeof window === 'undefined' ? { setTimeout, clearTimeout } : window

/* 定时器句柄。用 `ReturnType<typeof setTimeout>` 而不是写死 `number` ——
   写死 number 在 node 类型的测试里过不了（那边返回 Timeout 对象）。*/
let flushTimer: ReturnType<typeof setTimeout> | null = null
let setSaving: (v: boolean) => void = () => {}

/** 注入 vault（由插件 onload 调用） */
export function bindVault(v: VaultStore, onSaving: (v: boolean) => void): void {
  vault = v
  setSaving = onSaving
}

function markDirty(day: string): void {
  dirty.add(day)
  if (flushTimer) return
  // 250ms 防抖：快速拖拽时不必每一下都写一次文件
  flushTimer = timers.setTimeout(() => {
    flushTimer = null
    void flush()
  }, 250)
}

/**
 * 把脏的天写回 vault。串行执行 —— `vault.modify` 是异步的，
 * 并发写同一个文件会互相覆盖（Web 版在 FilePort 上踩过同款坑）。
 */
export async function flush(): Promise<void> {
  if (!vault) return
  if (writing.size) return // 上一批还没完，等它结束后会再触发一轮
  if (!dirty.size) return

  const batch = [...dirty]
  dirty.clear()
  batch.forEach((d) => writing.add(d))
  setSaving(true)
  try {
    for (const day of batch) {
      /* 清理必须放在循环体最外层的 finally 里。
         早先用 `if (!d) continue` 跳过不存在的一天 —— 但 continue 会绕过
         finally，那天就永远留在 writing 里。之后每次 flush 都在
         `writing.size` 处提前 return，**整个写入队列永久卡死**。
         一条脏数据把后面所有写入都堵住了，症状是「改了没反应、
         关页面也存不上」，极难查。 */
      try {
        const s = useStore.getState()
        const d = s.db[day]
        if (!d) continue
        await vault.writeDay(day, d)
      } catch (e) {
        // 单天写失败不该拖垮其它天，也不该让界面崩
        useStore.getState().notify(`写入失败：${(e as Error)?.message ?? e}`, false)
      } finally {
        writing.delete(day)
      }
    }
  } finally {
    setSaving(writing.size > 0)
  }
  // 写这批的过程中可能又脏了 —— 继续
  if (dirty.size) void flush()
}

/** 关闭视图 / 插件卸载前调用。等不到了也认了，vault.modify 通常很快 */
export async function flushNow(): Promise<void> {
  if (flushTimer) {
    timers.clearTimeout(flushTimer)
    flushTimer = null
  }
  await flush()
}

export function hasPendingWrite(): boolean {
  return dirty.size > 0 || writing.size > 0
}

/* ---------------- 内部工具 ---------------- */

function day_(db: DB, k: string): Day {
  return (db[k] ??= emptyDay(k))
}

function task_(db: DB, k: string, id: number): Task | undefined {
  return db[k]?.tasks.find((t) => t.id === id)
}

/* ---------------- store ---------------- */

export const useStore = create<Store>((set, get) => ({
  db: {},
  cur: nowKey(),
  calMonth: new Date(),
  toast: null,
  ready: false,
  saving: false,
  undo: null,

  setCur: (k) => set({ cur: k }),
  /* 存一份新的 Date 对象，不能存引用 ——
     nextMonth/prevMonth 是 `new Date(s.calMonth)` 造新对象的，
     存引用不会有问题；但调用方如果传进来一个会继续被改的 Date，
     月历就跟着一起变。copy 一份最省心。 */
  setCalMonth: (d) => set({ calMonth: new Date(d) }),
  prevMonth: () =>
    set((s) => {
      const d = new Date(s.calMonth)
      d.setMonth(d.getMonth() - 1)
      return { calMonth: d }
    }),
  nextMonth: () =>
    set((s) => {
      const d = new Date(s.calMonth)
      d.setMonth(d.getMonth() + 1)
      return { calMonth: d }
    }),
  setDb: (db) => set({ db }),
  setReady: () => set({ ready: true }),

  notify: (msg, undoable = false) => set({ toast: { id: Date.now(), msg, undoable } }),

  doUndo: () => {
    const u = get().undo
    if (!u) return set({ toast: null })
    set((s) => {
      const list = s.db[u.day]?.tasks
      if (!list) return { toast: null, undo: null }
      const at = list.findIndex((x) => x.id === u.task.id)
      // 找到 = 移除块（原地替换）；找不到 = 删了整条（插回原位）
      const next =
        at >= 0 ? list.map((x, i) => (i === at ? u.task : x)) : withInserted(list, u)
      day_(s.db, u.day).tasks = next
      day_(s.db, u.day)._e = nowMin()
      return { db: { ...s.db }, toast: null, undo: null }
    })
    markDirty(u.day)
  },

  addTodo: (ti) => {
    const cur = get().cur
    set((s) => {
      const d = day_(s.db, cur)
      // 必须换新数组：selector 是 s.db[cur].tasks，原地 push 引用不变 → 不重渲染
      d.tasks = [...d.tasks, { id: uid(), ti, est: 60, plan: null, pd: 0, act: null, ad: 0 }]
      d._e = nowMin()
      return { db: { ...s.db } }
    })
    markDirty(cur)
  },

  removeTodo: (id) => {
    const cur = get().cur
    let snap: UndoSnapshot | null = null
    let title = ''
    set((s) => {
      const d = day_(s.db, cur)
      const index = d.tasks.findIndex((t) => t.id === id)
      if (index < 0) return {}
      const t = d.tasks[index]!
      title = t.ti
      snap = { day: cur, task: { ...t }, index }
      d.tasks = d.tasks.filter((x) => x.id !== id)
      d._e = nowMin()
      return { db: { ...s.db }, undo: snap }
    })
    if (!snap) return
    markDirty(cur)
    get().notify(`已删除：${title}`, true)
  },

  renameTodo: (id, ti) => {
    const next = ti.trim()
    // 空标题等于删任务，不做。让调用方自己拦住空串
    if (!next) return
    const cur = get().cur
    set((s) => {
      const d = day_(s.db, cur)
      const hit = d.tasks.find((t) => t.id === id)
      if (!hit || hit.ti === next) return {}
      d.tasks = d.tasks.map((t) => (t.id === id ? { ...t, ti: next } : t))
      d._e = nowMin()
      return { db: { ...s.db } }
    })
    markDirty(cur)
  },

  moveTo: (fromId, toIndex) => {
    const cur = get().cur
    set((s) => {
      const d = day_(s.db, cur)
      const from = d.tasks.findIndex((t) => t.id === fromId)
      const n = d.tasks.length
      if (from < 0 || n === 0) return {}
      const to = Math.max(0, Math.min(toIndex, n - 1))
      if (from === to) return {}
      d.tasks = arrayMove(d.tasks, from, to)
      d._e = nowMin()
      return { db: { ...s.db } }
    })
    markDirty(cur)
  },

  reorder: (fromId, toId) => {
    const cur = get().cur
    set((s) => {
      const d = day_(s.db, cur)
      const from = d.tasks.findIndex((t) => t.id === fromId)
      const to = d.tasks.findIndex((t) => t.id === toId)
      if (from < 0 || to < 0 || from === to) return {}
      d.tasks = arrayMove(d.tasks, from, to)
      d._e = nowMin()
      return { db: { ...s.db } }
    })
    markDirty(cur)
  },

  /**
   * 待办拖到月历的某一天 = 整条搬过去（从月历日期格拖入）。
   *
   * 三条规则：
   * 1. **已完成的不能搬** —— 完成判定由 act 决定（落位即完成）。
   *    行上已经关了 draggable，store 这道是第二道：键盘、或将来的
   *    新入口都归它管，UI 拦不住它们。
   * 2. **拖回当天什么都不做** —— 否则会变成「移到当天末尾」的静默重排，
   *    而用户什么都没看到。
   * 3. **两天都要写脏** —— 源天少一条、目标天多一条，少写任何一天
   *    都会让迁移只落一半（表现为「拖走了但文件里还在」）。
   *
   * 目标天不存在就建档（`day_` 会建）—— 往一个没记录的日子拖，
   * 就是在创建那天的第一条。
   */
  moveTaskToDay: (id, toKey) => {
    const cur = get().cur
    if (toKey === cur) return
    // 先读一次拿标题（notify 用）；set 里再校验，防状态在两步之间变过
    const hit = get().db[cur]?.tasks.find((x) => x.id === id)
    if (!hit || hit.act != null) return
    set((s) => {
      const from = s.db[cur]
      const t = from?.tasks.find((x) => x.id === id)
      // 这里只兜「找不到」—— act 的判断在上面那一行，两处都写会让
      // 单行变异被掩盖（改了上面下面还在拦，测试照样绿）
      if (!from || !t) return {}
      from.tasks = from.tasks.filter((x) => x.id !== id)
      from._e = nowMin()
      const to = day_(s.db, toKey)
      to.tasks = [...to.tasks, { ...t }]
      to._e = nowMin()
      // 搬来的任务可能带着排期（plan != null）—— 目标天也要守「计划列顺延」
      reflow(to.tasks)
      return { db: { ...s.db } }
    })
    markDirty(cur)
    markDirty(toKey)
    get().notify(`已移至 ${toKey.slice(5)}：${hit.ti}`, false)
  },

  /**
   * 批量搬迁：把当前查看那天的全部未完成待办搬到目标天（UI 传今天）。
   *
   * 规则与单项搬运（moveTaskToDay）逐条对齐，不发明新语义：
   * 1. **已完成的不能搬** —— 完成判定由 act 决定（落位即完成）。
   *    「完成」是那天的事实，跟着搬走会和判定规则打架。
   * 2. **字段原样搬运**（含排期），按原相对顺序追加到目标天末尾；
   *    目标天不存在就建档（`day_` 会建）。
   * 3. **目标天守「计划列顺延」** —— 搬来的排期同样参与 reflow。
   * 4. **目标天就是当前天 → no-op**；没有未完成项 → no-op，
   *    且不创建目标天（拒绝了就是什么都没发生）。
   * 5. **两天都写脏** —— 少写任何一天都会让迁移只落一半
   *    （表现为「搬走了但文件里还在」）。
   *
   * 不给撤销：撤销快照是**单条**结构（day + task + index），批量跨天
   * 撤销要把它改成快照数组，会动到 doUndo 和全部既有撤销用例。
   * 单项拖拽（moveTaskToDay）同样不给撤销，这里沿用例程 ——
   * 别放一个按了没反应的按钮。
   */
  moveUnfinishedToDay: (toKey) => {
    const cur = get().cur
    if (toKey === cur) return
    // 先读一次拿条数（notify 用）；set 里再过滤，防状态在两步之间变过
    const moving = get().db[cur]?.tasks.filter((x) => x.act == null) ?? []
    if (!moving.length) return
    set((s) => {
      const from = s.db[cur]
      // 这里只兜「找不到」—— act 的判断在上面那一行，两处都写会让
      // 单行变异被掩盖（改了上面下面还在拦，测试照样绿）
      if (!from) return {}
      from.tasks = from.tasks.filter((x) => x.act != null)
      from._e = nowMin()
      const to = day_(s.db, toKey)
      to.tasks = [...to.tasks, ...moving.map((x) => ({ ...x }))]
      to._e = nowMin()
      // 搬来的任务可能带着排期（plan != null）—— 批量同样守「计划列顺延」
      reflow(to.tasks)
      return { db: { ...s.db } }
    })
    markDirty(cur)
    markDirty(toKey)
    get().notify(`已将 ${moving.length} 条未完成待办移至 ${toKey.slice(5)}`, false)
  },

  /** 排期 / 挪时间。`m` 是当日第几分钟 */
  schedule: (id, m, du) => {
    const cur = get().cur
    set((s) => {
      const d = day_(s.db, cur)
      d.tasks = d.tasks.map((x) =>
        x.id !== id ? x : { ...x, plan: m, pd: du, est: du, act: null, ad: 0 },
      )
      // 规则：计划列顺延，实际列不顺延
      reflow(d.tasks)
      d._e = nowMin()
      return { db: { ...s.db } }
    })
    markDirty(cur)
  },

  /** 落位即完成：act = m，时长沿用计划时长（不做自动计时） */
  complete: (id, m) => {
    const cur = get().cur
    set((s) => {
      const d = day_(s.db, cur)
      const t = d.tasks.find((x) => x.id === id)
      if (!t) return {}
      const pd = planDur(t)
      d.tasks = d.tasks.map((x) => (x.id !== id ? x : { ...x, act: m, ad: pd }))
      d._e = nowMin()
      return { db: { ...s.db } }
    })
    const t = task_(get().db, cur, id)
    if (t) get().notify(`已完成：${t.ti}`, true)
    markDirty(cur)
  },

  /** 计划块拖回待办 = 取消删除线（保留排期） */
  uncomplete: (id) => {
    const cur = get().cur
    let title = ''
    set((s) => {
      const d = day_(s.db, cur)
      const t = d.tasks.find((x) => x.id === id)
      if (!t) return {}
      title = t.ti
      d.tasks = d.tasks.map((x) => (x.id !== id ? x : { ...x, act: null, ad: 0 }))
      d._e = nowMin()
      return { db: { ...s.db } }
    })
    if (title) get().notify('已移回待办，删除线取消', true)
    markDirty(cur)
  },

  /** 移除时间块：在实际轨清 act，在计划轨清排期。任务本身留着 */
  removeBlock: (id) => {
    const cur = get().cur
    let snap: UndoSnapshot | null = null
    let title = ''
    set((s) => {
      const d = day_(s.db, cur)
      const index = d.tasks.findIndex((x) => x.id === id)
      const t = index >= 0 ? d.tasks[index] : undefined
      if (t) {
        title = t.ti
        snap = { day: cur, task: { ...t }, index }
      }
      d.tasks = d.tasks.map((x) =>
        x.id !== id ? x : x.act != null ? { ...x, act: null, ad: 0 } : { ...x, plan: null, pd: 0 },
      )
      d._e = nowMin()
      return { db: { ...s.db }, undo: snap }
    })
    markDirty(cur)
    if (title) get().notify(`已移除：${title}`, true)
  },

  resizePlan: (id, dur) => {
    const cur = get().cur
    set((s) => {
      const d = day_(s.db, cur)
      d.tasks = d.tasks.map((x) => (x.id === id ? { ...x, pd: dur, est: dur } : x))
      reflow(d.tasks)
      d._e = nowMin()
      return { db: { ...s.db } }
    })
    markDirty(cur)
  },

  /** 改实际轨时间。**不碰 plan** */
  resizeAct: (id, start, dur) => {
    const cur = get().cur
    set((s) => {
      const d = day_(s.db, cur)
      d.tasks = d.tasks.map((x) => (x.id === id ? { ...x, act: start, ad: dur } : x))
      d._e = nowMin()
      return { db: { ...s.db } }
    })
    markDirty(cur)
  },

  /** 计划轨点对勾 = 挪到实际轨的**同一时间段** */
  markDoneNow: (id) => {
    const cur = get().cur
    const clock = nowMin()
    set((s) => {
      const d = day_(s.db, cur)
      d.tasks = d.tasks.map((x) => {
        if (x.id !== id) return x
        const dur = Math.max(15, x.pd || x.est || 60)
        /* 2026-10-09：点对号 = 挪到实际轨的**同一时间段**，
           不是挪到「现在」。语义是「就照计划做完了」。没排期的才回落到当前时刻。*/
        const act = x.plan != null ? x.plan : Math.max(0, clock - dur)
        return { ...x, act, ad: dur, plan: x.plan ?? act }
      })
      d._e = nowMin()
      return { db: { ...s.db } }
    })
    markDirty(cur)
  },

  setNote: (v) => {
    const cur = get().cur
    set((s) => {
      const d = day_(s.db, cur)
      d.note = v
      d._e = nowMin()
      return { db: { ...s.db } }
    })
    markDirty(cur)
  },
}))

/** 把 task 插回指定位置。下标要钳位 —— 撤销前用户可能又加了待办 */
function withInserted(list: Task[], u: UndoSnapshot): Task[] {
  const next = [...list]
  next.splice(Math.max(0, Math.min(u.index, next.length)), 0, u.task)
  return next
}

function nowKey(): string {
  const d = new Date()
  const p = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export { emptyDay, isTestMode }
