import { Box, Stack, Typography } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { Switch } from '@/components/base'
import { PolicySelector } from '@/components/smart-routing/policy-selector'
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

const defaultSmartRouting: Required<ISmartRoutingConfig> = {
  enabled: false,
  proxy_policy: 'GLOBAL',
  direct_policy: 'DIRECT',
  reject_policy: 'REJECT',
  final_policy: 'GLOBAL',
  append_match: false,
  categories: defaultCategories,
  custom_rules: [],
}

const builtinPolicies = ['GLOBAL', 'DIRECT', 'REJECT']

function normalizeSmartRouting(value?: ISmartRoutingConfig) {
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

export const SmartRoutingCard = () => {
  const { verge, mutateVerge, patchVerge } = useVerge()
  const [policyTargets, setPolicyTargets] = useState<string[]>([])
  const [policySources, setPolicySources] = useState<Record<string, string>>(
    {},
  )

  const smartRouting = useMemo(
    () => normalizeSmartRouting(verge?.smart_routing),
    [verge?.smart_routing],
  )

  const loadPolicyTargets = useCallback(async () => {
    try {
      const catalog = await collectSmartRoutingOptions()
      setPolicyTargets(catalog.policyTargets)
      setPolicySources(catalog.policySources)
    } catch {
      setPolicyTargets([])
      setPolicySources({})
    }
  }, [])

  useEffect(() => {
    void loadPolicyTargets()
  }, [loadPolicyTargets])

  const policyOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...builtinPolicies,
          smartRouting.proxy_policy,
          smartRouting.direct_policy,
          smartRouting.reject_policy,
          smartRouting.final_policy,
          ...smartRouting.custom_rules.map((rule) => rule.policy ?? ''),
          ...policyTargets,
        ]),
      ).filter(Boolean),
    [policyTargets, smartRouting],
  )

  const applySmartRoutingPatch = useLockFn(
    async (patch: Partial<ISmartRoutingConfig>) => {
      const nextSmartRouting = {
        ...smartRouting,
        ...patch,
      }

      mutateVerge(
        (prev) =>
          prev ? { ...prev, smart_routing: nextSmartRouting } : prev,
        false,
      )

      try {
        await patchVerge({ smart_routing: nextSmartRouting })
        const applied = await enhanceProfiles()
        if (applied) {
          await closeAllConnections().catch(() => {})
        }
      } catch (error) {
        mutateVerge()
        showNotice.error(error)
      }
    },
  )

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{
        alignItems: { xs: 'stretch', sm: 'center' },
        justifyContent: 'space-between',
        minHeight: 70,
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
        <Switch
          checked={smartRouting.enabled}
          onChange={(_, checked) =>
            void applySmartRoutingPatch({ enabled: checked })
          }
        />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
            分流总开关
          </Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
            与分流页同步
          </Typography>
        </Box>
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', minWidth: { xs: '100%', sm: 260 } }}
      >
        <Typography
          sx={{
            color: 'text.secondary',
            flexShrink: 0,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          默认连接节点
        </Typography>
        <PolicySelector
          value={smartRouting.proxy_policy}
          optionSources={policySources}
          options={policyOptions}
          onOpen={loadPolicyTargets}
          onChange={(proxy_policy) =>
            void applySmartRoutingPatch({
              proxy_policy,
            })
          }
          width="100%"
        />
      </Stack>
    </Stack>
  )
}
