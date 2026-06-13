import type { NetworkExport } from '../../types/network'
import { analyzeLine } from '../maps/lineTopology'
import type { LineShape } from '../maps/types'

export interface LineStopDetail {
  stationId: number
  name: string
  index: number
  segmentKm: number | null
  segmentSeconds: number | null
  trackDisplay: string | null
  platformDisplay: string | null
  towardsName: string | null
}

export interface LineExplorerDetail {
  id: number
  name: string
  color: string
  shape: LineShape
  stopCount: number
  uniqueStations: number
  totalKm: number
  totalSeconds: number
  turnaroundName: string | null
  terminusFrom: string
  terminusTo: string
  passengers: number | null
  frequency: number | null
  rate: number | null
  stops: LineStopDetail[]
}

type ExportLine = NetworkExport['lines'][number] & {
  frequency?: number
  rate?: number
  unique_station_group_count?: number
  items_transported?: { PASSENGERS?: number; _sum?: number }
}

type ExportStop = NetworkExport['lines'][number]['stops'][number]

export function buildLineExplorerDetails(network: NetworkExport): LineExplorerDetail[] {
  const stationNames = new Map(network.routing_nodes.map((n) => [n.id, n.name]))

  return network.lines.map((raw) => {
    const line = raw as ExportLine
    const stops = line.stops ?? []
    const stopIds = stops.map((s) => s.station_group_id)
    const stopNames = stops.map((s) => s.station_group_name ?? stationNames.get(s.station_group_id) ?? '?')

    const analyzed = analyzeLine({
      lineId: line.id,
      lineName: line.name,
      color: line.display_color?.hex ?? '#3B82F6',
      stopIds,
      stopNames,
    })

    const fromId = analyzed.layoutStationIds[0]
    const toId = analyzed.layoutStationIds[analyzed.layoutStationIds.length - 1]

    const lineSegments = network.segments.filter((s) => s.line_id === line.id)
    const totalKm = lineSegments.reduce((sum, s) => sum + (s.distance_km_experimental ?? 0), 0)
    const totalSeconds = lineSegments.reduce((sum, s) => sum + s.travel_time_seconds, 0)

    const segmentByFrom = new Map(
      lineSegments.map((s) => [`${s.from_station_group_id}-${s.sequence_index}`, s]),
    )

    const stopDetails: LineStopDetail[] = stops.map((stop, index) => {
      const s = stop as ExportStop
      const seg = lineSegments.find(
        (s) => s.from_station_group_id === stop.station_group_id && s.sequence_index === index + 1,
      ) ?? segmentByFrom.get(`${stop.station_group_id}-${stop.index}`)

      return {
        stationId: stop.station_group_id,
        name: stop.station_group_name ?? stationNames.get(stop.station_group_id) ?? '?',
        index: stop.index,
        segmentKm: seg?.distance_km_experimental ?? null,
        segmentSeconds: seg?.travel_time_seconds ?? null,
        trackDisplay: s.track_display ?? s.platform_display ?? null,
        platformDisplay: s.platform_display ?? null,
        towardsName: s.towards_station_group_name ?? null,
      }
    })

    const passengers = line.items_transported?.PASSENGERS ?? line.items_transported?._sum ?? null

    return {
      id: line.id,
      name: line.name,
      color: line.display_color?.hex ?? '#3B82F6',
      shape: analyzed.shape,
      stopCount: stops.length,
      uniqueStations: line.unique_station_group_count ?? analyzed.layoutStationIds.length,
      totalKm,
      totalSeconds,
      turnaroundName: analyzed.turnaroundStationId
        ? stationNames.get(analyzed.turnaroundStationId) ?? null
        : null,
      terminusFrom: stationNames.get(fromId) ?? stopNames[0] ?? '?',
      terminusTo: stationNames.get(toId) ?? stopNames[stopNames.length - 1] ?? '?',
      passengers: typeof passengers === 'number' ? passengers : null,
      frequency: line.frequency ?? null,
      rate: line.rate ?? null,
      stops: stopDetails,
    }
  })
}
