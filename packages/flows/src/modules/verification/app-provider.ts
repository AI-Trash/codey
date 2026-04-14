import { AppVerificationProviderClient } from "./app-client";
import type {
  VerificationEmailTarget,
  VerificationProvider,
  WaitForVerificationCodeOptions,
} from "./types";

export class AppVerificationProvider implements VerificationProvider {
  readonly kind = "app" as const;

  constructor(private readonly client: AppVerificationProviderClient) {}

  async prepareEmailTarget(): Promise<VerificationEmailTarget> {
    return this.client.reserveEmailTarget();
  }

  async primeInbox(): Promise<void> {}

  async waitForVerificationCode(
    options: WaitForVerificationCodeOptions,
  ): Promise<string> {
    return this.client.waitForVerificationCode(options);
  }
}
