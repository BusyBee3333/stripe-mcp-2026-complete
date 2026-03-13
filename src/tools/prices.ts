// Prices tools — Stripe API v1
// Covers: list_prices, get_price, create_price, update_price

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripePrice } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListPricesSchema = z.object({
  product: z.string().optional().describe("Filter by product ID (prod_xxx)"),
  active: z.boolean().optional().describe("Filter by active status"),
  type: z.enum(["one_time", "recurring"]).optional().describe("Filter by price type"),
  currency: z.string().optional().describe("Filter by 3-letter currency code (e.g., 'usd')"),
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
});

const GetPriceSchema = z.object({
  price_id: z.string().describe("Stripe price ID (price_xxx)"),
});

const CreatePriceSchema = z.object({
  product: z.string().describe("Product ID (prod_xxx) to attach price to — required"),
  unit_amount: z.number().int().nonnegative().describe("Price amount in smallest currency unit (e.g., 1000 = $10.00) — required"),
  currency: z.string().length(3).describe("3-letter ISO currency code (e.g., 'usd') — required"),
  recurring_interval: z.enum(["day", "week", "month", "year"]).optional().describe("Billing interval for recurring price (omit for one-time)"),
  recurring_interval_count: z.number().int().positive().optional().default(1).describe("Number of intervals between billings (default: 1)"),
  nickname: z.string().optional().describe("A brief description of the price for display"),
  active: z.boolean().optional().default(true).describe("Whether price is available for purchase (default: true)"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
});

const UpdatePriceSchema = z.object({
  price_id: z.string().describe("Stripe price ID (price_xxx) to update"),
  active: z.boolean().optional().describe("Whether the price is available for purchase"),
  nickname: z.string().optional().describe("A brief description of the price for display"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata (replaces existing metadata)"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_prices",
      title: "List Prices",
      description:
        "List Stripe prices with optional filters by product, type (one_time or recurring), currency, and active status. Returns price ID, amount, currency, and billing interval for recurring prices. Use to find price IDs for creating subscriptions.",
      inputSchema: {
        type: "object",
        properties: {
          product: { type: "string", description: "Filter by product ID (prod_xxx)" },
          active: { type: "boolean", description: "Filter by active status" },
          type: { type: "string", enum: ["one_time", "recurring"], description: "Filter by price type" },
          currency: { type: "string", description: "Filter by 3-letter currency code (e.g., 'usd')" },
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
      name: "get_price",
      title: "Get Price",
      description:
        "Get full details for a Stripe price by ID (price_xxx). Returns amount, currency, billing interval (for recurring), and active status.",
      inputSchema: {
        type: "object",
        properties: {
          price_id: { type: "string", description: "Stripe price ID (price_xxx)" },
        },
        required: ["price_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          product: { type: "string" },
          unit_amount: { type: "number" },
          currency: { type: "string" },
          type: { type: "string" },
          active: { type: "boolean" },
          recurring: { type: "object" },
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
      name: "create_price",
      title: "Create Price",
      description:
        "Create a new Stripe price for an existing product. Requires product ID, unit_amount in smallest currency unit, and currency. Set recurring_interval (day/week/month/year) for subscription prices. For one-time prices, omit recurring_interval.",
      inputSchema: {
        type: "object",
        properties: {
          product: { type: "string", description: "Product ID (prod_xxx) to attach price to — required" },
          unit_amount: { type: "number", description: "Price in smallest currency unit (1000 = $10.00) — required" },
          currency: { type: "string", description: "3-letter ISO currency code (e.g., 'usd') — required" },
          recurring_interval: { type: "string", enum: ["day", "week", "month", "year"], description: "Billing interval (omit for one-time)" },
          recurring_interval_count: { type: "number", description: "Intervals between billings (default: 1)" },
          nickname: { type: "string", description: "Brief description for display" },
          active: { type: "boolean", description: "Whether available for purchase (default: true)" },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["product", "unit_amount", "currency"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          product: { type: "string" },
          unit_amount: { type: "number" },
          currency: { type: "string" },
          type: { type: "string" },
          active: { type: "boolean" },
        },
        required: ["id"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    {
      name: "update_price",
      title: "Update Price",
      description:
        "Update a Stripe price. Only limited fields can be updated after creation: active status, nickname, and metadata. To change amount or currency, create a new price and archive the old one.",
      inputSchema: {
        type: "object",
        properties: {
          price_id: { type: "string", description: "Stripe price ID (price_xxx) to update" },
          active: { type: "boolean", description: "Whether the price is available for purchase" },
          nickname: { type: "string", description: "Brief description for display" },
          metadata: { type: "object", description: "Key-value metadata (replaces existing)" },
        },
        required: ["price_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          active: { type: "boolean" },
          nickname: { type: "string" },
        },
        required: ["id"],
      },
      annotations: {
        readOnlyHint: false,
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
    list_prices: async (args) => {
      const params = ListPricesSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.product) queryParams.product = params.product;
      if (params.active !== undefined) queryParams.active = params.active;
      if (params.type) queryParams.type = params.type;
      if (params.currency) queryParams.currency = params.currency;
      if (params.starting_after) queryParams.starting_after = params.starting_after;

      const result = await logger.time("tool.list_prices", () =>
        client.list<StripePrice>("/prices", queryParams)
      , { tool: "list_prices" });

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

    get_price: async (args) => {
      const { price_id } = GetPriceSchema.parse(args);

      const price = await logger.time("tool.get_price", () =>
        client.get<StripePrice>(`/prices/${price_id}`)
      , { tool: "get_price", price_id });

      return {
        content: [{ type: "text", text: JSON.stringify(price, null, 2) }],
        structuredContent: price,
      };
    },

    create_price: async (args) => {
      const params = CreatePriceSchema.parse(args);

      const body: Record<string, string | number | boolean | undefined | null> = {
        product: params.product,
        unit_amount: params.unit_amount,
        currency: params.currency,
        active: params.active ?? true,
      };

      if (params.recurring_interval) {
        body["recurring[interval]"] = params.recurring_interval;
        body["recurring[interval_count]"] = params.recurring_interval_count ?? 1;
      }
      if (params.nickname) body.nickname = params.nickname;

      // Handle metadata with form-encoded nested keys
      if (params.metadata) {
        for (const [k, v] of Object.entries(params.metadata)) {
          body[`metadata[${k}]`] = v;
        }
      }

      const price = await logger.time("tool.create_price", () =>
        client.post<StripePrice>("/prices", body)
      , { tool: "create_price" });

      return {
        content: [{ type: "text", text: JSON.stringify(price, null, 2) }],
        structuredContent: price,
      };
    },

    update_price: async (args) => {
      const params = UpdatePriceSchema.parse(args);
      const { price_id, ...fields } = params;

      const body: Record<string, string | number | boolean | undefined | null> = {};
      if (fields.active !== undefined) body.active = fields.active;
      if (fields.nickname !== undefined) body.nickname = fields.nickname;
      if (fields.metadata) {
        for (const [k, v] of Object.entries(fields.metadata)) {
          body[`metadata[${k}]`] = v;
        }
      }

      const price = await logger.time("tool.update_price", () =>
        client.post<StripePrice>(`/prices/${price_id}`, body)
      , { tool: "update_price", price_id });

      return {
        content: [{ type: "text", text: JSON.stringify(price, null, 2) }],
        structuredContent: price,
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
