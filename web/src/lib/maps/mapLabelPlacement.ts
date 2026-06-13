export type MapLabelAnchor = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

export interface MapLabelRequest {
  id: number | string
  x: number
  y: number
  primary: string
  secondary?: string
  priority: number
  markerRadius: number
  forceVisible?: boolean
}

export interface PlacedMapLabel extends MapLabelRequest {
  anchor: MapLabelAnchor
  labelX: number
  labelY: number
  textAnchor: 'start' | 'middle' | 'end'
  visible: boolean
}

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

const CHAR_WIDTH = 6.4
const LINE_HEIGHT = 13
const LABEL_PAD = 5
const LABEL_GAP = 6

const ANCHOR_DIRS: Record<MapLabelAnchor, { dx: number; dy: number; textAnchor: 'start' | 'middle' | 'end' }> = {
  n: { dx: 0, dy: -1, textAnchor: 'middle' },
  ne: { dx: 0.85, dy: -0.85, textAnchor: 'start' },
  e: { dx: 1, dy: 0, textAnchor: 'start' },
  se: { dx: 0.85, dy: 0.85, textAnchor: 'start' },
  s: { dx: 0, dy: 1, textAnchor: 'middle' },
  sw: { dx: -0.85, dy: 0.85, textAnchor: 'end' },
  w: { dx: -1, dy: 0, textAnchor: 'end' },
  nw: { dx: -0.85, dy: -0.85, textAnchor: 'end' },
}

function estimateLabelSize(primary: string, secondary?: string): { width: number; height: number } {
  const longest = Math.max(primary.length, secondary?.length ?? 0)
  const lines = secondary ? 2 : 1
  return {
    width: longest * CHAR_WIDTH + LABEL_PAD * 2,
    height: lines * LINE_HEIGHT + LABEL_PAD,
  }
}

function labelRect(
  labelX: number,
  labelY: number,
  width: number,
  height: number,
  textAnchor: 'start' | 'middle' | 'end',
): Rect {
  const left =
    textAnchor === 'middle'
      ? labelX - width / 2
      : textAnchor === 'end'
        ? labelX - width
        : labelX
  return {
    left,
    top: labelY,
    right: left + width,
    bottom: labelY + height,
  }
}

function markerRect(x: number, y: number, radius: number): Rect {
  const pad = radius + 4
  return {
    left: x - pad,
    top: y - pad,
    right: x + pad,
    bottom: y + pad,
  }
}

function overlaps(a: Rect, b: Rect, gap = LABEL_GAP): boolean {
  return !(
    a.right + gap < b.left ||
    a.left - gap > b.right ||
    a.bottom + gap < b.top ||
    a.top - gap > b.bottom
  )
}

function anchorOrder(x: number, y: number, centerX: number, centerY: number): MapLabelAnchor[] {
  const dx = x - centerX
  const dy = y - centerY
  if (Math.abs(dx) > Math.abs(dy) * 1.2) {
    return dx > 0
      ? ['w', 'nw', 'sw', 'n', 's', 'ne', 'se', 'e']
      : ['e', 'ne', 'se', 'n', 's', 'nw', 'sw', 'w']
  }
  if (Math.abs(dy) > Math.abs(dx) * 1.2) {
    return dy > 0
      ? ['n', 'nw', 'ne', 'w', 'e', 'sw', 'se', 's']
      : ['s', 'sw', 'se', 'w', 'e', 'nw', 'ne', 'n']
  }
  if (dx >= 0 && dy <= 0) return ['sw', 'w', 's', 'nw', 'se', 'n', 'ne', 'e']
  if (dx >= 0 && dy > 0) return ['nw', 'w', 'n', 'sw', 'ne', 's', 'se', 'e']
  if (dx < 0 && dy <= 0) return ['se', 'e', 's', 'ne', 'sw', 'n', 'nw', 'w']
  return ['ne', 'e', 'n', 'se', 'nw', 's', 'sw', 'w']
}

function placeAtAnchor(
  request: MapLabelRequest,
  anchor: MapLabelAnchor,
  size: { width: number; height: number },
  distanceScale = 1,
): Pick<PlacedMapLabel, 'anchor' | 'labelX' | 'labelY' | 'textAnchor'> {
  const dir = ANCHOR_DIRS[anchor]
  const distance = (request.markerRadius + 12) * distanceScale
  const labelX = request.x + dir.dx * distance
  const labelY = request.y + dir.dy * distance - (dir.dy < 0 ? size.height * 0.12 : 0)
  return { anchor, labelX, labelY, textAnchor: dir.textAnchor }
}

function tryPlaceLabel(
  request: MapLabelRequest,
  order: MapLabelAnchor[],
  occupied: Rect[],
  marker: Rect,
): PlacedMapLabel | null {
  const size = estimateLabelSize(request.primary, request.secondary)

  for (const distanceScale of [1, 1.25, 1.5]) {
    let best: PlacedMapLabel | null = null
    let bestScore = Number.POSITIVE_INFINITY

    for (const anchor of order) {
      const candidate = placeAtAnchor(request, anchor, size, distanceScale)
      const rect = labelRect(candidate.labelX, candidate.labelY, size.width, size.height, candidate.textAnchor)
      if (overlaps(rect, marker, 2) || occupied.some((box) => overlaps(rect, box))) continue

      const score = Math.hypot(candidate.labelX - request.x, candidate.labelY - request.y)
      if (score < bestScore) {
        bestScore = score
        best = {
          ...request,
          ...candidate,
          visible: true,
        }
      }
    }

    if (best) return best
  }

  return null
}

export function placeMapLabels(
  requests: MapLabelRequest[],
  bounds?: { width: number; height: number },
): PlacedMapLabel[] {
  if (requests.length === 0) return []

  const centerX =
    requests.reduce((sum, item) => sum + item.x, 0) / requests.length
  const centerY =
    requests.reduce((sum, item) => sum + item.y, 0) / requests.length

  const sorted = [...requests].sort((a, b) => b.priority - a.priority)
  const occupied: Rect[] = []

  if (bounds) {
    occupied.push({
      left: bounds.width - 72,
      top: 0,
      right: bounds.width,
      bottom: 72,
    })
  }

  const placed: PlacedMapLabel[] = []

  for (const request of sorted) {
    const order = anchorOrder(request.x, request.y, centerX, centerY)
    const marker = markerRect(request.x, request.y, request.markerRadius)
    const best = tryPlaceLabel(request, order, occupied, marker)

    if (best) {
      const size = estimateLabelSize(best.primary, best.secondary)
      occupied.push(
        labelRect(best.labelX, best.labelY, size.width, size.height, best.textAnchor),
      )
      occupied.push(marker)
      placed.push(best)
      continue
    }

    const fallbackAnchor = order[0] ?? 'n'
    const fallbackSize = estimateLabelSize(request.primary, request.secondary)
    const fallback = placeAtAnchor(request, fallbackAnchor, fallbackSize, 1.35)
    placed.push({
      ...request,
      ...fallback,
      visible: Boolean(request.forceVisible),
    })

    if (request.forceVisible) {
      occupied.push(
        labelRect(fallback.labelX, fallback.labelY, fallbackSize.width, fallbackSize.height, fallback.textAnchor),
      )
      occupied.push(marker)
    }
  }

  return placed
}
