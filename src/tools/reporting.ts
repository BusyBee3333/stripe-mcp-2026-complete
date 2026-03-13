// Reporting tools — Stripe API v1
// Covers: list_report_types, get_report_type, create_report_run, get_report_run, list_report_runs

import { z } from "zod";
import type { StripeClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const ListReportTypesSchema = z.object({});

const GetReportTypeSchema = z.object({
  report_type_id: z.string().describe("Report type ID (e.g. 'balance.summary.1', 'payout_reconciliation.by_id.grouped.itemized.4')"),
});

const CreateReportRunSchema = z.object({
  report_type: z.string().describe("Report type ID (e.g. 'balance.summary.1'). Use list_report_types to see available types."),
  interval_start: z.number().optional().describe("Start of the reporting period (Unix timestamp). Required for most reports."),
  interval_end: z.number().optional().describe("End of the reporting period (Unix timestamp). Required for most reports."),
  timezone: z.string().optional().describe("Timezone for report dates (e.g. 'America/New_York', 'UTC'). Default: 'Etc/UTC'"),
  currency: z.string().optional().describe("Three-letter currency code to filter (for reports supporting currency filtering)"),
  connected_account: z.string().optional().describe("Connected account ID (acct_xxx) to run report for — for Connect platforms"),
  payout: z.string().optional().describe("Filter to a specific payout ID (for payout reconciliation reports)"),
  columns: z.array(z.string()).optional().describe("Specific columns to include in the report (report-type specific)"),
});

const GetReportRunSchema = z.object({
  report_run_id: z.string().describe("Report run ID (frr_xxx)"),
});

const ListReportRunsSchema = z.object({
  limit: z.number().min(1).max(100).optional().default(20),
  starting_after: z.string().optional(),
  ending_before: z.string().optional(),
  created_gte: z.number().optional(),
  created_lte: z.number().optional(),
});

function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_report_types",
      title: "List Report Types",
      description:
        "List all available Stripe Sigma report types. Returns report type IDs (e.g. 'balance.summary.1'), names, descriptions, and required parameters. Use this to discover which reports are available before running one.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_report_type",
      title: "Get Report Type",
      description:
        "Retrieve a specific report type by ID. Returns the name, description, data_available_end, data_available_start, default_columns, and all available parameter options.",
      inputSchema: {
        type: "object",
        properties: {
          report_type_id: { type: "string", description: "Report type ID (e.g. 'balance.summary.1')" },
        },
        required: ["report_type_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_report_run",
      title: "Create Report Run",
      description:
        "Queue a new Stripe report run. Reports are generated asynchronously — the run starts as 'pending' and transitions to 'succeeded' (with a result.url to download) or 'failed'. Check status with get_report_run. Most reports require interval_start and interval_end.",
      inputSchema: {
        type: "object",
        properties: {
          report_type: { type: "string", description: "Report type ID (e.g. 'balance.summary.1')" },
          interval_start: { type: "number", description: "Report period start (Unix timestamp)" },
          interval_end: { type: "number", description: "Report period end (Unix timestamp)" },
          timezone: { type: "string", description: "Timezone (e.g. 'America/New_York', 'UTC')" },
          currency: { type: "string", description: "Three-letter currency code filter" },
          connected_account: { type: "string", description: "Connected account ID for Connect platforms" },
          payout: { type: "string", description: "Payout ID filter for reconciliation reports" },
          columns: { type: "array", description: "Specific columns to include" },
        },
        required: ["report_type"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_report_run",
      title: "Get Report Run",
      description:
        "Check the status of a report run (frr_xxx). When status is 'succeeded', result.url contains a download link for the CSV/JSON report file. When 'failed', error contains the failure reason. Poll this endpoint until the run is no longer 'pending'.",
      inputSchema: {
        type: "object",
        properties: {
          report_run_id: { type: "string", description: "Report run ID (frr_xxx)" },
        },
        required: ["report_run_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_report_runs",
      title: "List Report Runs",
      description:
        "List all report runs. Returns run IDs, report types, status (pending/succeeded/failed), created timestamp, and result URLs for completed runs. Uses keyset pagination.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Number of results (1-100, default 20)" },
          starting_after: { type: "string", description: "Pagination cursor" },
          ending_before: { type: "string", description: "Pagination cursor — reversed" },
          created_gte: { type: "number", description: "Filter by creation time (Unix timestamp, >=)" },
          created_lte: { type: "number", description: "Filter by creation time (Unix timestamp, <=)" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
}

function getToolHandlers(client: StripeClient): Record<string, ToolHandler> {
  return {
    list_report_types: async (_args) => {
      const result = await logger.time("tool.list_report_types", () =>
        client.get<Record<string, unknown>>("/reporting/report_types")
      , { tool: "list_report_types" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
    },

    get_report_type: async (args) => {
      const { report_type_id } = GetReportTypeSchema.parse(args);
      const reportType = await logger.time("tool.get_report_type", () =>
        client.get<Record<string, unknown>>(`/reporting/report_types/${report_type_id}`)
      , { tool: "get_report_type", report_type_id });
      return { content: [{ type: "text", text: JSON.stringify(reportType, null, 2) }], structuredContent: reportType };
    },

    create_report_run: async (args) => {
      const params = CreateReportRunSchema.parse(args);
      const body: Record<string, unknown> = { report_type: params.report_type };
      if (params.interval_start) body["parameters[interval_start]"] = params.interval_start;
      if (params.interval_end) body["parameters[interval_end]"] = params.interval_end;
      if (params.timezone) body["parameters[timezone]"] = params.timezone;
      if (params.currency) body["parameters[currency]"] = params.currency;
      if (params.connected_account) body["parameters[connected_account]"] = params.connected_account;
      if (params.payout) body["parameters[payout]"] = params.payout;
      if (params.columns) {
        params.columns.forEach((col, i) => { body[`parameters[columns][${i}]`] = col; });
      }

      const run = await logger.time("tool.create_report_run", () =>
        client.post<Record<string, unknown>>("/reporting/report_runs", body as Record<string, string | number | boolean | undefined | null>)
      , { tool: "create_report_run" });
      return { content: [{ type: "text", text: JSON.stringify(run, null, 2) }], structuredContent: run };
    },

    get_report_run: async (args) => {
      const { report_run_id } = GetReportRunSchema.parse(args);
      const run = await logger.time("tool.get_report_run", () =>
        client.get<Record<string, unknown>>(`/reporting/report_runs/${report_run_id}`)
      , { tool: "get_report_run", report_run_id });
      return { content: [{ type: "text", text: JSON.stringify(run, null, 2) }], structuredContent: run };
    },

    list_report_runs: async (args) => {
      const params = ListReportRunsSchema.parse(args);
      const q: Record<string, string | number | boolean | undefined | null> = { limit: params.limit };
      if (params.starting_after) q.starting_after = params.starting_after;
      if (params.ending_before) q.ending_before = params.ending_before;
      if (params.created_gte) q["created[gte]"] = params.created_gte;
      if (params.created_lte) q["created[lte]"] = params.created_lte;

      const result = await logger.time("tool.list_report_runs", () =>
        client.list<Record<string, unknown>>("/reporting/report_runs", q)
      , { tool: "list_report_runs" });
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
