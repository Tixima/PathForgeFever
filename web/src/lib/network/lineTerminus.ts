import type { NetworkExport } from '../../types/network'
import { analyzeLine } from '../maps/lineTopology'

const FALLBACK_COLOR = '#3B82F6'

export interface LineTerminus {
  lineId: number
  lineName: string
  lineColor: string
  terminusFrom: string
  terminusTo: string
}

export function buildLineTerminusMap(network: NetworkExport): Map<number, LineTerminus> {
  const stationNames = new Map(network.routing_nodes.map((n) => [n.id, n.name]))
  const result = new Map<number, LineTerminus>()

  for (const line of network.lines) {
    const stopIds: number[] = []
    const stopNames: string[] = []
    for (const stop of line.stops ?? []) {
      stopIds.push(stop.station_group_id)
      stopNames.push(stop.station_group_name ?? stationNames.get(stop.station_group_id) ?? '?')
    }

    const analyzed = analyzeLine({
      lineId: line.id,
      lineName: line.name,
      color: line.display_color?.hex ?? FALLBACK_COLOR,
      stopIds,
      stopNames,
    })

    const fromId = analyzed.layoutStationIds[0]
    const toId = analyzed.layoutStationIds[analyzed.layoutStationIds.length - 1]

    result.set(line.id, {
      lineId: line.id,
      lineName: line.name,
      lineColor: line.display_color?.hex ?? FALLBACK_COLOR,
      terminusFrom: stationNames.get(fromId) ?? stopNames[0] ?? '?',
      terminusTo: stationNames.get(toId) ?? stopNames[stopNames.length - 1] ?? '?',
    })
  }

  return result
}

export function buildStationHubLinesMap(
  network: NetworkExport,
): Map<number, LineTerminus[]> {
  const lineTermini = buildLineTerminusMap(network)
  const hubLines = new Map<number, LineTerminus[]>()

  for (const node of network.routing_nodes) {
    if (!node.interchange) continue

    const lines = node.served_by_lines
      .map((lineId) => lineTermini.get(lineId))
      .filter((entry): entry is LineTerminus => Boolean(entry))
      .sort((a, b) => a.lineName.localeCompare(b.lineName, 'de'))

    hubLines.set(node.id, lines)
  }

  return hubLines
}
