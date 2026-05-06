import { createFileRoute } from '@tanstack/react-router'
import {
  consumeApprovedDeviceChallenge,
  consumeApprovedMobileDeviceChallenge,
  pollDeviceChallenge,
} from '../../../lib/server/device-auth'
import { json, text } from '../../../lib/server/http'

interface MobileDeviceConsumeRequest {
  kind?: string
  deviceId?: string
  label?: string
  capabilities?: string[]
  phoneBindings?: Array<{
    phoneNumber?: string
    countryCode?: string
    purpose?: string
    label?: string
    isDefault?: boolean
  }>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readMobileConsumeBody(value: unknown): MobileDeviceConsumeRequest {
  if (!isObject(value)) {
    return {}
  }

  return {
    kind: typeof value.kind === 'string' ? value.kind : undefined,
    deviceId: typeof value.deviceId === 'string' ? value.deviceId : undefined,
    label: typeof value.label === 'string' ? value.label : undefined,
    capabilities: Array.isArray(value.capabilities)
      ? value.capabilities.filter(
          (capability): capability is string => typeof capability === 'string',
        )
      : undefined,
    phoneBindings: Array.isArray(value.phoneBindings)
      ? value.phoneBindings.filter(isObject).map((binding) => ({
          phoneNumber:
            typeof binding.phoneNumber === 'string'
              ? binding.phoneNumber
              : undefined,
          countryCode:
            typeof binding.countryCode === 'string'
              ? binding.countryCode
              : undefined,
          purpose:
            typeof binding.purpose === 'string' ? binding.purpose : undefined,
          label: typeof binding.label === 'string' ? binding.label : undefined,
          isDefault:
            typeof binding.isDefault === 'boolean'
              ? binding.isDefault
              : undefined,
        }))
      : undefined,
  }
}

export const Route = createFileRoute('/api/device/$deviceCode')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const challenge = await pollDeviceChallenge(params.deviceCode)
        if (!challenge) return text('Device challenge not found', 404)

        return json({
          deviceCode: challenge.deviceCode,
          userCode: challenge.userCode,
          kind: challenge.kind,
          status: challenge.status,
          flowType: challenge.flowType,
          cliName: challenge.cliName,
          approvalMessage: challenge.approvalMessage,
          expiresAt: challenge.expiresAt.toISOString(),
        })
      },
      POST: async ({ request, params }) => {
        try {
          const bodyText = await request.text()
          let body: MobileDeviceConsumeRequest = {}
          if (bodyText.trim()) {
            try {
              body = readMobileConsumeBody(JSON.parse(bodyText))
            } catch {
              return text('Invalid JSON body', 400)
            }
          }
          if (body.kind === 'MOBILE') {
            if (!body.deviceId?.trim()) {
              return text('deviceId is required for mobile pairing', 400)
            }
            const result = await consumeApprovedMobileDeviceChallenge({
              deviceCode: params.deviceCode,
              deviceId: body.deviceId,
              label: body.label,
              capabilities: body.capabilities,
              phoneBindings: body.phoneBindings
                ?.filter(
                  (
                    binding,
                  ): binding is {
                    phoneNumber: string
                    countryCode?: string
                    purpose?: string
                    label?: string
                    isDefault?: boolean
                  } => Boolean(binding.phoneNumber?.trim()),
                )
                .map((binding) => ({
                  phoneNumber: binding.phoneNumber,
                  countryCode: binding.countryCode,
                  purpose: binding.purpose,
                  label: binding.label,
                  isDefault: binding.isDefault,
                })),
              userAgent: request.headers.get('user-agent'),
            })
            return json({
              deviceToken: result.deviceToken,
              device: {
                id: result.device.id,
                deviceId: result.device.deviceId,
                label: result.device.label,
                status: result.device.status,
                capabilities: result.device.capabilities,
              },
              user: result.user,
            })
          }

          const result = await consumeApprovedDeviceChallenge(params.deviceCode)
          return json({
            accessToken: result.accessToken,
            user: result.user,
          })
        } catch (error) {
          return text(
            error instanceof Error
              ? error.message
              : 'Unable to consume challenge',
            400,
          )
        }
      },
    },
  },
})
