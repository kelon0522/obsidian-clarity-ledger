import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/* 手写体 —— 待办、标题、时长标注都用这个，这是工字格的灵魂 */
export function Hw({
  children,
  className = '',
  style,
}: {
  children: ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span className={`font-hw ${className}`} style={style}>
      {children}
    </span>
  )
}

/**
 * 纸面容器。
 *
 * **`flex flex-col` 是必需的，不是装饰** ——
 * 内部的轨道区用 `flex-none` + 显式高度（随视口自适应），
 * 每日回顾用 `flex-none` 按内容撑开。缺了 flex-col，
 * 这两个子元素的 flex 属性完全不生效，轨道高度就没法算。
 *
 * `min-h-0` 是另一个必需项：flex 子项默认 `min-height: auto`，
 * 内容比容器高时会撑破容器而不是被压缩 —— 那样轨道的高度计算就失真了。
 */
export function Sheet({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 bg-paper border border-rule2 rounded-sm p-6 pb-7 pl-8 relative shadow-paper">
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-sm bg-linear-to-b from-soft from-0 via-soft2 via-40 to-soft2 to-60 to-soft to-100"
      />
      {children}
    </div>
  )
}

export function Btn({
  onClick,
  children,
  active,
  title,
  disabled,
}: {
  onClick?: () => void
  children: ReactNode
  active?: boolean
  title?: string
  disabled?: boolean
}) {
  return (
    <Hw>
      <button
        type="button"
        onClick={onClick}
        title={title}
        disabled={disabled}
        className={`rounded-md border border-rule2 bg-paper px-2.5 py-1 text-xs text-dim transition-colors
                    hover:border-ink hover:text-ink2 disabled:opacity-40 disabled:hover:border-rule2 disabled:hover:text-dim
                    ${active ? 'border-ink bg-ink text-white hover:bg-ink2 hover:border-ink2' : ''}`}
      >
        {children}
      </button>
    </Hw>
  )
}

export function Modal({
  open,
  onClose,
  title,
  sub,
  children,
  foot,
  width = 330,
}: {
  open: boolean
  onClose: () => void
  title: string
  sub?: ReactNode
  children?: ReactNode
  foot?: ReactNode
  width?: number
}) {
  /* ESC 关闭。全局挂一个监听，只有弹窗开着时才生效 */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  /* 必须 portal 到 body。
     弹框原本渲染在 <header> 内，而 header 带 backdrop-blur-md ——
     backdrop-filter 会给 position:fixed 的后代创建包含块，
     于是 fixed inset-0 变成「相对 header 定位」而不是相对视口，
     弹框会偏到顶部并被裁掉（2026-10-09 实测）。 */
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      /* items-start + my-auto + py-8：内容再高也不会顶出视口，
         高内容时弹框自身可滚，不会带动背后的页面 */
      className="fixed inset-0 z-100 flex items-start justify-center overflow-y-auto overscroll-contain
                 bg-text/32 px-4 py-8 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="my-auto rounded-sm border border-rule2 bg-paper p-5.5 shadow-card max-h-[calc(100vh-4rem)] overflow-y-auto"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-hw text-base font-normal text-ink m-0 mb-1 tracking-wide">{title}</h3>
        {sub && <div className="font-hw text-[13.5px] text-dim mb-3.5">{sub}</div>}
        {children}
        <div className="flex gap-2 mt-4">
          {foot ?? (
            <Hw>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-md border border-rule2 py-1.5 text-sm"
              >
                关闭
              </button>
            </Hw>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}