// Tax tools — Stripe API v1
// Covers: Tax Calculations (create, retrieve line items), Tax Transactions (create from calculation, create reversal, retrieve),
//         Tax Registrations (list, create, update), Tax Settings (retrieve, update)

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// --- Tax Calculations ---
const CreateTaxCalculationSchema = z.object({
  currency: z.string().length(3).describe("Three-letter currency code (e.g. 'usd')"),
  line_items: z.array(z.object({
    amount: z.number().int().describe("Line item amount in smallest currency unit"),
    reference: z.string().describe("Unique reference for this line item"),
    tax_code: z.string().optional().describe("Stripe tax code (e.g. 'txcd_10000000' for general physical goods)"),
    tax_behavior: z.enum(["exclusive", "inclusive"]).optional(),
  })).min(1).describe("Line items to calculate tax on"),
  customer: z.string().optional().describe("Customer ID (cus_xxx) — uses their tax settings if provided"),
  customer_details_address_country: z.string().optional().describe("Customer's country (two-letter code)"),
  customer_details_address_postal_code: z.string().optional(),
  customer_details_address_state: z.string().optional(),
  customer_details_address_city: z.string().optional(),
  customer_details_address_line1: z.string().optional(),
  customer_details_taxability_override: z.enum(["customer_exempt", "none", "reverse_charge"]).optional(),
  shipping_cost_amount: z.number().optional().describe("Shipping cost amount in smallest currency unit"),
  shipping_cost_tax_code: z.string().optional().describe("Tax code for shipping"),
  tax_date: z.number().optional().describe("Unix timestamp to use as the tax date (for historical calculations)"),
  expand: z.array(z.string()).optional(),
});

