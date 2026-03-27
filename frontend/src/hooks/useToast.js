import { useState, useCallback } from 'react'

let id = 0

export function useToast() {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const tid = ++id
    setToasts(t => [...t, { id: tid, message, type }])
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== tid))
    }, duration)
  }, [])

  const toast = {
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error'),
    info: (msg) => addToast(msg, 'info'),
  }

  return { toasts, toast }
}
