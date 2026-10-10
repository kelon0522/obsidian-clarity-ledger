/**
 * 迁移确认弹框的内容生成 —— **纯逻辑，不碰 Obsidian**。
 *
 * ## 为什么单独抽出来
 *
 * 弹框上写的每一句话都会影响用户「要不要点确定」。
 * 措辞含糊（比如「即将修改配置」）会让人误以为只是改个设置，
 * 而实际上是**搬文件**。
 *
 * 这段文字必须在弹框之前就说清楚三件事：
 * 1. 有多少文件会被**搬走**
 * 2. 旧目录会不会**留下东西**
 * 3. **有跳过的吗**（跳过 = 那部分数据留在原地，界面里看不到）
 *
 * 放在一起测，是因为「说错」和「算错」都是同一种后果：
 * 用户以为全搬了，实际只搬了一半。
 */

import type { MigrationPlan } from './migrate'
import { renderName } from '@/config/settings'

export interface ConfirmSummary {
  /** 弹框标题 */
  title: string
  /** 正文段落（每条一行） */
  lines: string[]
  /** 主按钮文案。**必须把破坏性后果写进按钮本身** */
  cta: string
  /** 有没有需要用户特别留意的情况（跳过 / 旧目录残留） */
  hasWarning: boolean
}

/**
 * 迁移确认内容。
 *
 * @param plan    已算好的迁移表
 * @param oldHint 旧位置的可读写法（如`清晰力/2026-10-10.md`）
 * @param newHint 新位置的可读写法
 */
export function migrationSummary(
  plan: MigrationPlan,
  oldHint: string,
  newHint: string,
): ConfirmSummary {
  const actionable = plan.items.filter((i) => i.kind !== 'same')
  const conflicts = actionable.filter((i) => i.conflict)
  const moves = actionable.length - conflicts.length

  const lines: string[] = []

  if (!actionable.length) {
    return {
      title: '没有需要迁移的文件',
      lines: ['位置已经改了，但旧位置没有清晰力日记文件。', '切换后从今天开始记就行。'],
      cta: '知道了',
      hasWarning: false,
    }
  }

  lines.push(`${moves} 个文件要从旧位置搬到新位置。`)

  if (conflicts.length) {
    /* 这条必须显眼 —— 「跳过的留在原地」意味着界面上会看不到它们，
       而用户以为「都搬了」。*/
    lines.push(
      `⚠ 其中 ${conflicts.length} 个会**留在原地**：目标位置已经有同名文件，` +
        `不会覆盖。迁移后这些日期在界面上看不到，需要你手工处理。`,
    )
  }

  if (plan.untouched.length) {
    lines.push(`旧位置里的另外 ${plan.untouched.length} 个文件不是清晰力日记，不会动。`)
  }

  lines.push(`从：${oldHint}`)
  lines.push(`到：${newHint}`)

  return {
    title: '确认迁移文件？',
    lines,
    // 破坏性后果写进按钮本身 —— 这是最后一次确认的机会
    cta: moves > 0 ? `搬 ${moves} 个文件` : '知道了',
    hasWarning: conflicts.length > 0,
  }
}

/** 「某位置的某个文件」长什么样，用于示例 */
export function pathHint(folder: string, tpl: string): string {
  const f = folder.trim().replace(/\/+$/, '')
  return `${f}/${renderName(tpl, '2026-10-10')}.md`
}