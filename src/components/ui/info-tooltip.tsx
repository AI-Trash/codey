import type { ComponentProps, ReactNode } from 'react'

import { InfoIcon } from 'lucide-react'

import { cn } from '#/lib/utils'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip'

function InfoTooltip(props: {
  content?: ReactNode
  label?: string
  className?: string
  iconClassName?: string
  contentClassName?: string
  side?: ComponentProps<typeof TooltipContent>['side']
  align?: ComponentProps<typeof TooltipContent>['align']
}) {
  if (props.content == null) {
    return null
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={props.label || 'More information'}
            className={cn(
              'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              props.className,
            )}
          >
            <InfoIcon className={cn('size-3.5', props.iconClassName)} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={props.side}
          align={props.align}
          sideOffset={8}
          className={cn(
            'max-w-80 px-3 py-2 text-left text-xs leading-5',
            props.contentClassName,
          )}
        >
          {props.content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { InfoTooltip }
