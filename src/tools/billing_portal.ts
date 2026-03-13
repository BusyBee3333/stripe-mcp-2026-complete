// Billing Portal tools — Stripe API v1
// Covers: create_billing_portal_session, create_billing_portal_configuration, list_billing_portal_configurations

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// === Zod Schemas ===
const CreateBillingPortalSessionSchema = z.object({
  customer: z.string().describe("Customer ID (cus_xxx) — required. The customer who will access the portal."),
  return_url: z.string().url().describe("URL to redirect the customer when they click 'Return to ...' in the portal"),
  configuration: z.string().optional().describe("Billing portal configuration ID (bpc_xxx) to use — uses account default if omitted"),
  flow_data: z.object({
    type: z.enum(["payment_method_update", "subscription_cancel", "subscription_update", "subscription_update_confirm"]).describe("Type of portal flow to start"),
    subscription_cancel: z.object({ subscription: z.string() }).optional().describe("Subscription to cancel (for subscription_cancel flow)"),
    subscription_update: z.object({ subscription: z.string() }).optional().describe("Subscription to update (for subscription_update flow)"),
  }).optional().describe("Pre-fill a specific portal flow to land customers directly on a specific action"),
  locale: z.string().optional().describe("Locale for the portal UI (e.g. 'en', 'fr', 'de', 'auto')"),
});

const CreateBillingPortalConfigurationSchema = z.object({
  business_profile: z.object({
    headline: z.string().optional().describe("Headline shown in the portal (e.g. 'Manage your subscription')"),
    privacy_policy_url: z.string().url().optional().describe("URL to your privacy policy"),
    terms_of_service_url: z.string().url().optional().describe("URL to your terms of service"),
  }).describe("Business profile shown in the portal"),
  features: z.object({
    customer_update: z.object({
      enabled: z.boolean().describe("Allow customers to update their billing details"),
      allowed_updates: z.array(z.enum(["email", "address", "shipping", "phone", "tax_id"])).optional().describe("Which fields customers can update"),
    }).optional().describe("Customer update feature"),
    invoice_history: z.object({
      enabled: z.boolean().describe("Show invoice history to customers"),
    }).optional().describe("Invoice history feature"),
    payment_method_update: z.object({
      enabled: z.boolean().describe("Allow customers to update their payment method"),
    }).optional().describe("Payment method update feature"),
    subscription_cancel: z.object({
      enabled: z.boolean().describe("Allow customers to cancel subscriptions"),
      mode: z.enum(["immediately", "at_period_end"]).optional().describe("When to cancel: immediately or at period end"),
    }).optional().describe("Subscription cancel feature"),
    subscription_pause: z.object({
      enabled: z.boolean().describe("Allow customers to pause subscriptions"),
    }).optional().describe("Subscription pause feature"),
    subscription_update: z.object({
      enabled: z.boolean().describe("Allow customers to update/upgrade their subscription"),
      default_allowed_updates: z.array(z.enum(["price", "quantity", "promotion_code"])).optional().describe("What subscription changes are allowed"),
      proration_behavior: z.enum(["create_prorations", "none", "always_invoice"]).optional().describe("Proration behavior when customer changes plan"),
      products: z.array(z.object({
        product: z.string().describe("Product ID (prod_xxx)"),
        prices: z.array(z.string()).describe("Allowed price IDs (price_xxx) for this product"),
      })).optional().describe("Which products/prices customers can switch to"),
    }).optional().describe("Subscription update feature"),
  }).describe("Features enabled in this portal configuration"),
  default_return_url: z.string().url().optional().describe("Default return URL when no session-level return_url is provided"),
  metadata: z.record(z.string()).optional().describe("Key-value metadata"),
});

const ListBillingPortalConfigurationsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20).describe("Number of results (1-100, default 20)"),
  active: z.boolean().optional().describe("Filter by active status"),
  is_default: z.boolean().optional().describe("Filter for the default configuration only"),
  starting_after: z.string().optional().describe("Keyset pagination cursor — ID of last item from previous page"),
  ending_before: z.string().optional().describe("Keyset pagination cursor — for reversed pagination"),
});

