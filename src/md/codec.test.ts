/**
 * Markdown 编解码测试。
 *
 * 重点在三处：
 *  1. **往返一致** —— 存进去再读出来，必须还是同一个东西
 *  2. **宽松解析** —— 文件是用户手改的，一个格式错误不该让插件打不开
 *  3. **id 稳定性** —— 拖拽 / 改名 / 撤销都靠 id，丢了就静默失效
 *
 * 变异的自我检查：`est` 与 `pd` 故意设成不同值，两者相等的话
 * 「取哪个」的 bug 测不出来（这个坑在 Web 版踩过）。
 */
import { describe, expect, it } from 'vitest'
import { parseAll, parseDay, renderDay } from './codec'
import type { Day } from '@/core/types'

const K = '2026-10-10'

const sample: Day = {
  created: K,
  note: '昨天把复习时间放太靠后。\n今天提前到下午。',
  tasks: [
    // est 与 pd 故意不同：60 vs 90。两者相等测不出 bug
    { id: 1, ti: '改 GDD 第7章', est: 60, plan: 480, pd: 90, act: null, ad: 0 },
    { id: 2, ti: '准备联机测试', est: 45, plan: 630, pd: 45, act: 635, ad: 60 },
    { id: 3, ti: '还没排期', est: 20, plan: null, pd: 0, act: null, ad: 0 },
    { id: 4, ti: '已完成但没时长', est: 30, plan: 780, pd: 30, act: 780, ad: 30 },
  ],
}

describe('往返', () => {
  it('存进去再读出来，字段全等', () => {
    const md = renderDay(sample)
    const back = parseDay(md, K).day!
    expect(back.tasks).toEqual(sample.tasks)
  })

  it('复盘正文往返一致', () => {
    const back = parseDay(renderDay(sample), K).day!
    expect(back.note).toBe(sample.note)
  })

  it('空任务列表也能往返', () => {
    const d: Day = { created: K, note: '', tasks: [] }
    const back = parseDay(renderDay(d), K).day!
    expect(back.tasks).toEqual([])
    expect(back.note).toBe('')
  })

  it('created 跟着 key 走', () => {
    expect(parseDay(renderDay(sample), '2026-01-02').day!.created).toBe('2026-01-02')
  })

  it('产出的 Markdown 是人能读的（表头 + 分隔行 + 复盘标题）', () => {
    const md = renderDay(sample)
    expect(md).toContain('# 2026-10-10')
    expect(md).toContain('| 待办 | 预估 | 计划 | 实际 |')
    expect(md).toContain('|---|---|---|---|')
    expect(md).toContain('## 复盘')
  })

  it('时间是人能读的 8:00–9:30，不是「当日第 480 分钟」', () => {
    expect(renderDay(sample)).toContain('8:00–9:30')
  })

  it('id 藏在 HTML 注释里，不占独立列', () => {
    const md = renderDay(sample)
    expect(md).toContain('改 GDD 第7章 <!--id:1-->')
    // 表头不该多出 id 列
    expect(md).toContain('| 待办 | 预估 | 计划 | 实际 |')
  })
})

describe('时间的表示', () => {
  it('计划时长 = 止 - 起，不是预设的 pd', () => {
    const md = renderDay({
      created: K,
      note: '',
      tasks: [{ id: 1, ti: 'x', est: 999, plan: 600, pd: 120, act: null, ad: 0 }],
    })
    // 600→10:00, 720→12:00，读回来应该是 120
    expect(parseDay(md, K).day!.tasks[0]!.pd).toBe(120)
  })

  it('未排期的任务，计划与实际两列都是空的', () => {
    // 空单元格渲染成一个空格而不是空串 —— Markdown 表格里 `| |` 比 `||` 更不容易被解析器搞坏
    expect(renderDay(sample)).toContain('| 还没排期 <!--id:3--> | 0:20 |  |  |')
  })

  it('实际为空表示未完成 —— 与「act != null 即划线」一致', () => {
    const back = parseDay(renderDay(sample), K).day!
    expect(back.tasks[1]!.act).toBe(635)
    expect(back.tasks[2]!.act).toBeNull()
  })

  it('时长被钳到至少一个 SLOT（否则块高度 0 看不见）', () => {
    const md = renderDay({
      created: K,
      note: '',
      tasks: [{ id: 1, ti: '零时长', est: 0, plan: 600, pd: 0, act: null, ad: 0 }],
    })
    expect(parseDay(md, K).day!.tasks[0]!.pd).toBe(15)
  })

  it('跨小时的区间算得对（8:00–9:30 = 90 分钟）', () => {
    const back = parseDay(
      `# ${K}\n\n| 待办 | 预估 | 计划 | 实际 |\n|---|---|---|---|\n| x <!--id:1--> | | 8:00–9:30 | |`,
      K,
    ).day!
    expect(back.tasks[0]!.plan).toBe(480)
    expect(back.tasks[0]!.pd).toBe(90)
  })

  it('24:00 被接受（当天结束）', () => {
    const back = parseDay(
      `# ${K}\n\n| 待办 | 预估 | 计划 | 实际 |\n|---|---|---|---|\n| x <!--id:1--> | | 23:00–24:00 | |`,
      K,
    ).day!
    expect(back.tasks[0]!.pd).toBe(60)
  })
})

