// Subscription Schedules tools — Stripe API v1
// Covers: list_subscription_schedules, get_subscription_schedule, create_subscription_schedule,
//         update_subscription_schedule, cancel_subscription_schedule, release_subscription_schedule

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListSubscriptionSchedulesSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  customer: z.string().optional().describe("Filter by customer ID (cus_xxx)"),
  scheduled_at_gte: z.number().optional().describe("Filter by scheduled start time (Unix timestamp, >=)"),
  scheduled_at_lte: z.number().optional().describe("Filter by scheduled start time (Unix timestamp, <=)"),
  canceled: z.boolean().optional().describe("Filter by canceled status"),
  completed: z.boolean().optional().describe("Filter by completed status"),
  released: z.boolean().optional().describe("Filter by released status"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — ID for reversed pagination"),
});

const GetSubscriptionScheduleSchema = z.object({
  schedule_id: z.string().describe("Stripe subscription schedule ID (sub_sched_xxx)"),
});

const PhaseItemSchema = z.object({
  price: z.string().describe("Price ID (price_xxx) for this phase item"),
  quantity: z.number().int().positive().optional().default(1).describe("Quantity (default: 1)"),
});

const PhaseSchema = z.object({
  items: z.array(PhaseItemSchema).describe("Array of price items for this phase"),
  iterations: z.number().int().positive().optional().describe("Number of billing cycles for this phase (omit for infinite last phase)"),
  trial: z.boolean().optional().describe("Whether this phase has a trial"),
  coupon: z.string().optional().describe("Coupon ID to apply during this phase"),
  metadata: z.record(z.string()).optional().describe("Metadata for this phase"),
});

