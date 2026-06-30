// lastExportedRef breaks the feedback loop when the parent reflects our own emitted
// change back as a prop update. SimVisualsContext is a pub-sub store so simulation
// ticks bypass setNodes/setEdges — only the affected components re-render.
import { Fragment, createContext, forwardRef, memo, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  BaseEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
  MarkerType,
  BackgroundVariant,
  type Node,
  type Edge,
  type EdgeProps,
  type Connection,
  type NodeProps,
  type OnConnect,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { RispNetwork, RispEdge } from '@shared/types'
import type { SpikeTransit } from '../../hooks/useSimulation'

export interface NetworkCanvasHandle {
  getLayoutMap:     () => Map<number, { x: number; y: number }>
  updateSimVisuals: (spikingIds: number[], transits: SpikeTransit[]) => void
}

const C = {
  bg:         '#111009',
  surface:    '#1f1d19',
  border:     '#3a3728',
  muted:      '#9e8f7e',
  accent:     '#d4622a',
  input:      '#c9a030',
  output:     '#7a9d8f',
  inhibitory: '#a03535',
} as const

function synapseColor(weight: number): string {
  return weight < 0 ? C.inhibitory : C.muted
}

interface NeuronData extends Record<string, unknown> {
  nodeId:    number
  label:     string
  threshold: number
  isInput:   boolean
  isOutput:  boolean
}

interface ParticleData {
  id:       string
  progress: number
}

interface SynapseData extends Record<string, unknown> {
  weight:         number
  delay:          number
  particles?:     ParticleData[]
  sourceHandle?:  string
  targetHandle?:  string
}

type NeuronNode  = Node<NeuronData>
type SynapseEdge = Edge<SynapseData>

const NODE_W      = 44
const NODE_H      = 44
const NODE_R      = NODE_W / 2
const GAP_X       = 140
const GAP_Y       = 110
const ROWS_PER_COL = 16

// angle=0 is east, increases clockwise (matches screen/SVG coords: right/down positive)
const HANDLE_DEFS = [
  { id: 'n',  angleDeg: 270, rfPos: Position.Top    },
  { id: 'ne', angleDeg: 315, rfPos: Position.Right  },
  { id: 'e',  angleDeg: 0,   rfPos: Position.Right  },
  { id: 'se', angleDeg: 45,  rfPos: Position.Right  },
  { id: 's',  angleDeg: 90,  rfPos: Position.Bottom },
  { id: 'sw', angleDeg: 135, rfPos: Position.Left   },
  { id: 'w',  angleDeg: 180, rfPos: Position.Left   },
  { id: 'nw', angleDeg: 225, rfPos: Position.Left   },
] as const

type HandlePos = (typeof HANDLE_DEFS)[number]['id']

// avoids repeated trig per render
const HANDLE_XY = Object.fromEntries(
  HANDLE_DEFS.map(h => {
    const rad = h.angleDeg * Math.PI / 180
    return [h.id, { x: NODE_W / 2 + NODE_R * Math.cos(rad), y: NODE_H / 2 + NODE_R * Math.sin(rad) }]
  })
) as Record<HandlePos, { x: number; y: number }>

// Stable objects so React's style reference check short-circuits and skips DOM updates.
function makeHandleDotStyles(vis: boolean) {
  return Object.fromEntries(
    HANDLE_DEFS.map(({ id }) => {
      const { x, y } = HANDLE_XY[id]
      return [id, {
        position: 'absolute' as const, left: x, top: y, transform: 'translate(-50%, -50%)',
        width: 7, height: 7, borderRadius: '50%',
        background: C.surface, border: `1.5px solid ${C.muted}`,
        opacity: vis ? 1 : 0, pointerEvents: vis ? 'all' as const : 'none' as const, transition: 'opacity 0.1s ease',
      }]
    })
  ) as Record<HandlePos, React.CSSProperties>
}
const HANDLE_DOT_STYLE_HIDDEN  = makeHandleDotStyles(false)
const HANDLE_DOT_STYLE_VISIBLE = makeHandleDotStyles(true)

// avoids 4 trig calls per edge per render
const HANDLE_DIR = Object.fromEntries(
  HANDLE_DEFS.map(h => {
    const rad = h.angleDeg * Math.PI / 180
    return [h.id, { dx: Math.cos(rad), dy: Math.sin(rad) }]
  })
) as Record<HandlePos, { dx: number; dy: number }>

// ReactFlow's getBezierPath ignores handle angles — this one respects them.
function getHandlePath(
  sx: number, sy: number, srcId: HandlePos,
  tx: number, ty: number, tgtId: HandlePos,
): string {
  const sd   = HANDLE_DIR[srcId]
  const td   = HANDLE_DIR[tgtId]
  const dist = Math.hypot(tx - sx, ty - sy)
  const ctrl = Math.max(40, dist * 0.35)
  return `M ${sx} ${sy} C ${sx + sd.dx * ctrl},${sy + sd.dy * ctrl} ${tx + td.dx * ctrl},${ty + td.dy * ctrl} ${tx},${ty}`
}

// Returns the number of columns consumed so the caller can advance its cursor.
function layoutGroup(
  nodes: RispNetwork['Nodes'],
  startCol: number,
  positions: Map<number, { x: number; y: number }>
): number {
  if (nodes.length === 0) return 0
  const colCount = Math.ceil(nodes.length / ROWS_PER_COL)
  for (let i = 0; i < nodes.length; i++) {
    const c = Math.floor(i / ROWS_PER_COL)
    const r = i % ROWS_PER_COL
    positions.set(nodes[i].id, { x: (startCol + c) * GAP_X, y: r * GAP_Y })
  }
  return colCount
}

function autoLayout(network: RispNetwork): Map<number, { x: number; y: number }> {
  if (network.Nodes.every(n => n.coords)) {
    const positions = new Map<number, { x: number; y: number }>()
    for (const n of network.Nodes) positions.set(n.id, n.coords!)
    return positions
  }
  const positions = new Map<number, { x: number; y: number }>()
  const inputSet  = new Set(network.Inputs)
  const outputSet = new Set(network.Outputs)
  const byId      = (a: { id: number }, b: { id: number }) => a.id - b.id
  const inputs    = network.Nodes.filter(n =>  inputSet.has(n.id)).sort(byId)
  const outputs   = network.Nodes.filter(n => outputSet.has(n.id)).sort(byId)
  const hidden    = network.Nodes.filter(n => !inputSet.has(n.id) && !outputSet.has(n.id)).sort(byId)

  let col = 0
  col += layoutGroup(inputs, col, positions)
  col += layoutGroup(hidden, col, positions)
  layoutGroup(outputs, col, positions)
  return positions
}

function makeLabel(nodeId: number, name?: string): string {
  return name ? `${nodeId} (${name})` : String(nodeId)
}

function extractName(label: string, nodeId: number): string | undefined {
  if (label === String(nodeId)) return undefined
  const m = label.match(/^\d+ \((.+)\)$/)
  return m ? m[1] : undefined
}

// Parses "M{x},{y} C{cx1},{cy1} {cx2},{cy2} {tx},{ty}" — ReactFlow path format,
// using [,\s]+ to handle both comma and space separators.
const _N = '(-?\\d+(?:\\.\\d+)?)', _SEP = '[,\\s]+'
const CUBIC_RE = new RegExp(`M\\s*${_N}${_SEP}${_N}\\s*C\\s*${_N}${_SEP}${_N}${_SEP}${_N}${_SEP}${_N}${_SEP}${_N}${_SEP}${_N}`)

function parseCubicBezier(path: string): [number, number, number, number, number, number, number, number] | null {
  const m = path.match(CUBIC_RE)
  if (!m) return null
  return m.slice(1).map(Number) as [number, number, number, number, number, number, number, number]
}

function bezierPoint(
  t: number,
  pts: [number, number, number, number, number, number, number, number]
): { x: number; y: number } {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = pts
  const s = 1 - t
  return {
    x: s ** 3 * x0 + 3 * s ** 2 * t * x1 + 3 * s * t ** 2 * x2 + t ** 3 * x3,
    y: s ** 3 * y0 + 3 * s ** 2 * t * y1 + 3 * s * t ** 2 * y2 + t ** 3 * y3,
  }
}

// Paths are stable during simulation (nodes don't move), so each edge is parsed at most once per run.
const bezierPathCache = new Map<string, [number, number, number, number, number, number, number, number] | null>()

interface ClipboardContents {
  nodes: NeuronNode[]
  edges: SynapseEdge[]
}
const CLIPBOARD_KEY = 'risp-clipboard'
function readClipboard(): ClipboardContents | null {
  try { const r = localStorage.getItem(CLIPBOARD_KEY); return r ? JSON.parse(r) : null } catch { return null }
}
function writeClipboard(data: ClipboardContents) {
  try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(data)) } catch {}
}
// ponytail: module-level, one canvas active at a time
let _isDragging = false
let _isPanning  = false
const edgePathUpdaters  = new Map<string, (d: string) => void>()
const edgeShowUpdaters  = new Map<string, (visible: boolean) => void>()

function EdgeParticles({ path, particles }: { path: string; particles: ParticleData[] }) {
  if (particles.length === 0) return null
  let pts = bezierPathCache.get(path)
  if (pts === undefined) {
    pts = parseCubicBezier(path)
    bezierPathCache.set(path, pts)
  }
  if (!pts) return null
  return (
    <>
      {particles.map(p => {
        // Clamp to [0.08, 0.92] so particles stay visibly between the source and target nodes
        const { x, y } = bezierPoint(Math.min(0.92, Math.max(0.08, p.progress)), pts!)
        return <circle key={p.id} cx={x} cy={y} r={3.5} fill={C.accent} style={{ pointerEvents: 'none' }} />
      })}
    </>
  )
}

