import { type ReactNode, useEffect, useRef, useState } from 'react'

import { CheckIcon, ClipboardCopyIcon } from 'lucide-react'

import { cn } from '#/lib/utils'
import { showAppToast } from '#/lib/toast'
import { m } from '#/paraglide/messages'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'

type CopyableValueProps = {
  value?: string | null
  displayValue?: ReactNode
  className?: string
  contentClassName?: string
  iconClassName?: string
  copiedClassName?: string
  disabled?: boolean
  code?: boolean
  showIcon?: boolean
  iconMode?: 'inline' | 'overlay'
  title: string
  onCopyError?: () => void
  onCopySuccess?: () => void
}

export function CopyableValue(props: CopyableValueProps) {
  const resetTimerRef = useRef<number | null>(null)
  const [copied, setCopied] = useState(false)
  const value = props.value ?? ''
  const disabled = props.disabled ?? !value

  useEffect(() => {
    return () => {
      if (resetTimerRef.current != null) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    setCopied(false)

    if (resetTimerRef.current != null) {
      window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
  }, [value])

  async function handleCopy() {
    if (disabled || typeof navigator === 'undefined' || !navigator.clipboard) {
      if (props.onCopyError) {
        props.onCopyError()
      } else {
        showAppToast({
          kind: 'error',
          description: m.clipboard_copy_error(),
        })
      }
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (props.onCopySuccess) {
        props.onCopySuccess()
      } else {
        showAppToast({
          kind: 'success',
          description: m.clipboard_copy_success(),
        })
      }

      if (resetTimerRef.current != null) {
        window.clearTimeout(resetTimerRef.current)
      }

      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false)
        resetTimerRef.current = null
      }, 1500)
    } catch {
      if (props.onCopyError) {
        props.onCopyError()
      } else {
        showAppToast({
          kind: 'error',
          description: m.clipboard_copy_error(),
        })
      }
    }
  }

  const content = props.displayValue ?? value
  const button = (
    <button
      type="button"
      onClick={() => {
        void handleCopy()
      }}
      disabled={disabled}
      className={cn(
        'group inline-flex min-w-0 items-center gap-2 rounded-sm text-left transition-colors',
        props.iconMode === 'overlay' && 'relative',
        disabled
          ? 'cursor-default text-muted-foreground'
          : 'cursor-copy hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        copied && !disabled && 'text-emerald-600 dark:text-emerald-300',
        copied && !disabled && props.copiedClassName,
        props.className,
      )}
      aria-label={props.title}
    >
      {props.code ? (
        <code className={cn('min-w-0', props.contentClassName)}>{content}</code>
      ) : (
        <span className={cn('min-w-0', props.contentClassName)}>{content}</span>
      )}

      {!disabled && props.showIcon !== false ? (
        copied ? (
          <CheckIcon
            className={cn(
              'size-3.5 shrink-0',
              props.iconMode === 'overlay' &&
                'pointer-events-none absolute top-1/2 right-3 -translate-y-1/2',
              props.iconClassName,
            )}
          />
        ) : (
          <ClipboardCopyIcon
            className={cn(
              'size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70',
              props.iconMode === 'overlay' &&
                'pointer-events-none absolute top-1/2 right-3 -translate-y-1/2',
              props.iconClassName,
            )}
          />
        )
      ) : null}
    </button>
  )

  if (disabled) {
    return button
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          {props.title}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
