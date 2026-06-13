import { useMemo, useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  FileJson,
  Gauge,
  Info,
  ScrollText,
  Shield,
  Sparkles,
  Terminal,
  Train,
} from 'lucide-react'
import type { NetworkExport } from '../../types/network'
import {
  buildExportDiagnostics,
  severityClass,
  type DiagnosticLogEntry,
} from '../../lib/diagnostics/exportDiagnostics'

interface DiagnosticsPanelProps {
  network: NetworkExport
}

const LOG_FILTERS = ['Alle', 'Gleise', 'Linien', 'TF2-API', 'Export', 'Routing', 'Allgemein'] as const

export function DiagnosticsPanel({ network }: DiagnosticsPanelProps) {
  const diagnostics = useMemo(() => buildExportDiagnostics(network), [network])
  const [logFilter, setLogFilter] = useState<(typeof LOG_FILTERS)[number]>('Alle')
  const [logSearch, setLogSearch] = useState('')

  const filteredLog = useMemo(() => {
    let rows = diagnostics.diagnosticsLog
    if (logFilter !== 'Alle') {
      rows = rows.filter((r) => r.category === logFilter)
    }
    if (logSearch.trim()) {
      const q = logSearch.toLowerCase()
      rows = rows.filter((r) => r.message.toLowerCase().includes(q))
    }
    return rows
  }, [diagnostics.diagnosticsLog, logFilter, logSearch])

  return (
    <section className="diagnostics-panel">
      <header className="diagnostics-panel__hero">
        <div className="diagnostics-panel__hero-copy">
          <p className="diagnostics-panel__eyebrow">Export-Diagnose</p>
          <h2>Was steckt in der JSON?</h2>
          <p className="diagnostics-panel__subtitle">
            Live-Auswertung von <code>quality_report</code>, <code>diagnostics</code>, Funktionen
            und experimentellen Schätzwerten — transparent, filterbar, mit konkreten Hinweisen.
          </p>
        </div>

        <div className="diagnostics-panel__health">
          <div
            className="diagnostics-panel__health-ring"
            style={{ '--health-pct': `${diagnostics.healthScore}%` } as CSSProperties}
          >
            <strong>{diagnostics.healthScore}</strong>
            <span>Qualität</span>
          </div>
          <div>
            <strong className="diagnostics-panel__health-label">{diagnostics.healthLabel}</strong>
            <p>Schema {diagnostics.schemaVersion}</p>
            <p>{diagnostics.generatedAt.toLocaleString('de-DE')}</p>
            <p className="diagnostics-panel__by">{diagnostics.generatedBy}</p>
          </div>
        </div>
      </header>

      {diagnostics.insights.length > 0 && (
        <div className="diagnostics-panel__insights">
          {diagnostics.insights.map((text) => (
            <p key={text.slice(0, 48)} className="diagnostics-panel__insight">
              <Sparkles size={15} aria-hidden />
              {text}
            </p>
          ))}
        </div>
      )}

      <div className="diagnostics-panel__stats">
        <StatCard icon={Train} label="Stationen" value={diagnostics.counts.stations ?? 0} />
        <StatCard icon={Activity} label="Linien" value={diagnostics.counts.lines ?? 0} />
        <StatCard icon={Database} label="Routing-Knoten" value={diagnostics.counts.routing_nodes ?? 0} />
        <StatCard icon={FileJson} label="Log-Einträge" value={diagnostics.diagnosticsLog.length} />
        <StatCard icon={Shield} label="Qualitätsprüfungen" value={diagnostics.qualityReport.length} />
        <StatCard
          icon={Terminal}
          label="Terminal-Scan"
          value={diagnostics.terminalScan?.appliedToStops ?? 0}
        />
      </div>

      <div className="diagnostics-panel__grid">
        <section className="diagnostics-panel__card">
          <h3>
            <CheckCircle2 size={18} aria-hidden />
            Qualitätsbericht
          </h3>
          <ul className="diagnostics-panel__quality">
            {diagnostics.qualityReport.map((entry) => (
              <li key={entry.code} className={`diagnostics-panel__quality-item is-${severityClass(entry.level)}`}>
                <code>{entry.code}</code>
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="diagnostics-panel__card">
          <h3>
            <Gauge size={18} aria-hidden />
            Export-Funktionen
          </h3>
          <div className="diagnostics-panel__capabilities">
            {diagnostics.capabilities.map((cap) => (
              <div
                key={cap.key}
                className={`diagnostics-panel__cap ${cap.available ? 'is-on' : 'is-off'}`}
              >
                <span className="diagnostics-panel__cap-dot" />
                <span>{cap.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="diagnostics-panel__card">
          <h3>
            <Clock size={18} aria-hidden />
            Zeit-Schätzung
          </h3>
          <p className="diagnostics-panel__card-lead">
            {diagnostics.timeEstimation.nativeTimesAvailable
              ? 'Native TF2-Segmentzeiten verfügbar.'
              : 'Keine nativen Fahrzeiten — MVP-Schätzung aktiv.'}
          </p>
          {diagnostics.timeEstimation.note && (
            <p className="diagnostics-panel__muted">{diagnostics.timeEstimation.note}</p>
          )}
          <div className="diagnostics-panel__speed-bars">
            {diagnostics.timeEstimation.speeds.map((s) => (
              <div key={s.mode} className="diagnostics-panel__speed-row">
                <span>{s.mode}</span>
                <div className="diagnostics-panel__speed-track">
                  <motion.div
                    className="diagnostics-panel__speed-fill"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (s.kmh / 300) * 100)}%` }}
                  />
                </div>
                <strong>{s.kmh} km/h</strong>
              </div>
            ))}
          </div>
          <ul className="diagnostics-panel__penalties">
            {diagnostics.timeEstimation.penalties.map((p) => (
              <li key={p.label}>
                {p.label}: <strong>{p.seconds}s</strong>
              </li>
            ))}
          </ul>
        </section>

        {diagnostics.networkStats && (
          <section className="diagnostics-panel__card">
            <h3>
              <Activity size={18} aria-hidden />
              Netz-Statistik
            </h3>
            <div className="diagnostics-panel__net-stats">
              <span>{diagnostics.networkStats.hubCount} Drehkreuze</span>
              <span>{diagnostics.networkStats.transferCount} Umstiege</span>
              <span>{diagnostics.networkStats.endpointCount} Endpunkte</span>
            </div>
            <ol className="diagnostics-panel__hubs">
              {diagnostics.networkStats.topHubs.map((hub, i) => (
                <li key={hub.name}>
                  <span>#{i + 1}</span>
                  <strong>{hub.name}</strong>
                  <em>{hub.degree} Verb. · {hub.lineCount} Linien</em>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="diagnostics-panel__card diagnostics-panel__card--wide">
          <h3>
            <AlertTriangle size={18} aria-hidden />
            Experimentelle Features
          </h3>
          {diagnostics.experimentalWarning && (
            <p className="diagnostics-panel__warn">{diagnostics.experimentalWarning}</p>
          )}
          <div className="diagnostics-panel__features">
            {diagnostics.experimentalFeatures.map((feat) => (
              <article key={feat.id} className={`diagnostics-panel__feature ${feat.enabled ? 'is-on' : ''}`}>
                <header>
                  <strong>{feat.label}</strong>
                  <span>{feat.origin}</span>
                </header>
                {feat.note && <p>{feat.note}</p>}
                {feat.provides.length > 0 && (
                  <div className="diagnostics-panel__tags">
                    {feat.provides.slice(0, 4).map((tag) => (
                      <span key={tag} className="diagnostics-panel__tag is-good">{tag}</span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="diagnostics-panel__card diagnostics-panel__card--wide">
          <h3>
            <ScrollText size={18} aria-hidden />
            Diagnose-Log
          </h3>
          <div className="diagnostics-panel__log-controls">
            <input
              type="search"
              className="diagnostics-panel__search"
              placeholder="Log durchsuchen…"
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
            />
            <div className="diagnostics-panel__filters">
              {LOG_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`diagnostics-panel__filter ${logFilter === f ? 'is-active' : ''}`}
                  onClick={() => setLogFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <ul className="diagnostics-panel__log">
            {filteredLog.map((entry, i) => (
              <LogRow key={`${entry.message}-${i}`} entry={entry} />
            ))}
          </ul>
        </section>

        {diagnostics.dataOriginLegend.length > 0 && (
          <section className="diagnostics-panel__card diagnostics-panel__card--wide">
            <h3>
              <Info size={18} aria-hidden />
              Daten-Herkunft
            </h3>
            <dl className="diagnostics-panel__legend">
              {diagnostics.dataOriginLegend.map((item) => (
                <div key={item.key}>
                  <dt>{item.key}</dt>
                  <dd>{item.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </section>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Train
  label: string
  value: number
}) {
  return (
    <div className="diagnostics-panel__stat">
      <Icon size={18} aria-hidden />
      <strong>{value.toLocaleString('de-DE')}</strong>
      <span>{label}</span>
    </div>
  )
}

function LogRow({ entry }: { entry: DiagnosticLogEntry }) {
  return (
    <li className={`diagnostics-panel__log-row is-${severityClass(entry.level)}`}>
      <span className="diagnostics-panel__log-level">{entry.level}</span>
      <span className="diagnostics-panel__log-cat">{entry.category}</span>
      <span className="diagnostics-panel__log-msg">{entry.message}</span>
    </li>
  )
}
