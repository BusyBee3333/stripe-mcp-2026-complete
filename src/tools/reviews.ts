// Reviews tools — Stripe API v1
// Covers: list_reviews, get_review, approve_review

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListReviewsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  created_gte: z.number().optional(),
  created_lte: z.number().optional(),
});

const GetReviewSchema = z.object({
  review_id: z.string().describe("Stripe review ID (prv_xxx)"),
});

const ApproveReviewSchema = z.object({
  review_id: z.string().describe("Stripe review ID (prv_xxx) to approve"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_reviews",
      title: "List Radar Reviews",
      description:
        "List Stripe Radar payment reviews. Reviews are flagged by Radar for manual review. Returns review ID, reason, opened_reason, payment_intent/charge, and status (open/approved/refunded/refunded_as_fraud/disputed/archived). Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          starting_after: { type: "string", description: "Pagination cursor" },
          ending_before: { type: "string", description: "Pagination cursor — reversed" },
          created_gte: { type: "number", description: "Filter by creation time (Unix timestamp, >=)" },
          created_lte: { type: "number", description: "Filter by creation time (Unix timestamp, <=)" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_review",
      title: "Get Radar Review",
      description:
        "Retrieve a specific Radar review by ID (prv_xxx). Returns the full review including reason, risk_level, risk_score, payment_intent, session info, and IP geolocation data.",
      inputSchema: {
        type: "object",
        properties: { review_id: { type: "string", description: "Stripe review ID (prv_xxx)" } },
        required: ["review_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "approve_review",
      title: "Approve Radar Review",
      description:
        "Approve a Radar review. Approving a review allows the associated payment to proceed. Returns the updated review with status 'approved'. Use this after manually verifying the payment is legitimate.",
      inputSchema: {
        type: "object",
        properties: { review_id: { type: "string", description: "Stripe review ID (prv_xxx) to approve" } },
        required: ["review_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_reviews: async (args) => {
      const params = ListReviewsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      if (params.created_gte) q["created[gte]"] = params.created_gte;
      if (params.created_lte) q["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_reviews", () =>
        client.list<Record<string, unknown>>("/reviews", q)
      , { tool: "list_reviews" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_review: async (args) => {
      const { review_id } = GetReviewSchema.parse(args);
      const review = await logger.time("tool.get_review", () =>
        client.get<Record<string, unknown>>(`/reviews/${review_id}`)
      , { tool: "get_review", review_id });
      return { content: [{ type: "text", text: JSON.stringify(review, null, 2) }], structuredContent: review };
    },

    approve_review: async (args) => {
      const { review_id } = ApproveReviewSchema.parse(args);
      const review = await logger.time("tool.approve_review", () =>
        client.post<Record<string, unknown>>(`/reviews/${review_id}/approve`, {})
      , { tool: "approve_review", review_id });
      return { content: [{ type: "text", text: JSON.stringify(review, null, 2) }], structuredContent: review };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
