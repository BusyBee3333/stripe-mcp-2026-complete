// Terminal tools — Stripe API v1
// Covers: Locations (list, get, create, update, delete), Readers (list, get, create, delete, process_payment),
//         Connection Tokens (create)

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// --- Location schemas ---
const ListLocationsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetLocationSchema = z.object({
  location_id: z.string().describe("Terminal location ID (tml_xxx)"),
});

const CreateLocationSchema = z.object({
  display_name: z.string().describe("Human-readable name for this location (e.g. 'Main Street Store')"),
  address_line1: z.string().describe("Address line 1"),
  address_city: z.string().describe("City"),
  address_state: z.string().optional(),
  address_postal_code: z.string().describe("Postal/zip code"),
  address_country: z.string().describe("Two-letter country code (e.g. 'US')"),
  metadata: z.record(z.string()).optional(),
});

const UpdateLocationSchema = z.object({
  location_id: z.string(),
  display_name: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

const DeleteLocationSchema = z.object({
  location_id: z.string().describe("Terminal location ID (tml_xxx) to delete"),
});

// --- Reader schemas ---
const ListReadersSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  location: z.string().optional().describe("Filter by location ID (tml_xxx)"),
  status: z.enum(["online", "offline"]).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetReaderSchema = z.object({
  reader_id: z.string().describe("Terminal reader ID (tmr_xxx)"),
});

const CreateReaderSchema = z.object({
  registration_code: z.string().describe("The registration code printed on the back of the reader device"),
  label: z.string().optional().describe("Human-readable label for this reader (e.g. 'Register 1')"),
  location: z.string().optional().describe("Location ID (tml_xxx) to assign this reader to"),
  metadata: z.record(z.string()).optional(),
});

const DeleteReaderSchema = z.object({
  reader_id: z.string().describe("Terminal reader ID (tmr_xxx) to delete"),
});

const ProcessPaymentIntentSchema = z.object({
  reader_id: z.string().describe("Terminal reader ID (tmr_xxx)"),
  payment_intent: z.string().describe("Payment intent ID (pi_xxx) to process on this reader"),
  skip_tipping: z.boolean().optional().describe("Whether to skip the tipping screen"),
  tip_amount: z.number().optional().describe("Pre-set tip amount in smallest currency unit"),
  collect_config_enable_customer_cancellation: z.boolean().optional(),
});

const SetReaderDisplaySchema = z.object({
  reader_id: z.string().describe("Terminal reader ID (tmr_xxx)"),
  type: z.enum(["cart"]).describe("Display type — currently only 'cart' is supported"),
  cart_currency: z.string().length(3).optional(),
  cart_tax: z.number().optional(),
  cart_total: z.number().optional(),
  cart_line_items: z.array(z.object({
    description: z.string().describe("Item description"),
    amount: z.number().describe("Item amount in smallest currency unit"),
    quantity: z.number().optional(),
  })).optional(),
});

const CancelReaderActionSchema = z.object({
  reader_id: z.string().describe("Terminal reader ID (tmr_xxx)"),
});

// --- Connection token schema ---
const CreateConnectionTokenSchema = z.object({
  location: z.string().optional().describe("Location ID (tml_xxx) to scope this token to a specific location (optional)"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_terminal_locations",
      title: "List Terminal Locations",
      description: "List Stripe Terminal locations. Locations represent physical stores or venues where Terminal readers are deployed. Returns location ID, display_name, and address.",
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
      name: "get_terminal_location",
      title: "Get Terminal Location",
      description: "Retrieve a specific Terminal location by ID (tml_xxx). Returns display_name, address, and metadata.",
      inputSchema: {
        type: "object",
        properties: { location_id: { type: "string", description: "Terminal location ID (tml_xxx)" } },
        required: ["location_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_terminal_location",
      title: "Create Terminal Location",
      description: "Create a new Terminal location. Locations are required before registering readers. Each location represents a physical store or point-of-sale.",
      inputSchema: {
        type: "object",
        properties: {
          display_name: { type: "string", description: "Human-readable name (e.g. 'Main Street Store')" },
          address_line1: { type: "string" },
          address_city: { type: "string" },
          address_state: { type: "string" },
          address_postal_code: { type: "string" },
          address_country: { type: "string", description: "Two-letter country code" },
          metadata: { type: "object" },
        },
        required: ["display_name", "address_line1", "address_city", "address_postal_code", "address_country"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_terminal_location",
      title: "Update Terminal Location",
      description: "Update a Terminal location's display name or metadata.",
      inputSchema: {
        type: "object",
        properties: {
          location_id: { type: "string" },
          display_name: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["location_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "delete_terminal_location",
      title: "Delete Terminal Location",
      description: "Delete a Terminal location. This removes the location and unassigns all readers. Use with caution.",
      inputSchema: {
        type: "object",
        properties: { location_id: { type: "string", description: "Terminal location ID (tml_xxx)" } },
        required: ["location_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "list_terminal_readers",
      title: "List Terminal Readers",
      description: "List Stripe Terminal readers. Returns reader ID, label, location, status (online/offline), device_type, and serial_number. Optionally filter by location or online status.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
          location: { type: "string", description: "Filter by location ID (tml_xxx)" },
          status: { type: "string", enum: ["online", "offline"] },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_terminal_reader",
      title: "Get Terminal Reader",
      description: "Retrieve a specific Terminal reader by ID (tmr_xxx). Returns label, location, device_type, status, and current action.",
      inputSchema: {
        type: "object",
        properties: { reader_id: { type: "string", description: "Terminal reader ID (tmr_xxx)" } },
        required: ["reader_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_terminal_reader",
      title: "Create Terminal Reader",
      description: "Register a new Terminal reader using the registration code from the device. Optionally assign to a location and set a label.",
      inputSchema: {
        type: "object",
        properties: {
          registration_code: { type: "string", description: "Registration code from the reader device" },
          label: { type: "string", description: "Human-readable label (e.g. 'Register 1')" },
          location: { type: "string", description: "Location ID (tml_xxx) to assign this reader to" },
          metadata: { type: "object" },
        },
        required: ["registration_code"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "delete_terminal_reader",
      title: "Delete Terminal Reader",
      description: "Delete a Terminal reader. The physical device will no longer be associated with your account.",
      inputSchema: {
        type: "object",
        properties: { reader_id: { type: "string", description: "Terminal reader ID (tmr_xxx)" } },
        required: ["reader_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "process_terminal_payment",
      title: "Process Payment on Terminal Reader",
      description: "Initiate a payment on a Terminal reader. The reader will display the payment UI and collect card details. Requires a PaymentIntent in status 'requires_payment_method'.",
      inputSchema: {
        type: "object",
        properties: {
          reader_id: { type: "string", description: "Terminal reader ID (tmr_xxx)" },
          payment_intent: { type: "string", description: "PaymentIntent ID (pi_xxx) to collect payment for" },
          skip_tipping: { type: "boolean", description: "Skip the tipping screen" },
          tip_amount: { type: "number", description: "Pre-set tip amount in smallest currency unit" },
        },
        required: ["reader_id", "payment_intent"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "set_terminal_reader_display",
      title: "Set Terminal Reader Display",
      description: "Set the display on a Terminal reader to show a cart (line items, totals). Use to display order details to the customer before they pay.",
      inputSchema: {
        type: "object",
        properties: {
          reader_id: { type: "string", description: "Terminal reader ID (tmr_xxx)" },
          type: { type: "string", enum: ["cart"] },
          cart_currency: { type: "string", description: "Three-letter currency code" },
          cart_tax: { type: "number", description: "Tax amount in smallest currency unit" },
          cart_total: { type: "number", description: "Total amount in smallest currency unit" },
          cart_line_items: { type: "array", description: "Line items (array of {description, amount, quantity})" },
        },
        required: ["reader_id", "type"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "cancel_terminal_reader_action",
      title: "Cancel Terminal Reader Action",
      description: "Cancel the current action on a Terminal reader. Cancels an in-progress collect_payment_method or set_reader_display action.",
      inputSchema: {
        type: "object",
        properties: { reader_id: { type: "string", description: "Terminal reader ID (tmr_xxx)" } },
        required: ["reader_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_terminal_connection_token",
      title: "Create Terminal Connection Token",
      description: "Create a Terminal connection token for use in the Stripe Terminal SDK. The secret is passed to Stripe Terminal SDKs to establish a secure connection to the Stripe servers. Optionally scope to a specific location.",
      inputSchema: {
        type: "object",
        properties: {
          location: { type: "string", description: "Location ID (tml_xxx) to scope the token to (optional)" },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  const listHelper = async (toolName: string, url: string, q: Record<string, string | number | boolean | undefined | null>) => {
    const result = await logger.time(`tool.${toolName}`, () =>
      client.list<Record<string, unknown>>(url, q)
    , { tool: toolName });
    const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
    const response = {
      data: result.data,
      meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }], structuredContent: response };
  };

  return {
    list_terminal_locations: async (args) => {
      const params = ListLocationsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      return listHelper("list_terminal_locations", "/terminal/locations", q);
    },

    get_terminal_location: async (args) => {
      const { location_id } = GetLocationSchema.parse(args);
      const r = await logger.time("tool.get_terminal_location", () =>
        client.get<Record<string, unknown>>(`/terminal/locations/${location_id}`)
      , { tool: "get_terminal_location" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_terminal_location: async (args) => {
      const params = CreateLocationSchema.parse(args);
      const body: Record<string, unknown> = {
        display_name: params.display_name,
        "address[line1]": params.address_line1,
        "address[city]": params.address_city,
        "address[postal_code]": params.address_postal_code,
        "address[country]": params.address_country,
      };
      if (params.address_state) body["address[state]"] = params.address_state;
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.create_terminal_location", () =>
        client.post<Record<string, unknown>>("/terminal/locations", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_terminal_location" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    update_terminal_location: async (args) => {
      const { location_id, ...rest } = UpdateLocationSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (rest.display_name) body.display_name = rest.display_name;
      if (rest.metadata) body.metadata = rest.metadata;

      const r = await logger.time("tool.update_terminal_location", () =>
        client.post<Record<string, unknown>>(`/terminal/locations/${location_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_terminal_location" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    delete_terminal_location: async (args) => {
      const { location_id } = DeleteLocationSchema.parse(args);
      const r = await logger.time("tool.delete_terminal_location", () =>
        client.delete<Record<string, unknown>>(`/terminal/locations/${location_id}`)
      , { tool: "delete_terminal_location" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_terminal_readers: async (args) => {
      const params = ListReadersSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.location) q.location = params.location;
      if (params.status) q.status = params.status;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      return listHelper("list_terminal_readers", "/terminal/readers", q);
    },

    get_terminal_reader: async (args) => {
      const { reader_id } = GetReaderSchema.parse(args);
      const r = await logger.time("tool.get_terminal_reader", () =>
        client.get<Record<string, unknown>>(`/terminal/readers/${reader_id}`)
      , { tool: "get_terminal_reader" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_terminal_reader: async (args) => {
      const params = CreateReaderSchema.parse(args);
      const body: Record<string, unknown> = { registration_code: params.registration_code };
      if (params.label) body.label = params.label;
      if (params.location) body.location = params.location;
      if (params.metadata) body.metadata = params.metadata;

      const r = await logger.time("tool.create_terminal_reader", () =>
        client.post<Record<string, unknown>>("/terminal/readers", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_terminal_reader" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    delete_terminal_reader: async (args) => {
      const { reader_id } = DeleteReaderSchema.parse(args);
      const r = await logger.time("tool.delete_terminal_reader", () =>
        client.delete<Record<string, unknown>>(`/terminal/readers/${reader_id}`)
      , { tool: "delete_terminal_reader" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    process_terminal_payment: async (args) => {
      const params = ProcessPaymentIntentSchema.parse(args);
      const body: Record<string, unknown> = {
        "process_payment_intent[payment_intent]": params.payment_intent,
      };
      if (params.skip_tipping !== undefined) body["process_payment_intent[skip_tipping]"] = params.skip_tipping;
      if (params.tip_amount !== undefined) body["process_payment_intent[tipping][amount_eligible]"] = params.tip_amount;

      const r = await logger.time("tool.process_terminal_payment", () =>
        client.post<Record<string, unknown>>(`/terminal/readers/${params.reader_id}/process_payment_intent`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "process_terminal_payment" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    set_terminal_reader_display: async (args) => {
      const params = SetReaderDisplaySchema.parse(args);
      const body: Record<string, unknown> = { type: params.type };
      if (params.cart_currency) body["cart[currency]"] = params.cart_currency;
      if (params.cart_tax !== undefined) body["cart[tax]"] = params.cart_tax;
      if (params.cart_total !== undefined) body["cart[total]"] = params.cart_total;
      if (params.cart_line_items) {
        params.cart_line_items.forEach((item, i) => {
          body[`cart[line_items][${i}][description]`] = item.description;
          body[`cart[line_items][${i}][amount]`] = item.amount;
          if (item.quantity !== undefined) body[`cart[line_items][${i}][quantity]`] = item.quantity;
        });
      }

      const r = await logger.time("tool.set_terminal_reader_display", () =>
        client.post<Record<string, unknown>>(`/terminal/readers/${params.reader_id}/set_reader_display`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "set_terminal_reader_display" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    cancel_terminal_reader_action: async (args) => {
      const { reader_id } = CancelReaderActionSchema.parse(args);
      const r = await logger.time("tool.cancel_terminal_reader_action", () =>
        client.post<Record<string, unknown>>(`/terminal/readers/${reader_id}/cancel_action`, {})
      , { tool: "cancel_terminal_reader_action" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_terminal_connection_token: async (args) => {
      const params = CreateConnectionTokenSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (params.location) body.location = params.location;

      const r = await logger.time("tool.create_terminal_connection_token", () =>
        client.post<Record<string, unknown>>("/terminal/connection_tokens", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_terminal_connection_token" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
