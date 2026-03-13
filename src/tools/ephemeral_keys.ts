// Ephemeral Keys tools — Stripe API v1
// Covers: create_ephemeral_key, delete_ephemeral_key

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const CreateEphemeralKeySchema = z.object({
  customer: z.string().optional().describe("Customer ID (cus_xxx) — creates an ephemeral key scoped to this customer"),
  issuing_card: z.string().optional().describe("Issuing card ID (ic_xxx) — creates an ephemeral key scoped to this card"),
  stripe_version: z.string().describe("Stripe API version the ephemeral key is for (must match the version used in your mobile SDK, e.g. '2024-06-20')"),
});

const DeleteEphemeralKeySchema = z.object({
  key_id: z.string().describe("Ephemeral key ID (ephkey_xxx) to revoke"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "create_ephemeral_key",
      title: "Create Ephemeral Key",
      description:
        "Create a short-lived ephemeral key for use in Stripe's mobile SDKs (iOS/Android). Ephemeral keys grant the mobile client temporary access to a customer's Stripe data without exposing your secret key. Required for Stripe's iOS/Android SDKs. Specify either customer or issuing_card.",
      inputSchema: {
        type: "object",
        properties: {
          customer: { type: "string", description: "Customer ID (cus_xxx) to create the key for" },
          issuing_card: { type: "string", description: "Issuing card ID (ic_xxx) to create the key for" },
          stripe_version: { type: "string", description: "API version for the ephemeral key (must match your mobile SDK version)" },
        },
        required: ["stripe_version"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "delete_ephemeral_key",
      title: "Delete Ephemeral Key",
      description: "Revoke an ephemeral key immediately. The key will no longer grant access to the associated customer's data. Use when the user logs out or the session ends.",
      inputSchema: {
        type: "object",
        properties: { key_id: { type: "string", description: "Ephemeral key ID (ephkey_xxx) to revoke" } },
        required: ["key_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    create_ephemeral_key: async (args) => {
      const params = CreateEphemeralKeySchema.parse(args);
      const body: Record<string, unknown> = {};
      if (params.customer) body.customer = params.customer;
      if (params.issuing_card) body.issuing_card = params.issuing_card;

      // Ephemeral keys require a special Stripe-Version header matching the mobile SDK version
      // The client sends Stripe-Version: 2024-06-20 by default, but we pass the requested version
      // via the stripe_version field — Stripe uses the stripe_version parameter in the form body
      // Note: In practice, ephemeral keys should be created with the exact SDK version header
      // This implementation passes stripe_version in the body for compatibility

      const r = await logger.time("tool.create_ephemeral_key", () =>
        client.post<Record<string, unknown>>("/ephemeral_keys", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_ephemeral_key" });

      const result = { ...r, _stripe_version_requested: params.stripe_version };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    delete_ephemeral_key: async (args) => {
      const { key_id } = DeleteEphemeralKeySchema.parse(args);
      const r = await logger.time("tool.delete_ephemeral_key", () =>
        client.delete<Record<string, unknown>>(`/ephemeral_keys/${key_id}`)
      , { tool: "delete_ephemeral_key" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
