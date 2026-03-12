// Subscriptions tools — Stripe API v1
// Covers: list_subscriptions, get_subscription, create_subscription, cancel_subscription

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeSubscription } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListSubscriptionsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  customer: z.string().optional().describe("Filter by customer ID (cus_xxx)"),
  status: z.enum(["active", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "trialing", "paused", "all"]).optional().describe("Filter by subscription status (default: all active)"),
  price: z.string().optional().describe("Filter by price ID (price_xxx)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
});

const GetSubscriptionSchema = z.object({
  subscription_id: z.string().describe("Stripe subscription ID (sub_xxx)"),
});

const CreateSubscriptionSchema = z.object({
  customer: z.string().describe("Customer ID (cus_xxx) — required"),
  price: z.string().describe("Price ID (price_xxx) to subscribe to — required"),
  quantity: z.number().int().positive().optional().default(1).describe("Quantity for the price (default: 1)"),
  trial_period_days: z.number().int().positive().optional().describe("Trial period in days before first charge"),
  cancel_at_period_end: z.boolean().optional().default(false).describe("Cancel at end of billing period instead of immediately (default: false)"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
  payment_behavior: z.enum(["allow_incomplete", "default_incomplete", "error_if_incomplete", "pending_if_incomplete"]).optional().describe("Payment failure behavior (default: default_incomplete)"),
});

const CancelSubscriptionSchema = z.object({
  subscription_id: z.string().describe("Stripe subscription ID (sub_xxx)"),
  cancel_at_period_end: z.boolean().optional().default(false).describe("Cancel at end of billing period (false=immediate, true=period end). Default: false"),
  cancellation_details_comment: z.string().optional().describe("Optional cancellation reason/comment"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_subscriptions",
      title: "List Subscriptions",
      description:
        "List Stripe subscriptions with optional filters by customer and status. Returns subscription ID, status, current period dates, and items. Uses keyset pagination — pass meta.lastId as starting_after for the next page. Status: active, past_due, canceled, trialing, paused, all.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          customer: { type: "string", description: "Filter by customer ID (cus_xxx)" },
          status: { type: "string", enum: ["active", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "trialing", "paused", "all"], description: "Filter by status" },
          price: { type: "string", description: "Filter by price ID (price_xxx)" },
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
      name: "get_subscription",
      title: "Get Subscription",
      description:
        "Get full details for a Stripe subscription by ID (sub_xxx). Returns status, billing period, line items with prices, and customer. Use when checking subscription status or billing details.",
      inputSchema: {
        type: "object",
        properties: {
          subscription_id: { type: "string", description: "Stripe subscription ID (sub_xxx)" },
        },
        required: ["subscription_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          customer: { type: "string" },
          status: { type: "string" },
          current_period_start: { type: "number" },
          current_period_end: { type: "number" },
          items: { type: "object" },
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
      name: "create_subscription",
      title: "Create Subscription",
      description:
        "Create a new Stripe subscription for a customer with a price. Requires an existing customer (cus_xxx) and price (price_xxx). Optionally set trial_period_days for a free trial. Returns the subscription with status and first billing date.",
      inputSchema: {
        type: "object",
        properties: {
          customer: { type: "string", description: "Customer ID (cus_xxx) — required" },
          price: { type: "string", description: "Price ID (price_xxx) to subscribe to — required" },
          quantity: { type: "number", description: "Quantity (default: 1)" },
          trial_period_days: { type: "number", description: "Trial period days before first charge" },
          cancel_at_period_end: { type: "boolean", description: "Cancel at period end (default: false)" },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["customer", "price"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          customer: { type: "string" },
          current_period_end: { type: "number" },
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
      name: "cancel_subscription",
      title: "Cancel Subscription",
      description:
        "Cancel a Stripe subscription. By default, cancels immediately (cancel_at_period_end=false). Set cancel_at_period_end=true to cancel at the end of the current billing period instead — the customer retains access until then.",
      inputSchema: {
        type: "object",
        properties: {
          subscription_id: { type: "string", description: "Stripe subscription ID (sub_xxx)" },
          cancel_at_period_end: { type: "boolean", description: "Cancel at period end (false=immediate, true=period end). Default: false" },
          cancellation_details_comment: { type: "string", description: "Optional cancellation reason" },
        },
        required: ["subscription_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          cancel_at_period_end: { type: "boolean" },
          canceled_at: { type: "number" },
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
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_subscriptions: async (args) => {
      const params = ListSubscriptionsSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.customer) queryParams.customer = params.customer;
      if (params.status) queryParams.status = params.status;
      if (params.price) queryParams.price = params.price;
      if (params.starting_after) queryParams.starting_after = params.starting_after;

      const result = await logger.time("tool.list_subscriptions", () =>
        client.list<StripeSubscription>("/subscriptions", queryParams)
      , { tool: "list_subscriptions" });

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

    get_subscription: async (args) => {
      const { subscription_id } = GetSubscriptionSchema.parse(args);

      const subscription = await logger.time("tool.get_subscription", () =>
        client.get<StripeSubscription>(`/subscriptions/${subscription_id}`)
      , { tool: "get_subscription", subscription_id });

      return {
        content: [{ type: "text", text: JSON.stringify(subscription, null, 2) }],
        structuredContent: subscription,
      };
    },

    create_subscription: async (args) => {
      const params = CreateSubscriptionSchema.parse(args);

      const body: Record<string, unknown> = {
        customer: params.customer,
        "items[0][price]": params.price,
        "items[0][quantity]": params.quantity || 1,
      };

      if (params.trial_period_days) body.trial_period_days = params.trial_period_days;
      if (params.cancel_at_period_end !== undefined) body.cancel_at_period_end = params.cancel_at_period_end;
      if (params.metadata) body.metadata = params.metadata;
      if (params.payment_behavior) body.payment_behavior = params.payment_behavior;

      const subscription = await logger.time("tool.create_subscription", () =>
        client.post<StripeSubscription>("/subscriptions", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_subscription" });

      return {
        content: [{ type: "text", text: JSON.stringify(subscription, null, 2) }],
        structuredContent: subscription,
      };
    },

    cancel_subscription: async (args) => {
      const params = CancelSubscriptionSchema.parse(args);

      let subscription: StripeSubscription;

      if (params.cancel_at_period_end) {
        // Update to cancel at period end
        const body: Record<string, unknown> = { cancel_at_period_end: true };
        if (params.cancellation_details_comment) {
          body["cancellation_details[comment]"] = params.cancellation_details_comment;
        }

        subscription = await logger.time("tool.cancel_subscription.period_end", () =>
          client.post<StripeSubscription>(`/subscriptions/${params.subscription_id}`, body as Record<string, string | number | boolean | undefined | null>)
        , { tool: "cancel_subscription", subscription_id: params.subscription_id });
      } else {
        // Cancel immediately
        const body: Record<string, unknown> = {};
        if (params.cancellation_details_comment) {
          body["cancellation_details[comment]"] = params.cancellation_details_comment;
        }

        subscription = await logger.time("tool.cancel_subscription.immediate", () =>
          client.delete<StripeSubscription>(`/subscriptions/${params.subscription_id}`, body as Record<string, string | number | boolean | undefined | null>)
        , { tool: "cancel_subscription", subscription_id: params.subscription_id });
      }

      return {
        content: [{ type: "text", text: JSON.stringify(subscription, null, 2) }],
        structuredContent: subscription,
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
