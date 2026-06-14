import type { NetworkExport, RoutingEdge } from '../../types/network'
import {
  buildRoutingGraph,
  getLineColor,
  getTransferTime,
  type RoutingGraph,
} from './buildGraph'
import { mergeRouteResults } from './mergeRoutes'
import { MinCostHeap } from './minCostHeap'
import {
  buildRoutingPlatformIndex,
  platformChangePenalty,
  resolveHopPlatforms,
  type RoutingPlatformIndex,
} from '../platform/routingPlatforms'
import { analyzeRouteAccessibility, canTransferWithoutPlatformChange } from '../platform/accessibleRouting'
import { STAY_SEATED_REVISIT_PENALTY } from './staySeatedStops'
import {
  ALL_CRITERIA,
  type ExtendedRouteCriterion,
  type RouteCriterion,
  type RouteLeg,
  type RouteResult,
  type RouteSearchOptions,
  type RouteSearchResult,
} from './types'

export const ROUTE_EDGE_PENALTY = 50_000
const EDGE_PENALTY = ROUTE_EDGE_PENALTY
const MAX_ALTERNATIVES = 8

interface SearchState {
  nodeId: number
  arrivedViaLineId: number | null
  /** Gleis bei Ankunft am aktuellen Knoten (letzter Hop). */
  arrivalPlatform: string | null
  lastHopFromId: number | null
  /** Stationen auf dem aktuellen Linienabschnitt (seit letztem Umstieg). */
  linePathNodes: number[]
}

interface QueueEntry {
  cost: number
  state: SearchState
}

interface Predecessor {
  prevState: SearchState | null
  edge: RoutingEdge | null
  transferPenaltySeconds: number
  isTransfer: boolean
}

interface DijkstraOptions {
  edgePenalties?: Map<string, number>
  accessible?: boolean
  accessibleStrict?: boolean
  avoidStaySeated?: boolean
  platformIndex?: RoutingPlatformIndex
  network?: NetworkExport
}

function stateKey(state: SearchState, accessible: boolean, avoidStaySeated = false): string {
  let base: string
  if (!accessible) {
    base = `${state.nodeId}:${state.arrivedViaLineId ?? 'start'}`
  } else {
    base = `${state.nodeId}:${state.arrivedViaLineId ?? 'start'}:${state.arrivalPlatform ?? '-'}`
  }
  if (avoidStaySeated) {
    const visits = state.linePathNodes.filter((nodeId) => nodeId === state.nodeId).length
    base += `:v${visits}`
  }
  return base
}

function routeSignature(route: RouteResult): string {
  return route.stationNames.join('>')
}

function criterionLabel(criterion: ExtendedRouteCriterion): string {
  switch (criterion) {
    case 'fastest':
      return 'Schnellste Verbindung'
    case 'shortest':
      return 'Kürzeste Strecke'
    case 'fewest_transfers':
      return 'Wenigste Umstiege'
    case 'fewest_stops':
      return 'Wenigste Halte'
    case 'most_complex':
      return 'Maximale Komplexität'
  }
}

function calculateEdgeWeight(
  criterion: ExtendedRouteCriterion,
  edge: RoutingEdge,
  isTransfer: boolean,
  transferSeconds: number,
  edgePenalties?: Map<string, number>,
): number {
  let base: number
  switch (criterion) {
    case 'fastest':
      base = edge.cost_seconds + (isTransfer ? transferSeconds : 0)
      break
    case 'shortest':
      base = edge.cost_distance
      break
    case 'fewest_transfers':
      base = (isTransfer ? 1_000_000 : 0) + edge.cost_seconds * 0.001
      break
    case 'fewest_stops':
      base = 1 + edge.cost_seconds * 0.000_001
      break
    case 'most_complex':
      // Dijkstra braucht nicht-negative Gewichte: Umstiege „billiger“ als Durchfahrt ohne Wechsel
      base = (isTransfer ? 0 : 2_000_000) + edge.cost_seconds * 0.001
      break
  }
  return base + (edgePenalties?.get(edge.id) ?? 0)
}