// === Tool Definitions ===
function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "create_billing_portal_session",
      title: "Create Billing Portal Session",
      description:
        "Create a Stripe Customer Portal session for a customer to self-manage their subscription, payment methods, and invoices. Returns a one-time session URL — redirect the customer to this URL. Sessions expire after ~5 minutes.",
      inputSchema: {
        type: "object",
        properties: {
          customer: { type: "string", description: "Customer ID (cus_xxx) — required" },
          return_url: { type: "string", description: "URL to redirect customer after portal visit" },
          configuration: { type: "string", description: "Portal configuration ID (bpc_xxx) — optional, uses default" },
          flow_data: {
            type: "object",
            description: "Pre-fill a specific flow (payment_method_update, subscription_cancel, etc.)",
          },
          locale: { type: "string", description: "Portal locale (e.g. 'en', 'fr', 'auto')" },
        },
        required: ["customer", "return_url"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_billing_portal_configuration",
      title: "Create Billing Portal Configuration",
      description:
        "Create a Stripe Customer Portal configuration defining which features are available to customers (update payment methods, cancel subscriptions, view invoices, upgrade/downgrade plans). You can have multiple configurations for different customer segments.",
      inputSchema: {
        type: "object",
        properties: {
          business_profile: {
            type: "object",
            description: "Business branding shown in portal (headline, privacy_policy_url, terms_of_service_url)",
          },
          features: {
            type: "object",
            description: "Enabled portal features: invoice_history, payment_method_update, subscription_cancel, subscription_update, customer_update",
          },
          default_return_url: { type: "string", description: "Default return URL for the portal" },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["business_profile", "features"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "list_billing_portal_configurations",
      title: "List Billing Portal Configurations",
      description:
        "List Stripe Customer Portal configurations. Returns all portal configurations with their enabled features and business profile settings. Filter by active status or default configuration.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          active: { type: "boolean", description: "Filter by active status" },
          is_default: { type: "boolean", description: "Filter for default configuration only" },
          starting_after: { type: "string", description: "Pagination cursor — last ID from previous page" },
          ending_before: { type: "string", description: "Pagination cursor — for reversed pagination" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

// === Tool Handlers ===
function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    create_billing_portal_session: async (args) => {
      const params = CreateBillingPortalSessionSchema.parse(args);
      const body: Record<string, unknown> = {
        customer: params.customer,
        return_url: params.return_url,
      };
      if (params.configuration) body.configuration = params.configuration;
      if (params.locale) body.locale = params.locale;
      if (params.flow_data) {
        body["flow_data[type]"] = params.flow_data.type;
        if (params.flow_data.subscription_cancel?.subscription) {
          body["flow_data[subscription_cancel][subscription]"] = params.flow_data.subscription_cancel.subscription;
        }
        if (params.flow_data.subscription_update?.subscription) {
          body["flow_data[subscription_update][subscription]"] = params.flow_data.subscription_update.subscription;
        }
      }

      const session = await logger.time("tool.create_billing_portal_session", () =>
        client.post<Record<string, unknown>>("/billing_portal/sessions", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_billing_portal_session" });
      return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }], structuredContent: session };
    },

    create_billing_portal_configuration: async (args) => {
      const params = CreateBillingPortalConfigurationSchema.parse(args);
      const body: Record<string, unknown> = {};

      // Business profile
      if (params.business_profile.headline) body["business_profile[headline]"] = params.business_profile.headline;
      if (params.business_profile.privacy_policy_url) body["business_profile[privacy_policy_url]"] = params.business_profile.privacy_policy_url;
      if (params.business_profile.terms_of_service_url) body["business_profile[terms_of_service_url]"] = params.business_profile.terms_of_service_url;

      // Features
      const f = params.features;
      if (f.invoice_history) {
        body["features[invoice_history][enabled]"] = f.invoice_history.enabled;
      }
      if (f.payment_method_update) {
        body["features[payment_method_update][enabled]"] = f.payment_method_update.enabled;
      }
      if (f.subscription_pause) {
        body["features[subscription_pause][enabled]"] = f.subscription_pause.enabled;
      }
      if (f.customer_update) {
        body["features[customer_update][enabled]"] = f.customer_update.enabled;
        if (f.customer_update.allowed_updates) {
          f.customer_update.allowed_updates.forEach((u, i) => {
            body[`features[customer_update][allowed_updates][${i}]`] = u;
          });
        }
      }
      if (f.subscription_cancel) {
        body["features[subscription_cancel][enabled]"] = f.subscription_cancel.enabled;
        if (f.subscription_cancel.mode) body["features[subscription_cancel][mode]"] = f.subscription_cancel.mode;
      }
      if (f.subscription_update) {
        body["features[subscription_update][enabled]"] = f.subscription_update.enabled;
        if (f.subscription_update.proration_behavior) body["features[subscription_update][proration_behavior]"] = f.subscription_update.proration_behavior;
        if (f.subscription_update.default_allowed_updates) {
          f.subscription_update.default_allowed_updates.forEach((u, i) => {
            body[`features[subscription_update][default_allowed_updates][${i}]`] = u;
          });
        }
        if (f.subscription_update.products) {
          f.subscription_update.products.forEach((prod, pi) => {
            body[`features[subscription_update][products][${pi}][product]`] = prod.product;
            prod.prices.forEach((price, pri) => {
              body[`features[subscription_update][products][${pi}][prices][${pri}]`] = price;
            });
          });
        }
      }

      if (params.default_return_url) body.default_return_url = params.default_return_url;
      if (params.metadata) body.metadata = params.metadata;

      const config = await logger.time("tool.create_billing_portal_configuration", () =>
        client.post<Record<string, unknown>>("/billing_portal/configurations", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_billing_portal_configuration" });
      return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }], structuredContent: config };
    },

    list_billing_portal_configurations: async (args) => {
      const params = ListBillingPortalConfigurationsSchema.parse(args);
      const queryParams: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.active !== undefined) queryParams.active = params.active;
      if (params.is_default !== undefined) queryParams.is_default = params.is_default;
      if (params.starting_after) queryParams.starting_after = params.starting_after;
      if (params.ending_before) queryParams.ending_before = params.ending_before;

      const result = await logger.time("tool.list_billing_portal_configurations", () =>
        client.list<Record<string, unknown>>("/billing_portal/configurations", queryParams)
      , { tool: "list_billing_portal_configurations" });

      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
