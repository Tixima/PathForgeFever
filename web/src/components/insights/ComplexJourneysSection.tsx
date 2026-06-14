import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeftRight,
  ArrowRight,
  Loader2,
  Play,
  RefreshCw,
  Route,
  Search,
  Shuffle,
  Square,
  Timer,
} from 'lucide-react'
import type { NetworkExport } from '../../types/network'
import type { StationOption } from '../../lib/routing/types'
import type { ScaleSettings } from '../../lib/scale'
import {
  countStationPairs,
  createComplexJourneyScanner,
  emptyComplexJourneyScanState,
  tierLabel,
  type ComplexJourneyEntry,
  type ComplexJourneyScanState,
} from '../../lib/routing/complexJourneys'
import {
  formatStationPairLabel,
  groupComplexJourneyEntries,
  type StationPairLabel,
} from '../../lib/routing/complexJourneyGroups'
import { ComplexJourneyRemedyPanel } from './ComplexJourneyRemedyPanel'
import { formatRouteStats } from '../../lib/format'

type ScanPhase = 'idle' | 'scanning' | 'done' | 'error'

interface ComplexJourneysSectionProps {
  network: NetworkExport
  scale: ScaleSettings
  stations: StationOption[]
  onPlanTrip: (from: StationOption, to: StationOption) => void
}

function findStation(stations: StationOption[], id: number): StationOption | undefined {
  return stations.find((s) => s.id === id)
}

function formatAverageFastest(seconds: number, scale: ScaleSettings): string {
  return formatRouteStats(seconds, 0, scale).duration
}

