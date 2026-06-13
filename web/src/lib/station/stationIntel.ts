import type { NetworkExport } from '../../types/network'
import { analyzeLine } from '../maps/lineTopology'
import { buildLineTerminusMap } from '../network/lineTerminus'
import type { LineShape } from '../maps/types'

const FALLBACK_COLOR = '#3B82F6'

export interface StationLinePresence {
  lineId: number
  lineName: string
  lineColor: string
  stopIndices: number[]
  stopCount: number
  terminusFrom: string
  terminusTo: string
  shape: LineShape
  isTurnaround: boolean
  role: string
}

export interface StationConnection {
  neighborId: number
  neighborName: string
  lineId: number
  lineName: string
  lineColor: string
  travelSeconds: number
  distanceKm: number
  direction: 'out' | 'in'
}

export interface StationIntel {
  id: number
  name: string
  position: [number, number, number]
  interchange: boolean
  degree: number
  hubRank: number | null
  lines: StationLinePresence[]
  connections: StationConnection[]
  uniqueDestinations: number
  transferTimeSeconds: number | null
}

export interface StationIntelIndex {
  byId: Map<number, StationIntel>
  topHubs: StationIntel[]
  all: StationIntel[]
}

function lineColor(network: NetworkExport, lineId: number): string {
  const line = network.lines.find((l) => l.id === lineId)
  return line?.display_color?.hex ?? FALLBACK_COLOR
}

function describeRole(
  stopIndex: number,
  stopCount: number,
  isTurnaround: boolean,
  shape: LineShape,
): string {
  if (isTurnaround && shape === 'partial_return') return 'Scheitelpunkt (Teilrückfahrt)'
  if (isTurnaround) return 'Wendepunkt'
  if (stopIndex === 0) return 'Linienstart'
  if (stopIndex === stopCount - 1) return 'Linienende'
  if (shape === 'ring' && stopIndex === Math.floor(stopCount / 2)) return 'Ringmitte'
  return `Halte ${stopIndex + 1} von ${stopCount}`
}

export function buildStationIntelIndex(network: NetworkExport): StationIntelIndex {
  const lineTermini = buildLineTerminusMap(network)
  const lineMeta = new Map(
    network.lines.map((line) => {
      const stopIds = (line.stops ?? []).map((s) => s.station_group_id)
      const analyzed = analyzeLine({
        lineId: line.id,
        lineName: line.name,
        color: line.display_color?.hex ?? FALLBACK_COLOR,
        stopIds,
        stopNames: (line.stops ?? []).map((s) => s.station_group_name ?? '?'),
      })
      return [
        line.id,
        {
          stopCount: line.stops?.length ?? 0,
          shape: analyzed.shape,
          turnaroundId: analyzed.turnaroundStationId,
        },
      ] as const
    }),
  )

  const transferByStation = new Map(
    network.transfers.map((t) => [t.station_group_id, t.transfer_time_seconds_experimental]),
  )

  const connectionsByStation = new Map<number, StationConnection[]>()

  for (const edge of network.routing_edges) {
    const color = lineColor(network, edge.line_id)

    const out: StationConnection = {
      neighborId: edge.to,
      neighborName: edge.to_name,
      lineId: edge.line_id,
      lineName: edge.line_name,
      lineColor: color,
      travelSeconds: edge.cost_seconds,
      distanceKm: edge.distance_km,
      direction: 'out',
    }
    const incoming: StationConnection = {
      neighborId: edge.from,
      neighborName: edge.from_name,
      lineId: edge.line_id,
      lineName: edge.line_name,
      lineColor: color,
      travelSeconds: edge.cost_seconds,
      distanceKm: edge.distance_km,
      direction: 'in',
    }

    const outList = connectionsByStation.get(edge.from) ?? []
    outList.push(out)
    connectionsByStation.set(edge.from, outList)

    const inList = connectionsByStation.get(edge.to) ?? []
    inList.push(incoming)
    connectionsByStation.set(edge.to, inList)
  }

  const indexEntries = network.station_line_index ?? []

  const all: StationIntel[] = network.routing_nodes.map((node) => {
    const lineIndex = indexEntries.find((e) => e.station_group_id === node.id)
    const lineEntries =
      lineIndex?.lines ??
      node.served_by_lines.map((lineId) => {
        const ln = network.lines.find((l) => l.id === lineId)
        return {
          line_id: lineId,
          line_name: ln?.name ?? `Linie ${lineId}`,
          stop_indices: [] as number[],
          display_color: ln?.display_color,
        }
      })

    const lines: StationLinePresence[] = lineEntries.map((entry) => {
      const term = lineTermini.get(entry.line_id)
      const meta = lineMeta.get(entry.line_id)
      const stopIndices = entry.stop_indices ?? []
      const isTurnaround = meta?.turnaroundId === node.id

      return {
        lineId: entry.line_id,
        lineName: entry.line_name,
        lineColor: entry.display_color?.hex ?? lineColor(network, entry.line_id),
        stopIndices,
        stopCount: meta?.stopCount ?? 0,
        terminusFrom: term?.terminusFrom ?? '?',
        terminusTo: term?.terminusTo ?? '?',
        shape: meta?.shape ?? 'linear',
        isTurnaround,
        role: describeRole(
          stopIndices[0] ?? 0,
          meta?.stopCount ?? 0,
          isTurnaround,
          meta?.shape ?? 'linear',
        ),
      }
    })

    const rawConnections = connectionsByStation.get(node.id) ?? []
    const neighborIds = new Set(rawConnections.map((c) => c.neighborId))

    return {
      id: node.id,
      name: node.name,
      position: node.position,
      interchange: node.interchange,
      degree: node.degree,
      hubRank: null,
      lines,
      connections: rawConnections.sort((a, b) => a.travelSeconds - b.travelSeconds),
      uniqueDestinations: neighborIds.size,
      transferTimeSeconds: transferByStation.get(node.id) ?? null,
    }
  })

  const hubs = all
    .filter((s) => s.interchange)
    .sort((a, b) => b.degree - a.degree || b.lines.length - a.lines.length)

  hubs.forEach((hub, i) => {
    const intel = all.find((s) => s.id === hub.id)
    if (intel) intel.hubRank = i + 1
  })

  return {
    byId: new Map(all.map((s) => [s.id, s])),
    topHubs: hubs.slice(0, 16),
    all: all.sort((a, b) => a.name.localeCompare(b.name, 'de')),
  }
}
