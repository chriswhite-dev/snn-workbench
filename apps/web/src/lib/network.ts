import type { RispNetwork, RispProcParams, RispPropertyPack } from '@shared/types'

// ASCII type codes from the framework spec: 'D'=68 (double), 'I'=73 (integer), 'B'=66 (boolean)
const T_DOUBLE = 68
const T_INT    = 73
const T_BOOL   = 66

// Must exactly replicate RISP's get_network_properties() — WASM validates an exact match on load.
export function syncProperties(params: RispProcParams): RispPropertyPack {
  const numType = params.discrete ? T_INT : T_DOUBLE

  const node_properties = [
    { name: 'Threshold', type: numType, index: 0, size: 1,
      min_value: params.min_threshold, max_value: params.max_threshold },
    ...(params.leak_mode === 'configurable'
      ? [{ name: 'Leak', type: T_BOOL, index: 1, size: 1, min_value: 0, max_value: 1 }]
      : []),
  ]

  const edge_properties = params.weights?.length
    ? [
        { name: 'Weight', type: T_INT, index: 0, size: 1,
          min_value: 0, max_value: params.weights.length - 1 },
        { name: 'Delay',  type: T_INT, index: 1, size: 1, min_value: 1, max_value: params.max_delay },
      ]
    : [
        { name: 'Weight', type: numType, index: 0, size: 1,
          min_value: params.min_weight ?? -127, max_value: params.max_weight ?? 127 },
        { name: 'Delay',  type: T_INT,   index: 1, size: 1, min_value: 1, max_value: params.max_delay },
      ]

  return { node_properties, edge_properties, network_properties: [] }
}

export function applyProcParams(
  network: RispNetwork,
  newParams: RispProcParams,
  simTime?: number,
  coordMap?: Map<number, { x: number; y: number }>
): RispNetwork {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const switchingToDiscrete = newParams.discrete && !network.Associated_Data.proc_params?.discrete

  // Scalar bounds must be integers when discrete=true; round before clamping node/edge values.
  const params: RispProcParams = switchingToDiscrete ? {
    ...newParams,
    min_threshold: Math.round(newParams.min_threshold),
    max_threshold: Math.round(newParams.max_threshold),
    min_potential: Math.round(newParams.min_potential),
    ...(newParams.min_weight !== undefined ? { min_weight: Math.round(newParams.min_weight) } : {}),
    ...(newParams.max_weight !== undefined ? { max_weight: Math.round(newParams.max_weight) } : {}),
  } : newParams

  const useWeightsArray = (params.weights?.length ?? 0) > 0

  const nodes = network.Nodes.map(n => {
    const raw    = clamp(n.values[0], params.min_threshold, params.max_threshold)
    const t      = params.discrete ? Math.round(raw) : raw
    const coords = coordMap?.get(n.id)
    return { ...n, values: [t, ...n.values.slice(1)], ...(coords ? { coords } : {}) }
  })

  const edges = network.Edges.map(e => {
    let weight = e.values[0]
    if (!useWeightsArray) {
      const raw = clamp(e.values[0], params.min_weight ?? -127, params.max_weight ?? 127)
      weight = params.discrete ? Math.round(raw) : raw
    }
    const delay = Math.round(clamp(e.values[1] ?? 1, 1, params.max_delay))
    return { ...e, values: [weight, delay] }
  })

  const other = { ...network.Associated_Data.other }
  if (simTime !== undefined) other.sim_time = simTime

  return {
    ...network,
    Nodes:  nodes,
    Edges:  edges,
    Properties:      syncProperties(params),
    Associated_Data: {
      ...network.Associated_Data,
      proc_params: params,
      other: Object.keys(other).length > 0 ? other : undefined,
    },
  }
}
