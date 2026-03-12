// Products and Prices tools — Stripe API v1
// Covers: list_products, get_product, create_product, list_prices

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeProduct, StripePrice } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListProductsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  active: z.boolean().optional().describe("Filter by active status (omit for all)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
});

const GetProductSchema = z.object({
  product_id: z.string().describe("Stripe product ID (prod_xxx)"),
});

const CreateProductSchema = z.object({
  name: z.string().describe("Product name (required)"),
  description: z.string().optional().describe("Product description"),
  active: z.boolean().optional().default(true).describe("Whether product is active (default: true)"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
  // Create an attached price at the same time
  price_unit_amount: z.number().int().positive().optional().describe("Price amount in smallest currency unit (e.g., 1000 = $10.00). If set, creates an attached price."),
  price_currency: z.string().length(3).optional().describe("Price currency code (e.g., 'usd'). Required if price_unit_amount is set."),
  price_recurring_interval: z.enum(["day", "week", "month", "year"]).optional().describe("Billing interval for recurring price. Omit for one-time price."),
  price_recurring_interval_count: z.number().int().positive().optional().default(1).describe("Number of intervals between billings (default: 1)"),
});

const ListPricesSchema = z.object({
  product: z.string().optional().describe("Filter by product ID (prod_xxx)"),
  active: z.boolean().optional().describe("Filter by active status"),
  type: z.enum(["one_time", "recurring"]).optional().describe("Filter by price type"),
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_products",
      title: "List Products",
      description:
        "List Stripe products with optional active filter. Returns product ID, name, description, and active status. Uses keyset pagination — pass meta.lastId as starting_after for the next page.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          active: { type: "boolean", description: "Filter by active status (omit for all)" },
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
      name: "get_product",
      title: "Get Product",
      description:
        "Get full details for a Stripe product by ID (prod_xxx). Returns name, description, active status, and metadata. Use get_prices with product=prod_xxx to see associated prices.",
      inputSchema: {
        type: "object",
        properties: {
          product_id: { type: "string", description: "Stripe product ID (prod_xxx)" },
        },
        required: ["product_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          active: { type: "boolean" },
          description: { type: "string" },
          livemode: { type: "boolean" },
        },
        required: ["id", "name"],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "create_product",
      title: "Create Product",
      description:
        "Create a new Stripe product, optionally with an attached price. Provide price_unit_amount and price_currency to create a price simultaneously. For recurring prices, also set price_recurring_interval. Returns created product and price if created.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Product name (required)" },
          description: { type: "string", description: "Product description" },
          active: { type: "boolean", description: "Whether product is active (default: true)" },
          metadata: { type: "object", description: "Key-value metadata" },
          price_unit_amount: { type: "number", description: "Price in smallest currency unit (1000 = $10.00)" },
          price_currency: { type: "string", description: "Price currency code (e.g., 'usd')" },
          price_recurring_interval: { type: "string", enum: ["day", "week", "month", "year"], description: "Billing interval (omit for one-time price)" },
          price_recurring_interval_count: { type: "number", description: "Interval count (default: 1)" },
        },
        required: ["name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          product: { type: "object" },
          price: { type: "object" },
        },
        required: ["product"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    {
      name: "list_prices",
      title: "List Prices",
      description:
        "List Stripe prices with optional filters by product, type (one_time or recurring), and active status. Returns price ID, amount, currency, and billing interval for recurring prices. Use to find price IDs for creating subscriptions.",
      inputSchema: {
        type: "object",
        properties: {
          product: { type: "string", description: "Filter by product ID (prod_xxx)" },
          active: { type: "boolean", description: "Filter by active status" },
          type: { type: "string", enum: ["one_time", "recurring"], description: "Filter by price type" },
          limit: { type: "number", description: "Number of results (default 20)" },
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
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_products: async (args) => {
      const params = ListProductsSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.active !== undefined) queryParams.active = params.active;
      if (params.starting_after) queryParams.starting_after = params.starting_after;

      const result = await logger.time("tool.list_products", () =>
        client.list<StripeProduct>("/products", queryParams)
      , { tool: "list_products" });

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

    get_product: async (args) => {
      const { product_id } = GetProductSchema.parse(args);

      const product = await logger.time("tool.get_product", () =>
        client.get<StripeProduct>(`/products/${product_id}`)
      , { tool: "get_product", product_id });

      return {
        content: [{ type: "text", text: JSON.stringify(product, null, 2) }],
        structuredContent: product,
      };
    },

    create_product: async (args) => {
      const params = CreateProductSchema.parse(args);

      // Create the product
      const productBody: Record<string, unknown> = {
        name: params.name,
        active: params.active ?? true,
      };
      if (params.description) productBody.description = params.description;
      if (params.metadata) productBody.metadata = params.metadata;

      const product = await logger.time("tool.create_product", () =>
        client.post<StripeProduct>("/products", productBody as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_product" });

      // Optionally create an attached price
      let price: StripePrice | undefined;
      if (params.price_unit_amount && params.price_currency) {
        const priceBody: Record<string, unknown> = {
          product: product.id,
          unit_amount: params.price_unit_amount,
          currency: params.price_currency,
        };

        if (params.price_recurring_interval) {
          priceBody.recurring = {
            interval: params.price_recurring_interval,
            interval_count: params.price_recurring_interval_count || 1,
          };
        }

        try {
          price = await logger.time("tool.create_product.price", () =>
            client.post<StripePrice>("/prices", priceBody as Record<string, string | number | boolean | undefined | null>)
          , { tool: "create_product.price", product_id: product.id });
        } catch (e) {
          logger.warn("tool.create_product.price_failed", { error: e instanceof Error ? e.message : String(e) });
        }
      }

      const result = { product, ...(price ? { price } : {}) };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_prices: async (args) => {
      const params = ListPricesSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.product) queryParams.product = params.product;
      if (params.active !== undefined) queryParams.active = params.active;
      if (params.type) queryParams.type = params.type;
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
  };
}

export function getTools(client: StripeClient) {
  return {
    tools: getToolDefinitions(),
    handlers: getToolHandlers(client),
  };
}
