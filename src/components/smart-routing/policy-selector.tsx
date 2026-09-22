import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded'
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded'
import FilterAltOffRounded from '@mui/icons-material/FilterAltOffRounded'
import FilterAltRounded from '@mui/icons-material/FilterAltRounded'
import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded'
import NetworkCheckRounded from '@mui/icons-material/NetworkCheckRounded'
import SortByAlphaRounded from '@mui/icons-material/SortByAlphaRounded'
import SortRounded from '@mui/icons-material/SortRounded'
import {
  Box,
  ButtonBase,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'

import { BaseLoading } from '@/components/base'
import { useProxyDelayState } from '@/hooks/use-proxy-delay-state'
import { useVerge } from '@/hooks/use-verge'
import { calcuProxies, ensureSmartRoutingProxyTargets } from '@/services/cmds'
import delayManager from '@/services/delay'

const SELECTOR_GROUP = 'smart-routing-selector'
const EMPTY_OPTION_SOURCES: Record<string, string> = {}
const PRESET_PROXY_NAMES = new Set([
  'GLOBAL',
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'COMPATIBLE',
])

type SortType = 'default' | 'delay' | 'name'

type PolicyOption = {
  index: number
  name: string
  proxy: IProxyItem
  source?: string
}

type PolicySelectorProps = {
  disabled?: boolean
  fieldLabel?: string
  label?: string
  onChange: (value: string) => void
  onOpen?: () => Promise<void> | void
  optionSources?: Record<string, string>
  options: string[]
  value: string
  width?: number | string
}

const createFallbackProxy = (name: string): IProxyItem =>
  ({
    name,
    type: PRESET_PROXY_NAMES.has(name) ? name : 'unknown',
    udp: false,
    xudp: false,
    tfo: false,
    mptcp: false,
    smux: false,
    history: [],
  }) as IProxyItem

type ProxyData = Awaited<ReturnType<typeof calcuProxies>>

const buildProxyMap = (proxyData: ProxyData) => {
  const nextMap: Record<string, IProxyItem> = {}
  Object.entries(proxyData.records).forEach(([name, proxy]) => {
    nextMap[name] = proxy
  })
  proxyData.groups.forEach((group) => {
    nextMap[group.name] = group as unknown as IProxyItem
  })
  nextMap.GLOBAL = proxyData.global as unknown as IProxyItem
  nextMap.DIRECT = proxyData.direct
  return nextMap
}

const sortOptions = (
  items: PolicyOption[],
  sortType: SortType,
  timeout: number,
) => {
  if (sortType === 'name') {
    return [...items].sort((a, b) => a.name.localeCompare(b.name))
  }

  if (sortType === 'delay') {
    const normalizeDelay = (proxy: IProxyItem) => {
      const delay = delayManager.getDelayFix(proxy, SELECTOR_GROUP)
      if (delay < 0) return Number.MAX_SAFE_INTEGER
      if (delay === 0 || delay >= timeout) return timeout
      return delay
    }

    return [...items].sort(
      (a, b) => normalizeDelay(a.proxy) - normalizeDelay(b.proxy),
    )
  }

  return items
}

const PolicyOptionCard = ({
  option,
  selected,
  onSelect,
}: {
  option: PolicyOption
  selected: boolean
  onSelect: () => void
}) => {
  const { delayValue, timeout } = useProxyDelayState(
    option.proxy,
    SELECTOR_GROUP,
  )
  const showDelay = delayValue > 0 || delayValue === 0 || delayValue >= timeout

  return (
    <ButtonBase
      onClick={onSelect}
      sx={({ palette }) => ({
        alignItems: 'center',
        bgcolor:
          palette.mode === 'light'
            ? selected
              ? alpha(palette.primary.main, 0.16)
              : '#fff'
            : selected
              ? alpha(palette.primary.main, 0.34)
              : '#24252f',
        borderLeft: selected
          ? `3px solid ${palette.primary.main}`
          : '3px solid transparent',
        borderRadius: 1,
        display: 'grid',
        gap: 1,
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        height: 56,
        justifyContent: 'stretch',
        px: 1.5,
        textAlign: 'left',
        width: '100%',
      })}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          title={option.name}
          sx={{
            fontSize: 14,
            fontWeight: 700,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {option.name}
        </Typography>
        {option.source && (
          <Typography
            title={option.source}
            sx={{
              color: 'text.secondary',
              fontSize: 11,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {option.source}
          </Typography>
        )}
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {delayValue === -2 && <BaseLoading />}
        {showDelay && delayValue !== -2 && (
          <Typography
            sx={{
              color: delayManager.formatDelayColor(delayValue, timeout),
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {delayManager.formatDelay(delayValue, timeout)}
          </Typography>
        )}
        {selected && (
          <CheckCircleOutlineRounded color="primary" sx={{ fontSize: 17 }} />
        )}
      </Stack>
    </ButtonBase>
  )
}

export const PolicySelector = ({
  disabled = false,
  fieldLabel,
  label = '选择节点',
  onChange,
  onOpen,
  optionSources = EMPTY_OPTION_SOURCES,
  options,
  value,
  width = 220,
}: PolicySelectorProps) => {
  const { verge } = useVerge()
  const [open, setOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [selectedSource, setSelectedSource] = useState('全部')
  const [sortType, setSortType] = useState<SortType>('default')
  const [proxyMap, setProxyMap] = useState<Record<string, IProxyItem>>({})
  const [, forceRender] = useReducer((count: number) => count + 1, 0)
  const timeout = verge?.default_latency_timeout || 10000
  const defaultLatencyUrl =
    verge?.default_latency_test?.trim() ||
    'http://cp.cloudflare.com/generate_204'

  useEffect(() => {
    delayManager.setUrl(SELECTOR_GROUP, defaultLatencyUrl)
  }, [defaultLatencyUrl])

  const loadProxyMap = useCallback(() => {
    let active = true

    calcuProxies()
      .then((proxyData) => {
        if (!active) return

        setProxyMap(buildProxyMap(proxyData))
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [])

  useEffect(() => loadProxyMap(), [loadProxyMap])

  const openSelector = useCallback(() => {
    setOpen(true)
    void onOpen?.()
    loadProxyMap()
  }, [loadProxyMap, onOpen])

  useEffect(() => {
    delayManager.setGroupListener(SELECTOR_GROUP, forceRender)
    return () => delayManager.removeGroupListener(SELECTOR_GROUP)
  }, [])

  const normalizedOptions = useMemo(() => {
    const seen = new Set<string>()
    return options
      .filter((name) => {
        const trimmed = name.trim()
        if (!trimmed || seen.has(trimmed)) return false
        seen.add(trimmed)
        return true
      })
      .map((name, index) => ({
        index,
        name,
        proxy: proxyMap[name] ?? createFallbackProxy(name),
        source: optionSources[name] ?? proxyMap[name]?.provider,
      }))
  }, [optionSources, options, proxyMap])

  const sources = useMemo(() => {
    return [
      '全部',
      ...Array.from(
        new Set(
          normalizedOptions
            .map((option) => option.source)
            .filter((source): source is string => Boolean(source?.trim())),
        ),
      ),
    ]
  }, [normalizedOptions])

  const effectiveSelectedSource = sources.includes(selectedSource)
    ? selectedSource
    : '全部'

  const visibleOptions = useMemo(() => {
    const keyword = filterText.trim().toLowerCase()
    const sourceFiltered =
      effectiveSelectedSource === '全部'
        ? normalizedOptions
        : normalizedOptions.filter(
            (option) => option.source === effectiveSelectedSource,
          )
    const filtered = keyword
      ? sourceFiltered.filter((option) =>
          option.name.toLowerCase().includes(keyword),
        )
      : sourceFiltered

    return sortOptions(filtered, sortType, timeout)
  }, [
    effectiveSelectedSource,
    filterText,
    normalizedOptions,
    sortType,
    timeout,
  ])

  const toggleSort = () => {
    setSortType((current) =>
      current === 'default'
        ? 'delay'
        : current === 'delay'
          ? 'name'
          : 'default',
    )
  }

  const checkDelay = useLockFn(async () => {
    const testNames = visibleOptions
      .map((option) => option.name)
      .filter((name) => !PRESET_PROXY_NAMES.has(name))

    await ensureSmartRoutingProxyTargets(testNames)

    let latestProxyMap = proxyMap
    try {
      const proxyData = await calcuProxies()
      latestProxyMap = buildProxyMap(proxyData)
      setProxyMap(latestProxyMap)
    } catch (error) {
      console.warn(
        '[PolicySelector] reload proxies before delay check failed',
        error,
      )
    }

    const testable = testNames
      .map((name) => latestProxyMap[name])
      .filter(
        (proxy): proxy is IProxyItem =>
          Boolean(proxy) && proxy.type !== 'unknown',
      )

    await delayManager.checkListDelay(testable, SELECTOR_GROUP, timeout)
    forceRender()
  })

  const selectedLabel = value?.trim() || label
  const selectedProxy = useMemo(
    () =>
      value
        ? (proxyMap[value] ?? createFallbackProxy(value))
        : createFallbackProxy(selectedLabel),
    [proxyMap, selectedLabel, value],
  )
  const selectedDelay = useProxyDelayState(selectedProxy, SELECTOR_GROUP)
  const showSelectedDelay =
    Boolean(value) &&
    selectedDelay.delayValue !== -1 &&
    selectedDelay.delayValue !== -2

  return (
    <>
      <ButtonBase
        disabled={disabled}
        onClick={openSelector}
        sx={({ palette }) => ({
          bgcolor: 'background.paper',
          border: `1px solid ${palette.divider}`,
          borderRadius: 1,
          color: value ? 'text.primary' : 'text.secondary',
          opacity: disabled ? 0.55 : 1,
          display: 'flex',
          fontSize: 14,
          height: fieldLabel ? 42 : 37,
          justifyContent: 'space-between',
          minWidth: 0,
          overflow: 'visible',
          position: 'relative',
          px: 1.5,
          width,
        })}
      >
        {fieldLabel && (
          <Box
            component="span"
            sx={{
              bgcolor: 'background.paper',
              color: 'text.secondary',
              fontSize: 12,
              left: 10,
              lineHeight: 1,
              maxWidth: 'calc(100% - 44px)',
              overflow: 'hidden',
              px: 0.5,
              position: 'absolute',
              textOverflow: 'ellipsis',
              top: -6,
              whiteSpace: 'nowrap',
            }}
          >
            {fieldLabel}
          </Box>
        )}
        <Box
          component="span"
          sx={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {selectedLabel}
        </Box>
        <Stack
          component="span"
          direction="row"
          spacing={0.75}
          sx={{ alignItems: 'center', flexShrink: 0, ml: 1 }}
        >
          {showSelectedDelay && (
            <Box
              component="span"
              sx={{
                bgcolor: delayManager.formatDelayColor(
                  selectedDelay.delayValue,
                  selectedDelay.timeout,
                ),
                borderRadius: 999,
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1,
                px: 0.75,
                py: 0.4,
              }}
            >
              {delayManager.formatDelay(
                selectedDelay.delayValue,
                selectedDelay.timeout,
              )}
            </Box>
          )}
          <KeyboardArrowDownRounded
            sx={{ color: 'text.secondary', fontSize: 18 }}
          />
        </Stack>
        <Box component="span" sx={{ display: 'none' }}>
          ▾
        </Box>
      </ButtonBase>

      <Dialog
        fullWidth
        maxWidth="md"
        open={open}
        onClose={() => setOpen(false)}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 16, fontWeight: 700 }}>
                选择节点
              </Typography>
              <Typography
                title={value}
                sx={{
                  color: 'text.secondary',
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                当前 {value || '-'}
              </Typography>
            </Box>

            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <IconButton
                size="small"
                title="筛选"
                onClick={() => setFilterOpen((current) => !current)}
              >
                {filterOpen ? (
                  <FilterAltRounded fontSize="inherit" />
                ) : (
                  <FilterAltOffRounded fontSize="inherit" />
                )}
              </IconButton>
              <IconButton size="small" title="排序" onClick={toggleSort}>
                {sortType === 'delay' ? (
                  <AccessTimeRounded fontSize="inherit" />
                ) : sortType === 'name' ? (
                  <SortByAlphaRounded fontSize="inherit" />
                ) : (
                  <SortRounded fontSize="inherit" />
                )}
              </IconButton>
              <IconButton size="small" title="延迟测试" onClick={checkDelay}>
                <NetworkCheckRounded fontSize="inherit" />
              </IconButton>
            </Stack>
          </Stack>
        </DialogTitle>

        <DialogContent sx={{ bgcolor: 'background.default', p: 1.5 }}>
          {sources.length > 1 && (
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ mb: 1, overflowX: 'auto', pb: 0.25 }}
            >
              {sources.map((source) => (
                <Chip
                  key={source}
                  clickable
                  color={
                    effectiveSelectedSource === source ? 'primary' : 'default'
                  }
                  label={source}
                  onClick={() => setSelectedSource(source)}
                  size="small"
                  variant={
                    effectiveSelectedSource === source ? 'filled' : 'outlined'
                  }
                  sx={{ flexShrink: 0 }}
                />
              ))}
            </Stack>
          )}

          {filterOpen && (
            <TextField
              autoFocus
              fullWidth
              hiddenLabel
              placeholder="筛选节点"
              size="small"
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              sx={{ mb: 1 }}
            />
          )}

          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
              },
              maxHeight: 'min(62vh, 560px)',
              overflow: 'auto',
            }}
          >
            {visibleOptions.map((option) => (
              <PolicyOptionCard
                key={option.name}
                option={option}
                selected={option.name === value}
                onSelect={() => {
                  onChange(option.name)
                  setOpen(false)
                }}
              />
            ))}
          </Box>
        </DialogContent>
      </Dialog>
    </>
  )
}
