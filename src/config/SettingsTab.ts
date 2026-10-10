/**
 * 设置面板。
 *
 * ## 设计取舍：改设置后**立刻重建视图**，不做热更新
 *
 * 切目录意味着整个数据源换了 —— 文件名模板改了之后，历史文件的反解规则全变，
 * `stamp`（mtime 基线）也失效了。这种情况下「保留当前界面状态」是做不到的，
 * 硬做只会出现「界面还显示旧数据、但读的是新目录」的错配。
 *
 * 所以策略是：**关掉视图 → 重新打开**。一次可预期的重载，好过看起来能用的错配。
 */

import { Notice, PluginSettingTab, Setting, type App } from 'obsidian'
import type ClarityLedgerPlugin from '@/main'
import { DEFAULT_SETTINGS, validateSettings } from '@/config/settings'
import type { PluginSettings } from '@/config/settings'
import { VaultStore } from '@/md/vault'
import { flushNow } from '@/store'
import { VIEW_TYPE } from '@/main'

/** 占位符说明，面板里当帮助文本用 */
const TOKEN_HELP = [
  ['{Y}', '四位年，2026'],
  ['{YY}', '两位年，26'],
  ['{M}', '两位月，01–12'],
  ['{D}', '两位日，01–31'],
] as const

export class LedgerSettingTab extends PluginSettingTab {
  private plugin: ClarityLedgerPlugin

  constructor(app: App, plugin: ClarityLedgerPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    containerEl.addClass('cl-settings')

    const cfg = this.plugin.settings

    containerEl.createEl('h2', { text: '清晰力 · 每日规划' })
    containerEl.createEl('p', {
      text: '数据存在 vault 的 Markdown 文件里，能全局搜索、能 git、能跟着同步走。',
      cls: 'cl-settings-note',
    })

    /* ---------- 存储目录 ---------- */
    new Setting(containerEl)
      .setName('存储目录')
      .setDesc(`日记放在 vault 里的哪个文件夹。支持多级，如「日记/清晰力」。当前数据在：${this.plugin.currentPathHint()}`)
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.folder)
          .setValue(cfg.folder)
          .onChange(async (v) => {
            const r = validateSettings(v, cfg.nameTemplate)
            if (!r.ok) return // 不落盘，等改对
            await this.apply({ ...cfg, folder: v.trim() }, v.trim() !== cfg.folder)
          }),
      )

    /* ---------- 文件名模板 ---------- */
    new Setting(containerEl)
      .setName('文件名模板')
      .setDesc('一天一个文件，所以文件名里必须带日期。决定哪些文件算「清晰力日记」。')
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.nameTemplate)
          .setValue(cfg.nameTemplate)
          .onChange(async (v) => {
            const r = validateSettings(cfg.folder, v)
            if (!r.ok) return
            await this.apply({ ...cfg, nameTemplate: v.trim() }, v.trim() !== cfg.nameTemplate)
          }),
      )

    /* 实时预览：模板对不对，用户在这里就能看到 */
    const preview = validateSettings(cfg.folder, cfg.nameTemplate)
    containerEl.createEl('p', {
      cls: 'cl-settings-preview',
      text: preview.ok ? preview.message : '当前配置有问题：' + preview.message,
    })

    const help = containerEl.createEl('div', { cls: 'cl-settings-tokens' })
    help.createEl('span', { text: '可用占位符：' })
    for (const [tok, desc] of TOKEN_HELP) {
      const b = help.createEl('code', { text: tok })
      b.createEl('span', { text: ' ' + desc + '　' })
    }

    /* ---------- 启动时打开 ---------- */
    new Setting(containerEl)
      .setName('启动时自动打开')
      .setDesc('打开 Obsidian 就显示今日规划。关掉则只在手动点图标时打开。')
      .addToggle((t) =>
        t.setValue(cfg.openAtStartup).onChange(async (v) => {
          await this.apply({ ...cfg, openAtStartup: v }, false)
        }),
      )

    /* ---------- 手动操作 ---------- */
    const tools = new Setting(containerEl).setName('维护')
    tools.addButton((b) =>
      b
        .setButtonText('立即写入 vault')
        .setCta()
        .onClick(async () => {
          await flushNow()
          new Notice('已写入')
        }),
    )
    tools.addButton((b) =>
      b.setButtonText('恢复默认路径').onClick(async () => {
        if (cfg.folder === DEFAULT_SETTINGS.folder && cfg.nameTemplate === DEFAULT_SETTINGS.nameTemplate) {
          new Notice('已经是默认了')
          return
        }
        await this.apply({ ...cfg, ...DEFAULT_SETTINGS, openAtStartup: cfg.openAtStartup }, true)
        new Notice(`已改为 ${DEFAULT_SETTINGS.folder}/`)
        this.display()
      }),
    )
  }

  /**
   * 应用设置。
   *
   * @param reloadData 位置变了才需要重载。改「启动时打开」不需要。
   */
  private async apply(next: PluginSettings, reloadData: boolean): Promise<void> {
    const prev = this.plugin.settings
    if (JSON.stringify(prev) === JSON.stringify(next)) return

    await this.plugin.saveSettings(next)
    if (!reloadData) return

    // 先把待写的刷出去 —— 位置换了之后旧目录就写不回去了
    await flushNow()

    /* 换位置前的最后一道确认：新目录里已经有数据吗？
       用户可能只是想改文件名模板，结果新目录里是另一批历史日记 ——
       直接切过去会「看起来数据没了」。
       这个提示比事后解释清楚要省事得多。*/
    const store = new VaultStore(this.app, next)
    const occupied = await store.hasAnyFile().catch(() => false)
    if (occupied) {
      new Notice(
        `${next.folder}/ 里已经有日记文件，视图会切到那边。旧目录的文件不会被删除。`,
        8000,
      )
    }

    await this.plugin.reopenView()
  }
}

/** 供 main 用：设置改了之后重开视图 */
export async function reopenLedgerView(app: App): Promise<void> {
  const { workspace } = app
  for (const leaf of workspace.getLeavesOfType(VIEW_TYPE)) {
    await leaf.detach()
  }
  // 等一帧，让 Obsidian 真的把旧视图卸掉
  await new Promise((r) => setTimeout(r, 0))
  const leaf = workspace.getLeaf('tab')
  await leaf.setViewState({ type: VIEW_TYPE, active: true })
  await workspace.revealLeaf(leaf)
}