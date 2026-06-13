import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { FlaskConical, Link2, Sparkles, TrendingUp, Zap } from 'lucide-react'
import type { NetworkExport } from '../../types/network'
import type { StationOption } from '../../lib/routing/types'
import { findWhatIfCandidates, simulateWhatIfConnection } from '../../lib/network/whatIfSimulator'
import { StationAutocomplete } from '../StationAutocomplete'

interface WhatIfPanelProps {
  network: NetworkExport
  stations: StationOption[]
  focusStationId: number | null
  onFocusStation: (id: number | null) => void
}

export function WhatIfPanel({
  network,
  stations,
  focusStationId,
  onFocusStation,
}: WhatIfPanelProps) {
  const candidates = useMemo(() => findWhatIfCandidates(network), [network])
  const [selectedIdx, setSelectedIdx] = useState(0)

  const origin = useMemo(() => {
    if (focusStationId) return stations.find((s) => s.id === focusStationId) ?? stations[0]
    return stations[0] ?? null
  }, [focusStationId, stations])

  const connection = candidates[selectedIdx] ?? null

  const impact = useMemo(() => {
    if (!connection || !origin) return null
    return simulateWhatIfConnection(network, connection, origin.id)
  }, [network, connection, origin])

  if (!origin) return null

  return (
    <section className="whatif-panel">
      <header className="whatif-panel__header">
        <div>
          <p className="whatif-panel__eyebrow">Netzausbau-Simulator</p>
          <h2>Was wäre wenn…?</h2>
          <p className="whatif-panel__subtitle">
            Simuliert hypothetische Direktverbindungen zwischen nahen Stationen ohne bestehende Kante —
            und zeigt, wie sich Erreichbarkeit ändert.
          </p>
        </div>
        <div className="whatif-panel__origin">
          <StationAutocomplete
            label="Perspektive ab"
            placeholder="Bahnhof wählen…"
            stations={stations}
            value={origin}
            onChange={(s) => onFocusStation(s?.id ?? null)}
          />
        </div>
      </header>

      <div className="whatif-panel__candidates">
        <h3>
          <Link2 size={16} /> Fehlende Verbindungen in der Nähe
        </h3>
        <div className="whatif-panel__chip-row">
          {candidates.map((c, i) => (
            <button
              key={`${c.fromId}-${c.toId}`}
              type="button"
              className={`whatif-panel__chip ${i === selectedIdx ? 'is-active' : ''}`}
              onClick={() => setSelectedIdx(i)}
            >
              {c.fromName} ↔ {c.toName}
              <small>{c.estimatedKm.toFixed(1)} km</small>
            </button>
          ))}
        </div>
      </div>

      {connection && impact && (
        <motion.div
          className="whatif-panel__result"
          key={`${connection.fromId}-${connection.toId}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="whatif-panel__connection-card">
            <FlaskConical size={22} />
            <div>
              <strong>
                Neue Strecke: {connection.fromName} ↔ {connection.toName}
              </strong>
              <p>
                ~{connection.estimatedKm.toFixed(1)} km · ~{Math.round(connection.estimatedSeconds / 60)} min
                (geschätzt)
              </p>
            </div>
          </div>

          <div className="whatif-panel__stats">
            <div className="whatif-panel__stat">
              <TrendingUp size={18} />
              <strong>{impact.beforeReachable} → {impact.afterReachable}</strong>
              <span>Erreichbare Ziele von {origin.name}</span>
            </div>
            <div className="whatif-panel__stat">
              <Sparkles size={18} />
              <strong>{impact.newDestinations.length}</strong>
              <span>Neu erreichbar</span>
            </div>
            <div className="whatif-panel__stat">
              <Zap size={18} />
              <strong>{impact.improvedRoutes.length}</strong>
              <span>Schnellere Routen</span>
            </div>
          </div>

          {impact.newDestinations.length > 0 && (
            <div className="whatif-panel__list">
              <h4>Neu erreichbar</h4>
              <div className="whatif-panel__tags">
                {impact.newDestinations.map((d) => (
                  <span key={d} className="whatif-panel__tag whatif-panel__tag--new">{d}</span>
                ))}
              </div>
            </div>
          )}

          {impact.improvedRoutes.length > 0 && (
            <div className="whatif-panel__improvements">
              <h4>Zeitersparnis</h4>
              <table className="whatif-panel__table">
                <thead>
                  <tr>
                    <th>Ziel</th>
                    <th>Vorher</th>
                    <th>Nachher</th>
                    <th>Gespart</th>
                  </tr>
                </thead>
                <tbody>
                  {impact.improvedRoutes.map((row) => (
                    <tr key={row.dest}>
                      <td><strong>{row.dest}</strong></td>
                      <td>{Math.round(row.beforeMin)} min</td>
                      <td>{Math.round(row.afterMin)} min</td>
                      <td className="whatif-panel__saved">−{Math.round(row.savedMin)} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {impact.newDestinations.length === 0 && impact.improvedRoutes.length === 0 && (
            <p className="whatif-panel__neutral">
              Diese Verbindung verbessert die Erreichbarkeit von {origin.name} kaum — probiere einen anderen Kandidaten oder Startbahnhof.
            </p>
          )}
        </motion.div>
      )}
    </section>
  )
}
