// Disputes tools — Stripe API v1
// Covers: list_disputes, get_dispute, update_dispute_evidence, close_dispute

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeDispute } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListDisputesSchema = z.object({
  charge: z.string().optional().describe("Filter by charge ID (ch_xxx)"),
  payment_intent: z.string().optional().describe("Filter by PaymentIntent ID (pi_xxx)"),
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
  created_gte: z.number().optional().describe("Filter by creation time (Unix timestamp, >=)"),
  created_lte: z.number().optional().describe("Filter by creation time (Unix timestamp, <=)"),
});

const GetDisputeSchema = z.object({
  dispute_id: z.string().describe("Stripe dispute ID (dp_xxx)"),
});

const UpdateDisputeEvidenceSchema = z.object({
  dispute_id: z.string().describe("Stripe dispute ID (dp_xxx)"),
  customer_email_address: z.string().optional().describe("Customer email address"),
  customer_name: z.string().optional().describe("Customer name"),
  customer_purchase_ip: z.string().optional().describe("Customer IP at time of purchase"),
  product_description: z.string().optional().describe("Description of the product or service"),
  receipt: z.string().optional().describe("Receipt file ID (uploaded to Stripe files)"),
  refund_policy: z.string().optional().describe("Refund policy file ID"),
  refund_policy_disclosure: z.string().optional().describe("Statement explaining refund policy"),
  refund_refusal_explanation: z.string().optional().describe("Explanation of why you are not refunding"),
  service_date: z.string().optional().describe("Date service was provided (YYYY-MM-DD)"),
  service_documentation: z.string().optional().describe("Service documentation file ID"),
  shipping_address: z.string().optional().describe("Shipping address"),
  shipping_carrier: z.string().optional().describe("Shipping carrier name"),
  shipping_date: z.string().optional().describe("Shipping date (YYYY-MM-DD)"),
  shipping_documentation: z.string().optional().describe("Shipping documentation file ID"),
  shipping_tracking_number: z.string().optional().describe("Shipping tracking number"),
  uncategorized_file: z.string().optional().describe("Uncategorized evidence file ID"),
  uncategorized_text: z.string().optional().describe("Additional evidence text"),
  submit: z.boolean().optional().default(false).describe("Whether to submit evidence immediately (default: false — saves as draft)"),
});

