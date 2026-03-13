// Invoices tools — Stripe API v1
// Covers: list_invoices, get_invoice, finalize_invoice, pay_invoice, void_invoice, get_invoice_line_items

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

const FinalizeInvoiceSchema = z.object({
  invoice_id: z.string().describe("Stripe invoice ID (in_xxx) to finalize — must be in draft status"),
  auto_advance: z.boolean().optional().describe("Whether to auto-advance the invoice after finalization (default: true)"),
});

const PayInvoiceSchema = z.object({
  invoice_id: z.string().describe("Stripe invoice ID (in_xxx) to pay — must be in open status"),
  payment_method: z.string().optional().describe("Payment method ID (pm_xxx) to charge — uses customer default if omitted"),
  source: z.string().optional().describe("Source ID to charge (legacy cards)"),
  forgive: z.boolean().optional().describe("If true, marks invoice as paid even if payment fails (used to write off bad debt)"),
  paid_out_of_band: z.boolean().optional().describe("If true, marks invoice as paid without charging (e.g., cash payment)"),
});

const VoidInvoiceSchema = z.object({
  invoice_id: z.string().describe("Stripe invoice ID (in_xxx) to void — must be in open status. This is irreversible."),
});

const GetInvoiceLineItemsSchema = z.object({
  invoice_id: z.string().describe("Stripe invoice ID (in_xxx)"),
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
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
    {
      name: "finalize_invoice",
      title: "Finalize Invoice",
      description:
        "Finalize a Stripe draft invoice, making it ready to be paid. Once finalized, a PDF is generated and the invoice can be sent to the customer or paid programmatically. Only draft invoices can be finalized.",
      inputSchema: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "Stripe invoice ID (in_xxx) — must be in draft status" },
          auto_advance: { type: "boolean", description: "Auto-advance after finalization (default: true)" },
        },
        required: ["invoice_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          hosted_invoice_url: { type: "string" },
          invoice_pdf: { type: "string" },
        },
        required: ["id", "status"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "pay_invoice",
      title: "Pay Invoice",
      description:
        "Attempt to pay an open Stripe invoice immediately. Uses the customer's default payment method unless you specify payment_method. Set paid_out_of_band=true to mark as paid without charging (for cash/offline payments). Set forgive=true to write off bad debt.",
      inputSchema: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "Stripe invoice ID (in_xxx) — must be in open status" },
          payment_method: { type: "string", description: "Payment method ID (pm_xxx) to use" },
          forgive: { type: "boolean", description: "Mark as paid even if charge fails (bad debt write-off)" },
          paid_out_of_band: { type: "boolean", description: "Mark as paid without charging (offline payments)" },
        },
        required: ["invoice_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          paid: { type: "boolean" },
          amount_paid: { type: "number" },
        },
        required: ["id", "status"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    {
      name: "void_invoice",
      title: "Void Invoice",
      description:
        "Void an open Stripe invoice — marks it as uncollectible and cancelled. This is irreversible. The invoice status changes to 'void'. Use when an invoice was issued in error or is no longer valid.",
      inputSchema: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "Stripe invoice ID (in_xxx) — must be in open status" },
        },
        required: ["invoice_id"],
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
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "get_invoice_line_items",
      title: "Get Invoice Line Items",
      description:
        "List line items for a specific Stripe invoice (in_xxx). Returns item descriptions, amounts, quantities, and associated subscription/price details. Uses keyset pagination — pass meta.lastId as starting_after for the next page.",
      inputSchema: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "Stripe invoice ID (in_xxx)" },
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
        },
        required: ["invoice_id"],
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

    finalize_invoice: async (args) => {
      const params = FinalizeInvoiceSchema.parse(args);

      const body: Record<string, string | number | boolean | undefined | null> = {};
      if (params.auto_advance !== undefined) body.auto_advance = params.auto_advance;

      const invoice = await logger.time("tool.finalize_invoice", () =>
        client.post<StripeInvoice>(`/invoices/${params.invoice_id}/finalize`, body)
      , { tool: "finalize_invoice", invoice_id: params.invoice_id });

      return {
        content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }],
        structuredContent: invoice,
      };
    },

    pay_invoice: async (args) => {
      const params = PayInvoiceSchema.parse(args);

      const body: Record<string, string | number | boolean | undefined | null> = {};
      if (params.payment_method) body.payment_method = params.payment_method;
      if (params.source) body.source = params.source;
      if (params.forgive !== undefined) body.forgive = params.forgive;
      if (params.paid_out_of_band !== undefined) body.paid_out_of_band = params.paid_out_of_band;

      const invoice = await logger.time("tool.pay_invoice", () =>
        client.post<StripeInvoice>(`/invoices/${params.invoice_id}/pay`, body)
      , { tool: "pay_invoice", invoice_id: params.invoice_id });

      return {
        content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }],
        structuredContent: invoice,
      };
    },

    void_invoice: async (args) => {
      const { invoice_id } = VoidInvoiceSchema.parse(args);

      const invoice = await logger.time("tool.void_invoice", () =>
        client.post<StripeInvoice>(`/invoices/${invoice_id}/void`, {})
      , { tool: "void_invoice", invoice_id });

      return {
        content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }],
        structuredContent: invoice,
      };
    },

    get_invoice_line_items: async (args) => {
      const params = GetInvoiceLineItemsSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.starting_after) queryParams.starting_after = params.starting_after;

      const result = await logger.time("tool.get_invoice_line_items", () =>
        client.list<Record<string, unknown>>(`/invoices/${params.invoice_id}/lines`, queryParams)
      , { tool: "get_invoice_line_items", invoice_id: params.invoice_id });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: {
          count: result.data.length,
          hasMore: result.has_more,
          ...(lastItem?.id ? { lastId: lastItem.id } : {}),
        },
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
        structuredContent: response,
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
