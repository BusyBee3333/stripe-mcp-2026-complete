// PaymentIntents tools — Stripe API v1
// Covers: list_payment_intents, get_payment_intent, create_payment_intent

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripePaymentIntent } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListPaymentIntentsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  customer: z.string().optional().describe("Filter by customer ID (cus_xxx)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
});

const GetPaymentIntentSchema = z.object({
  payment_intent_id: z.string().describe("Stripe PaymentIntent ID (pi_xxx)"),
});

const CreatePaymentIntentSchema = z.object({
  amount: z.number().int().positive().describe("Amount in smallest currency unit (e.g., cents for USD). 1000 = $10.00"),
  currency: z.string().length(3).describe("Three-letter ISO currency code (e.g., 'usd', 'eur', 'gbp')"),
  customer: z.string().optional().describe("Customer ID (cus_xxx) to attach to"),
  payment_method: z.string().optional().describe("Payment method ID (pm_xxx) to use"),
  description: z.string().optional().describe("Internal description for the payment"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
  confirm: z.boolean().optional().default(false).describe("Confirm immediately (requires payment_method). Default: false"),
  automatic_payment_methods: z.boolean().optional().default(true).describe("Enable automatic payment methods (default: true)"),
  receipt_email: z.string().email().optional().describe("Email to send receipt to"),
  statement_descriptor: z.string().max(22).optional().describe("Statement descriptor (max 22 chars)"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_payment_intents",
      title: "List Payment Intents",
      description:
        "List Stripe PaymentIntents with optional filters by customer and date range. Returns amount, currency, status, and customer. Uses keyset pagination — pass meta.lastId as starting_after for the next page. Status values: requires_payment_method, requires_confirmation, requires_action, processing, requires_capture, canceled, succeeded.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          customer: { type: "string", description: "Filter by customer ID (cus_xxx)" },
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
      name: "get_payment_intent",
      title: "Get Payment Intent",
      description:
        "Get full details for a Stripe PaymentIntent by ID (pi_xxx). Returns amount, currency, status, payment method, customer, and latest charge. Use when the user references a specific payment or needs to check payment status.",
      inputSchema: {
        type: "object",
        properties: {
          payment_intent_id: { type: "string", description: "Stripe PaymentIntent ID (pi_xxx)" },
        },
        required: ["payment_intent_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          amount: { type: "number" },
          currency: { type: "string" },
          status: { type: "string" },
          customer: { type: "string" },
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
      name: "create_payment_intent",
      title: "Create Payment Intent",
      description:
        "Create a new Stripe PaymentIntent to collect a payment. Amount is in smallest currency unit (cents for USD — 1000 = $10.00). Set confirm=true to confirm immediately with a payment_method. Returns client_secret for frontend confirmation or the confirmed intent if confirm=true.",
      inputSchema: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Amount in smallest currency unit (cents for USD — 1000 = $10.00)" },
          currency: { type: "string", description: "ISO currency code (e.g., 'usd', 'eur', 'gbp')" },
          customer: { type: "string", description: "Customer ID (cus_xxx) to attach to" },
          payment_method: { type: "string", description: "Payment method ID (pm_xxx) to use" },
          description: { type: "string", description: "Internal description" },
          metadata: { type: "object", description: "Key-value metadata" },
          confirm: { type: "boolean", description: "Confirm immediately (requires payment_method, default: false)" },
          automatic_payment_methods: { type: "boolean", description: "Enable automatic payment methods (default: true)" },
          receipt_email: { type: "string", description: "Email for receipt" },
          statement_descriptor: { type: "string", description: "Statement descriptor (max 22 chars)" },
        },
        required: ["amount", "currency"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          amount: { type: "number" },
          currency: { type: "string" },
          status: { type: "string" },
          client_secret: { type: "string" },
        },
        required: ["id", "amount", "currency"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_payment_intents: async (args) => {
      const params = ListPaymentIntentsSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.customer) queryParams.customer = params.customer;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_payment_intents", () =>
        client.list<StripePaymentIntent>("/payment_intents", queryParams)
      , { tool: "list_payment_intents" });

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

    get_payment_intent: async (args) => {
      const { payment_intent_id } = GetPaymentIntentSchema.parse(args);

      const pi = await logger.time("tool.get_payment_intent", () =>
        client.get<StripePaymentIntent>(`/payment_intents/${payment_intent_id}`)
      , { tool: "get_payment_intent", payment_intent_id });

      return {
        content: [{ type: "text", text: JSON.stringify(pi, null, 2) }],
        structuredContent: pi,
      };
    },

    create_payment_intent: async (args) => {
      const params = CreatePaymentIntentSchema.parse(args);

      const body: Record<string, unknown> = {
        amount: params.amount,
        currency: params.currency,
      };
      if (params.customer) body.customer = params.customer;
      if (params.payment_method) body.payment_method = params.payment_method;
      if (params.description) body.description = params.description;
      if (params.metadata) body.metadata = params.metadata;
      if (params.confirm !== undefined) body.confirm = params.confirm;
      if (params.receipt_email) body.receipt_email = params.receipt_email;
      if (params.statement_descriptor) body.statement_descriptor = params.statement_descriptor;

      if (params.automatic_payment_methods) {
        body.automatic_payment_methods = { enabled: true };
      }

      const pi = await logger.time("tool.create_payment_intent", () =>
        client.post<StripePaymentIntent>("/payment_intents", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_payment_intent" });

      return {
        content: [{ type: "text", text: JSON.stringify(pi, null, 2) }],
        structuredContent: pi,
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
