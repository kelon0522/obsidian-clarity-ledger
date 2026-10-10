/**
 * 时间轴刻度列。计划轨与实际轨共用一条，渲染在两栏**左侧外部**。
 *
 * 2026-10-09：原来每个块自带「08:00–09:30」文字，与横格时间刻度重叠、
 * 也和标题文字抢地方。现在把刻度抽出来单独成列，块内只留
 * 时长【1:30】，不再和文字条打架。
 *
 * 整条轴（刻度 + 两栏）共用一个滚动容器，所以刻度天然与内容对齐。
 */
import { useLayoutEffect, useRef } from 'react'
import { D1, D0, ROWH, fmt, nowMin, yT } from '@/core/time'

/** 刻度列宽度。轨道内容从这之后开始，块不会压到刻度上 */
export const GUTTER = 46

/** 轨道内容的左内边距 = 刻度列宽度 */
export const GUTTER_PAD = { paddingLeft: GUTTER }

/** 刻度列总高度 = 一天的像素高度，轨道与刻度同高 */
export const AXIS_HEIGHT = yT(D1) + ROWH

/**
 * 默认滚动到当前时间。
 * 2026-10-09：轴改成 0 点起、24 小时共 960px，一屏放不下，
 * 所以打开时要把「现在」这条线滚进视野中央附近。
 * 只在挂载时做一次，之后不打扰用户自己的滚动。
 */
export function useScrollToNow(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const done = useRef(false)

  useLayoutEffect(() => {
    if (done.current || !ref.current) return
    done.current = true
    const m = nowMin()
    if (m <= D0 || m >= D1) return
    const target = yT(m) - 240 // 视口高 560，留点余量
    ref.current.scrollTop = Math.max(0, target)
  }, [dep])

  return ref
}

export function TimeGutter() {
  return (
    <div
      aria-hidden
      className="relative flex-none border-r border-rule2"
      style={{ width: GUTTER }}
    >
      {Array.from({ length: (D1 - D0) / 60 }, (_, i) => D0 + i * 60).map((m) => (
        <span
          key={m}
          className="absolute right-1.5 font-hw text-[10.5px] text-dim2 -translate-y-1/2 tabular-nums"
          style={{ top: yT(m) }}
        >
          {fmt(m)}
        </span>
      ))}
    </div>
  )
}