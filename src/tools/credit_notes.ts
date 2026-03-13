// Credit Notes tools — Stripe API v1
// Covers: list_credit_notes, get_credit_note, create_credit_note, void_credit_note

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListCreditNotesSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  invoice: z.string().optional().describe("Filter by invoice ID (in_xxx)"),
  customer: z.string().optional().describe("Filter by customer ID (cus_xxx)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — for reversed pagination"),
});

const GetCreditNoteSchema = z.object({
  credit_note_id: z.string().describe("Stripe credit note ID (cn_xxx)"),
});

const CreditNoteLineItemSchema = z.object({
  type: z.enum(["invoice_line_item", "custom_line_item"]).describe("Type: invoice_line_item (reference original invoice line) or custom_line_item (freeform)"),
  invoice_line_item: z.string().optional().describe("Invoice line item ID to credit (required when type=invoice_line_item)"),
  quantity: z.number().int().positive().optional().describe("Quantity to credit from the line item"),
  amount: z.number().int().positive().optional().describe("Custom amount in smallest currency unit (required for custom_line_item)"),
  description: z.string().optional().describe("Description for custom line items"),
  unit_amount: z.number().int().positive().optional().describe("Unit amount for custom line items"),
  tax_rates: z.array(z.string()).optional().describe("Tax rate IDs (txr_xxx) to apply to this line item"),
});

