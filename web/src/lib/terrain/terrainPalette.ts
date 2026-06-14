import type { TerrainSlopeCode, TerrainSurfaceCode } from '../../types/terrain'

/** Satelliten-ähnliche, kräftige Farben (0–1 RGB). */
const SURFACE_RGB: Record<TerrainSurfaceCode, [number, number, number]> = {
  W: [0.11, 0.52, 0.86],
  L: [0.34, 0.74, 0.28],
  H: [0.50, 0.78, 0.32],
  M: [0.58, 0.48, 0.36],
  C: [0.82, 0.72, 0.50],
  N: [0.28, 0.46, 0.30],
}

const ROCK_RGB: [number, number, number] = [0.72, 0.64, 0.52]
const SNOW_RGB: [number, number, number] = [0.92, 0.94, 0.96]

const SLOPE_BLEND: Record<TerrainSlopeCode, number> = {
  F: 0,
  G: 0.06,
  S: 0.38,
  X: 0.62,
  N: 0,
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function applyHillshade(
  rgb: [number, number, number],
  hillshade: number,
  height?: number,
): [number, number, number] {
  const shade = clamp01(0.55 + hillshade * 0.45)
  let out: [number, number, number] = [rgb[0] * shade, rgb[1] * shade, rgb[2] * shade]
  if (height != null && height >= 200) {
    const snowT = clamp01((height - 200) / 180)
    out = mixRgb(out, SNOW_RGB, snowT * 0.55)
  }
  return out
}

export function terrainCellColor(
  surface: TerrainSurfaceCode,
  slope: TerrainSlopeCode,
  hillshade = 0,
  height?: number,
): [number, number, number] {
  const base = SURFACE_RGB[surface] ?? SURFACE_RGB.N
  const blend = SLOPE_BLEND[slope] ?? 0
  let rgb = base
  if (blend > 0) {
    rgb = mixRgb(base, ROCK_RGB, blend)
  }
  if (surface === 'M' || surface === 'H') {
    rgb = mixRgb(rgb, ROCK_RGB, 0.12)
  }
  return applyHillshade(rgb, hillshade, height)
}

export function terrainCellColorBytes(
  surface: TerrainSurfaceCode,
  slope: TerrainSlopeCode,
  hillshade = 0,
  height?: number,
): [number, number, number] {
  const [r, g, b] = terrainCellColor(surface, slope, hillshade, height)
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

export const TERRAIN_LEGEND_ITEMS: Array<{ code: TerrainSurfaceCode; label: string; color: string }> = [
  { code: 'W', label: 'Wasser', color: '#1c84db' },
  { code: 'L', label: 'Flachland', color: '#57bb47' },
  { code: 'H', label: 'Hügel', color: '#80c652' },
  { code: 'M', label: 'Berg', color: '#94785c' },
  { code: 'C', label: 'Küste', color: '#d1b880' },
]

export function computeHillshadeFromHeights(
  hLeft: number | false,
  hRight: number | false,
  hUp: number | false,
  hDown: number | false,
): number {
  const vals = [hLeft, hRight, hUp, hDown].filter((v) => v !== false) as number[]
  if (vals.length < 2) return 0.5
  const dx =
    hLeft !== false && hRight !== false ? (hRight as number) - (hLeft as number) : 0
  const dy =
    hUp !== false && hDown !== false ? (hUp as number) - (hDown as number) : 0
  const len = Math.hypot(dx, dy)
  if (len < 0.01) return 0.5
  const nx = -dx / len
  const ny = -dy / len
  const lightX = 0.65
  const lightY = 0.35
  return clamp01(0.5 + (nx * lightX + ny * lightY) * 0.5)
}
