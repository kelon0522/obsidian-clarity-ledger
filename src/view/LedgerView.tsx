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

import { useEffect, useRef } from 'react'
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
import { GUTTER, TimeGutter, useScrollToNow } from '@/components/TimeGutter'
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onSortEnd}
      modifiers={[restrictToParentElement]}
    >
    <div className="cl-root min-h-screen text-sm leading-relaxed">
      {/* 状态条。故意做得很轻 —— Obsidian 里不需要第二个顶栏 */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-rule2 text-[12px] text-dim">
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
        <div className="px-4 py-8 text-dim2">
          <Hw>正在读取 vault…</Hw>
        </div>
      ) : (
        <div className="flex gap-4 px-4 pt-4 pb-14 max-w-[1180px] mx-auto items-start">
          <Calendar />
          <Sheet>
            <div className="flex items-baseline gap-3.5 flex-wrap pb-2.25">
              <Hw className="ml-auto text-xl text-ink tracking-widest">待办事项</Hw>
            </div>

            <TodoList />

            <div className="flex items-baseline gap-3.5 flex-wrap pt-6 pb-2.25">
              <Hw className="flex-1 text-center text-lg text-ink tracking-widest">计划完成</Hw>
              <Hw className="flex-1 text-center text-lg text-ink tracking-widest">实际完成</Hw>
            </div>

            {/* 整条轴共用一个滚动容器，刻度列与两栏天然对齐 */}
            <div className="relative">
              <div ref={scroller} className="overflow-y-auto overflow-x-hidden thin" style={{ height: 560 }}>
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
            <div className="flex">
              <span className="flex-none" style={{ width: GUTTER }} />
              <div className="flex-1 min-w-0">
                <TrackFooter zone="p" />
              </div>
              <div className="flex-1 min-w-0">
                <TrackFooter zone="a" />
              </div>
            </div>

            <div className="pt-6">
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
