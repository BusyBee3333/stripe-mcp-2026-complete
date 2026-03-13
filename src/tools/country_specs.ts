// Country Specs tools — Stripe API v1
// Covers: list_country_specs, get_country_spec

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListCountrySpecsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetCountrySpecSchema = z.object({
  country: z.string().describe("Two-letter ISO country code (e.g. 'US', 'GB', 'DE')"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_country_specs",
      title: "List Country Specs",
      description:
        "List supported countries for Stripe Connect onboarding. Returns country specifications including supported payment currencies, verification fields required for Connect accounts, and supported bank account currencies per country.",
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
      name: "get_country_spec",
      title: "Get Country Spec",
      description:
        "Retrieve Stripe Connect specifications for a specific country. Returns supported currencies, payment methods, verification fields required for Connect account onboarding, and supported bank account currencies. Use to determine what's needed to onboard a connected account in a given country.",
      inputSchema: {
        type: "object",
        properties: {
          country: { type: "string", description: "Two-letter ISO country code (e.g. 'US', 'GB', 'DE')" },
        },
        required: ["country"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_country_specs: async (args) => {
      const params = ListCountrySpecsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_country_specs", () =>
        client.list<Record<string, unknown>>("/country_specs", q)
      , { tool: "list_country_specs" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_country_spec: async (args) => {
      const { country } = GetCountrySpecSchema.parse(args);
      const spec = await logger.time("tool.get_country_spec", () =>
        client.get<Record<string, unknown>>(`/country_specs/${country}`)
      , { tool: "get_country_spec", country });
      return { content: [{ type: "text", text: JSON.stringify(spec, null, 2) }], structuredContent: spec };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
