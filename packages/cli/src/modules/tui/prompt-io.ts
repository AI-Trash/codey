import {
  createInterface,
  type Interface as PromptInterface,
} from 'readline/promises'

export interface PromptChoice<TValue extends string = string> {
  value: TValue
  label: string
  hint?: string
}

export interface PromptSession {
  input(input: {
    message: string
    initial?: string
    allowBlank?: boolean
    validate?: (value: string) => true | string
  }): Promise<string>
  confirm(input: { message: string; initial?: boolean }): Promise<boolean>
  select<TValue extends string>(input: {
    message: string
    choices: readonly PromptChoice<TValue>[]
    initial?: TValue
  }): Promise<TValue>
  multiSelect<TValue extends string>(input: {
    message: string
    choices: readonly PromptChoice<TValue>[]
    initial?: readonly TValue[]
    allowEmpty?: boolean
  }): Promise<TValue[]>
}

export class PromptCanceledError extends Error {
  constructor(message = 'Prompt canceled.') {
    super(message)
    this.name = 'PromptCanceledError'
  }
}

function normalizeAnswer(value: string): string {
  return value.trim()
}

function formatChoiceLine<TValue extends string>(
  choice: PromptChoice<TValue>,
  index: number,
): string {
  const detail = choice.hint ? ` - ${choice.hint}` : ''
  return `  ${index + 1}. ${choice.label}${detail}`
}

function resolveChoiceByAnswer<TValue extends string>(
  value: string,
  choices: readonly PromptChoice<TValue>[],
): PromptChoice<TValue> | undefined {
  const normalized = normalizeAnswer(value)
  if (!normalized) {
    return undefined
  }

  const numericIndex = Number.parseInt(normalized, 10)
  if (
    Number.isInteger(numericIndex) &&
    numericIndex >= 1 &&
    numericIndex <= choices.length
  ) {
    return choices[numericIndex - 1]
  }

  const lowered = normalized.toLowerCase()
  return choices.find((choice) => {
    const labelMatches = choice.label.trim().toLowerCase() === lowered
    const valueMatches = choice.value.trim().toLowerCase() === lowered
    return labelMatches || valueMatches
  })
}

function parseMultiSelectValues<TValue extends string>(
  value: string,
  choices: readonly PromptChoice<TValue>[],
): TValue[] | undefined {
  const tokens = normalizeAnswer(value)
    .split(/[,\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)

  if (!tokens.length) {
    return []
  }

  const resolved: TValue[] = []
  const seen = new Set<string>()

  for (const token of tokens) {
    const choice = resolveChoiceByAnswer(token, choices)
    if (!choice) {
      return undefined
    }

    if (!seen.has(choice.value)) {
      seen.add(choice.value)
      resolved.push(choice.value)
    }
  }

  return resolved
}

class ReadlinePromptSession implements PromptSession {
  constructor(
    private readonly prompt: PromptInterface,
    private readonly output: NodeJS.WriteStream,
  ) {}

  private writeLine(line = ''): void {
    this.output.write(`${line}\n`)
  }

  private async ask(message: string, initial?: string): Promise<string> {
    const suffix =
      typeof initial === 'string' && initial.trim()
        ? ` [default: ${initial}]`
        : ''
    const answer = await this.prompt.question(`${message}${suffix}\n> `)
    return typeof answer === 'string' ? answer : ''
  }

  async input(input: {
    message: string
    initial?: string
    allowBlank?: boolean
    validate?: (value: string) => true | string
  }): Promise<string> {
    while (true) {
      const rawAnswer = await this.ask(input.message, input.initial)
      const normalized = normalizeAnswer(rawAnswer || input.initial || '')

      if (!normalized && !input.allowBlank) {
        this.writeLine('A value is required.')
        continue
      }

      const validation = input.validate?.(normalized) ?? true
      if (validation !== true) {
        this.writeLine(validation)
        continue
      }

      return normalized
    }
  }

  async confirm(input: {
    message: string
    initial?: boolean
  }): Promise<boolean> {
    const defaultValue = input.initial ?? true

    while (true) {
      const hint = defaultValue ? '[Y/n]' : '[y/N]'
      const answer = normalizeAnswer(
        await this.prompt.question(`${input.message} ${hint}\n> `),
      )

      if (!answer) {
        return defaultValue
      }

      if (['y', 'yes'].includes(answer.toLowerCase())) {
        return true
      }

      if (['n', 'no'].includes(answer.toLowerCase())) {
        return false
      }

      this.writeLine('Enter y or n.')
    }
  }

  async select<TValue extends string>(input: {
    message: string
    choices: readonly PromptChoice<TValue>[]
    initial?: TValue
  }): Promise<TValue> {
    if (!input.choices.length) {
      throw new Error('Select prompt requires at least one choice.')
    }

    while (true) {
      this.writeLine(input.message)
      input.choices.forEach((choice, index) => {
        this.writeLine(formatChoiceLine(choice, index))
      })

      const defaultChoice = input.initial
        ? input.choices.find((choice) => choice.value === input.initial)
        : undefined
      const answer = await this.ask(
        'Choose an option by number or value',
        defaultChoice
          ? String(input.choices.indexOf(defaultChoice) + 1)
          : undefined,
      )
      const selected =
        resolveChoiceByAnswer(answer, input.choices) || defaultChoice

      if (selected) {
        return selected.value
      }

      this.writeLine('Choose one of the listed options.')
    }
  }

  async multiSelect<TValue extends string>(input: {
    message: string
    choices: readonly PromptChoice<TValue>[]
    initial?: readonly TValue[]
    allowEmpty?: boolean
  }): Promise<TValue[]> {
    if (!input.choices.length) {
      return []
    }

    while (true) {
      this.writeLine(input.message)
      input.choices.forEach((choice, index) => {
        this.writeLine(formatChoiceLine(choice, index))
      })

      const initial = input.initial?.length
        ? input.initial
            .map((value) => {
              const index = input.choices.findIndex(
                (choice) => choice.value === value,
              )
              return index >= 0 ? String(index + 1) : value
            })
            .join(', ')
        : undefined
      const answer = await this.ask(
        input.allowEmpty
          ? 'Choose zero or more options as comma-separated numbers or values'
          : 'Choose one or more options as comma-separated numbers or values',
        initial,
      )

      const resolved = parseMultiSelectValues(answer, input.choices)
      if (resolved && (resolved.length || input.allowEmpty)) {
        return resolved
      }

      if (resolved && !resolved.length && input.allowEmpty) {
        return resolved
      }

      if (resolved && !resolved.length) {
        this.writeLine('Choose at least one option.')
        continue
      }

      this.writeLine('Choose only from the listed options.')
    }
  }
}

export async function withPromptSession<T>(
  task: (session: PromptSession) => Promise<T>,
): Promise<T> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })

  try {
    return await task(new ReadlinePromptSession(prompt, process.stdout))
  } catch (error) {
    if (
      error instanceof Error &&
      /The operation was aborted/i.test(error.message)
    ) {
      throw new PromptCanceledError()
    }
    throw error
  } finally {
    prompt.close()
  }
}

export function buildChoiceHint(choice: PromptChoice, index: number): string {
  return formatChoiceLine(choice, index)
}
