import type { NetworkExport, RoutingEdge } from '../../types/network'
import { buildRoutingGraph } from './buildGraph'
import { searchRouteOnGraph } from './pathfinder'
import { dedupeUndirectedComplexJourneys, undirectedPairKey } from './complexJourneyGroups'
import type { ComplexJourneyEntry } from './complexJourneys'
import type { RouteResult } from './types'
import {
  buildNewLineCorridorPath,
  edgeExists,
  estimateLineSegmentSeconds,
  geoDistanceKm,
  isExistingTrackChain,
  isSameStationPath,
  pathSignature,
  travelSecondsBetween,
  type NewLinePath,
} from './newLineCorridor'

export interface ProposedLineSegment {
  fromId: number
  toId: number
  fromName: string
  toName: string
  estimatedKm: number
  estimatedSeconds: number
  status: 'missing'
}

export interface ReferenceRouteSegment {
  fromId: number
  toId: number
  fromName: string
  toName: string
  lineName: string
  lineColor: string
  durationSeconds: number
  distanceMeters: number
  transferAfter: boolean
}

export interface ComplexJourneyLineProposal {
  id: string
  fromId: number
  toId: number
  fromName: string
  toName: string
  /** Halte der neuen Linie (Korridor) */
  stationIds: number[]
  stationNames: string[]
  segments: ProposedLineSegment[]
  missingSegments: ProposedLineSegment[]
  totalMissingKm: number
  totalMissingSeconds: number
  beforeTransfers: number
  afterTransfers: number
  transferDelta: number
  beforeSeconds: number
  afterSeconds: number
  beforeDistanceMeters: number
  afterDistanceMeters: number
  timeSavedSeconds: number
  beneficiaryCount: number
  totalNetworkSecondsSaved: number
  summary: string
  highlightStationIds: number[]
  /** Heutige schnellste Route — nur zum Vergleich in der Karte */
  referenceStationIds: number[]
  referenceStationNames: string[]
  referenceSegments: ReferenceRouteSegment[]
  referenceTransferStationIds: number[]
}

const PROPOSAL_LINE_ID = -99
const PROPOSAL_LINE_NAME = 'Neue Linie (Vorschlag)'
const MIN_TIME_SAVED_SECONDS = 180
const MIN_NEW_TRACK_RATIO = 0.35

function buildEdgeLookup(network: NetworkExport): Map<string, RoutingEdge> {
  const map = new Map<string, RoutingEdge>()
  for (const edge of network.routing_edges) {
    if (!map.has(`${edge.from}-${edge.to}`)) {
      map.set(`${edge.from}-${edge.to}`, edge)
    }
  }
  return map
}

function buildSegmentsFromPath(
  network: NetworkExport,
  path: NewLinePath,
): ProposedLineSegment[] {
  const nodes = new Map(network.routing_nodes.map((n) => [n.id, n]))
  const segments: ProposedLineSegment[] = []

  for (let i = 0; i < path.stationIds.length - 1; i++) {
    const fromId = path.stationIds[i]
    const toId = path.stationIds[i + 1]
    const from = nodes.get(fromId)
    const to = nodes.get(toId)
    if (!from || !to) continue

    const estimatedKm = geoDistanceKm(network, from, to)
    segments.push({
      fromId,
      toId,
      fromName: path.stationNames[i] ?? from.name,
      toName: path.stationNames[i + 1] ?? to.name,
      estimatedKm,
      estimatedSeconds: estimateLineSegmentSeconds(estimatedKm),
      status: 'missing',
    })
  }

  return segments
}

function newTrackRatio(
  segments: ProposedLineSegment[],
  edgeLookup: Map<string, RoutingEdge>,
): number {
  if (segments.length === 0) return 0
  const missing = segments.filter((s) => !edgeExists(edgeLookup, s.fromId, s.toId)).length
  return missing / segments.length
}

