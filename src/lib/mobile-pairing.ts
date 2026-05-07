export const MOBILE_PAIRING_SCHEME = 'codey'
export const MOBILE_PAIRING_HOST = 'pair'
export const MOBILE_PAIRING_VERSION = '1'
export const MOBILE_PAIRING_FLOW_TYPE = 'codey-mobile-pairing'
export const MOBILE_PAIRING_SCOPE =
  'mobile:pair mobile:whatsapp:ingest mobile:gopay:task'

export function buildMobilePairingDeepLink(params: {
  baseUrl: string
  deviceCode: string
  userCode: string
}) {
  const url = new URL(`${MOBILE_PAIRING_SCHEME}://${MOBILE_PAIRING_HOST}`)
  url.searchParams.set('v', MOBILE_PAIRING_VERSION)
  url.searchParams.set('baseUrl', params.baseUrl)
  url.searchParams.set('deviceCode', params.deviceCode)
  url.searchParams.set('userCode', params.userCode)
  return url.toString()
}

export function buildMobilePairingFallbackUrl(params: {
  baseUrl: string
  userCode: string
}) {
  const url = new URL('/device', params.baseUrl)
  url.searchParams.set('userCode', params.userCode)
  return url.toString()
}
