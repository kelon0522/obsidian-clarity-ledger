/** 时间轴常量与换算。全部纯函数，无 DOM 依赖。 */

import { DB_KEY } from './types'

export { DB_KEY }

/** 拖拽吸附粒度 15 分钟 */
export const SLOT = 15
/** 每一小时占的行高 px —— 2026-10-09 拍板：一小时一格，不做 15 分钟细格 */
export const ROWH = 40
/** 轴的起点：00:00 */
export const D0 = 0
/** 轴的终点：24:00 */
export const D1 = 24 * 60

/** 轴的总像素高度 */
export const AXIS_PX = ((D1 - D0) / 60) * ROWH

export const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n))

/** 860 → "14:20" */
export function fmt(m: number): string {
  const r = Math.round(m)
  return `${pad2(Math.floor(r / 60))}:${pad2(r % 60)}`
}

/** 100 → "1:40"，用于【1:40】时长标注 */
export function hm(m: number): string {
  const r = Math.round(m)
  return `${Math.floor(r / 60)}:${pad2(r % 60)}`
}

/** 当日第几分钟 → 像素 Y 坐标。整点对齐到格线。 */
export function yT(m: number): number {
  return ((m - D0) / 60) * ROWH
}

/** 像素 Y → 当日第几分钟，吸附到最近的 SLOT 刻度 */
export function snapM(y: number): number {
  const m = D0 + (y / ROWH) * 60
  return Math.max(D0, Math.min(D1 - SLOT, Math.round(m / SLOT) * SLOT))
}

/** Date → "2026-10-08" */
export function dkey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** "2026-10-08" → Date（本地时区） */
export function parseK(k: string): Date {
  const [y, mo, d] = k.split('-').map(Number)
  return new Date(y!, mo! - 1, d!)
}

export const WEEK = ['日', '一', '二', '三', '四', '五', '六']

export function nowMin(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes()
}

/** "2小时" / "90" / "1.5h" / "45分" → 分钟数，解析失败返回 NaN */
export function parseDur(v: string): number {
  const s = (v || '').trim()
  if (!s) return NaN
  const h = s.match(/^([\d.]+)\s*(?:小时|h|H)$/)
  if (h) return Math.round(parseFloat(h[1]!) * 60)
  const m = s.match(/^([\d.]+)\s*(?:分钟|分|m|M)$/)
  if (m) return Math.round(parseFloat(m[1]!))
  const n = parseFloat(s)
  return isNaN(n) ? NaN : Math.round(n)
}