// Payment Links tools — Stripe API v1
// Covers: list_payment_links, get_payment_link, create_payment_link, update_payment_link,
//         list_payment_link_line_items

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListPaymentLinksSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  active: z.boolean().optional().describe("Filter by active status"),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetPaymentLinkSchema = z.object({
  payment_link_id: z.string().describe("Payment link ID (plink_xxx)"),
});

const CreatePaymentLinkSchema = z.object({
  line_items: z.array(z.object({
    price: z.string().describe("Price ID (price_xxx)"),
    quantity: z.number().int().positive().describe("Quantity"),
    adjustable_quantity: z.object({
      enabled: z.boolean(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
    }).optional(),
  })).min(1).describe("Line items to include in the payment link (at least one required)"),
  mode: z.enum(["payment", "subscription"]).optional().default("payment").describe("payment (one-time) or subscription (recurring)"),
  after_completion_type: z.enum(["hosted_confirmation", "redirect"]).optional().default("hosted_confirmation"),
  after_completion_redirect_url: z.string().url().optional().describe("Redirect URL after payment (required if after_completion_type is 'redirect')"),
  allow_promotion_codes: z.boolean().optional().describe("Allow customers to enter promotion codes"),
  automatic_tax_enabled: z.boolean().optional().describe("Enable automatic tax collection"),
  billing_address_collection: z.enum(["auto", "required"]).optional(),
  customer_creation: z.enum(["always", "if_required"]).optional(),
  phone_number_collection: z.boolean().optional().describe("Collect customer phone number"),
  submit_type: z.enum(["auto", "book", "donate", "pay"]).optional().describe("Button text (only for payment mode)"),
  currency: z.string().length(3).optional().describe("Currency for the payment link"),
  metadata: z.record(z.string()).optional(),
});

const UpdatePaymentLinkSchema = z.object({
  payment_link_id: z.string(),
  active: z.boolean().optional().describe("Activate or deactivate the payment link"),
  after_completion_type: z.enum(["hosted_confirmation", "redirect"]).optional(),
  after_completion_redirect_url: z.string().url().optional(),
  allow_promotion_codes: z.boolean().optional(),
  metadata: z.record(z.string()).optional(),
});

const ListPaymentLinkLineItemsSchema = z.object({
  payment_link_id: z.string().describe("Payment link ID (plink_xxx)"),
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_payment_links",
      title: "List Payment Links",
      description:
        "List all Stripe Payment Links. Payment links are shareable URLs that let customers pay without a custom checkout integration. Returns link ID, URL, active status, and mode (payment/subscription).",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          active: { type: "boolean", description: "Filter by active status" },
          starting_after: { type: "string", description: "Pagination cursor" },
          ending_before: { type: "string", description: "Pagination cursor — reversed" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_payment_link",
      title: "Get Payment Link",
      description: "Retrieve a specific Payment Link by ID (plink_xxx). Returns the full payment link including URL, line items, after_completion settings, and configuration.",
      inputSchema: {
        type: "object",
        properties: { payment_link_id: { type: "string", description: "Payment link ID (plink_xxx)" } },
        required: ["payment_link_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_payment_link",
      title: "Create Payment Link",
      description:
        "Create a new Stripe Payment Link. Payment links generate a hosted checkout URL that can be shared via email, SMS, or social media. Specify line items with prices, mode (payment/subscription), and after-payment behavior.",
      inputSchema: {
        type: "object",
        properties: {
          line_items: {
            type: "array",
            description: "Line items (array of {price, quantity, adjustable_quantity?})",
          },
          mode: { type: "string", enum: ["payment", "subscription"], description: "payment (one-time) or subscription (recurring)" },
          after_completion_type: { type: "string", enum: ["hosted_confirmation", "redirect"] },
          after_completion_redirect_url: { type: "string", description: "Redirect URL (required if type=redirect)" },
          allow_promotion_codes: { type: "boolean" },
          automatic_tax_enabled: { type: "boolean" },
          billing_address_collection: { type: "string", enum: ["auto", "required"] },
          customer_creation: { type: "string", enum: ["always", "if_required"] },
          phone_number_collection: { type: "boolean" },
          submit_type: { type: "string", enum: ["auto", "book", "donate", "pay"] },
          currency: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["line_items"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_payment_link",
      title: "Update Payment Link",
      description: "Update a Payment Link. Deactivate by setting active=false (the URL will stop working). Can also update after_completion settings and metadata.",
      inputSchema: {
        type: "object",
        properties: {
          payment_link_id: { type: "string" },
          active: { type: "boolean", description: "true to activate, false to deactivate" },
          after_completion_type: { type: "string", enum: ["hosted_confirmation", "redirect"] },
          after_completion_redirect_url: { type: "string" },
          allow_promotion_codes: { type: "boolean" },
          metadata: { type: "object" },
        },
        required: ["payment_link_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_payment_link_line_items",
      title: "List Payment Link Line Items",
      description: "List the line items (products/prices) configured on a Payment Link. Returns price, quantity, and description for each item.",
      inputSchema: {
        type: "object",
        properties: {
          payment_link_id: { type: "string", description: "Payment link ID (plink_xxx)" },
          limit: { type: "number" },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
        required: ["payment_link_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_payment_links: async (args) => {
      const params = ListPaymentLinksSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.active !== undefined) q.active = params.active;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_payment_links", () =>
        client.list<Record<string, unknown>>("/payment_links", q)
      , { tool: "list_payment_links" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_payment_link: async (args) => {
      const { payment_link_id } = GetPaymentLinkSchema.parse(args);
      const r = await logger.time("tool.get_payment_link", () =>
        client.get<Record<string, unknown>>(`/payment_links/${payment_link_id}`)
      , { tool: "get_payment_link" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_payment_link: async (args) => {
      const params = CreatePaymentLinkSchema.parse(args);
      const body: Record<string, unknown> = {};

      // Line items
      params.line_items.forEach((item, i) => {
        body[`line_items[${i}][price]`] = item.price;
        body[`line_items[${i}][quantity]`] = item.quantity;
        if (item.adjustable_quantity) {
          body[`line_items[${i}][adjustable_quantity][enabled]`] = item.adjustable_quantity.enabled;
          if (item.adjustable_quantity.minimum !== undefined) body[`line_items[${i}][adjustable_quantity][minimum]`] = item.adjustable_quantity.minimum;
          if (item.adjustable_quantity.maximum !== undefined) body[`line_items[${i}][adjustable_quantity][maximum]`] = item.adjustable_quantity.maximum;
        }
      });

      if (params.mode) body.mode = params.mode;
      if (params.after_completion_type) body["after_completion[type]"] = params.after_completion_type;
      if (params.after_completion_redirect_url) body["after_completion[redirect][url]"] = params.after_completion_redirect_url;
      if (params.allow_promotion_codes !== undefined) body.allow_promotion_codes = params.allow_promotion_codes;
      if (params.automatic_tax_enabled !== undefined) body["automatic_tax[enabled]"] = params.automatic_tax_enabled;
      if (params.billing_address_collection) body.billing_address_collection = params.billing_address_collection;
      if (params.customer_creation) body.customer_creation = params.customer_creation;
      if (params.phone_number_collection !== undefined) body["phone_number_collection[enabled]"] = params.phone_number_collection;
      if (params.submit_type) body.submit_type = params.submit_type;
      if (params.currency) body.currency = params.currency;
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.create_payment_link", () =>
        client.post<Record<string, unknown>>("/payment_links", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_payment_link" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    update_payment_link: async (args) => {
      const { payment_link_id, ...rest } = UpdatePaymentLinkSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (rest.active !== undefined) body.active = rest.active;
      if (rest.after_completion_type) body["after_completion[type]"] = rest.after_completion_type;
      if (rest.after_completion_redirect_url) body["after_completion[redirect][url]"] = rest.after_completion_redirect_url;
      if (rest.allow_promotion_codes !== undefined) body.allow_promotion_codes = rest.allow_promotion_codes;
      if (rest.metadata) body.metadata = rest.metadata;

      const r = await logger.time("tool.update_payment_link", () =>
        client.post<Record<string, unknown>>(`/payment_links/${payment_link_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_payment_link" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_payment_link_line_items: async (args) => {
      const params = ListPaymentLinkLineItemsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_payment_link_line_items", () =>
        client.list<Record<string, unknown>>(`/payment_links/${params.payment_link_id}/line_items`, q)
      , { tool: "list_payment_link_line_items" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
