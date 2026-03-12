// Charges and Refunds tools — Stripe API v1
// Covers: list_charges, create_refund

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeCharge, StripeRefund } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListChargesSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  customer: z.string().optional().describe("Filter by customer ID (cus_xxx)"),
  payment_intent: z.string().optional().describe("Filter by PaymentIntent ID (pi_xxx)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
});

const CreateRefundSchema = z.object({
  charge: z.string().optional().describe("Charge ID (ch_xxx) to refund — provide either charge or payment_intent"),
  payment_intent: z.string().optional().describe("PaymentIntent ID (pi_xxx) to refund — alternative to charge"),
  amount: z.number().int().positive().optional().describe("Amount to refund in smallest currency unit (omit for full refund)"),
  reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).optional().describe("Refund reason"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_charges",
      title: "List Charges",
      description:
        "List Stripe charges with optional filters by customer and date range. Returns charge ID, amount, currency, status, and whether it was refunded. Uses keyset pagination — pass meta.lastId as starting_after for the next page.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          customer: { type: "string", description: "Filter by customer ID (cus_xxx)" },
          payment_intent: { type: "string", description: "Filter by PaymentIntent ID (pi_xxx)" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          created_gte: { type: "number", description: "Filter by creation time (Unix timestamp, >=)" },
          created_lte: { type: "number", description: "Filter by creation time (Unix timestamp, <=)" },
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
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_charges: async (args) => {
      const params = ListChargesSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.customer) queryParams.customer = params.customer;
      if (params.payment_intent) queryParams.payment_intent = params.payment_intent;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_charges", () =>
        client.list<StripeCharge>("/charges", queryParams)
      , { tool: "list_charges" });

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

    create_refund: async (args) => {
      const params = CreateRefundSchema.parse(args);

      if (!params.charge && !params.payment_intent) {
        throw new Error("Either charge or payment_intent is required for create_refund");
      }

      const body: Record<string, unknown> = {};
      if (params.charge) body.charge = params.charge;
      if (params.payment_intent) body.payment_intent = params.payment_intent;
      if (params.amount) body.amount = params.amount;
      if (params.reason) body.reason = params.reason;
      if (params.metadata) body.metadata = params.metadata;

      const refund = await logger.time("tool.create_refund", () =>
        client.post<StripeRefund>("/refunds", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_refund" });

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