function reconstructRoute(
  graph: RoutingGraph,
  predecessors: Map<string, Predecessor>,
  endState: SearchState,
  criterion: ExtendedRouteCriterion,
  tags: string[] = [],
  accessible = false,
  avoidStaySeated = false,
): RouteResult | null {
  const edges: Array<{
    edge: RoutingEdge
    isTransfer: boolean
    transferSeconds: number
  }> = []

  let current: SearchState | null = endState

  while (current) {
    const pred = predecessors.get(stateKey(current, accessible, avoidStaySeated))
    if (!pred) break
    if (pred.edge) {
      edges.unshift({
        edge: pred.edge,
        isTransfer: pred.isTransfer,
        transferSeconds: pred.transferPenaltySeconds,
      })
    }
    current = pred.prevState
  }

  if (edges.length === 0) return null

  const legs: RouteLeg[] = []
  let currentLeg: RouteLeg | null = null
  const allEdgeIds: string[] = []
  const stationIds: number[] = [edges[0].edge.from]

  for (const { edge, isTransfer, transferSeconds } of edges) {
    allEdgeIds.push(edge.id)
    stationIds.push(edge.to)

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

  const stationNames = [edges[0].edge.from_name]
  for (const { edge } of edges) {
    stationNames.push(edge.to_name)
  }

  const transferCount = edges.filter((e) => e.isTransfer).length
  const totalDurationSeconds = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0)
  const totalDistanceMeters = legs.reduce((sum, leg) => sum + leg.distanceMeters, 0)
  const stopCount = stationNames.length - 1
  const resultCriterion: RouteCriterion = criterion === 'most_complex' ? 'fastest' : criterion

  return {
    id: stationNames.join('>'),
    criterion: resultCriterion,
    label: criterionLabel(criterion),
    tags,
    legs,
    edgeIds: allEdgeIds,
    stationIds,
    totalDurationSeconds,
    totalDistanceMeters,
    transferCount,
    stopCount,
    stationNames,
    isDirect: transferCount === 0 && legs.length === 1,
    isExperimental: true,
  }
}

