/**
 * 领域规则。纯函数，无 DOM 无时钟，可完整单测。
 *
 * 三条已拍板的核心决策都在这里：
 * 1. 不做自动计时 —— 拖进实际轨即完成，时长 = 计划时长
 * 2. 完成判定由落位决定（act != null），不看当前时间
 * 3. 计划列顺延，实际列不顺延
 */
import { SLOT } from './time'
import type { Day, DB, Task } from './types'

/**
 * 单调递增 id。不能用 Date.now()+随机数 —— 同一毫秒内连加几条会撞号，
 * find(id) 会拿错任务。计数器 + 时间戳兜底，撞号概率可忽略。
 */
let seq = 0
export function uid(): number {
  seq = (seq + 1) % 1000
  return Date.now() * 1000 + seq
}

/** 实际轨时长。无自动计时 —— 只读 ad，与时钟无关。 */
export function effDur(t: Task): number {
  if (t.act == null) return 0
  return Math.max(SLOT, t.ad || 0)
}

/** 完成判定：进了实际轨就算完成。 */
export function finished(t: Task): boolean {
  return t.act != null
}

/** 计划时长，pd 优先，缺省回落 est */
export const planDur = (t: Task): number => t.pd || t.est || SLOT

/**
 * 计划列顺延：按 plan 升序扫一遍，curEnd 游标推进。
 * 等效于「最早可用空位」填充。O(n)。实际列不调用此函数。
 */
export function reflow(tasks: Task[]): void {
  const arr = tasks.filter((t) => t.plan != null).sort((a, b) => a.plan! - b.plan!)
  let curEnd = -1
  arr.forEach((t) => {
    if (t.plan! < curEnd) t.plan = curEnd
    curEnd = t.plan! + planDur(t)
  })
}

export function emptyDay(created: string): Day {
  return { tasks: [], note: '', created }
}

export function dayTasks(db: DB, k: string): Task[] {
  return (db[k] ??= emptyDay(k)).tasks
}

/** 当天汇总：计划占用、实际占用、已兑现项数 */
export function summary(tasks: Task[]) {
  let pe = 0
  let ae = 0
  let done = 0
  tasks.forEach((t) => {
    if (t.plan != null) pe += planDur(t)
    if (t.act != null) {
      ae += effDur(t)
      done++
    }
  })
  return { planMin: pe, actMin: ae, done, total: tasks.length }
}

/** 计划列最后一个块的结束时刻，用来做「↳ 顺延至 xx:xx」提示 */
export function planTail(tasks: Task[]): number | null {
  let last: number | null = null
  tasks.forEach((t) => {
    if (t.plan == null) return
    const e = t.plan + planDur(t)
    if (last == null || e > last) last = e
  })
  return last
}