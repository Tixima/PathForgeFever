import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

interface CollapsibleSectionProps {
  title: string
  subtitle?: string
  icon?: ReactNode
  defaultOpen?: boolean
  badge?: string
  className?: string
  children: ReactNode
}

export function CollapsibleSection({
  title,
  subtitle,
  icon,
  defaultOpen = false,
  badge,
  className = '',
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <section className={`collapsible ${open ? 'is-open' : ''} ${className}`.trim()}>
      <button
        type="button"
        className="collapsible__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="collapsible__trigger-main">
          {icon && <span className="collapsible__icon">{icon}</span>}
          <span className="collapsible__text">
            <span className="collapsible__title">{title}</span>
            {subtitle && <span className="collapsible__subtitle">{subtitle}</span>}
          </span>
        </span>
        <span className="collapsible__trigger-end">
          {badge && <span className="collapsible__badge">{badge}</span>}
          <ChevronDown size={18} className="collapsible__chevron" aria-hidden />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            className="collapsible__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <div className="collapsible__content">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
