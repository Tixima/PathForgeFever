import type { NetworkExport, RoutingEdge, RoutingNode } from '../../types/network'

const ROAD_FACTOR = 1.35
const LINE_SPEED_KMH = 80
const MIN_SEGMENT_SECONDS = 60
/** Max. Abstand zur Luftlinie (Anteil der Gesamtstrecke) für Zwischenhalte */
const CORRIDOR_PERP_RATIO = 0.22
const MIN_CORRIDOR_PROGRESS = 0.06
const MAX_CORRIDOR_PROGRESS = 0.94

export interface NewLinePath {
  stationIds: number[]
  stationNames: string[]
}

function nodeById(network: NetworkExport): Map<number, RoutingNode> {
  return new Map(network.routing_nodes.map((n) => [n.id, n]))
}

export function geoDistanceKm(
  network: NetworkExport,
  from: RoutingNode,
  to: RoutingNode,
): number {
  const metersPerUnit = network.scale?.meters_per_game_unit ?? 1
  const dx = from.position[0] - to.position[0]
  const dy = from.position[1] - to.position[1]
  return (Math.sqrt(dx * dx + dy * dy) * metersPerUnit) / 1000 * ROAD_FACTOR
}

export function estimateLineSegmentSeconds(distanceKm: number): number {
  const secondsPerKm = 3600 / LINE_SPEED_KMH
  return Math.max(MIN_SEGMENT_SECONDS, Math.round(distanceKm * secondsPerKm))
}

function corridorProgress(
  network: NetworkExport,
  from: RoutingNode,
  to: RoutingNode,
  candidate: RoutingNode,
): { along: number; perpKm: number } {
  const ax = to.position[0] - from.position[0]
  const ay = to.position[1] - from.position[1]
  const lenSq = ax * ax + ay * ay
  if (lenSq < 1e-6) return { along: 0.5, perpKm: 0 }

  const t =
    ((candidate.position[0] - from.position[0]) * ax +
      (candidate.position[1] - from.position[1]) * ay) /
    lenSq

  const projX = from.position[0] + t * ax
  const projY = from.position[1] + t * ay
  const perpUnits = Math.hypot(candidate.position[0] - projX, candidate.position[1] - projY)
  const metersPerUnit = network.scale?.meters_per_game_unit ?? 1
  const perpKm = (perpUnits * metersPerUnit) / 1000 * ROAD_FACTOR

  return { along: t, perpKm }
}

function scoreCorridorCandidate(
  network: NetworkExport,
  from: RoutingNode,
  to: RoutingNode,
  candidate: RoutingNode,
  totalCorridorKm: number,
): number | null {
  const { along, perpKm } = corridorProgress(network, from, to, candidate)
  if (along < MIN_CORRIDOR_PROGRESS || along > MAX_CORRIDOR_PROGRESS) return null

  const maxPerpKm = Math.max(3, totalCorridorKm * CORRIDOR_PERP_RATIO)
  if (perpKm > maxPerpKm) return null

  const hubBonus = candidate.interchange ? 4 : candidate.degree >= 3 ? 2 : 0
  return hubBonus * 100 - perpKm * 10 + totalCorridorKm * along * 0.01
}

export function buildNewLineCorridorPath(
  network: NetworkExport,
  fromId: number,
  toId: number,
  maxWaypoints = 3,
): NewLinePath | null {
  const nodes = nodeById(network)
  const from = nodes.get(fromId)
  const to = nodes.get(toId)
  if (!from || !to || fromId === toId) return null

  const corridorKm = geoDistanceKm(network, from, to)
  if (corridorKm < 2) return null

  const waypointScores: Array<{ id: number; along: number; score: number }> = []

  for (const candidate of network.routing_nodes) {
    if (candidate.id === fromId || candidate.id === toId) continue
    const score = scoreCorridorCandidate(network, from, to, candidate, corridorKm)
    if (score == null) continue
    const { along } = corridorProgress(network, from, to, candidate)
    waypointScores.push({ id: candidate.id, along, score })
  }

  waypointScores.sort((a, b) => b.score - a.score || a.along - b.along)

  const picked: number[] = []
  for (const wp of waypointScores) {
    if (picked.length >= maxWaypoints) break
    const wpNode = nodes.get(wp.id)!
    const tooClose = picked.some((id) => {
      const other = nodes.get(id)!
      return geoDistanceKm(network, wpNode, other) < corridorKm * 0.12
    })
    if (tooClose) continue
    picked.push(wp.id)
  }

  const orderedIds = [
    fromId,
    ...picked.sort((a, b) => {
      const na = nodes.get(a)!
      const nb = nodes.get(b)!
      return (
        corridorProgress(network, from, to, na).along -
        corridorProgress(network, from, to, nb).along
      )
    }),
    toId,
  ]

  const stationIds = dedupeConsecutive(orderedIds)
  const stationNames = stationIds.map((id) => nodes.get(id)?.name ?? '?')

  if (stationIds.length < 2) return null
  return { stationIds, stationNames }
}

function dedupeConsecutive(ids: number[]): number[] {
  const out: number[] = []
  for (const id of ids) {
    if (out[out.length - 1] !== id) out.push(id)
  }
  return out
}

export function pathSignature(stationIds: number[]): string {
  return stationIds.join('>')
}

export function isSameStationPath(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  return a.every((id, i) => id === b[i])
}

export function edgeExists(
  edgeLookup: Map<string, RoutingEdge>,
  fromId: number,
  toId: number,
): boolean {
  return edgeLookup.has(`${fromId}-${toId}`)
}

/** True, wenn die komplette Folge schon im Netz als Teilstrecken-Kette existiert. */
export function isExistingTrackChain(
  stationIds: number[],
  edgeLookup: Map<string, RoutingEdge>,
): boolean {
  if (stationIds.length < 2) return false
  return stationIds
    .slice(0, -1)
    .every((fromId, i) => edgeExists(edgeLookup, fromId, stationIds[i + 1]))
}

export function travelSecondsBetween(
  stationIds: number[],
  segmentSeconds: number[],
  fromId: number,
  toId: number,
): number | null {
  const fromIdx = stationIds.indexOf(fromId)
  const toIdx = stationIds.indexOf(toId)
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return null

  const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
  let total = 0
  for (let i = start; i < end; i++) {
    total += segmentSeconds[i] ?? 0
  }
  return total
}
