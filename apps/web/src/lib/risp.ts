export interface RispModule {
  ccall: (
    name: string,
    returnType: 'string' | 'number' | null,
    argTypes: Array<'string' | 'number'>,
    args: unknown[]
  ) => unknown
}

let _singleton: Promise<RispModule> | null = null

export function getRispModule(): Promise<RispModule> {
  if (_singleton) return _singleton
  _singleton = new Promise<RispModule>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = '/risp.js'
    s.onload = () => {
      ;(window as unknown as { RispModule: () => Promise<RispModule> })
        .RispModule()
        .then(resolve)
        .catch(reject)
    }
    s.onerror = () => reject(new Error('Failed to load /risp.js'))
    document.head.appendChild(s)
  })
  return _singleton
}
