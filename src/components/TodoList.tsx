/**
 * 待办池。顺序即优先级，圈号跟随，每行两条。
 *
 * 拖拽分两个目的，**全部走原生 HTML5 DnD**：
 * - 区内排序：拖到别的行上，落点按鼠标在行的上半/下半决定插前还是插后
 * - 拖到轨道：拖到时间轴，落点是 Y 坐标
 *
 * 为什么不用 @dnd-kit 做指针拖拽（2026-10-09踩过的坑）：
 * dnd-kit 的 `PointerSensor` 一旦激活，就会在**每次 pointermove 上调
 * `preventDefault`**（见 @dnd-kit/core 的 AbstractPointerSensor.handleMove）。
 * 这是有效的默认行为抑制，会让浏览器**不再发起原生 `dragstart`** ——
 * 于是原生拖拽彻底失灵，表现为「待办拖不到计划轨」。
 *
 * 早先的版本是「圈号挂 dnd-kit listeners、整行挂 draggable」，两条路各走各的，
 * 互不干扰，所以能用。但那只支持「拖圈号排序、拖文字跨区」，不一致。
 * 现在统一到原生 DnD：整行任意位置按下都能排序，也能拖到轨道。
 *
 * **dnd-kit 只保留键盘支持**（空格拾起 / 方向键 / 空格放下）——
 * 它的 KeyboardSensor 走 keydown，不碰 pointermove，不影响原生拖拽。
 */
import { useEffect, useRef, useState } from 'react'
import { SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KeyboardEventHandler } from 'react'
import { finished } from '@/core/logic'
import type { Task } from '@/core/types'
import { useStore } from '@/store'
import { Hw } from '@/ui'
import { getDragPayload, setDragPayload } from '@/dnd/shared'

const EMPTY: Task[] = []

/** 正在被拖的 id。只为了样式（半透明），存在组件里不进 store */
let draggingId: number | null = null
const dragListeners = new Set<() => void>()
const notifyDrag = () => dragListeners.forEach((f) => f())

function useDraggingId(): number | null {
  const [id, setId] = useState<number | null>(draggingId)
  useEffect(() => {
    const fn = () => setId(draggingId)
    dragListeners.add(fn)
    return () => {
      dragListeners.delete(fn)
    }
  }, [])
  return id
}

/**
 * 算「拖到某一行之后，该插到第几位」。
 *
 * @param after 落在目标行的下半部分 = 插到它后面
 * @returns 移除被拖项之后的数组里的下标；自身或找不到时返回 null
 *
 * 注意返回的是**位置**不是 id，要配 `store.moveTo` 用。
 *（别拿它去调 `reorder` —— 那个收 id，传位置会 findIndex 返回 -1 静默失效）
 */
function insertIndex(tasks: Task[], fromId: number, targetId: number, after: boolean): number | null {
  const from = tasks.findIndex((t) => t.id === fromId)
  if (from < 0 || fromId === targetId) return null
  const without = tasks.filter((t) => t.id !== fromId)
  const pos = without.findIndex((t) => t.id === targetId)
  if (pos < 0) return null
  return after ? pos + 1 : pos
}

/**
 * 取当前拖的 id。优先读模块变量，丢了就退回 DataTransfer。
 * 排序只需要 id，不用知道来源，所以不用Track 那套来源反推。
 */
