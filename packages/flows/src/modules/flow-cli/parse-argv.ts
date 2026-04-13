import type { CommonOptions, FlowOptions } from './helpers'

export function parseCommonCliArgs(argv: string[]): CommonOptions {
  const options: CommonOptions = {}
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]
    if (current === '--config' && next) {
      options.config = next
      index += 1
    } else if (current === '--profile' && next) {
      options.profile = next
      index += 1
    } else if (current === '--headless' && next) {
      options.headless = next
      index += 1
    } else if (current === '--slowMo' && next) {
      options.slowMo = next
      index += 1
    }
  }
  return options
}

export function parseFlowCliArgs(argv: string[]): FlowOptions {
  const options: FlowOptions = {}
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]
    if (!current.startsWith('--')) continue
    const key = current.slice(2) as keyof FlowOptions
    if (next && !next.startsWith('--')) {
      options[key] = next as never
      index += 1
    } else {
      options[key] = true as never
    }
  }
  return options
}
