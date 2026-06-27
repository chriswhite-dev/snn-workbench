import { useState, useCallback } from 'react'
import type { RispNetwork, NetworkMeta } from '@shared/types'
import { api } from '../lib/api'

interface NetworkState {
  network: RispNetwork | null
  meta: NetworkMeta | null
  loading: boolean
  error: string | null
}

export function useNetwork() {
  const [state, setState] = useState<NetworkState>({
    network: null,
    meta: null,
    loading: false,
    error: null,
  })

  const loadFromFile = useCallback((file: File): Promise<RispNetwork> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string) as RispNetwork
          setState((s) => ({ ...s, network: parsed, meta: null, error: null }))
          resolve(parsed)
        } catch {
          const err = 'Invalid JSON file'
          setState((s) => ({ ...s, error: err }))
          reject(new Error(err))
        }
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(file)
    })
  }, [])

  const loadFromApi = useCallback(async (id: string) => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await api.getNetwork(id)
      const metaResp = await fetch(res.data.file_url)
      const network = (await metaResp.json()) as RispNetwork
      setState({ network, meta: res.data, loading: false, error: null })
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }))
    }
  }, [])

  const clear = useCallback(() => {
    setState({ network: null, meta: null, loading: false, error: null })
  }, [])

  return { ...state, loadFromFile, loadFromApi, clear }
}
