/**
 * Markdown 日记 ↔ DB 的编解码。
 *
 * ## 为什么数据是 Markdown 而不是 JSON
 *
 * 这是插件版相对 Web 版最大的增量：数据落在 vault 里，
 * 能被 Obsidian 全局搜索、能 git、能跟着同步走，也能在源码模式下手改。
 *
 * ## 格式
 *
 * ```markdown
 * # 2026-10-10
 *
 * | 待办 | 预估 | 计划 | 实际 |
 * |---|---|---|---|
 * | 改 GDD 第7章 <!--id:1--> | 90 | 8:00–9:30 | |
 * | 准备联机测试 <!--id:2--> | 45 | 10:30–11:15 | 10:35–11:30 |
 * | 还没排期的事 <!--id:3--> | 20 | | |
 *
 * ## 复盘
 *
 * 昨天把复习时间放太靠后……
 * ```
 *
 * ## 为什么 id 藏在 HTML 注释里
 *
 * `id` 是拖拽、改名、撤销的锚点，必须稳定，不能用「行号」——
 * 行号会随任何一次重排整体位移。
 *
 * 但把它显示成独立一列会污染表格，用户手改时也容易改坏。
 * `<--id:1-->` 在 Obsidian 的阅读视图里**不渲染**（HTML 注释），
 * 源码模式里也能看到、不会被误删。
 *
 * 解析时**缺 id 不报错**，按行号兜底 —— 这样用户手写一份表格也能直接用。
 *
 * ## 时间的表示
 *
 * 存「起止」而不是「起始 + 时长」：`8:00–9:30` 人能读懂，手改时也知道改的是哪一段。
 * 反解时时长 = 止 - 起，正好等于 `pd`，与「实际时长恒等于计划时长」这条产品决策一致。
 */

import type { DB, Day, Task } from '@/core/types'
import { SLOT, pad2 } from '@/core/time'

/* ============================ 时间 ============================ */

/** 480 → "8:00" */
function toHM(m: number): string {
  const r = Math.round(m)
  return `${Math.floor(r / 60)}:${pad2(r % 60)}`
}

/**
 * 解析 "8:00" / "8:00–9:30" / "8:00-9:30" / "8：00"（全角冒号）。
 *
 * @returns 起止分钟；解析不出来返回 null
 *
 * 兼容手写：用户不会去数「当日第几分钟」，一定是写 8:00。
 */
