// Stripe Connect tools — Stripe API v1
// Covers: list_connected_accounts, get_connected_account, create_account_link,
//         create_account_session, reject_account

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListConnectedAccountsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — for reversed pagination"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
});

const GetConnectedAccountSchema = z.object({
  account_id: z.string().describe("Stripe connected account ID (acct_xxx)"),
});

const CreateAccountLinkSchema = z.object({
  account: z.string().describe("Stripe connected account ID (acct_xxx) to create the link for"),
  refresh_url: z.string().url().describe("URL to redirect if the link expires or the user clicks back before completing"),
  return_url: z.string().url().describe("URL to redirect after the account link flow is completed"),
  type: z.enum(["account_onboarding", "account_update"]).describe("Type of account link: account_onboarding (new Connect accounts) or account_update (update existing info)"),
  collection_options: z.object({
    fields: z.enum(["currently_due", "eventually_due"]).optional().describe("Which fields to collect: currently_due (minimum to activate) or eventually_due (all fields)"),
    future_requirements: z.enum(["include", "omit"]).optional().describe("Whether to include future requirements in collection"),
  }).optional().describe("Control which fields to collect in the onboarding flow"),
});

const CreateAccountSessionSchema = z.object({
  account: z.string().describe("Stripe connected account ID (acct_xxx) — the account that will use the embedded UI component"),
  components: z.object({
    account_onboarding: z.object({
      enabled: z.boolean().describe("Enable embedded account onboarding component"),
      features: z.record(z.boolean()).optional().describe("Component-specific features to enable/disable"),
    }).optional().describe("Account onboarding component"),
    account_management: z.object({
      enabled: z.boolean().describe("Enable embedded account management component"),
      features: z.record(z.boolean()).optional().describe("Component-specific features"),
    }).optional().describe("Account management component"),
    balances: z.object({
      enabled: z.boolean().describe("Enable embedded balances component"),
      features: z.record(z.boolean()).optional().describe("Component-specific features"),
    }).optional().describe("Balances component"),
    documents: z.object({
      enabled: z.boolean().describe("Enable embedded documents component"),
      features: z.record(z.boolean()).optional().describe("Component-specific features"),
    }).optional().describe("Documents component"),
    notification_banner: z.object({
      enabled: z.boolean().describe("Enable embedded notification banner component"),
      features: z.record(z.boolean()).optional().describe("Component-specific features"),
    }).optional().describe("Notification banner component"),
    payment_details: z.object({
      enabled: z.boolean().describe("Enable embedded payment details component"),
      features: z.record(z.boolean()).optional().describe("Component-specific features"),
    }).optional().describe("Payment details component"),
    payments: z.object({
      enabled: z.boolean().describe("Enable embedded payments component"),
      features: z.record(z.boolean()).optional().describe("Component-specific features"),
    }).optional().describe("Payments component"),
    payouts: z.object({
      enabled: z.boolean().describe("Enable embedded payouts component"),
      features: z.record(z.boolean()).optional().describe("Component-specific features"),
    }).optional().describe("Payouts component"),
    payouts_list: z.object({
      enabled: z.boolean().describe("Enable embedded payouts list component"),
      features: z.record(z.boolean()).optional().describe("Component-specific features"),
    }).optional().describe("Payouts list component"),
  }).describe("Connect embedded UI components to enable for this session"),
});

