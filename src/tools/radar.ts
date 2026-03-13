// Radar tools — Stripe API v1
// Covers: list_value_lists, get_value_list, create_value_list, delete_value_list,
//         list_value_list_items, create_value_list_item, delete_value_list_item,
//         list_early_fraud_warnings, get_early_fraud_warning

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListValueListsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  alias: z.string().optional().describe("Filter by alias (exact match)"),
  contains: z.string().optional().describe("Filter lists that contain a specific value"),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetValueListSchema = z.object({
  value_list_id: z.string().describe("Stripe Radar value list ID (rsl_xxx)"),
});

const CreateValueListSchema = z.object({
  alias: z.string().describe("Unique alias for this list (used in Radar rules, e.g. 'blocked_ips')"),
  name: z.string().describe("Human-readable name for this list"),
  item_type: z.enum([
    "card_bin", "card_fingerprint", "case_sensitive_string", "country",
    "customer_id", "email", "ip_address", "sepa_debit_fingerprint",
    "string", "us_bank_account_fingerprint",
  ]).describe("Type of items this list will contain"),
  metadata: z.record(z.string()).optional(),
});

const DeleteValueListSchema = z.object({
  value_list_id: z.string().describe("Stripe Radar value list ID (rsl_xxx) to delete"),
});

