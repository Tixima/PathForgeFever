import type { ComplexJourneyEntry, ComplexJourneyTier } from './complexJourneys'
import { inefficiencyTier } from './complexJourneys'

export interface StationPairLabel {
  aId: number
  aName: string
  bId: number
  bName: string
}

export interface ComplexJourneyGroup {
  hubStationId: number
  hubStationName: string
  entries: ComplexJourneyEntry[]
  maxComplexityScore: number
  maxTransfers: number
  tier: ComplexJourneyTier
}

export function undirectedPairKey(fromId: number, toId: number): string {
  return fromId < toId ? `${fromId}-${toId}` : `${toId}-${fromId}`
}

export function formatStationPairLabel(entry: ComplexJourneyEntry): StationPairLabel {
  if (entry.fromId < entry.toId) {
    return {
      aId: entry.fromId,
      aName: entry.fromName,
      bId: entry.toId,
      bName: entry.toName,
    }
  }
  return {
    aId: entry.toId,
    aName: entry.toName,
    bId: entry.fromId,
    bName: entry.fromName,
  }
}

/** A→B und B→A zusammenführen — behält die komplexere Richtung. */
export function dedupeUndirectedComplexJourneys(
  entries: ComplexJourneyEntry[],
): ComplexJourneyEntry[] {
  const best = new Map<string, ComplexJourneyEntry>()

  for (const entry of entries) {
    const key = undirectedPairKey(entry.fromId, entry.toId)
    const existing = best.get(key)
    if (!existing || entry.complexityScore > existing.complexityScore) {
      best.set(key, entry)
    }
  }

  return [...best.values()].sort((a, b) => b.complexityScore - a.complexityScore)
}

function groupTier(maxTransfers: number): ComplexJourneyTier {
  return inefficiencyTier(maxTransfers)
}

/**
 * Gruppiert deduplizierte Paare nach gemeinsamem Bahnhof (Hub).
 * Stationen mit ≥2 schwierigen Verbindungen werden als Block angezeigt.
 */
export function groupComplexJourneyEntries(
  entries: ComplexJourneyEntry[],
  maxEntries = 40,
): ComplexJourneyGroup[] {
  const deduped = dedupeUndirectedComplexJourneys(
    entries.filter((e) => e.route.transferCount >= 1),
  ).slice(0, maxEntries)

  const stationDegree = new Map<number, number>()
  for (const entry of deduped) {
    stationDegree.set(entry.fromId, (stationDegree.get(entry.fromId) ?? 0) + 1)
    stationDegree.set(entry.toId, (stationDegree.get(entry.toId) ?? 0) + 1)
  }

  const assigned = new Set<string>()
  const groups: ComplexJourneyGroup[] = []

  const hubCandidates = [...stationDegree.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])

  for (const [hubId, degree] of hubCandidates) {
    if (degree < 2) continue

    const hubEntries = deduped.filter((entry) => {
      const key = undirectedPairKey(entry.fromId, entry.toId)
      if (assigned.has(key)) return false
      return entry.fromId === hubId || entry.toId === hubId
    })

    if (hubEntries.length < 2) continue

    for (const entry of hubEntries) {
      assigned.add(undirectedPairKey(entry.fromId, entry.toId))
    }

    const hubName =
      hubEntries.find((e) => e.fromId === hubId)?.fromName ??
      hubEntries.find((e) => e.toId === hubId)?.toName ??
      ''

    const sorted = [...hubEntries].sort((a, b) => b.complexityScore - a.complexityScore)
    const maxTransfers = Math.max(...sorted.map((e) => e.route.transferCount))

    groups.push({
      hubStationId: hubId,
      hubStationName: hubName,
      entries: sorted,
      maxComplexityScore: sorted[0]?.complexityScore ?? 0,
      maxTransfers,
      tier: groupTier(maxTransfers),
    })
  }

  for (const entry of deduped) {
    const key = undirectedPairKey(entry.fromId, entry.toId)
    if (assigned.has(key)) continue
    assigned.add(key)

    groups.push({
      hubStationId: entry.fromId,
      hubStationName: entry.fromName,
      entries: [entry],
      maxComplexityScore: entry.complexityScore,
      maxTransfers: entry.route.transferCount,
      tier: entry.tier,
    })
  }

  return groups.sort((a, b) => b.maxComplexityScore - a.maxComplexityScore)
}
