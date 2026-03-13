// Setup Intents tools — Stripe API v1
// Covers: list_setup_intents, get_setup_intent, create_setup_intent, confirm_setup_intent, cancel_setup_intent

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListSetupIntentsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  customer: z.string().optional().describe("Filter by customer ID (cus_xxx)"),
  payment_method: z.string().optional().describe("Filter by payment method ID (pm_xxx)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — for reversed pagination"),
});

const GetSetupIntentSchema = z.object({
  setup_intent_id: z.string().describe("Stripe SetupIntent ID (seti_xxx)"),
  client_secret: z.string().optional().describe("Client secret for client-side retrieval (use instead of API key on frontend)"),
});

const CreateSetupIntentSchema = z.object({
  customer: z.string().optional().describe("Customer ID (cus_xxx) to associate with this SetupIntent"),
  payment_method: z.string().optional().describe("Pre-attach a payment method ID (pm_xxx) to this SetupIntent"),
  payment_method_types: z.array(z.string()).optional().describe("Allowed payment method types (e.g. ['card', 'us_bank_account'])"),
  usage: z.enum(["off_session", "on_session"]).optional().default("off_session").describe("How the payment method will be used: off_session (future background charges) or on_session (customer present). Default: off_session"),
  description: z.string().optional().describe("Internal description for this SetupIntent"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
  confirm: z.boolean().optional().describe("Confirm this SetupIntent immediately (requires payment_method)"),
  return_url: z.string().optional().describe("URL to redirect after confirmation (for redirect-based payment methods)"),
});

const ConfirmSetupIntentSchema = z.object({
  setup_intent_id: z.string().describe("Stripe SetupIntent ID (seti_xxx) to confirm"),
  payment_method: z.string().optional().describe("Payment method ID (pm_xxx) to attach and confirm with"),
  return_url: z.string().optional().describe("URL to redirect after confirmation for redirect-based payment methods"),
  mandate_data: z.object({
    customer_acceptance: z.object({
      type: z.enum(["online", "offline"]).describe("Type of acceptance"),
      online: z.object({
        ip_address: z.string().optional().describe("Customer's IP address"),
        user_agent: z.string().optional().describe("Customer's user agent"),
      }).optional(),
    }),
  }).optional().describe("Mandate data for mandated payment methods (e.g. SEPA, ACH)"),
});

const CancelSetupIntentSchema = z.object({
  setup_intent_id: z.string().describe("Stripe SetupIntent ID (seti_xxx) to cancel"),
  cancellation_reason: z.enum(["abandoned", "requested_by_customer", "duplicate"]).optional().describe("Reason for cancellation"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_setup_intents",
      title: "List Setup Intents",
      description:
        "List Stripe SetupIntents — used to save payment methods for future off-session charges without immediately charging. Optionally filter by customer or payment method. Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          customer: { type: "string", description: "Filter by customer ID (cus_xxx)" },
          payment_method: { type: "string", description: "Filter by payment method ID (pm_xxx)" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_setup_intent",
      title: "Get Setup Intent",
      description:
        "Get full details for a Stripe SetupIntent by ID (seti_xxx). Returns status, payment method, customer, and next_action for redirect-based flows.",
      inputSchema: {
        type: "object",
        properties: {
          setup_intent_id: { type: "string", description: "Stripe SetupIntent ID (seti_xxx)" },
          client_secret: { type: "string", description: "Client secret for client-side retrieval" },
        },
        required: ["setup_intent_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_setup_intent",
      title: "Create Setup Intent",
      description:
        "Create a Stripe SetupIntent to save a payment method for future off-session charges (e.g., subscriptions, one-click). Returns a client_secret for frontend confirmation with Stripe.js. Set usage='off_session' for background charges (default).",
      inputSchema: {
        type: "object",
        properties: {
          customer: { type: "string", description: "Customer ID (cus_xxx) to associate" },
          payment_method: { type: "string", description: "Pre-attach payment method ID (pm_xxx)" },
          payment_method_types: { type: "array", description: "Allowed types (e.g. ['card'])", items: { type: "string" } },
          usage: { type: "string", enum: ["off_session", "on_session"], description: "Usage: off_session (future charges) or on_session (customer present)" },
          description: { type: "string", description: "Internal description" },
          metadata: { type: "object", description: "Key-value metadata" },
          confirm: { type: "boolean", description: "Confirm immediately (requires payment_method)" },
          return_url: { type: "string", description: "Redirect URL after confirmation" },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "confirm_setup_intent",
      title: "Confirm Setup Intent",
      description:
        "Confirm a Stripe SetupIntent server-side to attach a payment method. After confirmation, the payment method is saved and ready for future charges. Some payment methods may return a next_action requiring frontend redirect.",
      inputSchema: {
        type: "object",
        properties: {
          setup_intent_id: { type: "string", description: "Stripe SetupIntent ID (seti_xxx)" },
          payment_method: { type: "string", description: "Payment method ID (pm_xxx) to confirm with" },
          return_url: { type: "string", description: "Redirect URL for redirect-based methods" },
        },
        required: ["setup_intent_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "cancel_setup_intent",
      title: "Cancel Setup Intent",
      description:
        "Cancel a Stripe SetupIntent. Once canceled, the SetupIntent cannot be confirmed. Use when the customer abandons the setup flow or you want to prevent future confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          setup_intent_id: { type: "string", description: "Stripe SetupIntent ID (seti_xxx)" },
          cancellation_reason: { type: "string", enum: ["abandoned", "requested_by_customer", "duplicate"], description: "Reason for cancellation" },
        },
        required: ["setup_intent_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_setup_intents: async (args) => {
      const params = ListSetupIntentsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.customer) queryParams.customer = params.customer;
      if (params.payment_method) queryParams.payment_method = params.payment_method;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;

      const result = await logger.time("tool.list_setup_intents", () =>
        client.list<Record<string, unknown>>("/setup_intents", queryParams)
      , { tool: "list_setup_intents" });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_setup_intent: async (args) => {
      const { setup_intent_id, client_secret } = GetSetupIntentSchema.parse(args);
      const params: Record<string, string | undefined> = {};
      if (client_secret) params.client_secret = client_secret;

      const seti = await logger.time("tool.get_setup_intent", () =>
        client.get<Record<string, unknown>>(`/setup_intents/${setup_intent_id}`, params)
      , { tool: "get_setup_intent", setup_intent_id });
      return { content: [{ type: "text", text: JSON.stringify(seti, null, 2) }], structuredContent: seti };
    },

    create_setup_intent: async (args) => {
      const params = CreateSetupIntentSchema.parse(args);
      const body: Record<string, unknown> = {};

      if (params.customer) body.customer = params.customer;
      if (params.payment_method) body.payment_method = params.payment_method;
      if (params.usage) body.usage = params.usage;
      if (params.description) body.description = params.description;
      if (params.confirm !== undefined) body.confirm = params.confirm;
      if (params.return_url) body.return_url = params.return_url;
      if (params.metadata) body.metadata = params.metadata;
      if (params.payment_method_types) {
        params.payment_method_types.forEach((t, i) => {
          body[`payment_method_types[${i}]`] = t;
        });
      }

      const seti = await logger.time("tool.create_setup_intent", () =>
        client.post<Record<string, unknown>>("/setup_intents", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_setup_intent" });
      return { content: [{ type: "text", text: JSON.stringify(seti, null, 2) }], structuredContent: seti };
    },

    confirm_setup_intent: async (args) => {
      const params = ConfirmSetupIntentSchema.parse(args);
      const body: Record<string, unknown> = {};

      if (params.payment_method) body.payment_method = params.payment_method;
      if (params.return_url) body.return_url = params.return_url;
      if (params.mandate_data) {
        const acceptance = params.mandate_data.customer_acceptance;
        body["mandate_data[customer_acceptance][type]"] = acceptance.type;
        if (acceptance.online) {
          if (acceptance.online.ip_address) body["mandate_data[customer_acceptance][online][ip_address]"] = acceptance.online.ip_address;
          if (acceptance.online.user_agent) body["mandate_data[customer_acceptance][online][user_agent]"] = acceptance.online.user_agent;
        }
      }

      const seti = await logger.time("tool.confirm_setup_intent", () =>
        client.post<Record<string, unknown>>(`/setup_intents/${params.setup_intent_id}/confirm`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "confirm_setup_intent", setup_intent_id: params.setup_intent_id });
      return { content: [{ type: "text", text: JSON.stringify(seti, null, 2) }], structuredContent: seti };
    },

    cancel_setup_intent: async (args) => {
      const params = CancelSetupIntentSchema.parse(args);
      const body: Record<string, string | number | boolean | undefined | null> = {};
      if (params.cancellation_reason) body.cancellation_reason = params.cancellation_reason;

      const seti = await logger.time("tool.cancel_setup_intent", () =>
        client.post<Record<string, unknown>>(`/setup_intents/${params.setup_intent_id}/cancel`, body)
      , { tool: "cancel_setup_intent", setup_intent_id: params.setup_intent_id });
      return { content: [{ type: "text", text: JSON.stringify(seti, null, 2) }], structuredContent: seti };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
