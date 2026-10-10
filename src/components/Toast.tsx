import { useEffect } from 'react'
import { hm } from '@/core/time'
import { useStore } from '@/store'
import { Hw } from '@/ui'

/** 撤销条。undoable=false 时不显示按钮。 */
export function Toast() {
  const toast = useStore((s) => s.toast)
  const doUndo = useStore((s) => s.doUndo)

  useEffect(() => {
    if (!toast) return
    const h = setTimeout(() => useStore.setState({ toast: null }), 5200)
    return () => clearTimeout(h)
  }, [toast])

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed left-1/2 bottom-6 -translate-x-1/2 translate-y-3.5 bg-text text-paper rounded-lg px-3.5 py-2 z-90
                  font-hw text-[13.5px] shadow-card flex items-center gap-3 transition-all duration-200
                  ${toast ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none translate-y-3.5'}`}
    >
      <Hw className="text-[13.5px]">{toast?.msg ?? ''}</Hw>
      {toast?.undoable && (
        <button
          type="button"
          onClick={doUndo}
          className="text-[#f4a7c2] underline font-hw text-[13.5px]"
        >
          撤销
        </button>
      )}
    </div>
  )
}

/** 顶部提示的小胶囊，用于「已完成」这类瞬时反馈 */
export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <Hw className="text-[13px] text-ink2 bg-soft border border-soft2 rounded-md px-2.5 py-1">
      {children}
    </Hw>
  )
}

export { hm }