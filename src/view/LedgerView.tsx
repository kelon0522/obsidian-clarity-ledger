/**
 * 插件的界面外壳。
 *
 * 组件全部**复用 Web 版的**（`app/src/components`），不复制一份。
 * 做法是构建时把 `@` 别名指到插件的 store，`@/core` 指向共享的纯逻辑：
 * 组件里写 `import { useStore } from '@/store'` 会自动绑到 vault 版，
 * 三条产品决策也就自动一致。
 *
 * 顶栏不做：Obsidian 自带命令面板、ribbon、设置页，再加一条反而重复。
 * 顶上的日期 / 保存状态用一条极简的状态条代替。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToParentElement } from '@dnd-kit/modifiers'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { GUTTER, TimeGutter, trackHeight, useScrollToNow } from '@/components/TimeGutter'
import { Calendar } from '@/components/Calendar'
import { Note } from '@/components/Note'
import { TodoList } from '@/components/TodoList'
import { Track, TrackFooter } from '@/components/Track'
import { Toast } from '@/components/Toast'
import { WEEK, parseK } from '@/core/time'
import { Sheet, Hw } from '@/ui'
import { useStore } from '@/store'

/**
 * DndContext —— **必须有，否则待办拖不动**。
 *
 * 没有它的时候 `useSortable` 返回的 `listeners` 是**空对象**：
 * React 一个事件都没绑，`onPointerDown` / `onKeyDown` 全是 undefined。
 * 表现是「拖拽完全没反应」，而且**不报错、不警告**（实测确认）。
 *
 * 漏掉它的原因：搬组件时只搬了叶子节点，忘了外面那层 Provider。
 *
 * 只挂 KeyboardSensor —— 指针拖拽全走原生 HTML5 DnD。
 * 挂PointerSensor 会掐死原生 dragstart（`handleMove` 里对 pointermove
 * 调 preventDefault），那是「待办拖不到轨道」的第一层原因。
 *
 * ⚠️ `useSensors` / `useSensor` **必须在组件体内调用** —— 它们内部用
 * `useMemo`。早先写在模块顶层（组件外），报
 * `Cannot read properties of null (reading 'useMemo')`。
 * Hooks 规则：任何 use* 开头的东西都不能在组件外跑。
 */

