import type { NetworkExport } from '../../types/network'
import { buildStationHubLinesMap } from '../network/lineTerminus'
import {
  buildStationLineDirectionsIndex,
  dedupeLineDirections,
} from '../station/stationLineDirections'
import type { LineColorLookup, StationOption } from './types'
import { buildAdjacency, expandRoutingEdges } from './expandRoutingEdges'

export interface RoutingGraph {
  adjacency: Map<number, import('../../types/network').RoutingEdge[]>
  transferTimes: Map<number, number>
  lineColors: LineColorLookup
  stations: StationOption[]
  stationById: Map<number, StationOption>
}

const DEFAULT_TRANSFER_SECONDS = 240
const FALLBACK_LINE_COLOR = '#3B82F6'

export function buildRoutingGraph(network: NetworkExport): RoutingGraph {
  const routingEdges = expandRoutingEdges(network.routing_edges)
  const adjacency = buildAdjacency(routingEdges)

  const transferTimes = new Map<number, number>()
  for (const transfer of network.transfers) {
    transferTimes.set(
      transfer.station_group_id,
      transfer.transfer_time_seconds_experimental,
    )
  }

  const lineColors: LineColorLookup = {}
  for (const line of network.lines) {
    lineColors[line.id] = line.display_color
  }

  const hubLinesByStation = buildStationHubLinesMap(network)
  const lineDirectionsByStation = buildStationLineDirectionsIndex(network)

  const stations: StationOption[] = network.routing_nodes
    .map((node) => ({
      id: node.id,
      name: node.name,
      interchange: node.interchange,
      lineNames: node.served_by_line_names,
      lineColors: node.served_by_lines.map(
        (lineId) => lineColors[lineId]?.hex ?? FALLBACK_LINE_COLOR,
      ),
      hubLines: node.interchange ? hubLinesByStation.get(node.id) : undefined,
      lineDirections: dedupeLineDirections(lineDirectionsByStation.get(node.id) ?? []),
      position: node.position,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))

  const stationById = new Map(stations.map((s) => [s.id, s]))

  return { adjacency, transferTimes, lineColors, stations, stationById }
}

export function getTransferTime(
  graph: RoutingGraph,
  stationId: number,
): number {
  return graph.transferTimes.get(stationId) ?? DEFAULT_TRANSFER_SECONDS
}

export function getStationTransferTime(
  network: NetworkExport,
  stationId: number,
): number {
  const entry = network.transfers.find((t) => t.station_group_id === stationId)
  return entry?.transfer_time_seconds_experimental ?? DEFAULT_TRANSFER_SECONDS
}

export function getLineColor(graph: RoutingGraph, lineId: number): string {
  return graph.lineColors[lineId]?.hex ?? FALLBACK_LINE_COLOR
}
