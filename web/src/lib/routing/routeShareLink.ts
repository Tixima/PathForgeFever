import type { NetworkExport, RoutingEdge } from '../../types/network'
import type { RouteCriterion, RouteResult } from './types'
import { analyzeRouteAccessibility } from '../platform/accessibleRouting'
import { buildRoutingGraph, getLineColor, getTransferTime } from './buildGraph'
import { expandRoutingEdges } from './expandRoutingEdges'

const FROZEN_ROUTE_VERSION = 1

export interface FrozenRoutePayload {
  v: typeof FROZEN_ROUTE_VERSION
  /** Eindeutiger Fingerabdruck dieser exakten Route (Kantenfolge). */
  rid: string
  /** Zufälliger Share-Token — jeder geteilte Link ist eindeutig identifizierbar. */
  sid: string
  fromId: number
  toId: number
  viaIds?: number[]
  criterion: RouteCriterion
  accessible: boolean
  accessibleStrict: boolean
  edgeIds: string[]
}

export interface RouteShareContext {
  fromId: number
  toId: number
  viaIds?: number[]
  criterion: RouteCriterion
  accessible: boolean
  accessibleStrict: boolean
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): string | null {
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const pad =
      normalized.length % 4 === 0 ? normalized : normalized + '='.repeat(4 - (normalized.length % 4))
    const binary = atob(pad)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function createShareToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function createRouteFingerprint(route: RouteResult): string {
  return fnv1a(route.edgeIds.join('\u001f'))
}

function criterionLabel(criterion: RouteCriterion): string {
  switch (criterion) {
    case 'fastest':
      return 'Schnellste Verbindung'
    case 'shortest':
      return 'Kürzeste Strecke'
    case 'fewest_transfers':
      return 'Wenigste Umstiege'
    case 'fewest_stops':
      return 'Wenigste Halte'
  }
}

function buildEdgeLookup(network: NetworkExport): Map<string, RoutingEdge> {
  const lookup = new Map<string, RoutingEdge>()
  for (const edge of expandRoutingEdges(network.routing_edges)) {
    lookup.set(edge.id, edge)
  }
  return lookup
}

export function encodeFrozenRoute(
  route: RouteResult,
  context: RouteShareContext,
): { payload: FrozenRoutePayload; routeParam: string } {
  const payload: FrozenRoutePayload = {
    v: FROZEN_ROUTE_VERSION,
    rid: createRouteFingerprint(route),
    sid: createShareToken(),
    fromId: context.fromId,
    toId: context.toId,
    viaIds: context.viaIds?.length ? context.viaIds : undefined,
    criterion: context.criterion,
    accessible: context.accessible,
    accessibleStrict: context.accessibleStrict,
    edgeIds: [...route.edgeIds],
  }

  return {
    payload,
    routeParam: toBase64Url(JSON.stringify(payload)),
  }
}

export function decodeFrozenRoute(routeParam: string): FrozenRoutePayload | null {
  const json = fromBase64Url(routeParam)
  if (!json) return null

  try {
    const parsed = JSON.parse(json) as Partial<FrozenRoutePayload>
    if (parsed.v !== FROZEN_ROUTE_VERSION) return null
    if (!parsed.rid || !parsed.sid || !parsed.fromId || !parsed.toId) return null
    if (!Array.isArray(parsed.edgeIds) || parsed.edgeIds.length === 0) return null

    return {
      v: FROZEN_ROUTE_VERSION,
      rid: parsed.rid,
      sid: parsed.sid,
      fromId: parsed.fromId,
      toId: parsed.toId,
      viaIds: parsed.viaIds,
      criterion: parsed.criterion ?? 'fastest',
      accessible: parsed.accessible ?? false,
      accessibleStrict: parsed.accessibleStrict ?? false,
      edgeIds: parsed.edgeIds,
    }
  } catch {
    return null
  }
}

export function reconstructRouteFromShare(
  network: NetworkExport,
  payload: FrozenRoutePayload,
): { route: RouteResult | null; missingEdgeIds: string[] } {
  const lookup = buildEdgeLookup(network)
  const missingEdgeIds: string[] = []
  const hops: Array<{ edge: RoutingEdge; isTransfer: boolean; transferSeconds: number }> = []

  let previousLineId: number | null = null
  const graph = buildRoutingGraph(network)

  for (const edgeId of payload.edgeIds) {
    const edge = lookup.get(edgeId)
    if (!edge) {
      missingEdgeIds.push(edgeId)
      continue
    }

    const isTransfer = previousLineId !== null && previousLineId !== edge.line_id
    const transferSeconds = isTransfer ? getTransferTime(graph, edge.from) : 0

    hops.push({ edge, isTransfer, transferSeconds })
    previousLineId = edge.line_id
  }

  if (hops.length === 0) {
    return { route: null, missingEdgeIds }
  }

  const legs: RouteResult['legs'] = []
  let currentLeg: RouteResult['legs'][number] | null = null
  const stationIds = [hops[0]!.edge.from]
  const stationNames = [hops[0]!.edge.from_name]
  const edgeIds: string[] = []

  for (const { edge, isTransfer, transferSeconds } of hops) {
    edgeIds.push(edge.id)
    stationIds.push(edge.to)
    stationNames.push(edge.to_name)

    if (!currentLeg || currentLeg.lineId !== edge.line_id || isTransfer) {
      if (currentLeg) legs.push(currentLeg)
      currentLeg = {
        lineId: edge.line_id,
        lineName: edge.line_name,
        lineColor: getLineColor(graph, edge.line_id),
        fromStationId: edge.from,
        fromStationName: edge.from_name,
        toStationId: edge.to,
        toStationName: edge.to_name,
        stops: [edge.from_name, edge.to_name],
        edgeIds: [edge.id],
        durationSeconds: edge.cost_seconds,
        distanceMeters: edge.cost_distance,
        edgeCount: 1,
      }
      if (isTransfer && transferSeconds > 0) {
        currentLeg.durationSeconds += transferSeconds
      }
    } else {
      currentLeg.toStationId = edge.to
      currentLeg.toStationName = edge.to_name
      currentLeg.stops.push(edge.to_name)
      currentLeg.edgeIds.push(edge.id)
      currentLeg.durationSeconds += edge.cost_seconds
      currentLeg.distanceMeters += edge.cost_distance
      currentLeg.edgeCount += 1
    }
  }

  if (currentLeg) legs.push(currentLeg)

  const transferCount = hops.filter((hop) => hop.isTransfer).length
  const totalDurationSeconds = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0)
  const totalDistanceMeters = legs.reduce((sum, leg) => sum + leg.distanceMeters, 0)

  const route: RouteResult = {
    id: stationNames.join('>'),
    criterion: payload.criterion,
    label: criterionLabel(payload.criterion),
    tags: ['geteilt', 'eingefroren'],
    legs,
    edgeIds,
    stationIds,
    viaStationIds: payload.viaIds,
    totalDurationSeconds,
    totalDistanceMeters,
    transferCount,
    stopCount: stationNames.length - 1,
    stationNames,
    isDirect: transferCount === 0 && legs.length === 1,
    isExperimental: true,
  }

  if (payload.accessible) {
    route.accessibility = analyzeRouteAccessibility(network, route, {
      requested: true,
      zeroChangeRouteExists: false,
      zeroChangeWithoutStaySeated: false,
    })
  }

  return { route, missingEdgeIds }
}

