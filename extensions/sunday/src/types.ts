export type SundayAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */
  name?: string;
  /** If false, do not start this Sunday account. Default: true. */
  enabled?: boolean;
  /** Agent ID from the Sunday platform. */
  agentId?: string;
  /** API key from the Sunday platform. */
  apiKey?: string;
  /** API secret from the Sunday platform (used for auth and webhook signature verification). */
  apiSecret?: string;
  /** Sunday API base URL (default: https://api.sunday.app). */
  apiBaseUrl?: string;
  /** Public webhook URL that Sunday should POST events to. */
  webhookUrl?: string;
  /** Webhook path for the gateway HTTP server (defaults to /webhooks/sunday). */
  webhookPath?: string;
  /** Direct message access policy (default: pairing). */
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  /** Allowlist for DM senders (Sunday user IDs). */
  allowFrom?: Array<string | number>;
};

export type SundayConfig = {
  /** Optional per-account Sunday configuration (multi-account). */
  accounts?: Record<string, SundayAccountConfig>;
  /** Default account ID when multiple accounts are configured. */
  defaultAccount?: string;
} & SundayAccountConfig;

export type SundayCredentialSource = "env" | "config" | "none";

export type ResolvedSundayAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  agentId: string;
  apiKey: string;
  apiSecret: string;
  apiBaseUrl: string;
  credentialSource: SundayCredentialSource;
  config: SundayAccountConfig;
};

export type SundayWebhookEvent = {
  event:
    | "message.created"
    | "agent.installed"
    | "agent.uninstalled"
    | "permission.response"
    | "decision.response";
  messageId?: string;
  conversationId: string;
  userId: string;
  content?: string;
  type?: string;
  timestamp?: string;
  /** Catch-all for extra webhook fields (scopes, permissionId, etc.). */
  [key: string]: unknown;
};

/** Matches the GET /getPendingMessages response message shape. */
export type SundayPendingMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  isAgent: boolean;
  type: string;
  metadata?: Record<string, unknown>;
  read: boolean;
  timestamp: string;
};