const LARGE_NODE_THRESHOLD = 200
const LARGE_EDGE_THRESHOLD = 500
const PASTE_OFFSET = { x: 30, y: 30 }


type PanEdge = { fsx: number; fsy: number; ftx: number; fty: number; sh: HandlePos; th: HandlePos; weight: number }

type PanNodeCentre = { cx: number; cy: number }

function drawPanFrame(
  ctx: CanvasRenderingContext2D,
  edges: PanEdge[],
  nodes: PanNodeCentre[],
  vp: { x: number; y: number; zoom: number },
) {
  ctx.lineWidth = 0.6; ctx.globalAlpha = 0.55
  for (const color of [C.inhibitory, C.muted] as const) {
    ctx.strokeStyle = color; ctx.beginPath()
    for (const e of edges) {
      if (synapseColor(e.weight) !== color) continue
      const sd = HANDLE_DIR[e.sh], td = HANDLE_DIR[e.th]
      const fctrl = Math.max(40, Math.hypot(e.ftx - e.fsx, e.fty - e.fsy) * 0.35)
      ctx.moveTo(e.fsx * vp.zoom + vp.x, e.fsy * vp.zoom + vp.y)
      ctx.bezierCurveTo(
        (e.fsx + sd.dx * fctrl) * vp.zoom + vp.x, (e.fsy + sd.dy * fctrl) * vp.zoom + vp.y,
        (e.ftx + td.dx * fctrl) * vp.zoom + vp.x, (e.fty + td.dy * fctrl) * vp.zoom + vp.y,
        e.ftx * vp.zoom + vp.x, e.fty * vp.zoom + vp.y,
      )
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  // HTML nodes sit below the canvas — punch holes so they show through
  ctx.globalCompositeOperation = 'destination-out'
  for (const n of nodes) {
    ctx.beginPath()
    ctx.arc(n.cx * vp.zoom + vp.x, n.cy * vp.zoom + vp.y, NODE_R * vp.zoom, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
}

function networkToRF(
  network: RispNetwork,
  posMap: Map<number, { x: number; y: number }>,
  largeMode: boolean,
): { nodes: NeuronNode[]; edges: SynapseEdge[] } {
  const inputSet  = new Set(network.Inputs)
  const outputSet = new Set(network.Outputs)

  const nodes: NeuronNode[] = network.Nodes.map(n => {
    const pos = posMap.get(n.id) ?? { x: 50 + (n.id % 5) * GAP_X, y: 50 + Math.floor(n.id / 5) * GAP_Y }
    return {
      id:       String(n.id),
      position: pos,
      type:     largeMode ? 'lightNeuron' : 'neuron',
      data:     {
        nodeId:    n.id,
        label:     makeLabel(n.id, n.name),
        threshold: n.values[0] ?? 0,
        isInput:   inputSet.has(n.id),
        isOutput:  outputSet.has(n.id),
      },
    }
  })

  const edges: SynapseEdge[] = network.Edges.map(e => {
    const sh     = e.source_handle ?? 'e'
    const th     = e.target_handle ?? 'w'
    const weight = e.values[0] ?? 0
    const color  = synapseColor(weight)
    return {
      id:           `${e.from}->${e.to}`,
      source:       String(e.from),
      target:       String(e.to),
      sourceHandle: `${sh}-source`,
      targetHandle: `${th}-target`,
      type:         e.from === e.to ? 'selfLoop' : (largeMode ? 'lightSynapse' : 'synapse'),
      markerEnd:    { type: MarkerType.ArrowClosed, color },
      style:        largeMode ? { stroke: color, strokeWidth: 0.6, opacity: 0.55 } : { stroke: color, strokeWidth: 1.5 },
      data:         { weight, delay: e.values[1] ?? 1, particles: [], sourceHandle: sh, targetHandle: th },
    }
  })

  return { nodes, edges }
}

// Preserves proc_params, sim_time, and other fields from `base` that aren't tracked on canvas.
function rfToNetwork(nodes: NeuronNode[], edges: SynapseEdge[], base: RispNetwork): RispNetwork {
  const inputs:  number[] = []
  const outputs: number[] = []
  const newNodes = nodes.map(n => {
    const d = n.data
    if (d.isInput)  inputs.push(d.nodeId)
    if (d.isOutput) outputs.push(d.nodeId)
    const name = extractName(d.label, d.nodeId)
    return { id: d.nodeId, values: [d.threshold], ...(name ? { name } : {}) }
  })
  const newEdges = edges.map(e => ({
    from:   Number(e.source),
    to:     Number(e.target),
    values: [e.data?.weight ?? 0, e.data?.delay ?? 1],
    ...(e.data?.sourceHandle ? { source_handle: e.data.sourceHandle as RispEdge['source_handle'] } : {}),
    ...(e.data?.targetHandle ? { target_handle: e.data.targetHandle as RispEdge['target_handle'] } : {}),
  }))
  const inputSet = new Set(inputs)
  return {
    ...base,
    Nodes:   newNodes,
    Edges:   newEdges,
    Inputs:  inputs.sort((a, b) => a - b),
    Outputs: outputs.filter(id => !inputSet.has(id)).sort((a, b) => a - b),
  }
}

// Stable sentinel values so snapshot comparisons work correctly.
const EMPTY_PARTICLES: ParticleData[] = []
const EMPTY_SPIKING = new Set<number>()

// Bypasses setNodes/setEdges so ReactFlow skips re-processing its arrays on every sim tick.
interface SimVisualsStore {
  getSpikingSet(): Set<number>
  getParticles(edgeId: string): ParticleData[]
  subscribeNode(nodeId: number, fn: () => void): () => void
  subscribeEdge(edgeId: string, fn: () => void): () => void
}

const NOOP_STORE: SimVisualsStore = {
  getSpikingSet: () => EMPTY_SPIKING,
  getParticles:  () => EMPTY_PARTICLES,
  subscribeNode: () => () => {},
  subscribeEdge: () => () => {},
}
const SimVisualsContext = createContext<SimVisualsStore>(NOOP_STORE)

function SelfLoopEdgeInner({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, selected, data }: EdgeProps) {
  const store = useContext(SimVisualsContext)
  const particles = useSyncExternalStore(
    useCallback((fn: () => void) => store.subscribeEdge(id, fn), [store, id]),
    () => store.getParticles(id)
  )
  const ed = data as SynapseData | undefined
  const srcId     = (ed?.sourceHandle ?? 'e') as HandlePos
  const tgtId     = (ed?.targetHandle ?? 'w') as HandlePos
  const baseColor = synapseColor(ed?.weight ?? 0)
  const path      = getHandlePath(sourceX, sourceY, srcId, targetX, targetY, tgtId)
  const edgeStyle = selected ? { ...style, stroke: C.accent, strokeWidth: 2 } : { ...style, stroke: baseColor }
  return (
    <>
      <BaseEdge id={id} path={path} style={edgeStyle} markerEnd={markerEnd as string} />
      <EdgeParticles path={path} particles={particles} />
    </>
  )
}

const SelfLoopEdge = memo(SelfLoopEdgeInner, (prev, next) =>
  prev.sourceX === next.sourceX && prev.sourceY === next.sourceY &&
  prev.targetX === next.targetX && prev.targetY === next.targetY &&
  prev.selected === next.selected &&
  (prev.data as SynapseData | undefined)?.weight === (next.data as SynapseData | undefined)?.weight
)

function AnimatedSynapseEdgeInner({
  id, sourceX, sourceY, targetX, targetY,
  style, markerEnd, selected, data,
}: EdgeProps) {
  const store = useContext(SimVisualsContext)
  const particles = useSyncExternalStore(
    useCallback((fn: () => void) => store.subscribeEdge(id, fn), [store, id]),
    () => store.getParticles(id)
  )
  const ed = data as SynapseData | undefined
  const srcId     = (ed?.sourceHandle ?? 'e') as HandlePos
  const tgtId     = (ed?.targetHandle ?? 'w') as HandlePos
  const baseColor = synapseColor(ed?.weight ?? 0)
  const reactPath = getHandlePath(sourceX, sourceY, srcId, targetX, targetY, tgtId)
  const pathRef   = useRef(reactPath)
  // useSyncExternalStore re-renders would snap the edge back to stale React-prop positions without this
  if (!_isDragging) pathRef.current = reactPath
  const edgePath  = _isDragging ? pathRef.current : reactPath
  const edgeStyle = selected ? { ...style, stroke: C.accent, strokeWidth: 2 } : { ...style, stroke: baseColor }

  const visRef = useRef<SVGPathElement>(null)
  const intRef = useRef<SVGPathElement>(null)
  useEffect(() => {
    edgePathUpdaters.set(id, d => {
      pathRef.current = d
      visRef.current?.setAttribute('d', d)
      intRef.current?.setAttribute('d', d)
    })
    edgeShowUpdaters.set(id, visible => {
      const o = visible ? '' : '0'
      if (visRef.current) visRef.current.style.opacity = o
      if (intRef.current) intRef.current.style.opacity = o
    })
    return () => { edgePathUpdaters.delete(id); edgeShowUpdaters.delete(id) }
  }, [id])

  return (
    <>
      <path ref={visRef} id={id} d={edgePath} style={edgeStyle} fill="none"
        className="react-flow__edge-path" markerEnd={markerEnd as string} />
      <path ref={intRef} d={edgePath} fill="none" strokeOpacity={0} strokeWidth={20}
        className="react-flow__edge-interaction" />
      <EdgeParticles path={edgePath} particles={particles} />
    </>
  )
}

const AnimatedSynapseEdge = memo(AnimatedSynapseEdgeInner, (prev, next) => {
  if (prev.selected !== next.selected) return false
  if (_isDragging || _isPanning) return true
  return (
    prev.sourceX === next.sourceX && prev.sourceY === next.sourceY &&
    prev.targetX === next.targetX && prev.targetY === next.targetY &&
    (prev.data as SynapseData | undefined)?.weight === (next.data as SynapseData | undefined)?.weight
  )
})

function LightSynapseEdgeInner({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, data }: EdgeProps) {
  const ed      = data as SynapseData | undefined
  const srcId   = (ed?.sourceHandle ?? 'e') as HandlePos
  const tgtId   = (ed?.targetHandle ?? 'w') as HandlePos
  const reactPath = getHandlePath(sourceX, sourceY, srcId, targetX, targetY, tgtId)
  const pathRef   = useRef(reactPath)
  if (!_isDragging) pathRef.current = reactPath
  const edgePath  = _isDragging ? pathRef.current : reactPath
  const visRef    = useRef<SVGPathElement>(null)
  useEffect(() => {
    edgePathUpdaters.set(id, d => { pathRef.current = d; visRef.current?.setAttribute('d', d) })
    edgeShowUpdaters.set(id, visible => { if (visRef.current) visRef.current.style.opacity = visible ? '' : '0' })
    return () => { edgePathUpdaters.delete(id); edgeShowUpdaters.delete(id) }
  }, [id])
  return (
    <path ref={visRef} id={id} d={edgePath} style={style} fill="none"
      className="react-flow__edge-path" markerEnd={markerEnd as string} />
  )
}
const LightSynapseEdge = memo(LightSynapseEdgeInner, (prev, next) => {
  if (_isDragging || _isPanning) return true
  return (
    prev.sourceX === next.sourceX && prev.sourceY === next.sourceY &&
    prev.targetX === next.targetX && prev.targetY === next.targetY &&
    prev.selected === next.selected &&
    (prev.data as SynapseData | undefined)?.weight === (next.data as SynapseData | undefined)?.weight
  )
})

function NeuronNodeInner({ data, selected }: NodeProps) {
  const d = data as NeuronData
  const store = useContext(SimVisualsContext)
  const [hovered, setHovered] = useState(false)
  // isSpiking comes from the store, not from data — avoids a setNodes call on every sim tick
  const isSpiking = useSyncExternalStore(
    useCallback((fn: () => void) => store.subscribeNode(d.nodeId, fn), [store, d.nodeId]),
    () => store.getSpikingSet().has(d.nodeId)
  )
  const border = selected ? C.accent : d.isInput ? C.input : d.isOutput ? C.output : C.border
  const color  = d.isInput ? C.input : d.isOutput ? C.output : C.muted
  const nodeBg = d.isInput ? '#1c1800' : d.isOutput ? '#131f1c' : C.bg
  const name   = extractName(d.label, d.nodeId)
  return (
    <div
      style={{
        width: NODE_W, height: NODE_H, border: `1px solid ${border}`,
        background: nodeBg, borderRadius: NODE_H / 2,
        display: 'flex', alignItems: 'center',
        justifyContent: 'center', position: 'relative',
        boxShadow: isSpiking ? `0 0 0 1px ${C.accent}, 0 0 10px rgba(212, 98, 42, 0.55)` : 'none',
        transition: 'box-shadow 60ms ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {HANDLE_DEFS.map(({ id, rfPos }) => {
        const dotStyle = hovered ? HANDLE_DOT_STYLE_VISIBLE[id] : HANDLE_DOT_STYLE_HIDDEN[id]
        return (
          <Fragment key={id}>
            <Handle type="target" id={`${id}-target`} position={rfPos} style={dotStyle} />
            <Handle type="source" id={`${id}-source`} position={rfPos} style={dotStyle} />
          </Fragment>
        )
      })}
      {name ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9, color, userSelect: 'none', lineHeight: 1 }}>
            {d.nodeId}
          </span>
          <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 6, color, userSelect: 'none', lineHeight: 1, maxWidth: 34, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
        </div>
      ) : (
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color, userSelect: 'none', lineHeight: 1 }}>
          {d.nodeId}
        </span>
      )}
      {(d.isInput || d.isOutput) && (
        <span style={{
          position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)',
          fontFamily: '"JetBrains Mono", monospace', fontSize: 6,
          color: d.isInput ? C.input : C.output, whiteSpace: 'nowrap',
        }}>
          {d.isInput ? 'IN' : 'OUT'}
        </span>
      )}
    </div>
  )
}

