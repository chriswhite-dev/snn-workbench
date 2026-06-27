// lastExportedRef breaks the feedback loop when the parent reflects our own emitted
// change back as a prop update. SimVisualsContext is a pub-sub store so simulation
// ticks bypass setNodes/setEdges — only the affected components re-render.
import { createContext, memo, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  BaseEdge,
  getBezierPath,
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
import type { RispNetwork } from '@shared/types'
import type { SpikeTransit } from '../../hooks/useSimulation'

const C = {
  bg:      '#111009',
  surface: '#1f1d19',
  border:  '#3a3728',
  muted:   '#9e8f7e',
  accent:  '#d4622a',
  input:   '#cbbcac',
  output:  '#7a9d8f',
} as const

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
  weight:     number
  delay:      number
  particles?: ParticleData[]
}

type NeuronNode  = Node<NeuronData>
type SynapseEdge = Edge<SynapseData>

const NODE_W      = 44
const NODE_H      = 44
const GAP_X       = 140
const GAP_Y       = 110
const ROWS_PER_COL = 16

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
  const positions = new Map<number, { x: number; y: number }>()
  const inputSet  = new Set(network.Inputs)
  const outputSet = new Set(network.Outputs)
  const inputs    = network.Nodes.filter(n =>  inputSet.has(n.id))
  const outputs   = network.Nodes.filter(n => outputSet.has(n.id))
  const hidden    = network.Nodes.filter(n => !inputSet.has(n.id) && !outputSet.has(n.id))

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
function parseCubicBezier(path: string): [number, number, number, number, number, number, number, number] | null {
  const N   = '(-?\\d+(?:\\.\\d+)?)'
  const SEP = '[,\\s]+'
  const re  = new RegExp(`M\\s*${N}${SEP}${N}\\s*C\\s*${N}${SEP}${N}${SEP}${N}${SEP}${N}${SEP}${N}${SEP}${N}`)
  const m   = path.match(re)
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

const LARGE_NODE_THRESHOLD = 80
const LARGE_EDGE_THRESHOLD = 200

function isLargeNet(network: RispNetwork): boolean {
  return network.Nodes.length > LARGE_NODE_THRESHOLD || network.Edges.length > LARGE_EDGE_THRESHOLD
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

  const edges: SynapseEdge[] = network.Edges.map(e => ({
    id:        `${e.from}->${e.to}`,
    source:    String(e.from),
    target:    String(e.to),
    // Large mode: built-in straight type — no custom component, no getBezierPath, no particle subscriptions
    type:      largeMode ? 'straight' : (e.from === e.to ? 'selfLoop' : 'synapse'),
    markerEnd: largeMode ? undefined : { type: MarkerType.ArrowClosed, color: C.muted },
    style:     { stroke: C.muted, strokeWidth: largeMode ? 0.6 : 1.5, opacity: largeMode ? 0.55 : 1 },
    data:      { weight: e.values[0] ?? 0, delay: e.values[1] ?? 1, particles: [] },
  }))

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
  }))
  return {
    ...base,
    Nodes:   newNodes,
    Edges:   newEdges,
    Inputs:  inputs.sort((a, b) => a - b),
    Outputs: outputs.sort((a, b) => a - b),
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

function SelfLoopEdgeInner({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, selected }: EdgeProps) {
  const store = useContext(SimVisualsContext)
  const particles = useSyncExternalStore(
    useCallback((fn: () => void) => store.subscribeEdge(id, fn), [store, id]),
    () => store.getParticles(id)
  )
  const arcH = 44
  const d = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY - arcH}, ${targetX} ${targetY - arcH}, ${targetX} ${targetY}`
  const edgeStyle = selected ? { ...style, stroke: C.accent, strokeWidth: 2 } : style
  return (
    <>
      <BaseEdge id={id} path={d} style={edgeStyle} markerEnd={markerEnd as string} />
      <EdgeParticles path={d} particles={particles} />
    </>
  )
}

const SelfLoopEdge = memo(SelfLoopEdgeInner, (prev, next) =>
  prev.sourceX === next.sourceX && prev.sourceY === next.sourceY &&
  prev.targetX === next.targetX && prev.targetY === next.targetY &&
  prev.selected === next.selected
)

function AnimatedSynapseEdgeInner({
  id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  style, markerEnd, selected,
}: EdgeProps) {
  const store = useContext(SimVisualsContext)
  const particles = useSyncExternalStore(
    useCallback((fn: () => void) => store.subscribeEdge(id, fn), [store, id]),
    () => store.getParticles(id)
  )
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const edgeStyle = selected ? { ...style, stroke: C.accent, strokeWidth: 2 } : style
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={edgeStyle} markerEnd={markerEnd as string} />
      <EdgeParticles path={edgePath} particles={particles} />
    </>
  )
}

const AnimatedSynapseEdge = memo(AnimatedSynapseEdgeInner, (prev, next) =>
  prev.sourceX === next.sourceX && prev.sourceY === next.sourceY &&
  prev.targetX === next.targetX && prev.targetY === next.targetY &&
  prev.sourcePosition === next.sourcePosition && prev.targetPosition === next.targetPosition &&
  prev.selected === next.selected
)

const HANDLE_STYLE = { width: 6, height: 6, borderRadius: '50%', background: C.surface, border: `1px solid ${C.muted}` }

function NeuronNodeInner({ data, selected }: NodeProps) {
  const d = data as NeuronData
  const store = useContext(SimVisualsContext)
  // isSpiking comes from the store, not from data — avoids a setNodes call on every sim tick
  const isSpiking = useSyncExternalStore(
    useCallback((fn: () => void) => store.subscribeNode(d.nodeId, fn), [store, d.nodeId]),
    () => store.getSpikingSet().has(d.nodeId)
  )
  const border = selected ? C.accent : d.isInput ? C.input : d.isOutput ? C.output : C.border
  const color  = d.isInput ? C.input : d.isOutput ? C.output : C.muted
  const nodeBg = d.isInput ? '#2a1f14' : d.isOutput ? '#131f1c' : C.bg
  return (
    <div style={{
      width: NODE_W, height: NODE_H, border: `1px solid ${border}`,
      background: nodeBg, borderRadius: NODE_H / 2,
      display: 'flex', alignItems: 'center',
      justifyContent: 'center', position: 'relative',
      boxShadow: isSpiking ? `0 0 0 1px ${C.accent}, 0 0 10px rgba(212, 98, 42, 0.55)` : 'none',
      transition: 'box-shadow 60ms ease',
    }}>
      <Handle type="target" position={Position.Left}  style={HANDLE_STYLE} />
      <span style={{
        fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color,
        userSelect: 'none', lineHeight: 1,
      }}>
        {d.nodeId}
      </span>
      {(d.isInput || d.isOutput) && (
        <span style={{
          position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)',
          fontFamily: '"JetBrains Mono", monospace', fontSize: 6,
          color: d.isInput ? C.input : C.output, whiteSpace: 'nowrap',
        }}>
          {d.isInput ? 'IN' : 'OUT'}
        </span>
      )}
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
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
  const color = d.isInput ? C.input : d.isOutput ? C.output : C.muted
  const lightBg = d.isInput ? '#2a1f14' : d.isOutput ? '#131f1c' : C.bg
  return (
    <div style={{
      width: NODE_W, height: NODE_H,
      border: `1px solid ${selected ? C.accent : C.border}`,
      background: lightBg, borderRadius: NODE_H / 2,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Handle type="target" position={Position.Left}  style={HANDLE_STYLE} />
      <span style={{
        fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color,
        userSelect: 'none', lineHeight: 1,
      }}>
        {d.nodeId}
      </span>
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
    </div>
  )
}

const LightNeuronNode = memo(LightNeuronNodeInner, (prev, next) => {
  const pd = prev.data as NeuronData, nd = next.data as NeuronData
  return pd.label    === nd.label    && pd.isInput  === nd.isInput &&
         pd.isOutput === nd.isOutput && prev.selected === next.selected
})

const nodeTypes = { neuron: NeuronNode, lightNeuron: LightNeuronNode }
const edgeTypes = { synapse: AnimatedSynapseEdge, selfLoop: SelfLoopEdge }

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
      </div>
    </motion.div>
  )
}

function NumericInput({
  value, min, max, isInteger = false, className, onChange,
}: {
  value:      number
  min:        number
  max:        number
  isInteger?: boolean
  className?: string
  onChange:   (v: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const savedRef = useRef<number>(value)

  useEffect(() => { setDraft(String(value)) }, [value])

  function clampDefault(): number {
    // Default to 1 clamped into [min, max]; if max < 1, use max
    return Math.min(max, Math.max(min, 1))
  }

  function commit(str: string) {
    if (str.trim() === '') {
      setDraft(String(savedRef.current))
      onChange(savedRef.current)
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
      className={className}
      onFocus={() => { savedRef.current = value }}
      onChange={e => setDraft(e.target.value)}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter')  { commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur() }
        if (e.key === 'Escape') { setDraft(String(savedRef.current)); onChange(savedRef.current); (e.target as HTMLInputElement).blur() }
      }}
    />
  )
}

interface InspectorProps {
  node?:        NeuronNode
  edge?:        SynapseEdge
  proc:         RispNetwork['Associated_Data']['proc_params']
  onNodeChange: (id: string, patch: Partial<NeuronData>) => void
  onEdgeChange: (id: string, patch: Partial<SynapseData>) => void
  onDelete:     () => void
}

const fieldCls = 'w-full px-2 py-1 font-mono text-xs bg-bg border border-border text-text-primary focus:outline-none focus:border-text-muted'

function NodeFields({ node, proc, onNodeChange, onDelete }: {
  node:         NeuronNode
  proc:         InspectorProps['proc']
  onNodeChange: InspectorProps['onNodeChange']
  onDelete:     InspectorProps['onDelete']
}) {
  const d           = node.data
  const minT        = proc?.min_threshold ?? -127
  const maxT        = proc?.max_threshold ?? 127
  const currentName = extractName(d.label, d.nodeId) ?? ''
  return (
    <>
      <div>
        <label className="font-mono text-2xs text-text-muted block mb-1">name</label>
        <input
          value={currentName}
          placeholder={String(d.nodeId)}
          onChange={e => {
            const v = e.target.value.trim()
            onNodeChange(node.id, { label: makeLabel(d.nodeId, v || undefined) })
          }}
          className={fieldCls}
        />
      </div>
      <div>
        <label className="font-mono text-2xs text-text-muted block mb-1">
          threshold [{minT},{maxT}]
        </label>
        <NumericInput
          value={d.threshold} min={minT} max={maxT} isInteger={proc?.discrete ?? false}
          onChange={v => onNodeChange(node.id, { threshold: v })}
          className={fieldCls}
        />
      </div>
      <div>
        <label className="font-mono text-2xs text-text-muted block mb-1">input node</label>
        <button
          onClick={() => onNodeChange(node.id, { isInput: !d.isInput })}
          className={`px-3 py-1 font-mono text-xs border transition-colors ${d.isInput ? 'border-text-secondary text-text-secondary' : 'border-border text-text-muted hover:border-text-muted'}`}
        >
          {d.isInput ? 'yes' : 'no'}
        </button>
      </div>
      <div>
        <label className="font-mono text-2xs text-text-muted block mb-1">output node</label>
        <button
          onClick={() => onNodeChange(node.id, { isOutput: !d.isOutput })}
          className={`px-3 py-1 font-mono text-xs border transition-colors ${d.isOutput ? 'border-text-secondary text-text-secondary' : 'border-border text-text-muted hover:border-text-muted'}`}
        >
          {d.isOutput ? 'yes' : 'no'}
        </button>
      </div>
      <div className="col-span-2 sm:col-span-4 flex justify-end">
        <button onClick={onDelete} className="font-mono text-2xs text-text-muted hover:text-accent transition-colors">
          delete node →
        </button>
      </div>
    </>
  )
}

function EdgeFields({ edge, proc, onEdgeChange, onDelete }: {
  edge:         SynapseEdge
  proc:         InspectorProps['proc']
  onEdgeChange: InspectorProps['onEdgeChange']
  onDelete:     InspectorProps['onDelete']
}) {
  const d    = edge.data ?? { weight: 0, delay: 1 }
  const minW = proc?.min_weight ?? -127
  const maxW = proc?.max_weight ?? 127
  const maxD = proc?.max_delay  ?? 127
  return (
    <>
      <div>
        <label className="font-mono text-2xs text-text-muted block mb-1">
          weight [{minW},{maxW}]
        </label>
        <NumericInput
          value={d.weight} min={minW} max={maxW} isInteger={proc?.discrete ?? false}
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
          onChange={v => onEdgeChange(edge.id, { delay: v })}
          className={fieldCls}
        />
      </div>
      <div className="flex items-end">
        <span className="font-mono text-2xs text-text-muted">{edge.source} → {edge.target}</span>
      </div>
      <div className="flex items-end justify-end">
        <button onClick={onDelete} className="font-mono text-2xs text-text-muted hover:text-accent transition-colors">
          delete edge →
        </button>
      </div>
    </>
  )
}

function Inspector({ node, edge, proc, onNodeChange, onEdgeChange, onDelete }: InspectorProps) {
  if (!node && !edge) return null
  return (
    <div className="border-t border-border p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
      {node && <NodeFields node={node} proc={proc} onNodeChange={onNodeChange} onDelete={onDelete} />}
      {edge && <EdgeFields edge={edge} proc={proc} onEdgeChange={onEdgeChange} onDelete={onDelete} />}
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
  spikingNodeIds?:    number[]
  spikeTransits?:     SpikeTransit[]
}

function NetworkCanvasInner({
  network, onChange, readOnly = false,
  externalSelection, spikingNodeIds, spikeTransits,
}: Props) {
  const rfInstance = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<NeuronNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<SynapseEdge>([])
  const [selNodeId, setSelNodeId] = useState<string | null>(null)
  const [selEdgeId, setSelEdgeId] = useState<string | null>(null)
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
      setNodes([]); setEdges([]); setSelNodeId(null); setSelEdgeId(null)
      bezierPathCache.clear()
      return
    }
    if (network === lastExportedRef.current) return
    bezierPathCache.clear()
    const large = isLargeNet(network)
    const posMap = autoLayout(network)
    const { nodes: rn, edges: re } = networkToRF(network, posMap, large)
    setNodes(rn); setEdges(re); setSelNodeId(null); setSelEdgeId(null)
  }, [network, setNodes, setEdges])

  // Only creates new objects for the toggled node/edge so React skips re-renders on unaffected items.
  useEffect(() => {
    if (!externalSelection) return
    const { nodeId, edgeId } = externalSelection
    if (nodeId != null) {
      setSelNodeId(nodeId); setSelEdgeId(null)
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
      setSelEdgeId(edgeId); setSelNodeId(null)
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

  useEffect(() => {
    const store       = simStoreRef.current
    const prevSpiking = store.spikingSet
    const newSpiking  = spikingNodeIds?.length ? new Set(spikingNodeIds) : EMPTY_SPIKING
    store.spikingSet  = newSpiking

    const byEdge = new Map<string, ParticleData[]>()
    for (const tr of spikeTransits ?? []) {
      const list = byEdge.get(tr.edgeId) ?? []
      list.push({ id: `${tr.edgeId}-${tr.launchedAt}`, progress: tr.progress })
      byEdge.set(tr.edgeId, list)
    }
    const prevParticles = store.particles
    store.particles = byEdge

    for (const id of prevSpiking) { if (!newSpiking.has(id)) store.nodeListeners.get(id)?.forEach(fn => fn()) }
    for (const id of newSpiking)  { if (!prevSpiking.has(id)) store.nodeListeners.get(id)?.forEach(fn => fn()) }

    const changedEdgeIds = new Set([...prevParticles.keys(), ...byEdge.keys()])
    for (const edgeId of changedEdgeIds) {
      if (prevParticles.get(edgeId) !== byEdge.get(edgeId)) {
        store.edgeListeners.get(edgeId)?.forEach(fn => fn())
      }
    }
  }, [spikingNodeIds, spikeTransits])

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
      const isSelf          = connection.source === connection.target
      const large           = currentNodes.length > LARGE_NODE_THRESHOLD || currentEdges.length > LARGE_EDGE_THRESHOLD
      const newEdge: SynapseEdge = {
        ...connection,
        id:        `${connection.source}->${connection.target}`,
        type:      isSelf ? 'selfLoop' : (large ? 'straight' : 'synapse'),
        markerEnd: large ? undefined : { type: MarkerType.ArrowClosed, color: C.muted },
        style:     { stroke: C.muted, strokeWidth: large ? 0.6 : 1.5, opacity: large ? 0.55 : 1 },
        data:      { weight: defaultWeight, delay: 1, particles: [] },
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
    if (selNodeId) {
      const currentNodes = rfInstance.getNodes() as NeuronNode[]
      const currentEdges = rfInstance.getEdges() as SynapseEdge[]
      const updatedNodes = currentNodes.filter(n => n.id !== selNodeId)
      const updatedEdges = currentEdges.filter(e => e.source !== selNodeId && e.target !== selNodeId)
      setNodes(updatedNodes); setEdges(updatedEdges)
      emitChange(updatedNodes, updatedEdges)
      setSelNodeId(null)
    } else if (selEdgeId) {
      const currentEdges = rfInstance.getEdges() as SynapseEdge[]
      const currentNodes = rfInstance.getNodes() as NeuronNode[]
      const updatedEdges = currentEdges.filter(e => e.id !== selEdgeId)
      setEdges(updatedEdges)
      emitChange(currentNodes, updatedEdges)
      setSelEdgeId(null)
    }
  }, [readOnly, selNodeId, selEdgeId, rfInstance, setNodes, setEdges, emitChange])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [deleteSelected])

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
      const updated = currentEdges.map(e =>
        e.id === id ? { ...e, data: { ...(e.data ?? {}), ...patch } as SynapseData } : e
      ) as SynapseEdge[]
      setEdges(updated)
      emitChange(currentNodes, updated)
    },
    [rfInstance, setEdges, emitChange]
  )

  const handleExport = () => {
    if (!network) return
    const exported = rfToNetwork(nodes, edges, network)
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'network.json'; a.click()
    // Revoke after a tick so the browser has time to initiate the download
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  const selNode        = selNodeId ? nodes.find(n => n.id === selNodeId) : undefined
  const selEdge        = selEdgeId ? edges.find(e => e.id === selEdgeId) : undefined
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
        style={{ height: 560, background: C.bg }}
        onDrop={!readOnly && network ? onDrop : undefined}
        onDragOver={!readOnly && network ? onDragOver : undefined}
      >
        {!network ? (
          <div className="h-full flex items-center justify-center">
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
              onPaneClick={() => { setSelNodeId(null); setSelEdgeId(null) }}
              onNodeClick={(_, node) => { setSelNodeId(node.id); setSelEdgeId(null) }}
              onEdgeClick={(_, edge) => { setSelEdgeId(edge.id); setSelNodeId(null) }}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.05}
              maxZoom={4}
              zoomOnDoubleClick={false}
              deleteKeyCode={null}
              proOptions={{ hideAttribution: true }}
              colorMode="dark"
              // Large-network performance: disable expensive features to keep panning smooth
              onlyRenderVisibleElements={isLargeNetwork}
              nodesFocusable={!isLargeNetwork}
              edgesFocusable={!isLargeNetwork}
              elevateEdgesOnSelect={!isLargeNetwork}
              nodesDraggable={!isLargeNetwork}
              disableKeyboardA11y={isLargeNetwork}
              autoPanOnNodeDrag={!isLargeNetwork}
            >
              {!isLargeNetwork && <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={C.border} />}
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
        />
      )}
    </div>
  )
}

export default function NetworkCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <NetworkCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
