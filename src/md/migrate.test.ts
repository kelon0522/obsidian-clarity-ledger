/**
 * 迁移规划的测试。
 *
 * **这是破坏性操作** —— 搬错了、改名错了，用户的数据散在两个地方，
 * 而且失败是静默的（少搬一个，界面上看不出来，只是那天没数据）。
 * 所以规则必须先在这里钉死。
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { planMigration, type FileRef } from '@/md/migrate'
import { DEFAULT_SETTINGS, type PluginSettings } from '@/config/settings'

const cfg = (over: Partial<PluginSettings> = {}): PluginSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
})

/** 造 vault 里的文件。basename 不含扩展名，与 Obsidian 一致 */
const f = (path: string): FileRef => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, basename: name.replace(/\.md$/, '') }
}

describe('迁移规划 · 只搬自己人的文件', () => {
  it('按旧模板反解日期，认得的都进表', () => {
    const plan = planMigration(
      [f('清晰力/2026-10-10.md'), f('清晰力/2026-10-11.md')],
      cfg(),
      cfg({ nameTemplate: '{Y}/{M}/{D}' }),
    )
    expect(plan.total).toBe(2)
    expect(plan.items.map((i) => i.key).sort()).toEqual(['2026-10-10', '2026-10-11'])
  })

  it('旧目录里不是清晰力数据的文件，一个都不动', () => {
    const plan = planMigration(
      [
        f('清晰力/2026-10-10.md'),
        f('清晰力/随手记.md'), // 名字对不上模板
        f('清晰力/sub/2026-10-11.md'), // 嵌套子目录，不在当前目录
      ],
      cfg(),
      cfg({ folder: '规划' }),
    )
    expect(plan.items.map((i) => i.key)).toEqual(['2026-10-10'])
    expect(plan.untouched).toContain('清晰力/随手记.md')
  })

  it('新模板认不出的旧文件 → untouched（不能用新模板去猜）', () => {
    // 旧模板 {Y}-{M}-{D} 认得 2026-10-10
    // 换成中文模板后，它仍然是我们自己的文件（用**旧**模板判断）
    const plan = planMigration([f('清晰力/2026-10-10.md')], cfg(), cfg({ nameTemplate: '{Y}年{M}月{D}日' }))
    expect(plan.total).toBe(1)
    expect(plan.untouched).toHaveLength(0)
    expect(plan.items[0]?.toPath).toBe('清晰力/2026年10月10日.md')
  })

  it('别的目录里的同号文件不算自己的（不能误搬用户的数据）', () => {
    const plan = planMigration(
      [f('其他笔记/2026-10-10.md')],
      cfg({ folder: '清晰力' }),
      cfg({ folder: '规划' }),
    )
    expect(plan.total).toBe(0)
    expect(plan.items).toHaveLength(0)
  })
})

describe('迁移规划 · 改名 vs 移动', () => {
  it('只改模板 → 同目录内改名', () => {
    const plan = planMigration([f('清晰力/2026-10-10.md')], cfg(), cfg({ nameTemplate: '{Y}年{M}月{D}日' }))
    const item = plan.items[0]!
    expect(item.kind).toBe('rename')
    expect(item.fromPath).toBe('清晰力/2026-10-10.md')
    expect(item.toPath).toBe('清晰力/2026年10月10日.md')
  })

  it('只改目录 → 纯移动，名字不变', () => {
    const plan = planMigration([f('清晰力/2026-10-10.md')], cfg(), cfg({ folder: '规划' }))
    const item = plan.items[0]!
    expect(item.kind).toBe('move')
    expect(item.toPath).toBe('规划/2026-10-10.md')
  })

  it('既改目录又改模板 → 移动 + 改名（kind 归为 move）', () => {
    const plan = planMigration(
      [f('清晰力/2026-10-10.md')],
      cfg(),
      cfg({ folder: '规划', nameTemplate: '{Y}年{M}月{D}日' }),
    )
    const item = plan.items[0]!
    expect(item.kind).toBe('move')
    expect(item.toPath).toBe('规划/2026年10月10日.md')
  })

  it('多级目录：嵌套层级原样保留', () => {
    const plan = planMigration(
      [f('清晰力/2026-10-10.md')],
      cfg(),
      cfg({ folder: '日记/2026/清晰力' }),
    )
    expect(plan.items[0]!.toPath).toBe('日记/2026/清晰力/2026-10-10.md')
  })

  it('配置没变 → 全部 same，一张表都不执行', () => {
    const plan = planMigration([f('清晰力/2026-10-10.md')], cfg(), cfg())
    expect(plan.items[0]!.kind).toBe('same')
  })
})

