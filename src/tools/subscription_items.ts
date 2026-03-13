// Subscription Items tools — Stripe API v1
// Covers: list_subscription_items, get_subscription_item, create_subscription_item,
//         update_subscription_item, delete_subscription_item,
//         list_subscription_item_usage_records, create_usage_record

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListSubscriptionItemsSchema = z.object({
  subscription: z.string().describe("Subscription ID (sub_xxx) to list items for"),
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetSubscriptionItemSchema = z.object({
  item_id: z.string().describe("Subscription item ID (si_xxx)"),
});

const CreateSubscriptionItemSchema = z.object({
  subscription: z.string().describe("Subscription ID (sub_xxx) to add this item to"),
  price: z.string().describe("Price ID (price_xxx) to add to the subscription"),
  quantity: z.number().int().positive().optional().describe("Quantity (for per-seat pricing). Required for metered prices: omit quantity."),
  proration_behavior: z.enum(["create_prorations", "none", "always_invoice"]).optional().default("create_prorations").describe("How to handle proration when adding mid-cycle"),
  proration_date: z.number().optional().describe("Unix timestamp to use as the proration date (defaults to now)"),
  metadata: z.record(z.string()).optional(),
  payment_behavior: z.enum(["allow_incomplete", "default_incomplete", "error_if_incomplete", "pending_if_incomplete"]).optional(),
});

const UpdateSubscriptionItemSchema = z.object({
  item_id: z.string().describe("Subscription item ID (si_xxx)"),
  price: z.string().optional().describe("New price ID to switch this item to"),
  quantity: z.number().int().positive().optional().describe("New quantity"),
  proration_behavior: z.enum(["create_prorations", "none", "always_invoice"]).optional(),
  proration_date: z.number().optional(),
  metadata: z.record(z.string()).optional(),
  payment_behavior: z.enum(["allow_incomplete", "default_incomplete", "error_if_incomplete", "pending_if_incomplete"]).optional(),
});

const DeleteSubscriptionItemSchema = z.object({
  item_id: z.string().describe("Subscription item ID (si_xxx) to remove"),
  proration_behavior: z.enum(["create_prorations", "none", "always_invoice"]).optional().default("create_prorations"),
  clear_usage: z.boolean().optional().describe("If set, clear all usage records for this metered item before deleting"),
});

const ListUsageRecordSummariesSchema = z.object({
  item_id: z.string().describe("Subscription item ID (si_xxx) — must be a metered price"),
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const CreateUsageRecordSchema = z.object({
  item_id: z.string().describe("Subscription item ID (si_xxx) — must be a metered price"),
  quantity: z.number().int().min(0).describe("Usage quantity to report"),
  timestamp: z.number().optional().describe("Unix timestamp for when this usage occurred (defaults to now). Must be within the current billing period."),
  action: z.enum(["increment", "set"]).optional().default("increment").describe("increment: add to existing usage. set: replace the current usage total."),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_subscription_items",
      title: "List Subscription Items",
      description:
        "List all items in a Stripe subscription. Each item corresponds to one price/plan. Returns item ID, price, quantity, and metadata. Use this to inspect what a customer is subscribed to.",
      inputSchema: {
        type: "object",
        properties: {
          subscription: { type: "string", description: "Subscription ID (sub_xxx)" },
          limit: { type: "number" },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
        required: ["subscription"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_subscription_item",
      title: "Get Subscription Item",
      description: "Retrieve a specific subscription item by ID (si_xxx). Returns price details, quantity, and associated subscription.",
      inputSchema: {
        type: "object",
        properties: { item_id: { type: "string", description: "Subscription item ID (si_xxx)" } },
        required: ["item_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_subscription_item",
      title: "Create Subscription Item",
      description:
        "Add a new item (price/product) to an existing subscription. Triggers proration by default — a partial charge or credit is applied for the remainder of the billing period. Use proration_behavior='none' to avoid prorations.",
      inputSchema: {
        type: "object",
        properties: {
          subscription: { type: "string", description: "Subscription ID (sub_xxx)" },
          price: { type: "string", description: "Price ID (price_xxx) to add" },
          quantity: { type: "number", description: "Quantity (omit for metered prices)" },
          proration_behavior: { type: "string", enum: ["create_prorations", "none", "always_invoice"] },
          proration_date: { type: "number", description: "Proration cutoff timestamp" },
          metadata: { type: "object" },
          payment_behavior: { type: "string", enum: ["allow_incomplete", "default_incomplete", "error_if_incomplete", "pending_if_incomplete"] },
        },
        required: ["subscription", "price"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_subscription_item",
      title: "Update Subscription Item",
      description:
        "Update a subscription item. Use to change the price (upgrade/downgrade) or quantity. Changes take effect immediately with prorations (unless proration_behavior='none').",
      inputSchema: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "Subscription item ID (si_xxx)" },
          price: { type: "string", description: "New price ID to switch to" },
          quantity: { type: "number", description: "New quantity" },
          proration_behavior: { type: "string", enum: ["create_prorations", "none", "always_invoice"] },
          proration_date: { type: "number" },
          metadata: { type: "object" },
          payment_behavior: { type: "string", enum: ["allow_incomplete", "default_incomplete", "error_if_incomplete", "pending_if_incomplete"] },
        },
        required: ["item_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "delete_subscription_item",
      title: "Delete Subscription Item",
      description:
        "Remove an item from a subscription. Creates a proration credit by default. If the subscription has only one item, the subscription is canceled instead. Use clear_usage=true to also clear metered usage records.",
      inputSchema: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "Subscription item ID (si_xxx)" },
          proration_behavior: { type: "string", enum: ["create_prorations", "none", "always_invoice"] },
          clear_usage: { type: "boolean", description: "Clear metered usage records before deleting" },
        },
        required: ["item_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "list_usage_record_summaries",
      title: "List Usage Record Summaries",
      description:
        "List aggregated usage record summaries for a metered subscription item. Returns total_usage per billing period. Use to review reported usage before invoicing.",
      inputSchema: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "Subscription item ID (si_xxx) — must be metered" },
          limit: { type: "number" },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
        required: ["item_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_usage_record",
      title: "Create Usage Record",
      description:
        "Report metered usage for a subscription item. Use action='increment' to add to existing usage or 'set' to replace. Must be called for each billing period. Usage is used to generate the invoice amount for metered pricing.",
      inputSchema: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "Subscription item ID (si_xxx) — must be metered" },
          quantity: { type: "number", description: "Usage quantity to report" },
          timestamp: { type: "number", description: "Unix timestamp for this usage (defaults to now)" },
          action: { type: "string", enum: ["increment", "set"] },
        },
        required: ["item_id", "quantity"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_subscription_items: async (args) => {
      const params = ListSubscriptionItemsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
        subscription: params.subscription,
      };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_subscription_items", () =>
        client.list<Record<string, unknown>>("/subscription_items", q)
      , { tool: "list_subscription_items" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_subscription_item: async (args) => {
      const { item_id } = GetSubscriptionItemSchema.parse(args);
      const r = await logger.time("tool.get_subscription_item", () =>
        client.get<Record<string, unknown>>(`/subscription_items/${item_id}`)
      , { tool: "get_subscription_item" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_subscription_item: async (args) => {
      const params = CreateSubscriptionItemSchema.parse(args);
      const body: Record<string, unknown> = {
        subscription: params.subscription,
        price: params.price,
      };
      if (params.quantity !== undefined) body.quantity = params.quantity;
      if (params.proration_behavior) body.proration_behavior = params.proration_behavior;
      if (params.proration_date !== undefined) body.proration_date = params.proration_date;
      if (params.payment_behavior) body.payment_behavior = params.payment_behavior;
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.create_subscription_item", () =>
        client.post<Record<string, unknown>>("/subscription_items", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_subscription_item" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    update_subscription_item: async (args) => {
      const { item_id, ...rest } = UpdateSubscriptionItemSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (rest.price) body.price = rest.price;
      if (rest.quantity !== undefined) body.quantity = rest.quantity;
      if (rest.proration_behavior) body.proration_behavior = rest.proration_behavior;
      if (rest.proration_date !== undefined) body.proration_date = rest.proration_date;
      if (rest.payment_behavior) body.payment_behavior = rest.payment_behavior;
      if (rest.metadata) body.metadata = rest.metadata;

      const r = await logger.time("tool.update_subscription_item", () =>
        client.post<Record<string, unknown>>(`/subscription_items/${item_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_subscription_item" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    delete_subscription_item: async (args) => {
      const params = DeleteSubscriptionItemSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (params.proration_behavior) body.proration_behavior = params.proration_behavior;
      if (params.clear_usage !== undefined) body.clear_usage = params.clear_usage;

      const r = await logger.time("tool.delete_subscription_item", () =>
        client.delete<Record<string, unknown>>(`/subscription_items/${params.item_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "delete_subscription_item" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_usage_record_summaries: async (args) => {
      const params = ListUsageRecordSummariesSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_usage_record_summaries", () =>
        client.list<Record<string, unknown>>(`/subscription_items/${params.item_id}/usage_record_summaries`, q)
      , { tool: "list_usage_record_summaries" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    create_usage_record: async (args) => {
      const params = CreateUsageRecordSchema.parse(args);
      const body: Record<string, unknown> = { quantity: params.quantity };
      if (params.timestamp !== undefined) body.timestamp = params.timestamp;
      if (params.action) body.action = params.action;

      const r = await logger.time("tool.create_usage_record", () =>
        client.post<Record<string, unknown>>(`/subscription_items/${params.item_id}/usage_records`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_usage_record" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
