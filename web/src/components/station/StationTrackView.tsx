import { useMemo, type CSSProperties } from 'react'
import { ArrowRight, Train } from 'lucide-react'
import type { NetworkExport } from '../../types/network'
import { buildStationTrackView, type TrackDeparture } from '../../lib/station/stationTrackView'

interface StationTrackViewProps {
  network: NetworkExport
  stationGroupId: number
  stationName: string
  onSelectNextStop?: (nextStopId: number, nextStopName: string) => void
}

function ServiceRow({
  dep,
  onSelectNextStop,
}: {
  dep: TrackDeparture
  onSelectNextStop?: (nextStopId: number, nextStopName: string) => void
}) {
  const body = (
    <>
      <span
        className="track-view__line-square"
        style={{ backgroundColor: dep.lineColor } as CSSProperties}
        title={dep.lineName}
      >
        {dep.lineShort}
      </span>
      <span className="track-view__line-name">{dep.lineName}</span>
      <span className="track-view__arrow" aria-hidden>
        <ArrowRight size={14} />
      </span>
      <span className="track-view__dest">{dep.towardsLabel}</span>
      <span className="track-view__terminus-hint">
        {dep.terminusFrom} – {dep.terminusTo}
      </span>
    </>
  )

  if (onSelectNextStop) {
    return (
      <button
        type="button"
        className="track-view__service-row"
        style={{ '--line-color': dep.lineColor } as CSSProperties}
        onClick={() => onSelectNextStop(dep.nextStopId, dep.nextStop)}
        title={`Route nach ${dep.nextStop}`}
      >
        {body}
      </button>
    )
  }

  return (
    <div className="track-view__service-row" style={{ '--line-color': dep.lineColor } as CSSProperties}>
      {body}
    </div>
  )
}

export function StationTrackView({
  network,
  stationGroupId,
  stationName,
  onSelectNextStop,
}: StationTrackViewProps) {
  const view = useMemo(
    () => buildStationTrackView(network, stationGroupId),
    [network, stationGroupId],
  )

  const totalServices =
    view.lanes.reduce((n, lane) => n + lane.departures.length, 0) + view.unassigned.length
  if (totalServices === 0) return null

  const nativeLanes = view.lanes.filter((l) => l.isNative).length

  return (
    <section className="track-view track-view--terminals" aria-label={`Terminals ${stationName}`}>
      <header className="track-view__header">
        <div className="track-view__header-main">
          <Train size={18} aria-hidden />
          <div>
            <p className="track-view__eyebrow">Terminals</p>
            <h4>{stationName}</h4>
          </div>
        </div>
        <div className="track-view__header-stats">
          <span>{view.lanes.length} belegte Terminals</span>
          {view.maxTerminalNumber != null && view.maxTerminalNumber > view.lanes.length && (
            <span>bis Terminal {view.maxTerminalNumber}</span>
          )}
          {nativeLanes > 0 && (
            <span className="track-view__native-badge">{nativeLanes}× native Gleisdaten</span>
          )}
        </div>
      </header>

      <div className="track-view__table" role="table" aria-label="Gleisbelegung">
        <div className="track-view__table-head" role="row">
          <span role="columnheader">Terminal</span>
          <span role="columnheader">Gleis</span>
          <span role="columnheader">Linien & Richtung</span>
        </div>

        <ol className="track-view__table-body">
          {view.lanes.map((lane) => (
            <li
              key={lane.id}
              className={`track-view__table-row ${lane.isNative ? 'track-view__table-row--native' : ''}`}
              role="row"
            >
              <div className="track-view__cell track-view__cell--terminal" role="cell">
                <strong>{lane.terminalNumber ?? '—'}</strong>
              </div>
              <div className="track-view__cell track-view__cell--gleis" role="cell">
                <span>{lane.trackLabel}</span>
                {lane.platformLabel && lane.platformLabel !== lane.trackLabel && (
                  <small>{lane.platformLabel}</small>
                )}
              </div>
              <div className="track-view__cell track-view__cell--services" role="cell">
                {lane.departures.map((dep) => (
                  <ServiceRow
                    key={`${dep.lineId}-${dep.nextStopId}`}
                    dep={dep}
                    onSelectNextStop={onSelectNextStop}
                  />
                ))}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {view.unassigned.length > 0 && (
        <div className="track-view__unassigned">
          <h5>Ohne Gleis im Export</h5>
          <div className="track-view__cell track-view__cell--services">
            {view.unassigned.map((dep) => (
              <ServiceRow
                key={`u-${dep.lineId}-${dep.nextStopId}`}
                dep={dep}
                onSelectNextStop={onSelectNextStop}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
