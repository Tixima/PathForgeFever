import { useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import { motion } from 'framer-motion'
import type { StationOption } from '../../lib/routing/types'
import type { LineDirectionAtStop } from '../../lib/station/stationLineDirections'
import { filterTransferLineDirections } from '../../lib/station/hubDirectionFilter'
import { FloatingHubTooltip } from './FloatingHubTooltip'
import { HubStopDirections } from './HubStopDirections'

interface LegStopStripProps {
  stops: string[]
  lineColor: string
  lineId: number
  fromName: string
  toName: string
  stations: StationOption[]
  staySeatedIndices?: number[]
}

type StopKind = 'start' | 'end' | 'stop'

interface HubHoverState {
  name: string
  lineDirections: LineDirectionAtStop[]
  anchor: HTMLElement
}

function getStopKind(index: number, total: number): StopKind {
  if (index === 0) return 'start'
  if (index === total - 1) return 'end'
  return 'stop'
}

function getTransferOptions(
  station: StationOption | undefined,
  lineId: number,
  legStops: string[],
  stopIndex: number,
): LineDirectionAtStop[] {
  if (!station?.interchange) return []
  return filterTransferLineDirections(station.lineDirections ?? [], {
    currentLineId: lineId,
    legStops,
    stopIndex,
  })
}

export function LegStopStrip({
  stops,
  lineColor,
  lineId,
  fromName,
  toName,
  stations,
  staySeatedIndices = [],
}: LegStopStripProps) {
  const [hoveredHub, setHoveredHub] = useState<HubHoverState | null>(null)
  const staySeatedSet = useMemo(() => new Set(staySeatedIndices), [staySeatedIndices])

  const stationByName = useMemo(() => {
    const map = new Map<string, StationOption>()
    for (const s of stations) {
      if (!map.has(s.name)) map.set(s.name, s)
    }
    return map
  }, [stations])

  if (stops.length === 0) return null

  const compact = stops.length > 7

  function showHubTooltip(name: string, anchor: HTMLElement, stopIndex: number) {
    const station = stationByName.get(name)
    const lineDirections = getTransferOptions(station, lineId, stops, stopIndex)
    if (lineDirections.length === 0) return
    setHoveredHub({ name, lineDirections, anchor })
  }

  function handleHubEnter(name: string, stopIndex: number, event: MouseEvent<HTMLElement>) {
    showHubTooltip(name, event.currentTarget, stopIndex)
  }

  return (
    <>
      <div
        className={`stop-strip ${compact ? 'stop-strip--compact' : ''}`}
        style={
          {
            '--strip-color': lineColor,
            '--rail-min': `${Math.max(stops.length * 68, 280)}px`,
          } as CSSProperties
        }
      >
        <div className="stop-strip__scroll">
          <div className="stop-strip__rail" aria-label={`${fromName} nach ${toName}`}>
            <div className="stop-strip__track" aria-hidden />
            {stops.map((name, index) => {
              const kind = getStopKind(index, stops.length)
              const station = stationByName.get(name)
              const lineDirections = getTransferOptions(station, lineId, stops, index)
              const isHub = lineDirections.length > 0
              const isHovered = hoveredHub?.name === name
              const staySeated = staySeatedSet.has(index)

              return (
                <motion.div
                  key={`${name}-${index}`}
                  className={`stop-strip__node stop-strip__node--${kind} ${isHub ? 'stop-strip__node--hub' : ''} ${staySeated ? 'stop-strip__node--stay' : ''} ${isHovered ? 'is-hovered' : ''}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03, duration: 0.22 }}
                  onMouseEnter={(e) => isHub && handleHubEnter(name, index, e)}
                  onMouseLeave={() => isHub && setHoveredHub(null)}
                  onFocus={(e) => isHub && showHubTooltip(name, e.currentTarget, index)}
                  onBlur={() => isHub && setHoveredHub(null)}
                  tabIndex={isHub ? 0 : undefined}
                  title={staySeated ? 'Nicht aussteigen — Umstieg erst beim nächsten Halt hier' : undefined}
                >
                  <span className="stop-strip__dot" />
                  <span className="stop-strip__label">{name}</span>
                  {staySeated && <span className="stop-strip__stay">Sitzenbleiben</span>}
                  {isHub && (
                    <HubStopDirections
                      directions={lineDirections}
                      maxVisible={compact ? 2 : 3}
                      compact={compact}
                      highlightLineId={lineId}
                    />
                  )}
                </motion.div>
              )
            })}
          </div>
        </div>

        {compact && (
          <p className="stop-strip__hint">
            {stops.length} Halte · horizontal scrollen · Umsteiger hovern
          </p>
        )}
      </div>

      <FloatingHubTooltip
        open={hoveredHub !== null}
        anchor={hoveredHub?.anchor ?? null}
        stationName={hoveredHub?.name ?? ''}
        lineDirections={hoveredHub?.lineDirections ?? []}
      />
    </>
  )
}