export function buildFrozenShareUrl(
  route: RouteResult,
  context: RouteShareContext,
  basePath = typeof window !== 'undefined'
    ? window.location.origin + window.location.pathname
    : '',
): string {
  const { payload, routeParam } = encodeFrozenRoute(route, context)
  const params = new URLSearchParams()
  params.set('from', String(context.fromId))
  params.set('to', String(context.toId))
  params.set('share', 'frozen')
  params.set('rid', payload.rid)
  params.set('sid', payload.sid)
  params.set('route', routeParam)
  if (context.criterion !== 'fastest') params.set('criterion', context.criterion)
  if (context.accessible) params.set('accessible', '1')
  if (context.accessibleStrict) params.set('accessibleStrict', '1')
  if (context.viaIds?.length) params.set('via', context.viaIds.join(','))

  return `${basePath}?${params.toString()}`
}

export function buildDynamicShareUrl(
  context: RouteShareContext,
  basePath = typeof window !== 'undefined'
    ? window.location.origin + window.location.pathname
    : '',
): string {
  const params = new URLSearchParams()
  params.set('share', 'dynamic')
  params.set('from', String(context.fromId))
  params.set('to', String(context.toId))
  if (context.criterion !== 'fastest') params.set('criterion', context.criterion)
  if (context.accessible) params.set('accessible', '1')
  if (context.accessibleStrict) params.set('accessibleStrict', '1')
  if (context.viaIds?.length) params.set('via', context.viaIds.join(','))

  return `${basePath}?${params.toString()}`
}
