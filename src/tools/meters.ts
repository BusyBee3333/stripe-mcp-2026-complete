// Billing Meters tools — Stripe API v1
// Covers: list_meters, get_meter, create_meter, list_meter_events, create_meter_event
// Used for usage-based billing (metered pricing)

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListMetersSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  status: z.enum(["active", "inactive"]).optional().describe("Filter by meter status"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — for reversed pagination"),
});

const GetMeterSchema = z.object({
  meter_id: z.string().describe("Stripe billing meter ID (mtr_xxx)"),
});

const CreateMeterSchema = z.object({
  display_name: z.string().describe("Human-readable display name for this meter (e.g. 'API Calls', 'Compute Units')"),
  event_name: z.string().describe("The event name that triggers this meter — must match the event_name in meter events (e.g. 'api_call', 'compute_unit_used')"),
  default_aggregation: z.object({
    formula: z.enum(["count", "sum"]).describe("Aggregation formula: count (count events) or sum (sum a numeric payload field)"),
  }).describe("How to aggregate meter events: count (tally events) or sum (add up a value field)"),
  event_time_window: z.enum(["day", "hour"]).optional().describe("Granularity for event time windows: day or hour (default: hour)"),
  value_settings: z.object({
    event_payload_key: z.string().describe("The key in the event payload to aggregate for sum formula (e.g. 'tokens', 'bytes')"),
  }).optional().describe("Required when default_aggregation.formula is 'sum' — specifies which payload key to sum"),
  customer_mapping: z.object({
    event_payload_key: z.string().describe("The event payload key containing the Stripe customer ID"),
    type: z.literal("by_id").describe("Mapping type: by_id (payload field contains Stripe customer ID)"),
  }).optional().describe("How to map meter events to customers — defaults to stripe_customer_id field"),
});

