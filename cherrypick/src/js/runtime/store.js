// A small external store for the plugin's state. Stash renders the plugin's
// pieces in many separate React trees (one per patched component), so state
// lives outside React and each piece subscribes to what it reads. Stash runs
// React 17, which has no useSyncExternalStore.
import { React } from './api.js'

const { useEffect, useRef, useState } = React

export function createStore(initial) {
  let state = initial
  const listeners = new Set()
  const store = {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch
      if (!next) return
      const prev = state
      state = { ...state, ...next }
      for (const l of listeners) l(state, prev)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  return store
}

// Re-renders when select(state) changes (compared with Object.is).
export function useStoreValue(store, select = (s) => s) {
  const [, force] = useState(0)
  const selectRef = useRef(select)
  selectRef.current = select
  const value = select(store.get())
  const last = useRef(value)
  last.current = value
  useEffect(() => {
    const check = () => {
      const next = selectRef.current(store.get())
      if (!Object.is(next, last.current)) force((n) => n + 1)
    }
    check()
    return store.subscribe(check)
  }, [store])
  return value
}
