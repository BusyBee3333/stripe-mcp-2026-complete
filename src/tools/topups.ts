// Topups tools — Stripe API v1
// Covers: list_topups, get_topup, create_topup, cancel_topup

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListTopupsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  status: z.enum(["canceled", "failed", "pending", "reversed", "succeeded"]).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  created_gte: z.number().optional(),
  created_lte: z.number().optional(),
});

const GetTopupSchema = z.object({
  topup_id: z.string().describe("Stripe topup ID (tu_xxx)"),
});

const CreateTopupSchema = z.object({
  amount: z.number().int().positive().describe("Amount to top up in smallest currency unit (e.g. 10000 for $100.00 USD)"),
  currency: z.string().length(3).describe("Three-letter ISO currency code (e.g. 'usd')"),
  description: z.string().optional().describe("Internal description for this topup"),
  statement_descriptor: z.string().max(15).optional().describe("Statement descriptor (max 15 chars) shown on bank statement"),
  source: z.string().optional().describe("Source ID for the top-up. If not provided, uses the account's default external account."),
  metadata: z.record(z.string()).optional(),
  transfer_group: z.string().optional().describe("Arbitrary string to group this topup with related transfers"),
});

const CancelTopupSchema = z.object({
  topup_id: z.string().describe("Stripe topup ID (tu_xxx) to cancel"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_topups",
      title: "List Top-ups",
      description:
        "List Stripe balance top-ups (add funds to your Stripe balance from an external account). Optionally filter by status. Returns topup ID, amount, currency, status, and description. Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          status: { type: "string", enum: ["canceled", "failed", "pending", "reversed", "succeeded"], description: "Filter by status" },
          starting_after: { type: "string", description: "Pagination cursor" },
          ending_before: { type: "string", description: "Pagination cursor — reversed" },
          created_gte: { type: "number", description: "Filter by creation time (Unix timestamp, >=)" },
          created_lte: { type: "number", description: "Filter by creation time (Unix timestamp, <=)" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_topup",
      title: "Get Top-up",
      description: "Retrieve a specific top-up by ID (tu_xxx). Returns amount, currency, status, description, and expected_availability_date.",
      inputSchema: {
        type: "object",
        properties: { topup_id: { type: "string", description: "Stripe topup ID (tu_xxx)" } },
        required: ["topup_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_topup",
      title: "Create Top-up",
      description:
        "Add funds to your Stripe balance from an external bank account. Top-ups are typically available in your Stripe balance within 1-2 business days. Useful for maintaining sufficient balance for payouts or Connect transfers.",
      inputSchema: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Amount in smallest currency unit (e.g. 10000 for $100.00)" },
          currency: { type: "string", description: "Three-letter currency code (e.g. 'usd')" },
          description: { type: "string", description: "Internal description" },
          statement_descriptor: { type: "string", description: "Bank statement descriptor (max 15 chars)" },
          source: { type: "string", description: "Source ID (defaults to account's default external account)" },
          metadata: { type: "object", description: "Key-value metadata" },
          transfer_group: { type: "string", description: "Group identifier for related transfers" },
        },
        required: ["amount", "currency"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "cancel_topup",
      title: "Cancel Top-up",
      description:
        "Cancel a pending top-up. Only top-ups with status 'pending' can be canceled. Returns the canceled topup object with status 'canceled'.",
      inputSchema: {
        type: "object",
        properties: { topup_id: { type: "string", description: "Stripe topup ID (tu_xxx) to cancel" } },
        required: ["topup_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_topups: async (args) => {
      const params = ListTopupsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.status) q.status = params.status;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      if (params.created_gte) q["created[gte]"] = params.created_gte;
      if (params.created_lte) q["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_topups", () =>
        client.list<Record<string, unknown>>("/topups", q)
      , { tool: "list_topups" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_topup: async (args) => {
      const { topup_id } = GetTopupSchema.parse(args);
      const topup = await logger.time("tool.get_topup", () =>
        client.get<Record<string, unknown>>(`/topups/${topup_id}`)
      , { tool: "get_topup", topup_id });
      return { content: [{ type: "text", text: JSON.stringify(topup, null, 2) }], structuredContent: topup };
    },

    create_topup: async (args) => {
      const params = CreateTopupSchema.parse(args);
      const body: Record<string, unknown> = { amount: params.amount, currency: params.currency };
      if (params.description) body.description = params.description;
      if (params.statement_descriptor) body.statement_descriptor = params.statement_descriptor;
      if (params.source) body.source = params.source;
      if (params.transfer_group) body.transfer_group = params.transfer_group;
      if (params.metadata) body.metadata = params.metadata;

      const topup = await logger.time("tool.create_topup", () =>
        client.post<Record<string, unknown>>("/topups", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_topup" });
      return { content: [{ type: "text", text: JSON.stringify(topup, null, 2) }], structuredContent: topup };
    },

    cancel_topup: async (args) => {
      const { topup_id } = CancelTopupSchema.parse(args);
      const topup = await logger.time("tool.cancel_topup", () =>
        client.post<Record<string, unknown>>(`/topups/${topup_id}/cancel`, {})
      , { tool: "cancel_topup", topup_id });
      return { content: [{ type: "text", text: JSON.stringify(topup, null, 2) }], structuredContent: topup };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
