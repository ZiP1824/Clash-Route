import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import {
  Box,
  Button,
  Chip,
  List,
  ListItem,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'

import { useConnectionData } from '@/hooks/use-connection-data'
import { useVisibility } from '@/hooks/use-visibility'

export type RoutingMonitorRow = {
  host: string
  proxy: string
  rule?: string
  count: number
  process?: string
  startTime: number
}

type RoutingMonitorProps = {
  compact?: boolean
  enabled?: boolean
  maxRows?: number
  onPopout?: () => void
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

function isPrivateHost(host: string) {
  if (!host || host === 'localhost' || host === '::1') return true
  if (host.startsWith('127.') || host.startsWith('10.')) return true
  if (host.startsWith('192.168.')) return true
  const match172 = host.match(/^172\.(\d+)\./)
  if (match172) {
    const second = Number(match172[1])
    if (second >= 16 && second <= 31) return true
  }
  return false
}

function getConnectionHost(connection: IConnectionsItem) {
  const { host, remoteDestination, destinationIP } = connection.metadata
  return trimHost(host || remoteDestination || destinationIP || '')
}

function getConnectionProxy(connection: IConnectionsItem) {
  const chain = connection.chains?.filter(Boolean) ?? []
  if (!chain.length) return connection.rule || '-'
  const last = chain[chain.length - 1]
  return DIRECT_POLICIES.has(last) ? last : last
}

function buildRoutingRows(connections: IConnectionsItem[]) {
  const rowMap = new Map<string, RoutingMonitorRow>()

  for (const connection of connections) {
    const host = getConnectionHost(connection)
    if (isPrivateHost(host)) continue

    const startTime = parseStartTime(connection.start)
    const previous = rowMap.get(host)
    const next: RoutingMonitorRow = {
      host,
      proxy: getConnectionProxy(connection),
      rule: connection.rulePayload || connection.rule,
      count: (previous?.count ?? 0) + 1,
      process: connection.metadata.process,
      startTime: Math.max(previous?.startTime ?? 0, startTime),
    }

    if (!previous || startTime >= previous.startTime) {
      rowMap.set(host, next)
    } else {
      rowMap.set(host, {
        ...previous,
        count: next.count,
      })
    }
  }

  return Array.from(rowMap.values()).sort((a, b) => b.startTime - a.startTime)
}

export const RoutingMonitor = ({
  compact = false,
  enabled = true,
  maxRows = compact ? 8 : 80,
  onPopout,
}: RoutingMonitorProps) => {
  const visible = useVisibility()
  const {
    response: { data },
  } = useConnectionData({ enabled: enabled && visible })

  const rows = useMemo(
    () => buildRoutingRows(data.activeConnections).slice(0, maxRows),
    [data.activeConnections, maxRows],
  )

  return (
    <Paper
      elevation={0}
      sx={{
        bgcolor: 'background.paper',
        border: (theme) => `1px solid ${theme.palette.divider}`,
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
          justifyContent: 'space-between',
          px: 2,
          py: 1,
        }}
      >
        <Box>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
            实时走向
          </Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
            当前活跃连接 {data.activeConnections.length} 条
          </Typography>
        </Box>
        {onPopout && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNewRoundedIcon />}
            onClick={onPopout}
          >
            弹出显示
          </Button>
        )}
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
          暂无正在通过代理的站点连接
        </Box>
      ) : (
        <List
          disablePadding
          sx={{
            maxHeight: compact ? 260 : 'calc(100vh - 76px)',
            overflow: 'auto',
          }}
        >
          {rows.map((row) => (
            <ListItem
              key={row.host}
              divider
              sx={{
                alignItems: 'center',
                display: 'grid',
                gap: 1,
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                px: 2,
                py: 1,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  title={row.host}
                  sx={{
                    fontSize: 13,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.host}
                </Typography>
                {(row.rule || row.process || row.count > 1) && (
                  <Stack
                    direction="row"
                    spacing={0.75}
                    sx={{
                      alignItems: 'center',
                      color: 'text.secondary',
                      mt: 0.5,
                      minWidth: 0,
                    }}
                  >
                    {row.rule && (
                      <Typography
                        title={row.rule}
                        sx={{
                          fontSize: 11,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {row.rule}
                      </Typography>
                    )}
                    {row.process && (
                      <Typography sx={{ flexShrink: 0, fontSize: 11 }}>
                        {row.process}
                      </Typography>
                    )}
                    {row.count > 1 && (
                      <Typography sx={{ flexShrink: 0, fontSize: 11 }}>
                        x{row.count}
                      </Typography>
                    )}
                  </Stack>
                )}
              </Box>
              <Chip
                size="small"
                label={row.proxy}
                color={DIRECT_POLICIES.has(row.proxy) ? 'default' : 'primary'}
                variant={DIRECT_POLICIES.has(row.proxy) ? 'outlined' : 'filled'}
                sx={{
                  maxWidth: compact ? 160 : 180,
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
    </Paper>
  )
}
