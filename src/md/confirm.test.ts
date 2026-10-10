/**
 * 迁移确认弹框文案的测试。
 *
 * **弹框上的每一句话都会影响用户点不点确定。**
 * 措辞含糊的代价是「用户以为只改了设置」，而实际上文件已经被搬走了。
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { migrationSummary, pathHint } from '@/md/confirm'
import { planMigration, type FileRef } from '@/md/migrate'
import { DEFAULT_SETTINGS, type PluginSettings } from '@/config/settings'

const cfg = (o: Partial<PluginSettings> = {}): PluginSettings => ({ ...DEFAULT_SETTINGS, ...o })
const f = (path: string): FileRef => ({
  path,
  basename: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
})

const OLD_HINT = '清晰力/2026-10-10.md'
const NEW_HINT = '规划/2026-10-10.md'

describe('迁移确认 · 没有要搬的', () => {
  it('空目录：说清楚「没文件」而不是报 0 个', () => {
    const plan = planMigration([], cfg(), cfg({ folder: '规划' }))
    const s = migrationSummary(plan, OLD_HINT, NEW_HINT)
    expect(s.hasWarning).toBe(false)
    expect(s.cta).toBe('知道了')
    /* 「0 个文件」听起来像坏了；要说「没有文件」并解释后果 */
    expect(s.title).toContain('没有需要迁移')
    expect(s.lines.join()).not.toContain('0 个文件')
  })
})

describe('迁移确认 · 有要搬的', () => {
  const one = () => planMigration([f('清晰力/2026-10-10.md')], cfg(), cfg({ folder: '规划' }))

  it('说清数量、来源、去向', () => {
    const s = migrationSummary(one(), OLD_HINT, NEW_HINT)
    expect(s.hasWarning).toBe(false)
    expect(s.lines.join()).toContain('1 个文件要从旧位置搬到新位置')
    expect(s.lines.join()).toContain(OLD_HINT)
    expect(s.lines.join()).toContain(NEW_HINT)
  })

  it('按钮文案带数量（不是「确定」这种空话）', () => {
    const s = migrationSummary(one(), OLD_HINT, NEW_HINT)
    expect(s.cta).toBe('搬 1 个文件')
  })

  it('旧目录里的别的文件不会被动，要说明', () => {
    const plan = planMigration(
      [f('清晰力/2026-10-10.md'), f('清晰力/会议纪要.md')],
      cfg(),
      cfg({ folder: '规划' }),
    )
    const s = migrationSummary(plan, OLD_HINT, NEW_HINT)
    expect(s.lines.join()).toContain('另外 1 个文件不是清晰力日记，不会动')
  })
})

/**
 * **跳过是最需要说清的情况。**
 * 跳过的文件留在原地 → 迁移后界面上看不到那些日期 →
 * 用户以为「都搬了」，发现少了几天才回来找原因。
 */
describe('迁移确认 · 有跳过（最需要说清）', () => {
  const conflicted = () =>
    planMigration(
      [f('清晰力/2026-10-10.md'), f('规划/2026-10-10.md')],
      cfg(),
      cfg({ folder: '规划' }),
    )

  it('有冲突时 hasWarning=true', () => {
    expect(migrationSummary(conflicted(), OLD_HINT, NEW_HINT).hasWarning).toBe(true)
  })

  it('明说「留在原地」和「界面上看不到」', () => {
    const s = migrationSummary(conflicted(), OLD_HINT, NEW_HINT)
    const text = s.lines.join()
    expect(text).toContain('留在原地')
    /* 这半句是关键：用户要知道「为什么界面里少了几天」 */
    expect(text).toContain('界面上看不到')
  })

  it('搬的数量算的是「真的会搬的」，不是总数', () => {
    /* 2 个文件，1 个冲突 → 实际只搬 1 个 */
    const plan = planMigration(
      [f('清晰力/2026-10-10.md'), f('清晰力/2026-10-11.md'), f('规划/2026-10-10.md')],
      cfg(),
      cfg({ folder: '规划' }),
    )
    const s = migrationSummary(plan, OLD_HINT, NEW_HINT)
    expect(s.lines.join()).toContain('1 个文件要从旧位置搬到新位置')
    expect(s.cta).toBe('搬 1 个文件')
  })

  it('全部冲突时按钮不写「搬 0 个」（别扭）', () => {
    const plan = planMigration(
      [f('清晰力/2026-10-10.md'), f('规划/2026-10-10.md')],
      cfg(),
      cfg({ folder: '规划' }),
    )
    /* 那一份本来就冲突，实际搬 0 个 */
    const s = migrationSummary(plan, OLD_HINT, NEW_HINT)
    expect(s.cta).not.toContain('搬 0 个')
    expect(s.cta).toBe('知道了')
  })
})

describe('路径提示', () => {
  it('目录 + 模板 → 完整路径', () => {
    expect(pathHint('清晰力', '{Y}-{M}-{D}')).toBe('清晰力/2026-10-10.md')
    expect(pathHint('日记/清晰力', '{Y}年{M}月{D}日')).toBe('日记/清晰力/2026年10月10日.md')
  })

  it('目录带尾斜杠不产生双斜杠', () => {
    expect(pathHint('清晰力/', '{Y}-{M}-{D}')).toBe('清晰力/2026-10-10.md')
  })
})