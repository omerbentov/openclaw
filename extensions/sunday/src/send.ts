import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveSundayAccount } from "./accounts.js";
import { sendMessage, type SundayCredentials } from "./api.js";

export type SundaySendOptions = {
  accountId?: string;
  cfg?: OpenClawConfig;
  agentId?: string;
  apiKey?: string;
  apiBaseUrl?: string;
};

export type SundaySendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

function resolveSendCredentials(options: SundaySendOptions): SundayCredentials | null {
  if (options.cfg) {
    const account = resolveSundayAccount({
      cfg: options.cfg,
      accountId: options.accountId,
    });
    if (account.agentId && account.apiKey) {
      return {
        agentId: account.agentId,
        apiKey: account.apiKey,
        apiBaseUrl: account.apiBaseUrl,
      };
    }
  }

  if (options.agentId && options.apiKey) {
    return {
      agentId: options.agentId,
      apiKey: options.apiKey,
      apiBaseUrl: options.apiBaseUrl ?? "https://sunday-backend-612819501028.us-central1.run.app",
    };
  }

  return null;
}

export async function sendMessageSunday(
  targetId: string,
  text: string,
  options: SundaySendOptions = {},
): Promise<SundaySendResult> {
  const creds = resolveSendCredentials(options);
  if (!creds) {
    return { ok: false, error: "No Sunday credentials configured" };
  }

  if (!targetId?.trim()) {
    return { ok: false, error: "No target (userId or conversationId) provided" };
  }

  try {
    const id = targetId.trim();
    const response = await sendMessage(creds, { userId: id, conversationId: id }, text);

    if (response.success !== false && response.messageId) {
      return { ok: true, messageId: response.messageId };
    }

    return { ok: false, error: response.error ?? "Failed to send message" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
