// Subscriptions tools — Stripe API v1
// Covers: list_subscriptions, get_subscription, create_subscription, cancel_subscription, pause_subscription, update_subscription

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeSubscription } from "../types.js";
import { logger } from "../logger.js";

// === NEW Zod Schemas (expansion — subscription items) ===
const ListSubscriptionItemsSchema = z.object({
  subscription: z.string().describe("Subscription ID (sub_xxx) — required. Returns all items on this subscription."),
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — for reversed pagination"),
});

const AddSubscriptionItemSchema = z.object({
  subscription: z.string().describe("Subscription ID (sub_xxx) to add the item to — required"),
  price: z.string().describe("Price ID (price_xxx) for the new item — required"),
  quantity: z.number().int().positive().optional().default(1).describe("Quantity for this item (default: 1). Set to 0 for metered prices."),
  proration_behavior: z.enum(["create_prorations", "none", "always_invoice"]).optional().describe("How to handle proration for the added item (default: create_prorations)"),
  proration_date: z.number().int().positive().optional().describe("Unix timestamp to use as the proration date (defaults to current time)"),
  payment_behavior: z.enum(["allow_incomplete", "default_incomplete", "error_if_incomplete", "pending_if_incomplete"]).optional().describe("Behavior if the update results in payment failure"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata for this subscription item"),
  tax_rates: z.array(z.string()).optional().describe("Tax rate IDs (txr_xxx) to apply to this item (overrides subscription-level tax rates)"),
});

const UpdateSubscriptionItemSchema = z.object({
  subscription_item_id: z.string().describe("Subscription item ID (si_xxx) to update"),
  price: z.string().optional().describe("New price ID (price_xxx) to switch this item to"),
  quantity: z.number().int().min(0).optional().describe("New quantity (use 0 for metered prices)"),
  proration_behavior: z.enum(["create_prorations", "none", "always_invoice"]).optional().describe("Proration behavior for this change (default: create_prorations)"),
  proration_date: z.number().int().positive().optional().describe("Unix timestamp to use as the proration date"),
  payment_behavior: z.enum(["allow_incomplete", "default_incomplete", "error_if_incomplete", "pending_if_incomplete"]).optional().describe("Behavior if the update results in payment failure"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata (merges with existing)"),
  tax_rates: z.array(z.string()).optional().describe("Tax rate IDs (txr_xxx) — pass empty array to clear"),
});

const RemoveSubscriptionItemSchema = z.object({
  subscription_item_id: z.string().describe("Subscription item ID (si_xxx) to remove — required"),
  proration_behavior: z.enum(["create_prorations", "none", "always_invoice"]).optional().describe("Proration behavior for the removal (default: create_prorations)"),
  proration_date: z.number().int().positive().optional().describe("Unix timestamp to use as the proration date"),
  clear_usage: z.boolean().optional().describe("For metered items: reset usage to 0 before removing (default: false)"),
});

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

const PauseSubscriptionSchema = z.object({
  subscription_id: z.string().describe("Stripe subscription ID (sub_xxx) to pause"),
  resumes_at: z.number().int().optional().describe("Unix timestamp when the subscription should automatically resume (omit for indefinite pause)"),
});

const UpdateSubscriptionSchema = z.object({
  subscription_id: z.string().describe("Stripe subscription ID (sub_xxx) to update"),
  price: z.string().optional().describe("New price ID (price_xxx) to switch to — changes the subscription item price"),
  quantity: z.number().int().positive().optional().describe("New quantity for the subscription item"),
  trial_end: z.union([z.literal("now"), z.number().int().positive()]).optional().describe("End trial immediately ('now') or at a Unix timestamp"),
  cancel_at_period_end: z.boolean().optional().describe("Set whether to cancel at period end"),
  proration_behavior: z.enum(["create_prorations", "none", "always_invoice"]).optional().describe("How to handle proration when changing price (default: create_prorations)"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata (replaces existing)"),
  coupon: z.string().optional().describe("Apply a coupon ID to this subscription"),
  promotion_code: z.string().optional().describe("Apply a promotion code to this subscription"),
  default_payment_method: z.string().optional().describe("Payment method ID (pm_xxx) to use for this subscription's invoices"),
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
    {
      name: "pause_subscription",
      title: "Pause Subscription",
      description:
        "Pause a Stripe subscription by enabling collection_method=send_invoice with a pause_collection behavior. Sets the subscription's pause_collection to prevent invoices from being generated. Optionally set resumes_at to auto-resume at a Unix timestamp.",
      inputSchema: {
        type: "object",
        properties: {
          subscription_id: { type: "string", description: "Stripe subscription ID (sub_xxx) to pause" },
          resumes_at: { type: "number", description: "Unix timestamp to auto-resume (omit for indefinite pause)" },
        },
        required: ["subscription_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          pause_collection: { type: "object" },
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
      name: "update_subscription",
      title: "Update Subscription",
      description:
        "Update a Stripe subscription — change price, quantity, trial end, coupon, default payment method, or metadata. When changing price, use proration_behavior to control how prorations are handled. Returns the updated subscription.",
      inputSchema: {
        type: "object",
        properties: {
          subscription_id: { type: "string", description: "Stripe subscription ID (sub_xxx) to update" },
          price: { type: "string", description: "New price ID (price_xxx) to switch to" },
          quantity: { type: "number", description: "New quantity for the subscription item" },
          trial_end: { type: "string", description: "End trial: 'now' or a Unix timestamp" },
          cancel_at_period_end: { type: "boolean", description: "Set whether to cancel at period end" },
          proration_behavior: { type: "string", enum: ["create_prorations", "none", "always_invoice"], description: "Proration behavior when changing price" },
          metadata: { type: "object", description: "Key-value metadata (replaces existing)" },
          coupon: { type: "string", description: "Apply a coupon ID" },
          default_payment_method: { type: "string", description: "Payment method ID (pm_xxx) for this subscription's invoices" },
        },
        required: ["subscription_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          current_period_end: { type: "number" },
          cancel_at_period_end: { type: "boolean" },
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
    // ---- EXPANDED TOOLS: Subscription Items ----
    {
      name: "list_subscription_items",
      title: "List Subscription Items",
      description:
        "List all items (price+quantity pairs) on a Stripe subscription. Each subscription item represents one price billed. Use this to inspect what a customer is being charged for and their quantities.",
      inputSchema: {
        type: "object",
        properties: {
          subscription: { type: "string", description: "Subscription ID (sub_xxx) — required" },
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
        },
        required: ["subscription"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "add_subscription_item",
      title: "Add Subscription Item",
      description:
        "Add a new price/plan to an existing Stripe subscription. Useful for adding add-ons, seat expansions, or additional products to a subscription. Prorations are created by default for mid-cycle additions.",
      inputSchema: {
        type: "object",
        properties: {
          subscription: { type: "string", description: "Subscription ID (sub_xxx) to add the item to" },
          price: { type: "string", description: "Price ID (price_xxx) for the new item" },
          quantity: { type: "number", description: "Quantity (default: 1, use 0 for metered prices)" },
          proration_behavior: { type: "string", enum: ["create_prorations", "none", "always_invoice"], description: "Proration behavior (default: create_prorations)" },
          proration_date: { type: "number", description: "Proration date as Unix timestamp" },
          payment_behavior: { type: "string", enum: ["allow_incomplete", "default_incomplete", "error_if_incomplete", "pending_if_incomplete"], description: "Payment failure behavior" },
          metadata: { type: "object", description: "Key-value metadata" },
          tax_rates: { type: "array", description: "Tax rate IDs to apply", items: { type: "string" } },
        },
        required: ["subscription", "price"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_subscription_item",
      title: "Update Subscription Item",
      description:
        "Update a specific item on a Stripe subscription — change price, quantity, tax rates, or metadata. Use this to upgrade/downgrade individual plan components. Prorations are created by default.",
      inputSchema: {
        type: "object",
        properties: {
          subscription_item_id: { type: "string", description: "Subscription item ID (si_xxx) to update" },
          price: { type: "string", description: "New price ID (price_xxx)" },
          quantity: { type: "number", description: "New quantity (0 for metered)" },
          proration_behavior: { type: "string", enum: ["create_prorations", "none", "always_invoice"], description: "Proration behavior" },
          proration_date: { type: "number", description: "Proration date as Unix timestamp" },
          payment_behavior: { type: "string", enum: ["allow_incomplete", "default_incomplete", "error_if_incomplete", "pending_if_incomplete"], description: "Payment failure behavior" },
          metadata: { type: "object", description: "Key-value metadata" },
          tax_rates: { type: "array", description: "Tax rate IDs — empty array to clear", items: { type: "string" } },
        },
        required: ["subscription_item_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "remove_subscription_item",
      title: "Remove Subscription Item",
      description:
        "Remove an item from a Stripe subscription. Prorations are created by default for mid-cycle removals. For metered items, set clear_usage=true to reset usage before removal. The subscription continues with remaining items.",
      inputSchema: {
        type: "object",
        properties: {
          subscription_item_id: { type: "string", description: "Subscription item ID (si_xxx) to remove" },
          proration_behavior: { type: "string", enum: ["create_prorations", "none", "always_invoice"], description: "Proration behavior (default: create_prorations)" },
          proration_date: { type: "number", description: "Proration date as Unix timestamp" },
          clear_usage: { type: "boolean", description: "Reset metered usage before removing (default: false)" },
        },
        required: ["subscription_item_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
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

    pause_subscription: async (args) => {
      const params = PauseSubscriptionSchema.parse(args);

      const body: Record<string, string | number | boolean | undefined | null> = {
        "pause_collection[behavior]": "void",
      };
      if (params.resumes_at) {
        body["pause_collection[resumes_at]"] = params.resumes_at;
      }

      const subscription = await logger.time("tool.pause_subscription", () =>
        client.post<StripeSubscription>(`/subscriptions/${params.subscription_id}`, body)
      , { tool: "pause_subscription", subscription_id: params.subscription_id });

      return {
        content: [{ type: "text", text: JSON.stringify(subscription, null, 2) }],
        structuredContent: subscription,
      };
    },

    update_subscription: async (args) => {
      const params = UpdateSubscriptionSchema.parse(args);
      const { subscription_id, price, quantity, trial_end, proration_behavior, metadata, coupon, promotion_code, default_payment_method, cancel_at_period_end } = params;

      const body: Record<string, string | number | boolean | undefined | null> = {};

      // Handle price change via items array
      if (price) {
        body["items[0][price]"] = price;
        if (quantity) body["items[0][quantity]"] = quantity;
        if (proration_behavior) body.proration_behavior = proration_behavior;
      } else if (quantity) {
        body["items[0][quantity]"] = quantity;
      }

      if (trial_end !== undefined) {
        body.trial_end = typeof trial_end === "number" ? trial_end : trial_end;
      }
      if (cancel_at_period_end !== undefined) body.cancel_at_period_end = cancel_at_period_end;
      if (coupon) body.coupon = coupon;
      if (promotion_code) body.promotion_code = promotion_code;
      if (default_payment_method) body.default_payment_method = default_payment_method;
      if (metadata) {
        for (const [k, v] of Object.entries(metadata)) {
          body[`metadata[${k}]`] = v;
        }
      }

      const subscription = await logger.time("tool.update_subscription", () =>
        client.post<StripeSubscription>(`/subscriptions/${subscription_id}`, body)
      , { tool: "update_subscription", subscription_id });

      return {
        content: [{ type: "text", text: JSON.stringify(subscription, null, 2) }],
        structuredContent: subscription,
      };
    },

    // ---- EXPANDED HANDLERS: Subscription Items ----
    list_subscription_items: async (args) => {
      const params = ListSubscriptionItemsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        subscription: params.subscription,
        limit: params.limit,
      };
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;

      const result = await logger.time("tool.list_subscription_items", () =>
        client.list<Record<string, unknown>>("/subscription_items", queryParams)
      , { tool: "list_subscription_items", subscription: params.subscription });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    add_subscription_item: async (args) => {
      const params = AddSubscriptionItemSchema.parse(args);
      const body: Record<string, unknown> = {
        subscription: params.subscription,
        price: params.price,
      };
      if (params.quantity !== undefined) body.quantity = params.quantity;
      if (params.proration_behavior) body.proration_behavior = params.proration_behavior;
      if (params.proration_date) body.proration_date = params.proration_date;
      if (params.payment_behavior) body.payment_behavior = params.payment_behavior;
      if (params.metadata) body.metadata = params.metadata;
      if (params.tax_rates) {
        params.tax_rates.forEach((tr, i) => { body[`tax_rates[${i}]`] = tr; });
      }

      const item = await logger.time("tool.add_subscription_item", () =>
        client.post<Record<string, unknown>>("/subscription_items", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "add_subscription_item" });
      return { content: [{ type: "text", text: JSON.stringify(item, null, 2) }], structuredContent: item };
    },

    update_subscription_item: async (args) => {
      const params = UpdateSubscriptionItemSchema.parse(args);
      const { subscription_item_id, price, quantity, proration_behavior, proration_date, payment_behavior, metadata, tax_rates } = params;
      const body: Record<string, unknown> = {};

      if (price) body.price = price;
      if (quantity !== undefined) body.quantity = quantity;
      if (proration_behavior) body.proration_behavior = proration_behavior;
      if (proration_date) body.proration_date = proration_date;
      if (payment_behavior) body.payment_behavior = payment_behavior;
      if (metadata) body.metadata = metadata;
      if (tax_rates) {
        if (tax_rates.length === 0) {
          body["tax_rates"] = "";  // Clear tax rates
        } else {
          tax_rates.forEach((tr, i) => { body[`tax_rates[${i}]`] = tr; });
        }
      }

      const item = await logger.time("tool.update_subscription_item", () =>
        client.post<Record<string, unknown>>(`/subscription_items/${subscription_item_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_subscription_item", subscription_item_id });
      return { content: [{ type: "text", text: JSON.stringify(item, null, 2) }], structuredContent: item };
    },

    remove_subscription_item: async (args) => {
      const params = RemoveSubscriptionItemSchema.parse(args);
      const body: Record<string, string | number | boolean | undefined | null> = {};
      if (params.proration_behavior) body.proration_behavior = params.proration_behavior;
      if (params.proration_date) body.proration_date = params.proration_date;
      if (params.clear_usage !== undefined) body.clear_usage = params.clear_usage;

      const result = await logger.time("tool.remove_subscription_item", () =>
        client.delete<Record<string, unknown>>(`/subscription_items/${params.subscription_item_id}`, body)
      , { tool: "remove_subscription_item", subscription_item_id: params.subscription_item_id });
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
