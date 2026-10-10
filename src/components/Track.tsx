/**
 * 时间轨道。计划轨 / 实际轨通用。
 *
 * 已拍板的约束：
 * - 实际轨只接受从计划轨拖入，其他来源拒绝并提示
 * - 实际轨时长不可改（底部手柄只在计划轨渲染）
 * - 计划列顺延，实际列不顺延
 *
 * 拖拽实现：**统一用原生 HTML5 DnD**。
 * 落点是时间轴上的一个 Y 坐标，要 snap 到 15 分钟刻度，
 * 原生 dragover 的 clientY 最直接，不需要在 dnd-kit 里重算投影。
 * 待办区由 App 统一包一层 DndContext（供区内排序的键盘支持用），
 * 但跨区拖拽走原生 —— 两套监听器可以共存，不冲突。
 */
import { useEffect, useRef, useState } from 'react'
import { AXIS_PX, ROWH, SLOT, D0, D1, fmt, hm, nowMin, snapM, yT } from '@/core/time'
import { effDur, planDur, summary } from '@/core/logic'
import type { Task, Zone } from '@/core/types'
import { useStore } from '@/store'
import { Hw } from '@/ui'
import { getDragPayload, setDragPayload } from '@/dnd/shared'
import type { DragFrom } from '@/dnd/shared'
import { GUTTER, GUTTER_PAD } from './TimeGutter'
import { useDurPrompt } from './DurPrompt'

/** 像素 Y → 吸附到 15 分钟刻度 */
function snap(clientY: number, el: HTMLElement): number {
  const r = el.getBoundingClientRect()
  return snapM(clientY - r.top)
}

/**
 * 「现在」线。2026-10-09 取消了快进模式，改成每分钟自走，
 * 所以这条线常驻显示（以前只在 sim 模式下出现）。
 */
function NowLine() {
  const [m, setM] = useState(() => nowMin())
  useEffect(() => {
    const tick = () => setM(nowMin())
    const h = setTimeout(tick, 60000 - (Date.now() % 60000) + 50)
    // 时间跨过午夜时立刻刷新一次，别等下一个周期
    const iv = setInterval(tick, 60000)
    return () => {
      clearTimeout(h)
      clearInterval(iv)
    }
  }, [])
  if (m < D0 || m > D1) return null
  return (
    <div
      aria-hidden
      className="absolute left-0 right-0 h-0 border-t-[1.5px] border-dashed border-ink pointer-events-none z-4"
      style={{ top: yT(m) }}
    >
      <span className="absolute left-0.5 -top-3.5 font-hw text-[10.5px] text-ink">现在</span>
    </div>
  )
}

