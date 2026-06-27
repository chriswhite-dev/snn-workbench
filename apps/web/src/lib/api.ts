const BASE_URL = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  const json = await res.json()
  if (!res.ok) {
    const message = json.error ?? json.errors?.join(', ') ?? 'Request failed'
    throw new Error(message)
  }
  return json
}

export const api = {
  getNetworks: (params?: { search?: string; sort?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams()
    if (params?.search) q.set('search', params.search)
    if (params?.sort) q.set('sort', params.sort)
    if (params?.page) q.set('page', String(params.page))
    if (params?.limit) q.set('limit', String(params.limit))
    return request<{ data: import('@shared/types').NetworkMeta[]; total: number; page: number; limit: number }>(
      `/api/networks?${q.toString()}`
    )
  },

  getNetwork: (id: string) =>
    request<{ data: import('@shared/types').NetworkMeta }>(`/api/networks/${id}`),

  uploadNetwork: (formData: FormData) =>
    fetch(`${BASE_URL}/api/networks`, { method: 'POST', body: formData }).then(async (res) => {
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? json.errors?.join(', ') ?? 'Upload failed')
      return json as { data: import('@shared/types').NetworkMeta }
    }),

  logRun: (payload: { network_id: string; timesteps: number; spike_count: number; params_used?: Record<string, unknown> }) =>
    request<{ data: { id: string } }>('/api/runs', { method: 'POST', body: JSON.stringify(payload) }),

  vote: (network_id: string) =>
    request<{ data: { direction: string } }>('/api/votes', {
      method: 'POST',
      body: JSON.stringify({ network_id, direction: 'up' }),
    }),

  unvote: (network_id: string) =>
    request<{ data: { removed: boolean } }>('/api/votes', {
      method: 'DELETE',
      body: JSON.stringify({ network_id }),
    }),

  flagNetwork: (id: string) =>
    fetch(`${BASE_URL}/api/networks/${id}/flag`, { method: 'DELETE' }).then((r) => r.json()),
}
