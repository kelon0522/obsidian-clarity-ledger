/**
 * 存储位置迁移 —— **纯逻辑，不碰 vault**。
 *
 * ## 为什么要单独抽出来
 *
 * 「改目录后把旧文件搬过去并按新规则改名」这件事，
 * 直觉写法是在设置面板里遍历 `vault.getMarkdownFiles()` 然后 rename。
 * 那样写有个问题：**没法测**。
 *
 * 迁移是**破坏性操作** —— 搬错了、改名错了，用户的数据就散在两个地方。
 * 而它的失败方式全是静默的（少搬一个文件，界面上看不出来，
 * 只是那天没数据）。所以必须能单测：
 *
 *   给一批文件 + 旧配置 + 新配置 → 得到一张明确的搬迁表
 *
 * `planMigration` 就是这张表。执行在 `VaultStore.migrateTo`。
 *
 * ## 迁移的两条规则
 *
 * 1. **只搬「自己人的文件」** —— 文件名要能用**旧模板**反解出日期。
 *    用户在那个目录里放的别的东西（笔记、附件）一律不动。
 * 2. **目标同名就让路** —— 那边已经有文件了，绝不覆盖。
 *    那是另一个日期的数据，或者用户自己写的。跳过并报给用户。
 */

import { fullPath, parseName } from '@/config/settings'
import type { PluginSettings } from '@/config/settings'

/** 一份 vault 里的 md 文件（只要这两个字段，测试里就能手搓） */
export interface FileRef {
  path: string
  /** 不含扩展名 —— 与 Obsidian 的 `TFile.basename` 一致 */
  basename: string
}

export type MoveKind =
  /** 位置和名字都不变 */
  | 'same'
  /** 同目录内改名（只改了模板） */
  | 'rename'
  /** 换目录（可能同时改名） */
  | 'move'

export interface MigrationItem {
  /** 日期键，如 `2026-10-10` */
  key: string
  fromPath: string
  toPath: string
  kind: MoveKind
  /**
   * 目标位置已被占用 → **不许搬**。
   * `null` 表示没冲突（可以直接执行）。
   *
   * 冲突分两种，含义完全不同：
   * - `same-day` —— 同一个日期在两个地方各有一份。通常是「复制了一份备份」，
   *   保留旧的那份是对的，删新的才是危险的
   * - `name-clash` —— 两个不同日期渲染成同一个文件名，说明新模板有问题
   *   （`validateSettings` 只抽样验过两天）
   */
  conflict: 'same-day' | 'name-clash' | null
  /** 冲突时，已经占着目标路径的那个文件 */
  occupiedBy?: string
}

export interface MigrationPlan {
  items: MigrationItem[]
  /** 旧目录里不是清晰力数据的文件，一个都不该动 */
  untouched: string[]
  oldFolder: string
  newFolder: string
  /** 旧目录里有多少个清晰力文件 */
  total: number
}

/**
 * 文件是不是**直接**放在某个目录下（不含子目录）。
 *
 * **必须是「直接」而不是「前缀匹配」。**
 * 前缀写法 `'清晰力/sub/x.md'.startsWith('清晰力/')` 为 true，
 * 于是子目录里的文件也会被当成「旧目录的数据」搬走 ——
 * 而那些文件是用户在子目录里自己放的东西，`listFiles` 读不到它们
 * （`VaultStore.listFiles` 用的是同样的前缀判断，所以界面上看不到，
 * 但迁移会把它搬走）。**搬走界面上看不见的文件 = 静默的数据损坏。**
 *
 * 判断方式：去掉目录前缀和文件名后，剩下的部分不含 `/`。
 */
function directlyInFolder(path: string, folder: string): boolean {
  const f = folder.trim().replace(/\/+$/, '')
  if (!f) return false
  if (!path.startsWith(f + '/')) return false
  const rest = path.slice(f.length + 1)
  return !rest.includes('/')
}

/**
 * 算出迁移表。**不执行任何操作。**
 *
 * @param allFiles  vault 里全部 md 文件（不需要预先过滤目录，
 *                  因为「目标位置有没有被占」这个问题需要看全量）
 */