// Only re-render when structural props change — isSpiking is tracked by the store independently.
const NeuronNode = memo(NeuronNodeInner, (prev, next) => {
  const pd = prev.data as NeuronData, nd = next.data as NeuronData
  return pd.label     === nd.label     &&
         pd.threshold === nd.threshold &&
         pd.isInput   === nd.isInput   &&
         pd.isOutput  === nd.isOutput  &&
         prev.selected === next.selected
})

// Skips store subscription entirely — mount/unmount is cheap enough for virtual scrolling in large graphs.
function LightNeuronNodeInner({ data, selected }: NodeProps) {
  const d     = data as NeuronData
  const [hovered, setHovered] = useState(false)
  const color   = d.isInput ? C.input : d.isOutput ? C.output : C.muted
  const lightBg = d.isInput ? '#1c1800' : d.isOutput ? '#131f1c' : C.bg
  const name    = extractName(d.label, d.nodeId)
  return (
    <div
      style={{
        width: NODE_W, height: NODE_H,
        border: `1px solid ${selected ? C.accent : C.border}`,
        background: lightBg, borderRadius: NODE_H / 2,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {HANDLE_DEFS.map(({ id, rfPos }) => {
        const dotStyle = hovered ? HANDLE_DOT_STYLE_VISIBLE[id] : HANDLE_DOT_STYLE_HIDDEN[id]
        return (
          <Fragment key={id}>
            <Handle type="target" id={`${id}-target`} position={rfPos} style={dotStyle} />
            <Handle type="source" id={`${id}-source`} position={rfPos} style={dotStyle} />
          </Fragment>
        )
      })}
      {name ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
          <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9, color, userSelect: 'none', lineHeight: 1 }}>
            {d.nodeId}
          </span>
          <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 6, color, userSelect: 'none', lineHeight: 1, maxWidth: 34, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
        </div>
      ) : (
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color, userSelect: 'none', lineHeight: 1 }}>
          {d.nodeId}
        </span>
      )}
    </div>
  )
}

const LightNeuronNode = memo(LightNeuronNodeInner, (prev, next) => {
  const pd = prev.data as NeuronData, nd = next.data as NeuronData
  return pd.label    === nd.label    && pd.isInput  === nd.isInput &&
         pd.isOutput === nd.isOutput && prev.selected === next.selected
})

const nodeTypes = { neuron: NeuronNode, lightNeuron: LightNeuronNode }
const edgeTypes = { synapse: AnimatedSynapseEdge, lightSynapse: LightSynapseEdge, selfLoop: SelfLoopEdge }

function PaletteChip({ nodeType, label, color }: { nodeType: string; label: string; color: string }) {
  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('application/risp-node-type', nodeType)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      title={`Drag onto canvas to add ${label} neuron`}
      style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'grab', userSelect: 'none', flexShrink: 0 }}
    >
      <div style={{ width: 14, height: 14, borderRadius: '50%', border: `1px solid ${color}`, background: C.bg, flexShrink: 0 }} />
      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9, color }}>{label}</span>
    </div>
  )
}

function MiniNode({ accent = C.muted, size = 'sm' }: { accent?: string; size?: 'sm' | 'lg' }) {
  const d  = size === 'lg' ? 44 : 22
  const ds = size === 'lg' ? 8  : 5
  const dot = {
    width: ds, height: ds, borderRadius: '50%',
    background: C.surface, border: `1px solid ${accent}`,
    position: 'absolute' as const, top: '50%', transform: 'translateY(-50%)',
  }
  return (
    <div style={{ width: d, height: d, borderRadius: '50%', border: `1px solid ${C.border}`, background: C.bg, flexShrink: 0, position: 'relative' }}>
      <div style={{ ...dot, left:  -Math.floor(ds / 2) }} />
      <div style={{ ...dot, right: -Math.floor(ds / 2) }} />
    </div>
  )
}

const DEMO_T = {
  duration: 2.6,
  times: [0, 0.15, 0.5, 0.75, 1] as number[],
  repeat: Infinity, repeatDelay: 0.5, ease: 'easeInOut' as const,
}

