/**
 * 设置面板。
 *
 * ## 交互约定：**失焦才生效**，不是每敲一个键就生效
 *
 * 早先两个文本框都挂 `onChange`，于是：
 *
 * - 删「清晰力」的「力」→ 立刻校验 → 不合法 → 不落盘
 * - 顺手敲成「清晰力2」→ 合法 → **立刻迁移**！文件已经在搬了
 * - 用户还想改成「清晰力22」，目录里已经多了一个空文件夹
 *
 * 用户在文本框里「改一下」的过程中会经过无数个中间态，
 * **每个中间态都触发一次破坏性操作是不可接受的**。
 * 所以改成 `onBlur`：只有离开输入框、且内容确实变了才提交。
 * 按 Enter 也提交（`onBlur` 会跟着触发），Esc 撤销本次编辑。
 *
 * ## 设计取舍：改设置后**立刻重建视图**，不做热更新
 *
 * 切目录意味着整个数据源换了 —— 文件名模板改了之后，历史文件的反解规则全变，
 * `stamp`（mtime 基线）也失效了。这种情况下「保留当前界面状态」是做不到的，
 * 硬做只会出现「界面还显示旧数据、但读的是新目录」的错配。
 *
 * 所以策略是：**关掉视图 → 重新打开**。一次可预期的重载，好过看起来能用的错配。
 */