export function Track({ zone }: { zone: Zone }) {
  const tasks = useStore((s) => s.db[s.cur]?.tasks ?? EMPTY)
  const schedule = useStore((s) => s.schedule)
  const complete = useStore((s) => s.complete)
  const uncomplete = useStore((s) => s.uncomplete)
  const resizePlan = useStore((s) => s.resizePlan)
  const resizeAct = useStore((s) => s.resizeAct)
  const removeBlock = useStore((s) => s.removeBlock)
  const markDoneNow = useStore((s) => s.markDoneNow)
  const notify = useStore((s) => s.notify)
  const { ask, node: durNode } = useDurPrompt()

  const el = useRef<HTMLDivElement>(null)
  const [hoverM, setHoverM] = useState<number | null>(null)
  /**
 * 拖动调整时的临时状态。
 * y0      起始时刻（吸附后的分钟数），不是像素
 * base    起始时长
 * start0  实际轨的原始开始时刻（拖上边时用来算新 start）
 * edge    拖哪条边
 */
  const resize = useRef<{
    id: number
    zone: Zone
    y0: number
    base: number
    start0: number
  } | null>(null)

  /* ---- 拖拽来源：模块级标记，避免把状态塞进 store ---- */
  const dragRef = useRef<{ id: number; from: DragFrom } | null>(null)

  const list = tasks.filter((t) => (zone === 'p' ? t.plan != null : t.act != null))
  const estDur = (() => {
    const d = dragRef.current
    if (!d) return 60
    const t = tasks.find((x) => x.id === d.id)
    if (!t) return 60
    return zone === 'p' ? planDur(t) : effDur(t)
  })()

  /**
   * 取当前拖拽的是什么。
   * 优先读模块级 payload；拿不到时退回 DataTransfer 的 text/plain ——
   * 这样即使 dragstart 的模块变量丢了（比如跨 iframe、或者某些浏览器
   * 做了 own copy），drop 仍然认得出拖的是哪条任务。
   */
  const readDrag = (e: React.DragEvent) => {
    const p = getDragPayload()
    if (p) return p
    const raw = e.dataTransfer.getData('text/plain')
    const id = Number(raw)
    if (!Number.isFinite(id) || id <= 0) return null
    // 来源未知时，从「该任务当前在哪条轨」反推
    const t = tasks.find((x) => x.id === id)
    if (!t) return null
    const from: DragFrom = t.act != null ? 'actual' : t.plan != null ? 'plan' : 'todo'
    return { id, from }
  }

  const onDragOver = (e: React.DragEvent) => {
    const d = dragRef.current ?? getDragPayload()
    if (!d || !el.current) return
    // 实际轨只接受计划轨来源，不给假反馈。实际轨内部的移动要给反馈
    if (zone === 'a' && d.from !== 'plan' && d.from !== 'actual') {
      setHoverM(null)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setHoverM(snap(e.clientY, el.current))
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setHoverM(null)
    const d = readDrag(e)
    dragRef.current = null
    setDragPayload(null)
    if (!d || !el.current) return
    const m = snap(e.clientY, el.current)
    const t = tasks.find((x) => x.id === d.id)
    if (!t) return

    if (zone === 'p') {
      if (d.from === 'plan') {
        // 已在计划轨，只改时间
        schedule(t.id, m, planDur(t))
      } else if (d.from === 'actual') {
        // 退回承诺：取消删除线
        uncomplete(t.id)
        schedule(t.id, m, planDur(t))
      } else {
        // 待办 → 计划轨，问时长；取消则不动数据
        const du = await ask(t.ti, t.est)
        if (du != null) schedule(t.id, m, du)
      }
      return
    }

    // 实际轨
    if (d.from === 'actual') {
      // 实际轨内部拖动 = 改开始时间，时长不动。与计划轨「拖块改时间」同一套逻辑
      resizeAct(t.id, m, effDur(t))
      return
    }
    if (d.from !== 'plan') {
      notify('实际完成只能从「计划完成」拖过来')
      return
    }
    complete(t.id, m)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    // 兜底：手柄没捕获到指针时（部分浏览器）事件仍落在容器上。
    // 有 setPointerCapture 时事件走手柄自己的 onPointerMove，两边不会重复触发。
    const r = resize.current
    if (!r || !el.current) return
    applyResize(snap(e.clientY, el.current))
  }

  /**
   * 手柄逻辑：只有下沿，拖它改结束时间。
   * 开始时间靠拖块本体（原生 DnD）—— 与计划轨同一套交互，不另开一个上沿手柄。
   */
  const applyResize = (m: number) => {
    const r = resize.current
    if (!r) return
    if (r.zone === 'p') {
      resizePlan(r.id, Math.max(SLOT, r.base + (m - r.y0)))
      return
    }
    // 实际轨：起点固定为按下时的 start0，终点跟着指针走
    resizeAct(r.id, r.start0, Math.max(SLOT, m - r.start0))
  }

  return (
    <>
      <div
        ref={el}
        data-zone={zone}
        /* 不自带滚动 —— 外层统一滚，刻度列和两栏天然同步 */
        className="ruled relative border-y border-rule2"
        style={{ ...GUTTER_PAD, minHeight: AXIS_PX }}
        onDragOver={onDragOver}
        onDragLeave={() => setHoverM(null)}
        onDrop={onDrop}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          resize.current = null
        }}
      >
        {/* 整点刻度已抽到左侧 TimeGutter 列，这里不再重复画 */}
        <NowLine />

        {hoverM != null && (
          <div
            className="absolute left-0 right-0 rounded-sm bg-soft/70 border-2 border-ink text-ink2 font-hw text-[11.5px] px-1.5 leading-5 pointer-events-none z-5"
            style={{
              top: yT(hoverM),
              height: Math.max(ROWH, (estDur / 60) * ROWH),
            }}
          >
            {fmt(hoverM)}–{fmt(hoverM + estDur)}
            {zone === 'a' ? ' · 记为已完成' : ''}
          </div>
        )}

        {!list.length && (
          <div className="absolute left-0 right-0 top-28 text-center font-hw text-[13px] text-dim2 pointer-events-none">
            {zone === 'p' ? '拖待办到这里 → 询问时长' : '从左边「计划完成」拖过来 → 记为已完成'}
          </div>
        )}

        {list.map((t) => {
          const st = zone === 'p' ? t.plan! : t.act!
          const du = zone === 'p' ? planDur(t) : effDur(t)
          // 块高按「小时」换算，与一小时一格的横格对齐
          const h = Math.max(20, (du / 60) * ROWH - 2)
          const done = zone === 'a'
          return (
            <div
              key={t.id}
              draggable
              onDragStart={(e) => {
                const from: DragFrom = zone === 'p' ? 'plan' : 'actual'
                // 两处都写：模块变量给本组件的 dragover 用，
                // DataTransfer 给 readDrag 的兜底路径用
                dragRef.current = { id: t.id, from }
                setDragPayload({ id: t.id, from })
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(t.id))
              }}
              onDragEnd={() => {
                dragRef.current = null
                setDragPayload(null)
              }}
              style={{ top: yT(st), height: h }}
              className={`blk absolute left-0 right-0 flex items-start gap-1.5 rounded-sm pl-1 pr-1
                ${done ? 'bg-ink/8' : 'bg-ink/5'}`}
            >
              {/* 时间已在左侧刻度列，这里只留时长，不与文字条重叠 */}
              <Hw className="text-[11px] flex-none w-2.5 pt-0.5 text-ink2">
                {zone === 'p' ? (t.act != null ? '✓' : '○') : '✓'}
              </Hw>
              <Hw
                className={`flex-1 min-w-0 overflow-hidden ${
                  done ? 'text-ink2 line-through decoration-ink2 decoration-[1.4px]' : 'text-text'
                }`}
              >
                {t.ti}
              </Hw>
              <Hw className="text-xs text-ink2 flex-none tabular-nums pt-px">【{hm(du)}】</Hw>

              {zone === 'p' && t.act == null && (
                <button
                  type="button"
                  onClick={() => markDoneNow(t.id)}
                  aria-label={`标记 ${t.ti} 已完成`}
                  title="现在就做完了"
                  className="flex-none w-3.5 h-3.5 rounded-full border border-ink2 text-ink2 text-[11px] leading-[13px] text-center hover:bg-ink hover:text-white"
                >
                  ✓
                </button>
              )}
              {/* 删除：常驻显示，不靠 hover 才出现 */}
              <button
                type="button"
                onClick={() => removeBlock(t.id)}
                aria-label={`删除 ${t.ti}`}
                title="删除"
                className="flex-none text-[11px] text-dim2 hover:text-ink"
              >
                ✕
              </button>

              {/* 手柄只在下沿：拖它改结束时间（= 时长）。
                  开始时间靠拖块本体 —— 与计划轨同一套交互。*/}
              <div
                role="separator"
                aria-label={`调整 ${t.ti} 的结束时间，当前 ${fmt(st + du)}。方向键上下也可调`}
                aria-orientation="horizontal"
                aria-valuenow={st + du}
                aria-valuemin={D0}
                aria-valuemax={D1}
                tabIndex={0}
                onPointerDown={(e) => {
                  // 必须阻止默认：否则父块的 draggable 会抢走这次交互
                  e.preventDefault()
                  e.stopPropagation()
                  resize.current = {
                    id: t.id,
                    zone,
                    y0: snap(e.clientY, el.current!),
                    base: du,
                    start0: st,
                  }
                  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
                }}
                onPointerMove={(e) => {
                  // setPointerCapture 后事件落在这里
                  const r = resize.current
                  if (!r || r.id !== t.id || !el.current) return
                  applyResize(snap(e.clientY, el.current))
                }}
                onPointerUp={(e) => {
                  resize.current = null
                  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
                }}
                onKeyDown={(e) => {
                  const up = e.key === 'ArrowUp'
                  const down = e.key === 'ArrowDown'
                  if (!up && !down) return
                  e.preventDefault()
                  const delta = (up ? 1 : -1) * SLOT
                  if (zone === 'p') {
                    resizePlan(t.id, Math.max(SLOT, planDur(t) + delta))
                  } else {
                    resizeAct(t.id, st, Math.max(SLOT, du + delta))
                  }
                }}
                title="拖动调整结束时间"
                className="absolute left-0 right-0 -bottom-1.5 h-3 cursor-ns-resize flex items-end justify-center"
              >
                <span className="block w-8 h-1 rounded-full bg-rule2" />
              </div>
            </div>
          )
        })}

