import type { NetworkExport } from '../../types/network'
import type { RouteResult } from './types'
import { buildRoutingGraph } from './buildGraph'
import { searchRouteOnGraph } from './pathfinder'

export type ComplexJourneyTier = 'extrem' | 'schwer' | 'moderat' | 'leicht'

export interface ComplexJourneyEntry {
  fromId: number
  fromName: string
  toId: number
  toName: string
  /** Schnellste Verbindung für dieses Paar */
  route: RouteResult
  fastestSeconds: number
  extraSeconds: number
  inefficiencyRatio: number
  complexityScore: number
  tier: ComplexJourneyTier
}

export interface ComplexJourneyScanState {
  entries: ComplexJourneyEntry[]
  done: number
  total: number
  finished: boolean
  networkMaxTransfers: number
  networkMaxStops: number
  currentFromName: string | null
  currentToName: string | null
  /** Paare, deren schnellste Verbindung mindestens einen Umstieg hat */
  routesFound: number
  /** Paare mit erreichbarer schnellster Route */
  reachablePairs: number
  /** Summe aller schnellsten Reisezeiten (Sekunden, Spielzeit) */
  totalFastestSeconds: number
  /** Durchschnittliche schnellste Reisezeit über alle geprüften erreichbaren Paare */
  averageFastestSeconds: number
  leader: ComplexJourneyEntry | null
}

const PAIRS_PER_TICK = 8
const STEP_BUDGET_MS = 12

export function emptyComplexJourneyScanState(total: number): ComplexJourneyScanState {
  return {
    entries: [],
    done: 0,
    total,
    finished: false,
    networkMaxTransfers: 0,
    networkMaxStops: 0,
    currentFromName: null,
    currentToName: null,
    routesFound: 0,
    reachablePairs: 0,
    totalFastestSeconds: 0,
    averageFastestSeconds: 0,
    leader: null,
  }
}

export function countStationPairs(nodeCount: number): number {
  return nodeCount * Math.max(0, nodeCount - 1)
}

/** Komplexität der schnellsten Verbindung — Umstiege dominieren, Dauer als Tiebreaker. */
export function computeComplexityScore(route: RouteResult): number {
  return (
    route.transferCount * 1_000_000 +
    route.stopCount * 10_000 +
    route.legs.length * 1_000 +
    route.totalDurationSeconds * 0.01
  )
}

export function inefficiencyTier(transferCount: number): ComplexJourneyTier {
  if (transferCount >= 5) return 'extrem'
  if (transferCount >= 3) return 'schwer'
  if (transferCount >= 2) return 'moderat'
  return 'leicht'
}

export function tierLabel(tier: ComplexJourneyTier): string {
  switch (tier) {
    case 'extrem':
      return 'Extrem'
    case 'schwer':
      return 'Schwer'
    case 'moderat':
      return 'Moderat'
    case 'leicht':
      return 'Leicht'
  }
}

function buildPairList(network: NetworkExport): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  const n = network.routing_nodes.length
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) pairs.push([i, j])
    }
  }
  return pairs
}

function buildEntry(
  from: { id: number; name: string },
  to: { id: number; name: string },
  route: RouteResult,
): ComplexJourneyEntry {
  const seconds = route.totalDurationSeconds
  return {
    fromId: from.id,
    fromName: from.name,
    toId: to.id,
    toName: to.name,
    route: {
      ...route,
      criterion: 'fastest',
      label: 'Schnellste Verbindung',
      tags: ['schnellste', 'komplexitaet'],
      deltaSeconds: 0,
    },
    fastestSeconds: seconds,
    extraSeconds: 0,
    inefficiencyRatio: 1,
    complexityScore: computeComplexityScore(route),
    tier: inefficiencyTier(route.transferCount),
  }
}

export function createComplexJourneyScanner(network: NetworkExport) {
  const graph = buildRoutingGraph(network)
  const nodes = network.routing_nodes
  const pairs = buildPairList(network)
  const entries: ComplexJourneyEntry[] = []
  let pairIndex = 0
  let networkMaxTransfers = 0
  let networkMaxStops = 0
  let routesFound = 0
  let reachablePairs = 0
  let totalFastestSeconds = 0
  let leader: ComplexJourneyEntry | null = null

  function considerLeader(entry: ComplexJourneyEntry) {
    if (entry.route.transferCount === 0) return
    if (!leader || entry.complexityScore > leader.complexityScore) {
      leader = entry
    }
  }

  function processPair(fromIdx: number, toIdx: number) {
    const from = nodes[fromIdx]
    const to = nodes[toIdx]
    const fastest = searchRouteOnGraph(graph, from.id, to.id, 'fastest')
    if (!fastest) return

    networkMaxTransfers = Math.max(networkMaxTransfers, fastest.transferCount)
    networkMaxStops = Math.max(networkMaxStops, fastest.stopCount)
    reachablePairs += 1
    totalFastestSeconds += fastest.totalDurationSeconds

    const entry = buildEntry(from, to, fastest)
    entries.push(entry)

    if (fastest.transferCount >= 1) {
      routesFound += 1
      considerLeader(entry)
    }
  }

  return {
    totalPairs: pairs.length,
    step(budgetMs = STEP_BUDGET_MS): ComplexJourneyScanState {
      const deadline = performance.now() + budgetMs
      let currentFromName: string | null = null
      let currentToName: string | null = null
      let processed = 0

      while (
        pairIndex < pairs.length &&
        processed < PAIRS_PER_TICK &&
        performance.now() < deadline
      ) {
        const [fromIdx, toIdx] = pairs[pairIndex]
        currentFromName = nodes[fromIdx].name
        currentToName = nodes[toIdx].name
        processPair(fromIdx, toIdx)
        pairIndex += 1
        processed += 1
      }

      const finished = pairIndex >= pairs.length
      const sorted = finished
        ? [...entries].sort((a, b) => b.complexityScore - a.complexityScore)
        : entries
      const averageFastestSeconds =
        reachablePairs > 0 ? totalFastestSeconds / reachablePairs : 0

      return {
        entries: sorted,
        done: pairIndex,
        total: pairs.length,
        finished,
        networkMaxTransfers,
        networkMaxStops,
        currentFromName,
        currentToName,
        routesFound,
        reachablePairs,
        totalFastestSeconds,
        averageFastestSeconds,
        leader,
      }
    },
  }
}

export function scanComplexJourneysSync(network: NetworkExport): ComplexJourneyScanState {
  const scanner = createComplexJourneyScanner(network)
  let state = scanner.step(scanner.totalPairs)
  while (!state.finished) {
    state = scanner.step(scanner.totalPairs)
  }
  return state
}
