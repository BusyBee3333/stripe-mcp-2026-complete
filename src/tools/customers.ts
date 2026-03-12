// Customers tools — Stripe API v1
// Covers: list_customers, get_customer, create_customer, update_customer

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeCustomer, StripeList } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListCustomersSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  email: z.string().optional().describe("Filter customers by exact email address"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — ID for reversed pagination"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
});

const GetCustomerSchema = z.object({
  customer_id: z.string().describe("Stripe customer ID (cus_xxx)"),
  include_payment_methods: z.boolean().optional().default(false).describe("Include attached payment methods (default: false)"),
});

const CreateCustomerSchema = z.object({
  email: z.string().email().optional().describe("Customer email address"),
  name: z.string().optional().describe("Customer full name"),
  phone: z.string().optional().describe("Customer phone number"),
  description: z.string().optional().describe("Internal description/notes"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata (max 50 keys, 500 char values)"),
  payment_method: z.string().optional().describe("Default payment method ID (pm_xxx) to attach"),
});

const UpdateCustomerSchema = z.object({
  customer_id: z.string().describe("Stripe customer ID (cus_xxx)"),
  email: z.string().email().optional().describe("Updated email address"),
  name: z.string().optional().describe("Updated name"),
  phone: z.string().optional().describe("Updated phone"),
  description: z.string().optional().describe("Updated description"),
  metadata: z.record(z.string()).optional().describe("Updated metadata (merges with existing; set key to empty string to delete)"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_customers",
      title: "List Customers",
      description:
        "List Stripe customers with optional email filter and date range. Returns customer ID, email, name, and creation timestamp. Uses keyset pagination via starting_after (pass the last customer's ID). When meta.hasMore is true, pass meta.lastId as starting_after for the next page.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          email: { type: "string", description: "Filter by exact email address" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
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
      name: "get_customer",
      title: "Get Customer",
      description:
        "Get full details for a Stripe customer by ID (cus_xxx). Returns contact info, balance, currency, and metadata. Optionally includes attached payment methods. Use when the user references a specific customer ID or needs detailed customer info.",
      inputSchema: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "Stripe customer ID (cus_xxx)" },
          include_payment_methods: { type: "boolean", description: "Include attached payment methods (default: false)" },
        },
        required: ["customer_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string" },
          name: { type: "string" },
          balance: { type: "number" },
          currency: { type: "string" },
          livemode: { type: "boolean" },
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
      name: "create_customer",
      title: "Create Customer",
      description:
        "Create a new Stripe customer. All fields are optional but email is strongly recommended for receipt delivery. Returns the created customer with assigned cus_xxx ID. Use when setting up a new customer for charging or subscriptions.",
      inputSchema: {
        type: "object",
        properties: {
          email: { type: "string", description: "Customer email address" },
          name: { type: "string", description: "Customer full name" },
          phone: { type: "string", description: "Customer phone number" },
          description: { type: "string", description: "Internal description/notes" },
          metadata: { type: "object", description: "Key-value metadata (max 50 keys)" },
          payment_method: { type: "string", description: "Default payment method ID (pm_xxx)" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string" },
          name: { type: "string" },
          created: { type: "number" },
          livemode: { type: "boolean" },
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
      name: "update_customer",
      title: "Update Customer",
      description:
        "Update an existing Stripe customer's fields. Only include fields to change. Metadata is merged (not replaced) — set a key to empty string to delete it. Returns the updated customer.",
      inputSchema: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "Stripe customer ID (cus_xxx)" },
          email: { type: "string", description: "Updated email address" },
          name: { type: "string", description: "Updated name" },
          phone: { type: "string", description: "Updated phone" },
          description: { type: "string", description: "Updated description" },
          metadata: { type: "object", description: "Updated metadata (merges; empty string deletes key)" },
        },
        required: ["customer_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string" },
          name: { type: "string" },
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
    list_customers: async (args) => {
      const params = ListCustomersSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.email) queryParams.email = params.email;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_customers", () =>
        client.list<StripeCustomer>("/customers", queryParams)
      , { tool: "list_customers" });

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

    get_customer: async (args) => {
      const { customer_id, include_payment_methods } = GetCustomerSchema.parse(args);

      const customer = await logger.time("tool.get_customer", () =>
        client.get<StripeCustomer>(`/customers/${customer_id}`)
      , { tool: "get_customer", customer_id });

      let paymentMethods: unknown[] = [];
      if (include_payment_methods) {
        try {
          const pm = await client.list<unknown>(`/customers/${customer_id}/payment_methods`, { limit: 10 });
          paymentMethods = pm.data;
        } catch (_e) {
          // Non-fatal
        }
      }

      const result = { ...customer, ...(include_payment_methods ? { payment_methods: paymentMethods } : {}) };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_customer: async (args) => {
      const params = CreateCustomerSchema.parse(args);

      // Stripe uses form-encoded, including metadata as metadata[key]=value
      const body: Record<string, string | number | boolean | undefined | null> = {};
      if (params.email) body.email = params.email;
      if (params.name) body.name = params.name;
      if (params.phone) body.phone = params.phone;
      if (params.description) body.description = params.description;
      if (params.payment_method) body.payment_method = params.payment_method;

      // Metadata needs to be flattened for form-encoding
      const fullBody: Record<string, unknown> = { ...body };
      if (params.metadata) {
        fullBody.metadata = params.metadata;
      }

      const customer = await logger.time("tool.create_customer", () =>
        client.post<StripeCustomer>("/customers", fullBody as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_customer" });

      return {
        content: [{ type: "text", text: JSON.stringify(customer, null, 2) }],
        structuredContent: customer,
      };
    },

    update_customer: async (args) => {
      const { customer_id, ...updateData } = UpdateCustomerSchema.parse(args);

      const body: Record<string, unknown> = {};
      if (updateData.email !== undefined) body.email = updateData.email;
      if (updateData.name !== undefined) body.name = updateData.name;
      if (updateData.phone !== undefined) body.phone = updateData.phone;
      if (updateData.description !== undefined) body.description = updateData.description;
      if (updateData.metadata !== undefined) body.metadata = updateData.metadata;

      const customer = await logger.time("tool.update_customer", () =>
        client.post<StripeCustomer>(`/customers/${customer_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_customer", customer_id });

      return {
        content: [{ type: "text", text: JSON.stringify(customer, null, 2) }],
        structuredContent: customer,
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
