// Identity tools — Stripe API v1 (Stripe Identity)
// Covers: list_verification_sessions, get_verification_session, create_verification_session,
//         cancel_verification_session, redact_verification_session,
//         list_verification_reports, get_verification_report

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListVerificationSessionsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  status: z.enum(["canceled", "processing", "requires_input", "verified"]).optional(),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  created_gte: z.number().optional(),
  created_lte: z.number().optional(),
});

const GetVerificationSessionSchema = z.object({
  session_id: z.string().describe("Verification session ID (vs_xxx)"),
});

const CreateVerificationSessionSchema = z.object({
  type: z.enum(["document", "id_number"]).describe("Type of verification: document (ID document) or id_number (Social Security Number / government ID number)"),
  return_url: z.string().url().optional().describe("URL to redirect after the verification flow completes"),
  metadata: z.record(z.string()).optional(),
  options_document_allowed_types: z.array(z.enum(["driving_license", "id_card", "passport"])).optional().describe("Document types to accept (for document type)"),
  options_document_require_id_number: z.boolean().optional(),
  options_document_require_live_capture: z.boolean().optional().describe("Require live capture (no photo uploads)"),
  options_document_require_matching_selfie: z.boolean().optional().describe("Require a selfie to match the document"),
  provided_details_email: z.string().optional(),
  provided_details_phone: z.string().optional(),
});

const CancelVerificationSessionSchema = z.object({
  session_id: z.string().describe("Verification session ID (vs_xxx) to cancel"),
});

const RedactVerificationSessionSchema = z.object({
  session_id: z.string().describe("Verification session ID (vs_xxx) to redact — permanently deletes collected PII"),
});

const ListVerificationReportsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  type: z.enum(["document", "id_number"]).optional(),
  verification_session: z.string().optional().describe("Filter by verification session ID"),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
});

