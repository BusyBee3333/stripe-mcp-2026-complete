// Tax Rates tools — Stripe API v1
// Covers: list_tax_rates, get_tax_rate, create_tax_rate, update_tax_rate

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListTaxRatesSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  active: z.boolean().optional().describe("Filter by active status (true=active only, false=archived only)"),
  inclusive: z.boolean().optional().describe("Filter by inclusive/exclusive (true=tax included in price, false=tax added on top)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — for reversed pagination"),
});

const GetTaxRateSchema = z.object({
  tax_rate_id: z.string().describe("Stripe tax rate ID (txr_xxx)"),
});

const CreateTaxRateSchema = z.object({
  display_name: z.string().describe("Tax rate display name shown to customers (e.g. 'VAT', 'Sales Tax', 'GST')"),
  percentage: z.number().min(0).max(100).describe("Tax percentage as a decimal (e.g. 20.5 for 20.5%)"),
  inclusive: z.boolean().describe("Whether tax is inclusive (true=included in price, false=added on top of price)"),
  country: z.string().length(2).optional().describe("Two-letter ISO country code (e.g. 'US', 'GB', 'DE')"),
  state: z.string().optional().describe("State/province code for US/CA taxes (e.g. 'CA', 'NY')"),
  jurisdiction: z.string().optional().describe("Tax jurisdiction name (e.g. 'EU', 'California')"),
  description: z.string().optional().describe("Internal description — not shown to customers"),
  active: z.boolean().optional().default(true).describe("Whether this tax rate is active (default: true)"),
  tax_type: z.enum(["gst", "hst", "igst", "jct", "lease_tax", "pst", "qst", "rst", "sales_tax", "vat"]).optional().describe("Type of tax (vat, sales_tax, gst, etc.)"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
});

const UpdateTaxRateSchema = z.object({
  tax_rate_id: z.string().describe("Stripe tax rate ID (txr_xxx)"),
  display_name: z.string().optional().describe("Updated display name"),
  description: z.string().optional().describe("Updated internal description"),
  jurisdiction: z.string().optional().describe("Updated jurisdiction name"),
  active: z.boolean().optional().describe("Activate or archive this tax rate"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata (merges with existing)"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_tax_rates",
      title: "List Tax Rates",
      description:
        "List Stripe tax rates. Tax rates define VAT, sales tax, GST, and other taxes applied to invoices and subscriptions. Filter by active status or inclusive/exclusive type. Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          active: { type: "boolean", description: "true=active only, false=archived only" },
          inclusive: { type: "boolean", description: "true=tax included in price, false=added on top" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_tax_rate",
      title: "Get Tax Rate",
      description:
        "Get full details for a Stripe tax rate by ID (txr_xxx). Returns percentage, display name, inclusive/exclusive status, country, and jurisdiction.",
      inputSchema: {
        type: "object",
        properties: {
          tax_rate_id: { type: "string", description: "Stripe tax rate ID (txr_xxx)" },
        },
        required: ["tax_rate_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_tax_rate",
      title: "Create Tax Rate",
      description:
        "Create a Stripe tax rate to apply to invoices, subscriptions, and checkout sessions. Set inclusive=true for VAT-included pricing or inclusive=false to add tax on top. Specify country and jurisdiction for compliance.",
      inputSchema: {
        type: "object",
        properties: {
          display_name: { type: "string", description: "Display name shown to customers (e.g. 'VAT', 'Sales Tax')" },
          percentage: { type: "number", description: "Tax percentage (e.g. 20.5 for 20.5%)" },
          inclusive: { type: "boolean", description: "true=tax included in price, false=added on top" },
          country: { type: "string", description: "Two-letter ISO country code (e.g. 'US', 'GB')" },
          state: { type: "string", description: "State/province code (e.g. 'CA', 'NY')" },
          jurisdiction: { type: "string", description: "Jurisdiction name (e.g. 'California', 'EU')" },
          description: { type: "string", description: "Internal description" },
          active: { type: "boolean", description: "Whether active (default: true)" },
          tax_type: { type: "string", enum: ["gst", "hst", "igst", "jct", "lease_tax", "pst", "qst", "rst", "sales_tax", "vat"], description: "Type of tax" },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["display_name", "percentage", "inclusive"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_tax_rate",
      title: "Update Tax Rate",
      description:
        "Update a Stripe tax rate — change display name, description, jurisdiction, or activate/archive it. Note: percentage and inclusive cannot be changed after creation (create a new tax rate instead).",
      inputSchema: {
        type: "object",
        properties: {
          tax_rate_id: { type: "string", description: "Stripe tax rate ID (txr_xxx)" },
          display_name: { type: "string", description: "Updated display name" },
          description: { type: "string", description: "Updated description" },
          jurisdiction: { type: "string", description: "Updated jurisdiction" },
          active: { type: "boolean", description: "Activate (true) or archive (false)" },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["tax_rate_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_tax_rates: async (args) => {
      const params = ListTaxRatesSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.active !== undefined) queryParams.active = params.active;
      if (params.inclusive !== undefined) queryParams.inclusive = params.inclusive;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;

      const result = await logger.time("tool.list_tax_rates", () =>
        client.list<Record<string, unknown>>("/tax_rates", queryParams)
      , { tool: "list_tax_rates" });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_tax_rate: async (args) => {
      const { tax_rate_id } = GetTaxRateSchema.parse(args);
      const taxRate = await logger.time("tool.get_tax_rate", () =>
        client.get<Record<string, unknown>>(`/tax_rates/${tax_rate_id}`)
      , { tool: "get_tax_rate", tax_rate_id });
      return { content: [{ type: "text", text: JSON.stringify(taxRate, null, 2) }], structuredContent: taxRate };
    },

    create_tax_rate: async (args) => {
      const params = CreateTaxRateSchema.parse(args);
      const body: Record<string, unknown> = {
        display_name: params.display_name,
        percentage: params.percentage,
        inclusive: params.inclusive,
      };
      if (params.country) body.country = params.country;
      if (params.state) body.state = params.state;
      if (params.jurisdiction) body.jurisdiction = params.jurisdiction;
      if (params.description) body.description = params.description;
      if (params.active !== undefined) body.active = params.active;
      if (params.tax_type) body.tax_type = params.tax_type;
      if (params.metadata) body.metadata = params.metadata;

      const taxRate = await logger.time("tool.create_tax_rate", () =>
        client.post<Record<string, unknown>>("/tax_rates", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_tax_rate" });
      return { content: [{ type: "text", text: JSON.stringify(taxRate, null, 2) }], structuredContent: taxRate };
    },

    update_tax_rate: async (args) => {
      const params = UpdateTaxRateSchema.parse(args);
      const { tax_rate_id, ...updates } = params;
      const body: Record<string, unknown> = {};
      if (updates.display_name !== undefined) body.display_name = updates.display_name;
      if (updates.description !== undefined) body.description = updates.description;
      if (updates.jurisdiction !== undefined) body.jurisdiction = updates.jurisdiction;
      if (updates.active !== undefined) body.active = updates.active;
      if (updates.metadata) body.metadata = updates.metadata;

      const taxRate = await logger.time("tool.update_tax_rate", () =>
        client.post<Record<string, unknown>>(`/tax_rates/${tax_rate_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_tax_rate", tax_rate_id });
      return { content: [{ type: "text", text: JSON.stringify(taxRate, null, 2) }], structuredContent: taxRate };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
