import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Lightbulb, Route, TrendingDown } from 'lucide-react'
import type { NetworkExport, NetworkMapMeta } from '../../types/network'
import { buildNetworkMapData } from '../../lib/maps/buildNetworkMapData'
import type { ComplexJourneyEntry } from '../../lib/routing/complexJourneys'
import { buildComplexJourneyLineProposals, type ProposedLineSegment } from '../../lib/routing/complexJourneyRemedies'
import { ComplexJourneyRemedyMap } from '../maps/ComplexJourneyRemedyMap'

interface ComplexJourneyRemedyPanelProps {
  network: NetworkExport
  entries: ComplexJourneyEntry[]
  boundingBox?: NetworkMapMeta['bounding_box']
}

export function ComplexJourneyRemedyPanel({
  network,
  entries,
  boundingBox,
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
            Nach dem Scan: für jede komplexe schnellste Route von Start über alle Halte bis Ziel —
            welche Teilstrecken fehlen und wie viele Umstiege eine Durchbindung spart.
          </p>
        </div>
      </header>

      <div className="complex-remedies__layout">
        <ComplexJourneyRemedyMap
          mapData={mapData}
          boundingBox={boundingBox}
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
                      {proposal.stationNames.length} Halte · {proposal.segments.length} Teilstrecken · ~
                      {proposal.totalMissingKm.toFixed(1)} km Plan
                    </span>
                    <span className="complex-remedies__item-reason">{proposal.summary}</span>
                    {proposal.transferDelta > 0 && (
                      <span className="complex-remedies__item-badge">
                        <TrendingDown size={12} aria-hidden />
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

              <ol className="complex-remedies__route-plan">
                {selected.stationNames.map((name, i) => (
                  <li key={`${name}-${i}`}>
                    <span className="complex-remedies__route-stop">{name}</span>
                    {i < selected.segments.length && (
                      <SegmentRow segment={selected.segments[i]} />
                    )}
                  </li>
                ))}
              </ol>
            </motion.div>
          )}
        </div>
      </div>
    </section>
  )
}

function SegmentRow({ segment }: { segment: ProposedLineSegment }) {
  const isProposal = segment.status === 'missing' || segment.transferAfter

  return (
    <div className={`complex-remedies__segment ${isProposal ? 'is-missing' : 'is-ok'}`}>
      {segment.status === 'missing' ? (
        <>
          <strong>Neubau</strong> → {segment.toName} (~{segment.estimatedKm.toFixed(1)} km)
        </>
      ) : segment.transferAfter ? (
        <>
          <strong>Durchbinden</strong> ({segment.existingLineName}) → {segment.toName} · Umstieg vermeiden
        </>
      ) : (
        <>
          <strong>{segment.existingLineName}</strong> → {segment.toName}
        </>
      )}
    </div>
  )
}
