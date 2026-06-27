import { z } from 'zod'
import type { RispNetwork } from '@risp/shared/types'

const MAX_NODES = 10_000
const MAX_EDGES = 50_000
const MAX_PROPERTIES = 32
const MAX_VALUES_PER_ELEMENT = 16

const RispPropertySchema = z.object({
  name: z.string().max(64),
  type: z.number().int(),
  index: z.number().int().nonnegative(),
  size: z.number().int().positive(),
  min_value: z.number(),
  max_value: z.number(),
})

const RispPropertyPackSchema = z.object({
  node_properties: z.array(RispPropertySchema).max(MAX_PROPERTIES),
  edge_properties: z.array(RispPropertySchema).max(MAX_PROPERTIES),
  network_properties: z.array(RispPropertySchema).max(MAX_PROPERTIES),
})

const RispNodeSchema = z.object({
  id: z.number().int().nonnegative(),
  values: z.array(z.number()).min(1).max(MAX_VALUES_PER_ELEMENT),
  name: z.string().max(128).optional(),
  coords: z.object({ x: z.number(), y: z.number() }).optional(),
})

const RispEdgeSchema = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  values: z.array(z.number()).min(1).max(MAX_VALUES_PER_ELEMENT),
})

const RispProcParamsSchema = z.object({
  discrete: z.boolean(),
  min_weight: z.number().optional(),
  max_weight: z.number().optional(),
  min_threshold: z.number(),
  max_threshold: z.number(),
  max_delay: z.number().int().positive(),
  min_potential: z.number(),
  leak_mode: z.enum(['none', 'all', 'configurable']).optional(),
  run_time_inclusive: z.boolean().optional(),
  threshold_inclusive: z.boolean().optional(),
  fire_like_ravens: z.boolean().optional(),
  spike_value_factor: z.number().optional(),
  weights: z.array(z.number()).max(10_000).optional(),
  inputs_from_weights: z.boolean().optional(),
  noisy_seed: z.number().int().optional(),
  noisy_stddev: z.number().optional(),
  stds: z.array(z.number()).max(10_000).optional(),
})

const RispAssociatedDataSchema = z.object({
  proc_params: RispProcParamsSchema.optional(),
  other: z
    .object({
      proc_name: z.string().max(64).optional(),
      sim_time: z.number().int().positive().max(100_000).optional(),
      timeseries: z.string().max(256).optional(),
    })
    .optional(),
})

const RispNetworkSchema = z.object({
  Properties: RispPropertyPackSchema,
  Nodes: z.array(RispNodeSchema).min(1, 'Network must have at least one node').max(MAX_NODES, `Network may not exceed ${MAX_NODES} nodes`),
  Edges: z.array(RispEdgeSchema).max(MAX_EDGES, `Network may not exceed ${MAX_EDGES} edges`),
  Inputs: z.array(z.number().int().nonnegative()).max(MAX_NODES),
  Outputs: z.array(z.number().int().nonnegative()).max(MAX_NODES),
  Network_Values: z.array(z.number()).max(10_000),
  Associated_Data: RispAssociatedDataSchema,
})

export type ValidationResult =
  | { success: true; data: RispNetwork }
  | { success: false; errors: string[] }

export function validateRispNetwork(raw: unknown): ValidationResult {
  const result = RispNetworkSchema.safeParse(raw)

  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`)
    return { success: false, errors }
  }

  const { Nodes, Edges, Inputs, Outputs } = result.data
  const nodeIds = new Set(Nodes.map((n) => n.id))
  const errors: string[] = []

  for (const id of Inputs) {
    if (!nodeIds.has(id)) errors.push(`Inputs: node id ${id} not found in Nodes`)
  }
  for (const id of Outputs) {
    if (!nodeIds.has(id)) errors.push(`Outputs: node id ${id} not found in Nodes`)
  }
  for (const edge of Edges) {
    if (!nodeIds.has(edge.from))
      errors.push(`Edge from=${edge.from}: node not found in Nodes`)
    if (!nodeIds.has(edge.to))
      errors.push(`Edge to=${edge.to}: node not found in Nodes`)
  }

  if (errors.length > 0) return { success: false, errors }
  return { success: true, data: result.data as RispNetwork }
}
