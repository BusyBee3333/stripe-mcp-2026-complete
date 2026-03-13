// Coupons tools — Stripe API v1
// Covers: list_coupons, create_coupon, get_coupon, delete_coupon

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeCoupon } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListCouponsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
});

const CreateCouponSchema = z.object({
  id: z.string().optional().describe("Custom coupon code (auto-generated if omitted)"),
  name: z.string().optional().describe("Display name shown to customers"),
  percent_off: z.number().min(0.01).max(100).optional().describe("Percentage discount (0.01–100). Provide either percent_off OR amount_off+currency."),
  amount_off: z.number().int().positive().optional().describe("Fixed discount in smallest currency unit. Requires currency."),
  currency: z.string().length(3).optional().describe("3-letter currency code for amount_off (e.g., 'usd')"),
  duration: z.enum(["forever", "once", "repeating"]).describe("How long the discount applies: forever, once, or repeating (requires duration_in_months)"),
  duration_in_months: z.number().int().positive().optional().describe("Number of months for 'repeating' duration"),
  max_redemptions: z.number().int().positive().optional().describe("Maximum number of times coupon can be redeemed"),
  redeem_by: z.number().int().positive().optional().describe("Unix timestamp after which coupon can no longer be redeemed"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
});

const GetCouponSchema = z.object({
  coupon_id: z.string().describe("Stripe coupon ID"),
});

const DeleteCouponSchema = z.object({
  coupon_id: z.string().describe("Stripe coupon ID to delete — this is irreversible"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_coupons",
      title: "List Coupons",
      description:
        "List all Stripe coupons. Returns coupon ID, discount percentage or amount, duration, and redemption details. Uses keyset pagination — pass meta.lastId as starting_after for the next page.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
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
      name: "create_coupon",
      title: "Create Coupon",
      description:
        "Create a Stripe coupon for discounts. Choose between percent_off (0.01–100%) or amount_off (fixed amount + currency). Set duration: 'forever' (always), 'once' (first payment), or 'repeating' (with duration_in_months). Optionally set max_redemptions and redeem_by expiry.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Custom coupon code (auto-generated if omitted)" },
          name: { type: "string", description: "Display name shown to customers" },
          percent_off: { type: "number", description: "Percentage discount (0.01–100)" },
          amount_off: { type: "number", description: "Fixed discount in smallest currency unit (requires currency)" },
          currency: { type: "string", description: "3-letter currency code for amount_off" },
          duration: { type: "string", enum: ["forever", "once", "repeating"], description: "How long discount applies" },
          duration_in_months: { type: "number", description: "Months for 'repeating' duration" },
          max_redemptions: { type: "number", description: "Maximum redemptions allowed" },
          redeem_by: { type: "number", description: "Expiry timestamp (Unix)" },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["duration"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          percent_off: { type: "number" },
          amount_off: { type: "number" },
          currency: { type: "string" },
          duration: { type: "string" },
          valid: { type: "boolean" },
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
      name: "get_coupon",
      title: "Get Coupon",
      description:
        "Get full details for a Stripe coupon by ID. Returns discount type (percent/amount), duration, redemption count, and validity status.",
      inputSchema: {
        type: "object",
        properties: {
          coupon_id: { type: "string", description: "Stripe coupon ID" },
        },
        required: ["coupon_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          percent_off: { type: "number" },
          amount_off: { type: "number" },
          duration: { type: "string" },
          valid: { type: "boolean" },
          times_redeemed: { type: "number" },
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
      name: "delete_coupon",
      title: "Delete Coupon",
      description:
        "Permanently delete a Stripe coupon. This is irreversible. Existing discounts using the coupon will remain active until they expire or are removed from the customer/subscription.",
      inputSchema: {
        type: "object",
        properties: {
          coupon_id: { type: "string", description: "Stripe coupon ID to delete" },
        },
        required: ["coupon_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          deleted: { type: "boolean" },
        },
        required: ["id", "deleted"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_coupons: async (args) => {
      const params = ListCouponsSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_coupons", () =>
        client.list<StripeCoupon>("/coupons", queryParams)
      , { tool: "list_coupons" });

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

    create_coupon: async (args) => {
      const params = CreateCouponSchema.parse(args);

      const body: Record<string, string | number | boolean | undefined | null> = {
        duration: params.duration,
      };
      if (params.id) body.id = params.id;
      if (params.name) body.name = params.name;
      if (params.percent_off !== undefined) body.percent_off = params.percent_off;
      if (params.amount_off !== undefined) body.amount_off = params.amount_off;
      if (params.currency) body.currency = params.currency;
      if (params.duration_in_months) body.duration_in_months = params.duration_in_months;
      if (params.max_redemptions) body.max_redemptions = params.max_redemptions;
      if (params.redeem_by) body.redeem_by = params.redeem_by;
      if (params.metadata) {
        for (const [k, v] of Object.entries(params.metadata)) {
          body[`metadata[${k}]`] = v;
        }
      }

      const coupon = await logger.time("tool.create_coupon", () =>
        client.post<StripeCoupon>("/coupons", body)
      , { tool: "create_coupon" });

      return {
        content: [{ type: "text", text: JSON.stringify(coupon, null, 2) }],
        structuredContent: coupon,
      };
    },

    get_coupon: async (args) => {
      const { coupon_id } = GetCouponSchema.parse(args);

      const coupon = await logger.time("tool.get_coupon", () =>
        client.get<StripeCoupon>(`/coupons/${coupon_id}`)
      , { tool: "get_coupon", coupon_id });

      return {
        content: [{ type: "text", text: JSON.stringify(coupon, null, 2) }],
        structuredContent: coupon,
      };
    },

    delete_coupon: async (args) => {
      const { coupon_id } = DeleteCouponSchema.parse(args);

      const result = await logger.time("tool.delete_coupon", () =>
        client.delete<{ id: string; deleted: boolean }>(`/coupons/${coupon_id}`)
      , { tool: "delete_coupon", coupon_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
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
