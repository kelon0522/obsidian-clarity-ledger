/** 一条待办。plan/act 存的是「当日第几分钟」，不是时间戳。 */
export interface Task {
  id: number
  ti: string // 事项标题
  est: number // 预估分钟
  plan: number | null // 计划起始分钟，null = 未排期
  pd: number // 计划时长，决定行高与顺延
  act: number | null // 实际起始分钟，null = 未完成。非 null 即已完成
  ad: number // 实际时长，落位时 = pd，此后恒定
}

export interface Day {
  tasks: Task[]
  note: string // 每日回顾
  created: string // 创建日期 YYYY-MM-DD
  _e?: number // 最后编辑时刻（当日第几分钟）
}

/** 键是 YYYY-MM-DD */
export type DB = Record<string, Day>

export type Zone = 'p' | 'a'

/** 正式模式的 localStorage 键。测试模式见 core/mode.ts 的 dbKey() */
export const DB_KEY = 'clarityledger.db.v3'
export const IDB_NAME = 'clarity-ledger'
export const IDB_STORE = 'kv'
export const IDB_HANDLE = 'fh'