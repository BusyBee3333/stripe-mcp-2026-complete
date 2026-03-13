// Files tools — Stripe API v1
// Covers: list_files, get_file, list_file_links, get_file_link, create_file_link, update_file_link

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListFilesSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  purpose: z.enum([
    "account_requirement", "additional_verification", "business_icon", "business_logo",
    "customer_signature", "dispute_evidence", "document_provider_identity_document",
    "finance_report_run", "identity_document", "identity_document_downloadable",
    "issuing_regulatory_reporting", "pci_document", "sigma_scheduled_query",
    "tax_document_user_upload", "terminal_reader_splashscreen",
  ]).optional().describe("Filter by purpose"),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  created_gte: z.number().optional(),
  created_lte: z.number().optional(),
});

const GetFileSchema = z.object({
  file_id: z.string().describe("Stripe file ID (file_xxx)"),
});

const ListFileLinksSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  file: z.string().optional().describe("Filter by file ID (file_xxx)"),
  expired: z.boolean().optional().describe("Filter by expiry status"),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetFileLinkSchema = z.object({
  file_link_id: z.string().describe("Stripe file link ID (link_xxx)"),
});

const CreateFileLinkSchema = z.object({
  file: z.string().describe("ID of the file to link (file_xxx)"),
  expires_at: z.number().optional().describe("Unix timestamp when this link expires (default: never)"),
  metadata: z.record(z.string()).optional(),
});

const UpdateFileLinkSchema = z.object({
  file_link_id: z.string().describe("Stripe file link ID (link_xxx)"),
  expires_at: z.number().optional().describe("New expiry Unix timestamp, or set to 0 to disable expiry"),
  metadata: z.record(z.string()).optional(),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_files",
      title: "List Files",
      description:
        "List uploaded Stripe files. Files are used for dispute evidence, identity verification, business logos, and more. Optionally filter by purpose. Returns file ID, filename, size, purpose, and URL. Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          purpose: { type: "string", description: "Filter by purpose (e.g. 'dispute_evidence', 'identity_document')" },
          starting_after: { type: "string", description: "Pagination cursor" },
          ending_before: { type: "string", description: "Pagination cursor — reversed" },
          created_gte: { type: "number", description: "Filter by creation time (Unix timestamp, >=)" },
          created_lte: { type: "number", description: "Filter by creation time (Unix timestamp, <=)" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_file",
      title: "Get File",
      description:
        "Retrieve a specific Stripe file by ID (file_xxx). Returns filename, size, purpose, type, URL, and expiry.",
      inputSchema: {
        type: "object",
        properties: { file_id: { type: "string", description: "Stripe file ID (file_xxx)" } },
        required: ["file_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_file_links",
      title: "List File Links",
      description:
        "List shareable file links. File links generate publicly accessible URLs for Stripe files. Optionally filter by file ID or expired status.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          file: { type: "string", description: "Filter by file ID (file_xxx)" },
          expired: { type: "boolean", description: "Filter by expiry status (true = expired only)" },
          starting_after: { type: "string", description: "Pagination cursor" },
          ending_before: { type: "string", description: "Pagination cursor — reversed" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_file_link",
      title: "Get File Link",
      description: "Retrieve a specific file link by ID (link_xxx). Returns the public URL, expiry, and associated file.",
      inputSchema: {
        type: "object",
        properties: { file_link_id: { type: "string", description: "Stripe file link ID (link_xxx)" } },
        required: ["file_link_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_file_link",
      title: "Create File Link",
      description:
        "Create a shareable link for a Stripe file. Generates a publicly accessible URL for the file. Optionally set an expiry timestamp. Use for sharing dispute evidence, identity docs, or reports with third parties.",
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string", description: "ID of the file to link (file_xxx)" },
          expires_at: { type: "number", description: "Unix timestamp when this link expires" },
          metadata: { type: "object", description: "Key-value metadata" },
        },
        required: ["file"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_file_link",
      title: "Update File Link",
      description: "Update a file link's expiry or metadata. Set expires_at to extend/shorten access, or update metadata.",
      inputSchema: {
        type: "object",
        properties: {
          file_link_id: { type: "string", description: "Stripe file link ID (link_xxx)" },
          expires_at: { type: "number", description: "New expiry Unix timestamp" },
          metadata: { type: "object", description: "Updated metadata" },
        },
        required: ["file_link_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_files: async (args) => {
      const params = ListFilesSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.purpose) q.purpose = params.purpose;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      if (params.created_gte) q["created[gte]"] = params.created_gte;
      if (params.created_lte) q["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_files", () =>
        client.list<Record<string, unknown>>("/files", q)
      , { tool: "list_files" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_file: async (args) => {
      const { file_id } = GetFileSchema.parse(args);
      const file = await logger.time("tool.get_file", () =>
        client.get<Record<string, unknown>>(`/files/${file_id}`)
      , { tool: "get_file", file_id });
      return { content: [{ type: "text", text: JSON.stringify(file, null, 2) }], structuredContent: file };
    },

    list_file_links: async (args) => {
      const params = ListFileLinksSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.file) q.file = params.file;
      if (params.expired !== undefined) q.expired = params.expired;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_file_links", () =>
        client.list<Record<string, unknown>>("/file_links", q)
      , { tool: "list_file_links" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_file_link: async (args) => {
      const { file_link_id } = GetFileLinkSchema.parse(args);
      const link = await logger.time("tool.get_file_link", () =>
        client.get<Record<string, unknown>>(`/file_links/${file_link_id}`)
      , { tool: "get_file_link", file_link_id });
      return { content: [{ type: "text", text: JSON.stringify(link, null, 2) }], structuredContent: link };
    },

    create_file_link: async (args) => {
      const params = CreateFileLinkSchema.parse(args);
      const body: Record<string, unknown> = { file: params.file };
      if (params.expires_at) body.expires_at = params.expires_at;
      if (params.metadata) body.metadata = params.metadata;

      const link = await logger.time("tool.create_file_link", () =>
        client.post<Record<string, unknown>>("/file_links", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_file_link" });
      return { content: [{ type: "text", text: JSON.stringify(link, null, 2) }], structuredContent: link };
    },

    update_file_link: async (args) => {
      const { file_link_id, ...rest } = UpdateFileLinkSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (rest.expires_at !== undefined) body.expires_at = rest.expires_at;
      if (rest.metadata !== undefined) body.metadata = rest.metadata;

      const link = await logger.time("tool.update_file_link", () =>
        client.post<Record<string, unknown>>(`/file_links/${file_link_id}`, body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "update_file_link", file_link_id });
      return { content: [{ type: "text", text: JSON.stringify(link, null, 2) }], structuredContent: link };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
