// Balance Transactions tools — Stripe API v1
// Covers: list_balance_transactions, get_balance_transaction

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeBalanceTransaction } from "../types.js";
import { logger } from "../logger.js";

const ListBalanceTransactionsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  type: z.enum([
    "adjustment", "advance", "advance_funding", "anticipation_repayment",
    "application_fee", "application_fee_refund", "charge", "connect_collection_transfer",
    "contribution", "issuing_authorization_hold", "issuing_authorization_release",
    "issuing_dispute", "issuing_transaction", "obligation_inbound", "obligation_payout",
    "obligation_payout_failure", "obligation_reversal_inbound", "obligation_reversal_outbound",
    "payment", "payment_failure_refund", "payment_refund", "payment_unreconciled",
    "payout", "payout_cancel", "payout_failure", "refund", "refund_failure",
    "reserve_transaction", "reserved_funds", "stripe_fee", "stripe_fx_fee",
    "tax_fee", "topup", "topup_reversal", "transfer", "transfer_cancel",
    "transfer_failure", "transfer_refund",
  ]).optional().describe("Filter by transaction type"),
  currency: z.string().optional().describe("Filter by three-letter currency code"),
  source: z.string().optional().describe("Filter by source object ID (charge, refund, etc.)"),
  payout: z.string().optional().describe("Filter by payout ID (only returns transactions that are part of this payout)"),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  created_gte: z.number().optional(),
  created_lte: z.number().optional(),
  available_on_gte: z.number().optional().describe("Filter by available_on date (Unix timestamp, >=)"),
  available_on_lte: z.number().optional().describe("Filter by available_on date (Unix timestamp, <=)"),
});

const GetBalanceTransactionSchema = z.object({
  transaction_id: z.string().describe("Balance transaction ID (txn_xxx)"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_balance_transactions",
      title: "List Balance Transactions",
      description:
        "List all transactions that have contributed to your Stripe balance (charges, refunds, payouts, fees, etc.). This is the most detailed view of money moving through your Stripe account. Optionally filter by type (charge/refund/payout/transfer/fee), currency, source object, or payout. Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          type: { type: "string", description: "Filter by type (e.g. 'charge', 'refund', 'payout', 'transfer', 'application_fee')" },
          currency: { type: "string", description: "Filter by currency (three-letter code)" },
          source: { type: "string", description: "Filter by source ID (e.g. a charge ID ch_xxx)" },
          payout: { type: "string", description: "Filter by payout ID (po_xxx)" },
          starting_after: { type: "string", description: "Pagination cursor" },
          ending_before: { type: "string", description: "Pagination cursor — reversed" },
          created_gte: { type: "number", description: "Filter by creation time (>=)" },
          created_lte: { type: "number", description: "Filter by creation time (<=)" },
          available_on_gte: { type: "number", description: "Filter by availability date (>=)" },
          available_on_lte: { type: "number", description: "Filter by availability date (<=)" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_balance_transaction",
      title: "Get Balance Transaction",
      description:
        "Retrieve a specific balance transaction by ID (txn_xxx). Returns amount, fee, net, currency, type, status, source (the associated charge/refund/payout), description, and available_on date.",
      inputSchema: {
        type: "object",
        properties: {
          transaction_id: { type: "string", description: "Balance transaction ID (txn_xxx)" },
        },
        required: ["transaction_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_balance_transactions: async (args) => {
      const params = ListBalanceTransactionsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.type) q.type = params.type;
      if (params.currency) q.currency = params.currency;
      if (params.source) q.source = params.source;
      if (params.payout) q.payout = params.payout;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      if (params.created_gte) q["created[gte]"] = params.created_gte;
      if (params.created_lte) q["created[lte]"] = params.created_lte;
      if (params.available_on_gte) q["available_on[gte]"] = params.available_on_gte;
      if (params.available_on_lte) q["available_on[lte]"] = params.available_on_lte;

      const result = await logger.time("tool.list_balance_transactions", () =>
        client.list<StripeBalanceTransaction>("/balance_transactions", q)
      , { tool: "list_balance_transactions" });
      const lastItem = result.data[result.data.length - 1];
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_balance_transaction: async (args) => {
      const { transaction_id } = GetBalanceTransactionSchema.parse(args);
      const r = await logger.time("tool.get_balance_transaction", () =>
        client.get<StripeBalanceTransaction>(`/balance_transactions/${transaction_id}`)
      , { tool: "get_balance_transaction" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