export function LedgerView() {
  const sensors = useSensors(useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const cur = useStore((s) => s.cur)
  const saving = useStore((s) => s.saving)
  const ready = useStore((s) => s.ready)
  const d = parseK(cur)
  const scroller = useScrollToNow(cur)
  const toastMount = useRef<HTMLDivElement>(null)

  const reorder = useStore((s) => s.reorder)

  const onSortEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    reorder(active.id as number, over.id as number)
  }

  /* ---------- 轨道高度自适应 ---------- */
  // 需要「视口高 − 固定开销」，而固定开销只有渲染后才知道
  //（待办几条、回顾写了多长都影响）。用 ResizeObserver 盯住外层。
  const rootRef = useRef<HTMLDivElement>(null)
  const [trackH, setTrackH] = useState(560)

  const measure = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    // 固定开销 = 视口高 − 主区实际高。主区是 flex:1，会吃掉剩余空间，
    // 所以它的 clientHeight 天然等于「视口 − 上下固定部分」。
    const avail = window.innerHeight
    const main = root.querySelector<HTMLElement>('[data-cl-main]')
    const reserved = main ? Math.max(0, avail - main.clientHeight) : 360
    setTrackH(trackHeight(avail, reserved))
  }, [])

  useLayoutEffect(() => {
    measure()
    // 窗口缩放 / 面板拖动都会改视口尺寸
    window.addEventListener('resize', measure)
    const root = rootRef.current
    // 待办增减、回顾变长 → 固定开销变了，轨道要跟着让位
    const ro = root ? new ResizeObserver(measure) : null
    if (ro && root) ro.observe(root)
    return () => {
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [measure, ready])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onSortEnd}
      modifiers={[restrictToParentElement]}
    >
    <div ref={rootRef} className="cl-root flex h-screen flex-col overflow-hidden text-sm leading-relaxed">
      {/* 状态条。故意做得很轻 —— Obsidian 里不需要第二个顶栏 */}
      <div className="flex-none flex items-center gap-3 px-4 py-1.5 border-b border-rule2 text-[12px] text-dim">
        <Hw className="text-ink2">
          {d.getFullYear()}.{d.getMonth() + 1}.{d.getDate()}
        </Hw>
        <Hw className="text-dim2">星期{WEEK[d.getDay()]}</Hw>
        <span className="flex-1" />
        {saving ? (
          <Hw className="text-dim2">写入 vault…</Hw>
        ) : (
          <Hw className="text-dim2">数据存在 清晰力/ 文件夹</Hw>
        )}
      </div>

      {!ready ? (
        <div className="flex-1 px-4 py-8 text-dim2">
          <Hw>正在读取 vault…</Hw>
        </div>
      ) : (
        /* 主区占满剩余高度，把空间让给内部的轨道容器 */
        <div
          data-cl-main
          className="flex-1 min-h-0 flex gap-4 px-4 pt-4 pb-4 max-w-[1180px] w-full mx-auto items-stretch"
        >
          <Calendar />
          <Sheet>
            <div className="flex-none flex items-baseline gap-3.5 flex-wrap pb-2.25">
              <Hw className="ml-auto text-xl text-ink tracking-widest">待办事项</Hw>
            </div>

            <TodoList />

            <div className="flex-none flex items-baseline gap-3.5 flex-wrap pt-6 pb-2.25">
              <Hw className="flex-1 text-center text-lg text-ink tracking-widest">计划完成</Hw>
              <Hw className="flex-1 text-center text-lg text-ink tracking-widest">实际完成</Hw>
            </div>

            {/* 整条轴共用一个滚动容器，刻度列与两栏天然对齐。
                高度由视口自适应算出（见 trackHeight），
                clamp 在 [280, 620]：窗口矮时轨道让位给回顾区。 */}
            <div className="relative flex-none" style={{ height: trackH }}>
              <div ref={scroller} className="h-full overflow-y-auto overflow-x-hidden thin">
                <div className="flex">
                  <TimeGutter />
                  <div className="flex-1 min-w-0">
                    <Track zone="p" />
                  </div>
                  <div className="relative flex-1 min-w-0">
                    {/* 中缝：工字格的核心，两栏塌了产品就没了 */}
                    <div aria-hidden className="absolute left-0 top-0 bottom-0 w-0.5 bg-ink -translate-x-1/2" />
                    <Track zone="a" />
                  </div>
                </div>
              </div>
            </div>

            {/* 列脚汇总排在滚动容器外，不跟着滚 */}
            <div className="flex-none flex">
              <span className="flex-none" style={{ width: GUTTER }} />
              <div className="flex-1 min-w-0">
                <TrackFooter zone="p" />
              </div>
              <div className="flex-1 min-w-0">
                <TrackFooter zone="a" />
              </div>
            </div>

            {/* 每日回顾。flex-none + 不给 min-h-0 ——
                高度由内容决定，不参与压缩，所以轨道再高也不会把它挤没 */}
            <div className="flex-none">
              <Hw className="text-ink2 text-xs">备注 / 每日回顾</Hw>
              <Note />
            </div>
          </Sheet>
        </div>
      )}

      <div ref={toastMount}>
        <Toast />
      </div>
    </div>
    </DndContext>
  )
}

/** 打开视图时滚到「现在」。与 Web 版同一个 hook，行为一致 */
export function useNowScroll(enabled: boolean) {
  const scroller = useScrollToNow(useStore.getState().cur)
  useEffect(() => {
    if (enabled) scroller.current?.scrollIntoView()
  }, [enabled])
}
