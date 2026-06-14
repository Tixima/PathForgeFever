import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Lightbulb, Route, Shuffle, TrendingDown } from 'lucide-react'
import type { NetworkExport, NetworkMapMeta } from '../../types/network'
import { buildNetworkMapData } from '../../lib/maps/buildNetworkMapData'
import type { ComplexJourneyEntry } from '../../lib/routing/complexJourneys'
import {
  buildComplexJourneyLineProposals,
  type ProposedLineSegment,
  type ReferenceRouteSegment,
} from '../../lib/routing/complexJourneyRemedies'
import type { ScaleSettings } from '../../lib/scale'
import { formatDuration, formatRouteStats } from '../../lib/format'
import { getScaledRouteValues, scaleDuration } from '../../lib/scale'
import { ComplexJourneyRemedyMap } from '../maps/ComplexJourneyRemedyMap'

interface ComplexJourneyRemedyPanelProps {
  network: NetworkExport
  entries: ComplexJourneyEntry[]
  boundingBox?: NetworkMapMeta['bounding_box']
  scale: ScaleSettings
}

export function ComplexJourneyRemedyPanel({
  network,
  entries,
  boundingBox,
  scale,
}: ComplexJourneyRemedyPanelProps) {
  const proposals = useMemo(
    () => buildComplexJourneyLineProposals(network, entries),
    [network, entries],
  )
  const mapData = useMemo(() => buildNetworkMapData(network), [network])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (proposals.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !proposals.some((p) => p.id === selectedId)) {
      setSelectedId(proposals[0].id)
    }
  }, [proposals, selectedId])

  const selected = proposals.find((p) => p.id === selectedId) ?? proposals[0] ?? null

  if (proposals.length === 0) return null

  return (
    <section className="complex-remedies">
      <header className="complex-remedies__header">
        <div>
          <p className="complex-remedies__eyebrow">Netzlücken & Lösungen</p>
          <h4>
            <Lightbulb size={18} aria-hidden />
            Linienpläne für die schwierigsten Paare
          </h4>
          <p className="complex-remedies__subtitle">
            Vorschläge für komplett neue Linien entlang der Luftlinie — nicht Durchbindungen
            bestehender Strecken. Zeiten und Distanzen inkl. Realzeit-Multiplikator.
          </p>
        </div>
      </header>

      <div className="complex-remedies__layout">
        <ComplexJourneyRemedyMap
          mapData={mapData}
          boundingBox={boundingBox}
          terrain={network.terrain}
          proposals={proposals}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <div className="complex-remedies__sidebar">
          <h5>
            <Route size={15} aria-hidden />
            {proposals.length} Linienvorschläge
          </h5>
          <ul className="complex-remedies__list">
            {proposals.map((proposal) => {
              const pair =
                proposal.fromId < proposal.toId
                  ? { aName: proposal.fromName, bName: proposal.toName }
                  : { aName: proposal.toName, bName: proposal.fromName }

              const missingStats = formatRouteStats(
                proposal.totalMissingSeconds,
                proposal.totalMissingKm * 1000,
                scale,
              )
              const savedScaled = scaleDuration(proposal.timeSavedSeconds, scale)

              return (
                <li key={proposal.id}>
                  <button
                    type="button"
                    className={`complex-remedies__item ${selectedId === proposal.id ? 'is-active' : ''}`}
                    onClick={() => setSelectedId(proposal.id)}
                  >
                    <strong>
                      {pair.aName} ↔ {pair.bName}
                    </strong>
                    <span className="complex-remedies__item-meta">
                      {proposal.stationNames.length} Halte · {proposal.segments.length} Neubau-Abschnitte ·{' '}
                      {missingStats.distance}
                    </span>
                    <span className="complex-remedies__item-reason">{proposal.summary}</span>
                    <span className="complex-remedies__item-badge">
                      <TrendingDown size={12} aria-hidden />−{formatDuration(savedScaled)} ·{' '}
                      {proposal.beneficiaryCount} Paar{proposal.beneficiaryCount !== 1 ? 'e' : ''}
                    </span>
                    {proposal.transferDelta > 0 && (
                      <span className="complex-remedies__item-badge complex-remedies__item-badge--muted">
                        {proposal.beforeTransfers} → {proposal.afterTransfers} Umstiege
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>

          {selected && (
            <motion.div
              key={selected.id}
              className="complex-remedies__detail"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h5>
                Route: {selected.fromName}
                <ArrowRight size={13} aria-hidden />
                {selected.toName}
              </h5>
              <p className="complex-remedies__detail-lead">{selected.summary}</p>
              <CompareRow proposal={selected} scale={scale} />

              <div className="complex-remedies__detail-section">
                <h6>
                  Ist-Route · {selected.beforeTransfers} Umstieg
                  {selected.beforeTransfers !== 1 ? 'e' : ''}
                </h6>
                <ReferenceRoutePlan segments={selected.referenceSegments} scale={scale} />
              </div>

              <div className="complex-remedies__detail-section">
                <h6>Neue Linie (Neubau)</h6>
                <ol className="complex-remedies__route-plan">
                  {selected.stationNames.map((name, i) => (
                    <li key={`new-${name}-${i}`}>
                      <span className="complex-remedies__route-stop">{name}</span>
                      {i < selected.segments.length && (
                        <ProposalSegmentRow segment={selected.segments[i]} scale={scale} />
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </section>
  )
}

function CompareRow({
  proposal,
  scale,
}: {
  proposal: {
    beforeSeconds: number
    afterSeconds: number
    beforeDistanceMeters: number
    afterDistanceMeters: number
    timeSavedSeconds: number
    referenceStationNames: string[]
  }
  scale: ScaleSettings
}) {
  const before = formatRouteStats(proposal.beforeSeconds, proposal.beforeDistanceMeters, scale)
  const after = formatRouteStats(proposal.afterSeconds, proposal.afterDistanceMeters, scale)
  const saved = formatDuration(scaleDuration(proposal.timeSavedSeconds, scale))

  return (
    <p className="complex-remedies__detail-compare">
      Ist: {proposal.referenceStationNames.length} Halte · {before.duration} · {before.distance} → Neu:{' '}
      {after.duration} · {after.distance} (−{saved})
    </p>
  )
}

function ReferenceRoutePlan({
  segments,
  scale,
}: {
  segments: ReferenceRouteSegment[]
  scale: ScaleSettings
}) {
  if (segments.length === 0) return null

  return (
    <ol className="complex-remedies__route-plan complex-remedies__route-plan--reference">
      <li>
        <span className="complex-remedies__route-stop">{segments[0].fromName}</span>
      </li>
      {segments.map((segment) => (
        <li key={`${segment.fromId}-${segment.toId}`}>
          <ReferenceSegmentRow segment={segment} scale={scale} />
          <span className="complex-remedies__route-stop">{segment.toName}</span>
          {segment.transferAfter && (
            <span className="complex-remedies__transfer-badge">
              <Shuffle size={11} aria-hidden />
              Umstieg
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

function ReferenceSegmentRow({
  segment,
  scale,
}: {
  segment: ReferenceRouteSegment
  scale: ScaleSettings
}) {
  const stats = formatSegmentStats(segment.durationSeconds, segment.distanceMeters, scale)

  return (
    <div
      className="complex-remedies__segment is-reference"
      style={{ '--line-color': segment.lineColor } as CSSProperties}
    >
      <strong>{segment.lineName}</strong> → {segment.toName} ({stats})
    </div>
  )
}

function ProposalSegmentRow({
  segment,
  scale,
}: {
  segment: ProposedLineSegment
  scale: ScaleSettings
}) {
  const stats = formatSegmentStats(segment.estimatedSeconds, segment.estimatedKm * 1000, scale)

  return (
    <div className="complex-remedies__segment is-missing">
      <strong>Neubau</strong> → {segment.toName} ({stats})
    </div>
  )
}

function formatSegmentStats(
  durationSeconds: number,
  distanceMeters: number,
  scale: ScaleSettings,
): string {
  const scaled = getScaledRouteValues(durationSeconds, distanceMeters, scale)
  return `${formatRouteStats(durationSeconds, distanceMeters, scale).distance} · ${formatDuration(scaled.durationSeconds)}`
}
