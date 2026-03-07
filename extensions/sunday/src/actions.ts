import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveSundayAccount } from "./accounts.js";
import {
  checkPermission,
  deleteContext,
  getContext,
  getMessages,
  listContextKeys,
  requestPermission,
  sendMessage,
  setContext,
  updateTaskStatus,
  updateTodoList,
  type SundayCredentials,
} from "./api.js";

function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: { required: true },
): string;
function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options?: { required?: boolean },
): string | undefined;
function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean } = {},
): string | undefined {
  const raw = params[key];
  if (typeof raw !== "string") {
    if (options.required) throw new Error(`${key} is required`);
    return undefined;
  }
  const value = raw.trim();
  if (!value && options.required) throw new Error(`${key} is required`);
  return value || undefined;
}

function readNumberParam(params: Record<string, unknown>, key: string): number | undefined {
  const raw = params[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

type ActionResult = { content: Array<{ type: "text"; text: string }>; details: unknown };

function jsonResult(payload: unknown): ActionResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function resolveCreds(cfg: OpenClawConfig, accountId?: string): SundayCredentials {
  const account = resolveSundayAccount({ cfg, accountId });
  if (!account.agentId || !account.apiKey) {
    throw new Error("Sunday credentials not configured");
  }
  return {
    agentId: account.agentId,
    apiKey: account.apiKey,
    apiBaseUrl: account.apiBaseUrl,
  };
}

export async function handleSundayAction(
  params: Record<string, unknown>,
  cfg: OpenClawConfig,
): Promise<ActionResult> {
  const action = readStringParam(params, "action", { required: true });
  const accountId = readStringParam(params, "accountId");
  const creds = resolveCreds(cfg, accountId);

  switch (action) {
    case "sendMessage": {
      const userId = readStringParam(params, "userId", { required: true });
      const message = readStringParam(params, "message", { required: true });
      const conversationId = readStringParam(params, "conversationId");
      const type = readStringParam(params, "type");
      const metadata =
        params.metadata && typeof params.metadata === "object"
          ? (params.metadata as Record<string, unknown>)
          : undefined;
      const result = await sendMessage(
        creds,
        { userId, conversationId },
        message,
        type || metadata ? { type, metadata } : undefined,
      );
      return jsonResult({
        ok: true,
        messageId: result.messageId,
        conversationId: result.conversationId,
      });
    }

    case "readMessages": {
      const conversationId = readStringParam(params, "conversationId", { required: true });
      const result = await getMessages(creds, conversationId);
      return jsonResult({ ok: true, messages: result.messages });
    }

    case "requestPermission": {
      const userId = readStringParam(params, "userId", { required: true });
      const conversationId = readStringParam(params, "conversationId", { required: true });
      const permAction = readStringParam(params, "permissionAction", { required: true });
      const reason = readStringParam(params, "reason", { required: true });
      const result = await requestPermission(creds, {
        userId,
        conversationId,
        action: permAction,
        reason,
      });
      return jsonResult({
        ok: true,
        permissionId: result.permissionId,
        messageId: result.messageId,
      });
    }

    case "checkPermission": {
      const permissionId = readStringParam(params, "permissionId", { required: true });
      const result = await checkPermission(creds, permissionId);
      return jsonResult({
        ok: true,
        permissionId: result.permissionId,
        status: result.status,
        respondedAt: result.respondedAt,
      });
    }

    case "updateTaskStatus": {
      const userId = readStringParam(params, "userId", { required: true });
      const conversationId = readStringParam(params, "conversationId", { required: true });
      const taskName = readStringParam(params, "taskName", { required: true });
      const status = readStringParam(params, "status", { required: true });
      const progress = readNumberParam(params, "progress") ?? 0;
      const result = await updateTaskStatus(creds, {
        userId,
        conversationId,
        taskName,
        status,
        progress,
      });
      return jsonResult({ ok: true, messageId: result.messageId });
    }

    case "updateTodoList": {
      const messageId = readStringParam(params, "messageId", { required: true });
      const items = params.items;
      if (!Array.isArray(items)) throw new Error("items array is required");
      const status = readStringParam(params, "status");
      await updateTodoList(creds, {
        messageId,
        items: items as Array<{ id: string; title: string; status: string }>,
        status,
      });
      return jsonResult({ ok: true });
    }

    case "setContext": {
      const conversationId = readStringParam(params, "conversationId", { required: true });
      const key = readStringParam(params, "key", { required: true });
      const value = readStringParam(params, "value", { required: true });
      await setContext(creds, { conversationId, key, value });
      return jsonResult({ ok: true });
    }

    case "getContext": {
      const conversationId = readStringParam(params, "conversationId", { required: true });
      const key = readStringParam(params, "key", { required: true });
      const result = await getContext(creds, conversationId, key);
      return jsonResult({ ok: true, value: result.value });
    }

    case "deleteContext": {
      const conversationId = readStringParam(params, "conversationId", { required: true });
      const key = readStringParam(params, "key", { required: true });
      await deleteContext(creds, conversationId, key);
      return jsonResult({ ok: true });
    }

    case "listContextKeys": {
      const conversationId = readStringParam(params, "conversationId", { required: true });
      const result = await listContextKeys(creds, conversationId);
      return jsonResult({ ok: true, keys: result.keys });
    }

    default:
      throw new Error(`Unknown Sunday action: ${action}`);
  }
}