function dragIdOf(e: React.DragEvent): number | null {
  const p = getDragPayload()
  if (p) return p.id
  const n = Number(e.dataTransfer.getData('text/plain'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 行内改标题。
 *
 * 为什么不弹框：标题就在那一行，弹框会把视线拉到屏幕中间，还得回来核对。
 * 直接把它换成 input，原地改最省事。
 *
 * 交互：双击标题进入。回车 / 失焦确认，Esc 取消。
 * 空内容**视为取消**而不是删除 —— 「清空标题」和「删掉这条待办」是两件事，不能混。
 */
function TitleCell({ t }: { t: Task }) {
  const renameTodo = useStore((s) => s.renameTodo)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(t.ti)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const done = finished(t)

  const commit = () => {
    setEditing(false)
    const s = draft.trim()
    if (s && s !== t.ti) renameTodo(t.id, s)
    else setDraft(t.ti)
  }

  const cancel = () => {
    setEditing(false)
    setDraft(t.ti)
  }

  if (editing) {
    return (
      <span className="flex-1 min-w-0 flex">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') cancel()
          }}
          onBlur={commit}
          /*
           * 整行带 draggable，三件都要拦，否则一按就是拖块：
           *  - mousedown  → 不拦的话浏览器把整行当拖拽源，input 里选不了字
           *  - dragstart  → 双保险
           *  - draggable  → 显式关掉，告诉浏览器这个元素不可拖
           */
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => e.preventDefault()}
          draggable={false}
          aria-label={`修改标题，当前 ${t.ti}`}
          className="w-full min-w-0 font-hw text-[14.5px] text-text px-1 py-0
                     border-none border-b border-ink bg-transparent
                     focus:outline-none"
        />
      </span>
    )
  }

  return (
    /* 用裸span 而不是 <Hw>：Hw 的 props 只声明了 children/className/style，
       传不进 onDoubleClick。字体用 font-hw 手写一份。*/
    <span
      onDoubleClick={() => {
        setDraft(t.ti)
        setEditing(true)
      }}
      title="双击可改"
      className={`flex-1 min-w-0 font-hw text-[14.5px]
        ${done ? 'text-dim line-through decoration-ink decoration-[1.6px]' : 'text-text'}`}
    >
      {t.ti}
    </span>
  )
}

function Row({ t, index }: { t: Task; index: number }) {
  const removeTodo = useStore((s) => s.removeTodo)
  const moveTo = useStore((s) => s.moveTo)
  const tasks = useStore((s) => s.db[s.cur]?.tasks ?? EMPTY)
  const dragging = useDraggingId()

  /* 落点提示：插在目标行上面还是下面。用上下边框表示，不用绝对定位——
     两列网格里绝对定位容易被 overflow 裁掉。

     **必须同时用 ref 和 state**：ref 给事件读（同步、最新），state 只驱动样式。
     只用 state 的话，dragover → drop 之间组件还没重渲染，drop 读到的是
     上一次的 hint —— 快速拖动时落点会算错（变异测试能抓到）。*/
  const [hint, setHint] = useState<'before' | 'after' | null>(null)
  const hintRef = useRef<'before' | 'after' | null>(null)
  const setHintBoth = (v: 'before' | 'after' | null) => {
    hintRef.current = v
    setHint(v)
  }

  /* 只取键盘那部分。onPointerDown 必须丢掉：它会激活 PointerSensor，
     而 PointerSensor 每次 pointermove 都 preventDefault，会掐死原生拖拽。*/
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: t.id })
  const onKeyDown = listeners?.onKeyDown as KeyboardEventHandler<HTMLElement> | undefined

  const overRow = (e: React.DragEvent<HTMLElement>) => {
    const id = dragIdOf(e)
    if (id == null || id === t.id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    setHintBoth(e.clientY < r.top + r.height / 2 ? 'before' : 'after')
  }

  const dropRow = (e: React.DragEvent<HTMLElement>) => {
    // 行内命中了就别让容器那个「拖到末尾」的兜底也跑
    e.stopPropagation()
    e.preventDefault()
    const id = dragIdOf(e)
    const h = hintRef.current
    setHintBoth(null)
    if (id == null || !h) return
    const to = insertIndex(tasks, id, t.id, h === 'after')
    if (to != null) moveTo(id, to)
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      onKeyDown={onKeyDown}
      draggable
      onDragStart={(e) => {
        setDragPayload({ id: t.id, from: 'todo' })
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(t.id))
        draggingId = t.id
        notifyDrag()
      }}
      onDragEnd={() => {
        setDragPayload(null)
        draggingId = null
        setHintBoth(null)
        notifyDrag()
      }}
      onDragOver={overRow}
      onDrop={dropRow}
      /*
       * 不在 dragleave 时清提示。
       * dragleave 会在指针扫过子元素（圈号 / 文字 / ✕）时反复触发 ——
       * 一清就把刚落点算没了，drop 时读不到 hint，排序不生效。
       * 真正该清的是 dragend（拖完统一清），那里已经处理了。
       */
      style={{ transform: CSS.Translate.toString(transform), transition }}
      role="button"
      tabIndex={0}
      aria-label={`第 ${index + 1} 优先级：${t.ti}。拖动可调整顺序，也可拖到下方轨道`}
      className={`group flex items-start gap-2 rounded px-1 py-0.75 relative cursor-grab select-none
        ${dragging === t.id ? 'opacity-40' : 'hover:bg-ink/5'}
        ${hint === 'before' ? 'border-t-2 border-ink' : ''}
        ${hint === 'after' ? 'border-b-2 border-ink' : ''}`}
    >
      <span
        aria-hidden
        className={`inline-block w-4.5 h-4.5 rounded-full border-[1.4px] text-[11px] leading-4 text-center
                    font-hw mt-px flex-none
          ${finished(t) ? 'bg-ink text-white border-ink' : 'border-ink2 text-ink2'}`}
      >
        {finished(t) ? '✓' : index + 1}
      </span>

      <TitleCell t={t} />

      <button
        type="button"
        onClick={() => removeTodo(t.id)}
        /* 整行带 draggable，按钮必须自己拦，否则点 ✕ 会拖走整行 */
        onMouseDown={(e) => e.stopPropagation()}
        draggable={false}
        aria-label={`删除待办：${t.ti}`}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 flex-none text-xs text-dim2 hover:text-ink cursor-pointer"
      >
        ✕
      </button>
    </div>
  )
}