const ListMeterEventsSchema = z.object({
  meter_id: z.string().describe("Stripe billing meter ID (mtr_xxx)"),
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  start_time: z.number().int().positive().optional().describe("Filter events after this Unix timestamp"),
  end_time: z.number().int().positive().optional().describe("Filter events before this Unix timestamp"),
  value_grouping_window: z.enum(["day", "hour"]).optional().describe("Group events by day or hour"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — for reversed pagination"),
});

const CreateMeterEventSchema = z.object({
  event_name: z.string().describe("The meter event name — must match the meter's event_name (e.g. 'api_call', 'compute_unit_used')"),
  payload: z.record(z.string()).describe("Event payload as key-value string pairs. Must include the customer mapping key (default: 'stripe_customer_id'). For sum aggregation, include the value key (e.g. {'stripe_customer_id': 'cus_xxx', 'tokens': '1500'})"),
  identifier: z.string().optional().describe("Unique identifier for idempotency — prevents duplicate events. Use a UUID or your own unique ID per event."),
  timestamp: z.number().int().positive().optional().describe("Unix timestamp when this event occurred (defaults to now). Useful for backdating or ingesting historical events."),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_meters",
      title: "List Billing Meters",
      description:
        "List Stripe Billing Meters — used for usage-based billing to track metered usage (API calls, tokens, GB stored, etc.). Meters aggregate meter events and feed into metered prices on subscriptions. Filter by active/inactive status.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          status: { type: "string", enum: ["active", "inactive"], description: "Filter by meter status" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_meter",
      title: "Get Billing Meter",
      description:
        "Get full details for a Stripe Billing Meter by ID (mtr_xxx). Returns event_name, aggregation formula, value_settings, customer_mapping, and status.",
      inputSchema: {
        type: "object",
        properties: {
          meter_id: { type: "string", description: "Stripe billing meter ID (mtr_xxx)" },
        },
        required: ["meter_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_meter",
      title: "Create Billing Meter",
      description:
        "Create a Stripe Billing Meter for usage-based billing. Define the event_name (matches events you'll send), aggregation formula (count events or sum a numeric value), and customer mapping. Once created, attach the meter to a metered Price for subscriptions.",
      inputSchema: {
        type: "object",
        properties: {
          display_name: { type: "string", description: "Human-readable meter name (e.g. 'API Calls', 'Tokens Used')" },
          event_name: { type: "string", description: "Event name to track (e.g. 'api_call') — matches event_name in meter events" },
          default_aggregation: {
            type: "object",
            description: "Aggregation: {formula: 'count'} to count events, or {formula: 'sum'} to sum a payload field",
          },
          event_time_window: { type: "string", enum: ["day", "hour"], description: "Event time window granularity" },
          value_settings: {
            type: "object",
            description: "Required for sum formula: {event_payload_key: 'tokens'} to specify which payload field to sum",
          },
          customer_mapping: {
            type: "object",
            description: "Customer mapping: {event_payload_key: 'stripe_customer_id', type: 'by_id'}",
          },
        },
        required: ["display_name", "event_name", "default_aggregation"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "list_meter_events",
      title: "List Meter Event Summaries",
      description:
        "List aggregated meter event summaries for a specific Stripe Billing Meter. Returns usage data grouped by customer and time window. Use to check billed usage for a subscription period.",
      inputSchema: {
        type: "object",
        properties: {
          meter_id: { type: "string", description: "Stripe billing meter ID (mtr_xxx)" },
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          start_time: { type: "number", description: "Filter from this Unix timestamp" },
          end_time: { type: "number", description: "Filter until this Unix timestamp" },
          value_grouping_window: { type: "string", enum: ["day", "hour"], description: "Group by day or hour" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
        },
        required: ["meter_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_meter_event",
      title: "Create Meter Event",
      description:
        "Record a Stripe Billing Meter event — reports usage for a customer. The event_name must match your meter's event_name. The payload must include the customer identifier key (default: 'stripe_customer_id'). For sum meters, also include the numeric value key. Use identifier for deduplication.",
      inputSchema: {
        type: "object",
        properties: {
          event_name: { type: "string", description: "Meter event name matching your meter (e.g. 'api_call')" },
          payload: {
            type: "object",
            description: "Event payload: must include 'stripe_customer_id' (or your customer_mapping key). For sum: also include value key (e.g. {'stripe_customer_id': 'cus_xxx', 'tokens': '1500'})",
          },
          identifier: { type: "string", description: "Unique event ID for deduplication (recommended)" },
          timestamp: { type: "number", description: "When this event occurred (Unix timestamp, defaults to now)" },
        },
        required: ["event_name", "payload"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_meters: async (args) => {
      const params = ListMetersSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.status) queryParams.status = params.status;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;

      const result = await logger.time("tool.list_meters", () =>
        client.list<Record<string, unknown>>("/billing/meters", queryParams)
      , { tool: "list_meters" });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_meter: async (args) => {
      const { meter_id } = GetMeterSchema.parse(args);
      const meter = await logger.time("tool.get_meter", () =>
        client.get<Record<string, unknown>>(`/billing/meters/${meter_id}`)
      , { tool: "get_meter", meter_id });
      return { content: [{ type: "text", text: JSON.stringify(meter, null, 2) }], structuredContent: meter };
    },

    create_meter: async (args) => {
      const params = CreateMeterSchema.parse(args);
      const body: Record<string, unknown> = {
        display_name: params.display_name,
        event_name: params.event_name,
        "default_aggregation[formula]": params.default_aggregation.formula,
      };

      if (params.event_time_window) body.event_time_window = params.event_time_window;
      if (params.value_settings?.event_payload_key) {
        body["value_settings[event_payload_key]"] = params.value_settings.event_payload_key;
      }
      if (params.customer_mapping) {
        body["customer_mapping[event_payload_key]"] = params.customer_mapping.event_payload_key;
        body["customer_mapping[type]"] = params.customer_mapping.type;
      }

      const meter = await logger.time("tool.create_meter", () =>
        client.post<Record<string, unknown>>("/billing/meters", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_meter" });
      return { content: [{ type: "text", text: JSON.stringify(meter, null, 2) }], structuredContent: meter };
    },

    list_meter_events: async (args) => {
      const params = ListMeterEventsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.start_time) queryParams.start_time = params.start_time;
      if (params.end_time) queryParams.end_time = params.end_time;
      if (params.value_grouping_window) queryParams.value_grouping_window = params.value_grouping_window;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;

      const result = await logger.time("tool.list_meter_events", () =>
        client.list<Record<string, unknown>>(`/billing/meters/${params.meter_id}/event_summaries`, queryParams)
      , { tool: "list_meter_events", meter_id: params.meter_id });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    create_meter_event: async (args) => {
      const params = CreateMeterEventSchema.parse(args);
      const body: Record<string, unknown> = {
        event_name: params.event_name,
      };

      // Flatten payload as payload[key]=value
      for (const [k, v] of Object.entries(params.payload)) {
        body[`payload[${k}]`] = v;
      }

      if (params.identifier) body.identifier = params.identifier;
      if (params.timestamp !== undefined) body.timestamp = params.timestamp;

      const event = await logger.time("tool.create_meter_event", () =>
        client.post<Record<string, unknown>>("/billing/meter_events", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_meter_event" });
      return { content: [{ type: "text", text: JSON.stringify(event, null, 2) }], structuredContent: event };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
