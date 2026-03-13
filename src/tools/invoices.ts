// Invoices tools — Stripe API v1
// Covers: list_invoices, get_invoice, finalize_invoice, pay_invoice, void_invoice, get_invoice_line_items

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeInvoice } from "../types.js";
import { logger } from "../logger.js";

// === NEW Zod Schemas (expansion) ===
const RetrieveUpcomingInvoiceSchema = z.object({
  customer: z.string().describe("Customer ID (cus_xxx) — required to preview upcoming invoice"),
  subscription: z.string().optional().describe("Subscription ID (sub_xxx) — preview the next invoice for a specific subscription"),
  subscription_items: z.array(z.object({
    id: z.string().optional().describe("Subscription item ID (si_xxx) to update"),
    price: z.string().optional().describe("New price ID to switch this item to (for preview)"),
    quantity: z.number().int().positive().optional().describe("New quantity for preview"),
    deleted: z.boolean().optional().describe("Preview with this item removed"),
  })).optional().describe("Preview with subscription item changes applied (for upgrade/downgrade preview)"),
  coupon: z.string().optional().describe("Preview with a coupon applied"),
  promotion_code: z.string().optional().describe("Preview with a promotion code applied"),
  subscription_proration_behavior: z.enum(["create_prorations", "none", "always_invoice"]).optional().describe("Proration behavior for the preview"),
  subscription_proration_date: z.number().int().positive().optional().describe("Unix timestamp to use as the proration date for mid-cycle changes"),
});

const ListInvoiceItemsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  customer: z.string().optional().describe("Filter by customer ID (cus_xxx)"),
  invoice: z.string().optional().describe("Filter by invoice ID (in_xxx) — returns items belonging to that invoice. Use null for pending items not yet added to an invoice."),
  pending: z.boolean().optional().describe("If true, returns only pending invoice items (not yet assigned to any invoice)"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — for reversed pagination"),
});

