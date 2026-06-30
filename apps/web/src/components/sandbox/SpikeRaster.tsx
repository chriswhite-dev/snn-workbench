import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SpikeEntry } from '../../hooks/useSimulation'

interface Props {
  history: SpikeEntry[]
  nodeIds: number[]
  nodeNames?: Record<number, string>
}

const FONT_SIZE = 9
const CHARS_PER_PX = 5.4
const CELL_H = 14
const CELL_GAP = 2
const ROW_H = CELL_H + CELL_GAP
const PAD_X = 6
const PAD_Y = 4
const MIN_CELL_W = 5
const HEADER_H = 16
const VIEWPORT_STEPS = 50

function labelFor(id: number, names?: Record<number, string>): string {
  const name = names?.[id]
  return name ? `${id} (${name})` : String(id)
}

export default function SpikeRaster({ history, nodeIds, nodeNames }: Props) {
  const sortedIds = useMemo(() => [...nodeIds].sort((a, b) => a - b), [nodeIds])
  const labelsCanvasRef = useRef<HTMLCanvasElement>(null)
  const cellsCanvasRef  = useRef<HTMLCanvasElement>(null)
  const scrollDivRef    = useRef<HTMLDivElement | null>(null)
  const roRef           = useRef<ResizeObserver | null>(null)
  const atRightEdgeRef  = useRef(true)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => { return () => { roRef.current?.disconnect() } }, [])

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    // ResizeObserver fires async; read immediately so the first draw isn't skipped
    const w = el.getBoundingClientRect().width
    if (w > 0) setContainerWidth(w)
    const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    ro.observe(el)
    roRef.current = ro
  }, [])

  const scrollRef = useCallback((el: HTMLDivElement | null) => {
    scrollDivRef.current = el
    if (!el) return
    el.addEventListener('scroll', () => {
      atRightEdgeRef.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 5
    })
  }, [])

  const nNeurons = sortedIds.length
  const nSteps   = history.length

  const maxLabelLen = useMemo(
    () => sortedIds.reduce((max, id) => Math.max(max, labelFor(id, nodeNames).length), 0),
    [sortedIds, nodeNames]
  )
  const LABEL_W      = Math.max(36, Math.ceil(maxLabelLen * CHARS_PER_PX) + 12)
  const cellsAvail   = containerWidth - LABEL_W - PAD_X * 2
  const cellW        = containerWidth > 0 ? Math.max(MIN_CELL_W, cellsAvail / VIEWPORT_STEPS) : MIN_CELL_W
  const cellsCanvasW = Math.max(nSteps * cellW + PAD_X * 2, containerWidth - LABEL_W || 0)
  const canvasH      = HEADER_H + PAD_Y + nNeurons * ROW_H + PAD_Y

  useEffect(() => {
    const lc = labelsCanvasRef.current
    const cc = cellsCanvasRef.current
    if (!lc || !cc || nNeurons === 0 || containerWidth === 0) return

    const dpr = window.devicePixelRatio || 1
    const h   = Math.round(canvasH)
    const lw  = Math.round(LABEL_W)
    const cw  = Math.round(cellsCanvasW)

    for (const [canvas, w] of [[lc, lw], [cc, cw]] as const) {
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width        = w * dpr
        canvas.height       = h * dpr
        canvas.style.width  = w + 'px'
        canvas.style.height = h + 'px'
      }
    }

    const lctx = lc.getContext('2d')
    const cctx = cc.getContext('2d')
    if (!lctx || !cctx) return

    lctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    lctx.fillStyle = '#111009'
    lctx.fillRect(0, 0, lw, h)
    cctx.fillStyle = '#111009'
    cctx.fillRect(0, 0, cw, h)

    const spikeSet = new Set<string>()
    for (const { timestep, nodes } of history) {
      for (const n of nodes) spikeSet.add(`${timestep}:${n}`)
    }

    lctx.font          = `${FONT_SIZE}px "JetBrains Mono", ui-monospace, monospace`
    lctx.textBaseline  = 'alphabetic'
    lctx.textAlign     = 'right'
    lctx.fillStyle     = '#9e8f7e'
    for (let row = 0; row < nNeurons; row++) {
      const y = HEADER_H + PAD_Y + row * ROW_H
      lctx.fillText(labelFor(sortedIds[row], nodeNames), lw - 6, y + CELL_H - 3)
    }

    const interval = cellW >= 18 ? 1 : cellW >= 10 ? 5 : 10
    cctx.font         = `${FONT_SIZE}px "JetBrains Mono", ui-monospace, monospace`
    cctx.textBaseline = 'alphabetic'
    cctx.textAlign    = 'center'
    cctx.fillStyle    = '#9e8f7e'
    for (let col = 0; col < history.length; col++) {
      const { timestep } = history[col]
      if (timestep % interval === 0) {
        cctx.fillText(String(timestep), PAD_X + col * cellW + cellW / 2, HEADER_H - 4)
      }
    }

    for (let row = 0; row < nNeurons; row++) {
      const nodeId = sortedIds[row]
      const y      = HEADER_H + PAD_Y + row * ROW_H
      for (let col = 0; col < history.length; col++) {
        const { timestep } = history[col]
        cctx.fillStyle = spikeSet.has(`${timestep}:${nodeId}`) ? '#d4622a' : '#272420'
        cctx.fillRect(PAD_X + col * cellW, y, Math.max(1, cellW - 1), CELL_H)
      }
    }

    const scrollEl = scrollDivRef.current
    if (scrollEl && atRightEdgeRef.current) scrollEl.scrollLeft = cw
  }, [history, sortedIds, nodeNames, containerWidth, cellsCanvasW, canvasH, nNeurons, cellW, LABEL_W])

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
      {history.length > 0 ? (
        <span className="font-mono text-2xs text-text-muted">
          {nNeurons} neurons · last t={history[history.length - 1]?.timestep}
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
      <div ref={containerRef} className="bg-surface flex">
        <canvas ref={labelsCanvasRef} style={{ display: 'block', flexShrink: 0 }} />
        <div ref={scrollRef} className="overflow-x-auto flex-1 min-w-0">
          <canvas ref={cellsCanvasRef} style={{ display: 'block' }} />
        </div>
      </div>
    </div>
  )
}
