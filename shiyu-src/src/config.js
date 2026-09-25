export const IS_ZHAOHUA = import.meta.env.VITE_APP_VARIANT === 'zhaohua'

export const APP = IS_ZHAOHUA ? {
  name: '昭华',
  english: 'Luminous memory',
  apiPrefix: '/zhaohua',
  storeKey: 'zhaohua-store',
  agent: '昭华',
} : {
  name: '拾羽',
  english: 'picking up feathers',
  apiPrefix: '',
  storeKey: 'shiyu-store',
  agent: '阿言',
}
