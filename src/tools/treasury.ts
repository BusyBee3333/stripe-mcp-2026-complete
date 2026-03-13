// Treasury tools — Stripe API v1 (Stripe Treasury)
// Covers: Financial Accounts (list, get, create, update, retrieve_features, update_features),
//         Transactions (list, get), Outbound Payments (list, get, create, cancel),
//         Outbound Transfers (list, get, create, cancel), Inbound Transfers (list, get, create, cancel),
//         Received Credits (list, get), Received Debits (list, get)

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// --- Financial Account schemas ---
const ListFinancialAccountsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetFinancialAccountSchema = z.object({
  financial_account_id: z.string().describe("Treasury financial account ID (fa_xxx)"),
});

const CreateFinancialAccountSchema = z.object({
  supported_currencies: z.array(z.string()).min(1).describe("Currencies this financial account supports (e.g. ['usd'])"),
  features_card_issuing_enabled: z.boolean().optional().describe("Enable card issuing feature"),
  features_deposit_insurance_enabled: z.boolean().optional().describe("Enable deposit insurance"),
  features_financial_addresses_aba_enabled: z.boolean().optional().describe("Enable ABA financial address (US routing/account number)"),
  features_inbound_transfers_ach_enabled: z.boolean().optional().describe("Enable inbound ACH transfers"),
  features_intra_stripe_flows_enabled: z.boolean().optional().describe("Enable intra-Stripe flows (transfers between Stripe accounts)"),
  features_outbound_payments_ach_enabled: z.boolean().optional(),
  features_outbound_payments_us_domestic_wire_enabled: z.boolean().optional(),
  features_outbound_transfers_ach_enabled: z.boolean().optional(),
  metadata: z.record(z.string()).optional(),
});

// --- Treasury Transactions ---
const ListTreasuryTransactionsSchema = z.object({
  financial_account: z.string().describe("Financial account ID (fa_xxx) to list transactions for"),
  limit: z.number().min(1).max(100).optional().default(20),
  status: z.enum(["open", "posted", "void"]).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  created_gte: z.number().optional(),
  created_lte: z.number().optional(),
});

const GetTreasuryTransactionSchema = z.object({
  transaction_id: z.string().describe("Treasury transaction ID (trxn_xxx)"),
});