const CreateCreditNoteSchema = z.object({
  invoice: z.string().describe("Invoice ID (in_xxx) to issue the credit note against — required. Invoice must be in 'open' or 'paid' status."),
  lines: z.array(CreditNoteLineItemSchema).optional().describe("Line items to credit. Omit to credit the full invoice amount."),
  memo: z.string().optional().describe("Memo/reason shown to the customer on the credit note"),
  reason: z.enum(["duplicate", "fraudulent", "order_change", "product_unsatisfactory"]).optional().describe("Reason for issuing the credit note"),
  amount: z.number().int().positive().optional().describe("Total credit amount in smallest currency unit — alternative to specifying lines"),
  credit_amount: z.number().int().min(0).optional().describe("Amount to credit to the customer balance (remainder of amount goes to refund)"),
  refund_amount: z.number().int().min(0).optional().describe("Amount to refund to the original payment method"),
  out_of_band_amount: z.number().int().min(0).optional().describe("Amount credited outside of Stripe"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
});

const VoidCreditNoteSchema = z.object({
  credit_note_id: z.string().describe("Stripe credit note ID (cn_xxx) to void — only 'issued' credit notes can be voided"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_credit_notes",
      title: "List Credit Notes",
      description:
        "List Stripe credit notes — documents issued to reduce the amount owed on an invoice. Filter by invoice or customer. Credit notes appear on the customer's billing history and can trigger refunds or customer balance credits. Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          invoice: { type: "string", description: "Filter by invoice ID (in_xxx)" },
          customer: { type: "string", description: "Filter by customer ID (cus_xxx)" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_credit_note",
      title: "Get Credit Note",
      description:
        "Get full details for a Stripe credit note by ID (cn_xxx). Returns amount, invoice, status (issued/void), customer, memo, reason, and line items with their tax rates.",
      inputSchema: {
        type: "object",
        properties: {
          credit_note_id: { type: "string", description: "Stripe credit note ID (cn_xxx)" },
        },
        required: ["credit_note_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_credit_note",
      title: "Create Credit Note",
      description:
        "Create a Stripe credit note to reduce the amount owed on an invoice. Specify lines to credit individual line items, or provide amount for a bulk credit. Use credit_amount to credit the customer's balance and refund_amount to refund to their payment method. The invoice must be open or paid.",
      inputSchema: {
        type: "object",
        properties: {
          invoice: { type: "string", description: "Invoice ID (in_xxx) to credit — required" },
          lines: {
            type: "array",
            description: "Line items to credit (type, invoice_line_item, quantity, amount). Omit for full invoice credit.",
            items: { type: "object" },
          },
          memo: { type: "string", description: "Memo/reason shown to customer" },
          reason: { type: "string", enum: ["duplicate", "fraudulent", "order_change", "product_unsatisfactory"], description: "Credit reason" },
          amount: { type: "number", description: "Total credit amount in smallest currency unit" },
          credit_amount: { type: "number", description: "Amount to add to customer balance" },
          refund_amount: { type: "number", description: "Amount to refund to payment method" },
          out_of_band_amount: { type: "number", description: "Amount credited outside Stripe" },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["invoice"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "void_credit_note",
      title: "Void Credit Note",
      description:
        "Void a Stripe credit note — marks it as void and reverses its effect on the invoice balance. Only issued credit notes can be voided. Note: this does NOT reverse any associated refunds that may have been issued.",
      inputSchema: {
        type: "object",
        properties: {
          credit_note_id: { type: "string", description: "Stripe credit note ID (cn_xxx) to void" },
        },
        required: ["credit_note_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_credit_notes: async (args) => {
      const params = ListCreditNotesSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.invoice) queryParams.invoice = params.invoice;
      if (params.customer) queryParams.customer = params.customer;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;

      const result = await logger.time("tool.list_credit_notes", () =>
        client.list<Record<string, unknown>>("/credit_notes", queryParams)
      , { tool: "list_credit_notes" });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_credit_note: async (args) => {
      const { credit_note_id } = GetCreditNoteSchema.parse(args);
      const creditNote = await logger.time("tool.get_credit_note", () =>
        client.get<Record<string, unknown>>(`/credit_notes/${credit_note_id}`)
      , { tool: "get_credit_note", credit_note_id });
      return { content: [{ type: "text", text: JSON.stringify(creditNote, null, 2) }], structuredContent: creditNote };
    },

    create_credit_note: async (args) => {
      const params = CreateCreditNoteSchema.parse(args);
      const body: Record<string, unknown> = { invoice: params.invoice };

      if (params.memo) body.memo = params.memo;
      if (params.reason) body.reason = params.reason;
      if (params.amount !== undefined) body.amount = params.amount;
      if (params.credit_amount !== undefined) body.credit_amount = params.credit_amount;
      if (params.refund_amount !== undefined) body.refund_amount = params.refund_amount;
      if (params.out_of_band_amount !== undefined) body.out_of_band_amount = params.out_of_band_amount;
      if (params.metadata) body.metadata = params.metadata;

      if (params.lines) {
        params.lines.forEach((line, i) => {
          body[`lines[${i}][type]`] = line.type;
          if (line.invoice_line_item) body[`lines[${i}][invoice_line_item]`] = line.invoice_line_item;
          if (line.quantity !== undefined) body[`lines[${i}][quantity]`] = line.quantity;
          if (line.amount !== undefined) body[`lines[${i}][amount]`] = line.amount;
          if (line.description) body[`lines[${i}][description]`] = line.description;
          if (line.unit_amount !== undefined) body[`lines[${i}][unit_amount]`] = line.unit_amount;
          if (line.tax_rates) {
            line.tax_rates.forEach((tr, ti) => {
              body[`lines[${i}][tax_rates][${ti}]`] = tr;
            });
          }
        });
      }

      const creditNote = await logger.time("tool.create_credit_note", () =>
        client.post<Record<string, unknown>>("/credit_notes", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_credit_note" });
      return { content: [{ type: "text", text: JSON.stringify(creditNote, null, 2) }], structuredContent: creditNote };
    },

    void_credit_note: async (args) => {
      const { credit_note_id } = VoidCreditNoteSchema.parse(args);
      const creditNote = await logger.time("tool.void_credit_note", () =>
        client.post<Record<string, unknown>>(`/credit_notes/${credit_note_id}/void`, {})
      , { tool: "void_credit_note", credit_note_id });
      return { content: [{ type: "text", text: JSON.stringify(creditNote, null, 2) }], structuredContent: creditNote };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
