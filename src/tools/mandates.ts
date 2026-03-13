// Mandates tools — Stripe API v1
// Covers: get_mandate

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const GetMandateSchema = z.object({
  mandate_id: z.string().describe("Stripe mandate ID (mandate_xxx)"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "get_mandate",
      title: "Get Mandate",
      description:
        "Retrieve a Stripe mandate by ID (mandate_xxx). Mandates are records of a customer's permission to charge them — they're created automatically for SEPA Direct Debit, ACH, BECS, and other bank payment methods that require authorization. Returns mandate type (online/offline), status, payment_method, and acceptance details.",
      inputSchema: {
        type: "object",
        properties: {
          mandate_id: { type: "string", description: "Stripe mandate ID (mandate_xxx)" },
        },
        required: ["mandate_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    get_mandate: async (args) => {
      const { mandate_id } = GetMandateSchema.parse(args);
      const mandate = await logger.time("tool.get_mandate", () =>
        client.get<Record<string, unknown>>(`/mandates/${mandate_id}`)
      , { tool: "get_mandate", mandate_id });
      return { content: [{ type: "text", text: JSON.stringify(mandate, null, 2) }], structuredContent: mandate };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
