// Health check tool — validates Stripe API key and account info

import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "health_check",
      title: "Health Check",
      description:
        "Validate Stripe MCP server health: checks STRIPE_SECRET_KEY environment variable, API reachability, and authentication. Returns account ID and whether key is live or test mode. Use when diagnosing connection issues or verifying server setup.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["healthy", "degraded", "unhealthy"] },
          checks: {
            type: "object",
            properties: {
              envVars: { type: "object" },
              apiReachable: { type: "boolean" },
              authValid: { type: "boolean" },
              latencyMs: { type: "number" },
              accountId: { type: "string" },
              livemode: { type: "boolean" },
            },
          },
        },
        required: ["status", "checks"],
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

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    health_check: async () => {
      const checks: Record<string, unknown> = {};

      const requiredEnvVars = ["STRIPE_SECRET_KEY"];
      const missing = requiredEnvVars.filter((v) => !process.env[v]);
      checks.envVars = { ok: missing.length === 0, missing };

      const healthResult = await client.healthCheck();
      checks.apiReachable = healthResult.reachable;
      checks.authValid = healthResult.authenticated;
      checks.latencyMs = healthResult.latencyMs;
      if (healthResult.accountId) checks.accountId = healthResult.accountId;
      if (healthResult.livemode !== undefined) {
        checks.livemode = healthResult.livemode;
        checks.mode = healthResult.livemode ? "live" : "test";
      }

      let status: "healthy" | "degraded" | "unhealthy";
      if (missing.length > 0 || !healthResult.reachable) {
        status = "unhealthy";
      } else if (!healthResult.authenticated) {
        status = "degraded";
      } else {
        status = "healthy";
      }

      const result = {
        status,
        checks,
        ...(healthResult.error ? { error: healthResult.error } : {}),
      };

      logger.info("health_check", { status });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
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
