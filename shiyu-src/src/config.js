export const IS_ZHAOHUA = import.meta.env.VITE_APP_VARIANT === 'zhaohua'

export const APP = IS_ZHAOHUA ? {
  name: '昭华',
  english: 'Luminous memory',
  apiPrefix: '/zhaohua',
  storeKey: 'zhaohua-store',
  // `agent` is the stable database namespace. Keep it separate from the
  // person-facing name so existing records do not need a data migration.
  agent: '昭华',
  agentDisplayName: '曜',
} : {
  name: '拾羽',
  english: 'picking up feathers',
  apiPrefix: '',
  storeKey: 'shiyu-store',
  agent: '阿言',
  agentDisplayName: '阿言',
}