const ListValueListItemsSchema = z.object({
  value_list: z.string().describe("Value list ID (rsl_xxx) to list items from"),
  limit: z.number().min(1).max(100).optional().default(20),
  value: z.string().optional().describe("Filter items by value (exact match)"),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const CreateValueListItemSchema = z.object({
  value_list: z.string().describe("Value list ID (rsl_xxx) to add this item to"),
  value: z.string().describe("The value to add (must match the list's item_type — e.g. an IP address, email, or card fingerprint)"),
});

const DeleteValueListItemSchema = z.object({
  item_id: z.string().describe("Value list item ID (rsli_xxx) to remove"),
});

const ListEarlyFraudWarningsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  charge: z.string().optional().describe("Filter by charge ID (ch_xxx)"),
  payment_intent: z.string().optional().describe("Filter by payment intent ID (pi_xxx)"),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetEarlyFraudWarningSchema = z.object({
  warning_id: z.string().describe("Stripe early fraud warning ID (issfwd_xxx)"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_value_lists",
      title: "List Radar Value Lists",
      description:
        "List Stripe Radar value lists. Value lists are used in Radar rules to block or allow specific values (e.g. IP addresses, emails, card fingerprints). Optionally filter by alias or search for lists containing a specific value.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          alias: { type: "string", description: "Filter by exact alias (e.g. 'blocked_ips')" },
          contains: { type: "string", description: "Filter lists that contain this value" },
          starting_after: { type: "string", description: "Pagination cursor" },
          ending_before: { type: "string", description: "Pagination cursor — reversed" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_value_list",
      title: "Get Radar Value List",
      description: "Retrieve a specific Radar value list by ID (rsl_xxx). Returns alias, name, item_type, and item count.",
      inputSchema: {
        type: "object",
        properties: { value_list_id: { type: "string", description: "Radar value list ID (rsl_xxx)" } },
        required: ["value_list_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_value_list",
      title: "Create Radar Value List",
      description:
        "Create a new Radar value list. Choose the item_type carefully — it determines what values can be added (e.g. 'ip_address' for IPs, 'email' for emails, 'card_fingerprint' for cards). The alias is used in Radar rule conditions.",
      inputSchema: {
        type: "object",
        properties: {
          alias: { type: "string", description: "Unique alias for use in Radar rules (e.g. 'blocked_ips')" },
          name: { type: "string", description: "Human-readable display name" },
          item_type: {
            type: "string",
            enum: ["card_bin", "card_fingerprint", "case_sensitive_string", "country", "customer_id", "email", "ip_address", "sepa_debit_fingerprint", "string", "us_bank_account_fingerprint"],
            description: "Type of values this list accepts",
          },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["alias", "name", "item_type"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "delete_value_list",
      title: "Delete Radar Value List",
      description:
        "Delete a Radar value list and all its items. This also removes the list from any Radar rules that reference it — those rules may stop working. This action is permanent.",
      inputSchema: {
        type: "object",
        properties: { value_list_id: { type: "string", description: "Radar value list ID (rsl_xxx) to delete" } },
        required: ["value_list_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "list_value_list_items",
      title: "List Radar Value List Items",
      description:
        "List all items in a Radar value list. Returns the individual values (e.g. IP addresses, emails) that have been added to the list. Optionally filter by exact value.",
      inputSchema: {
        type: "object",
        properties: {
          value_list: { type: "string", description: "Value list ID (rsl_xxx)" },
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          value: { type: "string", description: "Filter by exact value" },
          starting_after: { type: "string", description: "Pagination cursor" },
          ending_before: { type: "string", description: "Pagination cursor — reversed" },
        },
        required: ["value_list"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_value_list_item",
      title: "Create Radar Value List Item",
      description:
        "Add a value to a Radar value list. The value must match the list's item_type. For example, add an IP address to a list with item_type 'ip_address', or an email to an 'email' list.",
      inputSchema: {
        type: "object",
        properties: {
          value_list: { type: "string", description: "Value list ID (rsl_xxx) to add this item to" },
          value: { type: "string", description: "Value to add (must match the list's item_type)" },
        },
        required: ["value_list", "value"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "delete_value_list_item",
      title: "Delete Radar Value List Item",
      description: "Remove a specific item from a Radar value list. The item will no longer be matched in Radar rules that reference the list.",
      inputSchema: {
        type: "object",
        properties: { item_id: { type: "string", description: "Value list item ID (rsli_xxx) to remove" } },
        required: ["item_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "list_early_fraud_warnings",
      title: "List Early Fraud Warnings",
      description:
        "List Stripe Radar early fraud warnings (EFWs). EFWs are issued by card networks when a payment is suspected to be fraudulent — they're an early signal before a chargeback arrives. Optionally filter by charge or payment intent.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          charge: { type: "string", description: "Filter by charge ID (ch_xxx)" },
          payment_intent: { type: "string", description: "Filter by payment intent ID (pi_xxx)" },
          starting_after: { type: "string", description: "Pagination cursor" },
          ending_before: { type: "string", description: "Pagination cursor — reversed" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_early_fraud_warning",
      title: "Get Early Fraud Warning",
      description: "Retrieve a specific early fraud warning (EFW) by ID. Returns fraud_type, actionable, charge, payment_intent, and created timestamp.",
      inputSchema: {
        type: "object",
        properties: { warning_id: { type: "string", description: "Early fraud warning ID (issfwd_xxx)" } },
        required: ["warning_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_value_lists: async (args) => {
      const params = ListValueListsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.alias) q.alias = params.alias;
      if (params.contains) q.contains = params.contains;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_value_lists", () =>
        client.list<Record<string, unknown>>("/radar/value_lists", q)
      , { tool: "list_value_lists" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_value_list: async (args) => {
      const { value_list_id } = GetValueListSchema.parse(args);
      const list = await logger.time("tool.get_value_list", () =>
        client.get<Record<string, unknown>>(`/radar/value_lists/${value_list_id}`)
      , { tool: "get_value_list", value_list_id });
      return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }], structuredContent: list };
    },

    create_value_list: async (args) => {
      const params = CreateValueListSchema.parse(args);
      const body: Record<string, unknown> = { alias: params.alias, name: params.name, item_type: params.item_type };
      if (params.metadata) body.metadata = params.metadata;

      const list = await logger.time("tool.create_value_list", () =>
        client.post<Record<string, unknown>>("/radar/value_lists", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_value_list" });
      return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }], structuredContent: list };
    },

    delete_value_list: async (args) => {
      const { value_list_id } = DeleteValueListSchema.parse(args);
      const result = await logger.time("tool.delete_value_list", () =>
        client.delete<Record<string, unknown>>(`/radar/value_lists/${value_list_id}`)
      , { tool: "delete_value_list", value_list_id });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    list_value_list_items: async (args) => {
      const params = ListValueListItemsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
        value_list: params.value_list,
      };
      if (params.value) q.value = params.value;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_value_list_items", () =>
        client.list<Record<string, unknown>>("/radar/value_list_items", q)
      , { tool: "list_value_list_items", value_list: params.value_list });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    create_value_list_item: async (args) => {
      const params = CreateValueListItemSchema.parse(args);
      const body = { value_list: params.value_list, value: params.value };

      const item = await logger.time("tool.create_value_list_item", () =>
        client.post<Record<string, unknown>>("/radar/value_list_items", body)
      , { tool: "create_value_list_item" });
      return { content: [{ type: "text", text: JSON.stringify(item, null, 2) }], structuredContent: item };
    },

    delete_value_list_item: async (args) => {
      const { item_id } = DeleteValueListItemSchema.parse(args);
      const result = await logger.time("tool.delete_value_list_item", () =>
        client.delete<Record<string, unknown>>(`/radar/value_list_items/${item_id}`)
      , { tool: "delete_value_list_item", item_id });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    list_early_fraud_warnings: async (args) => {
      const params = ListEarlyFraudWarningsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.charge) q.charge = params.charge;
      if (params.payment_intent) q.payment_intent = params.payment_intent;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_early_fraud_warnings", () =>
        client.list<Record<string, unknown>>("/radar/early_fraud_warnings", q)
      , { tool: "list_early_fraud_warnings" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_early_fraud_warning: async (args) => {
      const { warning_id } = GetEarlyFraudWarningSchema.parse(args);
      const warning = await logger.time("tool.get_early_fraud_warning", () =>
        client.get<Record<string, unknown>>(`/radar/early_fraud_warnings/${warning_id}`)
      , { tool: "get_early_fraud_warning", warning_id });
      return { content: [{ type: "text", text: JSON.stringify(warning, null, 2) }], structuredContent: warning };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
