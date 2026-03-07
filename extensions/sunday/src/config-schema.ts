import { z } from "zod";

const allowFromEntry = z.union([z.string(), z.number()]);

const sundayAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  agentId: z.string().optional(),
  apiKey: z.string().optional(),
  webhookSecret: z.string().optional(),
  apiBaseUrl: z.string().optional(),
  webhookUrl: z.string().optional(),
  webhookPath: z.string().optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
  allowFrom: z.array(allowFromEntry).optional(),
  systemPrompt: z.string().optional(),
});

export const SundayConfigSchema = sundayAccountSchema.extend({
  accounts: z.object({}).catchall(sundayAccountSchema).optional(),
  defaultAccount: z.string().optional(),
});
