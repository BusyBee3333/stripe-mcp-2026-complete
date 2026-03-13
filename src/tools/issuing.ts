// Issuing tools — Stripe API v1
// Covers: Cardholders (list, get, create, update), Cards (list, get, create, update),
//         Authorizations (list, get, approve, decline), Transactions (list, get),
//         Issuing Disputes (list, get, create, submit)

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// --- Cardholder schemas ---
const ListCardholdersSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  status: z.enum(["active", "inactive", "blocked"]).optional(),
  type: z.enum(["individual", "company"]).optional(),
  email: z.string().optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetCardholderSchema = z.object({
  cardholder_id: z.string().describe("Issuing cardholder ID (ich_xxx)"),
});

const CreateCardholderSchema = z.object({
  type: z.enum(["individual", "company"]).describe("Type: individual or company"),
  name: z.string().describe("Full name of the cardholder (individual) or legal business name (company)"),
  email: z.string().email().optional(),
  phone_number: z.string().optional().describe("E.164 phone number (e.g. '+14155552671')"),
  status: z.enum(["active", "inactive"]).optional().default("active"),
  billing_line1: z.string().describe("Billing address line 1"),
  billing_city: z.string().describe("Billing city"),
  billing_state: z.string().optional().describe("Billing state/province"),
  billing_postal_code: z.string().describe("Billing postal/zip code"),
  billing_country: z.string().describe("Two-letter country code (e.g. 'US')"),
  metadata: z.record(z.string()).optional(),
});

