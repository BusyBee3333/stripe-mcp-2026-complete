// Exchange Rates tools — Stripe API v1
// Covers: list_exchange_rates, get_exchange_rate

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListExchangeRatesSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetExchangeRateSchema = z.object({
  currency: z.string().length(3).describe("Three-letter ISO currency code for the base currency (e.g. 'usd', 'eur')"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_exchange_rates",
      title: "List Exchange Rates",
      description:
        "List all supported Stripe exchange rates. Returns rate objects where each rate is a map of target currencies to their conversion rates from the base currency. Useful for displaying multi-currency prices or doing conversion calculations.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          starting_after: { type: "string", description: "Pagination cursor" },
          ending_before: { type: "string", description: "Pagination cursor — reversed" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_exchange_rate",
      title: "Get Exchange Rate",
      description:
        "Retrieve the current Stripe exchange rates for a given base currency. Returns a map of all supported target currencies and their conversion rates from the specified base. Rates are updated daily by Stripe.",
      inputSchema: {
        type: "object",
        properties: {
          currency: { type: "string", description: "Base currency code (e.g. 'usd', 'eur', 'gbp')" },
        },
        required: ["currency"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_exchange_rates: async (args) => {
      const params = ListExchangeRatesSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_exchange_rates", () =>
        client.list<Record<string, unknown>>("/exchange_rates", q)
      , { tool: "list_exchange_rates" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_exchange_rate: async (args) => {
      const { currency } = GetExchangeRateSchema.parse(args);
      const rate = await logger.time("tool.get_exchange_rate", () =>
        client.get<Record<string, unknown>>(`/exchange_rates/${currency}`)
      , { tool: "get_exchange_rate", currency });
      return { content: [{ type: "text", text: JSON.stringify(rate, null, 2) }], structuredContent: rate };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
