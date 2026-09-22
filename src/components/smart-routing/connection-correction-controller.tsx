import { useEffect, useMemo, useRef } from 'react'
import { closeConnection } from 'tauri-plugin-mihomo-api'

import { useConnectionData } from '@/hooks/use-connection-data'
import { enhanceProfiles } from '@/services/cmds'
import {
  recordSmartRoutingCorrection,
  setSmartRoutingCorrectionEnabled,
  setSmartRoutingCorrectionRunning,
} from '@/services/smart-routing-correction'
import {
  matchServiceConnection,
  smartRoutingServiceMap,
  type SmartRoutingServiceDefinition,
  type SmartRoutingServiceMatcher,
} from '@/services/smart-routing-services'

const CORRECTION_COOLDOWN_MS = 30_000

type EnabledService = {
  policy: string
  service: SmartRoutingServiceDefinition
}

type CorrectionCandidate = EnabledService & {
  connection: IConnectionsItem
  matcher: SmartRoutingServiceMatcher
}

function normalizeRuleType(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

function needsCorrection(
  connection: IConnectionsItem,
  matcher: SmartRoutingServiceMatcher,
  policy: string,
) {
  const expectedPolicy = policy.trim().toLowerCase()
  if (
    expectedPolicy &&
    connection.chains.some(
      (chain) => chain.trim().toLowerCase() === expectedPolicy,
    )
  ) {
    return false
  }

  const ruleType = normalizeRuleType(connection.rule || '')
  if (!ruleType || ruleType === 'match') return true

  if (matcher.type === 'process-name' || matcher.type === 'process-path') {
    return !ruleType.startsWith('process')
  }

  return matcher.type === 'domain-suffix'
}

function connectionHost(connection: IConnectionsItem) {
  return (
    connection.metadata.host ||
    connection.metadata.remoteDestination ||
    connection.metadata.destinationIP ||
    '-'
  )
}

function connectionProcess(connection: IConnectionsItem) {
  return connection.metadata.process || connection.metadata.processPath || '-'
}

function candidateKey(candidate: CorrectionCandidate) {
  return [
    candidate.service.id,
    candidate.matcher.type,
    candidate.matcher.value.toLowerCase(),
    connectionHost(candidate.connection).toLowerCase(),
  ].join(':')
}

export const SmartRoutingConnectionController = ({
  config,
}: {
  config?: ISmartRoutingConfig
}) => {
  const enabled = Boolean(config?.enabled && (config.auto_correction ?? true))
  const applyingRef = useRef(false)
  const cooldownRef = useRef(new Map<string, number>())
  const {
    response: { data },
  } = useConnectionData({ enabled })

  const enabledServices = useMemo<EnabledService[]>(() => {
    if (!enabled) return []

    return (config?.service_bindings ?? [])
      .filter((binding) => binding.enabled !== false && binding.policy)
      .map((binding) => {
        const service = smartRoutingServiceMap.get(binding.service_id)
        if (!service) return null
        return {
          policy: binding.policy || config?.proxy_policy || 'GLOBAL',
          service,
        }
      })
      .filter((item): item is EnabledService => Boolean(item))
  }, [config?.proxy_policy, config?.service_bindings, enabled])

  useEffect(() => {
    setSmartRoutingCorrectionEnabled(enabled)
  }, [enabled])

  useEffect(() => {
    if (!enabled || applyingRef.current || enabledServices.length === 0) return

    const now = Date.now()
    const candidates: CorrectionCandidate[] = []

    for (const connection of data.activeConnections) {
      for (const item of enabledServices) {
        const matcher = matchServiceConnection(item.service, connection)
        if (!matcher || !needsCorrection(connection, matcher, item.policy)) {
          continue
        }

        const candidate = { ...item, connection, matcher }
        const lastAttempt =
          cooldownRef.current.get(candidateKey(candidate)) ?? 0
        if (now - lastAttempt < CORRECTION_COOLDOWN_MS) continue
        candidates.push(candidate)
        break
      }
    }

    if (candidates.length === 0) return

    applyingRef.current = true
    setSmartRoutingCorrectionRunning(true)
    candidates.forEach((candidate) => {
      cooldownRef.current.set(candidateKey(candidate), now)
    })

    const startedAt = performance.now()
    const runCorrection = async () => {
      let applied = false
      try {
        applied = await enhanceProfiles()
        if (applied) {
          await Promise.allSettled(
            candidates.map((candidate) =>
              closeConnection(candidate.connection.id),
            ),
          )
        }
      } catch (error) {
        console.warn(
          '[SmartRouting] automatic connection correction failed',
          error,
        )
      } finally {
        const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt))
        const representative = candidates[0]
        recordSmartRoutingCorrection({
          id: `${Date.now()}:${representative.connection.id}`,
          serviceId: representative.service.id,
          serviceName: representative.service.name,
          host: connectionHost(representative.connection),
          process: connectionProcess(representative.connection),
          previousRule: representative.connection.rule || 'MATCH',
          policy: representative.policy,
          correctedAt: new Date().toISOString(),
          elapsedMs,
          success: applied,
        })
        applyingRef.current = false
      }
    }

    void runCorrection()
  }, [data.activeConnections, enabled, enabledServices])

  return null
}
