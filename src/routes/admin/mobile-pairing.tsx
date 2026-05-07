import { useState, type ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { QRCodeSVG } from 'qrcode.react'
import {
  CopyIcon,
  ExternalLinkIcon,
  PlusIcon,
  RefreshCcwIcon,
  ScanQrCodeIcon,
} from 'lucide-react'

import {
  AdminPageHeader,
  StatusBadge,
  formatAdminDate,
} from '#/components/admin/layout'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { CopyableValue } from '#/components/ui/copyable-value'
import {
  MOBILE_PAIRING_FLOW_TYPE,
  MOBILE_PAIRING_SCOPE,
  buildMobilePairingDeepLink,
  buildMobilePairingFallbackUrl,
} from '#/lib/mobile-pairing'
import { getToastErrorDescription, showAppToast } from '#/lib/toast'
import { m } from '#/paraglide/messages'

type MobilePairingChallenge = {
  deviceCode: string
  userCode: string
  status: string
  expiresAt: string
  pairingDeepLink: string
  verificationUrl: string
}

const createMobilePairingChallenge = createServerFn({ method: 'POST' }).handler(
  async () => {
    const [{ requireAdminPermission }, { createDeviceChallenge }] =
      await Promise.all([
        import('../../lib/server/auth'),
        import('../../lib/server/device-auth'),
      ])
    const request = getRequest()
    const admin = await requireAdminPermission(request, 'CLI_OPERATIONS')
    const baseUrl = new URL(request.url).origin
    const challenge = await createDeviceChallenge({
      kind: 'MOBILE',
      flowType: MOBILE_PAIRING_FLOW_TYPE,
      cliName: 'CodeyApp Android',
      requestedBy: admin.user.githubLogin || admin.user.email || admin.user.id,
      scope: MOBILE_PAIRING_SCOPE,
    })

    return {
      deviceCode: challenge.deviceCode,
      userCode: challenge.userCode,
      status: challenge.status,
      expiresAt: challenge.expiresAt.toISOString(),
      pairingDeepLink: buildMobilePairingDeepLink({
        baseUrl,
        deviceCode: challenge.deviceCode,
        userCode: challenge.userCode,
      }),
      verificationUrl: buildMobilePairingFallbackUrl({
        baseUrl,
        userCode: challenge.userCode,
      }),
    }
  },
)

export const Route = createFileRoute('/admin/mobile-pairing')({
  component: AdminMobilePairingPage,
})

function AdminMobilePairingPage() {
  const [challenge, setChallenge] = useState<MobilePairingChallenge | null>(
    null,
  )
  const [isCreating, setIsCreating] = useState(false)

  async function handleCreateChallenge() {
    setIsCreating(true)
    try {
      setChallenge(await createMobilePairingChallenge())
    } catch (error) {
      showAppToast({
        kind: 'error',
        description: getToastErrorDescription(
          error,
          m.admin_mobile_pairing_create_error(),
        ),
      })
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <>
      <AdminPageHeader
        eyebrow={m.admin_mobile_pairing_kicker()}
        title={m.admin_mobile_pairing_title()}
        description={m.admin_mobile_pairing_description()}
        actions={
          <Button
            variant={challenge ? 'outline' : 'default'}
            disabled={isCreating}
            onClick={() => {
              void handleCreateChallenge()
            }}
          >
            {challenge ? <RefreshCcwIcon /> : <PlusIcon />}
            {challenge
              ? m.admin_mobile_pairing_refresh_button()
              : m.admin_mobile_pairing_create_button()}
          </Button>
        }
      />

      {challenge ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <MobilePairingQrCard challenge={challenge} />
          <MobilePairingManualCard challenge={challenge} />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{m.admin_mobile_pairing_empty_title()}</CardTitle>
            <CardDescription>
              {m.admin_mobile_pairing_empty_description()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              disabled={isCreating}
              onClick={() => {
                void handleCreateChallenge()
              }}
            >
              <PlusIcon />
              {m.admin_mobile_pairing_create_button()}
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  )
}

function MobilePairingQrCard(props: { challenge: MobilePairingChallenge }) {
  const { challenge } = props

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.admin_mobile_pairing_qr_title()}</CardTitle>
        <CardDescription>
          {m.admin_mobile_pairing_qr_description()}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-4 rounded-lg border bg-muted/20 p-4 sm:p-6">
          <QRCodeSVG
            value={challenge.pairingDeepLink}
            size={256}
            level="M"
            marginSize={2}
            className="h-auto w-full max-w-64 rounded-md bg-white p-2"
          />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ScanQrCodeIcon className="size-4" />
            <span>{m.admin_mobile_pairing_scan_hint()}</span>
          </div>
        </div>

        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <Info
            label={m.device_info_user_code()}
            value={
              <CopyableValue
                value={challenge.userCode}
                title={m.clipboard_copy_value({
                  label: m.device_info_user_code(),
                })}
                code
                contentClassName="text-base font-semibold"
              />
            }
          />
          <Info
            label={m.device_info_status()}
            value={<StatusBadge value={challenge.status} />}
          />
          <Info
            label={m.admin_mobile_pairing_expires_at()}
            value={
              formatAdminDate(challenge.expiresAt) ||
              m.device_value_not_available()
            }
          />
          <Info
            label={m.admin_mobile_pairing_link_label()}
            value={
              <CopyableValue
                value={challenge.verificationUrl}
                title={m.clipboard_copy_value({
                  label: m.admin_mobile_pairing_link_label(),
                })}
                contentClassName="truncate"
                iconMode="overlay"
                className="max-w-full pr-9"
              />
            }
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a
              href={challenge.verificationUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon />
              {m.admin_mobile_pairing_open_link()}
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={challenge.pairingDeepLink}>
              <ScanQrCodeIcon />
              {m.admin_mobile_pairing_open_app_link()}
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function MobilePairingManualCard(props: { challenge: MobilePairingChallenge }) {
  const { challenge } = props

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.admin_mobile_pairing_manual_title()}</CardTitle>
        <CardDescription>
          {m.admin_mobile_pairing_manual_description()}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border p-4">
          <p className="mb-2 text-sm font-medium">
            {m.admin_mobile_pairing_deep_link_label()}
          </p>
          <CopyableValue
            value={challenge.pairingDeepLink}
            title={m.clipboard_copy_value({
              label: m.admin_mobile_pairing_deep_link_label(),
            })}
            displayValue={challenge.pairingDeepLink}
            contentClassName="max-w-full truncate text-xs"
            iconMode="overlay"
            className="w-full pr-9"
          />
        </div>
        <Button asChild variant="outline" className="w-full">
          <a href={challenge.pairingDeepLink}>
            <CopyIcon />
            {m.admin_mobile_pairing_copy_fallback_hint()}
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}

function Info(props: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {props.label}
      </p>
      <div className="min-w-0 text-foreground">{props.value}</div>
    </div>
  )
}
