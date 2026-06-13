import type { LayoutResult, LayoutStation, MapLine, MapStation } from './types'

const PAD_X = 120
const PAD_Y = 100
const COL_SPACING = 150
const TRACK_GAP = 210

export interface SchematicLayoutResult extends LayoutResult {
  lineTracks: Map<number, number>
  /** Pro Linie: stationId → lokale X-Position auf der Spur */
  lineLocalX: Map<number, Map<number, number>>
}

export interface SegmentPath {
  lineId: number
  direction: 'outbound' | 'inbound' | 'loop'
  path: string
  stationIds: number[]
}

export interface StationConnector {
  lineId: number
  stationId: number
  trackX: number
  trackY: number
  nodeX: number
  nodeY: number
}

function assignLineTracks(lines: MapLine[]): Map<number, number> {
  const sorted = [...lines].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const tracks = new Map<number, number>()
  sorted.forEach((line, i) => tracks.set(line.id, i))
  return tracks
}

function getTrackY(track: number): number {
  return PAD_Y + track * TRACK_GAP
}

/** Jede Linie bekommt eigene Spalten 0…n — keine globale Reihenfolge über Linien hinweg. */
function assignLineLocalX(lines: MapLine[]): Map<number, Map<number, number>> {
  const result = new Map<number, Map<number, number>>()

  for (const line of lines) {
    const local = new Map<number, number>()
    line.layoutStationIds.forEach((id, index) => {
      local.set(id, PAD_X + index * COL_SPACING)
    })
    result.set(line.id, local)
  }

  return result
}

function getActiveStationIds(lines: MapLine[]): Set<number> {
  const ids = new Set<number>()
  for (const line of lines) {
    for (const id of line.layoutStationIds) ids.add(id)
  }
  return ids
}

function buildMergedStationPositions(
  stations: MapStation[],
  lines: MapLine[],
  lineTracks: Map<number, number>,
  lineLocalX: Map<number, Map<number, number>>,
): { positions: LayoutStation[]; width: number; height: number } {
  const activeIds = getActiveStationIds(lines)
  const activeStations = stations.filter((s) => activeIds.has(s.id))

  const maxCols = Math.max(1, ...lines.map((l) => l.layoutStationIds.length))
  const width = PAD_X * 2 + maxCols * COL_SPACING
  const height = PAD_Y * 2 + Math.max(lines.length - 1, 0) * TRACK_GAP + TRACK_GAP

  const positions = activeStations.map((station) => {
    const xs: number[] = []
    const ys: number[] = []

    for (const line of lines) {
      const local = lineLocalX.get(line.id)
      const x = local?.get(station.id)
      if (x === undefined) continue

      xs.push(x)
      const track = lineTracks.get(line.id)
      if (track !== undefined) ys.push(getTrackY(track))
    }

    const x = xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : PAD_X
    const y = ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length : PAD_Y

    return { ...station, x, y }
  })

  return { positions, width, height }
}

function buildHorizontalPath(
  lineId: number,
  stationIds: number[],
  lineLocalX: Map<number, Map<number, number>>,
  trackY: number,
  yOffset: number,
): string {
  const local = lineLocalX.get(lineId)
  if (!local) return ''

  const pts = stationIds
    .map((id) => {
      const x = local.get(id)
      return x !== undefined ? { x, y: trackY + yOffset } : null
    })
    .filter((p): p is { x: number; y: number } => Boolean(p))

  if (pts.length < 2) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

/** Echter Netzplan: eine durchgezogene Linie pro Strecke (keine Rückfahrt). */
export function buildLineSegmentPaths(
  lines: MapLine[],
  lineLocalX: Map<number, Map<number, number>>,
  lineTracks: Map<number, number>,
): SegmentPath[] {
  const paths: SegmentPath[] = []

  for (const line of lines) {
    const track = lineTracks.get(line.id) ?? 0
    const trackY = getTrackY(track)
    const direction = line.shape === 'ring' ? 'loop' : 'outbound'
    const path = buildHorizontalPath(line.id, line.layoutStationIds, lineLocalX, trackY, 0)
    if (!path) continue

    paths.push({
      lineId: line.id,
      direction,
      path,
      stationIds: line.layoutStationIds,
    })
  }

  return paths
}

export function buildStationConnectors(
  lines: MapLine[],
  lineLocalX: Map<number, Map<number, number>>,
  lineTracks: Map<number, number>,
  posById: Map<number, { x: number; y: number }>,
): StationConnector[] {
  const connectors: StationConnector[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const local = lineLocalX.get(line.id)
    const track = lineTracks.get(line.id)
    if (!local || track === undefined) continue

    const trackY = getTrackY(track)

    for (const id of line.layoutStationIds) {
      const trackX = local.get(id)
      const node = posById.get(id)
      if (trackX === undefined || !node) continue

      if (Math.abs(trackX - node.x) < 4 && Math.abs(trackY - node.y) < 4) continue

      const key = `${line.id}-${id}`
      if (seen.has(key)) continue
      seen.add(key)

      connectors.push({
        lineId: line.id,
        stationId: id,
        trackX,
        trackY,
        nodeX: node.x,
        nodeY: node.y,
      })
    }
  }

  return connectors
}

export function buildSchematicLayout(
  stations: MapStation[],
  lines: MapLine[],
): SchematicLayoutResult {
  if (stations.length === 0 || lines.length === 0) {
    return {
      stations: [],
      viewBox: '0 0 800 500',
      width: 800,
      height: 500,
      lineTracks: new Map(),
      lineLocalX: new Map(),
    }
  }

  const lineTracks = assignLineTracks(lines)
  const lineLocalX = assignLineLocalX(lines)
  const { positions, width, height } = buildMergedStationPositions(
    stations,
    lines,
    lineTracks,
    lineLocalX,
  )

  return {
    stations: positions,
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    lineTracks,
    lineLocalX,
  }
}

export function getLineTrackY(lineId: number, lineTracks: Map<number, number>): number {
  return getTrackY(lineTracks.get(lineId) ?? 0)
}

export function getLineLocalX(
  lineId: number,
  stationId: number,
  lineLocalX: Map<number, Map<number, number>>,
): number | undefined {
  return lineLocalX.get(lineId)?.get(stationId)
}

export function getLayoutPadding() {
  return { padX: PAD_X, padY: PAD_Y }
}