const CreateSubscriptionScheduleSchema = z.object({
  customer: z.string().describe("Customer ID (cus_xxx) — required"),
  start_date: z.union([z.literal("now"), z.number().int().positive()]).optional().describe("Start date — 'now' or Unix timestamp (default: now)"),
  end_behavior: z.enum(["release", "cancel"]).optional().default("release").describe("Behavior when schedule ends: 'release' keeps subscription active, 'cancel' cancels it (default: release)"),
  phases: z.array(PhaseSchema).min(1).describe("Array of billing phases — each defines prices and duration"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
});

const UpdateSubscriptionScheduleSchema = z.object({
  schedule_id: z.string().describe("Stripe subscription schedule ID (sub_sched_xxx)"),
  end_behavior: z.enum(["release", "cancel"]).optional().describe("Behavior when schedule ends"),
  phases: z.array(PhaseSchema).optional().describe("Replace all phases with this array"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata (merges with existing)"),
  proration_behavior: z.enum(["create_prorations", "none", "always_invoice"]).optional().describe("Proration behavior when updating phases"),
});

const CancelSubscriptionScheduleSchema = z.object({
  schedule_id: z.string().describe("Stripe subscription schedule ID (sub_sched_xxx) to cancel"),
  invoice_now: z.boolean().optional().default(false).describe("Create a final invoice immediately (default: false)"),
  prorate: z.boolean().optional().default(false).describe("Prorate the final invoice based on unused time (default: false)"),
});

const ReleaseSubscriptionScheduleSchema = z.object({
  schedule_id: z.string().describe("Stripe subscription schedule ID (sub_sched_xxx) to release"),
  preserve_cancel_date: z.boolean().optional().describe("Keep the subscription's cancel_at date after release"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_subscription_schedules",
      title: "List Subscription Schedules",
      description:
        "List Stripe subscription schedules with optional filters by customer and status. Subscription schedules automate multi-phase subscription changes (e.g., trial → monthly → annual). Returns schedule ID, status, current phase, and customer. Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          customer: { type: "string", description: "Filter by customer ID (cus_xxx)" },
          canceled: { type: "boolean", description: "Filter canceled schedules" },
          completed: { type: "boolean", description: "Filter completed schedules" },
          released: { type: "boolean", description: "Filter released schedules" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_subscription_schedule",
      title: "Get Subscription Schedule",
      description:
        "Get full details for a Stripe subscription schedule by ID (sub_sched_xxx). Returns phases with price/quantity/duration, current phase index, end behavior, and associated subscription.",
      inputSchema: {
        type: "object",
        properties: {
          schedule_id: { type: "string", description: "Stripe subscription schedule ID (sub_sched_xxx)" },
        },
        required: ["schedule_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_subscription_schedule",
      title: "Create Subscription Schedule",
      description:
        "Create a Stripe subscription schedule to automate phased billing changes. Define multiple phases with different prices/durations. When the schedule ends, use end_behavior: 'release' to keep the subscription active or 'cancel' to cancel it.",
      inputSchema: {
        type: "object",
        properties: {
          customer: { type: "string", description: "Customer ID (cus_xxx) — required" },
          start_date: { type: "string", description: "Start date — 'now' or Unix timestamp" },
          end_behavior: { type: "string", enum: ["release", "cancel"], description: "What happens when schedule ends (default: release)" },
          phases: {
            type: "array",
            description: "Array of billing phases. Each has items (price+quantity array), optional iterations (billing cycles), trial, coupon.",
            items: { type: "object" },
          },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["customer", "phases"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_subscription_schedule",
      title: "Update Subscription Schedule",
      description:
        "Update a Stripe subscription schedule — change phases, end behavior, or metadata. When replacing phases, provide the complete new phase array. Use proration_behavior to control mid-cycle adjustments.",
      inputSchema: {
        type: "object",
        properties: {
          schedule_id: { type: "string", description: "Stripe subscription schedule ID (sub_sched_xxx)" },
          end_behavior: { type: "string", enum: ["release", "cancel"], description: "Behavior when schedule ends" },
          phases: { type: "array", description: "Replace all phases with this array", items: { type: "object" } },
          metadata: { type: "object", description: "Key-value metadata" },
          proration_behavior: { type: "string", enum: ["create_prorations", "none", "always_invoice"], description: "Proration behavior" },
        },
        required: ["schedule_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "cancel_subscription_schedule",
      title: "Cancel Subscription Schedule",
      description:
        "Cancel a Stripe subscription schedule and optionally its underlying subscription. Set invoice_now=true to generate a final invoice immediately. Set prorate=true to credit unused time.",
      inputSchema: {
        type: "object",
        properties: {
          schedule_id: { type: "string", description: "Stripe subscription schedule ID (sub_sched_xxx)" },
          invoice_now: { type: "boolean", description: "Create final invoice immediately (default: false)" },
          prorate: { type: "boolean", description: "Prorate final invoice for unused time (default: false)" },
        },
        required: ["schedule_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "release_subscription_schedule",
      title: "Release Subscription Schedule",
      description:
        "Release a Stripe subscription schedule — removes schedule control while keeping the underlying subscription active. The subscription continues normally without phase management after release.",
      inputSchema: {
        type: "object",
        properties: {
          schedule_id: { type: "string", description: "Stripe subscription schedule ID (sub_sched_xxx)" },
          preserve_cancel_date: { type: "boolean", description: "Keep subscription's cancel_at date after release" },
        },
        required: ["schedule_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_subscription_schedules: async (args) => {
      const params = ListSubscriptionSchedulesSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.customer) queryParams.customer = params.customer;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;
      if (params.canceled !== undefined) queryParams.canceled = params.canceled;
      if (params.completed !== undefined) queryParams.completed = params.completed;
      if (params.released !== undefined) queryParams.released = params.released;
      if (params.scheduled_at_gte) queryParams["scheduled_at[gte]"] = params.scheduled_at_gte;
      if (params.scheduled_at_lte) queryParams["scheduled_at[lte]"] = params.scheduled_at_lte;

      const result = await logger.time("tool.list_subscription_schedules", () =>
        client.list<Record<string, unknown>>("/subscription_schedules", queryParams)
      , { tool: "list_subscription_schedules" });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_subscription_schedule: async (args) => {
      const { schedule_id } = GetSubscriptionScheduleSchema.parse(args);
      const schedule = await logger.time("tool.get_subscription_schedule", () =>
        client.get<Record<string, unknown>>(`/subscription_schedules/${schedule_id}`)
      , { tool: "get_subscription_schedule", schedule_id });
      return { content: [{ type: "text", text: JSON.stringify(schedule, null, 2) }], structuredContent: schedule };
    },

    create_subscription_schedule: async (args) => {
      const params = CreateSubscriptionScheduleSchema.parse(args);
      const body: Record<string, unknown> = { customer: params.customer };

      if (params.start_date) body.start_date = params.start_date;
      if (params.end_behavior) body.end_behavior = params.end_behavior;
      if (params.metadata) body.metadata = params.metadata;

      // Flatten phases for form-encoded
      params.phases.forEach((phase, pi) => {
        phase.items.forEach((item, ii) => {
          body[`phases[${pi}][items][${ii}][price]`] = item.price;
          body[`phases[${pi}][items][${ii}][quantity]`] = item.quantity ?? 1;
        });
        if (phase.iterations !== undefined) body[`phases[${pi}][iterations]`] = phase.iterations;
        if (phase.trial !== undefined) body[`phases[${pi}][trial]`] = phase.trial;
        if (phase.coupon) body[`phases[${pi}][coupon]`] = phase.coupon;
        if (phase.metadata) {
          for (const [k, v] of Object.entries(phase.metadata)) {
            body[`phases[${pi}][metadata][${k}]`] = v;
          }
        }
      });

      const schedule = await logger.time("tool.create_subscription_schedule", () =>
        client.post<Record<string, unknown>>("/subscription_schedules", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_subscription_schedule" });
      return { content: [{ type: "text", text: JSON.stringify(schedule, null, 2) }], structuredContent: schedule };
    },

    update_subscription_schedule: async (args) => {
      const params = UpdateSubscriptionScheduleSchema.parse(args);
      const { schedule_id, phases, end_behavior, metadata, proration_behavior } = params;
      const body: Record<string, unknown> = {};

      if (end_behavior) body.end_behavior = end_behavior;
      if (proration_behavior) body.proration_behavior = proration_behavior;
      if (metadata) body.metadata = metadata;

      if (phases) {
        phases.forEach((phase, pi) => {
          phase.items.forEach((item, ii) => {
            body[`phases[${pi}][items][${ii}][price]`] = item.price;
            body[`phases[${pi}][items][${ii}][quantity]`] = item.quantity ?? 1;
          });
          if (phase.iterations !== undefined) body[`phases[${pi}][iterations]`] = phase.iterations;
          if (phase.trial !== undefined) body[`phases[${pi}][trial]`] = phase.trial;
          if (phase.coupon) body[`phases[${pi}][coupon]`] = phase.coupon;
        });
      }

      const schedule = await logger.time("tool.update_subscription_schedule", () =>
        client.post<Record<string, unknown>>(`/subscription_schedules/${schedule_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_subscription_schedule", schedule_id });
      return { content: [{ type: "text", text: JSON.stringify(schedule, null, 2) }], structuredContent: schedule };
    },

    cancel_subscription_schedule: async (args) => {
      const params = CancelSubscriptionScheduleSchema.parse(args);
      const body: Record<string, string | number | boolean | undefined | null> = {};
      if (params.invoice_now !== undefined) body.invoice_now = params.invoice_now;
      if (params.prorate !== undefined) body.prorate = params.prorate;

      const schedule = await logger.time("tool.cancel_subscription_schedule", () =>
        client.post<Record<string, unknown>>(`/subscription_schedules/${params.schedule_id}/cancel`, body)
      , { tool: "cancel_subscription_schedule", schedule_id: params.schedule_id });
      return { content: [{ type: "text", text: JSON.stringify(schedule, null, 2) }], structuredContent: schedule };
    },

    release_subscription_schedule: async (args) => {
      const params = ReleaseSubscriptionScheduleSchema.parse(args);
      const body: Record<string, string | number | boolean | undefined | null> = {};
      if (params.preserve_cancel_date !== undefined) body.preserve_cancel_date = params.preserve_cancel_date;

      const schedule = await logger.time("tool.release_subscription_schedule", () =>
        client.post<Record<string, unknown>>(`/subscription_schedules/${params.schedule_id}/release`, body)
      , { tool: "release_subscription_schedule", schedule_id: params.schedule_id });
      return { content: [{ type: "text", text: JSON.stringify(schedule, null, 2) }], structuredContent: schedule };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
