export interface RispProperty {
  name: string
  type: number       // 68=double, 73=int, 66=bool
  index: number
  size: number
  min_value: number
  max_value: number
}

export interface RispPropertyPack {
  node_properties: RispProperty[]
  edge_properties: RispProperty[]
  network_properties: RispProperty[]
}

export interface RispNode {
  id: number
  values: number[]
  name?: string
}

export interface RispEdge {
  from: number
  to: number
  values: number[]
}

export interface RispProcParams {
  discrete: boolean
  min_weight?: number
  max_weight?: number
  min_threshold: number
  max_threshold: number
  max_delay: number
  min_potential: number
  leak_mode?: 'none' | 'all' | 'configurable'
  run_time_inclusive?: boolean
  threshold_inclusive?: boolean
  fire_like_ravens?: boolean
  spike_value_factor?: number
  weights?: number[]
  inputs_from_weights?: boolean
  noisy_seed?: number
  noisy_stddev?: number
  stds?: number[]
}

export interface RispAssociatedData {
  proc_params?: RispProcParams
  other?: {
    proc_name?: string
    sim_time?: number
    timeseries?: string
  }
}

export interface RispNetwork {
  Properties: RispPropertyPack
  Nodes: RispNode[]
  Edges: RispEdge[]
  Inputs: number[]
  Outputs: number[]
  Network_Values: number[]
  Associated_Data: RispAssociatedData
}

export interface NetworkMeta {
  id: string
  name: string
  description?: string
  submitter_name: string
  file_url: string
  neuron_count: number
  synapse_count: number
  tags: string[]
  run_count: number
  vote_count: number
  user_voted: boolean
  created_at: string
}

export interface RunMeta {
  id: string
  network_id: string
  params_used: Record<string, unknown>
  timesteps: number
  spike_count: number
  created_at: string
}

export interface VoteMeta {
  id: string
  network_id: string
  direction: 'up' | 'down'
  created_at: string
}

export interface ApiResponse<T> {
  data?: T
  error?: string
  errors?: string[]
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
}
