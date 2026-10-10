import { WEEK, dkey, pad2, parseK } from '@/core/time'
import { useStore } from '@/store'

export function Calendar() {
  const db = useStore((s) => s.db)
  const cur = useStore((s) => s.cur)
  const calMonth = useStore((s) => s.calMonth)
  const setCur = useStore((s) => s.setCur)
  const prevMonth = useStore((s) => s.prevMonth)
  const nextMonth = useStore((s) => s.nextMonth)

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
                aria-current={k === today ? 'date' : undefined}
                aria-label={`${mo + 1}月${d}日 周${WEEK[wk]}，${c ? '有记录' : '无记录'}`}
                /* cl-day 系列是给宿主环境的钩子（Obsidian 主题不分层，会压掉
                   Tailwind 的工具类）。规则写在 plugin/src/index.css 的
                   @layer **外面** —— 放进 layer 等于没写。 */
                className={`cl-day font-hw text-xs cursor-pointer
                  ${c ? 'has' : 'empty'}
                  ${k === today ? 'today' : ''}
                  ${k === cur ? 'cur' : ''}`}
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
        </div>
      </div>
    </aside>
  )
}