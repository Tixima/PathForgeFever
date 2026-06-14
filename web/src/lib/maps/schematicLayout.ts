import type { LayoutResult, LayoutStation, MapLine, MapStation } from './types'

const PAD_X = 100
const PAD_Y = 88
const TRACK_GAP = 72
const MIN_COL_SPACING = 22
const MAX_COL_SPACING = 96
const MIN_MAP_WIDTH = 920

export interface SchematicLayoutResult extends LayoutResult {
  lineTracks: Map<number, number>
  /** stationId → X (global, alle Linien teilen dieselben Spalten) */
  lineLocalX: Map<number, Map<number, number>>
  globalStationX: Map<number, number>
  colSpacing: number
}

export interface SegmentPath {
  lineId: number
  direction: 'outbound' | 'inbound' | 'loop'
  path: string
  stationIds: number[]
}

export interface LineStopMarker {
  lineId: number
  stationId: number
  x: number
  y: number
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

function getActiveStationIds(lines: MapLine[]): Set<number> {
  const ids = new Set<number>()
  for (const line of lines) {
    for (const id of line.layoutStationIds) ids.add(id)
  }
  return ids
}

/** Gemeinsame X-Spalten — sortiert nach Spiel-X, damit Umsteiger vertikal übereinander liegen. */
function assignGlobalStationX(
  stations: MapStation[],
  lines: MapLine[],
): { globalX: Map<number, number>; colSpacing: number } {
  const activeIds = getActiveStationIds(lines)
  const active = stations.filter((s) => activeIds.has(s.id))
  if (active.length === 0) {
    return { globalX: new Map(), colSpacing: MIN_COL_SPACING }
  }

  const sorted = [...active].sort(
    (a, b) => a.geoX - b.geoX || a.geoY - b.geoY || a.name.localeCompare(b.name, 'de'),
  )

  const count = sorted.length
  const colSpacing = Math.min(
    MAX_COL_SPACING,
    Math.max(MIN_COL_SPACING, (MIN_MAP_WIDTH - PAD_X * 2) / Math.max(count - 1, 1)),
  )

  const globalX = new Map<number, number>()
  sorted.forEach((station, index) => {
    globalX.set(station.id, PAD_X + index * colSpacing)
  })

  return { globalX, colSpacing }
}

function buildLineXLookup(
  lines: MapLine[],
  globalX: Map<number, number>,
): Map<number, Map<number, number>> {
  const result = new Map<number, Map<number, number>>()

  for (const line of lines) {
    const local = new Map<number, number>()
    for (const id of line.layoutStationIds) {
      const x = globalX.get(id)
      if (x !== undefined) local.set(id, x)
    }
    result.set(line.id, local)
  }

  return result
}

function buildMergedStationPositions(
  stations: MapStation[],
  lines: MapLine[],
  lineTracks: Map<number, number>,
  globalX: Map<number, number>,
  colSpacing: number,
): { positions: LayoutStation[]; width: number; height: number } {
  const activeIds = getActiveStationIds(lines)
  const activeStations = stations.filter((s) => activeIds.has(s.id))

  const width = PAD_X * 2 + Math.max(activeStations.length - 1, 0) * colSpacing
  const height = PAD_Y * 2 + Math.max(lines.length - 1, 0) * TRACK_GAP + TRACK_GAP

  const positions = activeStations.map((station) => {
    const x = globalX.get(station.id) ?? PAD_X
    const trackYs: number[] = []

    for (const line of lines) {
      if (!line.layoutStationIds.includes(station.id)) continue
      const track = lineTracks.get(line.id)
      if (track !== undefined) trackYs.push(getTrackY(track))
    }

    const y =
      trackYs.length > 0
        ? trackYs.reduce((sum, value) => sum + value, 0) / trackYs.length
        : PAD_Y

    return { ...station, x, y }
  })

  return { positions, width, height }
}

function buildHorizontalPath(
  lineId: number,
  stationIds: number[],
  lineLocalX: Map<number, Map<number, number>>,
  trackY: number,
): string {
  const local = lineLocalX.get(lineId)
  if (!local) return ''

  const pts = stationIds
    .map((id) => {
      const x = local.get(id)
      return x !== undefined ? { x, y: trackY } : null
    })
    .filter((p): p is { x: number; y: number } => Boolean(p))

  if (pts.length < 2) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

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
    const path = buildHorizontalPath(line.id, line.layoutStationIds, lineLocalX, trackY)
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

export function buildLineStopMarkers(
  lines: MapLine[],
  lineLocalX: Map<number, Map<number, number>>,
  lineTracks: Map<number, number>,
): LineStopMarker[] {
  const markers: LineStopMarker[] = []

  for (const line of lines) {
    const local = lineLocalX.get(line.id)
    const track = lineTracks.get(line.id)
    if (!local || track === undefined) continue

    const trackY = getTrackY(track)
    for (const stationId of line.layoutStationIds) {
      const x = local.get(stationId)
      if (x === undefined) continue
      markers.push({ lineId: line.id, stationId, x, y: trackY })
    }
  }

  return markers
}

/** Nicht mehr nötig — Halte liegen direkt auf der Linie (keine Diagonalen). */
export function buildStationConnectors(): [] {
  return []
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
      globalStationX: new Map(),
      colSpacing: MIN_COL_SPACING,
    }
  }

  const lineTracks = assignLineTracks(lines)
  const { globalX, colSpacing } = assignGlobalStationX(stations, lines)
  const lineLocalX = buildLineXLookup(lines, globalX)
  const { positions, width, height } = buildMergedStationPositions(
    stations,
    lines,
    lineTracks,
    globalX,
    colSpacing,
  )

  return {
    stations: positions,
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    lineTracks,
    lineLocalX,
    globalStationX: globalX,
    colSpacing,
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
