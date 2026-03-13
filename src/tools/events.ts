// Events tools — Stripe API v1
// Covers: list_events, get_event

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListEventsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  type: z.string().optional().describe("Filter by event type (e.g. 'payment_intent.succeeded', 'customer.created')"),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  created_gte: z.number().optional(),
  created_lte: z.number().optional(),
});

const GetEventSchema = z.object({
  event_id: z.string().describe("Stripe event ID (evt_xxx)"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_events",
      title: "List Events",
      description:
        "List Stripe events from the event log. Optionally filter by type (e.g. 'payment_intent.succeeded', 'customer.created') or date range. Returns event type, data, created timestamp, and whether it was livemode. Uses keyset pagination via starting_after.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          type: { type: "string", description: "Filter by event type (e.g. 'payment_intent.succeeded')" },
          starting_after: { type: "string", description: "Pagination cursor — last event ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
          created_gte: { type: "number", description: "Filter by creation time (Unix timestamp, >=)" },
          created_lte: { type: "number", description: "Filter by creation time (Unix timestamp, <=)" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_event",
      title: "Get Event",
      description:
        "Retrieve a specific Stripe event by ID (evt_xxx). Returns the full event object including type, data.object (the affected resource snapshot), request info, and livemode.",
      inputSchema: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "Stripe event ID (evt_xxx)" },
        },
        required: ["event_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_events: async (args) => {
      const params = ListEventsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.type) q.type = params.type;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      if (params.created_gte) q["created[gte]"] = params.created_gte;
      if (params.created_lte) q["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_events", () =>
        client.list<Record<string, unknown>>("/events", q)
      , { tool: "list_events" });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_event: async (args) => {
      const { event_id } = GetEventSchema.parse(args);
      const event = await logger.time("tool.get_event", () =>
        client.get<Record<string, unknown>>(`/events/${event_id}`)
      , { tool: "get_event", event_id });
      return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }], structuredContent: event };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