import { Notice, PluginSettingTab, Setting, type App, type TextComponent } from 'obsidian'
import type ClarityLedgerPlugin from '@/main'
import { DEFAULT_SETTINGS, validateSettings } from '@/config/settings'
import type { PluginSettings } from '@/config/settings'
import { VaultStore } from '@/md/vault'
import { describeOutcome, planMigration } from '@/md/migrate'
import type { FileRef, MigrationOutcome } from '@/md/migrate'
import { migrationSummary, pathHint } from '@/md/confirm'
import { ConfirmModal } from '@/config/ConfirmModal'
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
  /** 迁移进行中。防止连着两次 blur 触发两个迁移 */
  private migrating = false

  constructor(app: App, plugin: ClarityLedgerPlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    containerEl.addClass('cl-settings')

    const cfg = this.plugin.settings

    /* 用 `new Setting().setHeading()` 而不是 `containerEl.createEl('h2')`。
       官方审核明确要求统一 UI（**Error 级别，不过审**），
       而且 `setHeading()` 生成的标题会自动跟随用户的字体与字号设置 ——
       直接createEl 出来的 h2 不跟主题，视觉上会突兀。*/
    new Setting(containerEl).setName('清晰力 · 每日规划').setHeading()
    containerEl.createEl('p', {
      text: '数据存在 vault 的 Markdown 文件里，能全局搜索、能 Git、能跟着同步走。',
      cls: 'cl-settings-note',
    })

    /* ---------- 存储目录 ---------- */
    const folderHint = containerEl.createEl('p', { cls: 'cl-settings-hint' })

    new Setting(containerEl)
      .setName('存储目录')
      .setDesc(
        '日记放在 vault 里的哪个文件夹。支持多级，如「日记/清晰力」。**改完离开输入框才生效**，已有文件会搬过去。',
      )
      .addText((t) => {
        t.setPlaceholder(DEFAULT_SETTINGS.folder).setValue(cfg.folder)
        // 输入时只更新提示，不落盘 —— 中间态不该触发迁移
        t.onChange((v) => this.renderHint(folderHint, v, cfg.nameTemplate, cfg.folder))
        this.onCommit(t, (v) => this.commitLocation(v, 'folder', cfg))
        return t
      })
    this.renderHint(folderHint, cfg.folder, cfg.nameTemplate, cfg.folder)

    /* ---------- 文件名模板 ---------- */
    const tplHint = containerEl.createEl('p', { cls: 'cl-settings-hint' })

    new Setting(containerEl)
      .setName('文件名模板')
      .setDesc(
        '一天一个文件，所以文件名里必须带日期。决定哪些文件算「清晰力日记」。**改完离开输入框才生效**，已有文件会按新规则改名。',
      )
      .addText((t) => {
        t.setPlaceholder(DEFAULT_SETTINGS.nameTemplate).setValue(cfg.nameTemplate)
        t.onChange((v) => this.renderHint(tplHint, cfg.folder, v, cfg.nameTemplate))
        this.onCommit(t, (v) => this.commitLocation(v, 'nameTemplate', cfg))
        return t
      })
    this.renderHint(tplHint, cfg.folder, cfg.nameTemplate, cfg.nameTemplate)

    /* 用 `createDiv` / `createSpan` 这种**具体 helper**，不要 `createEl('div')`。
     *
     * 审核的 `prefer-create-el` 报的正是这个：
     *   Use 'containerEl.createDiv(...)' instead of 'containerEl.createEl('div', ...)'
     *
     * ⚠️ 这里曾经写着「规则把 `createEl` 误判成了 `document.createElement `」——
     * **那是错的**。规则要求的是用现成的 `createDiv` / `createSpan`
     * （更短、而且参数一律走 options 对象）。本仓库里从来没有
     * `document.createElement`，别顺着那条错误注释去找。 */
    const help = containerEl.createDiv({ cls: 'cl-settings-tokens' })
    help.createSpan({ text: '可用占位符：' })
    for (const [tok, desc] of TOKEN_HELP) {
      const b = help.createEl('code', { text: tok })
      b.createSpan({ text: ' ' + desc + '　' })
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

    /* 「立即写入 vault」与「恢复默认路径」两个按钮已删（2026-10-10）。
       - 前者与命令面板的同名命令重复，而且会在没东西可写时撒谎说「已写入」
       - 后者语义是「撤销」、行为是「搬文件」，不配确认就不该暴露入口
         （手动改文本框同样是搬文件，所以危险路径本来就没消失，
          真正的修法是给迁移加确认 —— 见 commitLocation）

       写入本身是 250ms 防抖自动的，关视图和卸载时也会 flush。
       真需要立刻落盘：Ctrl+P 搜「立即写入 vault」。 */
  }

  /**
   * 把「失焦才提交」挂到输入框上。
   *
   * **Obsidian 的 `TextComponent` 没有 `onBlur`**，只有 `onChange`
   * （每敲一个键就触发）。而迁移是破坏性操作 —— 用户在输入过程中会经过
   * 无数中间态（删到「清晰力2」就已经是合法目录了），
   * 每个中间态都搬一次文件是不可接受的。所以自己往 `inputEl` 上挂。
   *
   * 两个细节：
   * - **Enter 也提交** —— 输入框里按回车是「我改完了」的通用信号，
   *   `blur()` 会顺带触发 blur 监听
   * - **Esc 撤销** —— 把值还原成进入编辑前的。用户按 Esc 的意思
   *   是「算了」，不该被当成一次提交
   */
  private onCommit(t: TextComponent, commit: (value: string) => Promise<void>): void {
    const input = t.inputEl
    const original = t.getValue()

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        input.blur()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        t.setValue(original)
        input.blur()
      }
    })

    input.addEventListener('blur', () => {
      const v = input.value.trim()
      // 内容没变就别折腾 —— 光标划过去也会触发 blur
      if (v === original) return
      void commit(v)
    })
  }

  /**
   * 输入框下方的实时提示。
   *
   * @param draftFolder 正在输入的目录（可能还没生效）
   * @param draftTpl    正在输入的模板
   * @param savedFolder 已生效的目录 —— 用它区分「当前在」还是「会搬到」
   */
  private renderHint(
    el: HTMLElement,
    draftFolder: string,
    draftTpl: string,
    savedFolder: string,
  ): void {
    const v = validateSettings(draftFolder, draftTpl)
    el.empty()
    if (!v.ok) {
      el.addClass('is-bad')
      el.setText('✗ ' + v.message)
      return
    }
    el.removeClass('is-bad')
    const target = `${draftFolder.trim().replace(/\/+$/, '')}/${v.message.replace('示例：', '')}`
    el.setText(
      draftFolder.trim() === savedFolder.trim()
        ? `✓ 当前数据在：${target}`
        : `✓ 生效后会搬到：${target}`,
    )
  }

  /**
   * 离开输入框时的提交。
   *
   * @param field 改的是哪个字段
   * @param base  当前配置（用于判断另一个字段没变）
   */
  private async commitLocation(
    value: string,
    field: 'folder' | 'nameTemplate',
    base: PluginSettings,
  ): Promise<void> {
    const next: PluginSettings =
      field === 'folder' ? { ...base, folder: value } : { ...base, nameTemplate: value }

    // 内容没变就别折腾 —— 光标划过去也会触发 blur
    if (JSON.stringify(next) === JSON.stringify(this.plugin.settings)) return

    const v = validateSettings(next.folder, next.nameTemplate)
    if (!v.ok) {
      new Notice(`配置没生效：${v.message}`, 8000)
      // 面板上的输入框还留着用户的字，刷新回填成实际生效的值
      this.display()
      return
    }

    /* 迁移是破坏性操作 —— 搬的是用户的数据。
       **确认必须在这里，而不只是「有个恢复默认的按钮时才要」。**
       手动改文本框和点「恢复默认路径」走的是同一条路，
       所以确认要挂在「提交」这一层，不挂在某个入口上。*/
    if (!(await this.confirmMigration(next))) {
      this.display() // 还原输入框
      return
    }

    await this.apply(next, true)
    this.display()
  }

  /**
   * 弹框确认。
   *
   * **文案必须说清三件事**：有多少文件会被搬走、旧目录会不会留下东西、
   * 有没有跳过的（跳过 = 那部分数据迁移后界面上看不到）。
   * 措辞含糊的代价是「用户以为只改了设置」，而文件已经被搬走了。
   *
   * @returns 用户点了确定才继续
   */
  private async confirmMigration(next: PluginSettings): Promise<boolean> {
    const prev = this.plugin.settings
    const all: FileRef[] = this.app.vault.getMarkdownFiles().map((f) => ({
      path: f.path,
      basename: f.basename,
    }))
    const plan = planMigration(all, prev, next)
    const summary = migrationSummary(
      plan,
      pathHint(prev.folder, prev.nameTemplate),
      pathHint(next.folder, next.nameTemplate),
    )

    // 压根没文件要搬 → 不拦，但要解释「为什么没有」
    if (!plan.items.some((i) => i.kind !== 'same')) {
      new Notice('没有需要迁移的文件，位置已改')
      return true
    }

    return new Promise<boolean>((resolve) => {
      new ConfirmModal(this.app, summary, resolve).open()
    })
  }

  /**
   * 应用设置。
   *
   * @param reloadData 位置变了才需要重载。改「启动时打开」不需要。
   */
  private async apply(next: PluginSettings, reloadData: boolean): Promise<void> {
    const prev = this.plugin.settings
    if (JSON.stringify(prev) === JSON.stringify(next)) return
    if (this.migrating) return

    if (!reloadData) {
      await this.plugin.saveSettings(next)
      return
    }

    this.migrating = true
    try {
      // 待写的数据必须先落到旧位置，否则它永远留在旧目录没人搬
      await flushNow()

      /* 目标目录里本来就有清晰力数据吗？
         迁移的冲突检测只管「同一天撞同一路径」，管不了「那边是另一批日记」——
         后者不冲突、文件都搬过去了，但用户看到的是**新目录那批数据**，
         旧的那批（还在旧目录）看起来像消失了。这个提示不能省。
         用新配置建一个 store 去查 —— 它扫的是目标目录。*/
      const probe = new VaultStore(this.app, next)
      const planTargetOccupied = await probe.hasAnyFile().catch(() => false)

      /* 迁移。用**旧配置**建store —— 它要扫的是旧目录。
         顺序很关键：先按旧配置规划，再把配置切过去。
         反过来的话 listFiles 读的是新目录，规划出来是空的。*/
      const mover = new VaultStore(this.app, prev)
      const outcome = await mover.migrateTo(next)

      // 全部失败时**不落盘** —— 配置指向一个搬不过去的地方，
      // 用户的界面会「看起来数据全没了」，比报错更难恢复
      const allFailed = outcome.failed.length > 0 && outcome.moved + outcome.renamed === 0
      if (allFailed) {
        new Notice(`迁移失败，配置未改动：${outcome.failed[0]?.error ?? '未知错误'}`, 12000)
        return
      }

      await this.plugin.saveSettings(next)
      await this.plugin.reopenView()
      this.report(outcome, planTargetOccupied)
    } finally {
      this.migrating = false
    }
  }

  /**
   * 把迁移结果告诉用户。
   *
   * **跳过的和失败的必须点名。** 只报「已移动 3 个」的话，
   * 用户看到日历上少了两天却不知道文件在哪 —— 那比报错难查得多。
   *
   * @param targetHadData 目标目录里本来就有清晰力数据（非冲突，只是那边是另一批日记）
   */
  private report(outcome: MigrationOutcome, targetHadData = false): void {
    const summary = describeOutcome(outcome)
    const clean = !outcome.failed.length && !outcome.skipped.length && !targetHadData
    if (clean) {
      new Notice(summary, 5000)
      return
    }

    const lines = [summary]
    for (const s of outcome.skipped.slice(0, 5)) {
      lines.push(
        s.reason === 'name-clash'
          ? `· ${s.key} 两个日期撞到同一文件名，没动：${s.fromPath}`
          : `· ${s.key} 目标已有同名文件，没动：${s.fromPath}`,
      )
    }
    for (const f of outcome.failed.slice(0, 5)) lines.push(`· ${f.path}：${f.error}`)
    if (outcome.skipped.length + outcome.failed.length > 5) {
      lines.push('…（其余的自己比对旧目录和新目录）')
    }
    if (targetHadData) {
      lines.push('新目录里本来就有另一批日记，视图现在显示的是那批。旧目录的文件没删。')
    }
    if (outcome.oldFolderEmpty && outcome.skipped.length === 0 && !targetHadData) {
      lines.push('旧目录已空，可以手动删掉')
    }
    new Notice(lines.join('\n'), 12000)
  }
}

/** 供 main 用：设置改了之后重开视图 */
export async function reopenLedgerView(app: App): Promise<void> {
  const { workspace } = app
  for (const leaf of workspace.getLeavesOfType(VIEW_TYPE)) {
    await leaf.detach()
  }
  /* 等一帧，让 Obsidian 真的把旧视图卸载完。
     原先写的是 `await new Promise((r) => setTimeout(r, 0))`，
     官方审核提了两条：
       - `Unexpected await of a non-Promise`（tslib 的 `__awaiter` 判据太粗，
         `new Promise(r => setTimeout(r, 0))` 被当成同步表达式）
       - `Use 'window.setTimeout()' instead of 'setTimeout()'`
     改用 `requestAnimationFrame`：语义更准（就是「等下一帧」），
     顺带两个警告一起消掉。
     ⚠️ 要写成 async 回调形式 —— 直接传 `requestAnimationFrame` 作为 then 回调
     会把时间戳（第一个参数）当 resolve 的值传进去。 */
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
  const leaf = workspace.getLeaf('tab')
  await leaf.setViewState({ type: VIEW_TYPE, active: true })
  await workspace.revealLeaf(leaf)
}