function dijkstra(
  graph: RoutingGraph,
  fromId: number,
  toId: number,
  criterion: ExtendedRouteCriterion,
  options: DijkstraOptions = {},
): RouteResult | null {
  const accessible = options.accessible ?? false
  const accessibleStrict = options.accessibleStrict ?? false
  const avoidStaySeated = options.avoidStaySeated ?? false
  const platformIndex = options.platformIndex
  const network = options.network

  const start: SearchState = {
    nodeId: fromId,
    arrivedViaLineId: null,
    arrivalPlatform: null,
    lastHopFromId: null,
    linePathNodes: [fromId],
  }
  const dist = new Map<string, number>()
  const predecessors = new Map<string, Predecessor>()
  const queue = new MinCostHeap<QueueEntry>()

  dist.set(stateKey(start, accessible, avoidStaySeated), 0)
  queue.push({ cost: 0, state: start })

  const maxPops = 250_000
  let pops = 0

  while (queue.size > 0) {
    if (++pops > maxPops) return null

    const current = queue.pop()!
    const key = stateKey(current.state, accessible, avoidStaySeated)

    if (current.cost > (dist.get(key) ?? Infinity)) continue

    if (current.state.nodeId === toId) {
      const tags: string[] = []
      if (accessible) {
        tags.push(accessibleStrict ? 'barrierefrei-strikt' : 'barrierefrei')
      }
      return reconstructRoute(
        graph,
        predecessors,
        current.state,
        criterion,
        tags,
        accessible,
        avoidStaySeated,
      )
    }

    const outgoing = graph.adjacency.get(current.state.nodeId) ?? []

    for (const edge of outgoing) {
      const isTransfer =
        current.state.arrivedViaLineId !== null &&
        current.state.arrivedViaLineId !== edge.line_id

      const transferSeconds = isTransfer
        ? getTransferTime(graph, current.state.nodeId)
        : 0

      const edgeWeight = calculateEdgeWeight(
        criterion,
        edge,
        isTransfer,
        transferSeconds,
        options.edgePenalties,
      )

      let accessibilityPenalty = 0
      let nextArrivalPlatform: string | null = null
      let staySeatedPenalty = 0

      if (accessible && platformIndex && network) {
        if (isTransfer && current.state.arrivedViaLineId !== null) {
          const alight = current.state.arrivalPlatform
          const board = resolveHopPlatforms(network, edge.line_id, edge.from, edge.to).boarding
          const canStayOnPlatform =
            Boolean(alight && board && alight === board) ||
            ((!alight || !board) &&
              canTransferWithoutPlatformChange(
                platformIndex,
                network,
                current.state.arrivedViaLineId,
                current.state.lastHopFromId ?? edge.from,
                current.state.nodeId,
                edge.line_id,
                edge.to,
              ))

          if (accessibleStrict && !canStayOnPlatform) {
            continue
          }

          if (alight && board && alight !== board) {
            accessibilityPenalty = platformChangePenalty(alight, board)
          } else if (!alight || !board) {
            accessibilityPenalty = platformChangePenalty(alight, board)
          }

          nextArrivalPlatform = board
        } else {
          nextArrivalPlatform = resolveHopPlatforms(
            network,
            edge.line_id,
            edge.from,
            edge.to,
          ).alighting
        }
      }

      let nextLinePathNodes: number[]
      if (isTransfer) {
        nextLinePathNodes = [current.state.nodeId, edge.to]
      } else {
        if (avoidStaySeated && current.state.linePathNodes.includes(edge.to)) {
          staySeatedPenalty = STAY_SEATED_REVISIT_PENALTY
        }
        nextLinePathNodes = [...current.state.linePathNodes, edge.to]
      }

      const newCost = current.cost + edgeWeight + accessibilityPenalty + staySeatedPenalty

      const nextState: SearchState = {
        nodeId: edge.to,
        arrivedViaLineId: edge.line_id,
        arrivalPlatform: nextArrivalPlatform,
        lastHopFromId: edge.from,
        linePathNodes: nextLinePathNodes,
      }
      const nextKey = stateKey(nextState, accessible, avoidStaySeated)

      if (newCost < (dist.get(nextKey) ?? Infinity)) {
        dist.set(nextKey, newCost)
        predecessors.set(nextKey, {
          prevState: current.state,
          edge,
          transferPenaltySeconds: transferSeconds,
          isTransfer,
        })
        queue.push({ cost: newCost, state: nextState })
      }
    }
  }

  return null
}

export function findRoute(
  network: NetworkExport,
  fromId: number,
  toId: number,
  criterion: RouteCriterion,
): RouteResult | null {
  if (fromId === toId) return null
  const graph = buildRoutingGraph(network)
  return dijkstra(graph, fromId, toId, criterion)
}

export function findRouteThroughWaypoints(
  network: NetworkExport,
  waypoints: number[],
  criterion: RouteCriterion,
  options: DijkstraOptions = {},
): RouteResult | null {
  if (waypoints.length < 2) return null

  const graph = buildRoutingGraph(network)
  const segments: RouteResult[] = []

  for (let i = 0; i < waypoints.length - 1; i++) {
    const segment = dijkstra(graph, waypoints[i], waypoints[i + 1], criterion, options)
    if (!segment) return null
    segments.push(segment)
  }

  const viaIds = waypoints.slice(1, -1)
  return mergeRouteResults(segments, criterion, graph.transferTimes, [], viaIds)
}

function annotateDeltas(routes: RouteResult[]): RouteResult[] {
  if (routes.length === 0) return routes
  const fastest = Math.min(...routes.map((r) => r.totalDurationSeconds))
  return routes.map((r) => ({
    ...r,
    deltaSeconds: r.totalDurationSeconds - fastest,
  }))
}

