import { useEffect, useRef } from 'react'
import { fmt, hm } from '@/core/time'
import { summary } from '@/core/logic'
import { useStore } from '@/store'
import type { Task } from '@/core/types'
import { Hw } from '@/ui'

/**
 * 稳定的空数组引用。
 * selector 里写 `?? []` 会每次返回新数组，Zustand v5 走 useSyncExternalStore，
 * 引用一变就判定「状态变了」→ 无限重渲染 → 白屏。
 * （踩过一次：当天没有记录时 `?? []` 正好命中）
 */
const EMPTY: Task[] = []

export function Note() {
  const note = useStore((s) => s.db[s.cur]?.note ?? '')
  const setNote = useStore((s) => s.setNote)
  const tasks = useStore((s) => s.db[s.cur]?.tasks ?? EMPTY)
  const edited = useStore((s) => s.db[s.cur]?._e)
  const ref = useRef<HTMLTextAreaElement>(null)

  // 切换日期时同步 textarea（受控之外还要处理 DOM 值）
  useEffect(() => {
    if (ref.current && ref.current.value !== note) ref.current.value = note
  }, [note])

  const s = summary(tasks)

  return (
    <div className="mt-4 pt-3.5 border-t-2 border-ink">
      <div className="flex items-baseline gap-3 mb-1.75">
        <Hw className="text-lg text-ink tracking-widest">每日回顾</Hw>
        <Hw className="text-[13.5px] text-dim flex-1">想法、总结、下一步</Hw>
        <Hw className="text-lg text-ink tracking-widest">备注</Hw>
      </div>

      <textarea
        ref={ref}
        defaultValue={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="今天做了什么、哪里偏离了、明天怎么调…"
        aria-label="每日回顾"
        className="w-full min-h-[70px] border-none bg-transparent resize-y font-hw text-[15px] leading-6
                   focus:outline-none ruled !bg-none"
        style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 24px, var(--color-rule) 24px, var(--color-rule) 25px)' }}
      />

      <div className="flex items-center gap-2.75 mt-3.5 pt-2.25 border-t border-dashed border-rule2 font-hw text-xs text-dim2 flex-wrap">
        <Hw className="text-[12.5px] text-dim2">兑现</Hw>
        <Hw className="border-[1.4px] border-ink2 rounded-full px-2.5 py-px text-ink2 text-[13px]">
          {s.done} / {s.total}
        </Hw>
        <Hw className="text-[12.5px] text-dim2">计划占用</Hw>
        <Hw className="text-[12.5px] text-dim2">{hm(s.planMin)}</Hw>
        <Hw className="text-[12.5px] text-dim2">|</Hw>
        <Hw className="text-[12.5px] text-dim2">实际占用</Hw>
        <Hw className="text-[12.5px] text-dim2">{hm(s.actMin)}</Hw>
        <Hw className="text-[12.5px] text-dim2">|</Hw>
        <Hw className="text-[12.5px] text-dim2">准点率</Hw>
        <Hw className="text-[12.5px] text-dim2">
          {s.total ? `${Math.round((s.done / s.total) * 100)}%` : '—'}
        </Hw>
        <span className="flex-1" />
        <Hw className="text-[12.5px] text-dim2">{edited ? `编辑于 ${fmt(edited)}` : '—'}</Hw>
      </div>
    </div>
  )
}