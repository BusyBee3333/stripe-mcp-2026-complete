// Financial Connections tools — Stripe API v1
// Covers: Sessions (create, retrieve), Accounts (list, retrieve, refresh, subscribe, unsubscribe, disconnect),
//         Account Owners (list)

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const CreateFCSessionSchema = z.object({
  account_holder_type: z.enum(["account", "customer"]).describe("Type of account holder: 'account' (the platform itself) or 'customer' (a specific customer)"),
  account_holder_id: z.string().optional().describe("Customer ID (cus_xxx) if account_holder_type is 'customer'"),
  permissions: z.array(z.enum(["balances", "ownership", "payment_method", "transactions"])).min(1).describe("What data you want access to from the linked account"),
  filters_countries: z.array(z.string()).optional().describe("Two-letter country codes to restrict institution choices (e.g. ['US'])"),
  return_url: z.string().url().optional().describe("URL to redirect after the financial connections flow"),
});

const GetFCSessionSchema = z.object({
  session_id: z.string().describe("Financial Connections session ID (fcsess_xxx)"),
});

const ListFCAccountsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  account_holder_customer: z.string().optional().describe("Filter by customer ID (cus_xxx)"),
  session: z.string().optional().describe("Filter by session ID (fcsess_xxx)"),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetFCAccountSchema = z.object({
  account_id: z.string().describe("Financial Connections account ID (fca_xxx)"),
});

const RefreshFCAccountSchema = z.object({
  account_id: z.string().describe("Financial Connections account ID (fca_xxx)"),
  features: z.array(z.enum(["balance", "ownership", "transactions"])).min(1).describe("Data to refresh"),
});

