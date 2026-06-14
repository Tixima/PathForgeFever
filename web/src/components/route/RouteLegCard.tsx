import { ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import type { CSSProperties } from 'react'

import type { RouteLeg, StationOption } from '../../lib/routing/types'
import type { TransferAccessibilityDetail } from '../../lib/platform/accessibleRouting'

import type { NetworkExport } from '../../types/network'

import type { ScaleSettings } from '../../lib/scale'

import { formatDuration } from '../../lib/format'

import { getScaledRouteValues } from '../../lib/scale'

import { getStationTransferTime } from '../../lib/routing/buildGraph'
import { buildStaySeatedHint, getStaySeatedStopIndices } from '../../lib/routing/staySeatedStops'

import { LegStopStrip } from './LegStopStrip'

import { TransferConnection } from './TransferConnection'



interface RouteLegCardProps {

  leg: RouteLeg

  index: number

  scale: ScaleSettings

  stations: StationOption[]

  network: NetworkExport

  nextLeg?: RouteLeg

  showTransfer?: boolean
  transferAccessibility?: TransferAccessibilityDetail
}



export function RouteLegCard({

  leg,

  index,

  scale,

  stations,

  network,

  nextLeg,

  showTransfer = false,
  transferAccessibility,
}: RouteLegCardProps) {
  const legScaled = getScaledRouteValues(leg.durationSeconds, leg.distanceMeters, scale)
  const transferStation = stations.find((s) => s.name === leg.toStationName && s.interchange)
  const staySeatedIndices =
    showTransfer && nextLeg ? getStaySeatedStopIndices(leg.stops, leg.toStationName) : []
  const staySeatedHint =
    showTransfer && nextLeg ? buildStaySeatedHint(leg.toStationName, staySeatedIndices.length) : null

  return (
    <motion.div

      className="leg-card"

      style={{ '--leg-color': leg.lineColor } as CSSProperties}

      initial={{ opacity: 0, x: -12 }}

      animate={{ opacity: 1, x: 0 }}

      transition={{ delay: index * 0.08, duration: 0.3 }}

    >

      <div className="leg-card__header">

        <div className="leg-card__header-main">

          <span className="leg-card__badge">{leg.lineName}</span>

          <p className="leg-card__route">

            <strong>{leg.fromStationName}</strong>

            <ArrowRight size={14} aria-hidden />

            <strong>{leg.toStationName}</strong>

          </p>

        </div>

        <div className="leg-card__header-side">

          <span className="leg-card__duration">{formatDuration(legScaled.durationSeconds)}</span>

          <span className="leg-card__meta">

            {leg.edgeCount} Teilstrecke{leg.edgeCount !== 1 ? 'n' : ''} · {leg.stops.length} Halte

          </span>

        </div>

      </div>



      <LegStopStrip
        stops={leg.stops}
        lineColor={leg.lineColor}
        lineId={leg.lineId}
        fromName={leg.fromStationName}
        toName={leg.toStationName}
        stations={stations}
        staySeatedIndices={staySeatedIndices}
      />



      {showTransfer && nextLeg && (

        <TransferConnection

          stationName={leg.toStationName}

          station={transferStation}

          arrivalLeg={leg}

          departureLeg={nextLeg}

          network={network}

          transferTimeSeconds={getStationTransferTime(network, leg.toStationId)}
          accessibility={transferAccessibility}
          staySeatedHint={staySeatedHint}
        />

      )}

    </motion.div>

  )

}


