// Shipping Rates tools — Stripe API v1
// Covers: list_shipping_rates, get_shipping_rate, create_shipping_rate, update_shipping_rate

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListShippingRatesSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  active: z.boolean().optional().describe("Filter by active status"),
  currency: z.string().length(3).optional().describe("Filter by currency (e.g. 'usd', 'eur')"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — for reversed pagination"),
});

const GetShippingRateSchema = z.object({
  shipping_rate_id: z.string().describe("Stripe shipping rate ID (shr_xxx)"),
});

const CreateShippingRateSchema = z.object({
  display_name: z.string().describe("Shipping rate name shown to customers at checkout (e.g. 'Standard Shipping', 'Express 2-Day')"),
  type: z.enum(["fixed_amount"]).optional().default("fixed_amount").describe("Shipping rate type — currently only 'fixed_amount' is supported"),
  fixed_amount: z.object({
    amount: z.number().int().min(0).describe("Shipping cost in smallest currency unit (e.g. 500 for $5.00 USD, or 0 for free shipping)"),
    currency: z.string().length(3).describe("Three-letter ISO currency code (e.g. 'usd', 'eur', 'gbp')"),
    currency_options: z.record(z.object({
      amount: z.number().int().min(0).describe("Amount in this currency"),
      tax_behavior: z.enum(["inclusive", "exclusive", "unspecified"]).optional().describe("Tax behavior for this currency"),
    })).optional().describe("Per-currency amount overrides for multi-currency checkout"),
  }).optional().describe("Fixed shipping amount — required when type is 'fixed_amount'"),
  delivery_estimate: z.object({
    minimum: z.object({
      unit: z.enum(["hour", "day", "business_day", "week", "month"]).describe("Time unit"),
      value: z.number().int().positive().describe("Number of units"),
    }).optional().describe("Minimum estimated delivery time"),
    maximum: z.object({
      unit: z.enum(["hour", "day", "business_day", "week", "month"]).describe("Time unit"),
      value: z.number().int().positive().describe("Number of units"),
    }).optional().describe("Maximum estimated delivery time"),
  }).optional().describe("Estimated delivery time range shown at checkout (e.g. 3-5 business days)"),
  tax_behavior: z.enum(["inclusive", "exclusive", "unspecified"]).optional().describe("Tax behavior: inclusive (tax included in price), exclusive (tax added on top), unspecified"),
  tax_code: z.string().optional().describe("Tax code for automatic tax calculation (e.g. 'txcd_92010001' for shipping)"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
});

const UpdateShippingRateSchema = z.object({
  shipping_rate_id: z.string().describe("Stripe shipping rate ID (shr_xxx)"),
  active: z.boolean().optional().describe("Activate or deactivate this shipping rate"),
  display_name: z.string().optional().describe("Updated display name"),
  fixed_amount: z.object({
    currency_options: z.record(z.object({
      amount: z.number().int().min(0).optional().describe("Amount in this currency"),
      tax_behavior: z.enum(["inclusive", "exclusive", "unspecified"]).optional().describe("Tax behavior"),
    })).optional().describe("Update per-currency amounts"),
  }).optional().describe("Update fixed amount currency options"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata (merges with existing)"),
  tax_behavior: z.enum(["inclusive", "exclusive", "unspecified"]).optional().describe("Updated tax behavior"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_shipping_rates",
      title: "List Shipping Rates",
      description:
        "List Stripe shipping rates — used in Checkout sessions and Payment Links to offer shipping options. Filter by active status or currency. Returns display name, amount, delivery estimate, and tax behavior. Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          active: { type: "boolean", description: "Filter by active status" },
          currency: { type: "string", description: "Filter by currency (e.g. 'usd')" },
          created_gte: { type: "number", description: "Filter by creation time (Unix timestamp, >=)" },
          created_lte: { type: "number", description: "Filter by creation time (Unix timestamp, <=)" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_shipping_rate",
      title: "Get Shipping Rate",
      description:
        "Get full details for a Stripe shipping rate by ID (shr_xxx). Returns display name, fixed_amount, delivery_estimate, tax_behavior, tax_code, and active status.",
      inputSchema: {
        type: "object",
        properties: {
          shipping_rate_id: { type: "string", description: "Stripe shipping rate ID (shr_xxx)" },
        },
        required: ["shipping_rate_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_shipping_rate",
      title: "Create Shipping Rate",
      description:
        "Create a Stripe shipping rate to offer at checkout. Set fixed_amount.amount=0 for free shipping. Use delivery_estimate to show customers a timeframe (e.g. 3-5 business days). Set tax_code='txcd_92010001' for Stripe Tax automatic calculation on shipping costs.",
      inputSchema: {
        type: "object",
        properties: {
          display_name: { type: "string", description: "Name shown at checkout (e.g. 'Standard Shipping', 'Free Shipping')" },
          type: { type: "string", enum: ["fixed_amount"], description: "Type (currently only fixed_amount)" },
          fixed_amount: {
            type: "object",
            description: "Shipping cost: {amount: 500, currency: 'usd'} for $5.00 USD. Use amount: 0 for free.",
          },
          delivery_estimate: {
            type: "object",
            description: "Delivery time range: {minimum: {unit: 'business_day', value: 3}, maximum: {unit: 'business_day', value: 5}}",
          },
          tax_behavior: { type: "string", enum: ["inclusive", "exclusive", "unspecified"], description: "Tax behavior" },
          tax_code: { type: "string", description: "Tax code for automatic tax (e.g. 'txcd_92010001' for shipping)" },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["display_name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_shipping_rate",
      title: "Update Shipping Rate",
      description:
        "Update a Stripe shipping rate — activate/deactivate it, update currency options for multi-currency, or update metadata. Note: the core amount and currency cannot be changed — create a new shipping rate for that.",
      inputSchema: {
        type: "object",
        properties: {
          shipping_rate_id: { type: "string", description: "Stripe shipping rate ID (shr_xxx)" },
          active: { type: "boolean", description: "Activate (true) or deactivate (false)" },
          display_name: { type: "string", description: "Updated display name" },
          fixed_amount: { type: "object", description: "Update currency_options for multi-currency" },
          metadata: { type: "object", description: "Key-value metadata" },
          tax_behavior: { type: "string", enum: ["inclusive", "exclusive", "unspecified"], description: "Updated tax behavior" },
        },
        required: ["shipping_rate_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_shipping_rates: async (args) => {
      const params = ListShippingRatesSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.active !== undefined) queryParams.active = params.active;
      if (params.currency) queryParams.currency = params.currency;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_shipping_rates", () =>
        client.list<Record<string, unknown>>("/shipping_rates", queryParams)
      , { tool: "list_shipping_rates" });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_shipping_rate: async (args) => {
      const { shipping_rate_id } = GetShippingRateSchema.parse(args);
      const rate = await logger.time("tool.get_shipping_rate", () =>
        client.get<Record<string, unknown>>(`/shipping_rates/${shipping_rate_id}`)
      , { tool: "get_shipping_rate", shipping_rate_id });
      return { content: [{ type: "text", text: JSON.stringify(rate, null, 2) }], structuredContent: rate };
    },

    create_shipping_rate: async (args) => {
      const params = CreateShippingRateSchema.parse(args);
      const body: Record<string, unknown> = {
        display_name: params.display_name,
        type: params.type || "fixed_amount",
      };

      if (params.fixed_amount) {
        body["fixed_amount[amount]"] = params.fixed_amount.amount;
        body["fixed_amount[currency]"] = params.fixed_amount.currency;
        if (params.fixed_amount.currency_options) {
          for (const [currency, opts] of Object.entries(params.fixed_amount.currency_options)) {
            body[`fixed_amount[currency_options][${currency}][amount]`] = opts.amount;
            if (opts.tax_behavior) body[`fixed_amount[currency_options][${currency}][tax_behavior]`] = opts.tax_behavior;
          }
        }
      }

      if (params.delivery_estimate) {
        if (params.delivery_estimate.minimum) {
          body["delivery_estimate[minimum][unit]"] = params.delivery_estimate.minimum.unit;
          body["delivery_estimate[minimum][value]"] = params.delivery_estimate.minimum.value;
        }
        if (params.delivery_estimate.maximum) {
          body["delivery_estimate[maximum][unit]"] = params.delivery_estimate.maximum.unit;
          body["delivery_estimate[maximum][value]"] = params.delivery_estimate.maximum.value;
        }
      }

      if (params.tax_behavior) body.tax_behavior = params.tax_behavior;
      if (params.tax_code) body.tax_code = params.tax_code;
      if (params.metadata) body.metadata = params.metadata;

      const rate = await logger.time("tool.create_shipping_rate", () =>
        client.post<Record<string, unknown>>("/shipping_rates", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_shipping_rate" });
      return { content: [{ type: "text", text: JSON.stringify(rate, null, 2) }], structuredContent: rate };
    },

    update_shipping_rate: async (args) => {
      const params = UpdateShippingRateSchema.parse(args);
      const { shipping_rate_id, active, display_name, fixed_amount, metadata, tax_behavior } = params;
      const body: Record<string, unknown> = {};

      if (active !== undefined) body.active = active;
      if (display_name !== undefined) body.display_name = display_name;
      if (tax_behavior !== undefined) body.tax_behavior = tax_behavior;
      if (metadata) body.metadata = metadata;

      if (fixed_amount?.currency_options) {
        for (const [currency, opts] of Object.entries(fixed_amount.currency_options)) {
          if (opts.amount !== undefined) body[`fixed_amount[currency_options][${currency}][amount]`] = opts.amount;
          if (opts.tax_behavior) body[`fixed_amount[currency_options][${currency}][tax_behavior]`] = opts.tax_behavior;
        }
      }

      const rate = await logger.time("tool.update_shipping_rate", () =>
        client.post<Record<string, unknown>>(`/shipping_rates/${shipping_rate_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_shipping_rate", shipping_rate_id });
      return { content: [{ type: "text", text: JSON.stringify(rate, null, 2) }], structuredContent: rate };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
