import type { CSSProperties } from 'react'
import { ArrowDown, Footprints, Shuffle } from 'lucide-react'
import { motion } from 'framer-motion'
import type { NetworkExport } from '../../types/network'
import type { RouteLeg, StationOption } from '../../lib/routing/types'
import type { TransferAccessibilityDetail } from '../../lib/platform/accessibleRouting'
import { formatDuration } from '../../lib/format'
import { getTransferDisplaySeconds } from '../../lib/scale'
import { getTransferTracks } from '../../lib/platform/platformIntel'
import { filterTransferLineDirections } from '../../lib/station/hubDirectionFilter'
import { HubStopDirections } from './HubStopDirections'

interface TransferConnectionProps {
  stationName: string
  station: StationOption | undefined
  arrivalLeg: RouteLeg
  departureLeg: RouteLeg
  network: NetworkExport
  transferTimeSeconds: number
  accessibility?: TransferAccessibilityDetail
  staySeatedHint?: string | null
}

export function TransferConnection({
  stationName,
  station,
  arrivalLeg,
  departureLeg,
  network,
  transferTimeSeconds,
  accessibility,
  staySeatedHint,
}: TransferConnectionProps) {
  const tracks = getTransferTracks(network, arrivalLeg, departureLeg)
  const transferDisplaySeconds = getTransferDisplaySeconds(transferTimeSeconds)
  const lineDirections = filterTransferLineDirections(station?.lineDirections ?? [], {
    excludeLineIds: [arrivalLeg.lineId, departureLeg.lineId],
  })
  const samePlatform =
    accessibility?.samePlatform ??
    Boolean(
      tracks.arrivalTrack &&
        tracks.departureTrack &&
        tracks.arrivalTrack === tracks.departureTrack,
    )

  return (
    <motion.div
      className="transfer-connection"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      role="group"
      aria-label={`Umstieg in ${stationName}`}
    >
      <div className="transfer-connection__spine" aria-hidden />

      <header className="transfer-connection__header">
        <span className="transfer-connection__icon">
          <Shuffle size={15} />
        </span>
        <div className="transfer-connection__title">
          <strong>Umstieg in {stationName}</strong>
          <span>{formatDuration(transferDisplaySeconds)} Fußweg</span>
        </div>
      </header>

      {staySeatedHint && (
        <p className="transfer-connection__stay-seated">{staySeatedHint}</p>
      )}

      <div className="transfer-connection__legs">
        <div className="transfer-connection__leg transfer-connection__leg--arrival">
          <span className="transfer-connection__leg-label">Ankunft</span>
          <div className="transfer-connection__leg-main">
            <span
              className="transfer-connection__line-badge"
              style={{ '--line-color': arrivalLeg.lineColor } as CSSProperties}
            >
              {arrivalLeg.lineName.replace(/^Linie\s*/i, '')}
            </span>
            <span className="transfer-connection__route-hint">
              von {tracks.arrivalFrom ?? arrivalLeg.fromStationName}
            </span>
          </div>
          <div className="transfer-connection__platform">
            {tracks.arrivalTrack ? (
              <>
                <span className="transfer-connection__platform-label">Gleis</span>
                <span className="transfer-connection__platform-value">{tracks.arrivalTrack}</span>
              </>
            ) : (
              <span className="transfer-connection__platform-unknown">Gleis unbekannt</span>
            )}
          </div>
        </div>

        <div className="transfer-connection__bridge">
          <span className="transfer-connection__bridge-line" aria-hidden />
          <span className="transfer-connection__bridge-chip">
            <Footprints size={13} />
            {formatDuration(transferDisplaySeconds)}
            {!samePlatform && tracks.arrivalTrack && tracks.departureTrack && (
              <>
                <ArrowDown size={12} className="transfer-connection__bridge-arrow" />
                <span className="transfer-connection__platform-change">
                  {tracks.arrivalTrack} → {tracks.departureTrack}
                </span>
              </>
            )}
            {samePlatform && tracks.arrivalTrack && (
              <span className="transfer-connection__same-platform">gleiches Gleis</span>
            )}
          </span>
        </div>

        <div className="transfer-connection__leg transfer-connection__leg--departure">
          <span className="transfer-connection__leg-label">Abfahrt</span>
          <div className="transfer-connection__leg-main">
            <span
              className="transfer-connection__line-badge"
              style={{ '--line-color': departureLeg.lineColor } as CSSProperties}
            >
              {departureLeg.lineName.replace(/^Linie\s*/i, '')}
            </span>
            <span className="transfer-connection__route-hint">
              Richtung {tracks.departureTo ?? departureLeg.toStationName}
            </span>
          </div>
          <div className="transfer-connection__platform">
            {tracks.departureTrack ? (
              <>
                <span className="transfer-connection__platform-label">Gleis</span>
                <span className="transfer-connection__platform-value">{tracks.departureTrack}</span>
              </>
            ) : (
              <span className="transfer-connection__platform-unknown">Gleis unbekannt</span>
            )}
          </div>
        </div>
      </div>

      {accessibility?.reason && (
        <p
          className={`transfer-connection__accessibility${accessibility.unavoidable ? ' transfer-connection__accessibility--required' : ' transfer-connection__accessibility--ok'}`}
        >
          {accessibility.unavoidable ? 'Gleiswechsel nötig: ' : ''}
          {accessibility.reason}
        </p>
      )}

      {lineDirections.length > 0 && (
        <div className="transfer-connection__hub">
          <span className="transfer-connection__hub-label">Weitere Umsteigeoptionen</span>
          <HubStopDirections directions={lineDirections} maxVisible={6} compact />
        </div>
      )}
    </motion.div>
  )
}
