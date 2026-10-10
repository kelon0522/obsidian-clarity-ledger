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

type Listener = () => void
const listeners = new Set<Listener>()

export function setDragPayload(p: DragPayload | null): void {
  current = p
  listeners.forEach((fn) => fn())
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