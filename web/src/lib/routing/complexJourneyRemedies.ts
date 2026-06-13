import type { NetworkExport, RoutingEdge } from '../../types/network'
import { buildRoutingGraph } from './buildGraph'
import { searchRouteOnGraph } from './pathfinder'
import { dedupeUndirectedComplexJourneys, undirectedPairKey } from './complexJourneyGroups'
import type { ComplexJourneyEntry } from './complexJourneys'

export interface ProposedLineSegment {
  fromId: number
  toId: number
  fromName: string
  toName: string
  estimatedKm: number
  estimatedSeconds: number
  /** heute schon befahrbar */
  status: 'exists' | 'missing' | 'transfer'
  existingLineName?: string
  /** Umstieg nach dieser Teilstrecke */
  transferAfter?: boolean
}

export interface ComplexJourneyLineProposal {
  id: string
  fromId: number
  toId: number
  fromName: string
  toName: string
  stationIds: number[]
  stationNames: string[]
  segments: ProposedLineSegment[]
  /** Teilstrecken, die für die Durchbindung neu gebaut werden müssen */
  missingSegments: ProposedLineSegment[]
  totalMissingKm: number
  totalMissingSeconds: number
  beforeTransfers: number
  afterTransfers: number
  transferDelta: number
  summary: string
  highlightStationIds: number[]
}

const PROPOSAL_LINE_ID = -99
const PROPOSAL_LINE_NAME = 'Durchbindung (Vorschlag)'

function buildEdgeLookup(network: NetworkExport): Map<string, RoutingEdge> {
  const map = new Map<string, RoutingEdge>()
  for (const edge of network.routing_edges) {
    if (!map.has(`${edge.from}-${edge.to}`)) {
      map.set(`${edge.from}-${edge.to}`, edge)
    }
  }
  return map
}

function estimateSegment(connectionKm: number): number {
  const secondsPerKm = 3600 / 80
  return Math.max(60, Math.round(connectionKm * secondsPerKm))
}

function buildRouteSegments(
  network: NetworkExport,
  entry: ComplexJourneyEntry,
  edgeLookup: Map<string, RoutingEdge>,
): ProposedLineSegment[] {
  const segments: ProposedLineSegment[] = []
  const ids = entry.route.stationIds
  const names = entry.route.stationNames
  const metersPerUnit = network.scale?.meters_per_game_unit ?? 1

  for (let i = 0; i < ids.length - 1; i++) {
    const fromId = ids[i]
    const toId = ids[i + 1]
    const edge = edgeLookup.get(`${fromId}-${toId}`)
    const fromNode = network.routing_nodes.find((n) => n.id === fromId)
    const toNode = network.routing_nodes.find((n) => n.id === toId)

    let estimatedKm = edge?.distance_km ?? 0
    if (!estimatedKm && fromNode && toNode) {
      const dx = fromNode.position[0] - toNode.position[0]
      const dy = fromNode.position[1] - toNode.position[1]
      estimatedKm = (Math.sqrt(dx * dx + dy * dy) * metersPerUnit) / 1000 * 1.35
    }

    segments.push({
      fromId,
      toId,
      fromName: names[i] ?? '?',
      toName: names[i + 1] ?? '?',
      estimatedKm,
      estimatedSeconds: edge?.cost_seconds ?? estimateSegment(estimatedKm),
      status: edge ? 'exists' : 'missing',
      existingLineName: edge?.line_name,
    })
  }

  for (let legIdx = 0; legIdx < entry.route.legs.length - 1; legIdx++) {
    const transferAt = entry.route.legs[legIdx].toStationId
    const seg = segments.find((s) => s.toId === transferAt)
    if (seg) seg.transferAfter = true
  }

  return segments
}

