// Invoices tools — Stripe API v1
// Covers: list_invoices, get_invoice

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeInvoice } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListInvoicesSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  customer: z.string().optional().describe("Filter by customer ID (cus_xxx)"),
  subscription: z.string().optional().describe("Filter by subscription ID (sub_xxx)"),
  status: z.enum(["draft", "open", "paid", "uncollectible", "void"]).optional().describe("Filter by invoice status"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
});

const GetInvoiceSchema = z.object({
  invoice_id: z.string().describe("Stripe invoice ID (in_xxx)"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_invoices",
      title: "List Invoices",
      description:
        "List Stripe invoices with optional filters by customer, subscription, and status. Returns invoice ID, total, due date, and payment status. Uses keyset pagination — pass meta.lastId as starting_after for next page. Status: draft, open, paid, uncollectible, void.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          customer: { type: "string", description: "Filter by customer ID (cus_xxx)" },
          subscription: { type: "string", description: "Filter by subscription ID (sub_xxx)" },
          status: { type: "string", enum: ["draft", "open", "paid", "uncollectible", "void"], description: "Filter by invoice status" },
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
      name: "get_invoice",
      title: "Get Invoice",
      description:
        "Get full details for a Stripe invoice by ID (in_xxx). Returns line items, amounts, due date, and payment status. Use when the user references a specific invoice or needs billing details.",
      inputSchema: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "Stripe invoice ID (in_xxx)" },
        },
        required: ["invoice_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          customer: { type: "string" },
          total: { type: "number" },
          amount_due: { type: "number" },
          amount_paid: { type: "number" },
          currency: { type: "string" },
          status: { type: "string" },
          paid: { type: "boolean" },
          lines: { type: "object" },
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
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_invoices: async (args) => {
      const params = ListInvoicesSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.customer) queryParams.customer = params.customer;
      if (params.subscription) queryParams.subscription = params.subscription;
      if (params.status) queryParams.status = params.status;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_invoices", () =>
        client.list<StripeInvoice>("/invoices", queryParams)
      , { tool: "list_invoices" });

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

    get_invoice: async (args) => {
      const { invoice_id } = GetInvoiceSchema.parse(args);

      const invoice = await logger.time("tool.get_invoice", () =>
        client.get<StripeInvoice>(`/invoices/${invoice_id}`)
      , { tool: "get_invoice", invoice_id });

      return {
        content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }],
        structuredContent: invoice,
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
