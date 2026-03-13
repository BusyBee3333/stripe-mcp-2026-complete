// Test Clocks tools — Stripe API v1
// Covers: list_test_clocks, get_test_clock, create_test_clock, delete_test_clock, advance_test_clock

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListTestClocksSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetTestClockSchema = z.object({
  clock_id: z.string().describe("Test clock ID (clock_xxx)"),
});

const CreateTestClockSchema = z.object({
  frozen_time: z.number().int().describe("Unix timestamp to start the test clock at (must be in the past relative to now)"),
  name: z.string().optional().describe("Optional name for this test clock (e.g. 'Subscription renewal test')"),
});

const DeleteTestClockSchema = z.object({
  clock_id: z.string().describe("Test clock ID (clock_xxx) to delete"),
});

const AdvanceTestClockSchema = z.object({
  clock_id: z.string().describe("Test clock ID (clock_xxx) to advance"),
  frozen_time: z.number().int().describe("Unix timestamp to advance the clock to (must be after the current frozen_time and in the past)"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_test_clocks",
      title: "List Test Clocks",
      description:
        "List Stripe test clocks. Test clocks let you fast-forward time in test mode to simulate subscription renewals, trial expirations, and scheduled events. Returns clock ID, name, frozen_time, and status.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_test_clock",
      title: "Get Test Clock",
      description: "Retrieve a specific test clock by ID (clock_xxx). Returns frozen_time, status, and name.",
      inputSchema: {
        type: "object",
        properties: { clock_id: { type: "string", description: "Test clock ID (clock_xxx)" } },
        required: ["clock_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_test_clock",
      title: "Create Test Clock",
      description:
        "Create a new test clock for simulating time-based Stripe events. All resources (customers, subscriptions, invoices) created under this clock will advance when you advance the clock. Used to test subscription renewals, trial endings, and scheduled events in test mode.",
      inputSchema: {
        type: "object",
        properties: {
          frozen_time: { type: "number", description: "Starting Unix timestamp (must be in the past)" },
          name: { type: "string", description: "Optional descriptive name" },
        },
        required: ["frozen_time"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "delete_test_clock",
      title: "Delete Test Clock",
      description: "Delete a test clock and all associated test objects. This is permanent.",
      inputSchema: {
        type: "object",
        properties: { clock_id: { type: "string", description: "Test clock ID (clock_xxx)" } },
        required: ["clock_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "advance_test_clock",
      title: "Advance Test Clock",
      description:
        "Advance a test clock to a specific time. Stripe will process all events that would have occurred between the current frozen_time and the new time (subscription renewals, trial expirations, etc.). The clock status becomes 'advancing' and then 'ready' when complete.",
      inputSchema: {
        type: "object",
        properties: {
          clock_id: { type: "string", description: "Test clock ID (clock_xxx)" },
          frozen_time: { type: "number", description: "Target Unix timestamp to advance to" },
        },
        required: ["clock_id", "frozen_time"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_test_clocks: async (args) => {
      const params = ListTestClocksSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_test_clocks", () =>
        client.list<Record<string, unknown>>("/test_helpers/test_clocks", q)
      , { tool: "list_test_clocks" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_test_clock: async (args) => {
      const { clock_id } = GetTestClockSchema.parse(args);
      const r = await logger.time("tool.get_test_clock", () =>
        client.get<Record<string, unknown>>(`/test_helpers/test_clocks/${clock_id}`)
      , { tool: "get_test_clock" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_test_clock: async (args) => {
      const params = CreateTestClockSchema.parse(args);
      const body: Record<string, unknown> = { frozen_time: params.frozen_time };
      if (params.name) body.name = params.name;

      const r = await logger.time("tool.create_test_clock", () =>
        client.post<Record<string, unknown>>("/test_helpers/test_clocks", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_test_clock" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    delete_test_clock: async (args) => {
      const { clock_id } = DeleteTestClockSchema.parse(args);
      const r = await logger.time("tool.delete_test_clock", () =>
        client.delete<Record<string, unknown>>(`/test_helpers/test_clocks/${clock_id}`)
      , { tool: "delete_test_clock" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    advance_test_clock: async (args) => {
      const params = AdvanceTestClockSchema.parse(args);
      const body = { frozen_time: params.frozen_time };

      const r = await logger.time("tool.advance_test_clock", () =>
        client.post<Record<string, unknown>>(`/test_helpers/test_clocks/${params.clock_id}/advance`, body)
      , { tool: "advance_test_clock" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
