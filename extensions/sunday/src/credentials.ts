import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { SundayConfig, SundayCredentialSource } from "./types.js";

export type SundayCredentialResolution = {
  agentId: string;
  apiKey: string;
  source: SundayCredentialSource;
};

export function resolveSundayCredentials(
  config: SundayConfig | undefined,
  accountId?: string | null,
): SundayCredentialResolution {
  const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
  const isDefaultAccount = resolvedAccountId === DEFAULT_ACCOUNT_ID;
  const accountConfig =
    resolvedAccountId !== DEFAULT_ACCOUNT_ID
      ? (config?.accounts?.[resolvedAccountId] as SundayConfig | undefined)
      : undefined;

  if (accountConfig) {
    const agentId = accountConfig.agentId?.trim();
    const apiKey = accountConfig.apiKey?.trim();
    if (agentId && apiKey) {
      return { agentId, apiKey, source: "config" };
    }
  }

  if (isDefaultAccount) {
    const agentId = config?.agentId?.trim();
    const apiKey = config?.apiKey?.trim();
    if (agentId && apiKey) {
      return { agentId, apiKey, source: "config" };
    }

    const envAgentId = process.env.SUNDAY_AGENT_ID?.trim();
    const envApiKey = process.env.SUNDAY_API_KEY?.trim();
    if (envAgentId && envApiKey) {
      return { agentId: envAgentId, apiKey: envApiKey, source: "env" };
    }
  }

  return { agentId: "", apiKey: "", source: "none" };
}
