import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  OpenClawConfig,
  WizardPrompter,
} from "openclaw/plugin-sdk";
import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  mergeAllowFromEntries,
  normalizeAccountId,
  promptAccountId,
} from "openclaw/plugin-sdk";
import {
  listSundayAccountIds,
  resolveDefaultSundayAccountId,
  resolveSundayAccount,
} from "./accounts.js";

const channel = "sunday" as const;

function setSundayDmPolicy(
  cfg: OpenClawConfig,
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled",
) {
  const allowFrom =
    dmPolicy === "open" ? addWildcardAllowFrom(cfg.channels?.sunday?.allowFrom) : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      sunday: {
        ...cfg.channels?.sunday,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  } as OpenClawConfig;
}

async function noteSundayCredentialHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) Open Sunday settings: Settings → My Agents (or Developer Portal)",
      '2) Click "Add Agent" and save your credentials',
      "3) You need: Agent ID, API Key, API Secret",
      "Tip: you can also set SUNDAY_AGENT_ID, SUNDAY_API_KEY, SUNDAY_API_SECRET env vars.",
      "Docs: https://sunday-bot-1770837759.firebaseapp.com/docs",
    ].join("\n"),
    "Sunday agent credentials",
  );
}

async function promptSundayAllowFrom(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId: string;
}): Promise<OpenClawConfig> {
  const { cfg, prompter, accountId } = params;
  const resolved = resolveSundayAccount({ cfg, accountId });
  const existingAllowFrom = resolved.config.allowFrom ?? [];
  const entry = await prompter.text({
    message: "Sunday allowFrom (user id)",
    placeholder: "user_123",
    initialValue: existingAllowFrom[0] ? String(existingAllowFrom[0]) : undefined,
    validate: (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) {
        return "Required";
      }
      return undefined;
    },
  });
  const normalized = String(entry).trim();
  const unique = mergeAllowFromEntries(existingAllowFrom, [normalized]);

  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        sunday: {
          ...cfg.channels?.sunday,
          enabled: true,
          dmPolicy: "allowlist",
          allowFrom: unique,
        },
      },
    } as OpenClawConfig;
  }

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      sunday: {
        ...cfg.channels?.sunday,
        enabled: true,
        accounts: {
          ...cfg.channels?.sunday?.accounts,
          [accountId]: {
            ...cfg.channels?.sunday?.accounts?.[accountId],
            enabled: cfg.channels?.sunday?.accounts?.[accountId]?.enabled ?? true,
            dmPolicy: "allowlist",
            allowFrom: unique,
          },
        },
      },
    },
  } as OpenClawConfig;
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "Sunday",
  channel,
  policyKey: "channels.sunday.dmPolicy",
  allowFromKey: "channels.sunday.allowFrom",
  getCurrent: (cfg) => (cfg.channels?.sunday?.dmPolicy ?? "pairing") as "pairing",
  setPolicy: (cfg, policy) => setSundayDmPolicy(cfg, policy),
  promptAllowFrom: async ({ cfg, prompter, accountId }) => {
    const id =
      accountId && normalizeAccountId(accountId)
        ? (normalizeAccountId(accountId) ?? DEFAULT_ACCOUNT_ID)
        : resolveDefaultSundayAccountId(cfg);
    return promptSundayAllowFrom({ cfg, prompter, accountId: id });
  },
};

