import { useMemo, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { Activity, AlertTriangle, Award, Route, TrendingUp, Users } from 'lucide-react'
import type { NetworkExport } from '../../types/network'
import type { ScaleSettings } from '../../lib/scale'
import { buildNetworkAnalytics } from '../../lib/network/networkAnalytics'
import { buildStationIntelIndex } from '../../lib/station/stationIntel'
import { shapeLabel } from '../../lib/maps/lineTopology'
import { formatDistanceKm } from '../../lib/format'
import { NetworkAdvisorSection } from './NetworkAdvisorSection'
import { ComplexJourneysSection } from './ComplexJourneysSection'
import type { StationOption } from '../../lib/routing/types'

interface NetworkInsightsPanelProps {
  network: NetworkExport
  scale: ScaleSettings
  stations: StationOption[]
  onOpenStation: (stationId: number) => void
  onPlanTrip: (from: StationOption, to: StationOption) => void
}

export function NetworkInsightsPanel({
  network,
  scale,
  stations,
  onOpenStation,
  onPlanTrip,
}: NetworkInsightsPanelProps) {
  const analytics = useMemo(() => buildNetworkAnalytics(network), [network])
  const intelIndex = useMemo(() => buildStationIntelIndex(network), [network])

  const scaledTotalKm = analytics.totalKmScaled(scale.distanceMultiplier)

  return (
    <section className="net-insights">
      <header className="net-insights__header">
        <p className="net-insights__eyebrow">Netz-Analyse</p>
        <h2>Was der Export verrät</h2>
        <p className="net-insights__subtitle">
          Statistiken, Rekorde und Spielmetriken — live aus{' '}
          <code>tpf2_network_export.json</code>
        </p>
      </header>

      <div className="net-insights__hero-stats">
        <div className="net-insights__hero-stat">
          <Route size={20} />
          <strong>{scaledTotalKm.toFixed(0)} km</strong>
          <span>Gesamtstrecke (×{scale.distanceMultiplier})</span>
        </div>
        <div className="net-insights__hero-stat">
          <Users size={20} />
          <strong>{analytics.interchangeCount}</strong>
          <span>Umsteigepunkte</span>
        </div>
        <div className="net-insights__hero-stat">
          <Activity size={20} />
          <strong>{network.lines.length}</strong>
          <span>Linien aktiv</span>
        </div>
        <div className="net-insights__hero-stat">
          <TrendingUp size={20} />
          <strong>{analytics.avgSegmentKm.toFixed(1)} km</strong>
          <span>Ø Teilstrecke</span>
        </div>
      </div>

      <div className="net-insights__records">
        <h3>
          <Award size={18} /> Netzwerk-Rekorde
        </h3>
        <div className="net-insights__record-grid">
          {analytics.records.map((record, i) => (
            <motion.article
              key={record.id}
              className="record-card"
              style={{ '--record-accent': record.accent ?? 'var(--accent)' } as CSSProperties}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <span className="record-card__label">{record.label}</span>
              <strong className="record-card__value">{record.value}</strong>
              <p className="record-card__detail">{record.detail}</p>
            </motion.article>
          ))}
        </div>
      </div>

      <ComplexJourneysSection
        network={network}
        scale={scale}
        stations={stations}
        onPlanTrip={onPlanTrip}
      />

      <NetworkAdvisorSection network={network} onOpenStation={onOpenStation} />

      <div className="net-insights__grid">
        <section className="net-insights__card">
          <h3>Linien-Performance</h3>
          <p className="net-insights__card-desc">Halte, Streckenlänge & Spielstatistik pro Linie</p>
          <div className="line-performance">
            {analytics.linePerformance.map((line) => (
              <div
                key={line.lineId}
                className="line-performance__row"
                style={{ '--line-color': line.lineColor } as CSSProperties}
              >
                <span className="line-performance__name">
                  <span className="line-dot" style={{ backgroundColor: line.lineColor }} />
                  {line.lineName}
                </span>
                <span className="line-performance__meta">
                  {line.stopCount} Halte · {line.totalKm.toFixed(0)} km · {shapeLabel(line.shape as import('../../lib/maps/types').LineShape)}
                </span>
                <span className="line-performance__stats">
                  {line.passengers !== null && (
                    <>{line.passengers.toLocaleString('de-DE')} Pax</>
                  )}
                  {line.rate !== null && <> · Rate {line.rate}</>}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="net-insights__card">
          <h3>Top Mega-Hubs</h3>
          <p className="net-insights__card-desc">Die vernetztesten Umsteigebahnhöfe</p>
          <ol className="hub-ranking">
            {intelIndex.topHubs.slice(0, 12).map((hub) => (
              <li key={hub.id}>
                <button type="button" className="hub-ranking__btn" onClick={() => onOpenStation(hub.id)}>
                  <span className="hub-ranking__rank">#{hub.hubRank}</span>
                  <span className="hub-ranking__name">{hub.name}</span>
                  <span className="hub-ranking__meta">
                    {hub.degree} Verb. · {hub.lines.length} Linien
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="net-insights__card net-insights__card--wide">
          <h3>Export-Gesundheit</h3>
          <p className="net-insights__card-desc">Qualitätsreport vom Tixima Exporter</p>
          {analytics.experimentalNote && (
            <p className="net-insights__warning">
              <AlertTriangle size={15} />
              {analytics.experimentalNote}
            </p>
          )}
          <ul className="quality-list">
            {analytics.qualityHighlights.map((entry) => (
              <li key={entry.code} className={`quality-list__item quality-list__item--${entry.level}`}>
                <code>{entry.code}</code>
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        </section>

        {analytics.mapSpanKm && (
          <section className="net-insights__card">
            <h3>Karten-Fakt</h3>
            <p className="net-insights__card-desc">
              Diagonale Spannweite der Spielkarte laut Export-Metadaten
            </p>
            <p className="net-insights__big-number">
              {formatDistanceKm(analytics.mapSpanKm)}
            </p>
            <p className="net-insights__card-desc">
              {network.routing_nodes.length} Knoten · {network.routing_edges.length} Kanten
            </p>
          </section>
        )}
      </div>
    </section>
  )
}
