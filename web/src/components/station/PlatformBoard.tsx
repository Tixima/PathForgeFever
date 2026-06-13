import { useMemo, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { Train } from 'lucide-react'
import type { NetworkExport } from '../../types/network'
import { getStationPlatformBoard } from '../../lib/platform/platformIntel'

interface PlatformBoardProps {
  network: NetworkExport
  stationGroupId: number
  stationName: string
}

export function PlatformBoard({ network, stationGroupId, stationName }: PlatformBoardProps) {
  const platforms = useMemo(
    () => getStationPlatformBoard(network, stationGroupId),
    [network, stationGroupId],
  )

  if (platforms.length === 0) return null

  const nativeCount = platforms.filter((p) => p.isNative).length

  return (
    <section className="platform-board">
      <header className="platform-board__header">
        <Train size={16} />
        <h4>Gleise & Bahnsteige — {stationName}</h4>
        {nativeCount > 0 && (
          <span className="platform-board__badge">
            {nativeCount}/{platforms.length} native TF2-Daten
          </span>
        )}
      </header>

      <div className="platform-board__grid">
        {platforms.map((row, i) => (
          <motion.article
            key={`${row.lineId}-${row.trackDisplay}`}
            className={`platform-board__card ${row.isNative ? 'platform-board__card--native' : ''}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            style={{ '--line-color': row.lineColor } as CSSProperties}
          >
            <span className="platform-board__line">
              <span className="line-dot" style={{ backgroundColor: row.lineColor }} />
              {row.lineName}
            </span>
            <strong className="platform-board__gleis">
              {row.trackDisplay ?? row.platformDisplay ?? '—'}
            </strong>
            {row.towardsName && (
              <span className="platform-board__towards">Richtung {row.towardsName}</span>
            )}
            {row.terminalNumber != null && (
              <span className="platform-board__terminal">Terminal {row.terminalNumber}</span>
            )}
          </motion.article>
        ))}
      </div>
    </section>
  )
}
