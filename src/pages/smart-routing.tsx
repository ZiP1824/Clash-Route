import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import {
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { BasePage, Switch } from '@/components/base'
import {
  SettingItem,
  SettingList,
} from '@/components/setting/mods/setting-comp'
import { useVerge } from '@/hooks/use-verge'
import {
  calcuProxies,
  enhanceProfiles,
  getRuntimeConfig,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const defaultCategories: Required<ISmartRoutingCategories> = {
  ads: true,
  lan: true,
  domestic: true,
  foreign: true,
  ai: true,
  streaming: true,
}

type SmartRoutingDraft = Required<ISmartRoutingConfig>

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

function collectRuntimeGroups(config: IConfigData | null) {
  return (
    config?.['proxy-groups']
      ?.map((group) => group.name)
      .filter((name): name is string => Boolean(name?.trim())) ?? []
  )
}

const SmartRoutingPage = () => {
  const { verge, patchVerge, mutateVerge } = useVerge()
  const [policyTargets, setPolicyTargets] = useState<string[]>([])
  const [draft, setDraft] = useState<SmartRoutingDraft>(() =>
    normalizeSmartRouting(verge?.smart_routing),
  )

  useEffect(() => {
    setDraft(normalizeSmartRouting(verge?.smart_routing))
  }, [verge?.smart_routing])

  useEffect(() => {
    let active = true

    Promise.all([getRuntimeConfig(), calcuProxies().catch(() => null)])
      .then(([config, proxyData]) => {
        if (!active) return

        setPolicyTargets(
          Array.from(
            new Set([
              ...collectRuntimeGroups(config),
              ...(proxyData?.groups.map((group) => group.name) ?? []),
              ...(proxyData?.proxies.map((proxy) => proxy.name) ?? []),
            ]),
          ).filter(Boolean),
        )
      })
      .catch(() => {
        if (active) setPolicyTargets([])
      })

    return () => {
      active = false
    }
  }, [])

  const policyOptions = useMemo(() => {
    return Array.from(
      new Set([
        ...builtinPolicies,
        draft.proxy_policy,
        draft.direct_policy,
        draft.reject_policy,
        draft.final_policy,
        ...draft.custom_rules.map((rule) => rule.policy ?? ''),
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

  const updateDraft = useCallback((patch: Partial<SmartRoutingDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }, [])

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

  const removeCustomRule = useCallback((index: number) => {
    setDraft((prev) => ({
      ...prev,
      custom_rules: prev.custom_rules.filter(
        (_, currentIndex) => currentIndex !== index,
      ),
    }))
  }, [])

  const saveConfig = useCallback(async () => {
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
        }))
        .filter((rule) => rule.value),
    }

    mutateVerge({ ...verge, smart_routing }, false)
    await patchVerge({ smart_routing })

    const applied = await enhanceProfiles()
    if (applied) {
      showNotice.success('智能分流配置已保存')
    } else {
      showNotice.error('智能分流配置已保存，但运行配置校验未通过')
    }
  }, [draft, mutateVerge, patchVerge, verge])

  const renderPolicySelect = (
    value: string,
    onChange: (value: string) => void,
    width = 220,
  ) => (
    <Select
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      sx={{ width, '> div': { py: '7.5px' } }}
    >
      {policyOptions.map((policy) => (
        <MenuItem key={policy} value={policy}>
          {policy}
        </MenuItem>
      ))}
    </Select>
  )

  return (
    <BasePage
      title="智能分流"
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
      <Box sx={{ maxWidth: 900, mx: 'auto', px: 1.5, py: 1 }}>
        <SettingList title="总开关">
          <SettingItem label="启用智能分流">
            <Switch
              checked={draft.enabled}
              onChange={(_, checked) => updateDraft({ enabled: checked })}
            />
          </SettingItem>
        </SettingList>

        <SettingList title="默认策略">
          <SettingItem label="默认代理/节点">
            {renderPolicySelect(draft.proxy_policy, (proxy_policy) =>
              updateDraft({ proxy_policy }),
            )}
          </SettingItem>
          <SettingItem label="直连策略">
            {renderPolicySelect(draft.direct_policy, (direct_policy) =>
              updateDraft({ direct_policy }),
            )}
          </SettingItem>
          <SettingItem label="拦截策略">
            {renderPolicySelect(draft.reject_policy, (reject_policy) =>
              updateDraft({ reject_policy }),
            )}
          </SettingItem>
          <SettingItem label="最终策略">
            {renderPolicySelect(draft.final_policy, (final_policy) =>
              updateDraft({ final_policy }),
            )}
          </SettingItem>
          <SettingItem label="追加 MATCH">
            <Switch
              checked={draft.append_match}
              onChange={(_, checked) => updateDraft({ append_match: checked })}
            />
          </SettingItem>
        </SettingList>

        <SettingList title="单独规则">
          <List disablePadding>
            {draft.custom_rules.map((rule, index) => (
              <ListItem
                key={index}
                sx={{
                  alignItems: 'center',
                  gap: 1,
                  px: 2,
                  py: 0.75,
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
                {renderPolicySelect(
                  rule.policy || draft.proxy_policy,
                  (policy) => updateCustomRule(index, { policy }),
                )}
                <IconButton
                  size="small"
                  onClick={() => removeCustomRule(index)}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </ListItem>
            ))}
            <ListItem sx={{ px: 2, py: 0.75 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddRoundedIcon />}
                onClick={addCustomRule}
              >
                新增规则
              </Button>
            </ListItem>
          </List>
        </SettingList>

        <SettingList title="规则模块">
          <List disablePadding>
            {categoryItems.map((item) => (
              <ListItem key={item.key} sx={{ px: 2, py: '5px' }}>
                <ListItemText
                  primary={
                    <Typography sx={{ fontSize: '14px' }}>
                      {item.label}
                    </Typography>
                  }
                />
                <Switch
                  checked={draft.categories[item.key] ?? true}
                  onChange={(_, checked) => updateCategory(item.key, checked)}
                />
              </ListItem>
            ))}
          </List>
        </SettingList>

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