{/* 这行没看懂是正常的 —— 原来的「↳ 顺延至 16:00」没说清是什么的 16:00。
                它的含义是：计划列最后一块结束的时刻。现在直接写成一句话。
                若这个末尾任务是「被前一挤过来的」，措辞不同 —— 判据是
                它前面那块是否真的越过了它。 */}
        {zone === 'p' &&
          (() => {
            const planned = tasks.filter((t) => t.plan != null).sort((a, b) => a.plan! - b.plan!)
            if (!planned.length) return null
            const last = planned[planned.length - 1]!
            const tail = last.plan! + planDur(last)
            const prev = planned[planned.length - 2]
            // 前一块的结束时刻越过了它 → 它是被挤下来的
            const pushed = prev != null && prev.plan! + planDur(prev) > last.plan!
            return (
              <Hw
                className="absolute left-0 right-0 text-[10.5px] pointer-events-none z-0 leading-5 text-dim2"
                style={{ top: yT(tail) + 3 }}
              >
                {pushed ? '↓ 这条被前面的挤开了，实际排在' : '计划排到这里结束于'} {fmt(tail)}
              </Hw>
            )
          })()}
      </div>

      {/* 拖入待办时问时长。弹窗是 fixed，不受滚动容器影响 */}
      {durNode}
    </>
  )
}