function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
      style={{ background: '#0e0c09', overflow: 'hidden' }}
      className="border-b border-border"
    >
      <div className="relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 font-mono text-xs text-text-muted hover:text-text-secondary transition-colors z-10"
        >
          ×
        </button>
        <div className="grid grid-cols-2 divide-x divide-border">

          <div className="flex flex-col items-center justify-center py-10 gap-5">
            <div className="flex items-center gap-10" style={{ height: 56 }}>
              <motion.div
                animate={{ x: [0, 0, 76, 76, 0], opacity: [1, 1, 0.25, 0.25, 1] }}
                transition={DEMO_T}
                style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: `1px solid ${C.muted}`, background: C.bg, flexShrink: 0 }} />
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: C.muted }}>neuron</span>
              </motion.div>
              <motion.div
                animate={{ opacity: [0, 0, 1, 1, 0], scale: [0.6, 0.6, 1, 1, 0.6] }}
                transition={DEMO_T}
                style={{ originX: '50%', originY: '50%' }}
              >
                <MiniNode size="lg" />
              </motion.div>
            </div>
            <span className="font-mono text-xs text-text-muted opacity-40">drag chip onto canvas</span>
          </div>

          <div className="flex flex-col items-center justify-center py-10 gap-5">
            <div className="flex items-center" style={{ height: 56 }}>
              <MiniNode size="lg" />
              <div style={{ position: 'relative', width: 80, height: 2, flexShrink: 0 }}>
                <motion.div
                  animate={{ scaleX: [0, 0, 1, 1, 0], opacity: [0, 0, 1, 1, 0] }}
                  transition={DEMO_T}
                  style={{ position: 'absolute', inset: 0, background: C.muted, originX: 0 }}
                />
              </div>
              <MiniNode size="lg" />
            </div>
            <span className="font-mono text-xs text-text-muted opacity-40">drag handle to connect</span>
          </div>

        </div>

        <div className="border-t border-border px-6 py-2 flex items-center gap-8">
          <span className="font-mono text-2xs text-text-muted opacity-40">Shift+click — add to selection</span>
          <span className="font-mono text-2xs text-text-muted opacity-40">Ctrl/⌘+C / Ctrl/⌘+V — copy / paste</span>
        </div>
      </div>
    </motion.div>
  )
}

