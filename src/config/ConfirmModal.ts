/**
 * 迁移确认弹框。
 *
 * ## 为什么用 Modal 而不是 confirm()
 *
 * `window.confirm` 在 Electron 里是**同步阻塞**的，而这里要跑
 * 「取迁移计划」这种稍重的计算 —— 阻塞主线程会卡住整个窗口。
 * Obsidian 的 `Modal` 是异步的，且样式跟着主题走。
 *
 * ## 弹框上写什么，由 `migrationSummary` 决定
 *
 * 这个组件只负责渲染和按钮行为，**文案不在这里拼** ——
 * 文案错了要能被单测抓到，所以挪到了 `src/md/confirm.ts`。
 */

import { Modal, Setting, type App } from 'obsidian'
import type { ConfirmSummary } from '@/md/confirm'

export class ConfirmModal extends Modal {
  private summary: ConfirmSummary
  private done: (ok: boolean) => void
  /** 已经答复过了。防止 close() 和 onClose() 两次调用把它定反 */
  private settled = false

  constructor(app: App, summary: ConfirmSummary, done: (ok: boolean) => void) {
    super(app)
    this.summary = summary
    this.done = done
  }

  /** 只答复一次。第一次的答复算数，后来的忽略 */
  private settle(ok: boolean): void {
    if (this.settled) return
    this.settled = true
    this.done(ok)
  }

  onOpen(): void {
    const { contentEl, titleEl } = this
    titleEl.setText(this.summary.title)

    contentEl.createEl('p', { text: '改存储位置会移动 vault 里的文件，不是只改一个设置。' })

    const ul = contentEl.createEl('ul')
    for (const line of this.summary.lines) {
      // 「⚠」开头的是警告行 —— 单独标红加粗，别淹没在普通说明里
      const li = ul.createEl('li')
      li.setText(line)
      if (line.startsWith('⚠')) {
        li.style.color = 'var(--text-error)'
        li.style.fontWeight = '600'
      }
    }

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText('取消').onClick(() => {
          this.settle(false)
          this.close()
        }),
      )
      .addButton((b) => {
        b.setButtonText(this.summary.cta).setCta()
        b.onClick(() => {
          /* **settle 必须在 close 之前。**
             `close()` 若同步触发 `onClose`，而 `onClose` 答复 false，
             那么点「确定」会被当成取消 —— 迁移永远不执行，而且
             **界面上看不出任何异常**（设置没变、没报错）。 */
          this.settle(true)
          this.close()
        })
      })
  }

  onClose(): void {
    /* 点 Esc 或点外面关闭也要给答复，否则 Promise 永远挂着，
       设置面板就卡在「既没迁移也没还原」的状态。*/
    this.settle(false)
    this.contentEl.empty()
  }
}