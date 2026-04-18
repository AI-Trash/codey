import { type ReactNode, useEffect, useRef, useState } from 'react'

import { CheckIcon, ClipboardCopyIcon } from 'lucide-react'

import { cn } from '#/lib/utils'

type CopyableValueProps = {
  value?: string | null
  displayValue?: ReactNode
  className?: string
  contentClassName?: string
  iconClassName?: string
  disabled?: boolean
  code?: boolean
  showIcon?: boolean
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
      props.onCopyError?.()
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      props.onCopySuccess?.()

      if (resetTimerRef.current != null) {
        window.clearTimeout(resetTimerRef.current)
      }

      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false)
        resetTimerRef.current = null
      }, 1500)
    } catch {
      props.onCopyError?.()
    }
  }

  const content = props.displayValue ?? value

  return (
    <button
      type="button"
      onClick={() => {
        void handleCopy()
      }}
      disabled={disabled}
      className={cn(
        'group inline-flex min-w-0 items-center gap-2 rounded-sm text-left transition-colors',
        disabled
          ? 'cursor-default text-muted-foreground'
          : 'cursor-copy hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        copied && !disabled && 'text-emerald-600 dark:text-emerald-300',
        props.className,
      )}
      aria-label={props.title}
      title={props.title}
    >
      {props.code ? (
        <code className={cn('min-w-0', props.contentClassName)}>{content}</code>
      ) : (
        <span className={cn('min-w-0', props.contentClassName)}>{content}</span>
      )}

      {!disabled && props.showIcon !== false ? (
        copied ? (
          <CheckIcon className="size-3.5 shrink-0" />
        ) : (
          <ClipboardCopyIcon
            className={cn(
              'size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70',
              props.iconClassName,
            )}
          />
        )
      ) : null}
    </button>
  )
}