interface AccessibleRouteBundle {
  compromise: RouteResult | null
  strict: RouteResult | null
}

function findAccessibleRouteBundle(
  network: NetworkExport,
  graph: RoutingGraph,
  fromId: number,
  toId: number,
  criterion: RouteCriterion,
  waypoints: number[],
  hasVias: boolean,
): AccessibleRouteBundle {
  const platformIndex = buildRoutingPlatformIndex(network)
  const base: DijkstraOptions = {
    accessible: true,
    platformIndex,
    network,
  }

  const searchAcc = (opts: DijkstraOptions = {}) =>
    hasVias
      ? findRouteThroughWaypoints(network, waypoints, criterion, { ...base, ...opts })
      : dijkstra(graph, fromId, toId, criterion, { ...base, ...opts })

  const strictNoStay = searchAcc({ accessibleStrict: true, avoidStaySeated: true })
  const strictAllowStay = searchAcc({ accessibleStrict: true, avoidStaySeated: false })
  const compromise = searchAcc({ accessibleStrict: false })

  const zeroChangeWithoutStaySeated = Boolean(strictNoStay)
  const zeroChangeRouteExists = Boolean(strictNoStay || strictAllowStay)

  const enrich = (route: RouteResult | null): RouteResult | null => {
    if (!route) return null
    return {
      ...route,
      accessibility: analyzeRouteAccessibility(network, route, {
        requested: true,
        zeroChangeRouteExists,
        zeroChangeWithoutStaySeated,
      }),
    }
  }

  return {
    compromise: enrich(compromise),
    strict: enrich(strictNoStay ?? strictAllowStay),
  }
}

function injectAccessibleAlternatives(
  network: NetworkExport,
  graph: RoutingGraph,
  fromId: number,
  toId: number,
  criterion: RouteCriterion,
  waypoints: number[],
  hasVias: boolean,
  collected: RouteResult[],
  seen: Set<string>,
): void {
  const { compromise, strict } = findAccessibleRouteBundle(
    network,
    graph,
    fromId,
    toId,
    criterion,
    waypoints,
    hasVias,
  )

  const pushUnique = (route: RouteResult | null, extraTags: string[]) => {
    if (!route) return
    const sig = routeSignature(route)
    if (seen.has(sig)) return
    seen.add(sig)
    collected.push({ ...route, tags: [...route.tags, ...extraTags, 'alternative'] })
  }

  if (compromise) {
    const alsoStrict = strict && routeSignature(strict) === routeSignature(compromise)
    pushUnique(compromise, alsoStrict ? ['barrierefrei-strikt'] : ['barrierefrei'])
  }

  if (strict && (!compromise || routeSignature(strict) !== routeSignature(compromise))) {
    pushUnique(strict, ['barrierefrei-strikt'])
  }
}

