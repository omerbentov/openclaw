import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionContext,
  ChannelMessageActionName,
  ChannelToolSend,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import { listEnabledSundayAccounts } from "./accounts.js";
import { handleSundayAction } from "./actions.js";

export function listSundayMessageActions(cfg: OpenClawConfig): ChannelMessageActionName[] {
  const accounts = listEnabledSundayAccounts(cfg).filter(
    (account) => Boolean(account.agentId) && Boolean(account.apiKey),
  );
  if (accounts.length === 0) return [];
  return ["send", "read"];
}

export function extractSundayToolSend(args: Record<string, unknown>): ChannelToolSend | null {
  const action = typeof args.action === "string" ? args.action.trim() : "";
  if (action !== "sendMessage" && action !== "send") return null;
  const to =
    typeof args.userId === "string"
      ? args.userId
      : typeof args.to === "string"
        ? args.to
        : undefined;
  if (!to) return null;
  const accountId = typeof args.accountId === "string" ? args.accountId.trim() : undefined;
  return { to, accountId };
}

async function handleSundayMessageAction(ctx: ChannelMessageActionContext) {
  const { action, cfg, params } = ctx;
  const accountId = ctx.accountId ?? undefined;

  if (action === "send") {
    const to =
      (typeof params.to === "string" ? params.to.trim() : undefined) ??
      (typeof params.userId === "string" ? params.userId.trim() : undefined);
    if (!to) throw new Error("Sunday send requires 'to' or 'userId'.");
    const message =
      (typeof params.message === "string" ? params.message : undefined) ??
      (typeof params.content === "string" ? params.content : undefined);
    if (!message) throw new Error("Sunday send requires 'message'.");
    const type = typeof params.type === "string" ? params.type.trim() : undefined;
    const metadata =
      params.metadata && typeof params.metadata === "object"
        ? (params.metadata as Record<string, unknown>)
        : undefined;
    return await handleSundayAction(
      {
        action: "sendMessage",
        userId: to,
        message,
        ...(type ? { type } : {}),
        ...(metadata ? { metadata } : {}),
        ...(accountId ? { accountId } : {}),
      },
      cfg,
    );
  }

  if (action === "read") {
    const conversationId =
      (typeof params.conversationId === "string" ? params.conversationId.trim() : undefined) ??
      (typeof params.channelId === "string" ? params.channelId.trim() : undefined) ??
      (typeof params.to === "string" ? params.to.trim() : undefined);
    if (!conversationId) throw new Error("Sunday read requires 'conversationId'.");
    return await handleSundayAction(
      { action: "readMessages", conversationId, ...(accountId ? { accountId } : {}) },
      cfg,
    );
  }

  throw new Error(`Action '${action}' is not supported for Sunday.`);
}

export function createSundayActions(): ChannelMessageActionAdapter {
  return {
    listActions: ({ cfg }) => listSundayMessageActions(cfg),
    extractToolSend: ({ args }) => extractSundayToolSend(args),
    handleAction: async (ctx) => await handleSundayMessageAction(ctx),
  };
}