const RejectAccountSchema = z.object({
  account_id: z.string().describe("Stripe connected account ID (acct_xxx) to reject"),
  reason: z.enum(["fraud", "terms_of_service", "other"]).describe("Rejection reason: fraud (fraudulent account), terms_of_service (ToS violation), or other"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_connected_accounts",
      title: "List Connected Accounts",
      description:
        "List all Stripe Connect connected accounts on this platform. Returns account IDs, business type, charges_enabled, payouts_enabled, and requirements. Uses keyset pagination via starting_after.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          starting_after: { type: "string", description: "Pagination cursor — last account ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
          created_gte: { type: "number", description: "Filter by creation time (Unix timestamp, >=)" },
          created_lte: { type: "number", description: "Filter by creation time (Unix timestamp, <=)" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_connected_account",
      title: "Get Connected Account",
      description:
        "Get full details for a Stripe Connect connected account by ID (acct_xxx). Returns business profile, capabilities, requirements, charges_enabled, payouts_enabled, and verification status.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Stripe connected account ID (acct_xxx)" },
        },
        required: ["account_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_account_link",
      title: "Create Account Link",
      description:
        "Create a Stripe Connect account link for onboarding a connected account. Returns a one-time URL (expires in ~5 minutes) to redirect the connected account through Stripe's hosted onboarding. Use type='account_onboarding' for new accounts, 'account_update' to update existing info.",
      inputSchema: {
        type: "object",
        properties: {
          account: { type: "string", description: "Connected account ID (acct_xxx)" },
          refresh_url: { type: "string", description: "URL if link expires or user clicks back" },
          return_url: { type: "string", description: "URL after onboarding is completed" },
          type: { type: "string", enum: ["account_onboarding", "account_update"], description: "Link type" },
          collection_options: {
            type: "object",
            description: "Control which fields to collect (fields: currently_due | eventually_due)",
          },
        },
        required: ["account", "refresh_url", "return_url", "type"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_account_session",
      title: "Create Account Session",
      description:
        "Create a Stripe Connect account session for embedding Stripe UI components (Connect embedded components) in your platform. Returns a client_secret for initializing StripeConnectInstance on the frontend. Enable specific components like account_onboarding, payments, payouts, balances.",
      inputSchema: {
        type: "object",
        properties: {
          account: { type: "string", description: "Connected account ID (acct_xxx)" },
          components: {
            type: "object",
            description: "UI components to enable: account_onboarding, account_management, balances, payments, payouts, payouts_list, payment_details, notification_banner, documents",
          },
        },
        required: ["account", "components"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "reject_account",
      title: "Reject Connected Account",
      description:
        "Reject a Stripe Connect connected account. Use for accounts that are fraudulent or in violation of your terms of service. This is permanent and cannot be undone — the account will be rejected and closed. Returns the rejected account object.",
      inputSchema: {
        type: "object",
        properties: {
          account_id: { type: "string", description: "Connected account ID (acct_xxx) to reject" },
          reason: { type: "string", enum: ["fraud", "terms_of_service", "other"], description: "Rejection reason" },
        },
        required: ["account_id", "reason"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_connected_accounts: async (args) => {
      const params = ListConnectedAccountsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_connected_accounts", () =>
        client.list<Record<string, unknown>>("/accounts", queryParams)
      , { tool: "list_connected_accounts" });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_connected_account: async (args) => {
      const { account_id } = GetConnectedAccountSchema.parse(args);
      const account = await logger.time("tool.get_connected_account", () =>
        client.get<Record<string, unknown>>(`/accounts/${account_id}`)
      , { tool: "get_connected_account", account_id });
      return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }], structuredContent: account };
    },

    create_account_link: async (args) => {
      const params = CreateAccountLinkSchema.parse(args);
      const body: Record<string, unknown> = {
        account: params.account,
        refresh_url: params.refresh_url,
        return_url: params.return_url,
        type: params.type,
      };
      if (params.collection_options?.fields) {
        body["collection_options[fields]"] = params.collection_options.fields;
      }
      if (params.collection_options?.future_requirements) {
        body["collection_options[future_requirements]"] = params.collection_options.future_requirements;
      }

      const link = await logger.time("tool.create_account_link", () =>
        client.post<Record<string, unknown>>("/account_links", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_account_link" });
      return { content: [{ type: "text", text: JSON.stringify(link, null, 2) }], structuredContent: link };
    },

    create_account_session: async (args) => {
      const params = CreateAccountSessionSchema.parse(args);
      const body: Record<string, unknown> = { account: params.account };

      const components = params.components;
      const componentKeys = [
        "account_onboarding", "account_management", "balances", "documents",
        "notification_banner", "payment_details", "payments", "payouts", "payouts_list"
      ] as const;

      for (const key of componentKeys) {
        const comp = components[key as keyof typeof components];
        if (comp) {
          body[`components[${key}][enabled]`] = comp.enabled;
          if (comp.features) {
            for (const [fk, fv] of Object.entries(comp.features)) {
              body[`components[${key}][features][${fk}]`] = fv;
            }
          }
        }
      }

      const session = await logger.time("tool.create_account_session", () =>
        client.post<Record<string, unknown>>("/account_sessions", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_account_session" });
      return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }], structuredContent: session };
    },

    reject_account: async (args) => {
      const { account_id, reason } = RejectAccountSchema.parse(args);
      const body: Record<string, string | number | boolean | undefined | null> = { reason };

      const account = await logger.time("tool.reject_account", () =>
        client.post<Record<string, unknown>>(`/accounts/${account_id}/reject`, body)
      , { tool: "reject_account", account_id });
      return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }], structuredContent: account };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