// --- Outbound Payments ---
const ListOutboundPaymentsSchema = z.object({
  financial_account: z.string().describe("Financial account ID (fa_xxx)"),
  limit: z.number().min(1).max(100).optional().default(20),
  status: z.enum(["canceled", "failed", "posted", "processing", "returned"]).optional(),
  customer: z.string().optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetOutboundPaymentSchema = z.object({
  payment_id: z.string().describe("Treasury outbound payment ID (tobp_xxx)"),
});

const CreateOutboundPaymentSchema = z.object({
  financial_account: z.string().describe("Source financial account ID (fa_xxx)"),
  amount: z.number().int().positive().describe("Amount in smallest currency unit"),
  currency: z.string().length(3).describe("Three-letter currency code"),
  customer: z.string().optional().describe("Customer ID (cus_xxx) if paying a customer"),
  destination_payment_method: z.string().optional().describe("Payment method ID (pm_xxx) to pay to"),
  description: z.string().optional(),
  statement_descriptor: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

const CancelOutboundPaymentSchema = z.object({
  payment_id: z.string().describe("Treasury outbound payment ID (tobp_xxx) to cancel"),
});

// --- Outbound Transfers ---
const ListOutboundTransfersSchema = z.object({
  financial_account: z.string().describe("Financial account ID (fa_xxx)"),
  limit: z.number().min(1).max(100).optional().default(20),
  status: z.enum(["canceled", "failed", "posted", "processing", "returned"]).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetOutboundTransferSchema = z.object({
  transfer_id: z.string().describe("Treasury outbound transfer ID (obt_xxx)"),
});

const CreateOutboundTransferSchema = z.object({
  financial_account: z.string().describe("Source financial account ID (fa_xxx)"),
  amount: z.number().int().positive().describe("Amount in smallest currency unit"),
  currency: z.string().length(3).describe("Three-letter currency code"),
  destination_payment_method: z.string().describe("Destination payment method ID (pm_xxx) — must be a bank account"),
  description: z.string().optional(),
  statement_descriptor: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

const CancelOutboundTransferSchema = z.object({
  transfer_id: z.string().describe("Treasury outbound transfer ID (obt_xxx) to cancel"),
});

// --- Received Credits ---
const ListReceivedCreditsSchema = z.object({
  financial_account: z.string().describe("Financial account ID (fa_xxx)"),
  limit: z.number().min(1).max(100).optional().default(20),
  status: z.enum(["failed", "succeeded"]).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetReceivedCreditSchema = z.object({
  credit_id: z.string().describe("Treasury received credit ID (rc_xxx)"),
});

// --- Received Debits ---
const ListReceivedDebitsSchema = z.object({
  financial_account: z.string().describe("Financial account ID (fa_xxx)"),
  limit: z.number().min(1).max(100).optional().default(20),
  status: z.enum(["failed", "succeeded"]).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetReceivedDebitSchema = z.object({
  debit_id: z.string().describe("Treasury received debit ID (rd_xxx)"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    // Financial Accounts
    {
      name: "list_treasury_financial_accounts",
      title: "List Treasury Financial Accounts",
      description: "List Stripe Treasury financial accounts. Financial accounts are bank-like accounts that hold balances and support various payment flows. Returns account ID, balance, currency, status, and enabled features.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number" }, starting_after: { type: "string" }, ending_before: { type: "string" } },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_treasury_financial_account",
      title: "Get Treasury Financial Account",
      description: "Retrieve a specific Treasury financial account by ID (fa_xxx). Returns balance, financial_addresses (routing/account numbers), features, and status.",
      inputSchema: {
        type: "object",
        properties: { financial_account_id: { type: "string", description: "Financial account ID (fa_xxx)" } },
        required: ["financial_account_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_treasury_financial_account",
      title: "Create Treasury Financial Account",
      description: "Create a new Stripe Treasury financial account. Specify supported currencies and which features to enable (ABA routing numbers, ACH, wire transfers, card issuing).",
      inputSchema: {
        type: "object",
        properties: {
          supported_currencies: { type: "array", description: "Supported currencies (e.g. ['usd'])" },
          features_card_issuing_enabled: { type: "boolean" },
          features_financial_addresses_aba_enabled: { type: "boolean", description: "Enable ABA (US routing/account number)" },
          features_inbound_transfers_ach_enabled: { type: "boolean" },
          features_outbound_payments_ach_enabled: { type: "boolean" },
          features_outbound_payments_us_domestic_wire_enabled: { type: "boolean" },
          features_outbound_transfers_ach_enabled: { type: "boolean" },
          metadata: { type: "object" },
        },
        required: ["supported_currencies"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    // Transactions
    {
      name: "list_treasury_transactions",
      title: "List Treasury Transactions",
      description: "List transactions for a Treasury financial account. Returns all money movements (inbound/outbound payments, transfers, received credits/debits). Filter by status (open/posted/void).",
      inputSchema: {
        type: "object",
        properties: {
          financial_account: { type: "string", description: "Financial account ID (fa_xxx)" },
          limit: { type: "number" },
          status: { type: "string", enum: ["open", "posted", "void"] },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
          created_gte: { type: "number" },
          created_lte: { type: "number" },
        },
        required: ["financial_account"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_treasury_transaction",
      title: "Get Treasury Transaction",
      description: "Retrieve a specific Treasury transaction by ID (trxn_xxx). Returns amount, currency, flow (type of money movement), and balance impact.",
      inputSchema: {
        type: "object",
        properties: { transaction_id: { type: "string", description: "Treasury transaction ID (trxn_xxx)" } },
        required: ["transaction_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    // Outbound Payments
    {
      name: "list_outbound_payments",
      title: "List Treasury Outbound Payments",
      description: "List Treasury outbound payments (payments sent from a financial account to a customer's payment method). Filter by status or customer.",
      inputSchema: {
        type: "object",
        properties: {
          financial_account: { type: "string", description: "Financial account ID (fa_xxx)" },
          limit: { type: "number" },
          status: { type: "string", enum: ["canceled", "failed", "posted", "processing", "returned"] },
          customer: { type: "string" },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
        required: ["financial_account"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_outbound_payment",
      title: "Get Treasury Outbound Payment",
      description: "Retrieve a specific Treasury outbound payment by ID (tobp_xxx).",
      inputSchema: {
        type: "object",
        properties: { payment_id: { type: "string", description: "Outbound payment ID (tobp_xxx)" } },
        required: ["payment_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_outbound_payment",
      title: "Create Treasury Outbound Payment",
      description: "Create a Treasury outbound payment to send money to a customer's payment method (bank account). The payment is debited from the financial account.",
      inputSchema: {
        type: "object",
        properties: {
          financial_account: { type: "string", description: "Source financial account ID (fa_xxx)" },
          amount: { type: "number", description: "Amount in smallest currency unit" },
          currency: { type: "string", description: "Three-letter currency code" },
          customer: { type: "string", description: "Customer ID (cus_xxx)" },
          destination_payment_method: { type: "string", description: "Destination payment method (pm_xxx)" },
          description: { type: "string" },
          statement_descriptor: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["financial_account", "amount", "currency"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "cancel_outbound_payment",
      title: "Cancel Treasury Outbound Payment",
      description: "Cancel a Treasury outbound payment in 'processing' status. Returns the canceled payment.",
      inputSchema: {
        type: "object",
        properties: { payment_id: { type: "string", description: "Outbound payment ID (tobp_xxx)" } },
        required: ["payment_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    // Outbound Transfers
    {
      name: "list_outbound_transfers",
      title: "List Treasury Outbound Transfers",
      description: "List Treasury outbound transfers (transfers from a financial account to an external bank account). Filter by status.",
      inputSchema: {
        type: "object",
        properties: {
          financial_account: { type: "string", description: "Financial account ID (fa_xxx)" },
          limit: { type: "number" },
          status: { type: "string", enum: ["canceled", "failed", "posted", "processing", "returned"] },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
        required: ["financial_account"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_outbound_transfer",
      title: "Get Treasury Outbound Transfer",
      description: "Retrieve a specific Treasury outbound transfer by ID (obt_xxx).",
      inputSchema: {
        type: "object",
        properties: { transfer_id: { type: "string", description: "Outbound transfer ID (obt_xxx)" } },
        required: ["transfer_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_outbound_transfer",
      title: "Create Treasury Outbound Transfer",
      description: "Create a Treasury outbound transfer to move funds from a financial account to an external bank account (payment method).",
      inputSchema: {
        type: "object",
        properties: {
          financial_account: { type: "string", description: "Source financial account ID (fa_xxx)" },
          amount: { type: "number", description: "Amount in smallest currency unit" },
          currency: { type: "string", description: "Three-letter currency code" },
          destination_payment_method: { type: "string", description: "Destination bank account payment method (pm_xxx)" },
          description: { type: "string" },
          statement_descriptor: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["financial_account", "amount", "currency", "destination_payment_method"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "cancel_outbound_transfer",
      title: "Cancel Treasury Outbound Transfer",
      description: "Cancel a Treasury outbound transfer in 'processing' status.",
      inputSchema: {
        type: "object",
        properties: { transfer_id: { type: "string", description: "Outbound transfer ID (obt_xxx)" } },
        required: ["transfer_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    // Received Credits
    {
      name: "list_received_credits",
      title: "List Treasury Received Credits",
      description: "List Treasury received credits (funds received into a financial account, e.g. inbound ACH, wire transfers from outside Stripe). Filter by status.",
      inputSchema: {
        type: "object",
        properties: {
          financial_account: { type: "string", description: "Financial account ID (fa_xxx)" },
          limit: { type: "number" },
          status: { type: "string", enum: ["failed", "succeeded"] },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
        required: ["financial_account"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_received_credit",
      title: "Get Treasury Received Credit",
      description: "Retrieve a specific Treasury received credit by ID (rc_xxx). Returns amount, currency, initiating_payment_method_details (sender info), and network.",
      inputSchema: {
        type: "object",
        properties: { credit_id: { type: "string", description: "Received credit ID (rc_xxx)" } },
        required: ["credit_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    // Received Debits
    {
      name: "list_received_debits",
      title: "List Treasury Received Debits",
      description: "List Treasury received debits (funds pulled from a financial account by an external party, e.g. ACH debits initiated by others). Filter by status.",
      inputSchema: {
        type: "object",
        properties: {
          financial_account: { type: "string", description: "Financial account ID (fa_xxx)" },
          limit: { type: "number" },
          status: { type: "string", enum: ["failed", "succeeded"] },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
        required: ["financial_account"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_received_debit",
      title: "Get Treasury Received Debit",
      description: "Retrieve a specific Treasury received debit by ID (rd_xxx). Returns amount, currency, initiating_payment_method_details, and network.",
      inputSchema: {
        type: "object",
        properties: { debit_id: { type: "string", description: "Received debit ID (rd_xxx)" } },
        required: ["debit_id"],
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
    list_treasury_financial_accounts: async (args) => {
      const params = ListFinancialAccountsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      return listHelper("list_treasury_financial_accounts", "/treasury/financial_accounts", q);
    },

    get_treasury_financial_account: async (args) => {
      const { financial_account_id } = GetFinancialAccountSchema.parse(args);
      const r = await logger.time("tool.get_treasury_financial_account", () =>
        client.get<Record<string, unknown>>(`/treasury/financial_accounts/${financial_account_id}`)
      , { tool: "get_treasury_financial_account" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_treasury_financial_account: async (args) => {
      const params = CreateFinancialAccountSchema.parse(args);
      const body: Record<string, unknown> = {};
      params.supported_currencies.forEach((c, i) => { body[`supported_currencies[${i}]`] = c; });
      if (params.features_card_issuing_enabled !== undefined) body["features[card_issuing][requested]"] = params.features_card_issuing_enabled;
      if (params.features_financial_addresses_aba_enabled !== undefined) body["features[financial_addresses][aba][requested]"] = params.features_financial_addresses_aba_enabled;
      if (params.features_inbound_transfers_ach_enabled !== undefined) body["features[inbound_transfers][ach][requested]"] = params.features_inbound_transfers_ach_enabled;
      if (params.features_outbound_payments_ach_enabled !== undefined) body["features[outbound_payments][ach][requested]"] = params.features_outbound_payments_ach_enabled;
      if (params.features_outbound_payments_us_domestic_wire_enabled !== undefined) body["features[outbound_payments][us_domestic_wire][requested]"] = params.features_outbound_payments_us_domestic_wire_enabled;
      if (params.features_outbound_transfers_ach_enabled !== undefined) body["features[outbound_transfers][ach][requested]"] = params.features_outbound_transfers_ach_enabled;
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.create_treasury_financial_account", () =>
        client.post<Record<string, unknown>>("/treasury/financial_accounts", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_treasury_financial_account" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_treasury_transactions: async (args) => {
      const params = ListTreasuryTransactionsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
        financial_account: params.financial_account,
      };
      if (params.status) q.status = params.status;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      if (params.created_gte) q["created[gte]"] = params.created_gte;
      if (params.created_lte) q["created[lte]"] = params.created_lte;
      return listHelper("list_treasury_transactions", "/treasury/transactions", q);
    },

    get_treasury_transaction: async (args) => {
      const { transaction_id } = GetTreasuryTransactionSchema.parse(args);
      const r = await logger.time("tool.get_treasury_transaction", () =>
        client.get<Record<string, unknown>>(`/treasury/transactions/${transaction_id}`)
      , { tool: "get_treasury_transaction" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_outbound_payments: async (args) => {
      const params = ListOutboundPaymentsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
        financial_account: params.financial_account,
      };
      if (params.status) q.status = params.status;
      if (params.customer) q.customer = params.customer;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      return listHelper("list_outbound_payments", "/treasury/outbound_payments", q);
    },

    get_outbound_payment: async (args) => {
      const { payment_id } = GetOutboundPaymentSchema.parse(args);
      const r = await logger.time("tool.get_outbound_payment", () =>
        client.get<Record<string, unknown>>(`/treasury/outbound_payments/${payment_id}`)
      , { tool: "get_outbound_payment" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_outbound_payment: async (args) => {
      const params = CreateOutboundPaymentSchema.parse(args);
      const body: Record<string, unknown> = {
        financial_account: params.financial_account,
        amount: params.amount,
        currency: params.currency,
      };
      if (params.customer) body.customer = params.customer;
      if (params.destination_payment_method) body.destination_payment_method = params.destination_payment_method;
      if (params.description) body.description = params.description;
      if (params.statement_descriptor) body.statement_descriptor = params.statement_descriptor;
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.create_outbound_payment", () =>
        client.post<Record<string, unknown>>("/treasury/outbound_payments", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_outbound_payment" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    cancel_outbound_payment: async (args) => {
      const { payment_id } = CancelOutboundPaymentSchema.parse(args);
      const r = await logger.time("tool.cancel_outbound_payment", () =>
        client.post<Record<string, unknown>>(`/treasury/outbound_payments/${payment_id}/cancel`, {})
      , { tool: "cancel_outbound_payment" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_outbound_transfers: async (args) => {
      const params = ListOutboundTransfersSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
        financial_account: params.financial_account,
      };
      if (params.status) q.status = params.status;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      return listHelper("list_outbound_transfers", "/treasury/outbound_transfers", q);
    },

    get_outbound_transfer: async (args) => {
      const { transfer_id } = GetOutboundTransferSchema.parse(args);
      const r = await logger.time("tool.get_outbound_transfer", () =>
        client.get<Record<string, unknown>>(`/treasury/outbound_transfers/${transfer_id}`)
      , { tool: "get_outbound_transfer" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_outbound_transfer: async (args) => {
      const params = CreateOutboundTransferSchema.parse(args);
      const body: Record<string, unknown> = {
        financial_account: params.financial_account,
        amount: params.amount,
        currency: params.currency,
        destination_payment_method: params.destination_payment_method,
      };
      if (params.description) body.description = params.description;
      if (params.statement_descriptor) body.statement_descriptor = params.statement_descriptor;
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.create_outbound_transfer", () =>
        client.post<Record<string, unknown>>("/treasury/outbound_transfers", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_outbound_transfer" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    cancel_outbound_transfer: async (args) => {
      const { transfer_id } = CancelOutboundTransferSchema.parse(args);
      const r = await logger.time("tool.cancel_outbound_transfer", () =>
        client.post<Record<string, unknown>>(`/treasury/outbound_transfers/${transfer_id}/cancel`, {})
      , { tool: "cancel_outbound_transfer" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_received_credits: async (args) => {
      const params = ListReceivedCreditsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
        financial_account: params.financial_account,
      };
      if (params.status) q.status = params.status;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      return listHelper("list_received_credits", "/treasury/received_credits", q);
    },

    get_received_credit: async (args) => {
      const { credit_id } = GetReceivedCreditSchema.parse(args);
      const r = await logger.time("tool.get_received_credit", () =>
        client.get<Record<string, unknown>>(`/treasury/received_credits/${credit_id}`)
      , { tool: "get_received_credit" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_received_debits: async (args) => {
      const params = ListReceivedDebitsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
        financial_account: params.financial_account,
      };
      if (params.status) q.status = params.status;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      return listHelper("list_received_debits", "/treasury/received_debits", q);
    },

    get_received_debit: async (args) => {
      const { debit_id } = GetReceivedDebitSchema.parse(args);
      const r = await logger.time("tool.get_received_debit", () =>
        client.get<Record<string, unknown>>(`/treasury/received_debits/${debit_id}`)
      , { tool: "get_received_debit" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
