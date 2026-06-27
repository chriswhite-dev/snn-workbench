import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SpikeEntry } from '../../hooks/useSimulation'

interface Props {
  history: SpikeEntry[]
  nodeIds: number[]
  nodeNames?: Record<number, string>
}

const MAX_STEPS = 50
const FONT_SIZE = 9
const CHARS_PER_PX = 5.4
const CELL_H = 14
const CELL_GAP = 2
const ROW_H = CELL_H + CELL_GAP
const PAD_X = 6
const PAD_Y = 4
const MIN_CELL_W = 5

function labelFor(id: number, names?: Record<number, string>): string {
  const name = names?.[id]
  return name ? `${id} (${name})` : String(id)
}

export default function SpikeRaster({ history, nodeIds, nodeNames }: Props) {
  const sortedIds = useMemo(() => [...nodeIds].sort((a, b) => a - b), [nodeIds])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    return () => { roRef.current?.disconnect() }
  }, [])

  // Callback ref so the observer re-attaches if the div mounts after initial render (nNeurons=0 case).
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    ro.observe(el)
    roRef.current = ro
  }, [])

  const nNeurons = sortedIds.length
  const recent = history.slice(-MAX_STEPS)

  const maxLabelLen = useMemo(
    () => sortedIds.reduce((max, id) => Math.max(max, labelFor(id, nodeNames).length), 0),
    [sortedIds, nodeNames]
  )
  const LABEL_W = Math.max(36, Math.ceil(maxLabelLen * CHARS_PER_PX) + 12)
  const availForCells = containerWidth - LABEL_W - PAD_X * 2
  const cellW = containerWidth > 0 ? Math.max(MIN_CELL_W, availForCells / MAX_STEPS) : 9
  const canvasW = Math.max(LABEL_W + MAX_STEPS * cellW + PAD_X * 2, containerWidth || 0)
  const canvasH = PAD_Y + nNeurons * ROW_H + PAD_Y

  // Draw raster onto canvas imperatively — avoids reconciling N×50 SVG <rect> elements.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || nNeurons === 0 || containerWidth === 0) return

    const dpr = window.devicePixelRatio || 1
    const w = Math.round(canvasW)
    const h = Math.round(canvasH)

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = '#111009'
    ctx.fillRect(0, 0, w, h)

    const spikeSet = new Set<string>()
    for (const { timestep, nodes } of recent) {
      for (const n of nodes) spikeSet.add(`${timestep}:${n}`)
    }

    ctx.font = `${FONT_SIZE}px "JetBrains Mono", ui-monospace, monospace`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'alphabetic'

    for (let row = 0; row < nNeurons; row++) {
      const nodeId = sortedIds[row]
      const y = PAD_Y + row * ROW_H

      ctx.fillStyle = '#9e8f7e'
      ctx.fillText(labelFor(nodeId, nodeNames), LABEL_W - 6, y + CELL_H - 3)

      for (let col = 0; col < recent.length; col++) {
        const { timestep } = recent[col]
        ctx.fillStyle = spikeSet.has(`${timestep}:${nodeId}`) ? '#d4622a' : '#272420'
        ctx.fillRect(LABEL_W + PAD_X + col * cellW, y, Math.max(1, cellW - 1), CELL_H)
      }
    }
  }, [history, sortedIds, nodeNames, containerWidth, canvasW, canvasH, nNeurons, cellW, LABEL_W, recent])

  const header = (
    <div className="px-3 py-2 border-b border-border flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span
          className="font-mono text-2xs text-text-muted tracking-widest uppercase"
          title="Each row is one neuron. Each column is one timestep. A filled orange cell means that neuron fired (spiked) at that timestep."
        >
          Spike Raster
        </span>
        <span className="font-mono text-2xs text-text-muted opacity-60">
          rows = neurons · cols = timesteps · orange = spike
        </span>
      </div>
      {recent.length > 0 ? (
        <span className="font-mono text-2xs text-text-muted">
          {nNeurons} neurons · last t={recent[recent.length - 1]?.timestep}
        </span>
      ) : (
        <span className="font-mono text-2xs text-text-muted">step the simulation to see spikes</span>
      )}
    </div>
  )

  if (nNeurons === 0) {
    return (
      <div className="border border-border">
        {header}
        <div className="h-16 flex items-center justify-center bg-surface">
          <span className="font-mono text-xs text-text-muted opacity-20">· · ·</span>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-border">
      {header}
      <div ref={containerRef} className="bg-surface overflow-x-auto">
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>
    </div>
  )
}
