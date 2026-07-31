import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import FileOpenOutlinedIcon from '@mui/icons-material/FileOpenOutlined'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  open as openDialog,
  save as saveDialog,
} from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  closeAllConnections,
  closeConnection,
  getConnections,
} from 'tauri-plugin-mihomo-api'

import { BasePage, Switch } from '@/components/base'
import { PolicySelector } from '@/components/smart-routing/policy-selector'
import { RoutingMonitor } from '@/components/smart-routing/routing-monitor'
import { useVerge } from '@/hooks/use-verge'
import { enhanceProfiles } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { collectSmartRoutingOptions } from '@/utils/smart-routing-options'

const defaultCategories: Required<ISmartRoutingCategories> = {
  ads: true,
  lan: true,
  domestic: true,
  foreign: true,
  ai: true,
  streaming: true,
}

type SmartRoutingDraft = Required<ISmartRoutingConfig>

type SmartRoutingRulesExport = {
  app: 'clash-verge-route'
  type: 'smart-routing-custom-rules'
  version: 1
  exported_at: string
  custom_rules: ISmartRoutingCustomRule[]
}

const defaultSmartRouting: SmartRoutingDraft = {
  enabled: false,
  proxy_policy: 'GLOBAL',
  direct_policy: 'DIRECT',
  reject_policy: 'REJECT',
  final_policy: 'GLOBAL',
  append_match: false,
  categories: defaultCategories,
  custom_rules: [],
}

const categoryItems: Array<{
  key: keyof ISmartRoutingCategories
  label: string
}> = [
  { key: 'ads', label: '广告拦截' },
  { key: 'lan', label: '局域网直连' },
  { key: 'domestic', label: '国内直连' },
  { key: 'foreign', label: '海外代理' },
  { key: 'ai', label: 'AI 服务代理' },
  { key: 'streaming', label: '流媒体代理' },
]

const builtinPolicies = ['GLOBAL', 'DIRECT', 'REJECT']

type RuleTarget = {
  matchValue: string
  type: 'domain' | 'process'
}

function normalizeSmartRouting(value?: ISmartRoutingConfig): SmartRoutingDraft {
  return {
    ...defaultSmartRouting,
    ...value,
    categories: {
      ...defaultCategories,
      ...value?.categories,
    },
    custom_rules: value?.custom_rules ?? [],
  }
}

function normalizeCustomRule(
  value: unknown,
  fallbackPolicy: string,
): ISmartRoutingCustomRule | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<ISmartRoutingCustomRule>
  const ruleValue = `${item.value ?? ''}`.trim()
  if (!ruleValue) return null

  return {
    enabled: item.enabled ?? true,
    type: item.type === 'process' ? 'process' : 'domain',
    value: ruleValue,
    policy: `${item.policy ?? fallbackPolicy}`.trim() || fallbackPolicy,
    chain_enabled: item.chain_enabled ?? false,
    chain_entry: `${item.chain_entry ?? ''}`.trim(),
    chain_exit: `${item.chain_exit ?? ''}`.trim(),
  }
}

function customRuleKey(rule: ISmartRoutingCustomRule) {
  return `${rule.type ?? 'domain'}:${(rule.value ?? '').trim().toLowerCase()}`
}

