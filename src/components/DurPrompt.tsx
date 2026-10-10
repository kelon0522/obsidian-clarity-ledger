import { useRef, useState } from 'react'
import { parseDur } from '@/core/time'
import { Hw, Modal } from '@/ui'

const PRESETS = [30, 45, 60, 90, 120]

/**
 * 拖入计划轨时问时长。原型里那个弹窗的直接搬迁。
 * ask() 返回 Promise，取消时 resolve(null)。
 */
export function useDurPrompt() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [v, setV] = useState('')
  const pending = useRef<((n: number | null) => void) | null>(null)

  const ask = (taskTitle: string, currentEst: number) =>
    new Promise<number | null>((resolve) => {
      setTitle(taskTitle)
      setV(String(currentEst || ''))
      setOpen(true)
      pending.current = resolve
    })

  const close = (result: number | null) => {
    setOpen(false)
    pending.current?.(result)
    pending.current = null
  }

  const ok = () => {
    const n = parseDur(v)
    if (!(n > 0)) return
    close(n)
  }

  const node = (
    <Modal
      open={open}
      onClose={() => close(null)}
      title="这条要做多久？"
      sub={title}
      foot={
        <>
          <button
            type="button"
            onClick={() => close(null)}
            className="flex-1 rounded-md border border-rule2 py-1.5 font-hw text-sm"
          >
            取消
          </button>
          <button
            type="button"
            onClick={ok}
            className="flex-1 rounded-md border border-ink bg-ink text-white py-1.5 font-hw text-sm hover:bg-ink2 hover:border-ink2"
          >
            确定
          </button>
        </>
      }
    >
      <label className="block font-hw text-xs text-dim mb-1.5">
        预计用时
        <span className="text-dim2 ml-1.5">单位 m（分钟）· 可写 2小时 / 90 / 1.5h</span>
      </label>
      <div className="flex items-stretch gap-1.5">
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ok()}
          placeholder="2小时 / 90 / 1.5h"
          aria-label="预计用时，单位分钟"
          className="flex-1 min-w-0 font-hw text-lg text-ink2 px-2.5 py-1.5 border border-rule2 rounded bg-paper2 focus:outline-none focus:border-ink"
        />
        <Hw className="flex-none flex items-center px-3 border border-rule2 rounded bg-paper2 text-ink2">
          m
        </Hw>
      </div>
      <div className="flex gap-1.5 mt-2.5 flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setV(String(p))}
            className="font-hw text-xs text-dim border border-rule2 rounded px-2 py-0.5 hover:border-ink hover:text-ink"
          >
            {p >= 60 ? `${p / 60}h` : `${p}m`}
          </button>
        ))}
      </div>
    </Modal>
  )

  return { ask, node }
}