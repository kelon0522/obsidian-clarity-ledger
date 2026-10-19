/**
 * 跨区拖拽的数据通道。
 *
 * 背景：曾经待办区用 @dnd-kit（指针事件），轨道用原生 HTML5 DnD，
 * 两套体系不通 —— 待办拖不到轨道，计划也拖不到实际。
 * 现在统一到 dnd-kit，这个模块负责把「正在拖什么」传给 droppable 目标。
 *
 * 为什么不用 store：拖拽过程每秒触发几十次，进 store 会让全App 重渲染。
 * 用模块级变量 + 订阅回调，droppable 只需在 onDragOver 时读一次。
 */
import type { Zone } from '@/core/types'

export type DragFrom = 'todo' | 'plan' | 'actual'

export interface DragPayload {
  id: number
  from: DragFrom
}

let current: DragPayload | null = null

/**
 * 落点提示：拖到哪一行、插在它前面还是后面（待办区那条红条）。
 *
 * 为什么和 payload 一样放模块级、而不是每行一个 useState：
 * 它天生是**全局唯一**的 —— 一次拖拽只有一个落点。曾经它是 Row 的
 * 私有 state，清理只有「命中行的 drop」和「源行的 dragend」两条路，
 * 于是：
 * - 把行 1 拖到行 3 上（行 3 亮红条），再拖回原处松手（命中行 1 自己，
 *   源行 dragend）→ 行 3 永远收不到通知，红条留在那儿（2026-10-19 截图）；
 * - 从行 3 横移到行 5 → 行 3 的红条也下不来，两条同时亮。
 *
 * 现在它跟通道同生同灭：`setDragPayload(null)`（dragend / 各 drop 里的
 * 显式清理 / 源行被卸载时的兜底）会把 hint 一起清掉。
 */
export type DropPos = 'before' | 'after'

export interface DropHint {
  id: number
  pos: DropPos
}

let dropHint: DropHint | null = null

type Listener = () => void
const listeners = new Set<Listener>()

function notify(): void {
  listeners.forEach((fn) => fn())
}

export function setDragPayload(p: DragPayload | null): void {
  current = p
  // 拖拽一结束，落点提示也该没了 —— 不用每个调用点各记一次
  if (p === null) dropHint = null
  notify()
}

export function setDropHint(h: DropHint | null): void {
  dropHint = h
  notify()
}

export function getDropHint(): DropHint | null {
  return dropHint
}

export function getDragPayload(): DragPayload | null {
  return current
}

/** 轨道悬停时被拖到哪个区，用于决定接不接 */
export function setHoverZone(z: Zone | null): void {
  hoverZone = z
}
let hoverZone: Zone | null = null
export function getHoverZone(): Zone | null {
  return hoverZone
}

export function subscribeDrag(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}