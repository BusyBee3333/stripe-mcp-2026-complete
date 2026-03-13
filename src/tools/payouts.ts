// Payouts tools — Stripe API v1
// Covers: list_payouts, get_payout, create_payout, cancel_payout

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListPayoutsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  status: z.enum(["pending", "paid", "failed", "canceled"]).optional().describe("Filter by payout status"),
  destination: z.string().optional().describe("Filter by bank account or card destination ID"),
  arrival_date_gte: z.number().optional().describe("Filter by arrival date (Unix timestamp, >=)"),
  arrival_date_lte: z.number().optional().describe("Filter by arrival date (Unix timestamp, <=)"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — for reversed pagination"),
});

const GetPayoutSchema = z.object({
  payout_id: z.string().describe("Stripe payout ID (po_xxx)"),
});

const CreatePayoutSchema = z.object({
  amount: z.number().int().positive().describe("Amount to pay out in smallest currency unit (e.g. cents for USD)"),
  currency: z.string().length(3).describe("Three-letter ISO currency code (e.g. 'usd', 'eur', 'gbp') — must match your bank account currency"),
  description: z.string().optional().describe("Internal description for this payout"),
  destination: z.string().optional().describe("Bank account or card ID to pay out to — defaults to your default bank account"),
  method: z.enum(["standard", "instant"]).optional().default("standard").describe("Payout speed: standard (1-5 business days) or instant (available in some regions). Default: standard"),
  source_type: z.enum(["bank_account", "card", "fpx"]).optional().describe("Source balance type to draw from (default: bank_account)"),
  statement_descriptor: z.string().max(22).optional().describe("Statement descriptor shown on bank statement (max 22 chars)"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
});

const CancelPayoutSchema = z.object({
  payout_id: z.string().describe("Stripe payout ID (po_xxx) to cancel — only pending payouts can be canceled"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_payouts",
      title: "List Payouts",
      description:
        "List Stripe payouts — transfers of funds from your Stripe balance to your bank account. Filter by status (pending/paid/failed/canceled) or date range. Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          status: { type: "string", enum: ["pending", "paid", "failed", "canceled"], description: "Filter by status" },
          destination: { type: "string", description: "Filter by bank account/card destination ID" },
          arrival_date_gte: { type: "number", description: "Filter by arrival date (Unix timestamp, >=)" },
          arrival_date_lte: { type: "number", description: "Filter by arrival date (Unix timestamp, <=)" },
          created_gte: { type: "number", description: "Filter by creation date (Unix timestamp, >=)" },
          created_lte: { type: "number", description: "Filter by creation date (Unix timestamp, <=)" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_payout",
      title: "Get Payout",
      description:
        "Get full details for a Stripe payout by ID (po_xxx). Returns amount, currency, status, arrival date, destination bank account, and statement descriptor.",
      inputSchema: {
        type: "object",
        properties: {
          payout_id: { type: "string", description: "Stripe payout ID (po_xxx)" },
        },
        required: ["payout_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_payout",
      title: "Create Payout",
      description:
        "Create a Stripe payout to send funds from your Stripe balance to your bank account. Amount is in smallest currency units (cents for USD). Use method='instant' for faster payouts where available. The currency must match your bank account currency.",
      inputSchema: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Amount in smallest currency unit (e.g. 10000 for $100.00 USD)" },
          currency: { type: "string", description: "Three-letter currency code (e.g. 'usd', 'eur', 'gbp')" },
          description: { type: "string", description: "Internal description" },
          destination: { type: "string", description: "Bank account/card ID — defaults to account default" },
          method: { type: "string", enum: ["standard", "instant"], description: "Payout speed (default: standard)" },
          source_type: { type: "string", enum: ["bank_account", "card", "fpx"], description: "Source balance type" },
          statement_descriptor: { type: "string", description: "Bank statement descriptor (max 22 chars)" },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["amount", "currency"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "cancel_payout",
      title: "Cancel Payout",
      description:
        "Cancel a pending Stripe payout. Only payouts with status='pending' can be canceled. Once canceled, the funds are returned to your Stripe balance. Paid or in-transit payouts cannot be canceled.",
      inputSchema: {
        type: "object",
        properties: {
          payout_id: { type: "string", description: "Stripe payout ID (po_xxx) — must be in pending status" },
        },
        required: ["payout_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_payouts: async (args) => {
      const params = ListPayoutsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.status) queryParams.status = params.status;
      if (params.destination) queryParams.destination = params.destination;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;
      if (params.arrival_date_gte) queryParams["arrival_date[gte]"] = params.arrival_date_gte;
      if (params.arrival_date_lte) queryParams["arrival_date[lte]"] = params.arrival_date_lte;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_payouts", () =>
        client.list<Record<string, unknown>>("/payouts", queryParams)
      , { tool: "list_payouts" });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_payout: async (args) => {
      const { payout_id } = GetPayoutSchema.parse(args);
      const payout = await logger.time("tool.get_payout", () =>
        client.get<Record<string, unknown>>(`/payouts/${payout_id}`)
      , { tool: "get_payout", payout_id });
      return { content: [{ type: "text", text: JSON.stringify(payout, null, 2) }], structuredContent: payout };
    },

    create_payout: async (args) => {
      const params = CreatePayoutSchema.parse(args);
      const body: Record<string, unknown> = {
        amount: params.amount,
        currency: params.currency,
      };
      if (params.description) body.description = params.description;
      if (params.destination) body.destination = params.destination;
      if (params.method) body.method = params.method;
      if (params.source_type) body.source_type = params.source_type;
      if (params.statement_descriptor) body.statement_descriptor = params.statement_descriptor;
      if (params.metadata) body.metadata = params.metadata;

      const payout = await logger.time("tool.create_payout", () =>
        client.post<Record<string, unknown>>("/payouts", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_payout" });
      return { content: [{ type: "text", text: JSON.stringify(payout, null, 2) }], structuredContent: payout };
    },

    cancel_payout: async (args) => {
      const { payout_id } = CancelPayoutSchema.parse(args);
      const payout = await logger.time("tool.cancel_payout", () =>
        client.post<Record<string, unknown>>(`/payouts/${payout_id}/cancel`, {})
      , { tool: "cancel_payout", payout_id });
      return { content: [{ type: "text", text: JSON.stringify(payout, null, 2) }], structuredContent: payout };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
