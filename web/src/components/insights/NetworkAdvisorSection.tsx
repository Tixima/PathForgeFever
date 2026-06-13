import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
  Stethoscope,
} from 'lucide-react'
import type { NetworkExport } from '../../types/network'
import {
  buildNetworkAdvisorFindings,
  type AdvisorSeverity,
} from '../../lib/network/networkAdvisor'

interface NetworkAdvisorSectionProps {
  network: NetworkExport
  onOpenStation?: (stationId: number) => void
}

const SEVERITY_ICON: Record<AdvisorSeverity, typeof Info> = {
  critical: ShieldAlert,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
}

export function NetworkAdvisorSection({ network, onOpenStation }: NetworkAdvisorSectionProps) {
  const findings = useMemo(() => buildNetworkAdvisorFindings(network), [network])

  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, info: 0, success: 0 }
    for (const f of findings) c[f.severity]++
    return c
  }, [findings])

  return (
    <div className="net-advisor">
      <h3>
        <Stethoscope size={18} /> Netzwerk-Assistent
      </h3>
      <p className="net-advisor__desc">
        Automatische Schwachstellen-Analyse — isolierte Stationen, Sackgassen, fehlende Fahrzeuge und Export-Warnungen.
      </p>

      <div className="net-advisor__summary">
        {counts.critical > 0 && (
          <span className="net-advisor__badge net-advisor__badge--critical">{counts.critical} kritisch</span>
        )}
        {counts.warning > 0 && (
          <span className="net-advisor__badge net-advisor__badge--warning">{counts.warning} Warnung</span>
        )}
        {counts.info > 0 && (
          <span className="net-advisor__badge net-advisor__badge--info">{counts.info} Hinweis</span>
        )}
      </div>

      <div className="net-advisor__list">
        {findings.map((finding, i) => {
          const Icon = SEVERITY_ICON[finding.severity]
          return (
            <motion.article
              key={finding.id}
              className={`advisor-card advisor-card--${finding.severity}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Icon size={18} className="advisor-card__icon" />
              <div className="advisor-card__body">
                <strong>{finding.title}</strong>
                <p>{finding.detail}</p>
                {finding.action && <span className="advisor-card__action">{finding.action}</span>}
              </div>
              {finding.stationId && onOpenStation && (
                <button
                  type="button"
                  className="advisor-card__link"
                  onClick={() => onOpenStation(finding.stationId!)}
                >
                  Öffnen
                </button>
              )}
            </motion.article>
          )
        })}
      </div>
    </div>
  )
}
