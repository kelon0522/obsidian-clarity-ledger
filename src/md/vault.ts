/**
 * vault 存储层。
 *
 * ## 为什么不复用 Web 版的 PersistPort
 *
 * `PersistPort` 解决的是「localStorage / 本地文件 / NAS 服务」三选一的问题，
 * 端口抽象的价值在于**上层零改动**地换底层。
 *
 * 插件版没有这个问题：vault 是唯一合理的落点，用户不该也不能把数据存到别处。
 * 为单一实现套一层接口是过度设计 —— 所以这里直接读写，不假装可切换。
 *
 * 但**产品逻辑仍然共用** `app/src/core`，那三条拍板过的规则都在那儿。
 *
 * ## 写入策略
 *
 * 只写「脏了的那几天」，不是整个库重写。理由：
 *  - vault 里可能有几千个文件，逐日扫描本身就不该在拖拽时发生
 *  - 用户手改的 Markdown 不该被无关的写入覆盖
 *
 * 写前先查文件是否存在、mtime 是不是比我们的基线新 —— 那说明用户在 Obsidian
 * 里手改了，以他的为准，不覆盖（并把内容读回来）。
 */

import type { App, TFile } from 'obsidian'
import type { DB, Day } from '@/core/types'
import { nowMin } from '@/core/time'
import { normalizeDB } from '@/core/normalize'
import { DEFAULT_SETTINGS, fullPath, parseName } from '@/config/settings'
import type { PluginSettings } from '@/config/settings'
import { parseAll, parseDay, renderDay } from './codec'

export interface LoadResult {
  db: DB
  /** 解析告警（某行时间看不懂之类的），给用户 Notice 用 */
  warn: string[]
  /** 读到的文件数，用来判断是不是空库 */
  files: number
}

export class VaultStore {
  private app: App
  private cfg: PluginSettings
  /**
   * 我们自己写过哪些文件、以及当时的 mtime。用来判断用户有没有手改。
   *
   * key 是**日期键**而不是路径 —— 换目录后 mtime 基线还能用，
   * 否则改了设置会把所有文件都当成「没写过的」，第一次编辑就误判成手改。
   */
  private stamp = new Map<string, number>()

  constructor(app: App, cfg?: PluginSettings) {
    this.app = app
    this.cfg = cfg ?? DEFAULT_SETTINGS
  }

  /** 当前生效的配置（设置面板改了之后调） */
  setConfig(cfg: PluginSettings): void {
    this.cfg = cfg
  }

  get config(): PluginSettings {
    return this.cfg
  }

  /** 某一天的 vault 内完整路径。设置面板用它显示「数据在哪」 */
  pathOf(key: string): string {
    return fullPath(this.cfg.folder, this.cfg.nameTemplate, key)
  }

