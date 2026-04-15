import type { CliRuntimeConfig } from "../../config";
import { AppVerificationProviderClient } from "./app-client";
import { AppVerificationProvider } from "./app-provider";
import { ExchangeVerificationProvider } from "./exchange-provider";
import type { VerificationProvider, VerificationProviderKind } from "./types";

function hasAppVerificationConfig(config: {
  verification?: CliRuntimeConfig["verification"];
}): boolean {
  const appConfig = config.verification?.app;
  return Boolean(
    appConfig &&
      (appConfig.baseUrl ||
      appConfig.oidcIssuer ||
      appConfig.oidcBasePath ||
      appConfig.clientId ||
      appConfig.clientSecret ||
      appConfig.scope ||
      appConfig.resource ||
      appConfig.reserveEmailPath ||
      appConfig.verificationCodePath ||
      appConfig.verificationEventsPath),
  );
}

export function resolveVerificationProviderKind(config: {
  exchange?: CliRuntimeConfig["exchange"];
  verification?: CliRuntimeConfig["verification"];
}): VerificationProviderKind {
  const explicitProvider = config.verification?.provider;
  if (explicitProvider === "exchange" || explicitProvider === "app") {
    return explicitProvider;
  }

  if (config.exchange) return "exchange";
  if (hasAppVerificationConfig(config)) return "app";

  throw new Error(
    "Verification provider is not configured. Provide Exchange config or set verification.provider with verification.app settings.",
  );
}

export function createVerificationProvider(
  config: Pick<CliRuntimeConfig, "exchange" | "verification">,
): VerificationProvider {
  const provider = resolveVerificationProviderKind(config);
  if (provider === "exchange") {
    if (!config.exchange) {
      throw new Error(
        'Exchange config is required when verification.provider is "exchange".',
      );
    }

    return new ExchangeVerificationProvider(config.exchange);
  }

  return new AppVerificationProvider(
    new AppVerificationProviderClient(config.verification?.app),
  );
}

export * from "./types";
export * from "./exchange-provider";
export * from "./app-client";
export * from "./app-provider";
