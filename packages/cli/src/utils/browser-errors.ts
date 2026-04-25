const RECOVERABLE_BROWSER_AUTOMATION_ERROR_PATTERNS = [
  /Protocol error\s*\([^)]*\):\s*Cannot find context with specified id/i,
  /Cannot find context with specified id/i,
  /Execution context was destroyed/i,
  /Cannot find object with id/i,
  /Target page, context or browser has been closed/i,
  /Target closed/i,
  /Frame was detached/i,
  /Page closed/i,
  /Browser has been closed/i,
  /Context closed/i,
  /Session closed/i,
  /This operation was aborted/i,
] as const

function collectErrorText(error: unknown, seen = new Set<unknown>()): string {
  if (error == null || seen.has(error)) {
    return ''
  }
  seen.add(error)

  if (error instanceof AggregateError) {
    return [
      error.name,
      error.message,
      ...error.errors.map((entry) => collectErrorText(entry, seen)),
    ].join('\n')
  }

  if (error instanceof Error) {
    return [
      error.name,
      error.message,
      error.stack,
      collectErrorText(error.cause, seen),
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>
    return [
      record.name,
      record.message,
      record.method,
      record.type,
      collectErrorText(record.cause, seen),
    ]
      .filter((value): value is string => typeof value === 'string')
      .join('\n')
  }

  return String(error)
}

export function isRecoverableBrowserAutomationError(error: unknown): boolean {
  const text = collectErrorText(error)
  return RECOVERABLE_BROWSER_AUTOMATION_ERROR_PATTERNS.some((pattern) =>
    pattern.test(text),
  )
}