describe('宽松解析 · 用户手改的场景', () => {
  it('全角冒号能认', () => {
    const back = parseDay(
      `# ${K}\n\n| 待办 | 预估 | 计划 | 实际 |\n|---|---|---|---|\n| x <!--id:1--> | | 8：00–9：30 | |`,
      K,
    ).day!
    expect(back.tasks[0]!.plan).toBe(480)
  })

  it('各种破折号都认（输入法不同）', () => {
    for (const dash of ['–', '—', '-', '~', '～']) {
      const back = parseDay(
        `# ${K}\n\n| 待办 | 预估 | 计划 | 实际 |\n|---|---|---|---|\n| x <!--id:1--> | | 8:00${dash}9:30 | |`,
        K,
      ).day!
      expect(back.tasks[0]!.plan).toBe(480)
    }
  })

  it('缺 id 注释时按行号兜底，不报错', () => {
    const r = parseDay(
      `# ${K}\n\n| 待办 | 预估 | 计划 | 实际 |\n|---|---|---|---|\n| 甲 | | 8:00–9:00 | |\n| 乙 | | 10:00–11:00 | |`,
      K,
    )
    expect(r.day!.tasks.map((t) => t.ti)).toEqual(['甲', '乙'])
    expect(new Set(r.day!.tasks.map((t) => t.id)).size).toBe(2)
    expect(r.warn.length).toBeGreaterThan(0)
  })

  it('完全空文件 → 一天但无任务（不是崩溃）', () => {
    const r = parseDay('', K)
    expect(r.day!.tasks).toEqual([])
  })

  it('时间格式看不懂时跳过该列而不是整行丢弃', () => {
    const r = parseDay(
      `# ${K}\n\n| 待办 | 预估 | 计划 | 实际 |\n|---|---|---|---|\n| x <!--id:1--> | | 明天上午 | |`,
      K,
    )
    // 任务还在，只是没排期
    expect(r.day!.tasks).toHaveLength(1)
    expect(r.day!.tasks[0]!.plan).toBeNull()
    expect(r.warn.length).toBe(1)
  })

  it('小时超过 24 时不认', () => {
    const back = parseDay(
      `# ${K}\n\n| 待办 | 预估 | 计划 | 实际 |\n|---|---|---|---|\n| x <!--id:1--> | | 25:00–26:00 | |`,
      K,
    ).day!
    expect(back.tasks[0]!.plan).toBeNull()
  })

  it('列数不够的行跳过', () => {
    const back = parseDay(
      `# ${K}\n\n| 待办 | 预估 | 计划 | 实际 |\n|---|---|---|---|\n| 只有标题 <!--id:1--> | | |`,
      K,
    ).day!
    expect(back.tasks).toHaveLength(1)
  })

  it('标题为空的行跳过（否则拖拽会拖到空块上）', () => {
    const back = parseDay(
      `# ${K}\n\n| 待办 | 预估 | 计划 | 实际 |\n|---|---|---|---|\n| <!--id:1--> | | 8:00–9:00 | |\n| 有标题 <!--id:2--> | | | |`,
      K,
    ).day!
    expect(back.tasks.map((t) => t.ti)).toEqual(['有标题'])
  })

  it('CRLF 换行不影响解析', () => {
    const md = renderDay(sample).replace(/\n/g, '\r\n')
    expect(parseDay(md, K).day!.tasks).toEqual(sample.tasks)
  })

  it('复盘标题认「复盘」「每日回顾」「回顾」', () => {
    for (const h of ['## 复盘', '## 每日回顾', '## 回顾']) {
      const back = parseDay(`# ${K}\n\n${h}\n\n写点什么`, K).day!
      expect(back.note).toBe('写点什么')
    }
  })

  it('复盘里的多行内容保留换行', () => {
    const back = parseDay(`# ${K}\n\n## 复盘\n\n第一段\n第二段`, K).day!
    expect(back.note).toBe('第一段\n第二段')
  })

  it('复盘为空时 note 是空串', () => {
    expect(parseDay(`# ${K}\n\n## 复盘\n`, K).day!.note).toBe('')
  })

  it('表格前的其他标题不干扰', () => {
    const back = parseDay(`# ${K}\n\n## 一些别的标题\n\n${renderDay({ created: K, note: 'n', tasks: sample.tasks })}`, K)
    expect(back.day!.tasks).toHaveLength(4)
  })
})

