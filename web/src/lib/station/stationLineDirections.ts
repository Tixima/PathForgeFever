import type { NetworkExport } from '../../types/network'
import { buildLineTerminusMap } from '../network/lineTerminus'

export interface LineDirectionAtStop {
  lineId: number
  lineName: string
  lineShort: string
  lineColor: string
  prevStop: string | null
  nextStop: string | null
  prevInitial: string | null
  nextInitial: string | null
  terminusFrom: string
  terminusTo: string
  stopIndex: number
}

function stopInitial(name: string | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  return trimmed.charAt(0).toUpperCase()
}

function lineShortName(name: string): string {
  return name.replace(/^Linie\s*/i, '').trim() || name
}

export function buildStationLineDirectionsIndex(
  network: NetworkExport,
): Map<number, LineDirectionAtStop[]> {
  const lineTermini = buildLineTerminusMap(network)
  const byStationId = new Map<number, LineDirectionAtStop[]>()

  for (const line of network.lines) {
    const stops = line.stops ?? []
    const terminus = lineTermini.get(line.id)
    const short = lineShortName(line.name)
    const color = line.display_color?.hex ?? '#3B82F6'

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i]
      const prev = stops[i - 1]
      const next = stops[i + 1]
      const prevName = prev?.station_group_name ?? null
      const nextName = next?.station_group_name ?? null

      const entry: LineDirectionAtStop = {
        lineId: line.id,
        lineName: line.name,
        lineShort: short,
        lineColor: color,
        prevStop: prevName,
        nextStop: nextName,
        prevInitial: stopInitial(prevName ?? undefined),
        nextInitial: stopInitial(nextName ?? undefined),
        terminusFrom: terminus?.terminusFrom ?? '?',
        terminusTo: terminus?.terminusTo ?? '?',
        stopIndex: stop.index,
      }

      const list = byStationId.get(stop.station_group_id) ?? []
      list.push(entry)
      byStationId.set(stop.station_group_id, list)
    }
  }

  for (const [id, list] of byStationId) {
    list.sort((a, b) => a.lineName.localeCompare(b.lineName, 'de'))
    byStationId.set(id, list)
  }

  return byStationId
}

function pickThroughEntry(group: LineDirectionAtStop[]): LineDirectionAtStop | null {
  return group.find((entry) => entry.prevStop && entry.nextStop) ?? null
}

function pickDistinctNeighbors(group: LineDirectionAtStop[]): {
  prevStop: string | null
  nextStop: string | null
} {
  const through = pickThroughEntry(group)
  if (through) {
    return { prevStop: through.prevStop, nextStop: through.nextStop }
  }

  const prevStops = [...new Set(group.map((e) => e.prevStop).filter(Boolean))] as string[]
  const nextStops = [...new Set(group.map((e) => e.nextStop).filter(Boolean))] as string[]
  const all = [...new Set([...prevStops, ...nextStops])]

  if (all.length >= 2) {
    return { prevStop: all[0], nextStop: all[1] }
  }
  if (all.length === 1) {
    return { prevStop: prevStops[0] ?? null, nextStop: nextStops[0] ?? null }
  }

  return { prevStop: null, nextStop: null }
}

function mergeLineEntriesAtStation(group: LineDirectionAtStop[]): LineDirectionAtStop {
  const sorted = [...group].sort((a, b) => a.stopIndex - b.stopIndex)
  const base = sorted[0]
  const { prevStop, nextStop } = pickDistinctNeighbors(group)

  return {
    ...base,
    prevStop,
    nextStop,
    prevInitial: stopInitial(prevStop ?? undefined),
    nextInitial: stopInitial(nextStop ?? undefined),
    stopIndex: Math.min(...group.map((entry) => entry.stopIndex)),
  }
}

/** Pro Linie nur ein Eintrag — Nachbarn aus allen Halte-Indizes zusammenführen. */
export function dedupeLineDirections(entries: LineDirectionAtStop[]): LineDirectionAtStop[] {
  if (entries.length <= 1) return entries

  const byLine = new Map<number, LineDirectionAtStop[]>()
  for (const entry of entries) {
    const list = byLine.get(entry.lineId) ?? []
    list.push(entry)
    byLine.set(entry.lineId, list)
  }

  const result: LineDirectionAtStop[] = []
  for (const group of byLine.values()) {
    result.push(group.length === 1 ? group[0] : mergeLineEntriesAtStation(group))
  }

  result.sort((a, b) => a.lineName.localeCompare(b.lineName, 'de'))
  return result
}
