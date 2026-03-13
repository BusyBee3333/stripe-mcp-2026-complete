// Checkout tools — Stripe API v1
// Covers: create_checkout_session, list_checkout_sessions, get_checkout_session

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeCheckoutSession } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const LineItemSchema = z.object({
  price: z.string().describe("Price ID (price_xxx)"),
  quantity: z.number().int().positive().optional().default(1).describe("Quantity (default: 1)"),
});

const CreateCheckoutSessionSchema = z.object({
  mode: z.enum(["payment", "setup", "subscription"]).describe("Session mode: payment (one-time), setup (save payment method), or subscription"),
  success_url: z.string().url().describe("URL to redirect to after successful payment (required)"),
  cancel_url: z.string().url().optional().describe("URL to redirect to when customer cancels"),
  line_items: z.array(LineItemSchema).optional().describe("Line items — array of {price, quantity} (required for payment/subscription modes)"),
  customer: z.string().optional().describe("Existing customer ID (cus_xxx) to associate with session"),
  customer_email: z.string().email().optional().describe("Pre-fill customer email (ignored if customer is set)"),
  currency: z.string().length(3).optional().describe("3-letter currency code (e.g., 'usd')"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata attached to the session"),
  allow_promotion_codes: z.boolean().optional().describe("Allow customers to enter promotion codes"),
  client_reference_id: z.string().optional().describe("A unique string to reference this session in your system"),
  expires_at: z.number().int().optional().describe("Unix timestamp when session expires (must be 30m–24h from now)"),
});

const ListCheckoutSessionsSchema = z.object({
  payment_intent: z.string().optional().describe("Filter by PaymentIntent ID (pi_xxx)"),
  subscription: z.string().optional().describe("Filter by subscription ID (sub_xxx)"),
  customer: z.string().optional().describe("Filter by customer ID (cus_xxx)"),
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
});

const GetCheckoutSessionSchema = z.object({
  session_id: z.string().describe("Stripe Checkout Session ID (cs_xxx)"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "create_checkout_session",
      title: "Create Checkout Session",
      description:
        "Create a Stripe Checkout Session — a hosted payment page. Mode: 'payment' for one-time charges, 'subscription' for recurring billing, 'setup' to save a payment method without charging. Provide line_items (price IDs + quantities) for payment/subscription. Returns a checkout URL to redirect the customer.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["payment", "setup", "subscription"], description: "Session mode" },
          success_url: { type: "string", description: "URL after successful payment (required)" },
          cancel_url: { type: "string", description: "URL when customer cancels" },
          line_items: {
            type: "array",
            description: "Line items: [{price, quantity}]",
            items: {
              type: "object",
              properties: {
                price: { type: "string" },
                quantity: { type: "number" },
              },
            },
          },
          customer: { type: "string", description: "Existing customer ID (cus_xxx)" },
          customer_email: { type: "string", description: "Pre-fill customer email" },
          currency: { type: "string", description: "3-letter currency code" },
          metadata: { type: "object", description: "Key-value metadata" },
          allow_promotion_codes: { type: "boolean", description: "Allow promotion codes" },
          client_reference_id: { type: "string", description: "Your internal reference ID" },
          expires_at: { type: "number", description: "Session expiry timestamp (Unix)" },
        },
        required: ["mode", "success_url"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string" },
          status: { type: "string" },
          mode: { type: "string" },
          customer: { type: "string" },
          expires_at: { type: "number" },
        },
        required: ["id", "url"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    {
      name: "list_checkout_sessions",
      title: "List Checkout Sessions",
      description:
        "List Stripe Checkout Sessions with optional filters by PaymentIntent, subscription, or customer. Returns session ID, status, mode, and URL. Uses keyset pagination — pass meta.lastId as starting_after for the next page.",
      inputSchema: {
        type: "object",
        properties: {
          payment_intent: { type: "string", description: "Filter by PaymentIntent ID (pi_xxx)" },
          subscription: { type: "string", description: "Filter by subscription ID (sub_xxx)" },
          customer: { type: "string", description: "Filter by customer ID (cus_xxx)" },
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
      name: "get_checkout_session",
      title: "Get Checkout Session",
      description:
        "Get full details for a Stripe Checkout Session by ID (cs_xxx). Returns status, mode, customer, payment_intent, and the checkout URL. Use to verify whether a customer completed checkout.",
      inputSchema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Stripe Checkout Session ID (cs_xxx)" },
        },
        required: ["session_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string" },
          status: { type: "string" },
          mode: { type: "string" },
          customer: { type: "string" },
          payment_intent: { type: "string" },
          subscription: { type: "string" },
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
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    create_checkout_session: async (args) => {
      const params = CreateCheckoutSessionSchema.parse(args);

      const body: Record<string, string | number | boolean | undefined | null> = {
        mode: params.mode,
        success_url: params.success_url,
      };

      if (params.cancel_url) body.cancel_url = params.cancel_url;
      if (params.customer) body.customer = params.customer;
      if (params.customer_email) body.customer_email = params.customer_email;
      if (params.currency) body.currency = params.currency;
      if (params.allow_promotion_codes !== undefined) body.allow_promotion_codes = params.allow_promotion_codes;
      if (params.client_reference_id) body.client_reference_id = params.client_reference_id;
      if (params.expires_at) body.expires_at = params.expires_at;

      // Line items: form-encoded as line_items[0][price], line_items[0][quantity], etc.
      if (params.line_items) {
        params.line_items.forEach((item, i) => {
          body[`line_items[${i}][price]`] = item.price;
          body[`line_items[${i}][quantity]`] = item.quantity ?? 1;
        });
      }

      if (params.metadata) {
        for (const [k, v] of Object.entries(params.metadata)) {
          body[`metadata[${k}]`] = v;
        }
      }

      const session = await logger.time("tool.create_checkout_session", () =>
        client.post<StripeCheckoutSession>("/checkout/sessions", body)
      , { tool: "create_checkout_session" });

      return {
        content: [{ type: "text", text: JSON.stringify(session, null, 2) }],
        structuredContent: session,
      };
    },

    list_checkout_sessions: async (args) => {
      const params = ListCheckoutSessionsSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.payment_intent) queryParams.payment_intent = params.payment_intent;
      if (params.subscription) queryParams.subscription = params.subscription;
      if (params.customer) queryParams.customer = params.customer;
      if (params.starting_after) queryParams.starting_after = params.starting_after;

      const result = await logger.time("tool.list_checkout_sessions", () =>
        client.list<StripeCheckoutSession>("/checkout/sessions", queryParams)
      , { tool: "list_checkout_sessions" });

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

    get_checkout_session: async (args) => {
      const { session_id } = GetCheckoutSessionSchema.parse(args);

      const session = await logger.time("tool.get_checkout_session", () =>
        client.get<StripeCheckoutSession>(`/checkout/sessions/${session_id}`)
      , { tool: "get_checkout_session", session_id });

      return {
        content: [{ type: "text", text: JSON.stringify(session, null, 2) }],
        structuredContent: session,
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
