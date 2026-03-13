// Tokens tools — Stripe API v1
// Covers: create_card_token, create_bank_account_token, create_pii_token, get_token

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const CreateCardTokenSchema = z.object({
  number: z.string().describe("Card number (e.g. '4242424242424242')"),
  exp_month: z.string().describe("Expiry month (1-12, e.g. '12')"),
  exp_year: z.string().describe("Expiry year (e.g. '2026')"),
  cvc: z.string().optional().describe("Card security code (3-4 digits)"),
  name: z.string().optional().describe("Cardholder name"),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().optional(),
  address_zip: z.string().optional(),
  address_country: z.string().optional().describe("Two-letter country code (e.g. 'US')"),
  currency: z.string().optional().describe("Required for debit cards — three-letter currency code"),
});

const CreateBankAccountTokenSchema = z.object({
  country: z.string().describe("Two-letter country code (e.g. 'US')"),
  currency: z.string().describe("Three-letter currency code (e.g. 'usd')"),
  account_holder_name: z.string().optional().describe("Name of the account holder"),
  account_holder_type: z.enum(["individual", "company"]).optional(),
  routing_number: z.string().optional().describe("Routing number (US ABA, UK sort code, etc.)"),
  account_number: z.string().describe("Bank account number"),
});

const CreatePiiTokenSchema = z.object({
  id_number: z.string().describe("PII (Personally Identifiable Information) — e.g. SSN or Tax ID"),
});

const GetTokenSchema = z.object({
  token_id: z.string().describe("Stripe token ID (tok_xxx or btok_xxx)"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "create_card_token",
      title: "Create Card Token",
      description:
        "Create a single-use token representing a credit or debit card. Tokens are used server-side to create charges or attach payment methods without exposing raw card data. NOTE: In production, always use Stripe.js on the frontend to tokenize cards — server-side tokenization is only for testing/specific use cases.",
      inputSchema: {
        type: "object",
        properties: {
          number: { type: "string", description: "Card number (e.g. '4242424242424242' for test)" },
          exp_month: { type: "string", description: "Expiry month (1-12)" },
          exp_year: { type: "string", description: "Expiry year (e.g. '2026')" },
          cvc: { type: "string", description: "Card security code (3-4 digits)" },
          name: { type: "string", description: "Cardholder name" },
          address_line1: { type: "string" },
          address_line2: { type: "string" },
          address_city: { type: "string" },
          address_state: { type: "string" },
          address_zip: { type: "string" },
          address_country: { type: "string", description: "Two-letter country code" },
          currency: { type: "string", description: "Required for debit cards" },
        },
        required: ["number", "exp_month", "exp_year"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_bank_account_token",
      title: "Create Bank Account Token",
      description:
        "Create a single-use token representing a bank account. Used for ACH debit (US), BECS debit (AU), BACS debit (UK), and other bank transfer payment methods. Returns a btok_xxx token that can be attached to a customer.",
      inputSchema: {
        type: "object",
        properties: {
          country: { type: "string", description: "Two-letter country code (e.g. 'US')" },
          currency: { type: "string", description: "Three-letter currency code (e.g. 'usd')" },
          account_holder_name: { type: "string", description: "Account holder name" },
          account_holder_type: { type: "string", enum: ["individual", "company"] },
          routing_number: { type: "string", description: "Routing number" },
          account_number: { type: "string", description: "Bank account number" },
        },
        required: ["country", "currency", "account_number"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_pii_token",
      title: "Create PII Token",
      description:
        "Create a single-use token for Personally Identifiable Information (PII) such as a Social Security Number or Tax ID. The token can be used for identity verification without transmitting raw PII through your servers.",
      inputSchema: {
        type: "object",
        properties: {
          id_number: { type: "string", description: "PII value (e.g. SSN '123-45-6789' or Tax ID)" },
        },
        required: ["id_number"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_token",
      title: "Get Token",
      description:
        "Retrieve a Stripe token by ID (tok_xxx or btok_xxx). Returns the token type (card/bank_account/pii), whether it was used, and the associated resource. Tokens are single-use — used is true after the first charge/attachment.",
      inputSchema: {
        type: "object",
        properties: {
          token_id: { type: "string", description: "Stripe token ID (tok_xxx or btok_xxx)" },
        },
        required: ["token_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    create_card_token: async (args) => {
      const params = CreateCardTokenSchema.parse(args);
      const body: Record<string, unknown> = {
        "card[number]": params.number,
        "card[exp_month]": params.exp_month,
        "card[exp_year]": params.exp_year,
      };
      if (params.cvc) body["card[cvc]"] = params.cvc;
      if (params.name) body["card[name]"] = params.name;
      if (params.address_line1) body["card[address_line1]"] = params.address_line1;
      if (params.address_line2) body["card[address_line2]"] = params.address_line2;
      if (params.address_city) body["card[address_city]"] = params.address_city;
      if (params.address_state) body["card[address_state]"] = params.address_state;
      if (params.address_zip) body["card[address_zip]"] = params.address_zip;
      if (params.address_country) body["card[address_country]"] = params.address_country;
      if (params.currency) body["card[currency]"] = params.currency;

      const token = await logger.time("tool.create_card_token", () =>
        client.post<Record<string, unknown>>("/tokens", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_card_token" });
      return { content: [{ type: "text", text: JSON.stringify(token, null, 2) }], structuredContent: token };
    },

    create_bank_account_token: async (args) => {
      const params = CreateBankAccountTokenSchema.parse(args);
      const body: Record<string, unknown> = {
        "bank_account[country]": params.country,
        "bank_account[currency]": params.currency,
        "bank_account[account_number]": params.account_number,
      };
      if (params.account_holder_name) body["bank_account[account_holder_name]"] = params.account_holder_name;
      if (params.account_holder_type) body["bank_account[account_holder_type]"] = params.account_holder_type;
      if (params.routing_number) body["bank_account[routing_number]"] = params.routing_number;

      const token = await logger.time("tool.create_bank_account_token", () =>
        client.post<Record<string, unknown>>("/tokens", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_bank_account_token" });
      return { content: [{ type: "text", text: JSON.stringify(token, null, 2) }], structuredContent: token };
    },

    create_pii_token: async (args) => {
      const { id_number } = CreatePiiTokenSchema.parse(args);
      const body = { "pii[id_number]": id_number };

      const token = await logger.time("tool.create_pii_token", () =>
        client.post<Record<string, unknown>>("/tokens", body)
      , { tool: "create_pii_token" });
      return { content: [{ type: "text", text: JSON.stringify(token, null, 2) }], structuredContent: token };
    },

    get_token: async (args) => {
      const { token_id } = GetTokenSchema.parse(args);
      const token = await logger.time("tool.get_token", () =>
        client.get<Record<string, unknown>>(`/tokens/${token_id}`)
      , { tool: "get_token", token_id });
      return { content: [{ type: "text", text: JSON.stringify(token, null, 2) }], structuredContent: token };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
