import type { NetworkExport } from '../../types/network'
import { analyzeLine } from '../maps/lineTopology'

export interface LinePerformance {
  lineId: number
  lineName: string
  lineColor: string
  stopCount: number
  uniqueStations: number
  shape: string
  totalKm: number
  passengers: number | null
  frequency: number | null
  rate: number | null
}

export interface NetworkRecord {
  id: string
  label: string
  value: string
  detail: string
  accent?: string
}

export interface NetworkAnalytics {
  totalKm: number
  totalKmScaled: (mult: number) => number
  avgSegmentKm: number
  longestSegment: { from: string; to: string; lineName: string; km: number; color: string }
  busiestHub: { name: string; degree: number; lineCount: number } | null
  longestLine: { name: string; stops: number; color: string }
  linePerformance: LinePerformance[]
  records: NetworkRecord[]
  qualityHighlights: Array<{ code: string; message: string; level: string }>
  mapSpanKm: number | null
  interchangeCount: number
  experimentalNote: string | null
}

type ExportLine = NetworkExport['lines'][number] & {
  frequency?: number
  rate?: number
  unique_station_group_count?: number
  items_transported?: { PASSENGERS?: number; _sum?: number }
  inferred_speed_kmh_experimental?: number
}

export function buildNetworkAnalytics(network: NetworkExport): NetworkAnalytics {
  let totalKm = 0
  let longestSeg = {
    from: '',
    to: '',
    lineName: '',
    km: 0,
    color: '#3B82F6',
  }

  for (const seg of network.segments) {
    const km = seg.distance_km_experimental ?? seg.estimated_route_distance_km_experimental ?? 0
    totalKm += km
    if (km > longestSeg.km) {
      const line = network.lines.find((l) => l.id === seg.line_id)
      longestSeg = {
        from: seg.from_station_group_name,
        to: seg.to_station_group_name,
        lineName: seg.line_name,
        km,
        color: line?.display_color?.hex ?? '#3B82F6',
      }
    }
  }

  const hubs = [...network.routing_nodes]
    .filter((n) => n.interchange)
    .sort((a, b) => b.degree - a.degree)

  const busiest = hubs[0]
    ? {
        name: hubs[0].name,
        degree: hubs[0].degree,
        lineCount: hubs[0].served_by_lines.length,
      }
    : null

  const linePerformance: LinePerformance[] = network.lines.map((raw) => {
    const line = raw as ExportLine
    const stopIds = (line.stops ?? []).map((s) => s.station_group_id)
    const analyzed = analyzeLine({
      lineId: line.id,
      lineName: line.name,
      color: line.display_color?.hex ?? '#3B82F6',
      stopIds,
      stopNames: (line.stops ?? []).map((s) => s.station_group_name ?? '?'),
    })

    const lineKm = network.segments
      .filter((s) => s.line_id === line.id)
      .reduce((sum, s) => sum + (s.distance_km_experimental ?? 0), 0)

    const passengers =
      line.items_transported?.PASSENGERS ?? line.items_transported?._sum ?? null

    return {
      lineId: line.id,
      lineName: line.name,
      lineColor: line.display_color?.hex ?? '#3B82F6',
      stopCount: line.stops?.length ?? 0,
      uniqueStations: line.unique_station_group_count ?? analyzed.layoutStationIds.length,
      shape: analyzed.shape,
      totalKm: lineKm,
      passengers: typeof passengers === 'number' ? passengers : null,
      frequency: line.frequency ?? null,
      rate: line.rate ?? null,
    }
  })

  const longestLine = [...linePerformance].sort((a, b) => b.stopCount - a.stopCount)[0]

  const mapBox = (network as NetworkExport & { network_map?: { bounding_box?: Record<string, number> } })
    .network_map?.bounding_box
  const mapSpanKm = mapBox
    ? Math.hypot(
        (mapBox.max_x ?? 0) - (mapBox.min_x ?? 0),
        (mapBox.max_y ?? 0) - (mapBox.min_y ?? 0),
      ) / 1000
    : null

  const experimental = (network as NetworkExport & { experimental?: { warning?: string } }).experimental

  const records: NetworkRecord[] = [
    {
      id: 'longest-hop',
      label: 'Längste Teilstrecke',
      value: `${longestSeg.km.toFixed(1)} km`,
      detail: `${longestSeg.from} → ${longestSeg.to} (${longestSeg.lineName})`,
      accent: longestSeg.color,
    },
    {
      id: 'busiest-hub',
      label: 'Mega-Umsteiger',
      value: busiest?.name ?? '—',
      detail: busiest
        ? `${busiest.degree} Verbindungen · ${busiest.lineCount} Linien`
        : 'Kein Umsteiger',
    },
    {
      id: 'longest-line',
      label: 'Längste Linie',
      value: longestLine?.lineName ?? '—',
      detail: longestLine ? `${longestLine.stopCount} Halte · ${longestLine.totalKm.toFixed(0)} km` : '',
      accent: longestLine?.lineColor,
    },
    {
      id: 'network-size',
      label: 'Gesamtstrecke',
      value: `${totalKm.toFixed(0)} km`,
      detail: `${network.segments.length} Segmente im Netz`,
    },
  ]

  if (mapSpanKm) {
    records.push({
      id: 'map-span',
      label: 'Karten-Spannweite',
      value: `${mapSpanKm.toFixed(0)} km`,
      detail: 'Aus Spielkoordinaten berechnet',
    })
  }

  const topPassengers = [...linePerformance]
    .filter((l) => l.passengers !== null && l.passengers > 0)
    .sort((a, b) => (b.passengers ?? 0) - (a.passengers ?? 0))[0]

  if (topPassengers) {
    records.push({
      id: 'top-passengers',
      label: 'Beliebteste Linie',
      value: topPassengers.lineName,
      detail: `${topPassengers.passengers?.toLocaleString('de-DE')} Passagiere (Spielstatistik)`,
      accent: topPassengers.lineColor,
    })
  }

  return {
    totalKm,
    totalKmScaled: (mult) => totalKm * mult,
    avgSegmentKm: network.segments.length ? totalKm / network.segments.length : 0,
    longestSegment: longestSeg,
    busiestHub: busiest,
    longestLine: longestLine
      ? { name: longestLine.lineName, stops: longestLine.stopCount, color: longestLine.lineColor }
      : { name: '—', stops: 0, color: '#3B82F6' },
    linePerformance: linePerformance.sort((a, b) => a.lineName.localeCompare(b.lineName, 'de')),
    records,
    qualityHighlights: (network.quality_report ?? []).slice(0, 6),
    mapSpanKm,
    interchangeCount:
      (network as NetworkExport & { network_map?: { interchange_count?: number } }).network_map
        ?.interchange_count ?? network.transfers.length,
    experimentalNote: experimental?.warning ?? null,
  }
}
