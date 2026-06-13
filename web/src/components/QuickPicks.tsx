import { Clock, History } from 'lucide-react'
import type { RecentSearch } from '../hooks/useRecentSearches'
import type { StationOption } from '../lib/routing/types'

interface QuickPicksProps {
  recent: RecentSearch[]
  stations: StationOption[]
  onPick: (from: StationOption, to: StationOption) => void
}

const POPULAR_PAIRS = [
  ['Hamburg', 'Milan Abzweig'],
  ['Friedrichshafen', 'Berlin'],
  ['Munich', 'Leipzig'],
] as const

export function QuickPicks({ recent, stations, onPick }: QuickPicksProps) {
  const stationByName = new Map(stations.map((s) => [s.name, s]))

  const popular = POPULAR_PAIRS
    .map(([from, to]) => {
      const fromStation = stationByName.get(from)
      const toStation = stationByName.get(to)
      if (!fromStation || !toStation) return null
      return { from: fromStation, to: toStation, label: `${from} → ${to}` }
    })
    .filter(Boolean) as Array<{ from: StationOption; to: StationOption; label: string }>

  if (recent.length === 0 && popular.length === 0) return null

  return (
    <section className="quick-picks">
      {recent.length > 0 && (
        <div className="quick-picks__group">
          <h4><History size={14} /> Zuletzt gesucht</h4>
          <div className="quick-picks__chips">
            {recent.map((r) => (
              <button
                key={`${r.fromId}-${r.toId}`}
                type="button"
                className="quick-picks__chip"
                onClick={() => {
                  const from = stations.find((s) => s.id === r.fromId)
                  const to = stations.find((s) => s.id === r.toId)
                  if (from && to) onPick(from, to)
                }}
              >
                {r.fromName} → {r.toName}
              </button>
            ))}
          </div>
        </div>
      )}

      {popular.length > 0 && (
        <div className="quick-picks__group">
          <h4><Clock size={14} /> Beliebte Verbindungen</h4>
          <div className="quick-picks__chips">
            {popular.map((p) => (
              <button
                key={p.label}
                type="button"
                className="quick-picks__chip quick-picks__chip--popular"
                onClick={() => onPick(p.from, p.to)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
