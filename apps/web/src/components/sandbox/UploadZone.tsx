import { useCallback, useState } from 'react'
import type { RispNetwork, RispProcParams } from '@shared/types'

function validateFrameworkNetwork(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return 'Expected a JSON object'
  }
  const j = json as Record<string, unknown>

  if ('nodes' in j || 'edges' in j || 'proc_params' in j) {
    return (
      'Old RISP format detected (lowercase keys). ' +
      'Please use the framework-native format (Nodes/Edges/Properties/Associated_Data).'
    )
  }
  if (!j.Properties || typeof j.Properties !== 'object' || Array.isArray(j.Properties)) {
    return 'Missing or invalid "Properties" block'
  }
  if (!Array.isArray(j.Nodes)) return 'Missing or invalid "Nodes" array'
  if (!Array.isArray(j.Edges)) return 'Missing or invalid "Edges" array'
  if (!Array.isArray(j.Inputs)) return 'Missing or invalid "Inputs" array'
  if (!Array.isArray(j.Outputs)) return 'Missing or invalid "Outputs" array'
  if (j.Nodes.length === 0) return 'Network must have at least one node'

  return null
}

const DEFAULT_PROC_PARAMS: RispProcParams = {
  discrete: true,
  max_delay: 127,
  min_threshold: 1,
  max_threshold: 127,
  min_weight: -127,
  max_weight: 127,
  min_potential: -127,
}

function sanitizeNetwork(raw: Record<string, unknown>): RispNetwork {
  const nodes = (raw.Nodes as Array<Record<string, unknown>>).map((n) => {
    const node: RispNetwork['Nodes'][number] = {
      id: n.id as number,
      values: n.values as number[],
    }
    if (typeof n.name === 'string' && n.name) node.name = n.name
    const c = n.coords as Record<string, unknown> | undefined
    if (c && typeof c.x === 'number' && typeof c.y === 'number') {
      node.coords = { x: c.x, y: c.y }
    }
    return node
  })

  const edges = (raw.Edges as Array<Record<string, unknown>>).map((e) => ({
    from: e.from as number,
    to: e.to as number,
    values: e.values as number[],
  }))

  // Strips app_params, eons_params, encoder/decoder_array, other.app_name; fills default proc_params if absent.
  const rawAD = ((raw.Associated_Data ?? {}) as Record<string, unknown>)
  const associated: RispNetwork['Associated_Data'] = {}

  associated.proc_params =
    rawAD.proc_params && typeof rawAD.proc_params === 'object'
      ? (rawAD.proc_params as RispProcParams)
      : DEFAULT_PROC_PARAMS

  if (rawAD.other && typeof rawAD.other === 'object' && !Array.isArray(rawAD.other)) {
    const o = rawAD.other as Record<string, unknown>
    const kept: RispNetwork['Associated_Data']['other'] = {}
    if (typeof o.proc_name === 'string') kept.proc_name = o.proc_name
    if (typeof o.sim_time === 'number') kept.sim_time = o.sim_time
    if (typeof o.timeseries === 'string') kept.timeseries = o.timeseries
    if (Object.keys(kept).length > 0) associated.other = kept
  }

  return {
    Properties: raw.Properties as RispNetwork['Properties'],
    Nodes: nodes,
    Edges: edges,
    Inputs: raw.Inputs as number[],
    Outputs: raw.Outputs as number[],
    Network_Values: Array.isArray(raw.Network_Values) ? (raw.Network_Values as number[]) : [],
    Associated_Data: associated,
  }
}

interface Props {
  onLoad: (network: RispNetwork, file: File) => void
}

export default function UploadZone({ onLoad }: Props) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(
    (file: File) => {
      setError(null)
      if (!file.name.endsWith('.json')) {
        setError('Only .json files accepted')
        return
      }
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const raw = JSON.parse(e.target?.result as string)
          const err = validateFrameworkNetwork(raw)
          if (err) { setError(err); return }

          const cleaned = sanitizeNetwork(raw as Record<string, unknown>)
          const cleanedStr = JSON.stringify(cleaned)
          const blob = new Blob([cleanedStr], { type: 'application/json' })
          const cleanFile = new File([blob], file.name, { type: 'application/json' })

          onLoad(cleaned, cleanFile)
        } catch {
          setError('Failed to parse JSON')
        }
      }
      reader.readAsText(file)
    },
    [onLoad]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`border py-14 px-8 text-center transition-colors ${
        dragging ? 'border-accent bg-raised' : 'border-border hover:border-text-muted'
      }`}
    >
      <p className="font-mono text-sm text-text-secondary mb-1">
        Drop a RISP network JSON file
      </p>
      <p className="font-mono text-xs text-text-muted mb-5">or select from disk</p>
      <label className="font-mono text-xs text-text-muted border border-border px-4 py-2 hover:border-text-muted hover:text-text-secondary transition-colors cursor-pointer">
        Browse files
        <input
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />
      </label>
      {error && (
        <p className="mt-4 font-mono text-xs text-text-muted max-w-sm mx-auto">{error}</p>
      )}
    </div>
  )
}
