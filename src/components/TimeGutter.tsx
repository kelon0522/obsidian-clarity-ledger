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
 * ## 分配方式
 *
 * 视口高 − 上下固定开销（状态条 + 待办区 + 表头 + 回顾区 + 边距），
 * 再用 `clamp` 卡在 **[最短 280, 最长 620]**：
 *
 * - 上限 620：窗口很高时不让轨道无限拉长 —— 24 小时只有 960px，
 *   再高轨道里就有大片空白，而时间块的**垂直位置**（几点在什么高度）
 *   是按 `ROWH` 算的，容器和内容不等高时块与刻度会错位
 * - 下限 280：窗口很矮时轨道仍然能用（看得见几个小时），
 *   剩下的靠滚动 —— 回顾区不能挤掉，轨道可以
 *
 * ## 为什么用 JS 算而不是 CSS
 *
 * 需要把「视口高度 − 实际元素高度」喂给 CSS，而实际高度只有渲染后才知道
 * （待办几条、回顾写了多长都不一样）。CSS 拿不到这些。
 * 用 ResizeObserver 盯着，窗口变、待办增减、回顾变长，都会重算。
 */
export const TRACK_MIN = 280
export const TRACK_MAX = 620

/**
 * 算轨道容器该多高。
 *
 * @param available 视口总高度
 * @param reserved  上下固定部分占掉的总高度（由调用方实测）
 */
export function trackHeight(available: number, reserved: number): number {
  return Math.max(TRACK_MIN, Math.min(TRACK_MAX, available - reserved))
}

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