export function findRouteAlternatives(
  network: NetworkExport,
  fromId: number,
  toId: number,
  criterion: RouteCriterion,
  viaIds: number[] = [],
  searchOptions: RouteSearchOptions = {},
): RouteSearchResult | null {
  if (fromId === toId) return null

  const accessible = searchOptions.accessible ?? false
  const displayStrict = accessible && (searchOptions.accessibleStrict ?? false)
  const platformIndex = accessible ? buildRoutingPlatformIndex(network) : undefined
  const dijkstraBase: DijkstraOptions = {
    accessible,
    platformIndex,
    network,
  }

  const waypoints = [fromId, ...viaIds, toId]
  const graph = buildRoutingGraph(network)
  const collected: RouteResult[] = []
  const seen = new Set<string>()
  const hasVias = viaIds.length > 0

  const search = (crit: RouteCriterion, opts: DijkstraOptions = {}) =>
    hasVias
      ? findRouteThroughWaypoints(network, waypoints, crit, { ...dijkstraBase, ...opts })
      : dijkstra(graph, fromId, toId, crit, { ...dijkstraBase, ...opts })

  const attachAccessibility = (
    route: RouteResult,
    zeroChangeRouteExists: boolean,
    zeroChangeWithoutStaySeated: boolean,
  ): RouteResult => ({
    ...route,
    accessibility: analyzeRouteAccessibility(network, route, {
      requested: accessible,
      zeroChangeRouteExists,
      zeroChangeWithoutStaySeated,
    }),
  })

  const addRoute = (
    route: RouteResult | null,
    tags: string[] = [],
    zeroChange = false,
    zeroChangeWithoutStaySeated = false,
  ) => {
    if (!route) return
    const sig = routeSignature(route)
    if (seen.has(sig)) return
    seen.add(sig)
    const enriched = accessible
      ? attachAccessibility(route, zeroChange, zeroChangeWithoutStaySeated)
      : route
    const mergedTags = displayStrict ? [...tags, 'strikt-modus'] : tags
    collected.push({ ...enriched, tags: [...enriched.tags, ...mergedTags] })
  }

  let zeroChangeRouteExists = false
  let zeroChangeWithoutStaySeated = false
  let primary: RouteResult | null = null

  if (accessible) {
    const strictNoStay = search(criterion, { accessibleStrict: true, avoidStaySeated: true })
    const strictAllowStay = search(criterion, { accessibleStrict: true, avoidStaySeated: false })

    zeroChangeWithoutStaySeated = Boolean(strictNoStay)
    zeroChangeRouteExists = Boolean(strictNoStay || strictAllowStay)

    if (displayStrict) {
      primary = strictNoStay ?? strictAllowStay
      if (!primary) return null

      addRoute(primary, ['empfohlen'], true, zeroChangeWithoutStaySeated)

      if (strictNoStay && strictNoStay.id !== primary.id) {
        addRoute(strictNoStay, ['ohne-gleiswechsel'], true, true)
      }
      if (strictAllowStay && strictAllowStay.id !== primary.id) {
        addRoute(strictAllowStay, ['sitzenbleiben'], true, false)
      }
    } else {
      const compromise = search(criterion, { accessibleStrict: false })

      primary = strictNoStay ?? strictAllowStay ?? compromise
      if (!primary) return null

      addRoute(primary, ['empfohlen'], zeroChangeRouteExists, zeroChangeWithoutStaySeated)

      if (strictNoStay && strictNoStay.id !== primary.id) {
        addRoute(strictNoStay, ['ohne-gleiswechsel'], true, true)
      }
      if (strictAllowStay && strictAllowStay.id !== primary.id) {
        addRoute(strictAllowStay, ['sitzenbleiben'], true, false)
      }
    }
  } else {
    primary = search(criterion, {})
    if (!primary) return null
    addRoute(primary, ['empfohlen'], false, false)
  }

  if (!hasVias && !displayStrict) {
    for (const c of ALL_CRITERIA) {
      if (c === criterion) continue
      addRoute(search(c, {}), ['kriterium'])
    }
  }

  const penalties = new Map<string, number>()
  let attempts = 0

  while (collected.length < MAX_ALTERNATIVES && attempts < 40) {
    attempts++
    const route = displayStrict
      ? search(criterion, {
          edgePenalties: penalties,
          accessibleStrict: true,
          avoidStaySeated: true,
        }) ??
        search(criterion, {
          edgePenalties: penalties,
          accessibleStrict: true,
          avoidStaySeated: false,
        })
      : search(criterion, { edgePenalties: penalties })
    if (!route) break

    const sig = routeSignature(route)
    if (!seen.has(sig)) {
      addRoute(route, ['alternative'], displayStrict, zeroChangeWithoutStaySeated)
    }

    for (const edgeId of route.edgeIds) {
      penalties.set(edgeId, (penalties.get(edgeId) ?? 0) + EDGE_PENALTY)
    }
  }

  if (!accessible) {
    injectAccessibleAlternatives(
      network,
      graph,
      fromId,
      toId,
      criterion,
      waypoints,
      hasVias,
      collected,
      seen,
    )
  }

  let annotated = annotateDeltas(collected)
  if (displayStrict) {
    annotated = annotated.filter((route) => route.accessibility?.fullySamePlatform)
    if (annotated.length === 0) return null
  }

  const primaryRoute = annotated.find((r) => r.id === primary!.id) ?? annotated[0]
  const alternatives = annotated.filter((r) => r.id !== primaryRoute.id)

  alternatives.sort((a, b) => {
    const accessibleRank = (route: RouteResult) => {
      if (route.tags.includes('barrierefrei-strikt')) return 0
      if (route.tags.includes('barrierefrei')) return 1
      return 2
    }
    const rankDiff = accessibleRank(a) - accessibleRank(b)
    if (rankDiff !== 0) return rankDiff

    const aZero = a.accessibility?.fullySamePlatform ? 0 : 1
    const bZero = b.accessibility?.fullySamePlatform ? 0 : 1
    if (aZero !== bZero) return aZero - bZero
    const aStay = a.accessibility?.usesStaySeated ? 1 : 0
    const bStay = b.accessibility?.usesStaySeated ? 1 : 0
    if (aStay !== bStay) return aStay - bStay
    return a.totalDurationSeconds - b.totalDurationSeconds
  })

  return {
    primary: primaryRoute,
    alternatives,
    allRoutes: annotated,
  }
}

