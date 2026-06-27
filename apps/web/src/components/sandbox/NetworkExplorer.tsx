import type { RispNetwork } from '@shared/types'

interface Props {
  network: RispNetwork
  selNodeId: string | null
  selEdgeId: string | null
  onSelectNode: (id: string) => void
  onSelectEdge: (id: string) => void
}

export default function NetworkExplorer({
  network,
  selNodeId,
  selEdgeId,
  onSelectNode,
  onSelectEdge,
}: Props) {
  const inputSet = new Set(network.Inputs)
  const outputSet = new Set(network.Outputs)

  const sortedNodes = [...network.Nodes].sort((a, b) => a.id - b.id)
  const sortedEdges = [...network.Edges].sort((a, b) =>
    a.from !== b.from ? a.from - b.from : a.to - b.to
  )

  const rowCls = (active: boolean) =>
    `w-full flex items-center gap-2 px-3 py-1 font-mono text-2xs text-left transition-colors ${
      active
        ? 'bg-raised text-accent'
        : 'text-text-muted hover:bg-raised hover:text-text-secondary'
    }`

  return (
    <div
      className="border border-border flex flex-col overflow-hidden"
      style={{ minHeight: 220 }}
    >
      <div className="px-3 py-2 border-b border-border flex-shrink-0 flex items-center justify-between bg-bg">
        <span className="font-mono text-2xs text-text-muted tracking-widest uppercase">
          Network Explorer
        </span>
        <span className="font-mono text-2xs text-text-muted opacity-50">
          {network.Nodes.length} nodes · {network.Edges.length} synapses
        </span>
      </div>

      <div className="grid flex-1 min-h-0" style={{ gridTemplateColumns: '1fr 1fr' }}>

        {/* Node list */}
        <div className="flex flex-col min-h-0 border-r border-border">
          <div className="px-3 py-1 border-b border-border flex-shrink-0 bg-bg">
            <span className="font-mono text-2xs text-text-muted">nodes</span>
          </div>
          <div className="flex-1 overflow-y-auto bg-bg">
            {sortedNodes.map(n => {
              const isIn = inputSet.has(n.id)
              const isOut = outputSet.has(n.id)
              const label = n.name ? `${n.id} (${n.name})` : String(n.id)
              return (
                <button
                  key={n.id}
                  onClick={() => onSelectNode(String(n.id))}
                  className={rowCls(selNodeId === String(n.id))}
                >
                  <span className="flex-1 truncate">{label}</span>
                  {isIn && <span className="flex-shrink-0 opacity-50">IN</span>}
                  {isOut && <span className="flex-shrink-0 opacity-50">OUT</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Synapse list */}
        <div className="flex flex-col min-h-0">
          <div className="px-3 py-1 border-b border-border flex-shrink-0 bg-bg">
            <span className="font-mono text-2xs text-text-muted">synapses</span>
          </div>
          <div className="flex-1 overflow-y-auto bg-bg">
            {sortedEdges.map((e, i) => {
              const edgeId = `${e.from}->${e.to}`
              const weight = e.values[0] ?? 0
              const delay = e.values[1] ?? 1
              return (
                <button
                  key={i}
                  onClick={() => onSelectEdge(edgeId)}
                  className={rowCls(selEdgeId === edgeId)}
                >
                  <span className="flex-1 truncate">{e.from}→{e.to}</span>
                  <span className="flex-shrink-0 opacity-50">
                    w:{weight} d:{delay}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}
