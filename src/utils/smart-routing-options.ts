import yaml from 'js-yaml'

import {
  calcuProxies,
  getProfiles,
  getRuntimeConfig,
  readProfileFile,
} from '@/services/cmds'

const builtinPolicies = ['GLOBAL', 'DIRECT', 'REJECT']

export type SmartRoutingOptionCatalog = {
  policyTargets: string[]
  nodeTargets: string[]
  policySources: Record<string, string>
  nodeSources: Record<string, string>
}

type ProfileProxyEntry = {
  current: boolean
  name: string
  source: string
}

function collectRuntimeGroups(config: IConfigData | null) {
  return (
    config?.['proxy-groups']
      ?.map((group) => group.name)
      .filter((name): name is string => Boolean(name?.trim())) ?? []
  )
}

function collectProfileProxyEntries(
  config: unknown,
  source: string,
  current: boolean,
) {
  const proxies = (config as { proxies?: unknown })?.proxies
  if (!Array.isArray(proxies)) return []

  return proxies
    .map((proxy): ProfileProxyEntry | null => {
      const name = (proxy as { name?: unknown })?.name
      if (typeof name !== 'string') return null

      const trimmed = name.trim()
      if (!trimmed || builtinPolicies.includes(trimmed)) return null

      return {
        current,
        name: trimmed,
        source,
      }
    })
    .filter((entry): entry is ProfileProxyEntry => Boolean(entry))
}

function uniqueAlias(source: string, name: string, usedNames: Set<string>) {
  const base = `${source} / ${name}`
  if (!usedNames.has(base)) return base

  let index = 2
  while (usedNames.has(`${base} (${index})`)) {
    index += 1
  }
  return `${base} (${index})`
}

async function collectProfileProxyEntriesFromFiles() {
  const profiles = await getProfiles()
  const currentUid = profiles.current
  const items =
    profiles.items?.filter(
      (item) => item?.uid && (item.type === 'local' || item.type === 'remote'),
    ) ?? []

  const results = await Promise.allSettled(
    items.map(async (item) => {
      const content = await readProfileFile(item.uid)
      const parsed = yaml.load(content)
      return collectProfileProxyEntries(
        parsed,
        item.name || '订阅配置',
        item.uid === currentUid,
      )
    }),
  )

  return results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  )
}

export async function collectSmartRoutingOptions(): Promise<SmartRoutingOptionCatalog> {
  const [config, proxyData, profileEntries] = await Promise.all([
    getRuntimeConfig(),
    calcuProxies().catch(() => null),
    collectProfileProxyEntriesFromFiles().catch(() => []),
  ])
  const proxyRecords = Object.values(proxyData?.records ?? {})
  const realProxyNames = proxyRecords
    .filter(
      (proxy) =>
        proxy?.name &&
        !proxy.all?.length &&
        !builtinPolicies.includes(proxy.name),
    )
    .map((proxy) => proxy.name)
  const groupNames = [
    ...collectRuntimeGroups(config),
    ...(proxyData?.groups.map((group) => group.name) ?? []),
  ]
  const currentSources = new Map(
    profileEntries
      .filter((entry) => entry.current)
      .map((entry) => [entry.name, entry.source]),
  )
  const policySources: Record<string, string> = {
    DIRECT: '内置',
    GLOBAL: '策略组',
    REJECT: '内置',
  }
  const nodeSources: Record<string, string> = {}

  groupNames.forEach((name) => {
    policySources[name] = '策略组'
  })
  proxyRecords.forEach((proxy) => {
    if (!proxy?.name || proxy.all?.length) return
    const source = proxy.provider || currentSources.get(proxy.name) || '当前配置'
    policySources[proxy.name] = source
    if (!builtinPolicies.includes(proxy.name)) {
      nodeSources[proxy.name] = source
    }
  })

  const policyTargets = new Set([...groupNames, ...realProxyNames])
  const nodeTargets = new Set(realProxyNames)
  const usedNames = new Set([
    ...builtinPolicies,
    ...groupNames,
    ...realProxyNames,
  ])

  profileEntries.forEach((entry) => {
    const shouldAlias = !entry.current && usedNames.has(entry.name)
    const optionName = shouldAlias
      ? uniqueAlias(entry.source, entry.name, usedNames)
      : entry.name

    usedNames.add(optionName)
    policyTargets.add(optionName)
    nodeTargets.add(optionName)
    policySources[optionName] = entry.source
    nodeSources[optionName] = entry.source
  })

  return {
    policyTargets: Array.from(policyTargets).filter(Boolean),
    nodeTargets: Array.from(nodeTargets).filter(Boolean),
    policySources,
    nodeSources,
  }
}
