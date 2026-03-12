#!/usr/bin/env node
// Stripe MCP Server — Production Entry Point
// Supports stdio (default) and Streamable HTTP transports

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { StripeClient } from "./client.js";
import { logger } from "./logger.js";

const MCP_NAME = "stripe";
const MCP_VERSION = "1.0.0";

// ============================================
// TOOL GROUP LOADERS (lazy imports)
// ============================================
async function loadAllTools(client: StripeClient) {
  const [health, customers, paymentIntents, subscriptions, invoices, products, charges] = await Promise.all([
    import("./tools/health.js").then((m) => m.getTools(client)),
    import("./tools/customers.js").then((m) => m.getTools(client)),
    import("./tools/payment_intents.js").then((m) => m.getTools(client)),
    import("./tools/subscriptions.js").then((m) => m.getTools(client)),
    import("./tools/invoices.js").then((m) => m.getTools(client)),
    import("./tools/products.js").then((m) => m.getTools(client)),
    import("./tools/charges.js").then((m) => m.getTools(client)),
  ]);

  return [health, customers, paymentIntents, subscriptions, invoices, products, charges];
}

// ============================================
// MAIN SERVER SETUP
// ============================================
async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    logger.error("startup.missing_env", { variable: "STRIPE_SECRET_KEY" });
    console.error("Error: Missing required environment variable: STRIPE_SECRET_KEY");
    console.error("Copy .env.example to .env and fill in your Stripe secret key.");
    console.error("  STRIPE_SECRET_KEY — starts with sk_live_ (production) or sk_test_ (test mode)");
    process.exit(1);
  }

  // Initialize Stripe API client
  const client = new StripeClient(secretKey);

  // Create MCP server
  const server = new McpServer({
    name: `${MCP_NAME}-mcp`,
    version: MCP_VERSION,
  });

  // Load all tool groups
  const toolGroups = await loadAllTools(client);

  // Register all tools
  let totalTools = 0;
  for (const group of toolGroups) {
    for (const tool of group.tools) {
      const handler = group.handlers[tool.name];
      if (!handler) {
        logger.warn("tool.missing_handler", { tool: tool.name });
        continue;
      }

      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: buildZodSchema(tool.inputSchema),
          outputSchema: tool.outputSchema ? buildOutputZodSchema(tool.outputSchema) : undefined,
          annotations: tool.annotations,
        },
        async (args) => {
          const requestId = logger.requestId();
          const start = performance.now();
          logger.info("tool.call.start", { requestId, tool: tool.name });

          try {
            const result = await handler(args as Record<string, unknown>);
            const durationMs = Math.round(performance.now() - start);
            logger.info("tool.call.done", { requestId, tool: tool.name, durationMs });
            return {
              content: result.content,
              structuredContent: result.structuredContent as Record<string, unknown> | undefined,
              isError: result.isError,
            };
          } catch (error) {
            const durationMs = Math.round(performance.now() - start);
            let message: string;

            if (error instanceof z.ZodError) {
              message = `Validation error: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`;
              logger.warn("tool.call.validation_error", { requestId, tool: tool.name, durationMs, errors: error.errors });
            } else if (error instanceof Error) {
              message = error.message;
              logger.error("tool.call.error", { requestId, tool: tool.name, durationMs, error: message });
            } else {
              message = String(error);
              logger.error("tool.call.error", { requestId, tool: tool.name, durationMs, error: message });
            }

            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              structuredContent: { error: message, tool: tool.name } as Record<string, unknown>,
              isError: true,
            };
          }
        }
      );

      totalTools++;
    }
  }

  logger.info("server.tools_loaded", { totalTools });

  // === Transport Selection ===
  const transportMode = process.env.MCP_TRANSPORT || "stdio";

  if (transportMode === "http") {
    await startHttpTransport(server);
  } else {
    await startStdioTransport(server);
  }
}

// === Build Zod schema from JSON Schema (inputSchema) ===
function buildZodSchema(inputSchema: {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}): z.ZodRawShape {
  const shape: z.ZodRawShape = {};

  for (const [key, value] of Object.entries(inputSchema.properties)) {
    const prop = value as Record<string, unknown>;
    const isRequired = inputSchema.required?.includes(key) ?? false;

    let zodType: z.ZodTypeAny;

    switch (prop.type) {
      case "number":
        zodType = z.number().describe((prop.description as string) || key);
        break;
      case "boolean":
        zodType = z.boolean().describe((prop.description as string) || key);
        break;
      case "array":
        zodType = z.array(z.unknown()).describe((prop.description as string) || key);
        break;
      case "object":
        zodType = z.record(z.unknown()).describe((prop.description as string) || key);
        break;
      default:
        if (prop.enum) {
          const enumValues = prop.enum as [string, ...string[]];
          zodType = z.enum(enumValues).describe((prop.description as string) || key);
        } else {
          zodType = z.string().describe((prop.description as string) || key);
        }
    }

    shape[key] = isRequired ? zodType : zodType.optional();
  }

  return shape;
}

// === Build output schema ===
function buildOutputZodSchema(_schema: Record<string, unknown>): z.ZodTypeAny {
  return z.record(z.unknown());
}

// === Stdio Transport ===
async function startStdioTransport(server: McpServer) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("server.started", { transport: "stdio", name: MCP_NAME, version: MCP_VERSION });
}

// === Streamable HTTP Transport ===
async function startHttpTransport(server: McpServer) {
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const { createServer } = await import("http");
  const { randomUUID } = await import("crypto");

  const port = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);

  const sessions = new Map<string, { transport: InstanceType<typeof StreamableHTTPServerTransport>; lastActivity: number }>();
  const MAX_SESSIONS = 100;
  const SESSION_TTL_MS = 30 * 60 * 1000;

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        logger.info("session.expired", { sessionId: id });
        sessions.delete(id);
      }
    }
  }, 60_000);

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: MCP_NAME, version: MCP_VERSION, activeSessions: sessions.size }));
      return;
    }

    if (url.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        let transport: InstanceType<typeof StreamableHTTPServerTransport>;

        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          session.lastActivity = Date.now();
          transport = session.transport;
        } else {
          if (sessions.size >= MAX_SESSIONS) {
            let oldest: string | null = null;
            let oldestTime = Infinity;
            for (const [id, s] of sessions.entries()) {
              if (s.lastActivity < oldestTime) { oldestTime = s.lastActivity; oldest = id; }
            }
            if (oldest) sessions.delete(oldest);
          }

          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });
          await server.connect(transport);
          const newId = (transport as unknown as { sessionId?: string }).sessionId || randomUUID();
          sessions.set(newId, { transport, lastActivity: Date.now() });
        }

        await (transport as unknown as { handleRequest: (req: unknown, res: unknown) => Promise<void> }).handleRequest(req, res);
        return;
      }

      if (req.method === "GET" && sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        session.lastActivity = Date.now();
        await (session.transport as unknown as { handleRequest: (req: unknown, res: unknown) => Promise<void> }).handleRequest(req, res);
        return;
      }

      if (req.method === "DELETE" && sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await (session.transport as unknown as { handleRequest: (req: unknown, res: unknown) => Promise<void> }).handleRequest(req, res);
        sessions.delete(sessionId);
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });

  process.on("SIGTERM", () => {
    clearInterval(cleanupInterval);
    sessions.clear();
  });

  httpServer.listen(port, () => {
    logger.info("server.started", { transport: "http", name: MCP_NAME, port, endpoint: "/mcp" });
  });
}

main().catch((error) => {
  logger.error("server.fatal", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
