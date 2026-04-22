export interface DashboardRenderTarget<TState> {
  update(state: TState): void
}

export function applyDashboardAppUpdate<TState>(input: {
  app: DashboardRenderTarget<TState>
  state: TState
  appStarted: boolean
  appSuspended: boolean
}): boolean {
  if (!input.appStarted || input.appSuspended) {
    return false
  }

  input.app.update(input.state)
  return true
}
