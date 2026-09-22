import { Box, Chip, List, ListItem, Stack, Typography } from '@mui/material'
import { useMemo } from 'react'

import { useConnectionData } from '@/hooks/use-connection-data'
import { useVisibility } from '@/hooks/use-visibility'
import {
  serviceMatcherSupportsCurrentPlatform,
  smartRoutingServiceMap,
} from '@/services/smart-routing-services'

type RoutingMonitorProps = {
  compact?: boolean
  customRules?: ISmartRoutingCustomRule[]
  serviceBindings?: ISmartRoutingServiceBinding[]
  enabled?: boolean
}

const EMPTY_CUSTOM_RULES: ISmartRoutingCustomRule[] = []
const EMPTY_SERVICE_BINDINGS: ISmartRoutingServiceBinding[] = []

type RuleTarget = {
  key: string
  label: string
  matchValue: string
  originalValue: string
  policy: string
  type: 'domain' | 'process'
}

type RoutingMonitorRow = RuleTarget & {
  active: boolean
  count: number
  hit?: string
  proxy: string
  startTime: number
}

const DIRECT_POLICIES = new Set(['DIRECT', 'REJECT'])

function parseStartTime(value?: string) {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : 0
}

function trimHost(value: string) {
  return value
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/:\d+$/g, '')
    .toLowerCase()
}

function normalizeDomain(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const url = trimmed.includes('://')
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`)
    return trimHost(url.hostname.replace(/^\*\./, ''))
  } catch {
    return trimHost(trimmed.replace(/^\*\./, '').split('/')[0] || '')
  }
}

function normalizeProcessName(value: string) {
  return value
    .trim()
    .replace(/^["']|["']$/g, '')
    .split(/[\\/]/)
    .pop()
    ?.trim()
    .toLowerCase()
}

function getConnectionHost(connection: IConnectionsItem) {
  const { host, remoteDestination, destinationIP } = connection.metadata
  return trimHost(host || remoteDestination || destinationIP || '')
}

function getConnectionProxy(connection: IConnectionsItem) {
  const chain = connection.chains?.filter(Boolean) ?? []
  if (!chain.length) return connection.rule || '-'
  return chain[chain.length - 1]
}

function getConnectionProcessNames(connection: IConnectionsItem) {
  const { process, processPath } = connection.metadata
  return [process, processPath]
    .map((value) => normalizeProcessName(value || ''))
    .filter((value): value is string => Boolean(value))
}

function domainMatches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`)
}

function ruleMatchesConnection(rule: RuleTarget, connection: IConnectionsItem) {
  if (rule.type === 'process') {
    return getConnectionProcessNames(connection).includes(rule.matchValue)
  }

  const host = getConnectionHost(connection)
  return Boolean(
    host && rule.matchValue && domainMatches(host, rule.matchValue),
  )
}

function normalizeRuleTargets(customRules: ISmartRoutingCustomRule[] = []) {
  return customRules
    .map((rule, index): RuleTarget | null => {
      if (rule.enabled === false) return null

      const originalValue = `${rule.value ?? ''}`.trim()
      if (!originalValue) return null

      const type = rule.type === 'process' ? 'process' : 'domain'
      const matchValue =
        type === 'process'
          ? normalizeProcessName(originalValue)
          : normalizeDomain(originalValue)
      if (!matchValue) return null

      return {
        key: `${index}:${type}:${matchValue}`,
        label: type === 'process' ? matchValue : matchValue,
        matchValue,
        originalValue,
        policy: `${rule.policy ?? ''}`.trim() || '-',
        type,
      }
    })
    .filter((rule): rule is RuleTarget => Boolean(rule))
}

function normalizeServiceTargets(
  serviceBindings: ISmartRoutingServiceBinding[] = [],
) {
  return serviceBindings.flatMap((binding): RuleTarget[] => {
    if (binding.enabled === false) return []
    const service = smartRoutingServiceMap.get(binding.service_id)
    if (!service) return []

    return service.matchers.flatMap((matcher): RuleTarget[] => {
      if (
        !serviceMatcherSupportsCurrentPlatform(matcher) ||
        !['domain-suffix', 'process-name'].includes(matcher.type)
      ) {
        return []
      }

      const type = matcher.type === 'process-name' ? 'process' : 'domain'
      const matchValue =
        type === 'process'
          ? normalizeProcessName(matcher.value)
          : normalizeDomain(matcher.value)
      if (!matchValue) return []

      return [
        {
          key: `service:${service.id}:${matcher.type}:${matchValue}`,
          label: `${service.name} · ${matcher.value}`,
          matchValue,
          originalValue: matcher.value,
          policy: binding.policy?.trim() || '-',
          type,
        },
      ]
    })
  })
}

