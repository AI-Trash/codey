import type { Page } from "patchright";
import type { SelectorList } from "../../types";
import {
  createStateMachine,
  type StateMachineController,
  type StateMachineSnapshot,
} from "../../state-machine";
import type { AccountType } from "../common/account-types";
import type { LoginOptions, LoginResult } from "../login";
import type { RegistrationOptions, RegistrationResult } from "../registration";
import type { VirtualPasskeyStore } from "../webauthn";

export type AuthMachineKind = "login" | "registration";

export type AuthMachineState =
  | "idle"
  | "opening"
  | "ready"
  | "typing-email"
  | "typing-password"
  | "typing-organization"
  | "toggling-remember-me"
  | "choosing-passkey"
  | "waiting-passkey"
  | "submitting"
  | "post-submit"
  | "capturing-passkey"
  | "completed"
  | "failed";

export type AuthMachineEvent =
  | "machine.started"
  | "auth.opened"
  | "auth.ready"
  | "auth.email.typed"
  | "auth.password.typed"
  | "auth.organization.typed"
  | "auth.remember-me.checked"
  | "auth.passkey.chosen"
  | "auth.passkey.prompted"
  | "auth.submitted"
  | "auth.after-submit.started"
  | "auth.after-submit.finished"
  | "auth.passkey.capture.started"
  | "auth.passkey.capture.finished"
  | "auth.completed"
  | "auth.failed"
  | "context.updated"
  | "action.started"
  | "action.finished";

export interface AuthMachineContext<Result = unknown> {
  kind: AuthMachineKind;
  accountType?: AccountType;
  url?: string;
  email?: string | null;
  method?: "password" | "passkey";
  createPasskey?: boolean;
  preferPasskey?: boolean;
  organizationName?: string | null;
  passkeyCreated?: boolean;
  passkeyStore?: VirtualPasskeyStore;
  lastSelectors?: SelectorList;
  lastMessage?: string;
  result?: Result;
}

export type AuthMachine<Result = unknown> = StateMachineController<
  AuthMachineState,
  AuthMachineContext<Result>,
  AuthMachineEvent
>;

export type AuthMachineSnapshotResult<Result = unknown> = StateMachineSnapshot<
  AuthMachineState,
  AuthMachineContext<Result>,
  AuthMachineEvent
>;

export interface LoginMachineOptions {
  id?: string;
  options?: LoginOptions;
}

export interface RegistrationMachineOptions {
  id?: string;
  options?: RegistrationOptions;
}

function buildBaseMachine<Result>(
  kind: AuthMachineKind,
  id: string,
  context: Partial<AuthMachineContext<Result>> = {},
): AuthMachine<Result> {
  return createStateMachine<AuthMachineState, AuthMachineContext<Result>, AuthMachineEvent>({
    id,
    initialState: "idle",
    initialContext: {
      kind,
      ...context,
    } as AuthMachineContext<Result>,
  });
}

export function createLoginMachine(config: LoginMachineOptions = {}): AuthMachine<LoginResult> {
  return buildBaseMachine<LoginResult>("login", config.id ?? "auth.login", {
    accountType: config.options?.accountType as AccountType | undefined,
    url: config.options?.url,
    email: config.options?.email ?? null,
    preferPasskey: config.options?.preferPasskey,
  });
}

export function createRegistrationMachine(
  config: RegistrationMachineOptions = {},
): AuthMachine<RegistrationResult> {
  return buildBaseMachine<RegistrationResult>("registration", config.id ?? "auth.registration", {
    accountType: config.options?.accountType as AccountType | undefined,
    url: config.options?.url,
    email: config.options?.email ?? null,
    organizationName: config.options?.organizationName ?? null,
    createPasskey: config.options?.createPasskey ?? true,
  });
}

export function startAuthMachine<Result>(
  machine: AuthMachine<Result>,
  context: Partial<AuthMachineContext<Result>>,
): AuthMachineSnapshotResult<Result> {
  return machine.start(context, {
    source: "auth-machine",
  });
}

export async function runWithAuthMachine<Result>(
  machine: AuthMachine<Result> | undefined,
  context: Partial<AuthMachineContext<Result>>,
  action: () => Promise<Result>,
): Promise<Result> {
  if (!machine) return action();

  startAuthMachine(machine, context);
  try {
    const result = await action();
    machine.succeed("completed", {
      event: "auth.completed",
      patch: { result } as Partial<AuthMachineContext<Result>>,
      meta: { source: "auth-machine" },
    });
    return result;
  } catch (error) {
    machine.fail(error, "failed", {
      event: "auth.failed",
      meta: { source: "auth-machine" },
    });
    throw error;
  }
}

export function markAuthOpened<Result>(
  machine: AuthMachine<Result> | undefined,
  page: Page,
  selectors?: SelectorList,
): void {
  machine?.transition("ready", {
    event: "auth.opened",
    patch: {
      url: page.url(),
      lastSelectors: selectors,
      lastMessage: "Authentication surface opened",
    } as Partial<AuthMachineContext<Result>>,
  });
}

export function markAuthStep<Result>(
  machine: AuthMachine<Result> | undefined,
  state: AuthMachineState,
  event: AuthMachineEvent,
  patch?: Partial<AuthMachineContext<Result>>,
): void {
  machine?.transition(state, {
    event,
    patch,
  });
}