function normalizeDomain(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const url = trimmed.includes('://')
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`)
    return url.hostname
      .trim()
      .replace(/^\[|\]$/g, '')
      .replace(/:\d+$/g, '')
      .replace(/^\*\./, '')
      .toLowerCase()
  } catch {
    return trimmed
      .replace(/^\[|\]$/g, '')
      .replace(/:\d+$/g, '')
      .replace(/^\*\./, '')
      .split('/')[0]
      .trim()
      .toLowerCase()
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

function normalizeRuleTarget(rule: ISmartRoutingCustomRule): RuleTarget | null {
  if (rule.enabled === false) return null

  const value = `${rule.value ?? ''}`.trim()
  if (!value) return null

  const type = rule.type === 'process' ? 'process' : 'domain'
  const matchValue =
    type === 'process' ? normalizeProcessName(value) : normalizeDomain(value)

  return matchValue ? { matchValue, type } : null
}

function stringifyCustomRule(rule: ISmartRoutingCustomRule) {
  return JSON.stringify({
    enabled: rule.enabled ?? true,
    type: rule.type ?? 'domain',
    value: `${rule.value ?? ''}`.trim(),
    policy: `${rule.policy ?? ''}`.trim(),
    chain_enabled: Boolean(rule.chain_enabled),
    chain_entry: `${rule.chain_entry ?? ''}`.trim(),
    chain_exit: `${rule.chain_exit ?? ''}`.trim(),
  })
}

function collectChangedRuleTargets(
  previousRules: ISmartRoutingCustomRule[] = [],
  nextRules: ISmartRoutingCustomRule[] = [],
) {
  const previousMap = new Map(
    previousRules.map((rule) => [customRuleKey(rule), rule]),
  )
  const nextMap = new Map(nextRules.map((rule) => [customRuleKey(rule), rule]))
  const targets = new Map<string, RuleTarget>()

  const addTarget = (rule?: ISmartRoutingCustomRule) => {
    if (!rule) return
    const target = normalizeRuleTarget(rule)
    if (target) targets.set(`${target.type}:${target.matchValue}`, target)
  }

  previousMap.forEach((previousRule, key) => {
    const nextRule = nextMap.get(key)
    if (!nextRule || stringifyCustomRule(previousRule) !== stringifyCustomRule(nextRule)) {
      addTarget(previousRule)
      addTarget(nextRule)
    }
  })

  nextMap.forEach((nextRule, key) => {
    if (!previousMap.has(key)) {
      addTarget(nextRule)
    }
  })

  return Array.from(targets.values())
}

function hasBroadSmartRoutingChange(
  previous: SmartRoutingDraft,
  next: ISmartRoutingConfig,
) {
  return (
    previous.enabled !== next.enabled ||
    previous.proxy_policy !== next.proxy_policy ||
    previous.direct_policy !== next.direct_policy ||
    previous.reject_policy !== next.reject_policy ||
    previous.final_policy !== next.final_policy ||
    previous.append_match !== next.append_match ||
    JSON.stringify(previous.categories) !== JSON.stringify(next.categories)
  )
}

function getConnectionHost(connection: IConnectionsItem) {
  const { host, remoteDestination, destinationIP } = connection.metadata
  return normalizeDomain(host || remoteDestination || destinationIP || '')
}

function getConnectionProcessNames(connection: IConnectionsItem) {
  const { process, processPath } = connection.metadata
  return [process, processPath]
    .map((value) => normalizeProcessName(value || ''))
    .filter((value): value is string => Boolean(value))
}

function ruleTargetMatchesConnection(
  target: RuleTarget,
  connection: IConnectionsItem,
) {
  if (target.type === 'process') {
    return getConnectionProcessNames(connection).includes(target.matchValue)
  }

  const host = getConnectionHost(connection)
  return host === target.matchValue || host.endsWith(`.${target.matchValue}`)
}

async function closeConnectionsForRuleTargets(targets: RuleTarget[]) {
  if (!targets.length) return

  try {
    const { connections } = await getConnections()
    const ids = new Set<string>()

    ;(connections ?? []).forEach((connection) => {
      if (
        targets.some((target) => ruleTargetMatchesConnection(target, connection))
      ) {
        ids.add(connection.id)
      }
    })

    await Promise.allSettled(Array.from(ids).map((id) => closeConnection(id)))
  } catch (error) {
    console.warn('[SmartRouting] close changed rule connections failed', error)
  }
}

function parseImportedRules(
  content: string,
  fallbackPolicy: string,
): ISmartRoutingCustomRule[] {
  const parsed = JSON.parse(content)
  const rawRules: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.custom_rules)
      ? parsed.custom_rules
      : Array.isArray(parsed?.rules)
        ? parsed.rules
        : null

  if (!rawRules) {
    throw new Error('Invalid smart routing rules file')
  }

  return rawRules
    .map((rule) => normalizeCustomRule(rule, fallbackPolicy))
    .filter((rule): rule is ISmartRoutingCustomRule => Boolean(rule))
}

const SectionCard = ({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) => (
  <Box
    sx={{
      bgcolor: (theme) =>
        theme.palette.mode === 'light' ? '#ffffff' : '#282a36',
      borderRadius: 2,
      mb: 1.5,
      overflow: 'hidden',
    }}
  >
    <Box
      sx={{
        alignItems: 'center',
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        display: 'flex',
        justifyContent: 'space-between',
        px: 2,
        py: 1.25,
      }}
    >
      <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{title}</Typography>
      {action}
    </Box>
    <Box sx={{ p: 2 }}>{children}</Box>
  </Box>
)

const SettingRow = ({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) => (
  <Box
    sx={{
      alignItems: 'center',
      display: 'grid',
      gap: 2,
      gridTemplateColumns: { xs: '1fr', sm: '180px minmax(0, 1fr)' },
      minHeight: 46,
    }}
  >
    <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{label}</Typography>
    <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'end' } }}>
      {children}
    </Box>
  </Box>
)

const SmartRoutingPage = () => {
  const { verge, patchVerge, mutateVerge } = useVerge()
  const [policyTargets, setPolicyTargets] = useState<string[]>([])
  const [nodeTargets, setNodeTargets] = useState<string[]>([])
  const [policySources, setPolicySources] = useState<Record<string, string>>(
    {},
  )
  const [nodeSources, setNodeSources] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<SmartRoutingDraft>(() =>
    normalizeSmartRouting(verge?.smart_routing),
  )

  useEffect(() => {
    setDraft(normalizeSmartRouting(verge?.smart_routing))
  }, [verge?.smart_routing])

  const loadPolicyTargets = useCallback(async () => {
    try {
      const catalog = await collectSmartRoutingOptions()
      setPolicyTargets(catalog.policyTargets)
      setNodeTargets(catalog.nodeTargets)
      setPolicySources(catalog.policySources)
      setNodeSources(catalog.nodeSources)
    } catch {
      setPolicyTargets([])
      setNodeTargets([])
      setPolicySources({})
      setNodeSources({})
    }
  }, [])

  useEffect(() => {
    void loadPolicyTargets()
  }, [loadPolicyTargets])

  const policyOptions = useMemo(() => {
    return Array.from(
      new Set([
        ...builtinPolicies,
        draft.proxy_policy,
        draft.direct_policy,
        draft.reject_policy,
        draft.final_policy,
        ...draft.custom_rules.map((rule) => rule.policy ?? ''),
        ...draft.custom_rules.map((rule) => rule.chain_entry ?? ''),
        ...draft.custom_rules.map((rule) => rule.chain_exit ?? ''),
        ...policyTargets,
      ]),
    ).filter(Boolean)
  }, [
    draft.custom_rules,
    draft.direct_policy,
    draft.final_policy,
    draft.proxy_policy,
    draft.reject_policy,
    policyTargets,
  ])

  const chainNodeOptions = useMemo(() => {
    return Array.from(
      new Set([
        ...nodeTargets,
        ...draft.custom_rules.map((rule) => rule.chain_entry ?? ''),
        ...draft.custom_rules.map((rule) => rule.chain_exit ?? ''),
      ]),
    ).filter(Boolean)
  }, [draft.custom_rules, nodeTargets])

  const updateDraft = useCallback((patch: Partial<SmartRoutingDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }, [])

  const saveDraftPatch = useCallback(
    async (patch: Partial<SmartRoutingDraft>) => {
      const smart_routing: SmartRoutingDraft = {
        ...draft,
        ...patch,
      }

      setDraft(smart_routing)
      mutateVerge({ ...verge, smart_routing }, false)
      await patchVerge({ smart_routing })

      const applied = await enhanceProfiles()
      if (!applied) {
        showNotice.error('分流配置已保存，但运行配置校验未通过')
      } else {
        await closeAllConnections().catch(() => {})
      }
    },
    [draft, mutateVerge, patchVerge, verge],
  )

  const updateCategory = useCallback(
    (key: keyof ISmartRoutingCategories, value: boolean) => {
      setDraft((prev) => ({
        ...prev,
        categories: {
          ...prev.categories,
          [key]: value,
        },
      }))
    },
    [],
  )

  const addCustomRule = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      custom_rules: [
        ...prev.custom_rules,
        {
          enabled: true,
          type: 'domain',
          value: '',
          policy: prev.proxy_policy,
        },
      ],
    }))
  }, [])

  const updateCustomRule = useCallback(
    (index: number, patch: Partial<ISmartRoutingCustomRule>) => {
      setDraft((prev) => ({
        ...prev,
        custom_rules: prev.custom_rules.map((rule, currentIndex) =>
          currentIndex === index ? { ...rule, ...patch } : rule,
        ),
      }))
    },
    [],
  )

  const enableRuleChain = useCallback(
    (index: number, rule: ISmartRoutingCustomRule) => {
      const policy = `${rule.policy ?? draft.proxy_policy}`.trim()
      const exitNode =
        `${rule.chain_exit ?? ''}`.trim() ||
        (chainNodeOptions.includes(policy) ? policy : '') ||
        chainNodeOptions[0] ||
        ''
      const entryNode =
        `${rule.chain_entry ?? ''}`.trim() ||
        chainNodeOptions.find((node) => node !== exitNode) ||
        chainNodeOptions[0] ||
        ''

      updateCustomRule(index, {
        chain_enabled: true,
        chain_entry: entryNode,
        chain_exit: exitNode,
        policy: exitNode || policy,
      })
    },
    [chainNodeOptions, draft.proxy_policy, updateCustomRule],
  )

  const removeCustomRule = useCallback((index: number) => {
    setDraft((prev) => ({
      ...prev,
      custom_rules: prev.custom_rules.filter(
        (_, currentIndex) => currentIndex !== index,
      ),
    }))
  }, [])

  const exportCustomRules = useCallback(async () => {
    const file = await saveDialog({
      defaultPath: 'smart-routing-rules.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!file) return

    const exportData: SmartRoutingRulesExport = {
      app: 'clash-verge-route',
      type: 'smart-routing-custom-rules',
      version: 1,
      exported_at: new Date().toISOString(),
      custom_rules: draft.custom_rules
        .map((rule) => normalizeCustomRule(rule, draft.proxy_policy))
        .filter((rule): rule is ISmartRoutingCustomRule => Boolean(rule)),
    }

    await writeTextFile(file, JSON.stringify(exportData, null, 2))
    showNotice.success('单独规则已导出')
  }, [draft.custom_rules, draft.proxy_policy])

  const importCustomRules = useCallback(async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!selected || Array.isArray(selected)) return

    try {
      const content = await readTextFile(selected)
      const importedRules = parseImportedRules(content, draft.proxy_policy)

      setDraft((prev) => {
        const ruleMap = new Map<string, ISmartRoutingCustomRule>()
        prev.custom_rules
          .map((rule) => normalizeCustomRule(rule, prev.proxy_policy))
          .filter((rule): rule is ISmartRoutingCustomRule => Boolean(rule))
          .forEach((rule) => ruleMap.set(customRuleKey(rule), rule))
        importedRules.forEach((rule) => ruleMap.set(customRuleKey(rule), rule))

        return {
          ...prev,
          custom_rules: Array.from(ruleMap.values()),
        }
      })

      showNotice.success(
        `已导入 ${importedRules.length} 条单独规则，请保存应用`,
      )
    } catch (error) {
      console.error(error)
      showNotice.error('导入失败，请选择分流规则 JSON 文件')
    }
  }, [draft.proxy_policy])

  const selectProcessFile = useCallback(
    async (index: number) => {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: 'Executable', extensions: ['exe'] }],
      })
      if (!selected || Array.isArray(selected)) return

      updateCustomRule(index, {
        type: 'process',
        value: selected,
      })
    },
    [updateCustomRule],
  )

  const saveConfig = useCallback(async () => {
    const previousSmartRouting = normalizeSmartRouting(verge?.smart_routing)
    const smart_routing: ISmartRoutingConfig = {
      enabled: draft.enabled,
      proxy_policy: draft.proxy_policy,
      direct_policy: draft.direct_policy,
      reject_policy: draft.reject_policy,
      final_policy: draft.final_policy,
      append_match: draft.append_match,
      categories: draft.categories,
      custom_rules: draft.custom_rules
        .map((rule) => ({
          enabled: rule.enabled ?? true,
          type: rule.type ?? 'domain',
          value: rule.value?.trim() ?? '',
          policy: rule.policy?.trim() || draft.proxy_policy,
          chain_enabled: Boolean(rule.chain_enabled),
          chain_entry: rule.chain_entry?.trim() ?? '',
          chain_exit: rule.chain_exit?.trim() ?? '',
        }))
        .filter((rule) => rule.value),
    }

    mutateVerge({ ...verge, smart_routing }, false)
    await patchVerge({ smart_routing })

    const applied = await enhanceProfiles()
    if (applied) {
      if (hasBroadSmartRoutingChange(previousSmartRouting, smart_routing)) {
        await closeAllConnections().catch(() => {})
      } else {
        await closeConnectionsForRuleTargets(
          collectChangedRuleTargets(
            previousSmartRouting.custom_rules,
            smart_routing.custom_rules,
          ),
        )
      }
      showNotice.success('分流配置已保存')
    } else {
      showNotice.error('分流配置已保存，但运行配置校验未通过')
    }
  }, [draft, mutateVerge, patchVerge, verge])

  const renderPolicySelect = (
    value: string,
    onChange: (value: string) => void,
    width: number | string = 220,
  ) => (
    <PolicySelector
      value={value}
      optionSources={policySources}
      options={policyOptions}
      onOpen={loadPolicyTargets}
      onChange={onChange}
      width={width}
    />
  )

  return (
    <BasePage
      title="分流"
      full
      contentStyle={{
        height: '100%',
        overflow: 'auto',
      }}
      header={
        <Button
          size="small"
          variant="contained"
          startIcon={<SaveOutlinedIcon />}
          onClick={saveConfig}
        >
          保存
        </Button>
      }
    >
      <Box sx={{ maxWidth: 940, mx: 'auto', px: 1.5, py: 1.5 }}>
        <SectionCard title="总开关">
          <SettingRow label="启用分流">
            <Switch
              checked={draft.enabled}
              onChange={(_, checked) =>
                void saveDraftPatch({ enabled: checked })
              }
            />
          </SettingRow>
        </SectionCard>

        <SectionCard title="默认策略">
          <Stack spacing={1}>
            <SettingRow label="默认代理/节点">
            {renderPolicySelect(draft.proxy_policy, (proxy_policy) =>
              void saveDraftPatch({ proxy_policy }),
            )}
            </SettingRow>
            <SettingRow label="直连策略">
            {renderPolicySelect(draft.direct_policy, (direct_policy) =>
              updateDraft({ direct_policy }),
            )}
            </SettingRow>
            <SettingRow label="拦截策略">
            {renderPolicySelect(draft.reject_policy, (reject_policy) =>
              updateDraft({ reject_policy }),
            )}
            </SettingRow>
            <SettingRow label="最终策略">
            {renderPolicySelect(draft.final_policy, (final_policy) =>
              updateDraft({ final_policy }),
            )}
            </SettingRow>
            <SettingRow label="追加 MATCH">
            <Switch
              checked={draft.append_match}
              onChange={(_, checked) => updateDraft({ append_match: checked })}
            />
            </SettingRow>
          </Stack>
        </SectionCard>

        <SectionCard
          title="单独规则"
          action={
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<FileUploadOutlinedIcon />}
                onClick={importCustomRules}
              >
                导入
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<FileDownloadOutlinedIcon />}
                onClick={exportCustomRules}
              >
                导出
              </Button>
            </Stack>
          }
        >
          <Box>
            {draft.custom_rules.map((rule, index) => (
              <Box
                key={index}
                sx={{
                  alignItems: 'center',
                  borderBottom: (theme) =>
                    index === draft.custom_rules.length - 1
                      ? 'none'
                      : `1px solid ${theme.palette.divider}`,
                  display: 'grid',
                  gap: 1,
                  gridTemplateColumns: {
                    xs: 'auto minmax(0, 1fr) auto',
                    md: 'auto 100px minmax(0, 1fr) minmax(260px, 1.2fr) auto auto auto',
                  },
                  px: 0,
                  py: 1.25,
                }}
              >
                <Switch
                  checked={rule.enabled ?? true}
                  onChange={(_, checked) =>
                    updateCustomRule(index, { enabled: checked })
                  }
                />
                <Select
                  size="small"
                  value={rule.type ?? 'domain'}
                  onChange={(event) =>
                    updateCustomRule(index, {
                      type: event.target.value as 'domain' | 'process',
                    })
                  }
                  sx={{ width: 100, '> div': { py: '7.5px' } }}
                >
                  <MenuItem value="domain">网站</MenuItem>
                  <MenuItem value="process">EXE</MenuItem>
                </Select>
                <TextField
                  size="small"
                  value={rule.value ?? ''}
                  placeholder={
                    rule.type === 'process' ? 'steam.exe' : 'example.com'
                  }
                  onChange={(event) =>
                    updateCustomRule(index, { value: event.target.value })
                  }
                  sx={{ flex: 1, minWidth: 160 }}
                />
                <Box sx={{ minWidth: 0 }}>
                  {rule.chain_enabled ? (
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1}
                      sx={{ minWidth: 0 }}
                    >
                      <PolicySelector
                        label="前置节点"
                        value={rule.chain_entry ?? ''}
                        optionSources={nodeSources}
                        options={chainNodeOptions}
                        onOpen={loadPolicyTargets}
                        onChange={(chain_entry) =>
                          updateCustomRule(index, { chain_entry })
                        }
                        width="100%"
                      />
                      <PolicySelector
                        label="出口节点"
                        value={rule.chain_exit || rule.policy || ''}
                        optionSources={nodeSources}
                        options={chainNodeOptions}
                        onOpen={loadPolicyTargets}
                        onChange={(chain_exit) =>
                          updateCustomRule(index, {
                            chain_exit,
                            policy: chain_exit,
                          })
                        }
                        width="100%"
                      />
                    </Stack>
                  ) : (
                    renderPolicySelect(
                      rule.policy || draft.proxy_policy,
                      (policy) => updateCustomRule(index, { policy }),
                      '100%',
                    )
                  )}
                </Box>
                {rule.type === 'process' && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<FileOpenOutlinedIcon />}
                    onClick={() => selectProcessFile(index)}
                    sx={{ flexShrink: 0 }}
                  >
                    选择
                  </Button>
                )}
                {rule.type !== 'process' && <Box sx={{ display: { xs: 'none', md: 'block' } }} />}
                <Button
                  size="small"
                  variant={rule.chain_enabled ? 'contained' : 'outlined'}
                  startIcon={<LinkRoundedIcon />}
                  onClick={() => {
                    if (rule.chain_enabled) {
                      updateCustomRule(index, { chain_enabled: false })
                    } else {
                      enableRuleChain(index, rule)
                    }
                  }}
                  sx={{ flexShrink: 0, minWidth: 76 }}
                >
                  链式
                </Button>
                <IconButton
                  size="small"
                  onClick={() => removeCustomRule(index)}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Box sx={{ pt: draft.custom_rules.length ? 1.25 : 0 }}>
              <Button
                fullWidth
                size="medium"
                variant="outlined"
                startIcon={<AddRoundedIcon />}
                onClick={addCustomRule}
                sx={{ justifyContent: 'center', minHeight: 42 }}
              >
                新增规则
              </Button>
            </Box>
          </Box>
        </SectionCard>

        <SectionCard title="实时连接">
            <RoutingMonitor
              compact
              customRules={draft.custom_rules}
            />
        </SectionCard>

        <SectionCard title="规则模块">
          <Stack spacing={0.75}>
            {categoryItems.map((item) => (
              <Box
                key={item.key}
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  justifyContent: 'space-between',
                  minHeight: 38,
                }}
              >
                <Typography sx={{ fontSize: 14 }}>{item.label}</Typography>
                <Switch
                  checked={draft.categories[item.key] ?? true}
                  onChange={(_, checked) => updateCategory(item.key, checked)}
                />
              </Box>
            ))}
          </Stack>
        </SectionCard>

        <Stack
          direction="row"
          spacing={1}
          sx={{
            px: 2,
            py: 1.5,
            color: 'text.secondary',
            fontSize: 12,
          }}
        >
          <Box>当前可选目标：{policyTargets.length}</Box>
          <Box>单独规则：{draft.custom_rules.length}</Box>
          <Box>
            已启用模块：
            {categoryItems.filter((item) => draft.categories[item.key]).length}
          </Box>
        </Stack>
      </Box>
    </BasePage>
  )
}

export default SmartRoutingPage
