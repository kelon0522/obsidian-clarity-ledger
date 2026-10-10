/**
 * 字段白名单化 —— 所有来源（浏览器缓存 / 本地文件 / 导入文件）
 * 共用的唯一入口。历史版本残留字段（如 lock）永远进不了内存。
 */
import { SLOT, dkey } from './time'
import { uid } from './logic'
import { isTestMode } from './mode'
import type { Day, DB, Task } from './types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDateKey(k: string): boolean {
  return DATE_RE.test(k)
}

function normalizeTask(raw: unknown): Task | null {
  const t = raw as Partial<Task> | null
  if (!t || typeof t !== 'object' || !t.ti) return null
  const pd = Math.max(SLOT, Math.round(t.pd || t.est || 0))
  const act = t.act == null ? null : Math.round(t.act)
  return {
    id: typeof t.id === 'number' ? t.id : uid(),
    ti: String(t.ti),
    est: Math.round(t.est || pd),
    plan: t.plan == null ? null : Math.round(t.plan),
    pd,
    act,
    // act 有值而 ad 缺失时兜底到 pd，保证「实际占用」永远确定
    ad: act == null ? 0 : Math.max(SLOT, Math.round(t.ad || pd)),
  }
}

export function normalizeDay(raw: unknown): Day {
  const d = (raw || {}) as Partial<Day>
  const tasks = (Array.isArray(d.tasks) ? d.tasks : [])
    .map(normalizeTask)
    .filter((t): t is Task => t !== null)
  const out: Day = {
    tasks,
    note: typeof d.note === 'string' ? d.note : '',
    created: typeof d.created === 'string' ? d.created : dkey(new Date()),
  }
  if (typeof d._e === 'number') out._e = d._e
  return out
}

export function normalizeDB(raw: unknown): DB {
  // 兼容两种形态：
  //  1. 裸 { "2026-10-08": {...} }—— 早期本地文件写出的
  //  2. 包装 { _app, _ver, _at, days: { "2026-10-08": {...} } } —— 导出按钮 / 现在的本地文件
  // 不做这一步的话，用「打开已有文件」选一个导出的 json 会读到 0 天数据：
  // 顶层只有 _app/_ver/_at/days，没有一个能通过日期键校验。
  const src = (raw || {}) as Record<string, unknown>
  const hasTop = Object.keys(src).some(isDateKey)
  // 顶层已有日期键就以顶层为准（混合形态下不静默丢数据）；
  // 否则下钻到 days。只认对象，数组之类不当数据源。
  const inner =
    !hasTop && src.days && typeof src.days === 'object' && !Array.isArray(src.days)
      ? (src.days as Record<string, unknown>)
      : src
  const out: DB = {}
  // 排序：日历和导入摘要都按时间先后展示，键序必须稳定
  Object.keys(inner)
    .filter(isDateKey)
    .sort()
    .forEach((k) => {
      out[k] = normalizeDay(inner[k])
    })
  return out
}

/**
 * 逐日比对两份库，取最后编辑时刻较新的一侧。
 *
 * 为什么需要：文件写入是异步的，beforeunload 等不到它完成，
 * 所以浏览器镜像反而可能更新。不做这个合并，用户会丢掉
 * 「关页面前最后拖的那一下」。_e 缺失按 -1 处理。
 */
export function mergeByRecency(fileDB: DB, mirrorDB: DB): DB {
  const keys = new Set([...Object.keys(fileDB), ...Object.keys(mirrorDB)])
  const out: DB = {}
  keys.forEach((k) => {
    const f = fileDB[k]
    const m = mirrorDB[k]
    if (f && m) out[k] = (m._e ?? -1) > (f._e ?? -1) ? m : f
    else out[k] = f ?? m!
  })
  return out
}

/** 数一下 mergeByRecency 里有多少天取了镜像侧，用于提示用户 */
export function countMirrorWins(fileDB: DB, mirrorDB: DB): number {
  let n = 0
  const keys = new Set([...Object.keys(fileDB), ...Object.keys(mirrorDB)])
  keys.forEach((k) => {
    const f = fileDB[k]
    const m = mirrorDB[k]
    if (m && (!f || (m._e ?? -1) > (f._e ?? -1))) n++
  })
  return n
}

/**
 * 内置种子数据：第一次打开时有东西看
 *
 * 测试模式用另一套内容 —— 不塞真实任务名。理由是万一两套数据串了，
 * 一眼就能看出是种子而不是真数据，不会当成「我什么时候排了这个」。
 */
export function seedDB(): DB {
  const t = dkey(new Date())
  const y = new Date()
  y.setDate(y.getDate() - 1)
  const yk = dkey(y)

  if (isTestMode) {
    return {
      [t]: {
        tasks: [
          { id: 1, ti: '【测试】拖到计划轨', est: 30, plan: 9 * 60, pd: 30, act: null, ad: 0 },
          { id: 2, ti: '【测试】拖到实际轨看划线', est: 45, plan: 10 * 60, pd: 45, act: null, ad: 0 },
          { id: 3, ti: '【测试】拖下沿手柄改时长', est: 60, plan: null, pd: 0, act: null, ad: 0 },
          { id: 4, ti: '【测试】未排期，留着看列脚', est: 20, plan: null, pd: 0, act: null, ad: 0 },
        ],
        note: '测试模式数据。删掉也不影响正式数据。',
        created: t,
      },
      [yk]: {
        tasks: [
          { id: 11, ti: '【测试】已完成的块', est: 40, plan: 20 * 60, pd: 40, act: 20 * 60 + 10, ad: 55 },
        ],
        note: '昨天的测试复盘。',
        created: yk,
      },
    }
  }

  const db: DB = {
    [t]: {
      tasks: [
        { id: 1, ti: '改 GDD 第7章 战斗手感', est: 90, plan: 8 * 60, pd: 90, act: null, ad: 0 },
        { id: 2, ti: '准备明早联机测试环境', est: 45, plan: 10 * 60 + 30, pd: 45, act: null, ad: 0 },
        { id: 3, ti: '16-part 面试 · 分布式', est: 120, plan: 14 * 60, pd: 120, act: null, ad: 0 },
        { id: 4, ti: '公众号《MGR-9》二稿删节', est: 60, plan: null, pd: 0, act: null, ad: 0 },
        { id: 5, ti: 'Three.js 渲染验证', est: 90, plan: null, pd: 0, act: null, ad: 0 },
        { id: 6, ti: 'NAS 备份策略检查', est: 20, plan: null, pd: 0, act: null, ad: 0 },
      ],
      note: '',
      created: t,
    },
  }
  db[yk] = {
    tasks: [
      { id: 11, ti: '写周复盘', est: 40, plan: 20 * 60, pd: 40, act: 20 * 60 + 10, ad: 55 },
      { id: 12, ti: '跑步 5km', est: 40, plan: 7 * 60, pd: 40, act: 7 * 60 + 15, ad: 35 },
    ],
    note: '昨天把复习时间放太靠后，导致 20:00 之后全是硬塞。\n今天把学习块提前到下午。',
    created: yk,
  }
  return db
}