function parseRange(s: string): { start: number; end: number } | null {
  const t = (s || '').trim().replace(/：/g, ':')
  if (!t) return null

  // 破折号有多种：– — - ~ ～，用户输入法不同
  const m = t.match(/^(\d{1,2}):(\d{2})\s*[–—\-~～]\s*(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const sh = +m[1]!
  const sm = +m[2]!
  const eh = +m[3]!
  const em = +m[4]!
  // 小时可以到 24（24:00 表示当天结束）
  if (sh > 24 || eh > 24 || sm > 59 || em > 59) return null
  return { start: sh * 60 + sm, end: eh * 60 + em }
}

/** "1:30" → 90，只接受单值（用于预估列） */
function parseMin(s: string): number {
  const t = (s || '').trim()
  if (!t) return 0
  const m = t.match(/^(\d{1,2}):(\d{2})$/)
  if (m) return +m[1]! * 60 + +m[2]!
  const n = parseFloat(t)
  return isNaN(n) ? 0 : Math.round(n)
}

/** 分钟 → "1:30"，供预估列用 */
function durText(m: number): string {
  return m > 0 ? toHM(m) : ''
}

/* ============================ 解析 ============================ */

const ID_RE = /<!--\s*id:\s*(\d+)\s*-->/
const ROW_RE = /^\|(.+)\|\s*$/
const SEP_RE = /^\|[\s:|-]+\|\s*$/

export interface ParseResult {
  day: Day | null
  /** 解析过程中的问题，用于给用户提示（比如某行时间格式不对） */
  warn: string[]
}

/**
 * 解析一篇日记。
 *
 * 走「宽松优先」：认不出的行跳过而不是抛错。
 * 理由是这份文件用户随时可能手改，一个格式错误不该让整个插件打不开。
 */
export function parseDay(md: string, key: string): ParseResult {
  const warn: string[] = []
  const lines = (md ?? '').split(/\r?\n/)

  const tasks: Task[] = []
  let note = ''
  let seenTable = false
  let inNote = false
  let maxId = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // 复盘正文：## 复盘 之后的所有行
    if (/^#{1,6}\s*复盘|每日回顾|回顾\s*$/.test(line.trim())) {
      inNote = true
      seenTable = true // 没有表格时，复盘标题也算内容，note 要能落进去
      continue
    }

    if (inNote) {
      note += (note ? '\n' : '') + line
      continue
    }

    const row = line.match(ROW_RE)
    if (!row) {
      // 碰到别的标题就结束表格区
      if (/^#{1,6}\s/.test(line) && !seenTable) continue
      continue
    }
    if (SEP_RE.test(line)) {
      seenTable = true
      continue
    }
    if (!seenTable) continue // 表格头之前不算数据

    const cells = row[1]!.split('|').map((s) => s.trim())
    if (cells.length < 3) continue

    // 表头行跳过
    if (/^-+$/.test(cells[0]!) || cells[0] === '待办' || cells[0] === '事项') continue
    if (!cells[0]) continue

    //标题里的 id 注释
    const rawTitle = cells[0]!
    const idm = rawTitle.match(ID_RE)
    const ti = rawTitle.replace(ID_RE, '').trim()
    if (!ti) continue

    let id: number
    if (idm) {
      id = +idm[1]!
      maxId = Math.max(maxId, id)
    } else {
      // 兜底：用行号当 id。用户手写的表格也能用。
      // 代价是重排后 id 会变 —— 但那是用户手改造成���，可接受
      id = maxId + 1
      maxId = id
      warn.push(`第 ${i + 1} 行没有 id 标记，已按顺序编号`)
    }

    const est = parseMin(cells[1] ?? '')
    const planR = parseRange(cells[2] ?? '')
    const actR = parseRange(cells[3] ?? '')

    if (cells[2]?.trim() && !planR) warn.push(`「${ti}」的计划时间看不懂：${cells[2]}`)
    if (cells[3]?.trim() && !actR) warn.push(`「${ti}」的实际时间看不懂：${cells[3]}`)

    // 计划时长 = 止 - 起。至少一个 SLOT，否则块高度为 0 看不见
    const pd = planR ? Math.max(SLOT, planR.end - planR.start) : 0
    const ad = actR ? Math.max(SLOT, actR.end - actR.start) : 0

    tasks.push({
      id,
      ti,
      // 预估独立存：不排期也要记得当初估了多少
      est: est > 0 ? est : pd || 0,
      plan: planR ? planR.start : null,
      pd,
      act: actR ? actR.start : null,
      ad,
    })
  }

  return {
    day: { tasks, note: note.trim(), created: key },
    warn,
  }
}

/** 解析一个目录下的所有日记 → DB。`files` 是 {key, md} 列表 */
export function parseAll(files: { key: string; md: string }[]): { db: DB; warn: string[] } {
  const db: DB = {}
  const warn: string[] = []
  for (const f of files) {
    const r = parseDay(f.md, f.key)
    /* 空白文件不产生一天 —— 否则日历上会出现一串空格子。
       注意区分「真空白」和「有标题但没内容」：
       刚给今天建了文件（正文只有 `# 2026-10-10`）是**有效的一天**，
       该在日历上出现，否则用户点开才发现自己创建的那天不见了。
       判断写成「空白 且 没有任务 没有复盘」才跳过 —— 两个条件都要齐。*/
    if (isBlankDoc(f.md) && !r.day!.tasks.length && !r.day!.note) continue
    db[f.key] = r.day!
    warn.push(...r.warn.map((w) => `${f.key}: ${w}`))
  }
  return { db, warn }
}

/** 文档是否真的什么都没写（连标题都没有） */
function isBlankDoc(md: string): boolean {
  return (md ?? '')
    .split(/\r?\n/)
    .every((l) => !l.trim() || /^#{1,6}\s*$/.test(l.trim()))
}

/* ============================ 生成 ============================ */

function taskRow(t: Task): string {
  const plan = t.plan == null ? '' : `${toHM(t.plan)}–${toHM(t.plan + t.pd)}`
  const act = t.act == null ? '' : `${toHM(t.act)}–${toHM(t.act + t.ad)}`
  return `| ${t.ti} <!--id:${t.id}--> | ${durText(t.est)} | ${plan} | ${act} |`
}

/** DB 里的一天 → Markdown */
export function renderDay(day: Day): string {
  const out: string[] = []

  out.push(`# ${day.created}`)
  out.push('')

  if (day.tasks.length) {
    out.push('| 待办 | 预估 | 计划 | 实际 |')
    out.push('|---|---|---|---|')
    day.tasks.forEach((t) => out.push(taskRow(t)))
    out.push('')
  }

  out.push('## 复盘')
  out.push('')
  if (day.note.trim()) {
    // 逐行写出，避免多行文本被挤成一行
    out.push(...day.note.trim().split(/\r?\n/))
  }

  return out.join('\n') + '\n'
}