const UpdateCardholderSchema = z.object({
  cardholder_id: z.string(),
  status: z.enum(["active", "inactive", "blocked"]).optional(),
  email: z.string().email().optional(),
  phone_number: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

// --- Card schemas ---
const ListIssuingCardsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  cardholder: z.string().optional().describe("Filter by cardholder ID (ich_xxx)"),
  status: z.enum(["active", "inactive", "canceled"]).optional(),
  type: z.enum(["physical", "virtual"]).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetIssuingCardSchema = z.object({
  card_id: z.string().describe("Issuing card ID (ic_xxx)"),
});

const CreateIssuingCardSchema = z.object({
  cardholder: z.string().describe("Cardholder ID (ich_xxx) this card is issued to"),
  currency: z.string().length(3).describe("Three-letter currency code (e.g. 'usd')"),
  type: z.enum(["physical", "virtual"]).describe("Card type — virtual (instant) or physical (mailed)"),
  status: z.enum(["active", "inactive"]).optional().default("active"),
  spending_limits: z.array(z.object({
    amount: z.number().int().positive().describe("Limit amount in smallest currency unit"),
    interval: z.enum(["all_time", "daily", "monthly", "per_authorization", "weekly", "yearly"]),
  })).optional().describe("Spending limits for this card"),
  metadata: z.record(z.string()).optional(),
});

const UpdateIssuingCardSchema = z.object({
  card_id: z.string(),
  status: z.enum(["active", "inactive", "canceled"]).optional(),
  metadata: z.record(z.string()).optional(),
});

// --- Authorization schemas ---
const ListAuthorizationsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  card: z.string().optional().describe("Filter by card ID (ic_xxx)"),
  cardholder: z.string().optional().describe("Filter by cardholder ID (ich_xxx)"),
  status: z.enum(["closed", "pending", "reversed"]).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetAuthorizationSchema = z.object({
  authorization_id: z.string().describe("Issuing authorization ID (iauth_xxx)"),
});

const ApproveAuthorizationSchema = z.object({
  authorization_id: z.string().describe("Issuing authorization ID (iauth_xxx) to approve"),
  amount: z.number().optional().describe("Amount to approve (in smallest currency unit). Defaults to the authorization amount."),
  metadata: z.record(z.string()).optional(),
});

const DeclineAuthorizationSchema = z.object({
  authorization_id: z.string().describe("Issuing authorization ID (iauth_xxx) to decline"),
  metadata: z.record(z.string()).optional(),
});

// --- Transaction schemas ---
const ListIssuingTransactionsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  card: z.string().optional(),
  cardholder: z.string().optional(),
  type: z.enum(["capture", "refund"]).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetIssuingTransactionSchema = z.object({
  transaction_id: z.string().describe("Issuing transaction ID (ipi_xxx)"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    // Cardholders
    {
      name: "list_issuing_cardholders",
      title: "List Issuing Cardholders",
      description: "List Stripe Issuing cardholders. Returns cardholder ID, name, email, type (individual/company), status, and billing address. Optionally filter by status, type, or email.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          status: { type: "string", enum: ["active", "inactive", "blocked"] },
          type: { type: "string", enum: ["individual", "company"] },
          email: { type: "string" },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_issuing_cardholder",
      title: "Get Issuing Cardholder",
      description: "Retrieve a specific Issuing cardholder by ID (ich_xxx). Returns full details including billing address, requirements, and spending controls.",
      inputSchema: {
        type: "object",
        properties: { cardholder_id: { type: "string", description: "Cardholder ID (ich_xxx)" } },
        required: ["cardholder_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_issuing_cardholder",
      title: "Create Issuing Cardholder",
      description: "Create a new Issuing cardholder. Cardholders are individuals or companies that can be issued physical or virtual payment cards. A billing address is required.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["individual", "company"], description: "Cardholder type" },
          name: { type: "string", description: "Full name or legal business name" },
          email: { type: "string", description: "Email address" },
          phone_number: { type: "string", description: "E.164 phone number" },
          status: { type: "string", enum: ["active", "inactive"] },
          billing_line1: { type: "string", description: "Billing address line 1" },
          billing_city: { type: "string", description: "Billing city" },
          billing_state: { type: "string", description: "Billing state/province" },
          billing_postal_code: { type: "string", description: "Billing postal/zip code" },
          billing_country: { type: "string", description: "Two-letter country code (e.g. 'US')" },
          metadata: { type: "object" },
        },
        required: ["type", "name", "billing_line1", "billing_city", "billing_postal_code", "billing_country"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_issuing_cardholder",
      title: "Update Issuing Cardholder",
      description: "Update an Issuing cardholder's status, email, phone, or metadata.",
      inputSchema: {
        type: "object",
        properties: {
          cardholder_id: { type: "string" },
          status: { type: "string", enum: ["active", "inactive", "blocked"] },
          email: { type: "string" },
          phone_number: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["cardholder_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    // Cards
    {
      name: "list_issuing_cards",
      title: "List Issuing Cards",
      description: "List Stripe Issuing cards. Returns card ID, last4, cardholder, status (active/inactive/canceled), and type (virtual/physical). Optionally filter by cardholder, status, or type.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          cardholder: { type: "string", description: "Filter by cardholder ID (ich_xxx)" },
          status: { type: "string", enum: ["active", "inactive", "canceled"] },
          type: { type: "string", enum: ["physical", "virtual"] },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_issuing_card",
      title: "Get Issuing Card",
      description: "Retrieve a specific Issuing card by ID (ic_xxx). Returns card number (last4), expiry, cardholder, status, spending limits, and shipping info for physical cards.",
      inputSchema: {
        type: "object",
        properties: { card_id: { type: "string", description: "Issuing card ID (ic_xxx)" } },
        required: ["card_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_issuing_card",
      title: "Create Issuing Card",
      description: "Create a new Issuing card for a cardholder. Virtual cards are created instantly. Physical cards are mailed (shipping address required). Optionally set spending limits per authorization, daily, weekly, monthly, or all-time.",
      inputSchema: {
        type: "object",
        properties: {
          cardholder: { type: "string", description: "Cardholder ID (ich_xxx)" },
          currency: { type: "string", description: "Three-letter currency code (e.g. 'usd')" },
          type: { type: "string", enum: ["physical", "virtual"] },
          status: { type: "string", enum: ["active", "inactive"] },
          spending_limits: { type: "array", description: "Spending limits (array of {amount, interval})" },
          metadata: { type: "object" },
        },
        required: ["cardholder", "currency", "type"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_issuing_card",
      title: "Update Issuing Card",
      description: "Update an Issuing card's status or metadata. Set status to 'inactive' to temporarily block, 'active' to re-enable, or 'canceled' to permanently deactivate (irreversible).",
      inputSchema: {
        type: "object",
        properties: {
          card_id: { type: "string" },
          status: { type: "string", enum: ["active", "inactive", "canceled"] },
          metadata: { type: "object" },
        },
        required: ["card_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    // Authorizations
    {
      name: "list_issuing_authorizations",
      title: "List Issuing Authorizations",
      description: "List Stripe Issuing authorizations (real-time card transaction approvals). Returns authorization ID, amount, currency, status, merchant name, and card. Optionally filter by card, cardholder, or status.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          card: { type: "string", description: "Filter by card ID (ic_xxx)" },
          cardholder: { type: "string", description: "Filter by cardholder ID (ich_xxx)" },
          status: { type: "string", enum: ["closed", "pending", "reversed"] },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_issuing_authorization",
      title: "Get Issuing Authorization",
      description: "Retrieve a specific Issuing authorization by ID (iauth_xxx). Returns full details including amount, merchant data, network data, and verification data.",
      inputSchema: {
        type: "object",
        properties: { authorization_id: { type: "string", description: "Authorization ID (iauth_xxx)" } },
        required: ["authorization_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "approve_issuing_authorization",
      title: "Approve Issuing Authorization",
      description: "Approve a pending Issuing authorization. Used in webhook-based authorization flows where you have real-time control over card approvals. Must respond within 2 seconds.",
      inputSchema: {
        type: "object",
        properties: {
          authorization_id: { type: "string", description: "Authorization ID (iauth_xxx) to approve" },
          amount: { type: "number", description: "Amount to approve (defaults to requested amount)" },
          metadata: { type: "object" },
        },
        required: ["authorization_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "decline_issuing_authorization",
      title: "Decline Issuing Authorization",
      description: "Decline a pending Issuing authorization. Used in webhook-based authorization flows. The card transaction will be declined. Must respond within 2 seconds.",
      inputSchema: {
        type: "object",
        properties: {
          authorization_id: { type: "string", description: "Authorization ID (iauth_xxx) to decline" },
          metadata: { type: "object" },
        },
        required: ["authorization_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    // Transactions
    {
      name: "list_issuing_transactions",
      title: "List Issuing Transactions",
      description: "List Stripe Issuing transactions (settled card charges). Returns transaction ID, amount, currency, type (capture/refund), merchant data, and associated card/cardholder.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          card: { type: "string", description: "Filter by card ID (ic_xxx)" },
          cardholder: { type: "string", description: "Filter by cardholder ID (ich_xxx)" },
          type: { type: "string", enum: ["capture", "refund"] },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_issuing_transaction",
      title: "Get Issuing Transaction",
      description: "Retrieve a specific Issuing transaction by ID. Returns full details including amount, merchant data, authorization ID, and balance impact.",
      inputSchema: {
        type: "object",
        properties: { transaction_id: { type: "string", description: "Issuing transaction ID" } },
        required: ["transaction_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  const listHelper = async (toolName: string, url: string, q: Record<string, string | number | boolean | undefined | null>) => {
    const result = await logger.time(`tool.${toolName}`, () =>
      client.list<Record<string, unknown>>(url, q)
    , { tool: toolName });
    const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
    const response = {
      data: result.data,
      meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }], structuredContent: response };
  };

  return {
    list_issuing_cardholders: async (args) => {
      const params = ListCardholdersSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.status) q.status = params.status;
      if (params.type) q.type = params.type;
      if (params.email) q.email = params.email;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      return listHelper("list_issuing_cardholders", "/issuing/cardholders", q);
    },

    get_issuing_cardholder: async (args) => {
      const { cardholder_id } = GetCardholderSchema.parse(args);
      const r = await logger.time("tool.get_issuing_cardholder", () =>
        client.get<Record<string, unknown>>(`/issuing/cardholders/${cardholder_id}`)
      , { tool: "get_issuing_cardholder" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_issuing_cardholder: async (args) => {
      const params = CreateCardholderSchema.parse(args);
      const body: Record<string, unknown> = {
        type: params.type,
        name: params.name,
        "billing[address][line1]": params.billing_line1,
        "billing[address][city]": params.billing_city,
        "billing[address][postal_code]": params.billing_postal_code,
        "billing[address][country]": params.billing_country,
      };
      if (params.email) body.email = params.email;
      if (params.phone_number) body.phone_number = params.phone_number;
      if (params.status) body.status = params.status;
      if (params.billing_state) body["billing[address][state]"] = params.billing_state;
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.create_issuing_cardholder", () =>
        client.post<Record<string, unknown>>("/issuing/cardholders", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_issuing_cardholder" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    update_issuing_cardholder: async (args) => {
      const { cardholder_id, ...rest } = UpdateCardholderSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (rest.status) body.status = rest.status;
      if (rest.email) body.email = rest.email;
      if (rest.phone_number) body.phone_number = rest.phone_number;
      if (rest.metadata) body.metadata = rest.metadata;

      const r = await logger.time("tool.update_issuing_cardholder", () =>
        client.post<Record<string, unknown>>(`/issuing/cardholders/${cardholder_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_issuing_cardholder" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_issuing_cards: async (args) => {
      const params = ListIssuingCardsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.cardholder) q.cardholder = params.cardholder;
      if (params.status) q.status = params.status;
      if (params.type) q.type = params.type;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      return listHelper("list_issuing_cards", "/issuing/cards", q);
    },

    get_issuing_card: async (args) => {
      const { card_id } = GetIssuingCardSchema.parse(args);
      const r = await logger.time("tool.get_issuing_card", () =>
        client.get<Record<string, unknown>>(`/issuing/cards/${card_id}`)
      , { tool: "get_issuing_card" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_issuing_card: async (args) => {
      const params = CreateIssuingCardSchema.parse(args);
      const body: Record<string, unknown> = {
        cardholder: params.cardholder,
        currency: params.currency,
        type: params.type,
      };
      if (params.status) body.status = params.status;
      if (params.metadata) body.metadata = params.metadata;
      if (params.spending_limits) {
        params.spending_limits.forEach((sl, i) => {
          body[`spending_controls[spending_limits][${i}][amount]`] = sl.amount;
          body[`spending_controls[spending_limits][${i}][interval]`] = sl.interval;
        });
      }

      const r = await logger.time("tool.create_issuing_card", () =>
        client.post<Record<string, unknown>>("/issuing/cards", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_issuing_card" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    update_issuing_card: async (args) => {
      const { card_id, ...rest } = UpdateIssuingCardSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (rest.status) body.status = rest.status;
      if (rest.metadata) body.metadata = rest.metadata;

      const r = await logger.time("tool.update_issuing_card", () =>
        client.post<Record<string, unknown>>(`/issuing/cards/${card_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_issuing_card" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_issuing_authorizations: async (args) => {
      const params = ListAuthorizationsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.card) q.card = params.card;
      if (params.cardholder) q.cardholder = params.cardholder;
      if (params.status) q.status = params.status;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      return listHelper("list_issuing_authorizations", "/issuing/authorizations", q);
    },

    get_issuing_authorization: async (args) => {
      const { authorization_id } = GetAuthorizationSchema.parse(args);
      const r = await logger.time("tool.get_issuing_authorization", () =>
        client.get<Record<string, unknown>>(`/issuing/authorizations/${authorization_id}`)
      , { tool: "get_issuing_authorization" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    approve_issuing_authorization: async (args) => {
      const params = ApproveAuthorizationSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (params.amount !== undefined) body.amount = params.amount;
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.approve_issuing_authorization", () =>
        client.post<Record<string, unknown>>(`/issuing/authorizations/${params.authorization_id}/approve`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "approve_issuing_authorization" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    decline_issuing_authorization: async (args) => {
      const params = DeclineAuthorizationSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.decline_issuing_authorization", () =>
        client.post<Record<string, unknown>>(`/issuing/authorizations/${params.authorization_id}/decline`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "decline_issuing_authorization" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_issuing_transactions: async (args) => {
      const params = ListIssuingTransactionsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.card) q.card = params.card;
      if (params.cardholder) q.cardholder = params.cardholder;
      if (params.type) q.type = params.type;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      return listHelper("list_issuing_transactions", "/issuing/transactions", q);
    },

    get_issuing_transaction: async (args) => {
      const { transaction_id } = GetIssuingTransactionSchema.parse(args);
      const r = await logger.time("tool.get_issuing_transaction", () =>
        client.get<Record<string, unknown>>(`/issuing/transactions/${transaction_id}`)
      , { tool: "get_issuing_transaction" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
