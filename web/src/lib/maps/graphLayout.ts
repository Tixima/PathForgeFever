import type { LayoutResult, LayoutStation, MapLine, MapStation } from './types'

const PAD = 80
const ITERATIONS = 150

interface SimNode {
  station: MapStation
  x: number
  y: number
  vx: number
  vy: number
}

function buildEdges(lines: MapLine[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  for (const line of lines) {
    for (let i = 0; i < line.layoutStationIds.length - 1; i++) {
      pairs.push([line.layoutStationIds[i], line.layoutStationIds[i + 1]])
    }
  }
  return pairs
}

export function buildTopologyGraphLayout(
  stations: MapStation[],
  lines: MapLine[],
): LayoutResult {
  const n = stations.length
  const VIEW_W = Math.max(1200, n * 45)
  const VIEW_H = Math.max(800, n * 35)

  if (stations.length === 0) {
    return { stations: [], viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, width: VIEW_W, height: VIEW_H }
  }

  const edges = buildEdges(lines)
  const centerX = VIEW_W / 2
  const centerY = VIEW_H / 2
  const radius = Math.min(VIEW_W, VIEW_H) / 2 - PAD

  const nodes: SimNode[] = stations.map((station, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2
    return {
      station,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    }
  })

  const byId = new Map(nodes.map((node) => [node.station.id, node]))

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const alpha = 1 - iter / ITERATIONS

    for (const node of nodes) {
      node.vx = 0
      node.vy = 0
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x
        const dy = nodes[j].y - nodes[i].y
        const dist = Math.max(Math.hypot(dx, dy), 1)
        const repulse = (12000 / (dist * dist)) * alpha
        nodes[i].vx -= (dx / dist) * repulse
        nodes[i].vy -= (dy / dist) * repulse
        nodes[j].vx += (dx / dist) * repulse
        nodes[j].vy += (dy / dist) * repulse
      }
    }

    for (const [fromId, toId] of edges) {
      const a = byId.get(fromId)
      const b = byId.get(toId)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.max(Math.hypot(dx, dy), 1)
      const target = 160
      const attract = ((dist - target) / dist) * 0.1 * alpha
      a.vx += dx * attract
      a.vy += dy * attract
      b.vx -= dx * attract
      b.vy -= dy * attract
    }

    for (const node of nodes) {
      const dx = node.x - centerX
      const dy = node.y - centerY
      node.vx -= dx * 0.001 * alpha
      node.vy -= dy * 0.001 * alpha
    }

    for (const node of nodes) {
      node.x = Math.max(PAD, Math.min(VIEW_W - PAD, node.x + node.vx))
      node.y = Math.max(PAD, Math.min(VIEW_H - PAD, node.y + node.vy))
    }
  }

  const layoutStations: LayoutStation[] = nodes.map((n) => ({
    ...n.station,
    x: n.x,
    y: n.y,
  }))

  return {
    stations: layoutStations,
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    width: VIEW_W,
    height: VIEW_H,
  }
}
