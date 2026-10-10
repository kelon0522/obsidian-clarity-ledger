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

    // 失焦立刻落盘 —— 别让250ms 防抖窗口变成丢数据的窗口
    this.flushOnBlur()

    this.addCommand({
      id: 'open-today',
      name: '打开今天的规划',
      callback: () => {
        void this.openToday()
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
    /* 用 store 里的 cur，不是 dkeyOf(new Date())。
       这条命令的语义是「打开**当前选中那天**的日记」——
       用户在视图里选了 10 月 5 日再点命令面板，期望是打开 10 月 5 日，
       而不是跳回今天。cur 已经被openToday() 切好了。*/
    const cur = useStore.getState().cur
    const store = new VaultStore(this.app, this.settings)
    const file = this.app.vault.getAbstractFileByPath(store.pathOf(cur))
    if (file) {
      await this.app.workspace.getLeaf('tab').openFile(file as never)
    } else {
      new Notice(`这一天的日记还没建：${store.pathOf(cur)}`)
    }
  }

  /**
   * 「打开今天的规划」命令 = 激活视图 + 切到今天 + 打开今天的日记。
   *
   * ## 为什么不能把这三件事拆开各自 `void` 掉
   *
   * 早先的写法是三句并发：
   *
   * ```ts
   * void this.activate()          // 异步（会等 workspace）
   * useStore.getState().setCur(今天)  // 同步
   * void this.openTodayNote()     // 读useStore.getState().cur
   * ```
   *
   * 竞态在这：**视图还没 onOpen 完，`setCur` 写的 `cur` 可能被随后的
   * `store.load()` 整个覆盖**（onOpen 里 `useStore.setState({ db, ready: true })`
   * 之后如果 `cur` 不是今天的值就晚了）。表现是「点了命令，视图打开了，
   * 但停在昨天」。
   *
   * 现在顺序执行，并且**等视图 ready 再切日期** ——
   * 上面那处setState 一定会先跑完。
   */
  private async openToday(): Promise<void> {
    await this.activate()
    /*切到今天 + 让月历翻到本月。
      **必须等 activate() 完成** —— 视图这次才刚onOpen，
      里面那次 `useStore.setState({ db, ready: true })` 会覆盖 cur。
      顺序执行才不会有「停在昨天」这个竞态。 */
    useStore.getState().setCur(dkeyOf(new Date()))
    useStore.getState().setCalMonth(new Date())
    await this.openTodayNote()
  }

  onunload(): void {
    /* Obsidian 给的是**同步接口**，这里等不到异步的 vault.modify —— 
       `void flushNow()` 只是「发起一次写」，进程可能先走。
       视图的 onClose 里有真正的 await flushNow()，那条路是可靠的；
       但**禁用插件时视图可能不走 onClose**，所以这里是兜底，不指望它一定成。

       真正兜住丢数据的是 onload 里挂的那个 blur 监听 —— 见 flushOnBlur。*/
    void flushNow()
  }

  /**
   * 窗口失焦 / 隐藏时立刻落盘。
   *
   * ## 为什么必须挂这个
   *
   * 写入是 250ms 防抖的。这250ms 里如果用户直接关掉 Obsidian
   * （Alt+F4、任务管理器、笔记本合盖、断电），**最后一次编辑就没了** ——
   * 而且丢得毫无痕迹：界面上的块还在，重开就没了。
   *
   * `onunload` 救不了这个 —— 它是同步接口，`vault.modify` 是异步的，
   * Obsidian 不会等。所以拦在**失焦**这一层：
   *
   * - 切到别的程序 → 触发失焦 → 立刻写
   * - 关窗口 → 触发 blur/visibilitychange → 立刻写
   * - 合盖 → 触发 visibilitychange → 立刻写
   *
   * 也就是说「用户离开这个插件」这个动作被我们截住了，
   * 而不是指望退出流程能等我们。
   *
   * 注册走 `this.registerDomEvent` —— 插件卸载时 Obsidian 会自动解绑，
   * 不用自己记得移除（自己的 removeEventListener 容易漏）。
   */
  private flushOnBlur(): void {
    const flush = () => {
      void flushNow()
    }
    this.registerDomEvent(window, 'blur', flush)
    /* 移动端 / 部分平台不派发 window blur，但派发 visibilitychange。
       两个都挂：谁先来算谁，flush 本身幂等（没脏数据直接返回）。*/
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
  }
}

function dkeyOf(d: Date): string {
  const p = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