function augmentWithProposalLine(
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

function simulateNewLine(
  network: NetworkExport,
  entry: ComplexJourneyEntry,
  segments: ProposedLineSegment[],
): { transferCount: number; durationSeconds: number } {
  const augmented = augmentWithProposalLine(network, segments)
  const graph = buildRoutingGraph(augmented)
  const route = searchRouteOnGraph(graph, entry.fromId, entry.toId, 'fastest')
  if (!route) {
    const fallbackSeconds = segments.reduce((sum, s) => sum + s.estimatedSeconds, 0)
    return { transferCount: 0, durationSeconds: fallbackSeconds }
  }
  return {
    transferCount: route.transferCount,
    durationSeconds: route.totalDurationSeconds,
  }
}

function buildReferenceRouteSegments(
  route: RouteResult,
  edgeLookup: Map<string, RoutingEdge>,
): ReferenceRouteSegment[] {
  const segments: ReferenceRouteSegment[] = []
  let legIdx = 0

  for (let i = 0; i < route.stationIds.length - 1; i++) {
    const leg = route.legs[legIdx]
    if (!leg) break

    const fromId = route.stationIds[i]
    const toId = route.stationIds[i + 1]
    const edge = edgeLookup.get(`${fromId}-${toId}`)
    const hopCount = Math.max(leg.edgeCount, 1)

    segments.push({
      fromId,
      toId,
      fromName: route.stationNames[i] ?? leg.fromStationName,
      toName: route.stationNames[i + 1] ?? leg.toStationName,
      lineName: edge?.line_name ?? leg.lineName,
      lineColor: leg.lineColor,
      durationSeconds: edge?.cost_seconds ?? Math.round(leg.durationSeconds / hopCount),
      distanceMeters: edge ? edge.distance_km * 1000 : leg.distanceMeters / hopCount,
      transferAfter: toId === leg.toStationId && legIdx < route.legs.length - 1,
    })

    if (toId === leg.toStationId) legIdx++
  }

  return segments
}

function buildLineProposal(
  network: NetworkExport,
  entry: ComplexJourneyEntry,
  edgeLookup: Map<string, RoutingEdge>,
): ComplexJourneyLineProposal | null {
  if (entry.route.transferCount < 1) return null

  const path = buildNewLineCorridorPath(network, entry.fromId, entry.toId)
  if (!path) return null

  if (isSameStationPath(path.stationIds, entry.route.stationIds)) return null
  if (isExistingTrackChain(path.stationIds, edgeLookup)) return null

  const segments = buildSegmentsFromPath(network, path)
  if (segments.length === 0) return null
  if (newTrackRatio(segments, edgeLookup) < MIN_NEW_TRACK_RATIO) return null

  const segmentSeconds = segments.map((s) => s.estimatedSeconds)
  const directSeconds = travelSecondsBetween(
    path.stationIds,
    segmentSeconds,
    entry.fromId,
    entry.toId,
  )
  if (directSeconds == null) return null

  const { transferCount: afterTransfers, durationSeconds: afterSeconds } = simulateNewLine(
    network,
    entry,
    segments,
  )

  const beforeSeconds = entry.route.totalDurationSeconds
  const timeSavedSeconds = beforeSeconds - Math.min(afterSeconds, directSeconds)
  if (timeSavedSeconds < MIN_TIME_SAVED_SECONDS) return null

  const totalMissingKm = segments.reduce((sum, s) => sum + s.estimatedKm, 0)
  const totalMissingSeconds = segments.reduce((sum, s) => sum + s.estimatedSeconds, 0)
  const afterDistanceMeters = totalMissingKm * 1000
  const transferDelta = entry.route.transferCount - afterTransfers
  const referenceSegments = buildReferenceRouteSegments(entry.route, edgeLookup)
  const referenceTransferStationIds = entry.route.legs.slice(0, -1).map((leg) => leg.toStationId)
  const stopLabel =
    path.stationIds.length === 2
      ? 'Express'
      : `${path.stationIds.length} Halte entlang der Luftlinie`

  const summary = `Neue ${stopLabel}-Linie ${entry.fromName} → ${entry.toName} · ${entry.route.transferCount} → ${afterTransfers} Umstiege`

  return {
    id: `${undirectedPairKey(entry.fromId, entry.toId)}:${pathSignature(path.stationIds)}`,
    fromId: entry.fromId,
    toId: entry.toId,
    fromName: entry.fromName,
    toName: entry.toName,
    stationIds: path.stationIds,
    stationNames: path.stationNames,
    segments,
    missingSegments: segments,
    totalMissingKm,
    totalMissingSeconds,
    beforeTransfers: entry.route.transferCount,
    afterTransfers,
    transferDelta,
    beforeSeconds,
    afterSeconds: Math.min(afterSeconds, directSeconds),
    beforeDistanceMeters: entry.route.totalDistanceMeters,
    afterDistanceMeters,
    timeSavedSeconds,
    beneficiaryCount: 1,
    totalNetworkSecondsSaved: timeSavedSeconds,
    summary,
    highlightStationIds: [...new Set(path.stationIds)],
    referenceStationIds: entry.route.stationIds,
    referenceStationNames: entry.route.stationNames,
    referenceSegments,
    referenceTransferStationIds,
  }
}

function scoreNetworkBenefit(
  proposal: ComplexJourneyLineProposal,
  entries: ComplexJourneyEntry[],
): ComplexJourneyLineProposal {
  const segmentSeconds = proposal.segments.map((s) => s.estimatedSeconds)
  let totalSaved = proposal.timeSavedSeconds
  let count = 1

  for (const entry of entries) {
    if (entry.fromId === proposal.fromId && entry.toId === proposal.toId) continue

    const onLine = travelSecondsBetween(
      proposal.stationIds,
      segmentSeconds,
      entry.fromId,
      entry.toId,
    )
    if (onLine == null) continue

    const saved = entry.route.totalDurationSeconds - onLine
    if (saved >= MIN_TIME_SAVED_SECONDS) {
      totalSaved += saved
      count += 1
    }
  }

  return {
    ...proposal,
    beneficiaryCount: count,
    totalNetworkSecondsSaved: totalSaved,
  }
}

export function buildComplexJourneyLineProposals(
  network: NetworkExport,
  entries: ComplexJourneyEntry[],
  maxProposals = 12,
): ComplexJourneyLineProposal[] {
  const focusEntries = dedupeUndirectedComplexJourneys(
    entries.filter((e) => e.route.transferCount >= 1),
  ).slice(0, 24)

  if (focusEntries.length === 0) return []

  const edgeLookup = buildEdgeLookup(network)

  const byPath = new Map<string, ComplexJourneyLineProposal>()

  for (const entry of focusEntries) {
    const proposal = buildLineProposal(network, entry, edgeLookup)
    if (!proposal) continue

    const pathKey = pathSignature(proposal.stationIds)
    const existing = byPath.get(pathKey)
    if (!existing || proposal.timeSavedSeconds > existing.timeSavedSeconds) {
      byPath.set(pathKey, proposal)
    }
  }

  return [...byPath.values()]
    .map((proposal) => scoreNetworkBenefit(proposal, focusEntries))
    .sort(
      (a, b) =>
        b.totalNetworkSecondsSaved - a.totalNetworkSecondsSaved ||
        b.timeSavedSeconds - a.timeSavedSeconds ||
        b.transferDelta - a.transferDelta,
    )
    .slice(0, maxProposals)
}

export function segmentKey(a: number, b: number): string {
  return undirectedPairKey(a, b)
}
