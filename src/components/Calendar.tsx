import { useState } from 'react'
import { WEEK, dkey, pad2, parseK } from '@/core/time'
import { useStore } from '@/store'
import { getDragPayload, setDragPayload } from '@/dnd/shared'

export function Calendar() {
  const db = useStore((s) => s.db)
  const cur = useStore((s) => s.cur)
  const calMonth = useStore((s) => s.calMonth)
  const setCur = useStore((s) => s.setCur)
  const prevMonth = useStore((s) => s.prevMonth)
  const nextMonth = useStore((s) => s.nextMonth)
  const moveTaskToDay = useStore((s) => s.moveTaskToDay)

  /* 待办拖到日期格上时的高亮。只存 key 不存 id —— 样式够用，
     且不进 store（拖拽过程每秒触发几十次，进 store 会全 App 重渲染）。 */
  const [hoverKey, setHoverKey] = useState<string | null>(null)

  /**
   * 拖到日期格上 = 把当天的未完成待办整条搬过去（store.moveTaskToDay）。
   *
   * 只接一种来源：**从待办区拖来的、当天存在、未完成**的项。
   * 计划块 / 实际块拖上来不接（它们是时间段不是待办，搬日期没有意义）；
   * 拖回当天也不接（store 层同样是 no-op，给了反馈反而误导）。
   *
   * dragover 里读不了 DataTransfer（保护模式返回空串），所以判据全拿
   * 模块级 payload —— 与 Track 的 onDragOver 同一套办法。
   */
  const onDayOver = (e: React.DragEvent<HTMLElement>, k: string) => {
    const p = getDragPayload()
    if (!p || p.from !== 'todo' || k === cur) return
    const t = db[cur]?.tasks.find((x) => x.id === p.id)
    if (!t || t.act != null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setHoverKey(k)
  }

  const onDayDrop = (e: React.DragEvent<HTMLElement>, k: string) => {
    setHoverKey(null)
    // 只认 payload 里明确来自待办区的。拿不到就不接 —— 宁可漏，
    // 也不能把外部拖来的东西（别的 app 的文本/文件）当成任务搬。
    const p = getDragPayload()
    if (!p || p.from !== 'todo') return
    e.preventDefault()
    e.stopPropagation()
    moveTaskToDay(p.id, k)
    /* 拖完立刻清通道，不能只等行的 dragend —— 任务搬走后源行会被
       React 卸载，dragend 冒泡不到根容器，payload 会一直留着：
       之后从别处拖东西上月历，onDayOver 会把这个残留当成待办接。 */
    setDragPayload(null)
  }

  const y = calMonth.getFullYear()
  const mo = calMonth.getMonth()
  const lead = new Date(y, mo, 1).getDay()
  const days = new Date(y, mo + 1, 0).getDate()
  const today = dkey(new Date())

  const hasContent = (k: string) => {
    const d = db[k]
    return !!(d && ((d.note && d.note.trim()) || (d.tasks && d.tasks.length)))
  }

  const filled = Object.keys(db).filter(hasContent).sort()

  return (
    /* cl-cal 是给宿主环境用的样式钩子。
       Obsidian 主题的 CSS **不分层**，而 Tailwind v4 把工具类放进 @layer utilities ——
       按 CSS 层叠规则不分层的永远赢，所以这里的 bg-ink / aspect-square 全被
       主题的 button 样式压掉（表现：格子有灰底和边框、宽度被 padding 撑开、
       「今天」不是实心块）。Web 版不需要它，插件的 styles.css 里会覆盖。 */
    <aside className="cl-cal w-48 flex-none sticky top-16 max-lg:w-full max-lg:static">
      <div className="bg-paper border border-rule2 rounded-sm p-3 shadow-card">
        <div className="flex items-center gap-1.5 mb-2.5">
          <button
            type="button"
            className="cl-nav"
            aria-label="上个月"
            onClick={prevMonth}
          >
            ‹
          </button>
          <div className="flex-1 text-center font-hw text-[15px] text-ink">
            {y} 年 {mo + 1} 月
          </div>
          <button
            type="button"
            className="cl-nav"
            aria-label="下个月"
            onClick={nextMonth}
          >
            ›
          </button>
        </div>

        <div className="grid grid-cols-7 gap-px text-center font-hw text-[11px] text-dim2 pb-1 border-b border-rule2">
          {WEEK.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px mt-1">
          {Array.from({ length: lead }).map((_, i) => (
            <div key={`e${i}`} className="opacity-25" />
          ))}
          {Array.from({ length: days }).map((_, i) => {
            const d = i + 1
            const k = `${y}-${pad2(mo + 1)}-${pad2(d)}`
            const c = hasContent(k)
            const wk = parseK(k).getDay()
            return (
              <button
                key={k}
                type="button"
                onClick={() => setCur(k)}
                onDragOver={(e) => onDayOver(e, k)}
                onDrop={(e) => onDayDrop(e, k)}
                /* 指针扫过格子里的小圆点（cl-dot）也会触发 dragleave ——
                   只有真的离开这个格子才清高亮（TodoList 里同一个坑，
                   一清就把刚落点算没了）。 */
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHoverKey(null)
                }}
                aria-current={k === today ? 'date' : undefined}
                aria-label={`${mo + 1}月${d}日 周${WEEK[wk]}，${c ? '有记录' : '无记录'}`}
                /* cl-day 系列是给宿主环境的钩子（Obsidian 主题不分层，会压掉
                   Tailwind 的工具类）。规则写在 plugin/src/index.css 的
                   @layer **外面** —— 放进 layer 等于没写。 */
                className={`cl-day font-hw text-xs cursor-pointer
                  ${c ? 'has' : 'empty'}
                  ${k === today ? 'today' : ''}
                  ${k === cur ? 'cur' : ''}
                  ${hoverKey === k ? 'drop' : ''}`}
              >
                {d}
                {/* 红点只表示「有记录」，图标样式不变 */}
                {c && <i className="cl-dot" />}
              </button>
            )
          })}
        </div>

        <div className="font-hw text-[11.5px] text-dim2 mt-2.5 pt-2 border-t border-dashed border-rule2 leading-relaxed">
          有记录的日子：<b className="text-ink2 font-normal">{filled.length}</b> 天
          <br />
          {filled.length ? `最近 ${filled[filled.length - 1]!.slice(5)}` : '—'}
          <br />
          把待办拖到某个日期上，就移到那天
        </div>
      </div>
    </aside>
  )
}