const CloseDisputeSchema = z.object({
  dispute_id: z.string().describe("Stripe dispute ID (dp_xxx) — closes dispute and accepts the chargeback"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_disputes",
      title: "List Disputes",
      description:
        "List Stripe disputes with optional filters by charge, PaymentIntent, and creation date. Returns dispute ID, amount, reason, and status. Uses keyset pagination — pass meta.lastId as starting_after for the next page.",
      inputSchema: {
        type: "object",
        properties: {
          charge: { type: "string", description: "Filter by charge ID (ch_xxx)" },
          payment_intent: { type: "string", description: "Filter by PaymentIntent ID (pi_xxx)" },
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
      name: "get_dispute",
      title: "Get Dispute",
      description:
        "Get full details for a Stripe dispute by ID (dp_xxx). Returns amount, reason, status, evidence details, and deadlines. Use to review an active dispute before submitting evidence.",
      inputSchema: {
        type: "object",
        properties: {
          dispute_id: { type: "string", description: "Stripe dispute ID (dp_xxx)" },
        },
        required: ["dispute_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          amount: { type: "number" },
          currency: { type: "string" },
          charge: { type: "string" },
          status: { type: "string" },
          reason: { type: "string" },
          evidence_details: { type: "object" },
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
      name: "update_dispute_evidence",
      title: "Update Dispute Evidence",
      description:
        "Submit or update evidence for a Stripe dispute. Provide relevant fields like product_description, shipping_tracking_number, customer_email_address, etc. Set submit=true to submit immediately, or false (default) to save as a draft for later submission.",
      inputSchema: {
        type: "object",
        properties: {
          dispute_id: { type: "string", description: "Stripe dispute ID (dp_xxx)" },
          customer_email_address: { type: "string", description: "Customer email address" },
          customer_name: { type: "string", description: "Customer name" },
          customer_purchase_ip: { type: "string", description: "Customer IP at time of purchase" },
          product_description: { type: "string", description: "Description of the product or service" },
          refund_policy_disclosure: { type: "string", description: "Statement explaining refund policy" },
          refund_refusal_explanation: { type: "string", description: "Explanation of why you are not refunding" },
          service_date: { type: "string", description: "Date service was provided (YYYY-MM-DD)" },
          shipping_address: { type: "string", description: "Shipping address" },
          shipping_carrier: { type: "string", description: "Shipping carrier name" },
          shipping_date: { type: "string", description: "Shipping date (YYYY-MM-DD)" },
          shipping_tracking_number: { type: "string", description: "Shipping tracking number" },
          uncategorized_text: { type: "string", description: "Additional evidence text" },
          submit: { type: "boolean", description: "Submit evidence immediately (default: false — saves as draft)" },
        },
        required: ["dispute_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          evidence: { type: "object" },
        },
        required: ["id"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "close_dispute",
      title: "Close Dispute",
      description:
        "Close a Stripe dispute by accepting the chargeback — use this when you decide not to contest. This is irreversible. The dispute status will change to 'lost' and the disputed amount will be returned to the customer.",
      inputSchema: {
        type: "object",
        properties: {
          dispute_id: { type: "string", description: "Stripe dispute ID (dp_xxx)" },
        },
        required: ["dispute_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
        },
        required: ["id", "status"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_disputes: async (args) => {
      const params = ListDisputesSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.charge) queryParams.charge = params.charge;
      if (params.payment_intent) queryParams.payment_intent = params.payment_intent;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.created_gte) queryParams["created[gte]"] = params.created_gte;
      if (params.created_lte) queryParams["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_disputes", () =>
        client.list<StripeDispute>("/disputes", queryParams)
      , { tool: "list_disputes" });

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

    get_dispute: async (args) => {
      const { dispute_id } = GetDisputeSchema.parse(args);

      const dispute = await logger.time("tool.get_dispute", () =>
        client.get<StripeDispute>(`/disputes/${dispute_id}`)
      , { tool: "get_dispute", dispute_id });

      return {
        content: [{ type: "text", text: JSON.stringify(dispute, null, 2) }],
        structuredContent: dispute,
      };
    },

    update_dispute_evidence: async (args) => {
      const params = UpdateDisputeEvidenceSchema.parse(args);
      const { dispute_id, submit, ...evidenceFields } = params;

      const body: Record<string, string | number | boolean | undefined | null> = {};
      if (submit !== undefined) body.submit = submit;

      // Map evidence fields to form-encoded evidence[field] format
      const evidenceMap: Record<string, string | undefined> = {
        customer_email_address: evidenceFields.customer_email_address,
        customer_name: evidenceFields.customer_name,
        customer_purchase_ip: evidenceFields.customer_purchase_ip,
        product_description: evidenceFields.product_description,
        receipt: evidenceFields.receipt,
        refund_policy: evidenceFields.refund_policy,
        refund_policy_disclosure: evidenceFields.refund_policy_disclosure,
        refund_refusal_explanation: evidenceFields.refund_refusal_explanation,
        service_date: evidenceFields.service_date,
        service_documentation: evidenceFields.service_documentation,
        shipping_address: evidenceFields.shipping_address,
        shipping_carrier: evidenceFields.shipping_carrier,
        shipping_date: evidenceFields.shipping_date,
        shipping_documentation: evidenceFields.shipping_documentation,
        shipping_tracking_number: evidenceFields.shipping_tracking_number,
        uncategorized_file: evidenceFields.uncategorized_file,
        uncategorized_text: evidenceFields.uncategorized_text,
      };

      for (const [key, value] of Object.entries(evidenceMap)) {
        if (value !== undefined) {
          body[`evidence[${key}]`] = value;
        }
      }

      const dispute = await logger.time("tool.update_dispute_evidence", () =>
        client.post<StripeDispute>(`/disputes/${dispute_id}`, body)
      , { tool: "update_dispute_evidence", dispute_id });

      return {
        content: [{ type: "text", text: JSON.stringify(dispute, null, 2) }],
        structuredContent: dispute,
      };
    },

    close_dispute: async (args) => {
      const { dispute_id } = CloseDisputeSchema.parse(args);

      const dispute = await logger.time("tool.close_dispute", () =>
        client.post<StripeDispute>(`/disputes/${dispute_id}/close`, {})
      , { tool: "close_dispute", dispute_id });

      return {
        content: [{ type: "text", text: JSON.stringify(dispute, null, 2) }],
        structuredContent: dispute,
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
