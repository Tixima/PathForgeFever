import type { LineExplorerDetail } from './lineExplorer'
import { shapeLabel } from '../maps/lineTopology'

export interface LineCompareMetric {
  id: string
  label: string
  a: string
  b: string
  winner: 'a' | 'b' | 'tie' | null
}

export interface LineSpeedSegment {
  from: string
  to: string
  kmh: number
}

type ExportSegment = {
  line_id: number
  from_station_group_name: string
  to_station_group_name: string
  travel_time_seconds: number
  distance_km_experimental?: number
  inferred_speed_kmh_experimental?: number
}

export function buildLineSpeedProfile(
  segments: ExportSegment[],
  lineId: number,
): LineSpeedSegment[] {
  return segments
    .filter((s) => s.line_id === lineId)
    .map((s) => {
      const km = s.distance_km_experimental ?? 0
      const hours = s.travel_time_seconds / 3600
      const kmh =
        s.inferred_speed_kmh_experimental ??
        (hours > 0 && km > 0 ? km / hours : 0)
      return {
        from: s.from_station_group_name,
        to: s.to_station_group_name,
        kmh: Math.round(kmh),
      }
    })
    .filter((s) => s.kmh > 0)
}

export function compareLines(a: LineExplorerDetail, b: LineExplorerDetail): LineCompareMetric[] {
  const metrics: LineCompareMetric[] = []

  const addNum = (
    id: string,
    label: string,
    va: number | null,
    vb: number | null,
    fmt: (n: number) => string,
    lowerBetter = false,
  ) => {
    if (va === null && vb === null) return
    const sa = va !== null ? fmt(va) : '—'
    const sb = vb !== null ? fmt(vb) : '—'
    let winner: 'a' | 'b' | 'tie' | null = null
    if (va !== null && vb !== null) {
      if (va === vb) winner = 'tie'
      else if (lowerBetter) winner = va < vb ? 'a' : 'b'
      else winner = va > vb ? 'a' : 'b'
    }
    metrics.push({ id, label, a: sa, b: sb, winner })
  }

  addNum('stops', 'Haltestellen', a.stopCount, b.stopCount, (n) => `${n}`, true)
  addNum('unique', 'Unique Stationen', a.uniqueStations, b.uniqueStations, (n) => `${n}`, true)
  addNum('km', 'Strecke', a.totalKm, b.totalKm, (n) => `${n.toFixed(1)} km`)
  addNum('time', 'Fahrzeit', a.totalSeconds, b.totalSeconds, (n) => `${Math.round(n / 60)} min`, true)
  addNum('pax', 'Passagiere', a.passengers, b.passengers, (n) => n.toLocaleString('de-DE'))
  addNum('rate', 'Rate', a.rate, b.rate, (n) => n.toLocaleString('de-DE'))
  addNum('freq', 'Frequenz', a.frequency, b.frequency, (n) => `${n}/Jahr`)

  metrics.push({
    id: 'shape',
    label: 'Linienform',
    a: shapeLabel(a.shape),
    b: shapeLabel(b.shape),
    winner: null,
  })

  metrics.push({
    id: 'route',
    label: 'Strecke',
    a: `${a.terminusFrom} → ${a.terminusTo}`,
    b: `${b.terminusFrom} → ${b.terminusTo}`,
    winner: null,
  })

  return metrics
}