describe('parseAll', () => {
  it('多天合并成一个 DB', () => {
    const { db } = parseAll([
      { key: '2026-10-10', md: renderDay({ ...sample, created: '2026-10-10' }) },
      { key: '2026-10-11', md: renderDay({ ...sample, created: '2026-10-11', tasks: [] }) },
    ])
    expect(Object.keys(db)).toEqual(['2026-10-10', '2026-10-11'])
  })

  it('空白文件不产生一天 —— 否则日历上会是一串空格子', () => {
    const { db } = parseAll([
      { key: '2026-10-10', md: '   \n\n' },
      { key: '2026-10-11', md: '# 2026-10-11\n' },
    ])
    expect(Object.keys(db)).toEqual(['2026-10-11'])
  })

  it('有标题但没内容算有效的一天 —— 刚建的日记要在日历上出现', () => {
    // 用户点「今天」创建文件，此刻正文只有标题、没任务。
    // 如果把它当空文件丢掉，用户会发现「刚建的那天不见了」
    const { db } = parseAll([{ key: '2026-10-11', md: '# 2026-10-11\n\n## 复盘\n' }])
    expect(Object.keys(db)).toEqual(['2026-10-11'])
    expect(db['2026-10-11']!.tasks).toEqual([])
    expect(db['2026-10-11']!.note).toBe('')
  })

  it('warn 带上了是哪一天', () => {
    const { warn } = parseAll([
      { key: '2026-10-10', md: '| 待办 | 预估 | 计划 | 实际 |\n|---|---|---|---|\n| 甲 | | | |' },
    ])
    expect(warn[0]).toContain('2026-10-10')
  })
})

describe('id 稳定性（拖拽 / 改名 / 撤销都靠它）', () => {
  it('往返后 id 不变', () => {
    const back = parseDay(renderDay(sample), K).day!
    expect(back.tasks.map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it('id 不受顺序影响 —— 交换行顺序后 id 跟着 id 走', () => {
    const swapped = { ...sample, tasks: [sample.tasks[2]!, sample.tasks[0]!, sample.tasks[1]!] }
    const back = parseDay(renderDay(swapped), K).day!
    expect(back.tasks.map((t) => t.id)).toEqual([3, 1, 2])
    expect(back.tasks.map((t) => t.ti)).toEqual(['还没排期', '改 GDD 第7章', '准备联机测试'])
  })

  it('id 不会因为渲染宽度变化而重排', () => {
    // 同一条任务，标题长短不同，id 必须一样
    const a = parseDay(renderDay({ ...sample, tasks: [sample.tasks[0]!] }), K).day!
    const b = parseDay(
      renderDay({
        ...sample,
        tasks: [{ ...sample.tasks[0]!, ti: '改 GDD 第7章 战斗手感 很长很长很长' }],
      }),
      K,
    ).day!
    expect(a.tasks[0]!.id).toBe(b.tasks[0]!.id)
  })
})

describe('est 与 pd 独立（变异测试的前提）', () => {
  it('未排期任务的 est 单独保住 —— 不排期也记得当初估了多少', () => {
    const back = parseDay(renderDay(sample), K).day!
    // sample 里第三条 est=20 pd=0
    expect(back.tasks[2]!.est).toBe(20)
    expect(back.tasks[2]!.pd).toBe(0)
  })

  it('排期任务的 est 不被 pd 覆盖', () => {
    const back = parseDay(renderDay(sample), K).day!
    // 第一条est=60 pd=90，两个不同才能测出取哪个
    expect(back.tasks[0]!.est).toBe(60)
    expect(back.tasks[0]!.pd).toBe(90)
  })
})
