// Application Fees tools — Stripe API v1
// Covers: list_application_fees, get_application_fee,
//         list_fee_refunds, get_fee_refund, create_fee_refund

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListApplicationFeesSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  charge: z.string().optional().describe("Filter by charge ID (ch_xxx)"),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  created_gte: z.number().optional(),
  created_lte: z.number().optional(),
});

const GetApplicationFeeSchema = z.object({
  fee_id: z.string().describe("Application fee ID (fee_xxx)"),
});

const ListFeeRefundsSchema = z.object({
  fee_id: z.string().describe("Application fee ID (fee_xxx) to list refunds for"),
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetFeeRefundSchema = z.object({
  fee_id: z.string().describe("Application fee ID (fee_xxx)"),
  refund_id: z.string().describe("Fee refund ID (fr_xxx)"),
});

const CreateFeeRefundSchema = z.object({
  fee_id: z.string().describe("Application fee ID (fee_xxx) to refund"),
  amount: z.number().int().positive().optional().describe("Amount to refund in smallest currency unit. If omitted, refunds the full application fee."),
  metadata: z.record(z.string()).optional(),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_application_fees",
      title: "List Application Fees",
      description:
        "List application fees collected from connected accounts. Application fees are the platform's cut from Connect charges. Returns fee ID, amount, currency, charge, and refunded status. Optionally filter by charge ID.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
          charge: { type: "string", description: "Filter by charge ID (ch_xxx)" },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
          created_gte: { type: "number" },
          created_lte: { type: "number" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_application_fee",
      title: "Get Application Fee",
      description: "Retrieve a specific application fee by ID (fee_xxx). Returns amount, currency, charge, account, originating_transaction, and refunded amount.",
      inputSchema: {
        type: "object",
        properties: { fee_id: { type: "string", description: "Application fee ID (fee_xxx)" } },
        required: ["fee_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_fee_refunds",
      title: "List Application Fee Refunds",
      description: "List refunds for a specific application fee. Returns refund ID, amount, currency, and status.",
      inputSchema: {
        type: "object",
        properties: {
          fee_id: { type: "string", description: "Application fee ID (fee_xxx)" },
          limit: { type: "number" },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
        required: ["fee_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_fee_refund",
      title: "Get Application Fee Refund",
      description: "Retrieve a specific application fee refund by fee ID and refund ID. Returns amount, currency, metadata, and status.",
      inputSchema: {
        type: "object",
        properties: {
          fee_id: { type: "string", description: "Application fee ID (fee_xxx)" },
          refund_id: { type: "string", description: "Fee refund ID (fr_xxx)" },
        },
        required: ["fee_id", "refund_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_fee_refund",
      title: "Create Application Fee Refund",
      description:
        "Refund an application fee collected from a connected account. If amount is not specified, the full fee is refunded. Only fees on non-refunded charges can be refunded.",
      inputSchema: {
        type: "object",
        properties: {
          fee_id: { type: "string", description: "Application fee ID (fee_xxx) to refund" },
          amount: { type: "number", description: "Amount to refund in smallest currency unit (omit for full refund)" },
          metadata: { type: "object" },
        },
        required: ["fee_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_application_fees: async (args) => {
      const params = ListApplicationFeesSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.charge) q.charge = params.charge;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      if (params.created_gte) q["created[gte]"] = params.created_gte;
      if (params.created_lte) q["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_application_fees", () =>
        client.list<Record<string, unknown>>("/application_fees", q)
      , { tool: "list_application_fees" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_application_fee: async (args) => {
      const { fee_id } = GetApplicationFeeSchema.parse(args);
      const r = await logger.time("tool.get_application_fee", () =>
        client.get<Record<string, unknown>>(`/application_fees/${fee_id}`)
      , { tool: "get_application_fee" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_fee_refunds: async (args) => {
      const params = ListFeeRefundsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_fee_refunds", () =>
        client.list<Record<string, unknown>>(`/application_fees/${params.fee_id}/refunds`, q)
      , { tool: "list_fee_refunds" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_fee_refund: async (args) => {
      const { fee_id, refund_id } = GetFeeRefundSchema.parse(args);
      const r = await logger.time("tool.get_fee_refund", () =>
        client.get<Record<string, unknown>>(`/application_fees/${fee_id}/refunds/${refund_id}`)
      , { tool: "get_fee_refund" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_fee_refund: async (args) => {
      const params = CreateFeeRefundSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (params.amount !== undefined) body.amount = params.amount;
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.create_fee_refund", () =>
        client.post<Record<string, unknown>>(`/application_fees/${params.fee_id}/refunds`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_fee_refund" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