function buildRoutingRows(
  targets: RuleTarget[],
  connections: IConnectionsItem[],
) {
  return targets.map((target): RoutingMonitorRow => {
    const matched = connections.filter((connection) =>
      ruleMatchesConnection(target, connection),
    )
    const latest = matched.reduce<IConnectionsItem | null>((current, item) => {
      if (!current) return item
      return parseStartTime(item.start) >= parseStartTime(current.start)
        ? item
        : current
    }, null)

    return {
      ...target,
      active: matched.length > 0,
      count: matched.length,
      hit: latest
        ? target.type === 'process'
          ? latest.metadata.processPath || latest.metadata.process
          : getConnectionHost(latest)
        : undefined,
      proxy: latest ? getConnectionProxy(latest) : '暂无连接',
      startTime: parseStartTime(latest?.start),
    }
  })
}

export const RoutingMonitor = ({
  compact = false,
  customRules = EMPTY_CUSTOM_RULES,
  serviceBindings = EMPTY_SERVICE_BINDINGS,
  enabled = true,
}: RoutingMonitorProps) => {
  const visible = useVisibility()
  const {
    response: { data },
  } = useConnectionData({ enabled: enabled && visible })

  const targets = useMemo(
    () => [
      ...normalizeServiceTargets(serviceBindings),
      ...normalizeRuleTargets(customRules),
    ],
    [customRules, serviceBindings],
  )
  const rows = useMemo(
    () => buildRoutingRows(targets, data.activeConnections),
    [data.activeConnections, targets],
  )
  const activeCount = rows.filter((row) => row.active).length

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
          flexWrap: 'wrap',
          gap: 0.75,
          justifyContent: 'space-between',
          px: 2,
          py: 1,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
            实时连接
          </Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
            已配置 {targets.length} 条，当前命中 {activeCount} 条
          </Typography>
        </Box>
        <Typography sx={{ flexShrink: 0, fontSize: 13, fontWeight: 700 }}>
          连接节点
        </Typography>
      </Stack>

      {rows.length === 0 ? (
        <Box
          sx={{
            color: 'text.secondary',
            fontSize: 13,
            px: 2,
            py: compact ? 2 : 4,
            textAlign: 'center',
          }}
        >
          先在单独规则里添加网站或 EXE
        </Box>
      ) : (
        <List
          disablePadding
          sx={{
            maxHeight: compact ? undefined : 'calc(100vh - 76px)',
            overflow: compact ? 'visible' : 'auto',
          }}
        >
          {rows.map((row) => (
            <ListItem
              key={row.key}
              sx={{
                alignItems: 'center',
                borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                display: 'grid',
                gap: 1,
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                px: 2,
                py: 1,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Stack
                  direction="row"
                  spacing={0.75}
                  sx={{ alignItems: 'center', minWidth: 0 }}
                >
                  <Chip
                    size="small"
                    label={row.type === 'process' ? 'EXE' : '网站'}
                    variant="outlined"
                    sx={{ flexShrink: 0, height: 22 }}
                  />
                  <Typography
                    title={row.originalValue}
                    sx={{
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.label}
                  </Typography>
                </Stack>
                <Typography
                  title={row.hit || row.policy}
                  sx={{
                    color: 'text.secondary',
                    fontSize: 11,
                    mt: 0.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.hit
                    ? `命中 ${row.hit}${row.count > 1 ? ` x${row.count}` : ''}`
                    : `策略 ${row.policy}`}
                </Typography>
              </Box>
              <Chip
                size="small"
                label={row.proxy}
                color={
                  !row.active || DIRECT_POLICIES.has(row.proxy)
                    ? 'default'
                    : 'primary'
                }
                variant={
                  !row.active || DIRECT_POLICIES.has(row.proxy)
                    ? 'outlined'
                    : 'filled'
                }
                sx={{
                  maxWidth: { xs: 112, sm: compact ? 160 : 180 },
                  '& .MuiChip-label': {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  },
                }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  )
}
