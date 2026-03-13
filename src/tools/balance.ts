// Balance tools — Stripe API v1
// Covers: get_balance, get_balance_transaction

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeBalance, StripeBalanceTransaction } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const GetBalanceTransactionSchema = z.object({
  transaction_id: z.string().describe("Balance transaction ID (txn_xxx)"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "get_balance",
      title: "Get Balance",
      description:
        "Get the current Stripe account balance — available and pending amounts broken down by currency. Available balance can be paid out; pending balance is from recent charges still being processed. Use this to check how much money is in your Stripe account.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          available: { type: "array", description: "Available balance by currency" },
          pending: { type: "array", description: "Pending balance by currency" },
          livemode: { type: "boolean" },
        },
        required: ["available", "pending"],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "get_balance_transaction",
      title: "Get Balance Transaction",
      description:
        "Get details for a specific Stripe balance transaction by ID (txn_xxx). Returns the amount, fee, net amount, type (charge, refund, payout, etc.), and related source object. Use to inspect individual ledger entries.",
      inputSchema: {
        type: "object",
        properties: {
          transaction_id: { type: "string", description: "Balance transaction ID (txn_xxx)" },
        },
        required: ["transaction_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          amount: { type: "number" },
          fee: { type: "number" },
          net: { type: "number" },
          currency: { type: "string" },
          type: { type: "string" },
          status: { type: "string" },
          source: { type: "string" },
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
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    get_balance: async (_args) => {
      const balance = await logger.time("tool.get_balance", () =>
        client.get<StripeBalance>("/balance")
      , { tool: "get_balance" });

      return {
        content: [{ type: "text", text: JSON.stringify(balance, null, 2) }],
        structuredContent: balance,
      };
    },

    get_balance_transaction: async (args) => {
      const { transaction_id } = GetBalanceTransactionSchema.parse(args);

      const txn = await logger.time("tool.get_balance_transaction", () =>
        client.get<StripeBalanceTransaction>(`/balance_transactions/${transaction_id}`)
      , { tool: "get_balance_transaction", transaction_id });

      return {
        content: [{ type: "text", text: JSON.stringify(txn, null, 2) }],
        structuredContent: txn,
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
