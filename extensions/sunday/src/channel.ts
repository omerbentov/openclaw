import type {
  ChannelAccountSnapshot,
  ChannelDock,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import {
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  chunkTextForOutbound,
  formatAllowFromLowercase,
  formatPairingApproveHint,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  PAIRING_APPROVED_MESSAGE,
  resolveChannelAccountConfigBasePath,
  resolveWebhookPath,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk";
import {
  listSundayAccountIds,
  resolveDefaultSundayAccountId,
  resolveSundayAccount,
  type ResolvedSundayAccount,
} from "./accounts.js";
import { sendMessage, type SundayCredentials } from "./api.js";
import { SundayConfigSchema } from "./config-schema.js";
import { sundayOnboardingAdapter } from "./onboarding.js";
import { probeSunday } from "./probe.js";
import { sendMessageSunday } from "./send.js";
import { collectSundayStatusIssues } from "./status-issues.js";

const meta = {
  id: "sunday",
  label: "Sunday",
  selectionLabel: "Sunday (Agent API)",
  docsPath: "/channels/sunday",
  docsLabel: "sunday",
  blurb: "Sunday messaging platform with Agent API.",
  aliases: ["sun"],
  order: 85,
  quickstartAllowFrom: true,
};

function normalizeSundayMessagingTarget(raw: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^(sunday|sun):/i, "");
}

export const sundayDock: ChannelDock = {
  id: "sunday",
  capabilities: {
    chatTypes: ["direct"],
    blockStreaming: true,
  },
  outbound: { textChunkLimit: 4000 },
  config: {
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveSundayAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) =>
        String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      formatAllowFromLowercase({ allowFrom, stripPrefixRe: /^(sunday|sun):/i }),
  },
  groups: {
    resolveRequireMention: () => true,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
};

export const sundayPlugin: ChannelPlugin<ResolvedSundayAccount> = {
  id: "sunday",
  meta,
  onboarding: sundayOnboardingAdapter,
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.sunday"] },
  configSchema: buildChannelConfigSchema(SundayConfigSchema),
  config: {
    listAccountIds: (cfg) => listSundayAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveSundayAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultSundayAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "sunday",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "sunday",
        accountId,
        clearBaseFields: ["agentId", "apiKey", "apiSecret", "name"],
      }),
    isConfigured: (account) =>
      Boolean(account.agentId?.trim() && account.apiKey?.trim() && account.apiSecret?.trim()),
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(
        account.agentId?.trim() && account.apiKey?.trim() && account.apiSecret?.trim(),
      ),
      tokenSource: account.credentialSource,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveSundayAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) =>
        String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      formatAllowFromLowercase({ allowFrom, stripPrefixRe: /^(sunday|sun):/i }),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const basePath = resolveChannelAccountConfigBasePath({
        cfg,
        channelKey: "sunday",
        accountId: resolvedAccountId,
      });
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("sunday"),
        normalizeEntry: (raw) => raw.replace(/^(sunday|sun):/i, ""),
      };
    },
  },
  groups: {
    resolveRequireMention: () => true,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  messaging: {
    normalizeTarget: normalizeSundayMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) {
          return false;
        }
        // Sunday conversation IDs can be alphanumeric with underscores
        return /^[\w-]+$/.test(trimmed);
      },
      hint: "<conversationId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveSundayAccount({ cfg, accountId });
      const q = query?.trim().toLowerCase() || "";
      const peers = Array.from(
        new Set(
          (account.config.allowFrom ?? [])
            .map((entry) => String(entry).trim())
            .filter((entry) => Boolean(entry) && entry !== "*")
            .map((entry) => entry.replace(/^(sunday|sun):/i, "")),
        ),
      )
        .filter((id) => (q ? id.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "user", id }) as const);
      return peers;
    },
    listGroups: async () => [],
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "sunday",
        accountId,
        name,
      }),
    validateInput: ({ accountId, input }) => {
      if (input.useEnv && accountId !== DEFAULT_ACCOUNT_ID) {
        return "SUNDAY_* env vars can only be used for the default account.";
      }
      if (!input.useEnv && !input.token) {
        return "Sunday requires credentials (or --use-env).";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg,
        channelKey: "sunday",
        accountId,
        name: input.name,
      });
      const next =
        accountId !== DEFAULT_ACCOUNT_ID
          ? migrateBaseNameToDefaultAccount({ cfg: namedConfig, channelKey: "sunday" })
          : namedConfig;

      // Parse compound token: "agentId:apiKey:apiSecret"
      const parts = input.token?.split(":") ?? [];
      const agentId = parts[0]?.trim();
      const apiKey = parts[1]?.trim();
      const apiSecret = parts[2]?.trim();

      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...next,
          channels: {
            ...next.channels,
            sunday: {
              ...next.channels?.sunday,
              enabled: true,
              ...(input.useEnv
                ? {}
                : agentId && apiKey && apiSecret
                  ? { agentId, apiKey, apiSecret }
                  : {}),
            },
          },
        } as OpenClawConfig;
      }
      return {
        ...next,
        channels: {
          ...next.channels,
          sunday: {
            ...next.channels?.sunday,
            enabled: true,
            accounts: {
              ...next.channels?.sunday?.accounts,
              [accountId]: {
                ...next.channels?.sunday?.accounts?.[accountId],
                enabled: true,
                ...(agentId && apiKey && apiSecret ? { agentId, apiKey, apiSecret } : {}),
              },
            },
          },
        },
      } as OpenClawConfig;
    },
  },
  pairing: {
    idLabel: "sundayUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(sunday|sun):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveSundayAccount({ cfg });
      if (!account.agentId || !account.apiKey || !account.apiSecret) {
        throw new Error("Sunday credentials not configured");
      }
      const creds: SundayCredentials = {
        agentId: account.agentId,
        apiKey: account.apiKey,
        apiSecret: account.apiSecret,
        apiBaseUrl: account.apiBaseUrl,
      };
      await sendMessage(creds, { userId: id }, PAIRING_APPROVED_MESSAGE);
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: chunkTextForOutbound,
    chunkerMode: "text",
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId, cfg }) => {
      const result = await sendMessageSunday(to, text, {
        accountId: accountId ?? undefined,
        cfg,
      });
      return {
        channel: "sunday",
        ok: result.ok,
        messageId: result.messageId ?? "",
        error: result.error ? new Error(result.error) : undefined,
      };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, cfg }) => {
      const messageWithMedia = mediaUrl ? `${text}\n\n${mediaUrl}`.trim() : text;
      const result = await sendMessageSunday(to, messageWithMedia, {
        accountId: accountId ?? undefined,
        cfg,
      });
      return {
        channel: "sunday",
        ok: result.ok,
        messageId: result.messageId ?? "",
        error: result.error ? new Error(result.error) : undefined,
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: collectSundayStatusIssues,
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      tokenSource: snapshot.tokenSource ?? "none",
      running: snapshot.running ?? false,
      mode: snapshot.mode ?? null,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) => probeSunday(account, timeoutMs),
    buildAccountSnapshot: ({ account, runtime }) => {
      const configured = Boolean(
        account.agentId?.trim() && account.apiKey?.trim() && account.apiSecret?.trim(),
      );
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        tokenSource: account.credentialSource,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        mode: account.config.webhookUrl ? "webhook" : "direct",
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
        dmPolicy: account.config.dmPolicy ?? "pairing",
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.log?.info(`[${account.accountId}] starting Sunday provider`);

      try {
        const probe = await probeSunday(account, 5000);
        if (probe.ok) {
          ctx.setStatus({ accountId: account.accountId });
        }
      } catch {
        // ignore probe errors during startup
      }

      const { initSundayProvider } = await import("./monitor.js");
      return initSundayProvider({
        account,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        webhookUrl: account.config.webhookUrl,
        webhookPath:
          account.config.webhookPath ??
          resolveWebhookPath({
            webhookPath: account.config.webhookPath,
            webhookUrl: account.config.webhookUrl,
            defaultPath: "/webhooks/sunday",
          }) ??
          undefined,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });
    },
  },
};
