import { useSyncExternalStore } from 'react'

export type SmartRoutingCorrectionEvent = {
  id: string
  serviceId: string
  serviceName: string
  host: string
  process: string
  previousRule: string
  policy: string
  correctedAt: string
  elapsedMs: number
  success: boolean
}

export type SmartRoutingCorrectionSnapshot = {
  enabled: boolean
  correcting: boolean
  totalCorrections: number
  failedCorrections: number
  lastEvent?: SmartRoutingCorrectionEvent
  recentEvents: SmartRoutingCorrectionEvent[]
}

const listeners = new Set<() => void>()
let snapshot: SmartRoutingCorrectionSnapshot = {
  enabled: false,
  correcting: false,
  totalCorrections: 0,
  failedCorrections: 0,
  recentEvents: [],
}

function publish(patch: Partial<SmartRoutingCorrectionSnapshot>) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((listener) => {
    listener()
  })
}

export function setSmartRoutingCorrectionEnabled(enabled: boolean) {
  if (snapshot.enabled === enabled && (!enabled || !snapshot.correcting)) return
  publish({ enabled, correcting: enabled ? snapshot.correcting : false })
}

export function setSmartRoutingCorrectionRunning(correcting: boolean) {
  if (snapshot.correcting === correcting) return
  publish({ correcting })
}

export function recordSmartRoutingCorrection(
  event: SmartRoutingCorrectionEvent,
) {
  publish({
    correcting: false,
    totalCorrections: snapshot.totalCorrections + (event.success ? 1 : 0),
    failedCorrections: snapshot.failedCorrections + (event.success ? 0 : 1),
    lastEvent: event,
    recentEvents: [event, ...snapshot.recentEvents].slice(0, 20),
  })
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSmartRoutingCorrectionState() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  )
}
