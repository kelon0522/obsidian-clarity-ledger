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
 * 轨道滚动容器的视口高度分配。
 *
 * ## 为什么要自适应
 *
 * 原来是写死的 560px。窗口一矮，下面的「每日回顾」就被挤出视口 ——
 * 而回顾区是每天必填的东西，**被遮挡等于功能不可用**。
 *
 * ## 高度怎么来的：**纯 CSS flex，不用 JS 算**
 *
 * 轨道容器是 `flex-1 min-h-0`，由布局引擎分配剩余空间 ——
 * 待办区、轨道标题、列脚、回顾区各按内容高度，剩下的全给轨道。
 * 这就是「自适应」，不需要任何测量。
 *
 * ## 为什么不能自己算（踩过一次）
 *
 * 早先的写法是：ResizeObserver 实测「视口高 − 固定开销」，
 * 再把算出的值当轨道高度。**但主区自己就是 `flex-1`**——
 * 它的 `clientHeight` 取决于轨道有多高。于是形成自反馈：
 *
 * ```
 * 轨道越高 → 主区 clientHeight 越小 → 算出的轨道越矮 → 反过来
 * ```
 *
 * 收敛到了一个错误的值：回顾区被挤出视口，轨道底部（00:00）拖不到。
 * **看起来是「算错了」，实际是「不该算」。** CSS flex 没有这个问题。
 *
 * ## 上下限
 *
 * - **上限 620**（CSS `max-height`）：24 小时只有 960px，
 *   再高轨道里就有大片空白，而时间块的**垂直位置**（几点在什么高度）
 *   按`ROWH` 算 —— 容器比内容高时，块不会跟着下移，刻度就对不上了
 * - **下限 280**（CSS `min-height`）：窗口很矮时轨道仍然能用
 *   （看得见几个小时），剩下的靠滚动。回顾区不能挤掉，轨道可以
 */
export const TRACK_MIN = 280
export const TRACK_MAX = 620

/**
 * 默认滚动到当前时间。
 * 2026-10-09：轴改成 0 点起、24 小时共 960px，一屏放不下，
 * 所以打开时要把「现在」这条线滚进视野。
 *
 * **偏移量从容器实测高度算**（`clientHeight` 的一半再减一点），
 * 不能写死 —— 容器已经改成自适应了，写死的话窗口一变就滚偏。
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
    // 容器高度的 42% —— 让「现在」落在靠上位置，下方留出更多视野看后面几小时
    const offset = ref.current.clientHeight * 0.42
    ref.current.scrollTop = Math.max(0, yT(m) - offset)
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