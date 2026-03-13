// Sources tools — Stripe API v1
// Covers: create_source, get_source, update_source, attach_source, detach_source

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const CreateSourceSchema = z.object({
  type: z.string().describe("Source type (e.g. 'card', 'sepa_debit', 'ideal', 'sofort', 'bancontact', 'giropay', 'p24', 'alipay', 'wechat')"),
  amount: z.number().int().optional().describe("Amount in smallest currency unit (required for single-use sources like iDEAL)"),
  currency: z.string().length(3).optional().describe("Three-letter currency code (required for most payment methods)"),
  usage: z.enum(["reusable", "single_use"]).optional().describe("reusable: can be charged multiple times. single_use: consumed after one charge."),
  redirect_return_url: z.string().url().optional().describe("URL to redirect after the payment authorization flow (required for redirect-based flows like iDEAL, Sofort)"),
  metadata: z.record(z.string()).optional(),
  owner_name: z.string().optional().describe("Owner's full name"),
  owner_email: z.string().optional().describe("Owner's email address"),
  owner_phone: z.string().optional().describe("Owner's phone number"),
  statement_descriptor: z.string().optional().describe("Statement descriptor (max 22 chars)"),
  token: z.string().optional().describe("Token (tok_xxx) to convert into a Source"),
});

const GetSourceSchema = z.object({
  source_id: z.string().describe("Stripe source ID (src_xxx)"),
});

const UpdateSourceSchema = z.object({
  source_id: z.string().describe("Stripe source ID (src_xxx)"),
  metadata: z.record(z.string()).optional(),
  owner_name: z.string().optional(),
  owner_email: z.string().optional(),
  owner_phone: z.string().optional(),
});

const AttachSourceSchema = z.object({
  customer_id: z.string().describe("Customer ID (cus_xxx) to attach the source to"),
  source: z.string().describe("Source ID (src_xxx) or Token (tok_xxx) to attach"),
});

const DetachSourceSchema = z.object({
  customer_id: z.string().describe("Customer ID (cus_xxx)"),
  source_id: z.string().describe("Source ID (src_xxx or card_xxx or ba_xxx) to detach from the customer"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "create_source",
      title: "Create Source",
      description:
        "Create a Stripe Source for a payment method. Sources support a wide range of payment methods including cards, SEPA Direct Debit, iDEAL, Sofort, Bancontact, Giropay, P24, Alipay, and more. For redirect-based methods, the returned source.redirect.url must be opened in the browser. Note: For new integrations, prefer Payment Methods (pm_xxx) and Payment Intents over Sources.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", description: "Source type (e.g. 'card', 'sepa_debit', 'ideal', 'sofort')" },
          amount: { type: "number", description: "Amount in smallest currency unit" },
          currency: { type: "string", description: "Three-letter currency code" },
          usage: { type: "string", enum: ["reusable", "single_use"] },
          redirect_return_url: { type: "string", description: "Redirect URL for authorization flows" },
          metadata: { type: "object" },
          owner_name: { type: "string" },
          owner_email: { type: "string" },
          owner_phone: { type: "string" },
          statement_descriptor: { type: "string" },
          token: { type: "string", description: "Token to convert into a Source" },
        },
        required: ["type"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_source",
      title: "Get Source",
      description: "Retrieve a Source by ID (src_xxx). Returns type, status, usage, owner, and type-specific data (e.g. card details, IBAN last4 for SEPA).",
      inputSchema: {
        type: "object",
        properties: { source_id: { type: "string", description: "Stripe source ID (src_xxx)" } },
        required: ["source_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_source",
      title: "Update Source",
      description: "Update a Source's metadata or owner information.",
      inputSchema: {
        type: "object",
        properties: {
          source_id: { type: "string", description: "Stripe source ID (src_xxx)" },
          metadata: { type: "object" },
          owner_name: { type: "string" },
          owner_email: { type: "string" },
          owner_phone: { type: "string" },
        },
        required: ["source_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "attach_source",
      title: "Attach Source to Customer",
      description:
        "Attach a Source (or Token) to a customer. After attaching, the source can be used to charge the customer. For reusable sources, the customer ID is required for future charges.",
      inputSchema: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "Customer ID (cus_xxx)" },
          source: { type: "string", description: "Source ID (src_xxx) or Token (tok_xxx) to attach" },
        },
        required: ["customer_id", "source"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "detach_source",
      title: "Detach Source from Customer",
      description: "Detach a Source (or card, bank account) from a customer. The source can no longer be used for future charges against this customer.",
      inputSchema: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "Customer ID (cus_xxx)" },
          source_id: { type: "string", description: "Source/card/bank account ID to detach" },
        },
        required: ["customer_id", "source_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    create_source: async (args) => {
      const params = CreateSourceSchema.parse(args);
      const body: Record<string, unknown> = { type: params.type };
      if (params.amount !== undefined) body.amount = params.amount;
      if (params.currency) body.currency = params.currency;
      if (params.usage) body.usage = params.usage;
      if (params.redirect_return_url) body["redirect[return_url]"] = params.redirect_return_url;
      if (params.owner_name) body["owner[name]"] = params.owner_name;
      if (params.owner_email) body["owner[email]"] = params.owner_email;
      if (params.owner_phone) body["owner[phone]"] = params.owner_phone;
      if (params.statement_descriptor) body.statement_descriptor = params.statement_descriptor;
      if (params.token) body.token = params.token;
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.create_source", () =>
        client.post<Record<string, unknown>>("/sources", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_source" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    get_source: async (args) => {
      const { source_id } = GetSourceSchema.parse(args);
      const r = await logger.time("tool.get_source", () =>
        client.get<Record<string, unknown>>(`/sources/${source_id}`)
      , { tool: "get_source" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    update_source: async (args) => {
      const { source_id, ...rest } = UpdateSourceSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (rest.metadata) body.metadata = rest.metadata;
      if (rest.owner_name) body["owner[name]"] = rest.owner_name;
      if (rest.owner_email) body["owner[email]"] = rest.owner_email;
      if (rest.owner_phone) body["owner[phone]"] = rest.owner_phone;

      const r = await logger.time("tool.update_source", () =>
        client.post<Record<string, unknown>>(`/sources/${source_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_source" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    attach_source: async (args) => {
      const { customer_id, source } = AttachSourceSchema.parse(args);
      const body = { source };

      const r = await logger.time("tool.attach_source", () =>
        client.post<Record<string, unknown>>(`/customers/${customer_id}/sources`, body)
      , { tool: "attach_source" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    detach_source: async (args) => {
      const { customer_id, source_id } = DetachSourceSchema.parse(args);
      const r = await logger.time("tool.detach_source", () =>
        client.delete<Record<string, unknown>>(`/customers/${customer_id}/sources/${source_id}`)
      , { tool: "detach_source" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
