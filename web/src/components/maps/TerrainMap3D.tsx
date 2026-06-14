import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { TerrainExport } from '../../types/terrain'
import {
  buildTerrainScene3DData,
  overlayExtentFromBounds,
  overlayLineRadius,
  overlayNodeRadius,
} from '../../lib/terrain/buildTerrainScene3d'
import { scenePointFromGame } from '../../lib/terrain/gameCoordinates3d'
import type { GeoBounds } from '../../lib/maps/geoProjection'
import type { Map3DOverlay, Map3DNode } from '../../lib/maps/map3dOverlay'
import { TERRAIN_LEGEND_ITEMS } from '../../lib/terrain/terrainPalette'

interface TerrainMap3DProps {
  terrain: TerrainExport
  overlay?: Map3DOverlay
  stationBounds?: { minX: number; maxX: number; minY: number; maxY: number }
  className?: string
}

function hexToRgb(hex: string): THREE.Color {
  const c = new THREE.Color()
  if (hex.startsWith('rgba')) {
    const m = hex.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (m) {
      c.setRGB(Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255)
      return c
    }
  }
  c.set(hex)
  return c
}

function createLabelSprite(text: string, accent = '#ffffff', extent = 10_000): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const fontSize = 13
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`
  const metrics = ctx.measureText(text)
  const padX = 6
  const padY = 4
  canvas.width = Math.ceil(metrics.width + padX * 2)
  canvas.height = fontSize + padY * 2

  ctx.fillStyle = 'rgba(8, 12, 20, 0.82)'
  const r = 5
  const w = canvas.width
  const h = canvas.height
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(w - r, 0)
  ctx.quadraticCurveTo(w, 0, w, r)
  ctx.lineTo(w, h - r)
  ctx.quadraticCurveTo(w, h, w - r, h)
  ctx.lineTo(r, h)
  ctx.quadraticCurveTo(0, h, 0, h - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.fillText(text, padX, h / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(material)
  const base = extent * 0.009
  sprite.scale.set(base, (canvas.height / canvas.width) * base, 1)
  return sprite
}

function addThickLine(
  group: THREE.Group,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  color: THREE.Color,
  radius: number,
  opacity = 1,
) {
  const start = new THREE.Vector3(x1, y1, z1)
  const end = new THREE.Vector3(x2, y2, z2)
  const dir = new THREE.Vector3().subVectors(end, start)
  const len = dir.length()
  if (len < radius * 0.5) return

  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
  const geometry = new THREE.CylinderGeometry(radius, radius, len, 10, 1)
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.copy(mid)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  group.add(mesh)
}

function addStationMarker(group: THREE.Group, node: Map3DNode, extent: number, crop: GeoBounds) {
  const [x, y, z] = scenePointFromGame(node.gameX, node.gameY, node.height, crop)
  const color = hexToRgb(node.color)
  const radius = overlayNodeRadius(extent, node.kind)

  const pinHeight = radius * 1.5
  addThickLine(group, x, y, z - pinHeight * 0.4, x, y, z, color, radius * 0.18, 1)

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 18, 16),
    new THREE.MeshBasicMaterial({ color }),
  )
  sphere.position.set(x, y, z)
  group.add(sphere)

  const ringOuter = radius * 1.35
  const ringInner = radius * 1.05
  if (node.ring) {
    const ringColor =
      node.kind === 'transfer' ? new THREE.Color('#fb923c') : new THREE.Color('#ffffff')
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ringInner, ringOuter, 28),
      new THREE.MeshBasicMaterial({
        color: ringColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    )
    ring.position.set(x, y + radius * 0.15, z)
    ring.rotation.x = -Math.PI / 2
    group.add(ring)
  }

  if (node.kind === 'transfer') {
    const hubDisc = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 1.8, 24),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#fb923c'),
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    )
    hubDisc.position.set(x, y + radius * 0.2, z)
    hubDisc.rotation.x = -Math.PI / 2
    group.add(hubDisc)
  }

  if (node.label) {
    const accent =
      node.kind === 'transfer'
        ? '#fb923c'
        : node.kind === 'start' || node.kind === 'end'
          ? '#22d3ee'
          : '#ffffff'
    const label = createLabelSprite(node.label, accent, extent)
    label.position.set(x, y + radius + extent * 0.018, z)
    group.add(label)
  }
}

function disposeOverlayGroup(group: THREE.Group) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
      else obj.material.dispose()
    }
    if (obj instanceof THREE.Sprite) {
      obj.material.map?.dispose()
      obj.material.dispose()
    }
  })
  group.clear()
}

function populateOverlayGroup(
  group: THREE.Group,
  extent: number,
  crop: GeoBounds,
  data?: Map3DOverlay,
) {
  disposeOverlayGroup(group)
  if (!data) return

  for (const edge of data.edges ?? []) {
    const [x1, y1, z1] = scenePointFromGame(edge.fromGameX, edge.fromGameY, edge.fromHeight, crop)
    const [x2, y2, z2] = scenePointFromGame(edge.toGameX, edge.toGameY, edge.toHeight, crop)
    addThickLine(
      group,
      x1,
      y1,
      z1,
      x2,
      y2,
      z2,
      hexToRgb(edge.color),
      overlayLineRadius(extent, (edge.width ?? 3) / 3),
      edge.opacity ?? 1,
    )
  }

  for (const poly of data.polylines ?? []) {
    for (let i = 0; i < poly.points.length - 1; i++) {
      const a = poly.points[i]
      const b = poly.points[i + 1]
      const [x1, y1, z1] = scenePointFromGame(a.gameX, a.gameY, a.height, crop)
      const [x2, y2, z2] = scenePointFromGame(b.gameX, b.gameY, b.height, crop)
      addThickLine(
        group,
        x1,
        y1,
        z1,
        x2,
        y2,
        z2,
        hexToRgb(poly.color),
        overlayLineRadius(extent, (poly.width ?? 3) / 3),
        poly.opacity ?? 1,
      )
    }
  }

  for (const node of data.nodes ?? []) {
    addStationMarker(group, node, extent, crop)
  }
}

export function TerrainMap3D({ terrain, overlay, stationBounds, className = '' }: TerrainMap3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayGroupRef = useRef<THREE.Group | null>(null)
  const sceneExtentRef = useRef<number>(10_000)
  const sceneCropRef = useRef<GeoBounds | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const sceneData = buildTerrainScene3DData(terrain, stationBounds)
    const overlayExtent = overlayExtentFromBounds(stationBounds) || sceneData.horizontalExtent
    sceneExtentRef.current = overlayExtent
    sceneCropRef.current = sceneData.crop

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#1e3a52')

    const camera = new THREE.PerspectiveCamera(45, 1, 0.0001, 100)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI / 2.02

    const sceneRoot = new THREE.Group()
    const norm = 1 / sceneData.horizontalExtent
    sceneRoot.scale.set(norm, norm, norm)
    scene.add(sceneRoot)

    const terrainGeometry = new THREE.BufferGeometry()
    terrainGeometry.setAttribute('position', new THREE.BufferAttribute(sceneData.positions, 3))
    terrainGeometry.setAttribute('uv', new THREE.BufferAttribute(sceneData.uvs, 2))
    terrainGeometry.setIndex(new THREE.BufferAttribute(sceneData.indices, 1))
    terrainGeometry.computeVertexNormals()

    const texture = new THREE.TextureLoader().load(sceneData.textureUrl)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter

    const terrainMaterial = new THREE.MeshBasicMaterial({ map: texture })
    sceneRoot.add(new THREE.Mesh(terrainGeometry, terrainMaterial))

    const overlayGroup = new THREE.Group()
    overlayGroupRef.current = overlayGroup
    sceneRoot.add(overlayGroup)
    populateOverlayGroup(overlayGroup, overlayExtent, sceneData.crop, overlay)

    const [cx, cy, cz] = sceneData.center
    const tcx = cx * norm
    const tcy = cy * norm
    const tcz = cz * norm

    controls.minDistance = 0.15
    controls.maxDistance = 3.5
    controls.target.set(tcx, tcy, tcz)
    camera.position.set(tcx + 0.04, tcy + 0.88, tcz + 0.04)
    controls.update()

    let frameId = 0
    const animate = () => {
      frameId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w <= 0 || h <= 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }

    const resizeObserver = new ResizeObserver(onResize)
    resizeObserver.observe(container)
    onResize()

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      controls.dispose()
      disposeOverlayGroup(overlayGroup)
      overlayGroupRef.current = null
      texture.dispose()
      terrainGeometry.dispose()
      terrainMaterial.dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [terrain, stationBounds])

  useEffect(() => {
    const group = overlayGroupRef.current
    const crop = sceneCropRef.current
    if (!group || !crop) return
    populateOverlayGroup(group, sceneExtentRef.current, crop, overlay)
  }, [overlay])

  return (
    <div className={`terrain-map-3d ${className}`}>
      <div ref={containerRef} className="terrain-map-3d__canvas" role="img" aria-label="3D-Geländekarte" />
      <div className="terrain-map-3d__legend">
        {TERRAIN_LEGEND_ITEMS.map((item) => (
          <span key={item.code} className="terrain-map-3d__legend-item">
            <i style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
        <span className="terrain-map-3d__legend-hint">Drehen für Geländeansicht · Labels nur bei Umsteigern</span>
      </div>
      <p className="terrain-map-3d__hint">
        Draufsicht = wie 2D · Ziehen zum Drehen · Scrollen zum Zoomen · Orange = Umstieg
      </p>
    </div>
  )
}
