// Webhooks tools — Stripe API v1
// Covers: list_webhook_endpoints, create_webhook_endpoint, delete_webhook_endpoint, get_webhook_endpoint

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler, StripeWebhookEndpoint } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const ListWebhookEndpointsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — last ID from previous page"),
});

const CreateWebhookEndpointSchema = z.object({
  url: z.string().url().describe("The URL Stripe will send events to (must be HTTPS in live mode)"),
  enabled_events: z.array(z.string()).describe("List of event types to listen for (e.g., ['charge.succeeded', 'customer.created']) — use ['*'] for all events"),
  description: z.string().optional().describe("Optional description of this webhook"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
  api_version: z.string().optional().describe("Stripe API version for the webhook (defaults to your account's default)"),
});

const DeleteWebhookEndpointSchema = z.object({
  webhook_id: z.string().describe("Webhook endpoint ID (we_xxx) to delete"),
});

const GetWebhookEndpointSchema = z.object({
  webhook_id: z.string().describe("Webhook endpoint ID (we_xxx)"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_webhook_endpoints",
      title: "List Webhook Endpoints",
      description:
        "List all Stripe webhook endpoints. Returns endpoint ID, URL, enabled events, and status. Uses keyset pagination — pass meta.lastId as starting_after for the next page.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
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
      name: "create_webhook_endpoint",
      title: "Create Webhook Endpoint",
      description:
        "Create a Stripe webhook endpoint to receive events. Provide the HTTPS URL and an array of event types to listen for (e.g., ['charge.succeeded', 'invoice.payment_failed']). Use ['*'] to receive all events. Returns the endpoint with its secret key for signature verification.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "HTTPS URL to receive webhook events" },
          enabled_events: {
            type: "array",
            description: "Event types to listen for (e.g., ['charge.succeeded']) — use ['*'] for all",
            items: { type: "string" },
          },
          description: { type: "string", description: "Optional description" },
          metadata: { type: "object", description: "Key-value metadata" },
          api_version: { type: "string", description: "Stripe API version for events" },
        },
        required: ["url", "enabled_events"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string" },
          secret: { type: "string" },
          status: { type: "string" },
          enabled_events: { type: "array" },
        },
        required: ["id", "url"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    {
      name: "delete_webhook_endpoint",
      title: "Delete Webhook Endpoint",
      description:
        "Permanently delete a Stripe webhook endpoint. Stripe will stop sending events to the URL immediately. This action is irreversible.",
      inputSchema: {
        type: "object",
        properties: {
          webhook_id: { type: "string", description: "Webhook endpoint ID (we_xxx) to delete" },
        },
        required: ["webhook_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          deleted: { type: "boolean" },
        },
        required: ["id", "deleted"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "get_webhook_endpoint",
      title: "Get Webhook Endpoint",
      description:
        "Get full details for a Stripe webhook endpoint by ID (we_xxx). Returns URL, enabled events, status, and creation date. Note: the webhook secret is only returned at creation time.",
      inputSchema: {
        type: "object",
        properties: {
          webhook_id: { type: "string", description: "Webhook endpoint ID (we_xxx)" },
        },
        required: ["webhook_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string" },
          status: { type: "string" },
          enabled_events: { type: "array" },
          created: { type: "number" },
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
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_webhook_endpoints: async (args) => {
      const params = ListWebhookEndpointsSchema.parse(args);

      const queryParams: Record<string, string | number | boolean | undefined | null> = {
        limit: params.limit,
      };
      if (params.starting_after) queryParams.starting_after = params.starting_after;

      const result = await logger.time("tool.list_webhook_endpoints", () =>
        client.list<StripeWebhookEndpoint>("/webhook_endpoints", queryParams)
      , { tool: "list_webhook_endpoints" });

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

    create_webhook_endpoint: async (args) => {
      const params = CreateWebhookEndpointSchema.parse(args);

      const body: Record<string, string | number | boolean | undefined | null> = {
        url: params.url,
      };

      // enabled_events as form-encoded array
      params.enabled_events.forEach((event, i) => {
        body[`enabled_events[${i}]`] = event;
      });

      if (params.description) body.description = params.description;
      if (params.api_version) body.api_version = params.api_version;
      if (params.metadata) {
        for (const [k, v] of Object.entries(params.metadata)) {
          body[`metadata[${k}]`] = v;
        }
      }

      const webhook = await logger.time("tool.create_webhook_endpoint", () =>
        client.post<StripeWebhookEndpoint>("/webhook_endpoints", body)
      , { tool: "create_webhook_endpoint" });

      return {
        content: [{ type: "text", text: JSON.stringify(webhook, null, 2) }],
        structuredContent: webhook,
      };
    },

    delete_webhook_endpoint: async (args) => {
      const { webhook_id } = DeleteWebhookEndpointSchema.parse(args);

      const result = await logger.time("tool.delete_webhook_endpoint", () =>
        client.delete<{ id: string; deleted: boolean }>(`/webhook_endpoints/${webhook_id}`)
      , { tool: "delete_webhook_endpoint", webhook_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_webhook_endpoint: async (args) => {
      const { webhook_id } = GetWebhookEndpointSchema.parse(args);

      const webhook = await logger.time("tool.get_webhook_endpoint", () =>
        client.get<StripeWebhookEndpoint>(`/webhook_endpoints/${webhook_id}`)
      , { tool: "get_webhook_endpoint", webhook_id });

      return {
        content: [{ type: "text", text: JSON.stringify(webhook, null, 2) }],
        structuredContent: webhook,
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