export function findAllRoutesFromStation(
  network: NetworkExport,
  fromId: number,
  criterion: RouteCriterion = 'fastest',
): RouteResult[] {
  const graph = buildRoutingGraph(network)
  const routes: RouteResult[] = []

  for (const node of network.routing_nodes) {
    if (node.id === fromId) continue
    const route = dijkstra(graph, fromId, node.id, criterion)
    if (route) routes.push(route)
  }

  return routes.sort((a, b) => a.totalDurationSeconds - b.totalDurationSeconds)
}

export function findAllCriteriaRoutes(
  network: NetworkExport,
  fromId: number,
  toId: number,
): RouteResult[] {
  const results: RouteResult[] = []
  const seen = new Set<string>()

  for (const criterion of ALL_CRITERIA) {
    const route = findRoute(network, fromId, toId, criterion)
    if (!route) continue
    const signature = routeSignature(route)
    if (seen.has(signature)) continue
    seen.add(signature)
    results.push(route)
  }

  return annotateDeltas(results)
}

export function findMostComplexRoute(
  network: NetworkExport,
  fromId: number,
  toId: number,
): RouteResult | null {
  if (fromId === toId) return null
  const graph = buildRoutingGraph(network)
  return dijkstra(graph, fromId, toId, 'most_complex')
}

export function searchRouteOnGraph(
  graph: RoutingGraph,
  fromId: number,
  toId: number,
  criterion: ExtendedRouteCriterion,
  options: DijkstraOptions = {},
): RouteResult | null {
  if (fromId === toId) return null
  return dijkstra(graph, fromId, toId, criterion, options)
}

export function findComplexRoutesForPair(
  graph: RoutingGraph,
  fromId: number,
  toId: number,
  maxRoutes = 6,
): RouteResult[] {
  const routes: RouteResult[] = []
  const seen = new Set<string>()
  const penalties = new Map<string, number>()

  for (let attempt = 0; attempt < maxRoutes + 4; attempt++) {
    const route = dijkstra(graph, fromId, toId, 'most_complex', { edgePenalties: penalties })
    if (!route) break

    const sig = routeSignature(route)
    if (seen.has(sig)) break
    seen.add(sig)
    routes.push(route)

    for (const edgeId of route.edgeIds) {
      penalties.set(edgeId, (penalties.get(edgeId) ?? 0) + EDGE_PENALTY)
    }
  }

  return routes
}