export function ComplexJourneysSection({
  network,
  scale,
  stations,
  onPlanTrip,
}: ComplexJourneysSectionProps) {
  const totalPairs = countStationPairs(network.routing_nodes.length)
  const [phase, setPhase] = useState<ScanPhase>('idle')
  const [scan, setScan] = useState<ComplexJourneyScanState | null>(null)
  const [graphBuilding, setGraphBuilding] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const scannerRef = useRef<ReturnType<typeof createComplexJourneyScanner> | null>(null)
  const timerRef = useRef<number | null>(null)
  const sessionRef = useRef(0)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const stopScan = useCallback(() => {
    sessionRef.current += 1
    clearTimer()
    scannerRef.current = null
    setGraphBuilding(false)
    setPhase('idle')
    setScan(null)
    setScanError(null)
  }, [clearTimer])

  const runScan = useCallback(() => {
    sessionRef.current += 1
    const session = sessionRef.current
    clearTimer()
    scannerRef.current = null
    setScanError(null)
    setGraphBuilding(true)
    setPhase('scanning')
    setScan(emptyComplexJourneyScanState(totalPairs))

    const schedule = (fn: () => void, delayMs = 0) => {
      timerRef.current = window.setTimeout(() => {
        if (session !== sessionRef.current) return
        fn()
      }, delayMs)
    }

    schedule(() => {
      try {
        scannerRef.current = createComplexJourneyScanner(network)
        setGraphBuilding(false)
      } catch (err) {
        setScanError(err instanceof Error ? err.message : 'Scan konnte nicht starten')
        setPhase('error')
        setGraphBuilding(false)
        return
      }

      const tick = () => {
        if (session !== sessionRef.current || !scannerRef.current) return

        try {
          const next = scannerRef.current.step()
          setScan(next)

          if (!next.finished) {
            schedule(tick, 4)
          } else {
            setPhase('done')
            scannerRef.current = null
            timerRef.current = null
          }
        } catch (err) {
          setScanError(err instanceof Error ? err.message : 'Fehler beim Scannen')
          setPhase('error')
          scannerRef.current = null
        }
      }

      schedule(tick, 4)
    }, 16)
  }, [clearTimer, network, totalPairs])

  const progress = scan && scan.total > 0 ? Math.round((scan.done / scan.total) * 100) : 0
  const resultGroups = useMemo(
    () => (scan ? groupComplexJourneyEntries(scan.entries) : []),
    [scan],
  )
  const rankedGroups = useMemo(() => {
    let rank = 0
    return resultGroups.map((group) => ({
      group,
      items: group.entries.map((entry) => {
        rank += 1
        return {
          entry,
          rank,
          pair: formatStationPairLabel(entry),
        }
      }),
    }))
  }, [resultGroups])
  const resultCount = resultGroups.reduce((sum, group) => sum + group.entries.length, 0)

  return (
    <section className="complex-journeys">
      <header className="complex-journeys__header">
        <div>
          <p className="complex-journeys__eyebrow">Routing-Labor</p>
          <h3>
            <Shuffle size={20} aria-hidden />
            Komplexeste Reisen
          </h3>
          <p className="complex-journeys__subtitle">
            Rankt alle Station-Paare nach der Komplexität ihrer{' '}
            <strong>schnellsten Verbindung</strong> — welche Strecken erfordern selbst optimal
            die meisten Umstiege und Halte?
          </p>
        </div>
        {phase === 'done' && (
          <button type="button" className="complex-journeys__rescan" onClick={runScan}>
            <RefreshCw size={16} />
            Neu scannen
          </button>
        )}
      </header>

      {phase === 'idle' && (
        <div className="complex-journeys__start">
          <div className="complex-journeys__start-icon">
            <Search size={28} />
          </div>
          <p className="complex-journeys__start-text">
            <strong>{totalPairs.toLocaleString('de-DE')} Station-Paare</strong> werden geprüft —
            je eine schnellste Route pro Paar. Der Scan startet erst nach deinem Klick.
          </p>
          <button type="button" className="complex-journeys__start-btn" onClick={runScan}>
            <Play size={18} />
            Komplexitäts-Scan starten
          </button>
        </div>
      )}

      {(phase === 'error' || scanError) && (
        <p className="complex-journeys__error">
          {scanError ?? 'Unbekannter Fehler'}
          <button type="button" className="complex-journeys__rescan" onClick={runScan}>
            Erneut versuchen
          </button>
        </p>
      )}

      {phase === 'scanning' && (
        <div className="complex-journeys__live">
          {graphBuilding ? (
            <>
              <p className="complex-journeys__preparing">
                <Loader2 size={16} className="spin" />
                Routing-Graph wird vorbereitet…
              </p>
              <button type="button" className="complex-journeys__stop" onClick={stopScan}>
                <Square size={14} />
                Abbrechen
              </button>
            </>
          ) : (
            <>
          <div className="complex-journeys__progress-wrap">
            <div className="complex-journeys__progress-head">
              <span>
                <Loader2 size={15} className="spin" />
                Scan läuft…
              </span>
              <span>{progress}%</span>
            </div>
            <div
              className="complex-journeys__progress"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <motion.div
                className="complex-journeys__progress-bar"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.15 }}
              />
            </div>
          </div>

          <div className="complex-journeys__live-grid">
            <div className="complex-journeys__live-stat">
              <span className="complex-journeys__live-label">Paare geprüft</span>
              <strong>
                {(scan?.done ?? 0).toLocaleString('de-DE')} / {(scan?.total ?? totalPairs).toLocaleString('de-DE')}
              </strong>
            </div>
            <div className="complex-journeys__live-stat">
              <span className="complex-journeys__live-label">Paare mit Umstieg</span>
              <strong>{(scan?.routesFound ?? 0).toLocaleString('de-DE')}</strong>
            </div>
            <div className="complex-journeys__live-stat">
              <span className="complex-journeys__live-label">Ø schnellste Reise</span>
              <strong>
                {scan && scan.reachablePairs > 0
                  ? formatAverageFastest(scan.averageFastestSeconds, scale)
                  : '—'}
              </strong>
            </div>
            <div className="complex-journeys__live-stat">
              <span className="complex-journeys__live-label">Max. Umstiege</span>
              <strong>{scan?.networkMaxTransfers ?? 0}</strong>
            </div>
            <div className="complex-journeys__live-stat">
              <span className="complex-journeys__live-label">Max. Halte</span>
              <strong>{scan?.networkMaxStops ?? 0}</strong>
            </div>
          </div>

          {scan?.currentFromName && scan.currentToName && (
            <p className="complex-journeys__current-pair">
              Aktuell: <strong>{scan.currentFromName}</strong>
              <ArrowRight size={13} aria-hidden />
              <strong>{scan.currentToName}</strong>
            </p>
          )}

          {scan?.leader && (
            <div className="complex-journeys__leader">
              <span className="complex-journeys__leader-label">Aktueller Rekord</span>
              <LeaderPreview entry={scan.leader} />
            </div>
          )}

          <button type="button" className="complex-journeys__stop" onClick={stopScan}>
            <Square size={14} />
            Abbrechen
          </button>
            </>
          )}
        </div>
      )}

      {phase === 'done' && scan && (
        <div className="complex-journeys__summary">
          <p className="complex-journeys__progress-label">
            Fertig — {scan.routesFound.toLocaleString('de-DE')} Paare mit Umstieg · Ø schnellste
            Reise{' '}
            {scan.reachablePairs > 0
              ? formatAverageFastest(scan.averageFastestSeconds, scale)
              : '—'}{' '}
            über {scan.reachablePairs.toLocaleString('de-DE')} erreichbare Paare · max.{' '}
            {scan.networkMaxTransfers} Umstiege · {scan.networkMaxStops} Halte
          </p>
        </div>
      )}

      {phase === 'done' && resultCount === 0 && (
        <p className="complex-journeys__empty">
          Kein Station-Paar braucht in der schnellsten Verbindung einen Umstieg.
        </p>
      )}

      {phase === 'done' && resultCount > 0 && (
        <ol className="complex-journeys__list">
          <AnimatePresence initial={false}>
            {rankedGroups.map(({ group, items }) => (
              <motion.li
                key={`hub-${group.hubStationId}-${group.entries.map((e) => undirectedEntryKey(e)).join('-')}`}
                className={`complex-journeys__group complex-journey--${group.tier}`}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
              >
                {group.entries.length > 1 ? (
                  <header className="complex-journeys__group-header">
                    <div className="complex-journeys__group-title">
                      <strong>{group.hubStationName}</strong>
                      <span className="complex-journeys__group-meta">
                        {group.entries.length} schwierige Verbindungen · max.{' '}
                        {group.maxTransfers} Umstiege
                      </span>
                    </div>
                    <span className={`complex-journey__tier complex-journey__tier--${group.tier}`}>
                      {tierLabel(group.tier)}
                    </span>
                  </header>
                ) : null}

                <ul className="complex-journeys__group-list">
                  {items.map(({ entry, rank, pair }) => (
                    <ComplexJourneyCard
                      key={undirectedEntryKey(entry)}
                      entry={entry}
                      pair={pair}
                      rank={rank}
                      compact={group.entries.length > 1}
                      hubStationId={group.hubStationId}
                      hubStationName={group.hubStationName}
                      scale={scale}
                      onPlan={() => {
                        const from = findStation(stations, entry.fromId)
                        const to = findStation(stations, entry.toId)
                        if (from && to) onPlanTrip(from, to)
                      }}
                    />
                  ))}
                </ul>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}

      {phase === 'done' && scan && resultCount > 0 && (
        <ComplexJourneyRemedyPanel
          network={network}
          entries={scan.entries}
          boundingBox={network.network_map?.bounding_box}
          scale={scale}
        />
      )}
    </section>
  )
}

function undirectedEntryKey(entry: ComplexJourneyEntry): string {
  return entry.fromId < entry.toId
    ? `${entry.fromId}-${entry.toId}`
    : `${entry.toId}-${entry.fromId}`
}

function LeaderPreview({ entry }: { entry: ComplexJourneyEntry }) {
  const pair = formatStationPairLabel(entry)
  return (
    <div className={`complex-journeys__leader-card complex-journey--${entry.tier}`}>
      <strong>
        {pair.aName}
        <ArrowLeftRight size={13} aria-hidden />
        {pair.bName}
      </strong>
      <span className={`complex-journey__tier complex-journey__tier--${entry.tier}`}>
        {tierLabel(entry.tier)}
      </span>
      <span className="complex-journeys__leader-meta">
        {entry.route.transferCount} Umstiege · {entry.route.stopCount} Halte ·{' '}
        {entry.route.legs.length} Linien · schnellste Verbindung
      </span>
    </div>
  )
}

function otherStationName(entry: ComplexJourneyEntry, hubStationId: number): string {
  if (entry.fromId === hubStationId) return entry.toName
  if (entry.toId === hubStationId) return entry.fromName
  const pair = formatStationPairLabel(entry)
  return pair.bName
}

function ComplexJourneyCard({
  entry,
  pair,
  rank,
  compact,
  hubStationId,
  hubStationName,
  scale,
  onPlan,
}: {
  entry: ComplexJourneyEntry
  pair: StationPairLabel
  rank: number
  compact: boolean
  hubStationId: number
  hubStationName: string
  scale: ScaleSettings
  onPlan: () => void
}) {
  const stats = formatRouteStats(entry.route.totalDurationSeconds, entry.route.totalDistanceMeters, scale)
  const otherName = compact ? otherStationName(entry, hubStationId) : null

  return (
    <motion.li
      className={`complex-journey complex-journey--${entry.tier}${compact ? ' complex-journey--compact' : ''}`}
      layout
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.28, delay: Math.min(rank * 0.02, 0.4) }}
    >
      <div className="complex-journey__rank">#{rank}</div>

      <div className="complex-journey__main">
        <div className="complex-journey__route-title">
          <strong>
            {compact && otherName ? (
              <>
                {otherName}
                <ArrowLeftRight size={14} aria-hidden />
                {hubStationName}
              </>
            ) : (
              <>
                {pair.aName}
                <ArrowLeftRight size={14} aria-hidden />
                {pair.bName}
              </>
            )}
          </strong>
          {!compact && (
            <span className={`complex-journey__tier complex-journey__tier--${entry.tier}`}>
              {tierLabel(entry.tier)}
            </span>
          )}
        </div>

        {!compact && (
          <>
        <div className="complex-journey__path">
          {entry.route.stationNames.map((name, i) => (
            <span key={`${name}-${i}`} className="complex-journey__stop">
              {i > 0 && <span className="complex-journey__path-arrow">→</span>}
              <span className={i === 0 || i === entry.route.stationNames.length - 1 ? 'is-terminal' : ''}>
                {name}
              </span>
            </span>
          ))}
        </div>

        <div className="complex-journey__legs">
          {entry.route.legs.map((leg, i) => (
            <span
              key={`${leg.lineId}-${i}`}
              className="complex-journey__leg"
              style={{ '--leg-color': leg.lineColor } as CSSProperties}
            >
              {leg.lineName}
            </span>
          ))}
        </div>
          </>
        )}

        {compact && (
          <div className="complex-journey__legs">
            {entry.route.legs.map((leg, i) => (
              <span
                key={`${leg.lineId}-${i}`}
                className="complex-journey__leg"
                style={{ '--leg-color': leg.lineColor } as CSSProperties}
              >
                {leg.lineName}
              </span>
            ))}
          </div>
        )}

        <div className="complex-journey__stats">
          <span className="complex-journey__stat complex-journey__stat--hot">
            <Shuffle size={13} />
            {entry.route.transferCount} Umstiege
          </span>
          <span className="complex-journey__stat">
            <Route size={13} />
            {entry.route.stopCount} Halte · {entry.route.legs.length} Linien
          </span>
          <span className="complex-journey__stat">
            <Timer size={13} />
            {stats.duration}
          </span>
          {!compact && (
            <span className="complex-journey__stat complex-journey__stat--dim">
              Schnellste Verbindung
            </span>
          )}
        </div>
      </div>

      <button type="button" className="complex-journey__plan" onClick={onPlan}>
        Route planen
      </button>
    </motion.li>
  )
}
