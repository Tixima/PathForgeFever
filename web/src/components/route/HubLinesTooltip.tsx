import type { CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Shuffle } from 'lucide-react'
import type { LineDirectionAtStop } from '../../lib/station/stationLineDirections'

interface HubLinesTooltipProps {
  stationName: string
  lineDirections: LineDirectionAtStop[]
  className?: string
}

export function HubLinesTooltip({ stationName, lineDirections, className = '' }: HubLinesTooltipProps) {
  if (lineDirections.length === 0) return null

  return (
    <motion.div
      className={`hub-tooltip ${className}`.trim()}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14 }}
      role="tooltip"
    >
      <div className="hub-tooltip__header">
        <Shuffle size={14} />
        <div>
          <strong>{stationName}</strong>
          <span>Umsteigebahnhof · {lineDirections.length} Linien</span>
        </div>
      </div>

      <ul className="hub-tooltip__list">
        {lineDirections.map((line) => (
          <li
            key={`${line.lineId}:${line.stopIndex}:${line.prevStop ?? ''}:${line.nextStop ?? ''}`}
            className="hub-tooltip__line"
          >
            <span className="hub-tooltip__dot" style={{ backgroundColor: line.lineColor }} />
            <div className="hub-tooltip__line-head">
              <span className="hub-tooltip__line-name">{line.lineName}</span>
              <span
                className="hub-tooltip__line-short"
                style={{ '--line-color': line.lineColor } as CSSProperties}
              >
                {line.lineShort}
              </span>
            </div>
            <div className="hub-tooltip__directions">
              <span className="hub-tooltip__dir hub-tooltip__dir--prev">
                <ArrowLeft size={11} aria-hidden />
                {line.prevStop ? (
                  <>
                    <span className="hub-tooltip__initial">{line.prevInitial}</span>
                    {line.prevStop}
                  </>
                ) : (
                  <span className="hub-tooltip__end">{line.terminusFrom}</span>
                )}
              </span>
              <span className="hub-tooltip__dir hub-tooltip__dir--next">
                {line.nextStop ? (
                  <>
                    <span className="hub-tooltip__initial">{line.nextInitial}</span>
                    {line.nextStop}
                  </>
                ) : (
                  <span className="hub-tooltip__end">{line.terminusTo}</span>
                )}
                <ArrowRight size={11} aria-hidden />
              </span>
            </div>
            <span className="hub-tooltip__termini">
              {line.terminusFrom} ↔ {line.terminusTo}
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}