export function planMigration(
  allFiles: readonly FileRef[],
  oldCfg: PluginSettings,
  newCfg: PluginSettings,
): MigrationPlan {
  const items: MigrationItem[] = []
  const untouched: string[] = []

  const oldFolder = oldCfg.folder.trim().replace(/\/+$/, '')
  const newFolder = newCfg.folder.trim().replace(/\/+$/, '')
  const unchanged = oldFolder === newFolder && oldCfg.nameTemplate === newCfg.nameTemplate

  // 所有路径的集合，用来判「目标位置被谁占了」
  const pathSet = new Set(allFiles.map((f) => f.path))

  // 先扫出所有「自己人的文件」—— 它们的路径随后会被腾空
  const mine: { key: string; file: FileRef }[] = []
  for (const f of allFiles) {
    if (!directlyInFolder(f.path, oldFolder)) continue
    const key = parseName(oldCfg.nameTemplate, f.basename)
    if (!key) {
      // 同目录下但文件名对不上模板 —— 不是我们的数据，别碰
      untouched.push(f.path)
      continue
    }
    mine.push({ key, file: f })
  }

  // 会被腾空的目标路径：这些位置上的旧文件正在搬走，不算「被占」
  const vacating = new Set(mine.map((m) => m.file.path))
  // 已经分配出去的目标：两个日期渲染成同一个名字时，后一个要标冲突
  const claimed = new Map<string, string>()

  for (const { key, file } of mine) {
    const toPath = fullPath(newCfg.folder, newCfg.nameTemplate, key)

    if (unchanged || toPath === file.path) {
      items.push({ key, fromPath: file.path, toPath, kind: 'same', conflict: null })
      continue
    }

    /* 冲突初值必须是 `null`。
       早先写成 `'same-day'`，于是「目标确实被占」和「什么都没发生」
       两条路径的conflict 值完全一样 —— **每个文件都被标成冲突**，
       迁移会全部跳过，但表看起来又是「算过了」，静默得毫无痕迹。
       `if (!conflict) claimed.set(...)` 也因此永远不成立，
       name-clash 那条分支根本走不到。*/
    let conflict: MigrationItem['conflict'] = null
    let occupiedBy: string | undefined

    if (claimed.has(toPath)) {
      // 两个不同的日期渲染成同一个文件名 —— 新模板有问题
      conflict = 'name-clash'
      occupiedBy = claimed.get(toPath)
    } else if (pathSet.has(toPath) && !vacating.has(toPath)) {
      // 目标位置上有个不会被搬走的文件
      conflict = 'same-day'
      occupiedBy = toPath
    }

    // 只有成功分配出去的才记 —— 冲突的那个没有资格占位
    if (!conflict) claimed.set(toPath, key)

    items.push({
      key,
      fromPath: file.path,
      toPath,
      kind: directlyInFolder(toPath, newFolder) === directlyInFolder(file.path, newFolder) ? 'rename' : 'move',
      conflict,
      occupiedBy,
    })
  }

  return {
    items,
    untouched,
    oldFolder,
    newFolder,
    total: mine.length,
  }
}

/** 迁移结果汇总 —— 给用户看的说法从这里出 */
export interface MigrationOutcome {
  /** 改了名的（同目录内） */
  renamed: number
  /** 换了目录的 */
  moved: number
  /** 因为同名没动的 */
  skipped: { key: string; fromPath: string; reason: 'same-day' | 'name-clash' }[]
  /** 执行时报错的 */
  failed: { path: string; error: string }[]
  /** 旧目录搬完是否空了（空了也**不删** —— 那是用户自己建的目录） */
  oldFolderEmpty: boolean
  /** 旧目录里没动的文件数 */
  untouched: number
}

export function emptyOutcome(): MigrationOutcome {
  return {
    renamed: 0,
    moved: 0,
    skipped: [],
    failed: [],
    oldFolderEmpty: false,
    untouched: 0,
  }
}

/** 一句话汇总，Notice 用 */
export function describeOutcome(o: MigrationOutcome): string {
  const parts: string[] = []
  if (o.moved) parts.push(`移动 ${o.moved} 个`)
  if (o.renamed) parts.push(`改名 ${o.renamed} 个`)
  if (o.skipped.length) parts.push(`跳过 ${o.skipped.length} 个（目标已有同名文件）`)
  if (o.failed.length) parts.push(`失败 ${o.failed.length} 个`)
  if (!parts.length) return '没有需要迁移的文件'
  return `已${parts.join('，')}`
}
