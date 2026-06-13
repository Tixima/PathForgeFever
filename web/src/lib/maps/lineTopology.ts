import type { LineSegment, LineShape } from './types'

export interface RawLineStops {
  lineId: number
  lineName: string
  color: string
  stopIds: number[]
  stopNames: string[]
}

export interface AnalyzedLine {
  id: number
  name: string
  color: string
  shape: LineShape
  fullStationIds: number[]
  layoutStationIds: number[]
  segments: LineSegment[]
  stopCount: number
  turnaroundStationId?: number
  /** Wendepunkt der Hinfahrt (bei Teilstrecken-Rückfahrt: tiefster Punkt vor Rücklauf) */
  apexStationId?: number
  startStationId: number
  endStationId: number
}

const REVERSE_MATCH_RATIO = 0.7
const FULL_RETURN_RATIO = 0.85

function isReverseReturn(outCore: number[], inCore: number[]): boolean {
  if (inCore.length < 2) return false
  const reversed = [...outCore].reverse()
  let matched = 0
  let j = 0
  for (let i = 0; i < reversed.length && j < inCore.length; i++) {
    if (reversed[i] === inCore[j]) {
      matched++
      j++
    }
  }
  return matched >= Math.max(2, Math.floor(inCore.length * REVERSE_MATCH_RATIO))
}

function detectPingPongPivot(stopIds: number[]): number | null {
  const candidates: Array<{ pivot: number; outCoreLen: number; inCoreLen: number; ratio: number }> =
    []

  for (let pivot = stopIds.length - 1; pivot >= 1; pivot--) {
    const outbound = stopIds.slice(0, pivot + 1)
    const inbound = stopIds.slice(pivot)
    if (inbound[0] !== outbound[outbound.length - 1]) continue

    const outCore = outbound.slice(0, -1)
    const inCore = inbound.slice(1)
    if (!isReverseReturn(outCore, inCore)) continue

    candidates.push({
      pivot,
      outCoreLen: outCore.length,
      inCoreLen: inCore.length,
      ratio: outCore.length > 0 ? inCore.length / outCore.length : 0,
    })
  }

  if (candidates.length === 0) return null

  const closed = stopIds[0] === stopIds[stopIds.length - 1]
  const fullReturns = candidates.filter((c) => c.ratio >= FULL_RETURN_RATIO)

  if (closed && fullReturns.length > 0) {
    fullReturns.sort((a, b) => b.outCoreLen - a.outCoreLen || b.ratio - a.ratio)
    return fullReturns[0].pivot
  }

  if (closed) {
    candidates.sort((a, b) => b.ratio - a.ratio || b.outCoreLen - a.outCoreLen)
    return candidates[0].pivot
  }

  candidates.sort((a, b) => b.ratio - a.ratio || b.outCoreLen - a.outCoreLen)
  return candidates[0].pivot
}

function firstVisitOrder(stopIds: number[]): number[] {
  const seen = new Set<number>()
  const result: number[] = []
  for (const id of stopIds) {
    if (!seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  return result
}

function analyzeClosedLine(stopIds: number[]): Omit<AnalyzedLine, 'id' | 'name' | 'color'> | null {
  const stopCount = stopIds.length
  const body = stopIds.slice(0, -1)
  const uniqueInBody = new Set(body).size

  if (uniqueInBody === body.length) {
    const loopIds = [...body, stopIds[0]]
    return {
      shape: 'ring',
      fullStationIds: stopIds,
      layoutStationIds: loopIds,
      segments: [{ stationIds: loopIds, direction: 'loop' }],
      stopCount,
      startStationId: stopIds[0],
      endStationId: stopIds[0],
    }
  }

  const pivot = detectPingPongPivot(stopIds)
  if (pivot === null) {
    const layoutIds = firstVisitOrder(stopIds)
    return {
      shape: 'linear',
      fullStationIds: stopIds,
      layoutStationIds: layoutIds,
      segments: [{ stationIds: layoutIds, direction: 'outbound' }],
      stopCount,
      startStationId: stopIds[0],
      endStationId: stopIds[stopCount - 1],
    }
  }

  const outbound = stopIds.slice(0, pivot + 1)
  const inbound = stopIds.slice(pivot)
  const outCore = outbound.slice(0, -1)
  const inCore = inbound.slice(1)
  const turnaroundStationId = stopIds[pivot]
  const returnRatio = outCore.length > 0 ? inCore.length / outCore.length : 0

  if (returnRatio >= FULL_RETURN_RATIO) {
    return {
      shape: 'pingpong',
      fullStationIds: stopIds,
      layoutStationIds: firstVisitOrder(outbound),
      segments: [
        { stationIds: outbound, direction: 'outbound' },
        { stationIds: inbound, direction: 'inbound' },
      ],
      stopCount,
      turnaroundStationId,
      startStationId: stopIds[0],
      endStationId: stopIds[stopCount - 1],
    }
  }

  return {
    shape: 'partial_return',
    fullStationIds: stopIds,
    layoutStationIds: firstVisitOrder(outbound),
    segments: [
      { stationIds: outbound, direction: 'outbound' },
      { stationIds: inbound, direction: 'return' },
    ],
    stopCount,
    turnaroundStationId,
    apexStationId: turnaroundStationId,
    startStationId: stopIds[0],
    endStationId: stopIds[stopCount - 1],
  }
}

export function analyzeLine(raw: RawLineStops): AnalyzedLine {
  const { stopIds } = raw
  const stopCount = stopIds.length

  const base = { id: raw.lineId, name: raw.lineName, color: raw.color }

  if (stopCount < 2) {
    return {
      ...base,
      shape: 'linear',
      fullStationIds: stopIds,
      layoutStationIds: stopIds,
      segments: [{ stationIds: stopIds, direction: 'outbound' }],
      stopCount,
      startStationId: stopIds[0],
      endStationId: stopIds[stopIds.length - 1],
    }
  }

  if (stopIds[0] === stopIds[stopCount - 1]) {
    const closed = analyzeClosedLine(stopIds)
    if (closed) return { ...base, ...closed }
  }

  const pivot = detectPingPongPivot(stopIds)
  if (pivot !== null) {
    const outbound = stopIds.slice(0, pivot + 1)
    const inbound = stopIds.slice(pivot)
    const turnaroundStationId = stopIds[pivot]

    return {
      ...base,
      shape: 'pingpong',
      fullStationIds: stopIds,
      layoutStationIds: firstVisitOrder(outbound),
      segments: [
        { stationIds: outbound, direction: 'outbound' },
        { stationIds: inbound, direction: 'inbound' },
      ],
      stopCount,
      turnaroundStationId,
      startStationId: stopIds[0],
      endStationId: stopIds[stopCount - 1],
    }
  }

  const layoutIds = firstVisitOrder(stopIds)
  return {
    ...base,
    shape: 'linear',
    fullStationIds: stopIds,
    layoutStationIds: layoutIds,
    segments: [{ stationIds: layoutIds, direction: 'outbound' }],
    stopCount,
    startStationId: stopIds[0],
    endStationId: stopIds[stopCount - 1],
  }
}

export function shapeLabel(shape: LineShape): string {
  switch (shape) {
    case 'ring':
      return 'Ring'
    case 'pingpong':
      return 'Hin & Zurück'
    case 'partial_return':
      return 'Teilstrecken-Rückfahrt'
    default:
      return 'Strecke'
  }
}
