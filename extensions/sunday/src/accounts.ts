import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveSundayCredentials } from "./credentials.js";
import type { ResolvedSundayAccount, SundayAccountConfig, SundayConfig } from "./types.js";

export type { ResolvedSundayAccount };

const DEFAULT_API_BASE_URL = process.env.SUNDAY_API_BASE_URL?.trim() || "https://api.sunday.app";

function listConfiguredAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = (cfg.channels?.sunday as SundayConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  return Object.keys(accounts).filter(Boolean);
}

export function listSundayAccountIds(cfg: OpenClawConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultSundayAccountId(cfg: OpenClawConfig): string {
  const sundayConfig = cfg.channels?.sunday as SundayConfig | undefined;
  if (sundayConfig?.defaultAccount?.trim()) {
    return sundayConfig.defaultAccount.trim();
  }
  const ids = listSundayAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): SundayAccountConfig | undefined {
  const accounts = (cfg.channels?.sunday as SundayConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  return accounts[accountId] as SundayAccountConfig | undefined;
}

function mergeSundayAccountConfig(cfg: OpenClawConfig, accountId: string): SundayAccountConfig {
  const raw = (cfg.channels?.sunday ?? {}) as SundayConfig;
  const { accounts: _ignored, defaultAccount: _ignored2, ...base } = raw;
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

export function resolveSundayAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedSundayAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = (params.cfg.channels?.sunday as SundayConfig | undefined)?.enabled !== false;
  const merged = mergeSundayAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const creds = resolveSundayCredentials(
    params.cfg.channels?.sunday as SundayConfig | undefined,
    accountId,
  );

  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled,
    agentId: creds.agentId,
    apiKey: creds.apiKey,
    apiSecret: creds.apiSecret,
    apiBaseUrl: merged.apiBaseUrl?.trim() || DEFAULT_API_BASE_URL,
    credentialSource: creds.source,
    config: merged,
  };
}

export function listEnabledSundayAccounts(cfg: OpenClawConfig): ResolvedSundayAccount[] {
  return listSundayAccountIds(cfg)
    .map((accountId) => resolveSundayAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