function augmentWithThroughLine(
  network: NetworkExport,
  segments: ProposedLineSegment[],
): NetworkExport {
  const extraEdges: RoutingEdge[] = []

  for (const seg of segments) {
    extraEdges.push({
      id: `proposal-${seg.fromId}-${seg.toId}`,
      from: seg.fromId,
      to: seg.toId,
      from_name: seg.fromName,
      to_name: seg.toName,
      line_id: PROPOSAL_LINE_ID,
      line_name: PROPOSAL_LINE_NAME,
      sequence_index: 0,
      cost_seconds: seg.estimatedSeconds,
      cost_distance: seg.estimatedKm * 1000,
      distance_km: seg.estimatedKm,
    })
    extraEdges.push({
      id: `proposal-${seg.toId}-${seg.fromId}`,
      from: seg.toId,
      to: seg.fromId,
      from_name: seg.toName,
      to_name: seg.fromName,
      line_id: PROPOSAL_LINE_ID,
      line_name: PROPOSAL_LINE_NAME,
      sequence_index: 0,
      cost_seconds: seg.estimatedSeconds,
      cost_distance: seg.estimatedKm * 1000,
      distance_km: seg.estimatedKm,
    })
  }

  return {
    ...network,
    routing_edges: [...network.routing_edges, ...extraEdges],
  }
}

function simulateThroughLine(
  network: NetworkExport,
  entry: ComplexJourneyEntry,
  segments: ProposedLineSegment[],
): number {
  const augmented = augmentWithThroughLine(network, segments)
  const graph = buildRoutingGraph(augmented)
  const route = searchRouteOnGraph(graph, entry.fromId, entry.toId, 'fastest')
  return route?.transferCount ?? entry.route.transferCount
}

function buildLineProposal(
  network: NetworkExport,
  entry: ComplexJourneyEntry,
  edgeLookup: Map<string, RoutingEdge>,
): ComplexJourneyLineProposal | null {
  if (entry.route.transferCount < 1) return null

  const segments = buildRouteSegments(network, entry, edgeLookup)
  const transferCount = segments.filter((s) => s.transferAfter).length

  const uniqueForBuild = transferCount > 0 ? segments : segments.filter((s) => s.status === 'missing')

  const totalMissingKm = uniqueForBuild.reduce((sum, s) => sum + s.estimatedKm, 0)
  const totalMissingSeconds = uniqueForBuild.reduce((sum, s) => sum + s.estimatedSeconds, 0)
  const afterTransfers = simulateThroughLine(network, entry, segments)
  const transferDelta = entry.route.transferCount - afterTransfers

  const summary =
    transferCount > 0
      ? `Neue Durchbindungslinie über ${entry.route.stationNames.length} Halte (${segments.length} Teilstrecken) — heute ${entry.route.transferCount} Umstiege`
      : `${segments.filter((s) => s.status === 'missing').length} fehlende Teilstrecken entlang der Route`

  return {
    id: undirectedPairKey(entry.fromId, entry.toId),
    fromId: entry.fromId,
    toId: entry.toId,
    fromName: entry.fromName,
    toName: entry.toName,
    stationIds: entry.route.stationIds,
    stationNames: entry.route.stationNames,
    segments,
    missingSegments: uniqueForBuild,
    totalMissingKm,
    totalMissingSeconds,
    beforeTransfers: entry.route.transferCount,
    afterTransfers,
    transferDelta,
    summary,
    highlightStationIds: [...new Set(entry.route.stationIds)],
  }
}

export function buildComplexJourneyLineProposals(
  network: NetworkExport,
  entries: ComplexJourneyEntry[],
  maxProposals = 12,
): ComplexJourneyLineProposal[] {
  const focusEntries = dedupeUndirectedComplexJourneys(
    entries.filter((e) => e.route.transferCount >= 1),
  ).slice(0, 20)

  if (focusEntries.length === 0) return []

  const edgeLookup = buildEdgeLookup(network)

  return focusEntries
    .map((entry) => buildLineProposal(network, entry, edgeLookup))
    .filter((p): p is ComplexJourneyLineProposal => p != null)
    .sort(
      (a, b) =>
        b.transferDelta - a.transferDelta ||
        b.beforeTransfers - a.beforeTransfers ||
        b.stationNames.length - a.stationNames.length,
    )
    .slice(0, maxProposals)
}

export function segmentKey(a: number, b: number): string {
  return undirectedPairKey(a, b)
}