/** 轨道下方的汇总行。由 App 排在滚动容器之后，所以不跟着滚 */
export function TrackFooter({ zone }: { zone: Zone }) {
  const tasks = useStore((s) => s.db[s.cur]?.tasks ?? EMPTY)
  const s = summary(tasks)
  /* 计划占用里已兑现的部分要扣掉，否则「还剩多少」会算多 */
  const left = Math.max(0, s.planMin - s.actMin)
  return (
    <div
      className="font-hw text-[13.5px] pt-2 flex items-baseline gap-1.5 border-t border-dashed border-rule2"
      style={{ paddingLeft: GUTTER }}
    >
      {zone === 'p' ? (
        <>
          {/* △ 恒在：计划总时长。括号和中括号都是可选的 */}
          <span className="px-1.5" title="计划占用总时长 —— 今天排进「计划完成」的所有块加起来">
            △ {hm(s.planMin)}
          </span>
          {s.actMin > 0 && (
            <span
              title={`其中已兑现 ${hm(s.actMin)} —— 已经在「实际完成」里的块。只在实际完成区非空时出现`}
            >
              <span className="text-rule2">（</span>
              {hm(s.actMin)}
              <span className="text-rule2">）</span>
            </span>
          )}
          <span className="px-1.5" title="计划减去已兑现，还剩多少没做完">
            剩 <b className="font-normal text-ink2">【{hm(left)}】</b>
          </span>
        </>
      ) : (
        <span className="px-1.5" title="实际占用总时长 —— 已完成块的时长之和，落位时就固定了">
          △ <b className="font-normal text-ink2">{hm(s.actMin)}</b>
          <span className="text-rule2">·</span>已结清 <b className="font-normal text-ink2">{s.done}</b> 项
        </span>
      )}
    </div>
  )
}

const EMPTY: Task[] = []