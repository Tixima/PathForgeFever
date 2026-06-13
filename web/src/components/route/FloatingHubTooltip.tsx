import { useLayoutEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { HubLinesTooltip } from './HubLinesTooltip'
import type { LineDirectionAtStop } from '../../lib/station/stationLineDirections'

interface FloatingHubTooltipProps {
  anchor: HTMLElement | null
  open: boolean
  stationName: string
  lineDirections: LineDirectionAtStop[]
}

function useAnchorStyle(anchor: HTMLElement | null, open: boolean): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setStyle(null)
      return
    }

    function update() {
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const placeAbove = rect.top > 160

      setStyle({
        position: 'fixed',
        top: placeAbove ? rect.top - 10 : rect.bottom + 10,
        left: rect.left + rect.width / 2,
        transform: placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        zIndex: 10000,
        width: 'max-content',
        maxWidth: 'min(340px, calc(100vw - 24px))',
        pointerEvents: 'none',
      })
    }

    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchor, open])

  return style
}

export function FloatingHubTooltip({ anchor, open, stationName, lineDirections }: FloatingHubTooltipProps) {
  const style = useAnchorStyle(anchor, open)

  if (!open || !style || lineDirections.length === 0) return null

  return createPortal(
    <div className="hub-tooltip-layer" style={style}>
      <HubLinesTooltip stationName={stationName} lineDirections={lineDirections} />
    </div>,
    document.body,
  )
}
