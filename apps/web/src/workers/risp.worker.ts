self.onmessage = (e: MessageEvent) => {
  const { type } = e.data
  switch (type) {
    case 'LOAD':
    case 'STEP':
    case 'APPLY_SPIKES':
    case 'RESET':
    case 'GET_STATE':
      (self as unknown as Worker).postMessage({
        type: 'ERROR',
        message: 'WASM simulation not yet implemented (v2)',
      })
      break
    default:
      console.warn('Unknown message type:', type)
  }
}
