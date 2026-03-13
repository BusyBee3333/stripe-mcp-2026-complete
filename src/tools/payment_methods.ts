// Payment Methods tools — Stripe API v1
// Covers: list_payment_methods, get_payment_method, attach_payment_method, detach_payment_method, set_default_payment_method

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripePaymentMethod } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListPaymentMethodsSchema = z.object({
  customer: z.string().optional().describe("Filter by customer ID (cus_xxx) — required when type is omitted for customer-attached methods"),
  type: z.enum(["card", "sepa_debit", "us_bank_account", "bacs_debit", "acss_debit", "au_becs_debit", "bancontact", "eps", "fpx", "giropay", "grabpay", "ideal", "klarna", "konbini", "link", "oxxo", "p24", "paypal", "paynow", "pix", "promptpay", "sofort", "wechat_pay"]).optional().describe("Filter by payment method type (e.g., 'card')"),
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
});

const GetPaymentMethodSchema = z.object({
  payment_method_id: z.string().describe("Stripe payment method ID (pm_xxx)"),
});

const AttachPaymentMethodSchema = z.object({
  payment_method_id: z.string().describe("Stripe payment method ID (pm_xxx) to attach"),
  customer: z.string().describe("Customer ID (cus_xxx) to attach the payment method to"),
});

const DetachPaymentMethodSchema = z.object({
  payment_method_id: z.string().describe("Stripe payment method ID (pm_xxx) to detach from its customer"),
});

const SetDefaultPaymentMethodSchema = z.object({
  customer: z.string().describe("Customer ID (cus_xxx)"),
  payment_method: z.string().describe("Payment method ID (pm_xxx) to set as the default for invoices"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_payment_methods",
      title: "List Payment Methods",
      description:
        "List payment methods for a customer or by type. Provide customer to list all methods attached to a customer. Optionally filter by type (e.g., 'card'). Uses keyset pagination — pass meta.lastId as starting_after for the next page.",
      inputSchema: {
        type: "object",
        properties: {
          customer: { type: "string", description: "Filter by customer ID (cus_xxx)" },
          type: { type: "string", description: "Filter by payment method type (e.g., 'card')" },
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
      name: "get_payment_method",
      title: "Get Payment Method",
      description:
        "Get full details for a Stripe payment method by ID (pm_xxx). Returns type, card details (last4, brand, expiry), billing details, and customer it is attached to.",
      inputSchema: {
        type: "object",
        properties: {
          payment_method_id: { type: "string", description: "Stripe payment method ID (pm_xxx)" },
        },
        required: ["payment_method_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          customer: { type: "string" },
          card: { type: "object" },
          billing_details: { type: "object" },
        },
        required: ["id", "type"],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "attach_payment_method",
      title: "Attach Payment Method",
      description:
        "Attach a Stripe payment method (pm_xxx) to a customer (cus_xxx). After attaching, the payment method can be used for charges and subscriptions for that customer. A payment method can only be attached to one customer at a time.",
      inputSchema: {
        type: "object",
        properties: {
          payment_method_id: { type: "string", description: "Stripe payment method ID (pm_xxx) to attach" },
          customer: { type: "string", description: "Customer ID (cus_xxx) to attach to" },
        },
        required: ["payment_method_id", "customer"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          customer: { type: "string" },
          type: { type: "string" },
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
    {
      name: "detach_payment_method",
      title: "Detach Payment Method",
      description:
        "Detach a Stripe payment method from its customer. The payment method returns to an unattached state. If it was the customer's default payment method, the default is cleared. You must set a new default payment method separately.",
      inputSchema: {
        type: "object",
        properties: {
          payment_method_id: { type: "string", description: "Stripe payment method ID (pm_xxx) to detach" },
        },
        required: ["payment_method_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          customer: { type: "string" },
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
    {
      name: "set_default_payment_method",
      title: "Set Default Payment Method",
      description:
        "Set the default payment method for a customer's invoices. This updates invoice_settings.default_payment_method on the customer. Used to control which card/method is charged for recurring subscriptions.",
      inputSchema: {
        type: "object",
        properties: {
          customer: { type: "string", description: "Customer ID (cus_xxx)" },
          payment_method: { type: "string", description: "Payment method ID (pm_xxx) to set as default" },
        },
        required: ["customer", "payment_method"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          invoice_settings: { type: "object" },
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
    list_payment_methods: async (args) => {
      const params = ListPaymentMethodsSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.customer) queryParams.customer = params.customer;
      if (params.type) queryParams.type = params.type;
      if (params.starting_after) queryParams.starting_after = params.starting_after;

      const result = await logger.time("tool.list_payment_methods", () =>
        client.list<StripePaymentMethod>("/payment_methods", queryParams)
      , { tool: "list_payment_methods" });

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

    get_payment_method: async (args) => {
      const { payment_method_id } = GetPaymentMethodSchema.parse(args);

      const pm = await logger.time("tool.get_payment_method", () =>
        client.get<StripePaymentMethod>(`/payment_methods/${payment_method_id}`)
      , { tool: "get_payment_method", payment_method_id });

      return {
        content: [{ type: "text", text: JSON.stringify(pm, null, 2) }],
        structuredContent: pm,
      };
    },

    attach_payment_method: async (args) => {
      const { payment_method_id, customer } = AttachPaymentMethodSchema.parse(args);

      const pm = await logger.time("tool.attach_payment_method", () =>
        client.post<StripePaymentMethod>(`/payment_methods/${payment_method_id}/attach`, { customer })
      , { tool: "attach_payment_method", payment_method_id, customer });

      return {
        content: [{ type: "text", text: JSON.stringify(pm, null, 2) }],
        structuredContent: pm,
      };
    },

    detach_payment_method: async (args) => {
      const { payment_method_id } = DetachPaymentMethodSchema.parse(args);

      const pm = await logger.time("tool.detach_payment_method", () =>
        client.post<StripePaymentMethod>(`/payment_methods/${payment_method_id}/detach`, {})
      , { tool: "detach_payment_method", payment_method_id });

      return {
        content: [{ type: "text", text: JSON.stringify(pm, null, 2) }],
        structuredContent: pm,
      };
    },

    set_default_payment_method: async (args) => {
      const { customer, payment_method } = SetDefaultPaymentMethodSchema.parse(args);

      const updated = await logger.time("tool.set_default_payment_method", () =>
        client.post<{ id: string; invoice_settings: Record<string, unknown> }>(
          `/customers/${customer}`,
          { "invoice_settings[default_payment_method]": payment_method }
        )
      , { tool: "set_default_payment_method", customer });

      return {
        content: [{ type: "text", text: JSON.stringify(updated, null, 2) }],
        structuredContent: updated,
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
