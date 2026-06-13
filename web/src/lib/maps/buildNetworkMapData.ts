import type { NetworkExport } from '../../types/network'
import type { MapEdge, MapLine, MapStation, NetworkMapData } from './types'
import { analyzeLine } from './lineTopology'

const FALLBACK_COLOR = '#3B82F6'

export function buildNetworkMapData(network: NetworkExport): NetworkMapData {
  const lineColors = new Map<number, string>()
  const lines: MapLine[] = []

  for (const line of network.lines) {
    const color = line.display_color?.hex ?? FALLBACK_COLOR
    lineColors.set(line.id, color)

    const stopIds: number[] = []
    const stopNames: string[] = []
    for (const stop of line.stops ?? []) {
      stopIds.push(stop.station_group_id)
      stopNames.push(stop.station_group_name ?? '?')
    }

    const analyzed = analyzeLine({
      lineId: line.id,
      lineName: line.name,
      color,
      stopIds,
      stopNames,
    })

    lines.push({
      id: analyzed.id,
      name: analyzed.name,
      color: analyzed.color,
      shape: analyzed.shape,
      fullStationIds: analyzed.fullStationIds,
      layoutStationIds: analyzed.layoutStationIds,
      segments: analyzed.segments,
      stopCount: analyzed.stopCount,
      turnaroundStationId: analyzed.turnaroundStationId,
      startStationId: analyzed.startStationId,
      endStationId: analyzed.endStationId,
    })
  }

  const stations: MapStation[] = network.routing_nodes.map((node) => ({
    id: node.id,
    name: node.name,
    geoX: node.position[0],
    geoY: node.position[1],
    interchange: node.interchange,
    degree: node.degree,
    lineIds: node.served_by_lines,
    lineNames: node.served_by_line_names,
    lineColors: node.served_by_lines.map((id) => lineColors.get(id) ?? FALLBACK_COLOR),
  }))

  const stationById = new Map(stations.map((s) => [s.id, s]))

  const edges: MapEdge[] = network.routing_edges.map((edge) => ({
    id: edge.id,
    lineId: edge.line_id,
    lineName: edge.line_name,
    lineColor: lineColors.get(edge.line_id) ?? FALLBACK_COLOR,
    fromId: edge.from,
    toId: edge.to,
    fromName: edge.from_name,
    toName: edge.to_name,
  }))

  return { stations, lines, edges, stationById }
}
