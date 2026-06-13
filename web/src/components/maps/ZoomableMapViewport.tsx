import { useEffect, type ReactNode } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { useMapZoomPan } from '../../hooks/useMapZoomPan'

interface ZoomableMapViewportProps {
  contentWidth: number
  contentHeight: number
  viewBox: string
  children: ReactNode
  className?: string
}

export function ZoomableMapViewport({
  contentWidth,
  contentHeight,
  viewBox,
  children,
  className = '',
}: ZoomableMapViewportProps) {
  const {
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
    resetView,
    zoomPercent,
  } = useMapZoomPan({ contentWidth, contentHeight })

  useEffect(() => {
    fitToView()
    const observer = new ResizeObserver(() => fitToView())
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [fitToView, contentWidth, contentHeight])

  return (
    <div className={`zoom-map ${className}`}>
      <div className="zoom-map__toolbar">
        <button type="button" onClick={zoomIn} title="Vergrößern" aria-label="Vergrößern">
          <Plus size={16} />
        </button>
        <span className="zoom-map__level">{zoomPercent}%</span>
        <button type="button" onClick={zoomOut} title="Verkleinern" aria-label="Verkleinern">
          <Minus size={16} />
        </button>
        <button type="button" onClick={resetView} title="Ansicht zurücksetzen" aria-label="Ansicht zurücksetzen">
          <Maximize2 size={16} />
        </button>
        <span className="zoom-map__hint">Scrollen zum Zoomen · Ziehen zum Verschieben</span>
      </div>

      <div
        ref={containerRef}
        className={`zoom-map__viewport ${isPanning ? 'is-panning' : ''} ${initialized ? 'is-ready' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <svg
          viewBox={viewBox}
          className="zoom-map__svg"
          style={{
            width: contentWidth,
            height: contentHeight,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
        >
          {children}
        </svg>
      </div>
    </div>
  )
}