const GetVerificationReportSchema = z.object({
  report_id: z.string().describe("Verification report ID (vr_xxx)"),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_verification_sessions",
      title: "List Identity Verification Sessions",
      description:
        "List Stripe Identity verification sessions. Sessions represent an attempt to verify a user's identity. Returns session ID, type (document/id_number), status, created date, and last_error if failed. Optionally filter by status.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
          status: { type: "string", enum: ["canceled", "processing", "requires_input", "verified"] },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
          created_gte: { type: "number" },
          created_lte: { type: "number" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_verification_session",
      title: "Get Identity Verification Session",
      description: "Retrieve a specific Identity verification session by ID (vs_xxx). Returns status, type, url (for the verification flow), verified_outputs (on success), and last_error.",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string", description: "Verification session ID (vs_xxx)" } },
        required: ["session_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_verification_session",
      title: "Create Identity Verification Session",
      description:
        "Create a new Stripe Identity verification session. Returns a session with a url to redirect the user to for identity verification. Use type='document' to verify a government ID, or type='id_number' to verify an SSN/TIN.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["document", "id_number"], description: "Verification type" },
          return_url: { type: "string", description: "URL to redirect after verification" },
          metadata: { type: "object" },
          options_document_allowed_types: { type: "array", description: "Accepted document types (e.g. ['passport', 'driving_license'])" },
          options_document_require_live_capture: { type: "boolean" },
          options_document_require_matching_selfie: { type: "boolean" },
          provided_details_email: { type: "string" },
          provided_details_phone: { type: "string" },
        },
        required: ["type"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "cancel_verification_session",
      title: "Cancel Identity Verification Session",
      description: "Cancel a verification session that is in 'requires_input' status. Returns the canceled session.",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string", description: "Verification session ID (vs_xxx)" } },
        required: ["session_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "redact_verification_session",
      title: "Redact Identity Verification Session",
      description:
        "Permanently redact (delete) all collected PII from a verification session. This removes verified_outputs (name, DOB, document images, etc.) to comply with data retention policies. Cannot be undone.",
      inputSchema: {
        type: "object",
        properties: { session_id: { type: "string", description: "Verification session ID (vs_xxx)" } },
        required: ["session_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "list_verification_reports",
      title: "List Identity Verification Reports",
      description:
        "List Stripe Identity verification reports. Reports are created when a verification session is processed. Returns the verification outcome (document details, id_number details, selfie results).",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number" },
          type: { type: "string", enum: ["document", "id_number"] },
          verification_session: { type: "string", description: "Filter by verification session ID" },
          starting_after: { type: "string" },
          ending_before: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_verification_report",
      title: "Get Identity Verification Report",
      description: "Retrieve a specific Identity verification report by ID (vr_xxx). Returns the detailed verification outcome including extracted document data, selfie comparison result, and any error details.",
      inputSchema: {
        type: "object",
        properties: { report_id: { type: "string", description: "Verification report ID (vr_xxx)" } },
        required: ["report_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_verification_sessions: async (args) => {
      const params = ListVerificationSessionsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.status) q.status = params.status;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      if (params.created_gte) q["created[gte]"] = params.created_gte;
      if (params.created_lte) q["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_verification_sessions", () =>
        client.list<Record<string, unknown>>("/identity/verification_sessions", q)
      , { tool: "list_verification_sessions" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_verification_session: async (args) => {
      const { session_id } = GetVerificationSessionSchema.parse(args);
      const r = await logger.time("tool.get_verification_session", () =>
        client.get<Record<string, unknown>>(`/identity/verification_sessions/${session_id}`)
      , { tool: "get_verification_session" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    create_verification_session: async (args) => {
      const params = CreateVerificationSessionSchema.parse(args);
      const body: Record<string, unknown> = { type: params.type };
      if (params.return_url) body.return_url = params.return_url;
      if (params.metadata) body.metadata = params.metadata;
      if (params.provided_details_email) body["provided_details[email]"] = params.provided_details_email;
      if (params.provided_details_phone) body["provided_details[phone]"] = params.provided_details_phone;
      if (params.options_document_require_live_capture !== undefined) body["options[document][require_live_capture]"] = params.options_document_require_live_capture;
      if (params.options_document_require_matching_selfie !== undefined) body["options[document][require_matching_selfie]"] = params.options_document_require_matching_selfie;
      if (params.options_document_require_id_number !== undefined) body["options[document][require_id_number]"] = params.options_document_require_id_number;
      if (params.options_document_allowed_types) {
        params.options_document_allowed_types.forEach((t, i) => { body[`options[document][allowed_types][${i}]`] = t; });
      }

      const r = await logger.time("tool.create_verification_session", () =>
        client.post<Record<string, unknown>>("/identity/verification_sessions", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_verification_session" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    cancel_verification_session: async (args) => {
      const { session_id } = CancelVerificationSessionSchema.parse(args);
      const r = await logger.time("tool.cancel_verification_session", () =>
        client.post<Record<string, unknown>>(`/identity/verification_sessions/${session_id}/cancel`, {})
      , { tool: "cancel_verification_session" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    redact_verification_session: async (args) => {
      const { session_id } = RedactVerificationSessionSchema.parse(args);
      const r = await logger.time("tool.redact_verification_session", () =>
        client.post<Record<string, unknown>>(`/identity/verification_sessions/${session_id}/redact`, {})
      , { tool: "redact_verification_session" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },

    list_verification_reports: async (args) => {
      const params = ListVerificationReportsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.type) q.type = params.type;
      if (params.verification_session) q.verification_session = params.verification_session;
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;

      const result = await logger.time("tool.list_verification_reports", () =>
        client.list<Record<string, unknown>>("/identity/verification_reports", q)
      , { tool: "list_verification_reports" });
      const lastItem = result.data[result.data.length - 1] as { id?: string } | undefined;
      const response = {
        data: result.data,
        meta: { count: result.data.length, hasMore: result.has_more, ...(lastItem?.id ? { lastId: lastItem.id } : {}) },
      };
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], structuredContent: response };
    },

    get_verification_report: async (args) => {
      const { report_id } = GetVerificationReportSchema.parse(args);
      const r = await logger.time("tool.get_verification_report", () =>
        client.get<Record<string, unknown>>(`/identity/verification_reports/${report_id}`)
      , { tool: "get_verification_report" });
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }], structuredContent: r };
    },
  };
}

export function getTools(client: StripeClient) {
  return { tools: getToolDefinitions(), handlers: getToolHandlers(client) };
}