const ListFCAccountOwnersSchema = z.object({
  account_id: z.string().describe("Financial Connections account ID (fca_xxx)"),
  ownership: z.string().describe("Ownership ID from the account (required by API)"),
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const SubscribeFCAccountSchema = z.object({
  account_id: z.string().describe("Financial Connections account ID (fca_xxx)"),
  features: z.array(z.enum(["transactions"])).min(1).describe("Features to subscribe to (currently only 'transactions')"),
});

const UnsubscribeFCAccountSchema = z.object({
  account_id: z.string().describe("Financial Connections account ID (fca_xxx)"),
  features: z.array(z.enum(["transactions"])).min(1).describe("Features to unsubscribe from"),
});

const DisconnectFCAccountSchema = z.object({
  account_id: z.string().describe("Financial Connections account ID (fca_xxx) to disconnect"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "create_financial_connections_session",
      title: "Create Financial Connections Session",
      description:
        "Create a Stripe Financial Connections session. This generates a client_secret for the Stripe.js Financial Connections flow, allowing users to link their bank accounts. Specify the permissions you need (balances, ownership, payment_method, transactions).",
      inputSchema: {
        type: "object",
        properties: {
          account_holder_type: { type: "string", enum: ["account", "customer"], description: "Account holder type" },
          account_holder_id: { type: "string", description: "Customer ID (cus_xxx) for customer type" },
          permissions: { type: "array", description: "Required permissions: balances, ownership, payment_method, transactions" },
          filters_countries: { type: "array", description: "Restrict to specific countries (e.g. ['US'])" },
          return_url: { type: "string", description: "URL after the flow completes" },
        },
        required: ["account_holder_type", "permissions"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_financial_connections_session",
      title: "Get Financial Connections Session",
      description: "Retrieve a Financial Connections session by ID (fcsess_xxx). Returns the session's linked accounts and status.",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string", description: "Financial Connections session ID (fcsess_xxx)" } },
        required: ["session_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_financial_connections_accounts",
      title: "List Financial Connections Accounts",
      description:
        "List all connected Financial Connections accounts. Each account represents a bank account linked via the Financial Connections flow. Optionally filter by customer or session.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
          account_holder_customer: { type: "string", description: "Filter by customer ID" },
          session: { type: "string", description: "Filter by session ID" },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_financial_connections_account",
      title: "Get Financial Connections Account",
      description: "Retrieve a specific Financial Connections account by ID (fca_xxx). Returns institution name, last4, category, subcategory, balance, and available data.",
      inputSchema: {
        type: "object",
        properties: { account_id: { type: "string", description: "Financial Connections account ID (fca_xxx)" } },
        required: ["account_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "refresh_financial_connections_account",
      title: "Refresh Financial Connections Account",
      description: "Refresh data for a Financial Connections account. Use to get updated balance, ownership, or transaction data from the linked institution.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Financial Connections account ID (fca_xxx)" },
          features: { type: "array", description: "Features to refresh: balance, ownership, transactions" },
        },
        required: ["account_id", "features"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "list_financial_connections_account_owners",
      title: "List Financial Connections Account Owners",
      description: "List the owners (individuals with legal ownership/control) of a Financial Connections account. Returns name, email, phone, and address for each owner.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Financial Connections account ID (fca_xxx)" },
          ownership: { type: "string", description: "Ownership ID from the account object" },
          limit: { type: "number" },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
        required: ["account_id", "ownership"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "subscribe_financial_connections_account",
      title: "Subscribe to Financial Connections Account",
      description: "Subscribe to data updates for a Financial Connections account. Currently supports subscribing to 'transactions' for real-time transaction updates.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Financial Connections account ID (fca_xxx)" },
          features: { type: "array", description: "Features to subscribe to (e.g. ['transactions'])" },
        },
        required: ["account_id", "features"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "unsubscribe_financial_connections_account",
      title: "Unsubscribe from Financial Connections Account",
      description: "Unsubscribe from data updates for a Financial Connections account.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Financial Connections account ID (fca_xxx)" },
          features: { type: "array", description: "Features to unsubscribe from" },
        },
        required: ["account_id", "features"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "disconnect_financial_connections_account",
      title: "Disconnect Financial Connections Account",
      description: "Disconnect a Financial Connections account. The account will be disconnected from your platform and can no longer be used.",
      inputSchema: {
        type: "object",
        properties: { account_id: { type: "string", description: "Financial Connections account ID (fca_xxx)" } },
        required: ["account_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    create_financial_connections_session: async (args) => {
      const params = CreateFCSessionSchema.parse(args);
      const body: Record<string, unknown> = {
        "account_holder[type]": params.account_holder_type,
      };
      if (params.account_holder_id) body["account_holder[customer]"] = params.account_holder_id;
      params.permissions.forEach((p, i) => { body[`permissions[${i}]`] = p; });
      if (params.filters_countries) {
        params.filters_countries.forEach((c, i) => { body[`filters[countries][${i}]`] = c; });
      }
      if (params.return_url) body.return_url = params.return_url;

      const r = await logger.time("tool.create_financial_connections_session", () =>
        client.post<Record<string, unknown>>("/financial_connections/sessions", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_financial_connections_session" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    get_financial_connections_session: async (args) => {
      const { session_id } = GetFCSessionSchema.parse(args);
      const r = await logger.time("tool.get_financial_connections_session", () =>
        client.get<Record<string, unknown>>(`/financial_connections/sessions/${session_id}`)
      , { tool: "get_financial_connections_session" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_financial_connections_accounts: async (args) => {
      const params = ListFCAccountsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.account_holder_customer) q["account_holder[customer]"] = params.account_holder_customer;
      if (params.session) q.session = params.session;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_financial_connections_accounts", () =>
        client.list<Record<string, unknown>>("/financial_connections/accounts", q)
      , { tool: "list_financial_connections_accounts" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_financial_connections_account: async (args) => {
      const { account_id } = GetFCAccountSchema.parse(args);
      const r = await logger.time("tool.get_financial_connections_account", () =>
        client.get<Record<string, unknown>>(`/financial_connections/accounts/${account_id}`)
      , { tool: "get_financial_connections_account" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    refresh_financial_connections_account: async (args) => {
      const params = RefreshFCAccountSchema.parse(args);
      const body: Record<string, unknown> = {};
      params.features.forEach((f, i) => { body[`features[${i}]`] = f; });

      const r = await logger.time("tool.refresh_financial_connections_account", () =>
        client.post<Record<string, unknown>>(`/financial_connections/accounts/${params.account_id}/refresh`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "refresh_financial_connections_account" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_financial_connections_account_owners: async (args) => {
      const params = ListFCAccountOwnersSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
        ownership: params.ownership,
      };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_financial_connections_account_owners", () =>
        client.list<Record<string, unknown>>(`/financial_connections/accounts/${params.account_id}/owners`, q)
      , { tool: "list_financial_connections_account_owners" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    subscribe_financial_connections_account: async (args) => {
      const params = SubscribeFCAccountSchema.parse(args);
      const body: Record<string, unknown> = {};
      params.features.forEach((f, i) => { body[`features[${i}]`] = f; });

      const r = await logger.time("tool.subscribe_financial_connections_account", () =>
        client.post<Record<string, unknown>>(`/financial_connections/accounts/${params.account_id}/subscribe`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "subscribe_financial_connections_account" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    unsubscribe_financial_connections_account: async (args) => {
      const params = UnsubscribeFCAccountSchema.parse(args);
      const body: Record<string, unknown> = {};
      params.features.forEach((f, i) => { body[`features[${i}]`] = f; });

      const r = await logger.time("tool.unsubscribe_financial_connections_account", () =>
        client.post<Record<string, unknown>>(`/financial_connections/accounts/${params.account_id}/unsubscribe`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "unsubscribe_financial_connections_account" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    disconnect_financial_connections_account: async (args) => {
      const { account_id } = DisconnectFCAccountSchema.parse(args);
      const r = await logger.time("tool.disconnect_financial_connections_account", () =>
        client.post<Record<string, unknown>>(`/financial_connections/accounts/${account_id}/disconnect`, {})
      , { tool: "disconnect_financial_connections_account" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
