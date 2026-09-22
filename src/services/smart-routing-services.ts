import rawServiceCatalog from '@/assets/data/smart-routing-services.json'

export type SmartRoutingServiceCategory =
  | 'ai'
  | 'development'
  | 'streaming'
  | 'gaming'

export type SmartRoutingMatcherType =
  | 'domain-suffix'
  | 'process-name'
  | 'process-path'
  | 'rule-set'

export type SmartRoutingServiceMatcher = {
  type: SmartRoutingMatcherType
  value: string
  relation?: 'first-party' | 'third-party'
  platforms?: Array<'windows' | 'macos' | 'linux'>
  confidence: 'high' | 'medium'
  url?: string
  source: {
    label: string
    url?: string
  }
}

export type SmartRoutingServiceDefinition = {
  id: string
  name: string
  category: SmartRoutingServiceCategory
  updated_at: string
  matchers: SmartRoutingServiceMatcher[]
  default_policy: 'proxy' | 'direct'
}

export const smartRoutingServiceCategories: Array<{
  id: SmartRoutingServiceCategory
  label: string
}> = [
  { id: 'ai', label: 'AI 服务' },
  { id: 'development', label: '开发服务' },
  { id: 'streaming', label: '影音服务' },
  { id: 'gaming', label: '游戏平台' },
]

export const smartRoutingServices =
  rawServiceCatalog as SmartRoutingServiceDefinition[]

export const smartRoutingServiceMap = new Map(
  smartRoutingServices.map((service) => [service.id, service]),
)

const CURRENT_MATCHER_PLATFORM =
  OS_PLATFORM === 'win32'
    ? 'windows'
    : OS_PLATFORM === 'darwin'
      ? 'macos'
      : 'linux'

export function serviceMatcherSupportsCurrentPlatform(
  matcher: SmartRoutingServiceMatcher,
) {
  return (
    !matcher.platforms?.length ||
    matcher.platforms.includes(CURRENT_MATCHER_PLATFORM)
  )
}

export function getServiceMatcherCounts(
  service: SmartRoutingServiceDefinition,
) {
  return service.matchers.reduce(
    (counts, matcher) => {
      if (matcher.type === 'domain-suffix') counts.domains += 1
      if (matcher.relation === 'third-party') counts.thirdParty += 1
      if (matcher.type === 'process-name' || matcher.type === 'process-path') {
        counts.processes += 1
      }
      if (matcher.type === 'rule-set') counts.ruleSets += 1
      return counts
    },
    { domains: 0, processes: 0, ruleSets: 0, thirdParty: 0 },
  )
}

function normalizeHost(value?: string) {
  return `${value ?? ''}`
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/:\d+$/g, '')
    .toLowerCase()
}

function normalizeProcess(value?: string) {
  return `${value ?? ''}`
    .trim()
    .replace(/^["']|["']$/g, '')
    .split(/[\\/]/)
    .pop()
    ?.trim()
    .toLowerCase()
}

export function matchServiceConnection(
  service: SmartRoutingServiceDefinition,
  connection: IConnectionsItem,
) {
  const host = normalizeHost(
    connection.metadata.host ||
      connection.metadata.remoteDestination ||
      connection.metadata.destinationIP,
  )
  const processNames = [
    normalizeProcess(connection.metadata.process),
    normalizeProcess(connection.metadata.processPath),
  ].filter(Boolean)

  return service.matchers.find((matcher) => {
    if (
      matcher.confidence !== 'high' ||
      !serviceMatcherSupportsCurrentPlatform(matcher)
    ) {
      return false
    }

    const value = matcher.value.trim().toLowerCase()
    if (matcher.type === 'process-name') return processNames.includes(value)
    if (matcher.type === 'domain-suffix') {
      return host === value || host.endsWith(`.${value}`)
    }
    return false
  })
}