const GetTaxCalculationLineItemsSchema = z.object({
  calculation_id: z.string().describe("Tax calculation ID (taxcalc_xxx)"),
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

// --- Tax Transactions ---
const CreateTaxTransactionFromCalculationSchema = z.object({
  calculation: z.string().describe("Tax calculation ID (taxcalc_xxx) to create a transaction from"),
  reference: z.string().describe("Unique reference for this transaction (e.g. order ID)"),
  metadata: z.record(z.string()).optional(),
});

const CreateTaxTransactionReversalSchema = z.object({
  original_transaction: z.string().describe("Original tax transaction ID to reverse"),
  reference: z.string().describe("Unique reference for this reversal"),
  mode: z.enum(["full", "partial"]).describe("full: reverses the entire transaction. partial: reverses specific line items."),
  line_items: z.array(z.object({
    original_line_item: z.string().describe("Original line item reference"),
    amount: z.number().optional().describe("Amount to reverse (for partial reversals)"),
    quantity: z.number().optional(),
    reference: z.string().describe("Unique reference for this reversal line item"),
  })).optional().describe("Required for partial mode"),
  flat_amount: z.number().optional().describe("Flat amount to reverse (alternative to line_items for partial mode)"),
  metadata: z.record(z.string()).optional(),
});

const GetTaxTransactionSchema = z.object({
  transaction_id: z.string().describe("Tax transaction ID (tax_xxx)"),
});

// --- Tax Registrations ---
const ListTaxRegistrationsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  status: z.enum(["active", "all", "expired", "scheduled"]).optional().default("active"),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const CreateTaxRegistrationSchema = z.object({
  country: z.string().describe("Two-letter country code where you're registering for tax collection"),
  country_options_type: z.string().optional().describe("Country-specific registration type (e.g. 'standard', 'simplified', 'ioss' for EU VAT MOSS). Required for some countries."),
  state: z.string().optional().describe("State/province (required for US, CA, AU, and other countries with sub-jurisdictions)"),
  active_from: z.union([z.literal("now"), z.number()]).optional().default("now").describe("When this registration takes effect — 'now' or a Unix timestamp"),
  expires_at: z.number().optional().describe("When this registration expires (Unix timestamp)"),
});

const UpdateTaxRegistrationSchema = z.object({
  registration_id: z.string().describe("Tax registration ID (taxreg_xxx)"),
  active_from: z.union([z.literal("now"), z.number()]).optional().describe("When this registration takes effect"),
  expires_at: z.union([z.literal("now"), z.number()]).optional().describe("When this registration expires"),
});

// --- Tax Settings ---
const UpdateTaxSettingsSchema = z.object({
  defaults_tax_behavior: z.enum(["exclusive", "inclusive", "inferred_by_currency"]).optional().describe("Default tax behavior for all transactions"),
  defaults_tax_code: z.string().optional().describe("Default Stripe tax code for products without one"),
  head_office_address_country: z.string().optional().describe("Your business's head office country (two-letter code)"),
  head_office_address_state: z.string().optional(),
  head_office_address_city: z.string().optional(),
  head_office_address_line1: z.string().optional(),
  head_office_address_postal_code: z.string().optional(),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "create_tax_calculation",
      title: "Create Tax Calculation",
      description:
        "Calculate tax for a transaction using Stripe Tax. Provide line items with amounts and optionally customer details or shipping info. Returns a calculation with tax amounts per jurisdiction, total tax, and taxability status per line item. The calculation expires after 90 days.",
      inputSchema: {
        type: "object",
        properties: {
          currency: { type: "string", description: "Three-letter currency code (e.g. 'usd')" },
          line_items: { type: "array", description: "Line items (array of {amount, reference, tax_code?, tax_behavior?})" },
          customer: { type: "string", description: "Customer ID (cus_xxx) for customer-specific tax rates" },
          customer_details_address_country: { type: "string", description: "Customer's country (two-letter code)" },
          customer_details_address_postal_code: { type: "string" },
          customer_details_address_state: { type: "string" },
          customer_details_taxability_override: { type: "string", enum: ["customer_exempt", "none", "reverse_charge"] },
          shipping_cost_amount: { type: "number", description: "Shipping cost in smallest currency unit" },
          shipping_cost_tax_code: { type: "string" },
          tax_date: { type: "number", description: "Tax date (Unix timestamp)" },
        },
        required: ["currency", "line_items"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_tax_calculation_line_items",
      title: "Get Tax Calculation Line Items",
      description: "Retrieve the line items from a Tax Calculation, including per-line tax amounts and jurisdiction breakdown.",
      inputSchema: {
        type: "object",
        properties: {
          calculation_id: { type: "string", description: "Tax calculation ID (taxcalc_xxx)" },
          limit: { type: "number" },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
        required: ["calculation_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_tax_transaction_from_calculation",
      title: "Create Tax Transaction From Calculation",
      description:
        "Commit a Tax Calculation into a Tax Transaction. Call this when the order is actually placed/paid to lock in the tax amounts for reporting. The reference must be unique (e.g. your order ID).",
      inputSchema: {
        type: "object",
        properties: {
          calculation: { type: "string", description: "Tax calculation ID (taxcalc_xxx)" },
          reference: { type: "string", description: "Unique reference (e.g. order ID)" },
          metadata: { type: "object" },
        },
        required: ["calculation", "reference"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_tax_transaction_reversal",
      title: "Create Tax Transaction Reversal",
      description:
        "Create a reversal for a Tax Transaction (e.g. when issuing a refund). Use mode='full' to reverse the entire transaction or mode='partial' to reverse specific line items.",
      inputSchema: {
        type: "object",
        properties: {
          original_transaction: { type: "string", description: "Original tax transaction ID to reverse" },
          reference: { type: "string", description: "Unique reference for this reversal" },
          mode: { type: "string", enum: ["full", "partial"] },
          line_items: { type: "array", description: "Line items to reverse (required for partial mode)" },
          flat_amount: { type: "number", description: "Flat amount to reverse (alternative for partial mode)" },
          metadata: { type: "object" },
        },
        required: ["original_transaction", "reference", "mode"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_tax_transaction",
      title: "Get Tax Transaction",
      description: "Retrieve a specific Tax Transaction by ID. Returns committed tax amounts, jurisdiction breakdown, and reversal status.",
      inputSchema: {
        type: "object",
        properties: { transaction_id: { type: "string", description: "Tax transaction ID" } },
        required: ["transaction_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_tax_registrations",
      title: "List Tax Registrations",
      description:
        "List your Stripe Tax registrations. Registrations represent your tax obligations in specific jurisdictions. Stripe Tax uses these to determine if and how to tax transactions. Optionally filter by status (active/scheduled/expired).",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
          status: { type: "string", enum: ["active", "all", "expired", "scheduled"] },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_tax_registration",
      title: "Create Tax Registration",
      description:
        "Register your business for tax collection in a jurisdiction. Once created, Stripe Tax will automatically collect and report taxes for transactions in that jurisdiction.",
      inputSchema: {
        type: "object",
        properties: {
          country: { type: "string", description: "Two-letter country code" },
          country_options_type: { type: "string", description: "Registration type (e.g. 'standard', 'simplified', 'ioss')" },
          state: { type: "string", description: "State/province (required for US, CA, AU, etc.)" },
          active_from: { type: "string", description: "When registration takes effect ('now' or Unix timestamp)" },
          expires_at: { type: "number", description: "Expiry timestamp" },
        },
        required: ["country"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_tax_registration",
      title: "Update Tax Registration",
      description: "Update a Tax Registration's active_from or expires_at dates. Use to schedule a future registration or set an expiry.",
      inputSchema: {
        type: "object",
        properties: {
          registration_id: { type: "string", description: "Tax registration ID (taxreg_xxx)" },
          active_from: { type: "string", description: "New active_from ('now' or Unix timestamp)" },
          expires_at: { type: "string", description: "New expiry ('now' or Unix timestamp)" },
        },
        required: ["registration_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_tax_settings",
      title: "Get Tax Settings",
      description:
        "Retrieve your Stripe Tax settings. Returns default tax behavior (exclusive/inclusive), default tax code, head office address, and status (active/pending). Review these before enabling automatic tax collection.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_tax_settings",
      title: "Update Tax Settings",
      description:
        "Update your Stripe Tax settings. Set default tax behavior (exclusive means tax is added on top, inclusive means tax is included in the price), default tax code, and head office address.",
      inputSchema: {
        type: "object",
        properties: {
          defaults_tax_behavior: { type: "string", enum: ["exclusive", "inclusive", "inferred_by_currency"] },
          defaults_tax_code: { type: "string", description: "Default tax code for products (e.g. 'txcd_10000000')" },
          head_office_address_country: { type: "string", description: "Head office country (two-letter code)" },
          head_office_address_state: { type: "string" },
          head_office_address_city: { type: "string" },
          head_office_address_line1: { type: "string" },
          head_office_address_postal_code: { type: "string" },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    create_tax_calculation: async (args) => {
      const params = CreateTaxCalculationSchema.parse(args);
      const body: Record<string, unknown> = { currency: params.currency };

      params.line_items.forEach((item, i) => {
        body[`line_items[${i}][amount]`] = item.amount;
        body[`line_items[${i}][reference]`] = item.reference;
        if (item.tax_code) body[`line_items[${i}][tax_code]`] = item.tax_code;
        if (item.tax_behavior) body[`line_items[${i}][tax_behavior]`] = item.tax_behavior;
      });

      if (params.customer) body.customer = params.customer;
      if (params.customer_details_address_country) body["customer_details[address][country]"] = params.customer_details_address_country;
      if (params.customer_details_address_postal_code) body["customer_details[address][postal_code]"] = params.customer_details_address_postal_code;
      if (params.customer_details_address_state) body["customer_details[address][state]"] = params.customer_details_address_state;
      if (params.customer_details_address_city) body["customer_details[address][city]"] = params.customer_details_address_city;
      if (params.customer_details_address_line1) body["customer_details[address][line1]"] = params.customer_details_address_line1;
      if (params.customer_details_taxability_override) body["customer_details[taxability_override]"] = params.customer_details_taxability_override;
      if (params.shipping_cost_amount !== undefined) body["shipping_cost[amount]"] = params.shipping_cost_amount;
      if (params.shipping_cost_tax_code) body["shipping_cost[tax_code]"] = params.shipping_cost_tax_code;
      if (params.tax_date !== undefined) body.tax_date = params.tax_date;

      const r = await logger.time("tool.create_tax_calculation", () =>
        client.post<Record<string, unknown>>("/tax/calculations", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_tax_calculation" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    get_tax_calculation_line_items: async (args) => {
      const params = GetTaxCalculationLineItemsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.get_tax_calculation_line_items", () =>
        client.list<Record<string, unknown>>(`/tax/calculations/${params.calculation_id}/line_items`, q)
      , { tool: "get_tax_calculation_line_items" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    create_tax_transaction_from_calculation: async (args) => {
      const params = CreateTaxTransactionFromCalculationSchema.parse(args);
      const body: Record<string, unknown> = { calculation: params.calculation, reference: params.reference };
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.create_tax_transaction_from_calculation", () =>
        client.post<Record<string, unknown>>("/tax/transactions/create_from_calculation", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_tax_transaction_from_calculation" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_tax_transaction_reversal: async (args) => {
      const params = CreateTaxTransactionReversalSchema.parse(args);
      const body: Record<string, unknown> = {
        original_transaction: params.original_transaction,
        reference: params.reference,
        mode: params.mode,
      };
      if (params.flat_amount !== undefined) body.flat_amount = params.flat_amount;
      if (params.metadata) body.metadata = params.metadata;
      if (params.line_items) {
        params.line_items.forEach((item, i) => {
          body[`line_items[${i}][original_line_item]`] = item.original_line_item;
          body[`line_items[${i}][reference]`] = item.reference;
          if (item.amount !== undefined) body[`line_items[${i}][amount]`] = item.amount;
          if (item.quantity !== undefined) body[`line_items[${i}][quantity]`] = item.quantity;
        });
      }

      const r = await logger.time("tool.create_tax_transaction_reversal", () =>
        client.post<Record<string, unknown>>("/tax/transactions/create_reversal", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_tax_transaction_reversal" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    get_tax_transaction: async (args) => {
      const { transaction_id } = GetTaxTransactionSchema.parse(args);
      const r = await logger.time("tool.get_tax_transaction", () =>
        client.get<Record<string, unknown>>(`/tax/transactions/${transaction_id}`)
      , { tool: "get_tax_transaction" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_tax_registrations: async (args) => {
      const params = ListTaxRegistrationsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.status) q.status = params.status;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_tax_registrations", () =>
        client.list<Record<string, unknown>>("/tax/registrations", q)
      , { tool: "list_tax_registrations" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    create_tax_registration: async (args) => {
      const params = CreateTaxRegistrationSchema.parse(args);
      const body: Record<string, unknown> = { country: params.country };
      if (params.state) body[`country_options[${params.country}][state]`] = params.state;
      if (params.country_options_type) body[`country_options[${params.country}][type]`] = params.country_options_type;
      if (params.active_from !== undefined) body.active_from = params.active_from;
      if (params.expires_at !== undefined) body.expires_at = params.expires_at;

      const r = await logger.time("tool.create_tax_registration", () =>
        client.post<Record<string, unknown>>("/tax/registrations", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_tax_registration" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    update_tax_registration: async (args) => {
      const { registration_id, ...rest } = UpdateTaxRegistrationSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (rest.active_from !== undefined) body.active_from = rest.active_from;
      if (rest.expires_at !== undefined) body.expires_at = rest.expires_at;

      const r = await logger.time("tool.update_tax_registration", () =>
        client.post<Record<string, unknown>>(`/tax/registrations/${registration_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_tax_registration" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    get_tax_settings: async (_args) => {
      const r = await logger.time("tool.get_tax_settings", () =>
        client.get<Record<string, unknown>>("/tax/settings")
      , { tool: "get_tax_settings" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    update_tax_settings: async (args) => {
      const params = UpdateTaxSettingsSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (params.defaults_tax_behavior) body["defaults[tax_behavior]"] = params.defaults_tax_behavior;
      if (params.defaults_tax_code) body["defaults[tax_code]"] = params.defaults_tax_code;
      if (params.head_office_address_country) body["head_office[address][country]"] = params.head_office_address_country;
      if (params.head_office_address_state) body["head_office[address][state]"] = params.head_office_address_state;
      if (params.head_office_address_city) body["head_office[address][city]"] = params.head_office_address_city;
      if (params.head_office_address_line1) body["head_office[address][line1]"] = params.head_office_address_line1;
      if (params.head_office_address_postal_code) body["head_office[address][postal_code]"] = params.head_office_address_postal_code;

      const r = await logger.time("tool.update_tax_settings", () =>
        client.post<Record<string, unknown>>("/tax/settings", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_tax_settings" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