const CreateInvoiceItemSchema = z.object({
  customer: z.string().describe("Customer ID (cus_xxx) to add this item for — required"),
  amount: z.number().int().optional().describe("Amount in smallest currency unit (e.g. 1000 for $10.00 USD). Use with currency. Either amount+currency or price is required."),
  currency: z.string().length(3).optional().describe("Three-letter ISO currency code (required if amount is set)"),
  price: z.string().optional().describe("Price ID (price_xxx) — alternative to amount+currency"),
  quantity: z.number().int().positive().optional().default(1).describe("Quantity (default: 1)"),
  description: z.string().optional().describe("Description shown on the invoice line item"),
  invoice: z.string().optional().describe("Invoice ID (in_xxx) to add this item to immediately. Omit to create a pending item added to the next invoice."),
  subscription: z.string().optional().describe("Subscription ID (sub_xxx) to associate with — affects proration"),
  unit_amount: z.number().int().optional().describe("Unit amount in smallest currency unit (use with quantity)"),
  discountable: z.boolean().optional().default(true).describe("Whether discounts/coupons apply to this item (default: true)"),
  tax_rates: z.array(z.string()).optional().describe("Tax rate IDs (txr_xxx) to apply to this invoice item"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
});

const DeleteInvoiceItemSchema = z.object({
  invoice_item_id: z.string().describe("Stripe invoice item ID (ii_xxx) to delete — must be a pending (not-yet-invoiced) item"),
});

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
    // ---- EXPANDED TOOLS ----
    {
      name: "retrieve_upcoming_invoice",
      title: "Retrieve Upcoming Invoice",
      description:
        "Preview a customer's next Stripe invoice before it's created. Essential for showing upgrade/downgrade pricing before confirming. Pass subscription_items to simulate plan changes and see prorated amounts. Returns the full invoice object with line items but without creating it.",
      inputSchema: {
        type: "object",
        properties: {
          customer: { type: "string", description: "Customer ID (cus_xxx) — required" },
          subscription: { type: "string", description: "Subscription ID (sub_xxx) to preview" },
          subscription_items: {
            type: "array",
            description: "Simulate item changes: [{id: 'si_xxx', price: 'price_new', quantity: 2}]",
            items: { type: "object" },
          },
          coupon: { type: "string", description: "Preview with coupon applied" },
          promotion_code: { type: "string", description: "Preview with promotion code applied" },
          subscription_proration_behavior: { type: "string", enum: ["create_prorations", "none", "always_invoice"], description: "Proration behavior" },
          subscription_proration_date: { type: "number", description: "Proration date (Unix timestamp)" },
        },
        required: ["customer"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_invoice_items",
      title: "List Invoice Items",
      description:
        "List Stripe invoice items (individual line items that will be or were added to invoices). Filter by customer, invoice, or pending status. Pending items are charges not yet assigned to an invoice. Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          customer: { type: "string", description: "Filter by customer ID (cus_xxx)" },
          invoice: { type: "string", description: "Filter by invoice ID (in_xxx)" },
          pending: { type: "boolean", description: "true = only pending items not yet on an invoice" },
          created_gte: { type: "number", description: "Filter by creation time (Unix timestamp, >=)" },
          created_lte: { type: "number", description: "Filter by creation time (Unix timestamp, <=)" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_invoice_item",
      title: "Create Invoice Item",
      description:
        "Create a Stripe invoice item — adds a one-time charge to a customer's next invoice (or a specific draft invoice). Specify either amount+currency or a price ID. Omit invoice to create a pending item that will be included in the next automatically-generated invoice.",
      inputSchema: {
        type: "object",
        properties: {
          customer: { type: "string", description: "Customer ID (cus_xxx) — required" },
          amount: { type: "number", description: "Amount in smallest currency unit (e.g. 1000 = $10.00)" },
          currency: { type: "string", description: "Currency code (e.g. 'usd') — required if amount set" },
          price: { type: "string", description: "Price ID (price_xxx) — alternative to amount+currency" },
          quantity: { type: "number", description: "Quantity (default: 1)" },
          description: { type: "string", description: "Line item description shown on invoice" },
          invoice: { type: "string", description: "Invoice ID (in_xxx) to add to immediately (omit for pending)" },
          subscription: { type: "string", description: "Associated subscription ID (sub_xxx)" },
          discountable: { type: "boolean", description: "Whether discounts apply (default: true)" },
          tax_rates: { type: "array", description: "Tax rate IDs to apply", items: { type: "string" } },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["customer"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "delete_invoice_item",
      title: "Delete Invoice Item",
      description:
        "Delete a pending Stripe invoice item (ii_xxx). Only pending items (not yet assigned to a finalized invoice) can be deleted. Use this to remove a charge before the invoice is generated.",
      inputSchema: {
        type: "object",
        properties: {
          invoice_item_id: { type: "string", description: "Invoice item ID (ii_xxx) to delete — must be pending" },
        },
        required: ["invoice_item_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
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

    // ---- EXPANDED HANDLERS ----
    retrieve_upcoming_invoice: async (args) => {
      const params = RetrieveUpcomingInvoiceSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        customer: params.customer,
      };
      if (params.subscription) queryParams.subscription = params.subscription;
      if (params.coupon) queryParams.coupon = params.coupon;
      if (params.promotion_code) queryParams.promotion_code = params.promotion_code;
      if (params.subscription_proration_behavior) queryParams.subscription_proration_behavior = params.subscription_proration_behavior;
      if (params.subscription_proration_date) queryParams.subscription_proration_date = params.subscription_proration_date;
      if (params.subscription_items) {
        params.subscription_items.forEach((item, i) => {
          if (item.id) queryParams[`subscription_items[${i}][id]`] = item.id;
          if (item.price) queryParams[`subscription_items[${i}][price]`] = item.price;
          if (item.quantity !== undefined) queryParams[`subscription_items[${i}][quantity]`] = item.quantity;
          if (item.deleted !== undefined) queryParams[`subscription_items[${i}][deleted]`] = item.deleted;
        });
      }

      const invoice = await logger.time("tool.retrieve_upcoming_invoice", () =>
        client.get<StripeInvoice>("/invoices/upcoming", queryParams)
      , { tool: "retrieve_upcoming_invoice" });
      return { content: [{ type: "text", text: JSON.stringify(invoice, null, 2) }], structuredContent: invoice };
    },

    list_invoice_items: async (args) => {
      const params = ListInvoiceItemsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.customer) queryParams.customer = params.customer;
      if (params.invoice) queryParams.invoice = params.invoice;
      if (params.pending !== undefined) queryParams.pending = params.pending;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_invoice_items", () =>
        client.list<Record<string, unknown>>("/invoiceitems", queryParams)
      , { tool: "list_invoice_items" });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    create_invoice_item: async (args) => {
      const params = CreateInvoiceItemSchema.parse(args);
      const body: Record<string, unknown> = { customer: params.customer };

      if (params.amount !== undefined) body.amount = params.amount;
      if (params.currency) body.currency = params.currency;
      if (params.price) body.price = params.price;
      if (params.quantity !== undefined) body.quantity = params.quantity;
      if (params.description) body.description = params.description;
      if (params.invoice) body.invoice = params.invoice;
      if (params.subscription) body.subscription = params.subscription;
      if (params.unit_amount !== undefined) body.unit_amount = params.unit_amount;
      if (params.discountable !== undefined) body.discountable = params.discountable;
      if (params.metadata) body.metadata = params.metadata;
      if (params.tax_rates) {
        params.tax_rates.forEach((tr, i) => { body[`tax_rates[${i}]`] = tr; });
      }

      const item = await logger.time("tool.create_invoice_item", () =>
        client.post<Record<string, unknown>>("/invoiceitems", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_invoice_item" });
      return { content: [{ type: "text", text: JSON.stringify(item, null, 2) }], structuredContent: item };
    },

    delete_invoice_item: async (args) => {
      const { invoice_item_id } = DeleteInvoiceItemSchema.parse(args);
      const result = await logger.time("tool.delete_invoice_item", () =>
        client.delete<Record<string, unknown>>(`/invoiceitems/${invoice_item_id}`)
      , { tool: "delete_invoice_item", invoice_item_id });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },
  };
}

export function getTools(client: StripeClient) {
  return {
    tools: getToolDefinitions(),
    handlers: getToolHandlers(client),
  };
}