export const sundayOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  dmPolicy,
  getStatus: async ({ cfg }) => {
    const configured = listSundayAccountIds(cfg).some((accountId) => {
      const account = resolveSundayAccount({ cfg, accountId });
      return Boolean(account.agentId && account.apiKey && account.apiSecret);
    });
    return {
      channel,
      configured,
      statusLines: [`Sunday: ${configured ? "configured" : "needs credentials"}`],
      selectionHint: configured ? "recommended · configured" : "recommended · newcomer-friendly",
      quickstartScore: configured ? 1 : 10,
    };
  },
  configure: async ({
    cfg,
    prompter,
    accountOverrides,
    shouldPromptAccountIds,
    forceAllowFrom,
  }) => {
    const sundayOverride = accountOverrides.sunday?.trim();
    const defaultSundayAccountId = resolveDefaultSundayAccountId(cfg);
    let sundayAccountId = sundayOverride
      ? normalizeAccountId(sundayOverride)
      : defaultSundayAccountId;
    if (shouldPromptAccountIds && !sundayOverride) {
      sundayAccountId = await promptAccountId({
        cfg,
        prompter,
        label: "Sunday",
        currentId: sundayAccountId,
        listAccountIds: listSundayAccountIds,
        defaultAccountId: defaultSundayAccountId,
      });
    }

    let next = cfg;
    const resolvedAccount = resolveSundayAccount({ cfg: next, accountId: sundayAccountId });
    const accountConfigured = Boolean(
      resolvedAccount.agentId && resolvedAccount.apiKey && resolvedAccount.apiSecret,
    );
    const allowEnv = sundayAccountId === DEFAULT_ACCOUNT_ID;
    const canUseEnv =
      allowEnv &&
      Boolean(
        process.env.SUNDAY_AGENT_ID?.trim() &&
        process.env.SUNDAY_API_KEY?.trim() &&
        process.env.SUNDAY_API_SECRET?.trim(),
      );
    const hasConfigCredentials = Boolean(
      resolvedAccount.config.agentId &&
      resolvedAccount.config.apiKey &&
      resolvedAccount.config.apiSecret,
    );

    let agentId: string | null = null;
    let apiKey: string | null = null;
    let apiSecret: string | null = null;

    if (!accountConfigured) {
      await noteSundayCredentialHelp(prompter);
    }

    if (canUseEnv && !hasConfigCredentials) {
      const keepEnv = await prompter.confirm({
        message: "SUNDAY_* env vars detected. Use env vars?",
        initialValue: true,
      });
      if (keepEnv) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            sunday: { ...next.channels?.sunday, enabled: true },
          },
        } as OpenClawConfig;
      } else {
        ({ agentId, apiKey, apiSecret } = await promptCredentials(prompter));
      }
    } else if (hasConfigCredentials) {
      const keep = await prompter.confirm({
        message: "Sunday credentials already configured. Keep them?",
        initialValue: true,
      });
      if (!keep) {
        ({ agentId, apiKey, apiSecret } = await promptCredentials(prompter));
      }
    } else {
      ({ agentId, apiKey, apiSecret } = await promptCredentials(prompter));
    }

    if (agentId && apiKey && apiSecret) {
      if (sundayAccountId === DEFAULT_ACCOUNT_ID) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            sunday: {
              ...next.channels?.sunday,
              enabled: true,
              agentId,
              apiKey,
              apiSecret,
            },
          },
        } as OpenClawConfig;
      } else {
        next = {
          ...next,
          channels: {
            ...next.channels,
            sunday: {
              ...next.channels?.sunday,
              enabled: true,
              accounts: {
                ...next.channels?.sunday?.accounts,
                [sundayAccountId]: {
                  ...next.channels?.sunday?.accounts?.[sundayAccountId],
                  enabled: true,
                  agentId,
                  apiKey,
                  apiSecret,
                },
              },
            },
          },
        } as OpenClawConfig;
      }
    }

    // Prompt for webhook URL
    const wantsWebhook = await prompter.confirm({
      message: "Configure webhook URL for Sunday? (recommended for production)",
      initialValue: true,
    });
    if (wantsWebhook) {
      const webhookUrl = String(
        await prompter.text({
          message: "Webhook URL (https://...)",
          validate: (value) =>
            value?.trim()?.startsWith("https://") ? undefined : "HTTPS URL required",
        }),
      ).trim();
      if (sundayAccountId === DEFAULT_ACCOUNT_ID) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            sunday: { ...next.channels?.sunday, webhookUrl },
          },
        } as OpenClawConfig;
      } else {
        next = {
          ...next,
          channels: {
            ...next.channels,
            sunday: {
              ...next.channels?.sunday,
              accounts: {
                ...next.channels?.sunday?.accounts,
                [sundayAccountId]: {
                  ...next.channels?.sunday?.accounts?.[sundayAccountId],
                  webhookUrl,
                },
              },
            },
          },
        } as OpenClawConfig;
      }
    }

    if (forceAllowFrom) {
      next = await promptSundayAllowFrom({
        cfg: next,
        prompter,
        accountId: sundayAccountId,
      });
    }

    return { cfg: next, accountId: sundayAccountId };
  },
};

async function promptCredentials(
  prompter: WizardPrompter,
): Promise<{ agentId: string; apiKey: string; apiSecret: string }> {
  const agentId = String(
    await prompter.text({
      message: "Enter Sunday Agent ID",
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
  ).trim();
  const apiKey = String(
    await prompter.text({
      message: "Enter Sunday API Key",
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
  ).trim();
  const apiSecret = String(
    await prompter.text({
      message: "Enter Sunday API Secret",
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
  ).trim();
  return { agentId, apiKey, apiSecret };
}
