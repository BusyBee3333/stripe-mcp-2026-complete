// Refunds tools — Stripe API v1
// Covers: create_refund, list_refunds, get_refund, cancel_refund

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeRefund } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const CreateRefundSchema = z.object({
  charge: z.string().optional().describe("Charge ID (ch_xxx) to refund — provide either charge or payment_intent"),
  payment_intent: z.string().optional().describe("PaymentIntent ID (pi_xxx) to refund — alternative to charge"),
  amount: z.number().int().positive().optional().describe("Amount to refund in smallest currency unit (omit for full refund)"),
  reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).optional().describe("Refund reason"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
});

const ListRefundsSchema = z.object({
  charge: z.string().optional().describe("Filter by charge ID (ch_xxx)"),
  payment_intent: z.string().optional().describe("Filter by PaymentIntent ID (pi_xxx)"),
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
});

const GetRefundSchema = z.object({
  refund_id: z.string().describe("Stripe refund ID (re_xxx)"),
});

const CancelRefundSchema = z.object({
  refund_id: z.string().describe("Stripe refund ID (re_xxx) to cancel — only cancellable while status=pending"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "create_refund",
      title: "Create Refund",
      description:
        "Create a refund for a Stripe charge or PaymentIntent. Provide either charge (ch_xxx) or payment_intent (pi_xxx). Omit amount for a full refund, or specify partial amount in smallest currency unit. Reason: duplicate, fraudulent, or requested_by_customer.",
      inputSchema: {
        type: "object",
        properties: {
          charge: { type: "string", description: "Charge ID (ch_xxx) to refund" },
          payment_intent: { type: "string", description: "PaymentIntent ID (pi_xxx) to refund (alternative to charge)" },
          amount: { type: "number", description: "Refund amount in smallest currency unit (omit for full refund)" },
          reason: { type: "string", enum: ["duplicate", "fraudulent", "requested_by_customer"], description: "Refund reason" },
          metadata: { type: "object", description: "Key-value metadata" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          amount: { type: "number" },
          charge: { type: "string" },
          currency: { type: "string" },
          status: { type: "string" },
          reason: { type: "string" },
        },
        required: ["id", "amount"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    {
      name: "list_refunds",
      title: "List Refunds",
      description:
        "List Stripe refunds with optional filters by charge or PaymentIntent. Returns refund ID, amount, currency, and status. Uses keyset pagination — pass meta.lastId as starting_after for the next page.",
      inputSchema: {
        type: "object",
        properties: {
          charge: { type: "string", description: "Filter by charge ID (ch_xxx)" },
          payment_intent: { type: "string", description: "Filter by PaymentIntent ID (pi_xxx)" },
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          data: { type: "array" },
          meta: {
            type: "object",
            properties: {
              count: { type: "number" },
              hasMore: { type: "boolean" },
              lastId: { type: "string" },
            },
          },
        },
        required: ["data", "meta"],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "get_refund",
      title: "Get Refund",
      description:
        "Get full details for a Stripe refund by ID (re_xxx). Returns amount, charge, currency, reason, and current status. Use to check whether a refund succeeded or is still pending.",
      inputSchema: {
        type: "object",
        properties: {
          refund_id: { type: "string", description: "Stripe refund ID (re_xxx)" },
        },
        required: ["refund_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          amount: { type: "number" },
          charge: { type: "string" },
          currency: { type: "string" },
          status: { type: "string" },
          reason: { type: "string" },
        },
        required: ["id"],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "cancel_refund",
      title: "Cancel Refund",
      description:
        "Cancel a Stripe refund that is still in pending status. Only refunds with status=pending can be cancelled. After cancellation, the charge is re-captured. Not all payment methods support refund cancellation.",
      inputSchema: {
        type: "object",
        properties: {
          refund_id: { type: "string", description: "Stripe refund ID (re_xxx) to cancel" },
        },
        required: ["refund_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
        },
        required: ["id", "status"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    create_refund: async (args) => {
      const params = CreateRefundSchema.parse(args);

      if (!params.charge && !params.payment_intent) {
        throw new Error("Either charge or payment_intent is required for create_refund");
      }

      const body: Record<string, string | number | boolean | undefined | null> = {};
      if (params.charge) body.charge = params.charge;
      if (params.payment_intent) body.payment_intent = params.payment_intent;
      if (params.amount) body.amount = params.amount;
      if (params.reason) body.reason = params.reason;

      const refund = await logger.time("tool.create_refund", () =>
        client.post<StripeRefund>("/refunds", body)
      , { tool: "create_refund" });

      return {
        content: [{ type: "text", text: JSON.stringify(refund, null, 2) }],
        structuredContent: refund,
      };
    },

    list_refunds: async (args) => {
      const params = ListRefundsSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.charge) queryParams.charge = params.charge;
      if (params.payment_intent) queryParams.payment_intent = params.payment_intent;
      if (params.starting_after) queryParams.starting_after = params.starting_after;

      const result = await logger.time("tool.list_refunds", () =>
        client.list<StripeRefund>("/refunds", queryParams)
      , { tool: "list_refunds" });

      const lastItem = result.data[result.data.length - 1];
      const response = {
        data: result.data,
        meta: {
          count: result.data.length,
          hasMore: result.has_more,
          ...(lastItem ? { lastId: lastItem.id } : {}),
        },
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
      };
    },

    get_refund: async (args) => {
      const { refund_id } = GetRefundSchema.parse(args);

      const refund = await logger.time("tool.get_refund", () =>
        client.get<StripeRefund>(`/refunds/${refund_id}`)
      , { tool: "get_refund", refund_id });

      return {
        content: [{ type: "text", text: JSON.stringify(refund, null, 2) }],
        structuredContent: refund,
      };
    },

    cancel_refund: async (args) => {
      const { refund_id } = CancelRefundSchema.parse(args);

      const refund = await logger.time("tool.cancel_refund", () =>
        client.post<StripeRefund>(`/refunds/${refund_id}/cancel`, {})
      , { tool: "cancel_refund", refund_id });

      return {
        content: [{ type: "text", text: JSON.stringify(refund, null, 2) }],
        structuredContent: refund,
      };
    },
  };
}

export function getTools(client: StripeClient) {
  return {
    tools: getToolDefinitions(),
    handlers: getToolHandlers(client),
  };
}