export function TodoList() {
  const tasks = useStore((s) => s.db[s.cur]?.tasks ?? EMPTY)
  const moveTo = useStore((s) => s.moveTo)
  const addTodo = useStore((s) => s.addTodo)
  const [v, setV] = useState('')

  const submit = () => {
    const s = v.trim()
    if (s) {
      addTodo(s)
      setV('')
    }
  }

  /** 拖到空白处 = 放到末尾。行都命中时不会走到这里（行里 stopPropagation 了） */
  const dropAtEnd = (e: React.DragEvent) => {
    e.preventDefault()
    const id = dragIdOf(e)
    if (id == null || !tasks.length) return
    const from = tasks.findIndex((t) => t.id === id)
    if (from < 0 || from === tasks.length - 1) return
    moveTo(id, tasks.length - 1)
  }

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-1">
        <Hw className="text-ink2 text-xs">顺序即优先级</Hw>
        <Hw className="text-dim2 text-xs">拖动整行调整顺序 · 双击文字可改</Hw>
      </div>

      {/* 两列排布 → rectSortingStrategy，横向也能换位。
          单列时的 restrictToVerticalAxis 在这里会锁死横向，不能用。*/}
      <SortableContext items={tasks.map((t) => t.id)} strategy={rectSortingStrategy}>
        <div
          className="grid grid-cols-2 gap-x-5 gap-y-0.5 py-0.5 min-h-10 max-sm:grid-cols-1"
          data-testid="todo-list"
          onDragOver={(e) => {
            /* 空 preventDefault 是为了让行外的区域也能接住，
               否则拖到最后一行下面会变成禁止放置的光标。*/
            if (getDragPayload()) e.preventDefault()
          }}
          onDrop={dropAtEnd}
        >
          {tasks.map((t, i) => (
            <Row key={t.id} t={t} index={i} />
          ))}
        </div>
      </SortableContext>

      {!tasks.length && (
        <Hw className="text-[13px] text-dim2 px-1 py-2">还没有待办，下面加一条</Hw>
      )}

      <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-dashed border-rule2">
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="加一条今天的重要待办，回车确认"
          aria-label="新增待办"
          className="flex-1 font-hw text-sm px-2.5 py-1 border-none border-b border-rule2 bg-transparent
                     focus:outline-none focus:border-ink"
        />
        <Hw>
          <button type="button" onClick={submit} aria-label="添加待办" className="text-ink text-[15px] px-1.5">
            ＋
          </button>
        </Hw>
      </div>
    </div>
  )
}