function NumericInput({
  value, min, max, isInteger = false, placeholder, className, onChange,
}: {
  value:        number
  min:          number
  max:          number
  isInteger?:   boolean
  placeholder?: string
  className?:   string
  onChange:     (v: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const savedRef = useRef<number>(value)

  useEffect(() => { setDraft(String(value)) }, [value])

  function clampDefault(): number {
    return Math.min(max, Math.max(min, 1))
  }

  function commit(str: string, emptyFallback: number) {
    if (str.trim() === '') {
      setDraft(String(emptyFallback))
      onChange(emptyFallback)
      return
    }
    const raw = isInteger ? Math.round(parseFloat(str)) : parseFloat(str)
    const n   = isNaN(raw) ? clampDefault() : Math.min(max, Math.max(min, raw))
    setDraft(String(n))
    onChange(n)
  }

  return (
    <input
      type="text"
      inputMode={isInteger ? 'numeric' : 'decimal'}
      value={draft}
      placeholder={placeholder}
      className={className}
      onFocus={() => { savedRef.current = value }}
      onChange={e => setDraft(e.target.value)}
      onBlur={e => commit(e.target.value, savedRef.current)}
      onKeyDown={e => {
        if (e.key === 'Enter')  { commit((e.target as HTMLInputElement).value, clampDefault()); (e.target as HTMLInputElement).blur() }
        if (e.key === 'Escape') { setDraft(String(savedRef.current)); onChange(savedRef.current); (e.target as HTMLInputElement).blur() }
      }}
    />
  )
}

interface InspectorProps {
  node?:              NeuronNode
  edge?:              SynapseEdge
  proc:               RispNetwork['Associated_Data']['proc_params']
  onNodeChange:       (id: string, patch: Partial<NeuronData>) => void
  onEdgeChange:       (id: string, patch: Partial<SynapseData>) => void
  onDelete:           () => void
  onSwapEdge?:        (id: string) => void
  swapBlocked?:       boolean
  isMultiSelect?:     boolean
  multiSelectCounts?: { nodes: number; edges: number }
  existingNames?:     Set<string>
  inCount?:           number
  outCount?:          number
  nodes?:             NeuronNode[]
}

const fieldCls = 'w-full px-2 py-1 font-mono text-xs bg-bg border border-border text-text-primary focus:outline-none focus:border-text-muted'

function NodeFields({ node, proc, onNodeChange, onDelete, existingNames, inCount = 0, outCount = 0 }: {
  node:          NeuronNode
  proc:          InspectorProps['proc']
  onNodeChange:  InspectorProps['onNodeChange']
  onDelete:      InspectorProps['onDelete']
  existingNames: Set<string>
  inCount?:      number
  outCount?:     number
}) {
  const d           = node.data
  const minT        = proc?.min_threshold ?? -127
  const maxT        = proc?.max_threshold ?? 127
  const currentName  = extractName(d.label, d.nodeId) ?? ''
  const [nameDraft, setNameDraft] = useState(currentName)
  const savedNameRef = useRef(currentName)
  // 'revert' is set by Escape/Enter+duplicate so onBlur knows to undo rather than commit.
  const intentRef    = useRef<'commit' | 'revert'>('commit')
  const trimmedDraft = nameDraft.trim()
  const isDuplicate  = !!trimmedDraft && existingNames.has(trimmedDraft)

  function commitName(v: string) {
    const t = v.trim()
    if (t !== nameDraft) setNameDraft(t)
    onNodeChange(node.id, { label: makeLabel(d.nodeId, t || undefined) })
  }
  function revertName() {
    setNameDraft(savedNameRef.current)
    onNodeChange(node.id, { label: makeLabel(d.nodeId, savedNameRef.current || undefined) })
  }

  return (
    <div className="col-span-2 sm:col-span-4 flex items-end gap-4">
      <div className="flex-1 flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <label className="font-mono text-2xs text-text-muted block mb-1">name</label>
          <input
            value={nameDraft}
            placeholder={String(d.nodeId)}
            onFocus={() => { savedNameRef.current = nameDraft }}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={() => {
              if (intentRef.current === 'revert' || isDuplicate) { revertName() }
              else { commitName(nameDraft) }
              intentRef.current = 'commit'
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                intentRef.current = 'revert'
                ;(e.target as HTMLInputElement).blur()
              }
              if (e.key === 'Enter') {
                intentRef.current = isDuplicate ? 'revert' : 'commit'
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            className={`${fieldCls} ${isDuplicate ? 'border-accent' : ''} w-full`}
          />
          {isDuplicate && (
            <span className="font-mono text-2xs text-accent block mt-0.5">name already used</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <label className="font-mono text-2xs text-text-muted block mb-1">
            threshold [{minT},{maxT}]
          </label>
          <NumericInput
            value={d.threshold} min={minT} max={maxT} isInteger={proc?.discrete ?? false}
            placeholder={`${minT} – ${maxT}`}
            onChange={v => onNodeChange(node.id, { threshold: v })}
            className={`${fieldCls} w-full`}
          />
        </div>
      </div>
      <div className="flex-1 flex items-end justify-between gap-2">
        <div className="shrink-0">
          <label className="font-mono text-2xs text-text-muted block mb-1">input</label>
          <button
            onClick={() => onNodeChange(node.id, { isInput: !d.isInput })}
            disabled={d.isOutput}
            title={d.isOutput ? 'Cannot be both input and output — remove output role first' : undefined}
            className={`px-2 py-0.5 font-mono text-xs border transition-colors ${
              d.isOutput
                ? 'border-border text-text-muted opacity-30 cursor-not-allowed'
                : d.isInput
                  ? 'border-text-secondary text-text-secondary'
                  : 'border-border text-text-muted hover:border-text-muted'
            }`}
          >
            {d.isInput ? 'yes' : 'no'}
          </button>
        </div>
        <div className="shrink-0">
          <label className="font-mono text-2xs text-text-muted block mb-1">output</label>
          <button
            onClick={() => onNodeChange(node.id, { isOutput: !d.isOutput })}
            disabled={d.isInput}
            title={d.isInput ? 'Cannot be both input and output — remove input role first' : undefined}
            className={`px-2 py-0.5 font-mono text-xs border transition-colors ${
              d.isInput
                ? 'border-border text-text-muted opacity-30 cursor-not-allowed'
                : d.isOutput
                  ? 'border-text-secondary text-text-secondary'
                  : 'border-border text-text-muted hover:border-text-muted'
            }`}
          >
            {d.isOutput ? 'yes' : 'no'}
          </button>
        </div>
        <div className="shrink-0">
          <span className="font-mono text-2xs text-text-muted block mb-1">synapses</span>
          <span className="font-mono text-xs text-text-secondary">{inCount} in · {outCount} out</span>
        </div>
        <button onClick={onDelete} className="shrink-0 font-mono text-2xs text-text-muted hover:text-accent transition-colors">
          delete node →
        </button>
      </div>
    </div>
  )
}

function EdgeFields({ edge, proc, onEdgeChange, onDelete, onSwapEdge, swapBlocked, nodes = [] }: {
  edge:          SynapseEdge
  proc:          InspectorProps['proc']
  onEdgeChange:  InspectorProps['onEdgeChange']
  onDelete:      InspectorProps['onDelete']
  onSwapEdge?:   InspectorProps['onSwapEdge']
  swapBlocked?:  InspectorProps['swapBlocked']
  nodes?:        NeuronNode[]
}) {
  const d       = edge.data ?? { weight: 0, delay: 1 }
  const minW    = proc?.min_weight ?? -127
  const maxW    = proc?.max_weight ?? 127
  const maxD    = proc?.max_delay  ?? 127
  const srcNode = nodes.find(n => n.id === edge.source)
  const tgtNode = nodes.find(n => n.id === edge.target)
  return (
    <>
      <div>
        <label className="font-mono text-2xs text-text-muted block mb-1">
          weight [{minW},{maxW}]
        </label>
        <NumericInput
          value={d.weight} min={minW} max={maxW} isInteger={proc?.discrete ?? false}
          placeholder={`${minW} – ${maxW}`}
          onChange={v => onEdgeChange(edge.id, { weight: v })}
          className={fieldCls}
        />
      </div>
      <div>
        <label className="font-mono text-2xs text-text-muted block mb-1">
          delay [1,{maxD}]
        </label>
        <NumericInput
          value={d.delay} min={1} max={maxD} isInteger
          placeholder={`1 – ${maxD}`}
          onChange={v => onEdgeChange(edge.id, { delay: v })}
          className={fieldCls}
        />
      </div>
      <div>
        <span className="font-mono text-2xs text-text-muted block mb-0.5">from</span>
        <span className="font-mono text-xs text-text-secondary">{srcNode?.data.label ?? edge.source}</span>
      </div>
      <div>
        <span className="font-mono text-2xs text-text-muted block mb-0.5">to</span>
        <span className="font-mono text-xs text-text-secondary">{tgtNode?.data.label ?? edge.target}</span>
      </div>
      <div className="col-span-2 sm:col-span-4 flex items-center justify-end gap-4">
        {onSwapEdge && (
          <button
            onClick={() => !swapBlocked && onSwapEdge(edge.id)}
            disabled={swapBlocked}
            className={`font-mono text-2xs transition-colors ${
              swapBlocked
                ? 'text-text-muted opacity-30 cursor-not-allowed'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            swap ⇄
          </button>
        )}
        <button onClick={onDelete} className="font-mono text-2xs text-text-muted hover:text-accent transition-colors">
          delete edge →
        </button>
      </div>
    </>
  )
}

function Inspector({ node, edge, proc, onNodeChange, onEdgeChange, onDelete, onSwapEdge, swapBlocked, isMultiSelect, multiSelectCounts, existingNames, inCount, outCount, nodes }: InspectorProps) {
  if (isMultiSelect) {
    const { nodes: n, edges: e } = multiSelectCounts!
    const parts = [
      n > 0 && `${n} neuron${n !== 1 ? 's' : ''}`,
      e > 0 && `${e} synapse${e !== 1 ? 's' : ''}`,
    ].filter(Boolean).join(', ')
    return (
      <div className="border-t border-border p-3">
        <span className="font-mono text-xs text-text-muted">{parts} selected</span>
      </div>
    )
  }
  if (!node && !edge) return null
  return (
    <div className="border-t border-border p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
      {node && <NodeFields key={node.id} node={node} proc={proc} onNodeChange={onNodeChange} onDelete={onDelete} existingNames={existingNames ?? new Set()} inCount={inCount} outCount={outCount} />}
      {edge && <EdgeFields edge={edge} proc={proc} onEdgeChange={onEdgeChange} onDelete={onDelete} onSwapEdge={onSwapEdge} swapBlocked={swapBlocked} nodes={nodes} />}
    </div>
  )
}

interface ExternalSelection {
  nodeId?: string | null
  edgeId?: string | null
}

interface Props {
  network:            RispNetwork | null
  onChange?:          (updated: RispNetwork) => void
  readOnly?:          boolean
  externalSelection?: ExternalSelection | null
}

const NetworkCanvasInner = forwardRef<NetworkCanvasHandle, Props>(function NetworkCanvasInner({
  network, onChange, readOnly = false, externalSelection,
}: Props, ref) {
  const rfInstance = useReactFlow()

  useImperativeHandle(ref, () => ({
    getLayoutMap: () => new Map(
      (rfInstance.getNodes() as NeuronNode[]).map(n => [n.data.nodeId, n.position])
    ),
    updateSimVisuals: (spikingIds: number[], transits: SpikeTransit[]) => {
      const store      = simStoreRef.current
      const prevSpiking = store.spikingSet
      const newSpiking  = spikingIds.length ? new Set(spikingIds) : EMPTY_SPIKING
      store.spikingSet  = newSpiking

      const byEdge = new Map<string, ParticleData[]>()
      for (const tr of transits) {
        let list = byEdge.get(tr.edgeId)
        if (!list) { list = []; byEdge.set(tr.edgeId, list) }
        list.push({ id: `${tr.edgeId}-${tr.launchedAt}`, progress: tr.progress })
      }
      const prevParticles = store.particles
      store.particles = byEdge

      for (const id of prevSpiking) { if (!newSpiking.has(id)) store.nodeListeners.get(id)?.forEach(fn => fn()) }
      for (const id of newSpiking)  { if (!prevSpiking.has(id)) store.nodeListeners.get(id)?.forEach(fn => fn()) }

      const changedEdgeIds = new Set(prevParticles.keys())
      for (const id of byEdge.keys()) changedEdgeIds.add(id)
      for (const edgeId of changedEdgeIds) {
        if (prevParticles.get(edgeId) !== byEdge.get(edgeId)) {
          store.edgeListeners.get(edgeId)?.forEach(fn => fn())
        }
      }
    },
  }), [rfInstance])
  const [nodes, setNodes, onNodesChange] = useNodesState<NeuronNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<SynapseEdge>([])
  const [helpOpen, setHelpOpen]   = useState(false)
  const lastExportedRef = useRef<RispNetwork | null>(null)

  const simStoreRef = useRef({
    spikingSet:    EMPTY_SPIKING as Set<number>,
    particles:     new Map<string, ParticleData[]>(),
    nodeListeners: new Map<number, Set<() => void>>(),
    edgeListeners: new Map<string, Set<() => void>>(),
  })
  const [simStore] = useState<SimVisualsStore>(() => ({
    getSpikingSet: () => simStoreRef.current.spikingSet,
    getParticles:  edgeId => simStoreRef.current.particles.get(edgeId) ?? EMPTY_PARTICLES,
    subscribeNode: (nodeId, fn) => {
      const s = simStoreRef.current
      let set = s.nodeListeners.get(nodeId)
      if (!set) { set = new Set(); s.nodeListeners.set(nodeId, set) }
      set.add(fn)
      return () => s.nodeListeners.get(nodeId)?.delete(fn)
    },
    subscribeEdge: (edgeId, fn) => {
      const s = simStoreRef.current
      let set = s.edgeListeners.get(edgeId)
      if (!set) { set = new Set(); s.edgeListeners.set(edgeId, set) }
      set.add(fn)
      return () => s.edgeListeners.get(edgeId)?.delete(fn)
    },
  }))

  const prevSelNodeRef = useRef<string | null>(null)
  const prevSelEdgeRef = useRef<string | null>(null)

  useEffect(() => {
    if (!network) {
      setNodes([]); setEdges([])
      bezierPathCache.clear()
      return
    }
    if (network === lastExportedRef.current) return
    bezierPathCache.clear()
    const large = network.Nodes.length > LARGE_NODE_THRESHOLD || network.Edges.length > LARGE_EDGE_THRESHOLD
    const posMap = autoLayout(network)
    const { nodes: rn, edges: re } = networkToRF(network, posMap, large)
    setNodes(rn); setEdges(re)
  }, [network, setNodes, setEdges])

  // Only creates new objects for the toggled node/edge so React skips re-renders on unaffected items.
  useEffect(() => {
    if (!externalSelection) return
    const { nodeId, edgeId } = externalSelection
    if (nodeId != null) {
      const prev = prevSelNodeRef.current
      prevSelNodeRef.current = nodeId
      setNodes(nds => nds.map(n => {
        if (n.id !== nodeId && n.id !== prev) return n
        return { ...n, selected: n.id === nodeId }
      }))
      if (prevSelEdgeRef.current) {
        const pe = prevSelEdgeRef.current
        prevSelEdgeRef.current = null
        setEdges(eds => eds.map(e => e.id === pe ? { ...e, selected: false } : e))
      }
    } else if (edgeId != null) {
      const prev = prevSelEdgeRef.current
      prevSelEdgeRef.current = edgeId
      setEdges(eds => eds.map(e => {
        if (e.id !== edgeId && e.id !== prev) return e
        return { ...e, selected: e.id === edgeId }
      }))
      if (prevSelNodeRef.current) {
        const pn = prevSelNodeRef.current
        prevSelNodeRef.current = null
        setNodes(nds => nds.map(n => n.id === pn ? { ...n, selected: false } : n))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSelection])

  const emitChange = useCallback(
    (updatedNodes: NeuronNode[], updatedEdges: SynapseEdge[]) => {
      if (!network || !onChange) return
      const updated = rfToNetwork(updatedNodes, updatedEdges, network)
      lastExportedRef.current = updated
      onChange(updated)
    },
    [network, onChange]
  )

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return
      const currentEdges = rfInstance.getEdges() as SynapseEdge[]
      if (currentEdges.some(e => e.source === String(connection.source) && e.target === String(connection.target))) return
      const currentNodes    = rfInstance.getNodes() as NeuronNode[]
      const proc            = network?.Associated_Data?.proc_params
      const minW            = proc?.min_weight ?? -127
      const maxW            = proc?.max_weight ?? 127
      const defaultWeight   = Math.max(minW, Math.min(1, maxW))
      const isSelf  = connection.source === connection.target
      const srcPos  = (connection.sourceHandle ?? 'e-source').replace('-source', '')
      const tgtPos  = (connection.targetHandle ?? 'w-target').replace('-target', '')
      const color   = synapseColor(defaultWeight)
      const large   = currentNodes.length > LARGE_NODE_THRESHOLD || currentEdges.length > LARGE_EDGE_THRESHOLD
      const newEdge: SynapseEdge = {
        ...connection,
        id:           `${connection.source}->${connection.target}`,
        sourceHandle: `${srcPos}-source`,
        targetHandle: `${tgtPos}-target`,
        type:         isSelf ? 'selfLoop' : (large ? 'lightSynapse' : 'synapse'),
        markerEnd:    { type: MarkerType.ArrowClosed, color },
        style:        large ? { stroke: color, strokeWidth: 0.6, opacity: 0.55 } : { stroke: color, strokeWidth: 1.5 },
        data:         { weight: defaultWeight, delay: 1, particles: [], sourceHandle: srcPos, targetHandle: tgtPos },
      } as SynapseEdge
      const updatedEdges = [...currentEdges, newEdge]
      setEdges(updatedEdges)
      emitChange(currentNodes, updatedEdges)
    },
    [readOnly, network, rfInstance, setEdges, emitChange]
  )

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (readOnly || !network) return
    const nodeType = e.dataTransfer.getData('application/risp-node-type') as 'neuron' | 'input' | 'output'
    if (!['neuron', 'input', 'output'].includes(nodeType)) return
    const pos          = rfInstance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const currentNodes = rfInstance.getNodes() as NeuronNode[]
    const currentEdges = rfInstance.getEdges() as SynapseEdge[]
    const existingIds  = new Set(currentNodes.map(n => n.data.nodeId))
    let newId = 0
    while (existingIds.has(newId)) newId++
    const proc             = network.Associated_Data?.proc_params
    const minT             = proc?.min_threshold ?? 1
    const maxT             = proc?.max_threshold ?? 127
    const defaultThreshold = Math.max(minT, Math.min(1, maxT))
    const large            = currentNodes.length > LARGE_NODE_THRESHOLD || currentEdges.length > LARGE_EDGE_THRESHOLD
    const newNode: NeuronNode = {
      id:       String(newId),
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      type:     large ? 'lightNeuron' : 'neuron',
      data:     { nodeId: newId, label: String(newId), threshold: defaultThreshold, isInput: nodeType === 'input', isOutput: nodeType === 'output' },
    }
    const updated = [...currentNodes, newNode]
    setNodes(updated)
    emitChange(updated, currentEdges)
  }, [readOnly, network, rfInstance, setNodes, emitChange])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const deleteSelected = useCallback(() => {
    if (readOnly) return
    const currentNodes = rfInstance.getNodes() as NeuronNode[]
    const currentEdges = rfInstance.getEdges() as SynapseEdge[]
    const selNodeIds = new Set(currentNodes.filter(n => n.selected).map(n => n.id))
    const selEdgeIds = new Set(currentEdges.filter(e => e.selected).map(e => e.id))
    if (selNodeIds.size === 0 && selEdgeIds.size === 0) return
    const updatedNodes = currentNodes.filter(n => !selNodeIds.has(n.id))
    const updatedEdges = currentEdges.filter(e =>
      !selEdgeIds.has(e.id) && !selNodeIds.has(e.source) && !selNodeIds.has(e.target)
    )
    setNodes(updatedNodes); setEdges(updatedEdges)
    emitChange(updatedNodes, updatedEdges)
  }, [readOnly, rfInstance, setNodes, setEdges, emitChange])

  const copySelected = useCallback(() => {
    if (readOnly) return
    const currentNodes = rfInstance.getNodes() as NeuronNode[]
    const currentEdges = rfInstance.getEdges() as SynapseEdge[]
    const selNodes = currentNodes.filter(n => n.selected)
    const selEdges = currentEdges.filter(e => e.selected)
    if (selNodes.length === 0) return
    const clipNodeIds = new Set(selNodes.map(n => n.id))
    const explicitEdgeIds = new Set(selEdges.map(e => e.id))
    const clipEdges = [
      ...selEdges,
      ...currentEdges.filter(e =>
        !explicitEdgeIds.has(e.id) &&
        clipNodeIds.has(e.source) &&
        clipNodeIds.has(e.target)
      ),
    ]
    writeClipboard({ nodes: selNodes, edges: clipEdges })
  }, [readOnly, rfInstance])

  const pasteClipboard = useCallback(() => {
    const clipData = readClipboard()
    if (readOnly || !clipData || clipData.nodes.length === 0) return
    const currentNodes = rfInstance.getNodes() as NeuronNode[]
    const currentEdges = rfInstance.getEdges() as SynapseEdge[]

    const existingNumIds = new Set(currentNodes.map(n => n.data.nodeId))
    let nextId = 0
    const idRemap = new Map<string, number>()
    for (const n of clipData.nodes) {
      while (existingNumIds.has(nextId)) nextId++
      idRemap.set(n.id, nextId)
      existingNumIds.add(nextId)
      nextId++
    }

    // Grows as names are assigned so later pastes in the same operation avoid collisions.
    const usedNames = new Set<string>(
      currentNodes
        .map(n => extractName(n.data.label, n.data.nodeId))
        .filter((name): name is string => name !== undefined)
    )
    const newNodes: NeuronNode[] = clipData.nodes.map(n => {
      const newNumId  = idRemap.get(n.id)!
      const baseName  = extractName(n.data.label, n.data.nodeId)
      let finalName: string | undefined
      if (baseName) {
        let i = 1
        while (usedNames.has(`${baseName}_${i}`)) i++
        finalName = `${baseName}_${i}`
        usedNames.add(finalName)
      }
      return {
        ...n,
        id:       String(newNumId),
        position: { x: n.position.x + PASTE_OFFSET.x, y: n.position.y + PASTE_OFFSET.y },
        selected: true,
        data:     { ...n.data, nodeId: newNumId, label: makeLabel(newNumId, finalName) },
      }
    })

    // Cross-edge rule: endpoints absent from idRemap keep their original integer ID.
    const existingEdgeIds = new Set(currentEdges.map(e => e.id))
    const newEdges: SynapseEdge[] = clipData.edges.flatMap(e => {
      const newFrom = idRemap.get(e.source) ?? parseInt(e.source)
      const newTo   = idRemap.get(e.target) ?? parseInt(e.target)
      const newId   = `${newFrom}->${newTo}`
      if (existingEdgeIds.has(newId)) return []
      return [{
        ...e,
        id:       newId,
        source:   String(newFrom),
        target:   String(newTo),
        selected: true,
      }]
    })

    const large = (currentNodes.length + newNodes.length) > LARGE_NODE_THRESHOLD ||
                  (currentEdges.length + newEdges.length) > LARGE_EDGE_THRESHOLD
    const typedNewNodes  = newNodes.map(n => ({ ...n, type: large ? 'lightNeuron' : 'neuron' }))
    const typedNewEdges  = newEdges.map(e => {
      const eColor = synapseColor(e.data?.weight ?? 0)
      return {
        ...e,
        type:      e.source === e.target ? 'selfLoop' : (large ? 'lightSynapse' : 'synapse'),
        markerEnd: { type: MarkerType.ArrowClosed, color: eColor },
        style:     large ? { stroke: eColor, strokeWidth: 0.6, opacity: 0.55 } : { stroke: eColor, strokeWidth: 1.5 },
      }
    })

    const updatedNodes: NeuronNode[]  = [...currentNodes.map(n => ({ ...n, selected: false })), ...typedNewNodes]
    const updatedEdges: SynapseEdge[] = [...currentEdges.map(e => ({ ...e, selected: false })), ...typedNewEdges]
    setNodes(updatedNodes); setEdges(updatedEdges)
    emitChange(updatedNodes, updatedEdges)
  }, [readOnly, rfInstance, setNodes, setEdges, emitChange])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return }
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 'c') { e.preventDefault(); copySelected(); return }
      if (mod && e.key === 'v') { e.preventDefault(); pasteClipboard(); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [deleteSelected, copySelected, pasteClipboard])

  const updateNodeData = useCallback(
    (id: string, patch: Partial<NeuronData>) => {
      const currentNodes = rfInstance.getNodes() as NeuronNode[]
      const currentEdges = rfInstance.getEdges() as SynapseEdge[]
      const updated = currentNodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n) as NeuronNode[]
      setNodes(updated)
      emitChange(updated, currentEdges)
    },
    [rfInstance, setNodes, emitChange]
  )

  const updateEdgeData = useCallback(
    (id: string, patch: Partial<SynapseData>) => {
      const currentEdges = rfInstance.getEdges() as SynapseEdge[]
      const currentNodes = rfInstance.getNodes() as NeuronNode[]
      const updated = currentEdges.map(e => {
        if (e.id !== id) return e
        const newData = { ...(e.data ?? {}), ...patch } as SynapseData
        if (patch.weight === undefined) return { ...e, data: newData }
        // arrowhead color is imperative SVG — won't update via React re-render alone
        const color = synapseColor(newData.weight)
        return {
          ...e,
          data:      newData,
          markerEnd: { type: MarkerType.ArrowClosed, color },
          style:     { ...e.style, stroke: color },
        }
      }) as SynapseEdge[]
      setEdges(updated)
      emitChange(currentNodes, updated)
    },
    [rfInstance, setEdges, emitChange]
  )

  const handleSwapEdge = useCallback(
    (id: string) => {
      const currentEdges = rfInstance.getEdges() as SynapseEdge[]
      const currentNodes = rfInstance.getNodes() as NeuronNode[]
      const edge = currentEdges.find(e => e.id === id)
      if (!edge) return
      const newId = `${edge.target}->${edge.source}`
      if (currentEdges.some(e => e.id === newId)) return

      const sh = edge.data?.sourceHandle ?? 'e'
      const th = edge.data?.targetHandle ?? 'w'
      const swapped: SynapseEdge = {
        ...edge,
        id:           newId,
        source:       edge.target,
        target:       edge.source,
        sourceHandle: `${th}-source`,
        targetHandle: `${sh}-target`,
        data:         { ...edge.data, sourceHandle: th, targetHandle: sh } as SynapseData,
      }
      const newEdges = [...currentEdges.filter(e => e.id !== id), swapped]
      setEdges(newEdges)
      emitChange(currentNodes, newEdges)
    },
    [rfInstance, setEdges, emitChange]
  )

  // srcPos/tgtPos null = endpoint is a moving node; apply delta to srcInitial/tgtInitial
  type DragEdge = { id: string; sh: HandlePos; th: HandlePos; weight: number; srcPos: { x: number; y: number } | null; tgtPos: { x: number; y: number } | null; srcInitial: { x: number; y: number } | null; tgtInitial: { x: number; y: number } | null }
  const dragCacheRef    = useRef<DragEdge[] | null>(null)
  const dragIsLargeRef  = useRef(false)
  const dragRafRef      = useRef<number | null>(null)
  const dragNodePosRef  = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const dragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const panCacheRef = useRef<{ edges: PanEdge[]; nodes: PanNodeCentre[] } | null>(null)
  const panRafRef   = useRef<number | null>(null)

  // adjacency map: O(1) connected-edge lookup on drag start instead of O(E) filter
  const adjRef = useRef<Map<string, SynapseEdge[]>>(new Map())
  useEffect(() => {
    const adj = new Map<string, SynapseEdge[]>()
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, [])
      if (!adj.has(e.target)) adj.set(e.target, [])
      adj.get(e.source)!.push(e)
      if (e.source !== e.target) adj.get(e.target)!.push(e)
    }
    adjRef.current = adj
  }, [edges])

  const onNodeDragStart = useCallback((_ev: MouseEvent | TouchEvent, draggedNode: Node) => {
    _isDragging = true
    const allEdges  = rfInstance.getEdges() as SynapseEdge[]
    const allNodes  = rfInstance.getNodes() as NeuronNode[]
    const isLarge   = allNodes.length > LARGE_NODE_THRESHOLD || allEdges.length > LARGE_EDGE_THRESHOLD
    dragIsLargeRef.current  = isLarge
    dragStartPosRef.current = draggedNode.position
    const initialPos = new Map(allNodes.map(n => [n.id, n.position]))
    // ReactFlow defers "deselect others" until mouseup, so selected state is stale when click-dragging a new node
    const draggedWasSelected = allNodes.find(n => n.id === draggedNode.id)?.selected ?? false
    const movingIds  = draggedWasSelected
      ? new Set(allNodes.filter(n => n.selected || n.id === draggedNode.id).map(n => n.id))
      : new Set([draggedNode.id])
    const seen   = new Set<string>()
    const cache: DragEdge[] = []
    for (const nodeId of movingIds) {
      for (const e of adjRef.current.get(nodeId) ?? []) {
        if (seen.has(e.id)) continue
        seen.add(e.id)
        const srcMoving = movingIds.has(e.source)
        const tgtMoving = movingIds.has(e.target)
        cache.push({
          id:     e.id,
          sh:     (e.data?.sourceHandle ?? 'e') as HandlePos,
          th:     (e.data?.targetHandle ?? 'w') as HandlePos,
          weight: e.data?.weight ?? 0,
          srcPos:     srcMoving ? null : (initialPos.get(e.source) ?? null),
          tgtPos:     tgtMoving ? null : (initialPos.get(e.target) ?? null),
          srcInitial: srcMoving ? (initialPos.get(e.source) ?? null) : null,
          tgtInitial: tgtMoving ? (initialPos.get(e.target) ?? null) : null,
        })
      }
    }
    dragCacheRef.current = cache
    if (!isLarge) return
    for (const ce of cache) edgeShowUpdaters.get(ce.id)?.(false)
    const canvas = overlayCanvasRef.current
    if (canvas) {
      const parent = canvas.parentElement!
      canvas.width  = parent.clientWidth
      canvas.height = parent.clientHeight
      canvas.style.display = 'block'
    }
  }, [rfInstance])

  const onNodeDrag = useCallback((_ev: MouseEvent | TouchEvent, draggedNode: Node) => {
    const cache = dragCacheRef.current
    if (!cache) return
    const pos   = (draggedNode as NeuronNode).position
    const start = dragStartPosRef.current
    const dx = pos.x - start.x, dy = pos.y - start.y
    const resolve = (fixed: { x: number; y: number } | null, init: { x: number; y: number } | null) =>
      fixed ?? { x: (init?.x ?? 0) + dx, y: (init?.y ?? 0) + dy }
    if (!dragIsLargeRef.current) {
      for (const ce of cache) {
        const sp = resolve(ce.srcPos, ce.srcInitial)
        const tp = resolve(ce.tgtPos, ce.tgtInitial)
        edgePathUpdaters.get(ce.id)?.(getHandlePath(
          sp.x + HANDLE_XY[ce.sh].x, sp.y + HANDLE_XY[ce.sh].y, ce.sh,
          tp.x + HANDLE_XY[ce.th].x, tp.y + HANDLE_XY[ce.th].y, ce.th,
        ))
      }
      return
    }
    dragNodePosRef.current = pos
    if (dragRafRef.current !== null) return
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null
      const cache  = dragCacheRef.current
      const canvas = overlayCanvasRef.current
      if (!cache || !canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const vp    = rfInstance.getViewport()
      const cur   = dragNodePosRef.current
      const start = dragStartPosRef.current
      const dx = cur.x - start.x, dy = cur.y - start.y
      const resolve = (fixed: { x: number; y: number } | null, init: { x: number; y: number } | null) =>
        fixed ?? { x: (init?.x ?? 0) + dx, y: (init?.y ?? 0) + dy }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.lineWidth   = 0.6
      ctx.globalAlpha = 0.55
      for (const color of [C.inhibitory, C.muted] as const) {
        ctx.strokeStyle = color
        ctx.beginPath()
        for (const ce of cache) {
          if (synapseColor(ce.weight) !== color) continue
          const sp  = resolve(ce.srcPos, ce.srcInitial)
          const tp  = resolve(ce.tgtPos, ce.tgtInitial)
          const fsx = sp.x + HANDLE_XY[ce.sh].x, fsy = sp.y + HANDLE_XY[ce.sh].y
          const ftx = tp.x + HANDLE_XY[ce.th].x, fty = tp.y + HANDLE_XY[ce.th].y
          const sd = HANDLE_DIR[ce.sh], td = HANDLE_DIR[ce.th]
          const fctrl = Math.max(40, Math.hypot(ftx - fsx, fty - fsy) * 0.35)
          ctx.moveTo(fsx * vp.zoom + vp.x, fsy * vp.zoom + vp.y)
          ctx.bezierCurveTo(
            (fsx + sd.dx * fctrl) * vp.zoom + vp.x, (fsy + sd.dy * fctrl) * vp.zoom + vp.y,
            (ftx + td.dx * fctrl) * vp.zoom + vp.x, (fty + td.dy * fctrl) * vp.zoom + vp.y,
            ftx * vp.zoom + vp.x, fty * vp.zoom + vp.y,
          )
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    })
  }, [rfInstance])

  const onNodeDragStop = useCallback((_ev: MouseEvent | TouchEvent, draggedNode: Node) => {
    _isDragging = false
    if (dragRafRef.current !== null) { cancelAnimationFrame(dragRafRef.current); dragRafRef.current = null }
    const cache = dragCacheRef.current
    dragCacheRef.current = null
    if (!dragIsLargeRef.current) return
    if (cache) {
      const pos   = (draggedNode as NeuronNode).position
      const start = dragStartPosRef.current
      const dx = pos.x - start.x, dy = pos.y - start.y
      const resolve = (fixed: { x: number; y: number } | null, init: { x: number; y: number } | null) =>
        fixed ?? { x: (init?.x ?? 0) + dx, y: (init?.y ?? 0) + dy }
      // set SVG paths to final positions before restoring visibility — avoids flash at stale pre-drag coords
      for (const ce of cache) {
        const sp = resolve(ce.srcPos, ce.srcInitial)
        const tp = resolve(ce.tgtPos, ce.tgtInitial)
        edgePathUpdaters.get(ce.id)?.(getHandlePath(
          sp.x + HANDLE_XY[ce.sh].x, sp.y + HANDLE_XY[ce.sh].y, ce.sh,
          tp.x + HANDLE_XY[ce.th].x, tp.y + HANDLE_XY[ce.th].y, ce.th,
        ))
      }
      for (const ce of cache) edgeShowUpdaters.get(ce.id)?.(true)
    }
    requestAnimationFrame(() => {
      const canvas = overlayCanvasRef.current
      if (canvas) canvas.style.display = 'none'
    })
  }, [])

  const onMoveStart = useCallback((ev: MouseEvent | TouchEvent | null) => {
    _isPanning = true
    // Only canvas overlay for pointer-drag pan; scroll-zoom (buttons===0) already performs well
    const isDragPan = ev instanceof TouchEvent || ((ev as MouseEvent | null)?.buttons ?? 0) > 0
    if (!isDragPan) return
    const allEdges = rfInstance.getEdges() as SynapseEdge[]
    const allNodes = rfInstance.getNodes() as NeuronNode[]
    if (allNodes.length <= LARGE_NODE_THRESHOLD && allEdges.length <= LARGE_EDGE_THRESHOLD) return
    const posMap = new Map(allNodes.map(n => [n.id, n.position]))
    panCacheRef.current = {
      edges: allEdges.flatMap(e => {
        const src = posMap.get(e.source), tgt = posMap.get(e.target)
        if (!src || !tgt) return []
        const sh = (e.data?.sourceHandle ?? 'e') as HandlePos
        const th = (e.data?.targetHandle ?? 'w') as HandlePos
        return [{ fsx: src.x + HANDLE_XY[sh].x, fsy: src.y + HANDLE_XY[sh].y,
                  ftx: tgt.x + HANDLE_XY[th].x, fty: tgt.y + HANDLE_XY[th].y,
                  sh, th, weight: e.data?.weight ?? 0 }]
      }),
      nodes: allNodes.map(n => ({ cx: n.position.x + NODE_W / 2, cy: n.position.y + NODE_H / 2 })),
    }
    for (const fn of edgeShowUpdaters.values()) fn(false)
    const canvas = overlayCanvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement!
    canvas.width  = parent.clientWidth
    canvas.height = parent.clientHeight
    canvas.style.display = 'block'
    const ctx = canvas.getContext('2d')
    if (ctx) drawPanFrame(ctx, panCacheRef.current.edges, panCacheRef.current.nodes, rfInstance.getViewport())
  }, [rfInstance])

  const onPanMove = useCallback(() => {
    const cache = panCacheRef.current
    if (!cache || panRafRef.current !== null) return
    panRafRef.current = requestAnimationFrame(() => {
      panRafRef.current = null
      const canvas = overlayCanvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawPanFrame(ctx, cache.edges, cache.nodes, rfInstance.getViewport())
    })
  }, [rfInstance])

  const onMoveEnd = useCallback(() => {
    _isPanning = false
    if (panRafRef.current !== null) { cancelAnimationFrame(panRafRef.current); panRafRef.current = null }
    const cache = panCacheRef.current
    panCacheRef.current = null
    if (!cache) return
    for (const fn of edgeShowUpdaters.values()) fn(true)
    requestAnimationFrame(() => {
      const canvas = overlayCanvasRef.current
      if (canvas) canvas.style.display = 'none'
    })
  }, [])

  const handleExport = () => {
    if (!network) return
    const exported = rfToNetwork(nodes, edges, network)
    const posMap = new Map(nodes.map(n => [n.data.nodeId, n.position]))
    const withCoords: RispNetwork = {
      ...exported,
      Nodes: exported.Nodes.map(n => {
        const pos = posMap.get(n.id)
        return pos ? { ...n, coords: pos } : n
      }),
    }
    const blob = new Blob([JSON.stringify(withCoords, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'network.json'; a.click()
    // Revoke after a tick so the browser has time to initiate the download
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  const { selectedNodes, selectedEdges, selNode, selEdge } = useMemo(() => {
    const sn = nodes.filter(n => n.selected)
    const se = edges.filter(e => e.selected)
    return {
      selectedNodes: sn, selectedEdges: se,
      selNode: sn.length === 1 && se.length === 0 ? sn[0] : undefined,
      selEdge: se.length === 1 && sn.length === 0 ? se[0] : undefined,
    }
  }, [nodes, edges])
  const isMultiSelect = selectedNodes.length + selectedEdges.length > 1

  // deselect only auto-selected edges on node deselect; preserve manually-clicked ones
  const autoSelectedEdgesRef = useRef<Set<string>>(new Set())
  const selectedNodeKey = useMemo(
    () => nodes.filter(n => n.selected).map(n => n.id).join(','),
    [nodes]
  )
  useEffect(() => {
    const ids = new Set(selectedNodeKey.split(',').filter(Boolean))
    const prevAuto = autoSelectedEdgesRef.current
    const nextAuto = new Set<string>()
    setEdges(curr => {
      let dirty = false
      const next = curr.map(e => {
        const want = ids.size >= 2 && ids.has(e.source) && ids.has(e.target)
        if (want) nextAuto.add(e.id)
        if (want && !e.selected)              { dirty = true; return { ...e, selected: true  } }
        if (!want && prevAuto.has(e.id) && e.selected) { dirty = true; return { ...e, selected: false } }
        return e
      })
      autoSelectedEdgesRef.current = nextAuto
      return dirty ? next : curr
    })
  }, [selectedNodeKey, setEdges])

  // Skip the O(n) regex scan entirely when no node is selected (e.g. during sim playback).
  const existingNames = useMemo(
    () => {
      if (!selNode) return new Set<string>()
      return new Set(
        nodes
          .filter(n => n.id !== selNode.id)
          .map(n => extractName(n.data.label, n.data.nodeId))
          .filter((name): name is string => name !== undefined)
      )
    },
    [nodes, selNode]
  )
  const { inCount, outCount } = useMemo(() => {
    if (!selNode) return { inCount: 0, outCount: 0 }
    let inc = 0, out = 0
    for (const e of edges) {
      if (e.target === selNode.id) inc++
      if (e.source === selNode.id) out++
    }
    return { inCount: inc, outCount: out }
  }, [selNode, edges])

  const swapBlocked = useMemo(
    () => selEdge ? edges.some(e => e.id === `${selEdge.target}->${selEdge.source}`) : false,
    [selEdge, edges]
  )
  const proc           = network?.Associated_Data?.proc_params
  const isLargeNetwork = nodes.length > LARGE_NODE_THRESHOLD || edges.length > LARGE_EDGE_THRESHOLD

  return (
    <div className="border border-border">

      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-2xs text-text-muted tracking-widest uppercase">Network Graph</span>
          {!readOnly && network && (
            <div className="flex items-center gap-1.5">
              <PaletteChip nodeType="neuron" label="neuron" color={C.muted}   />
              <PaletteChip nodeType="input"  label="input"  color={C.input}   />
              <PaletteChip nodeType="output" label="output" color={C.output}  />
            </div>
          )}
        </div>
        {network && (
          <div className="flex items-center gap-4">
            {!readOnly && (
              <button
                onClick={() => setHelpOpen(v => !v)}
                className={`font-mono text-2xs transition-colors ${helpOpen ? 'text-text-secondary' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {helpOpen ? 'help ↑' : 'help ↓'}
              </button>
            )}
            <button
              onClick={handleExport}
              className="font-mono text-2xs text-text-muted hover:text-text-secondary transition-colors"
            >
              export json ↓
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {helpOpen && !readOnly && <HelpPanel onClose={() => setHelpOpen(false)} />}
      </AnimatePresence>

      <div
        style={{ height: 560, background: C.bg, position: 'relative' }}
        onDrop={!readOnly && network ? onDrop : undefined}
        onDragOver={!readOnly && network ? onDragOver : undefined}
      >
        <canvas
          ref={overlayCanvasRef}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'none', zIndex: 10 }}
        />
        {!network ? (
          <div
            className="h-full flex items-center justify-center"
            style={{ backgroundImage: `radial-gradient(${C.border} 1px, transparent 1px)`, backgroundSize: '20px 20px' }}
          >
            <span className="font-mono text-xs text-text-muted opacity-20">no network loaded</span>
          </div>
        ) : (
          <SimVisualsContext.Provider value={simStore}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={readOnly ? undefined : onConnect}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.05}
              maxZoom={4}
              zoomOnDoubleClick={false}
              deleteKeyCode={null}
              multiSelectionKeyCode="Shift"
              proOptions={{ hideAttribution: true }}
              colorMode="dark"
              // Large-network performance: disable expensive features to keep panning smooth
              onNodeDragStart={onNodeDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onMoveStart={onMoveStart}
              onMove={onPanMove}
              onMoveEnd={onMoveEnd}
              nodesFocusable={!isLargeNetwork}
              edgesFocusable={!isLargeNetwork}
              elevateEdgesOnSelect={!isLargeNetwork}
              disableKeyboardA11y={isLargeNetwork}
              autoPanOnNodeDrag={!isLargeNetwork}
            >
              <Background variant={BackgroundVariant.Dots} gap={32} size={1.5} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </SimVisualsContext.Provider>
        )}
      </div>

      {!readOnly && (
        <Inspector
          node={selNode}
          edge={selEdge}
          proc={proc}
          onNodeChange={updateNodeData}
          onEdgeChange={updateEdgeData}
          onDelete={deleteSelected}
          onSwapEdge={handleSwapEdge}
          swapBlocked={swapBlocked}
          isMultiSelect={isMultiSelect}
          multiSelectCounts={{ nodes: selectedNodes.length, edges: selectedEdges.length }}
          existingNames={existingNames}
          inCount={inCount}
          outCount={outCount}
          nodes={nodes}
        />
      )}
    </div>
  )
})

const NetworkCanvas = forwardRef<NetworkCanvasHandle, Props>(function NetworkCanvas(props, ref) {
  return (
    <ReactFlowProvider>
      <NetworkCanvasInner {...props} ref={ref} />
    </ReactFlowProvider>
  )
})

export default NetworkCanvas
