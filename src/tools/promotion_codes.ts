// Promotion Codes tools — Stripe API v1
// Covers: list_promotion_codes, get_promotion_code, create_promotion_code, update_promotion_code

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListPromotionCodesSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  active: z.boolean().optional().describe("Filter by active status"),
  code: z.string().optional().describe("Filter by exact promotion code string (case-insensitive)"),
  coupon: z.string().optional().describe("Filter by coupon ID (the underlying coupon)"),
  customer: z.string().optional().describe("Filter by customer ID — returns codes restricted to that customer"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — for reversed pagination"),
});

const GetPromotionCodeSchema = z.object({
  promotion_code_id: z.string().describe("Stripe promotion code ID (promo_xxx)"),
});

const CreatePromotionCodeSchema = z.object({
  coupon: z.string().describe("Coupon ID (the discount to apply when this code is used) — required"),
  code: z.string().optional().describe("The code string customers enter (e.g. 'SUMMER20') — auto-generated if omitted"),
  active: z.boolean().optional().default(true).describe("Whether this promotion code is active (default: true)"),
  customer: z.string().optional().describe("Restrict this code to a specific customer ID (cus_xxx)"),
  expires_at: z.number().int().positive().optional().describe("Unix timestamp when this code expires"),
  max_redemptions: z.number().int().positive().optional().describe("Maximum number of times this code can be redeemed in total"),
  restrictions: z.object({
    first_time_transaction: z.boolean().optional().describe("Limit to customers who have never purchased before"),
    minimum_amount: z.number().int().positive().optional().describe("Minimum order amount (in smallest currency unit) required to use this code"),
    minimum_amount_currency: z.string().length(3).optional().describe("Currency for minimum_amount (e.g. 'usd')"),
  }).optional().describe("Restrictions on when this promotion code can be used"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
});

const UpdatePromotionCodeSchema = z.object({
  promotion_code_id: z.string().describe("Stripe promotion code ID (promo_xxx)"),
  active: z.boolean().optional().describe("Activate or deactivate this promotion code"),
  restrictions: z.object({
    currency_options: z.record(z.object({
      minimum_amount: z.number().int().optional().describe("Minimum amount in this currency"),
    })).optional().describe("Per-currency minimum amount restrictions"),
  }).optional().describe("Update restrictions"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata (merges with existing)"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_promotion_codes",
      title: "List Promotion Codes",
      description:
        "List Stripe promotion codes — customer-facing discount codes that apply underlying coupons. Filter by active status, code string, coupon, or customer restriction. Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          active: { type: "boolean", description: "Filter by active status" },
          code: { type: "string", description: "Filter by exact code string (e.g. 'SUMMER20')" },
          coupon: { type: "string", description: "Filter by underlying coupon ID" },
          customer: { type: "string", description: "Filter by customer-restricted codes (cus_xxx)" },
          created_gte: { type: "number", description: "Filter by creation time (Unix timestamp, >=)" },
          created_lte: { type: "number", description: "Filter by creation time (Unix timestamp, <=)" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_promotion_code",
      title: "Get Promotion Code",
      description:
        "Get full details for a Stripe promotion code by ID (promo_xxx). Returns the code string, underlying coupon, active status, restrictions, usage count, and expiry.",
      inputSchema: {
        type: "object",
        properties: {
          promotion_code_id: { type: "string", description: "Stripe promotion code ID (promo_xxx)" },
        },
        required: ["promotion_code_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_promotion_code",
      title: "Create Promotion Code",
      description:
        "Create a Stripe promotion code for an existing coupon. The code is the customer-facing string (e.g. 'SUMMER20'). Optionally restrict to a specific customer, set an expiry date, limit total redemptions, or require a minimum order amount.",
      inputSchema: {
        type: "object",
        properties: {
          coupon: { type: "string", description: "Underlying coupon ID — required" },
          code: { type: "string", description: "Code string customers enter (e.g. 'SUMMER20') — auto-generated if omitted" },
          active: { type: "boolean", description: "Active status (default: true)" },
          customer: { type: "string", description: "Restrict to a specific customer (cus_xxx)" },
          expires_at: { type: "number", description: "Expiry Unix timestamp" },
          max_redemptions: { type: "number", description: "Max total redemptions" },
          restrictions: {
            type: "object",
            description: "Usage restrictions: first_time_transaction, minimum_amount, minimum_amount_currency",
          },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["coupon"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_promotion_code",
      title: "Update Promotion Code",
      description:
        "Update a Stripe promotion code — activate/deactivate it or update metadata. Note: code string, coupon, customer restriction, expires_at, and max_redemptions cannot be changed after creation.",
      inputSchema: {
        type: "object",
        properties: {
          promotion_code_id: { type: "string", description: "Stripe promotion code ID (promo_xxx)" },
          active: { type: "boolean", description: "Activate (true) or deactivate (false)" },
          restrictions: { type: "object", description: "Updated currency restrictions" },
          metadata: { type: "object", description: "Key-value metadata (merges with existing)" },
        },
        required: ["promotion_code_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_promotion_codes: async (args) => {
      const params = ListPromotionCodesSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.active !== undefined) queryParams.active = params.active;
      if (params.code) queryParams.code = params.code;
      if (params.coupon) queryParams.coupon = params.coupon;
      if (params.customer) queryParams.customer = params.customer;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_promotion_codes", () =>
        client.list<Record<string, unknown>>("/promotion_codes", queryParams)
      , { tool: "list_promotion_codes" });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_promotion_code: async (args) => {
      const { promotion_code_id } = GetPromotionCodeSchema.parse(args);
      const promoCode = await logger.time("tool.get_promotion_code", () =>
        client.get<Record<string, unknown>>(`/promotion_codes/${promotion_code_id}`)
      , { tool: "get_promotion_code", promotion_code_id });
      return { content: [{ type: "text", text: JSON.stringify(promoCode, null, 2) }], structuredContent: promoCode };
    },

    create_promotion_code: async (args) => {
      const params = CreatePromotionCodeSchema.parse(args);
      const body: Record<string, unknown> = { coupon: params.coupon };

      if (params.code) body.code = params.code;
      if (params.active !== undefined) body.active = params.active;
      if (params.customer) body.customer = params.customer;
      if (params.expires_at) body.expires_at = params.expires_at;
      if (params.max_redemptions) body.max_redemptions = params.max_redemptions;
      if (params.metadata) body.metadata = params.metadata;
      if (params.restrictions) {
        if (params.restrictions.first_time_transaction !== undefined) {
          body["restrictions[first_time_transaction]"] = params.restrictions.first_time_transaction;
        }
        if (params.restrictions.minimum_amount !== undefined) {
          body["restrictions[minimum_amount]"] = params.restrictions.minimum_amount;
        }
        if (params.restrictions.minimum_amount_currency) {
          body["restrictions[minimum_amount_currency]"] = params.restrictions.minimum_amount_currency;
        }
      }

      const promoCode = await logger.time("tool.create_promotion_code", () =>
        client.post<Record<string, unknown>>("/promotion_codes", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_promotion_code" });
      return { content: [{ type: "text", text: JSON.stringify(promoCode, null, 2) }], structuredContent: promoCode };
    },

    update_promotion_code: async (args) => {
      const params = UpdatePromotionCodeSchema.parse(args);
      const { promotion_code_id, active, metadata, restrictions } = params;
      const body: Record<string, unknown> = {};

      if (active !== undefined) body.active = active;
      if (metadata) body.metadata = metadata;
      if (restrictions?.currency_options) {
        for (const [currency, opts] of Object.entries(restrictions.currency_options)) {
          if (opts.minimum_amount !== undefined) {
            body[`restrictions[currency_options][${currency}][minimum_amount]`] = opts.minimum_amount;
          }
        }
      }

      const promoCode = await logger.time("tool.update_promotion_code", () =>
        client.post<Record<string, unknown>>(`/promotion_codes/${promotion_code_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_promotion_code", promotion_code_id });
      return { content: [{ type: "text", text: JSON.stringify(promoCode, null, 2) }], structuredContent: promoCode };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
