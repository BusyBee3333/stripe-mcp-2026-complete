// Transfers tools — Stripe API v1
// Covers: list_transfers, create_transfer, get_transfer, list_balance_transactions

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeTransfer, StripeBalanceTransaction } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListTransfersSchema = z.object({
  destination: z.string().optional().describe("Filter by destination account ID (acct_xxx)"),
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
});

const CreateTransferSchema = z.object({
  amount: z.number().int().positive().describe("Amount in smallest currency unit (e.g., 1000 = $10.00)"),
  currency: z.string().length(3).describe("3-letter ISO currency code (e.g., 'usd')"),
  destination: z.string().describe("The ID of a connected account to transfer funds to (acct_xxx)"),
  source_transaction: z.string().optional().describe("Source charge ID (ch_xxx) — transfer amount is pulled from this charge's balance"),
  description: z.string().optional().describe("An arbitrary string for your internal notes"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
  transfer_group: z.string().optional().describe("A string that identifies this transfer as part of a group"),
});

const GetTransferSchema = z.object({
  transfer_id: z.string().describe("Stripe transfer ID (tr_xxx)"),
});

const ListBalanceTransactionsSchema = z.object({
  type: z.enum(["adjustment", "advance", "advance_funding", "anticipation_repayment", "application_fee", "application_fee_refund", "charge", "climate_order_purchase", "climate_order_refund", "connect_collection_transfer", "contribution", "issuing_authorization_hold", "issuing_authorization_release", "issuing_dispute", "issuing_transaction", "obligation_inbound", "obligation_outbound", "other_adjustment", "partial_capture_reversal", "payout", "payout_cancel", "payout_failure", "refund", "refund_failure", "reserve_transaction", "reserved_funds", "stripe_fee", "stripe_fx_fee", "tax_fee", "topup", "topup_reversal", "transfer", "transfer_cancel", "transfer_failure", "transfer_refund"]).optional().describe("Filter by transaction type"),
  source: z.string().optional().describe("Filter by related object ID (charge, refund, payout, etc.)"),
  currency: z.string().optional().describe("Filter by 3-letter currency code"),
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_transfers",
      title: "List Transfers",
      description:
        "List Stripe transfers to connected accounts with optional filters by destination and date range. Returns transfer ID, amount, currency, and destination. Uses keyset pagination — pass meta.lastId as starting_after for the next page. Requires Connect.",
      inputSchema: {
        type: "object",
        properties: {
          destination: { type: "string", description: "Filter by destination account ID (acct_xxx)" },
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
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
      name: "create_transfer",
      title: "Create Transfer",
      description:
        "Create a Stripe transfer to move funds to a connected account. Requires amount (smallest currency unit), currency, and destination (acct_xxx). Optionally link to a source_transaction (ch_xxx) to pull funds from a specific charge. Requires Stripe Connect.",
      inputSchema: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Amount in smallest currency unit (e.g., 1000 = $10.00)" },
          currency: { type: "string", description: "3-letter ISO currency code (e.g., 'usd')" },
          destination: { type: "string", description: "Connected account ID (acct_xxx)" },
          source_transaction: { type: "string", description: "Source charge ID (ch_xxx)" },
          description: { type: "string", description: "Internal description" },
          metadata: { type: "object", description: "Key-value metadata" },
          transfer_group: { type: "string", description: "Group identifier for related transfers" },
        },
        required: ["amount", "currency", "destination"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          amount: { type: "number" },
          currency: { type: "string" },
          destination: { type: "string" },
          created: { type: "number" },
        },
        required: ["id", "amount"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    {
      name: "get_transfer",
      title: "Get Transfer",
      description:
        "Get full details for a Stripe transfer by ID (tr_xxx). Returns amount, currency, destination account, reversals, and balance transaction details.",
      inputSchema: {
        type: "object",
        properties: {
          transfer_id: { type: "string", description: "Stripe transfer ID (tr_xxx)" },
        },
        required: ["transfer_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          amount: { type: "number" },
          currency: { type: "string" },
          destination: { type: "string" },
          balance_transaction: { type: "string" },
          created: { type: "number" },
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
      name: "list_balance_transactions",
      title: "List Balance Transactions",
      description:
        "List Stripe balance transactions — the ledger of all money movements in your account. Filter by type (charge, refund, payout, transfer, etc.), source object ID, or date range. Uses keyset pagination — pass meta.lastId as starting_after for the next page.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", description: "Filter by transaction type (e.g., 'charge', 'refund', 'payout', 'transfer')" },
          source: { type: "string", description: "Filter by source object ID (charge, refund, payout ID, etc.)" },
          currency: { type: "string", description: "Filter by 3-letter currency code" },
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
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
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_transfers: async (args) => {
      const params = ListTransfersSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.destination) queryParams.destination = params.destination;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_transfers", () =>
        client.list<StripeTransfer>("/transfers", queryParams)
      , { tool: "list_transfers" });

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

    create_transfer: async (args) => {
      const params = CreateTransferSchema.parse(args);

      const body: Record<string, string | number | boolean | undefined | null> = {
        amount: params.amount,
        currency: params.currency,
        destination: params.destination,
      };
      if (params.source_transaction) body.source_transaction = params.source_transaction;
      if (params.description) body.description = params.description;
      if (params.transfer_group) body.transfer_group = params.transfer_group;
      if (params.metadata) {
        for (const [k, v] of Object.entries(params.metadata)) {
          body[`metadata[${k}]`] = v;
        }
      }

      const transfer = await logger.time("tool.create_transfer", () =>
        client.post<StripeTransfer>("/transfers", body)
      , { tool: "create_transfer" });

      return {
        content: [{ type: "text", text: JSON.stringify(transfer, null, 2) }],
        structuredContent: transfer,
      };
    },

    get_transfer: async (args) => {
      const { transfer_id } = GetTransferSchema.parse(args);

      const transfer = await logger.time("tool.get_transfer", () =>
        client.get<StripeTransfer>(`/transfers/${transfer_id}`)
      , { tool: "get_transfer", transfer_id });

      return {
        content: [{ type: "text", text: JSON.stringify(transfer, null, 2) }],
        structuredContent: transfer,
      };
    },

    list_balance_transactions: async (args) => {
      const params = ListBalanceTransactionsSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.type) queryParams.type = params.type;
      if (params.source) queryParams.source = params.source;
      if (params.currency) queryParams.currency = params.currency;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_balance_transactions", () =>
        client.list<StripeBalanceTransaction>("/balance_transactions", queryParams)
      , { tool: "list_balance_transactions" });

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
  };
}

export function getTools(client: StripeClient) {
  return {
    tools: getToolDefinitions(),
    handlers: getToolHandlers(client),
  };
}