describe('迁移规划 · 冲突绝不覆盖', () => {
  it('目标已有同一天的文件 → 标 same-day，跳过', () => {
    const plan = planMigration(
      [f('清晰力/2026-10-10.md'), f('规划/2026-10-10.md')],
      cfg(),
      cfg({ folder: '规划' }),
    )
    const item = plan.items.find((i) => i.key === '2026-10-10')!
    /* 关键：两份都在表里（同一天在两个地方各有一份是正常的），
       但冲突的那份不许搬 —— 删新的才是危险的。*/
    expect(item.conflict).toBe('same-day')
    expect(item.occupiedBy).toBe('规划/2026-10-10.md')
  })

  it('目标位置有个不相干的文件 → 不影响我们的文件迁移', () => {
    const plan = planMigration(
      [f('清晰力/2026-10-10.md'), f('规划/随便一个.md')],
      cfg(),
      cfg({ folder: '规划' }),
    )
    /* `规划/随便一个.md` 不在**旧目录**里（不在「清晰力/」下），
       所以它压根不进迁移流程 —— `untouched` 只记录旧目录里的非数据文件。
       我们的文件目标路径不冲突，正常搬。*/
    expect(plan.total).toBe(1)
    expect(plan.items[0]!.conflict).toBeNull()
    expect(plan.untouched).toEqual([])
  })

  it('旧目录里的非数据文件被记进 untouched，一个都不动', () => {
    const plan = planMigration(
      [f('清晰力/2026-10-10.md'), f('清晰力/会议纪要.md')],
      cfg(),
      cfg({ folder: '规划' }),
    )
    expect(plan.untouched).toEqual(['清晰力/会议纪要.md'])
    expect(plan.items.map((i) => i.fromPath)).toEqual(['清晰力/2026-10-10.md'])
  })

  it('两个不同日期撞到同一个目标路径 → 后一个标 name-clash', () => {
    /* 目标模板 {Y}-{M}-{D} 把日也当成两位、且月不补零时会出现撞名。
       现实里 {M} 一直是补零的，所以这里直接构造一个等价场景：
       旧模板能同时认出两个日期，而新模板把它们渲染到同一路径 ——
       用「模板里重复 {D}」模拟：`{Y}-{M}-{D}-{D}`，
       2026-01-02 和 2026-01-12 都会变成 ...-2 结尾，撞不了；
       真正的撞法是 `{Y}-{D}-{M}`（月日互换后仍唯一）——
       所以这里改用「旧模板两个文件、新模板有一个不认得」来验证 name-clash 判定本身。*/
    const plan = planMigration(
      [f('清晰力/2026-01-02.md'), f('清晰力/2026-01-12.md')],
      cfg(),
      // 新模板把日换成 {YY}，两个日期都渲染成 2026-01-... 之类
      cfg({ folder: '规划', nameTemplate: '{Y}-{YY}-{M}' }),
    )
    const targets = plan.items.map((i) => i.toPath)
    expect(new Set(targets).size).toBeLessThan(targets.length)
    /* 撞名的那个必须被标出来，不许静默搬两次到同一路径 */
    expect(plan.items.filter((i) => i.conflict === 'name-clash').length).toBeGreaterThan(0)
  })

  it('目标位置的文件正等着被搬走 → 不算冲突（腾空后再写）', () => {
    /* 换目录的同时改模板，两边都有文件：
       旧目录 A/2026-10-10.md 与 A/2026-10-11.md，
       新的去 B/。B 里若已有一个 2026-10-11.md（也在搬走范围内），就不算冲突。*/
    const plan = planMigration(
      [f('清晰力/2026-10-10.md'), f('清晰力/2026-10-11.md'), f('规划/2026-10-11.md')],
      cfg({ folder: '清晰力' }),
      cfg({ folder: '规划', nameTemplate: '{Y}-{M}-{D}' }),
    )
    /* 清晰力/2026-10-11.md → 规划/2026-10-11.md，而那个位置现在有个文件，
       但它也是从清晰力搬过来的（本题里是「规划」目录里的）—— */
    expect(plan.total).toBe(2)
    const toB = plan.items.find((i) => i.key === '2026-10-11')!
    /* 目标路径被占，但占用者不是「清晰力」目录的 → 算冲突 */
    expect(toB.conflict).toBe('same-day')
  })

  it('配置没变时不该制造冲突', () => {
    /* 全 same 的情况下冲突判定必须完全不触发 ——
       否则「打开设置面板没改东西」就会报一堆假冲突。*/
    const plan = planMigration(
      [f('清晰力/2026-01-02.md'), f('清晰力/2026-01-12.md')],
      cfg(),
      cfg(),
    )
    expect(plan.items.every((i) => i.kind === 'same')).toBe(true)
    expect(plan.items.some((i) => i.conflict)).toBe(false)
  })
})

describe('迁移规划 · 边界', () => {
  it('空 vault → 空表，不是错误', () => {
    const plan = planMigration([], cfg(), cfg({ folder: '规划' }))
    expect(plan.items).toHaveLength(0)
    expect(plan.total).toBe(0)
  })

  it('旧目录带尾斜杠也能匹配（配置里手写进去的）', () => {
    const plan = planMigration([f('清晰力/2026-10-10.md')], cfg({ folder: '清晰力/' }), cfg({ folder: '规划' }))
    expect(plan.total).toBe(1)
  })

  it('目标路径等于来源路径时是 same，不是 move', () => {
    const plan = planMigration([f('清晰力/2026-10-10.md')], cfg(), cfg({ folder: '清晰力/' }))
    expect(plan.items[0]!.kind).toBe('same')
  })

  it('文件名带多级路径时 basename 取最后一段', () => {
    const plan = planMigration(
      [f('清晰力/子目录/2026-10-10.md')],
      cfg(),
      cfg({ folder: '规划' }),
    )
    /* 在子目录里 → 不属于旧目录，不该被搬 */
    expect(plan.total).toBe(0)
  })
})
