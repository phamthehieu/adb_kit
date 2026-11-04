import { HelpCircle, X } from 'lucide-react'

/**
 * Title bar shared by every tool panel: what this panel is, what it is for (one line), where the
 * written guide for it is, and an obvious way to close it. Orientation first, controls below.
 */
export function PanelFrame({
  icon,
  title,
  desc,
  onHelp,
  onClose,
  children
}: {
  icon: React.ReactNode
  title: string
  desc: string
  /** Opens the matching topic of the guide. */
  onHelp: () => void
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <section className="pshell" aria-label={title}>
      <header className="ph-bar">
        <span className="ph-ico" aria-hidden>{icon}</span>
        <h2 className="ph-title">{title}</h2>
        <span className="ph-desc" title={desc}>{desc}</span>
        <button className="iconbtn ghost ph-help" onClick={onHelp} title={`Cách dùng “${title}”`}>
          <HelpCircle size={14} /> <span className="ph-help-t">Cách dùng</span>
        </button>
        <button className="iconbtn ghost" onClick={onClose} title="Đóng panel" aria-label="Đóng panel">
          <X size={15} />
        </button>
      </header>
      {children}
    </section>
  )
}