  /** 列出全部日记文件，按日期升序 */
  private listFiles(): TFile[] {
    const out: TFile[] = []
    const folder = this.cfg.folder.trim().replace(/\/+$/, '')
    // getMarkdownFiles 走索引，比递归遍历快得多
    for (const f of this.app.vault.getMarkdownFiles()) {
      // 比路径而不是比 parent —— 嵌套目录时 parent 可能不是末级
      if (f.path.slice(0, f.path.length - f.basename.length - 4) !== folder) continue
      // 用**配置里的模板**反解日期，而不是硬编码 `^\d{4}-\d{2}-\d{2}$`。
      // 用户把模板改成 `{Y}年{M}月{D}日` 时，硬编码的正则会读不出任何一天。
      if (parseName(this.cfg.nameTemplate, f.basename)) out.push(f)
    }
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  private keyOf(f: TFile): string | null {
    return parseName(this.cfg.nameTemplate, f.basename)
  }

  /** 读全库。启动时调一次。 */
  async load(): Promise<LoadResult> {
    const files = this.listFiles()
    if (!files.length) return { db: {}, warn: [], files: 0 }

    const payload: { key: string; md: string }[] = []
    for (const f of files) {
      const k = this.keyOf(f)
      if (!k) continue
      try {
        payload.push({ key: k, md: await this.app.vault.cachedRead(f) })
        this.stamp.set(k, f.stat.mtime)
      } catch {
        // 单个文件读失败不该让整库打不开，跳过
      }
    }

    const { db, warn } = parseAll(payload)

    // 走 normalizeDB：字段白名单化 + 容错，所有数据来源的唯一入口。
    // 少这一步的话，手改坏的数据（缺 pd / ad 缺失）会直接进内存炸渲染。
    const clean = normalizeDB(db) as DB
    // 逐日补 _e（最后编辑时刻）。Markdown 里没存这个字段，
    // 读进来时统一设成「刚读过」，避免和写入路径的语义打架。
    for (const k of Object.keys(clean)) clean[k]!._e = clean[k]!._e ?? nowMin()
    return { db: clean, warn, files: payload.length }
  }

  /**
   * 写一天。文件不存在就建，存在就改。
   *
   * `force=true` 时跳过「用户手改过」的检查 —— 明确知道自己在覆盖时用。
   */
  async writeDay(key: string, day: Day, force = false): Promise<void> {
    const md = renderDay(day)
    const path = this.pathOf(key)
    const existing = this.app.vault.getAbstractFileByPath(path) as TFile | null

    if (!existing) {
      await this.ensureFolder()
      const f = await this.app.vault.create(path, md)
      this.stamp.set(key, f.stat.mtime)
      return
    }

    /* 用户在 Obsidian 里手改过这个文件 → 不覆盖。
       理由：这是用户的笔记，不是插件的私有数据库。
       只更新基线（免得下次又判成改过），内容由调用方调 readDay 拿。 */
    const base = this.stamp.get(key)
    if (!force && base != null && existing.stat.mtime > base + 1) {
      this.stamp.set(key, existing.stat.mtime)
      return
    }

    await this.app.vault.modify(existing, md)
    this.stamp.set(key, existing.stat.mtime)
  }

  /** 显式覆盖（用户自己触发的操作，比如导入） */
  async forceWriteDay(key: string, day: Day): Promise<void> {
    return this.writeDay(key, day, true)
  }

  private async ensureFolder(): Promise<void> {
    const parts = this.cfg.folder.trim().replace(/\/+$/, '').split('/')
    let cur = ''
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p
      if (!p) continue
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        await this.app.vault.createFolder(cur)
      }
    }
  }

  /** 读单天（外部改动后同步用） */
  async readDay(key: string): Promise<Day | null> {
    const path = this.pathOf(key)
    const f = this.app.vault.getAbstractFileByPath(path) as TFile | null
    if (!f) return null
    try {
      const md = await this.app.vault.cachedRead(f)
      this.stamp.set(key, f.stat.mtime)
      const d = parseDay(md, key).day!
      const clean = normalizeDayViaDB(d)
      clean._e = nowMin()
      return clean
    } catch {
      return null
    }
  }

  /** 删除一天。任务全删完时不该留个空文件占日历格子 */
  async removeDay(key: string): Promise<void> {
    const path = this.pathOf(key)
    const f = this.app.vault.getAbstractFileByPath(path)
    if (f) await this.app.vault.delete(f)
    this.stamp.delete(key)
  }

  /**
   * 当前目录下有没有任何日记文件。
   *
   * 设置面板切目录时用：切过去之前先看看那边有没有东西，
   * 别把「那边是空的」当成「数据丢了」。
   */
  async hasAnyFile(): Promise<boolean> {
    return this.listFiles().length > 0
  }
}

/** 单天过一遍 normalize（借用 normalizeDB 的格式兼容，形态只有一个 day 时也认） */
function normalizeDayViaDB(day: Day): Day {
  return normalizeDB({ [day.created]: day })[day.created]!
}
