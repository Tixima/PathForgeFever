import { useCallback, useEffect, useRef, useState } from 'react'

interface Transform {
  x: number
  y: number
  scale: number
}

interface UseMapZoomPanOptions {
  contentWidth: number
  contentHeight: number
  minScale?: number
  maxScale?: number
}

export function useMapZoomPan({
  contentWidth,
  contentHeight,
  minScale = 0.15,
  maxScale = 3,
}: UseMapZoomPanOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 })
  const [initialized, setInitialized] = useState(false)

  const fitToView = useCallback(() => {
    const el = containerRef.current
    if (!el || contentWidth <= 0 || contentHeight <= 0) return

    const rect = el.getBoundingClientRect()
    const padding = 24
    const scaleX = (rect.width - padding * 2) / contentWidth
    const scaleY = (rect.height - padding * 2) / contentHeight
    const scale = Math.min(scaleX, scaleY, 1)

    setTransform({
      x: (rect.width - contentWidth * scale) / 2,
      y: (rect.height - contentHeight * scale) / 2,
      scale,
    })
    setInitialized(true)
  }, [contentWidth, contentHeight])

  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const el = containerRef.current
      if (!el) return

      const rect = el.getBoundingClientRect()
      const mx = clientX - rect.left
      const my = clientY - rect.top

      setTransform((prev) => {
        const newScale = Math.min(maxScale, Math.max(minScale, prev.scale * factor))
        const ratio = newScale / prev.scale
        return {
          scale: newScale,
          x: mx - (mx - prev.x) * ratio,
          y: my - (my - prev.y) * ratio,
        }
      })
    },
    [minScale, maxScale],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      zoomAt(e.clientX, e.clientY, factor)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      const target = e.target as Element
      if (target.closest('.netmap__station-group, .netmap__line-hit, .netmap__edge-hit')) return

      setIsPanning(true)
      panStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [transform.x, transform.y],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanning) return
      const dx = e.clientX - panStart.current.x
      const dy = e.clientY - panStart.current.y
      setTransform((prev) => ({
        ...prev,
        x: panStart.current.tx + dx,
        y: panStart.current.ty + dy,
      }))
    },
    [isPanning],
  )

  const handlePointerUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  const zoomIn = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.25)
  }, [zoomAt])

  const zoomOut = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.8)
  }, [zoomAt])

  return {
    containerRef,
    transform,
    isPanning,
    initialized,
    fitToView,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    zoomIn,
    zoomOut,
    resetView: fitToView,
    zoomPercent: Math.round(transform.scale * 100),
  }
}
