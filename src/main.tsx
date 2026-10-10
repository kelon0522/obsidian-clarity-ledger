/**
 * Obsidian 视图 + 插件入口。
 *
 * React 挂载用 `createRoot(this.contentEl)`，关闭时**必须 unmount**，
 * 否则视图开合几次就内存泄漏（Obsidian 官方文档的明确要求）。
 */

import { ItemView, Notice, Plugin, WorkspaceLeaf } from 'obsidian'
import { createRoot, type Root } from 'react-dom/client'
import { LedgerView } from '@/view/LedgerView'
import { VaultStore } from '@/md/vault'
import { LedgerSettingTab, reopenLedgerView } from '@/config/SettingsTab'
import { DEFAULT_SETTINGS, renderName, withDefaults } from '@/config/settings'
import type { PluginSettings } from '@/config/settings'
import { bindVault, flushNow, useStore } from '@/store'

export const VIEW_TYPE = 'clarity-ledger-view'

/**
 * 视图读配置的通道。
 *
 * 早先的写法是视图自己去 `app.plugins.getPlugin('clarity-ledger')` 拿配置 ——
 * 那是**从插件对象往回找自己**，方向反了（Obsidian 的 `App` 类型也没有
 * `plugins`，是我记错了 API）。
 *
 * 改成插件注册视图时通过闭包注入配置：视图不关心配置从哪来，
 * 也不该知道「插件」这个概念的存在。
 */
export function createLedgerView(getCfg: () => PluginSettings) {
  return class LedgerItemView extends ItemView {
    private root: Root | null = null

    constructor(leaf: WorkspaceLeaf) {
      super(leaf)
    }

    getViewType(): string {
      return VIEW_TYPE
    }

    getDisplayText(): string {
      return '清晰力'
    }

    getIcon(): string {
      return 'calendar-check'
    }

    async onOpen(): Promise<void> {
      // 配置读不到就退回默认，绝不能因为配置坏了整个插件起不来
      const cfg = withDefaults(getCfg())
      const store = new VaultStore(this.app, cfg)
      // 绑定 vault 必须在挂载之前 —— 组件挂上来可能立刻读数据
      bindVault(store, (v) => useStore.setState({ saving: v }))

      const content = this.contentEl
      content.empty()
      content.addClass('clarity-ledger-container')

      const host = content.createDiv({ cls: 'cl-host' })
      this.root = createRoot(host)
      this.root.render(<LedgerView />)

      // 读库是异步的，等读完再 setState 让界面从「读取中」切出来。
      // 不这么做的话首屏会用空库渲染一次，用户看到一闪而过的空日历。
      try {
        const { db, warn, files } = await store.load()
        useStore.setState({ db, ready: true })
        if (!files) {
          // 第一次用：建今天这一天，免得对着空界面不知道从哪下手
          const cur = useStore.getState().cur
          await store.writeDay(cur, { tasks: [], note: '', created: cur })
          new Notice(`已创建今天的清晰力日记：${store.pathOf(cur)}`)
        } else if (warn.length) {
          new Notice(`${warn.length} 处数据没看懂，详见 ${cfg.folder}/ 里的文件`, 8000)
        }
      } catch (e) {
        useStore.setState({ ready: true })
        new Notice(`读取失败：${(e as Error)?.message ?? e}`)
      }
    }

    async onClose(): Promise<void> {
      // 关视图前把待写的东西刷出去。
      // vault.modify 是异步的，等不到就会丢最后一次修改。
      await flushNow()
      this.root?.unmount()
      this.root = null
    }
  }
}

export default class ClarityLedgerPlugin extends Plugin {
  /** 存储位置与文件名模板。永远经过 withDefaults 归一化，不信 data.json 的内容 */
  settings: PluginSettings = { ...DEFAULT_SETTINGS }

  async onload(): Promise<void> {
    // 配置必须**先**读出来：视图打开时立刻要读数据
    this.settings = withDefaults(await this.loadData())
    if (!(await this.loadData())) await this.saveData(this.settings)

    this.registerView(VIEW_TYPE, (leaf) => new (createLedgerView(() => this.settings))(leaf))
    this.addSettingTab(new LedgerSettingTab(this.app, this))

    /* 左侧ribbon 图标。图标名用 Obsidian 内置的，
       没有自己画 —— 插件图标在设置里显示，内置的更统一。 */
    this.addRibbonIcon('calendar-check', '打开清晰力', () => {
      void this.activate()
    })

    this.addCommand({
      id: 'open-today',
      name: '打开今天的规划',
      callback: () => {
        void this.activate()
        const s = useStore.getState()
        void useStore.getState().setCur(dkeyOf(new Date()))
        void this.openTodayNote()
        void s
      },
    })

    this.addCommand({
      id: 'flush',
      name: '立即写入 vault',
      callback: () => {
        void flushNow().then(() => new Notice('已写入'))
      },
    })

    this.addCommand({
      id: 'reveal-note',
      name: '在笔记中打开今天的日记',
      callback: () => {
        void this.openTodayNote()
      },
    })

    // 恢复上次打开的视图
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.openAtStartup) void this.activate()
    })
  }

  async saveSettings(next: PluginSettings): Promise<void> {
    this.settings = next
    await this.saveData(next)
  }

  /** 设置里展示「当前数据在哪」用 */
  currentPathHint(): string {
    return `${this.settings.folder}/${renderName(this.settings.nameTemplate, '2026-10-10')}.md`
  }

  /** 改完存储位置后重开视图，让界面从新位置重新读一遍 */
  async reopenView(): Promise<void> {
    await flushNow()
    await reopenLedgerView(this.app)
  }

  private async activate(): Promise<void> {
    const { workspace } = this.app
    const existing = workspace.getLeavesOfType(VIEW_TYPE)
    if (existing.length) {
      await workspace.revealLeaf(existing[0]!)
      return
    }
    const leaf = workspace.getLeaf('tab')
    await leaf.setViewState({ type: VIEW_TYPE, active: true })
    await workspace.revealLeaf(leaf)
  }

  private async openTodayNote(): Promise<void> {
    const cur = useStore.getState().cur
    const store = new VaultStore(this.app, this.settings)
    const file = this.app.vault.getAbstractFileByPath(store.pathOf(cur))
    if (file) {
      await this.app.workspace.getLeaf('tab').openFile(file as never)
    } else {
      new Notice(`今天的日记还没建：${store.pathOf(cur)}`)
    }
  }

  onunload(): void {
    // 同步接口，等不到异步写。视图的 onClose 里已经 flush 过了，
    // 这里只是兜底 —— 插件被禁用时视图可能没走 onClose
    void flushNow()
  }
}

function dkeyOf(d: Date): string {
  const p = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
