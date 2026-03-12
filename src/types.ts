// Shared TypeScript interfaces for Stripe MCP Server

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  outputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  structuredContent?: any;
  isError?: boolean;
}>;

// Stripe-specific types
export interface StripeCustomer {
  id: string;
  object: "customer";
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  description?: string | null;
  metadata?: Record<string, string>;
  created: number;
  currency?: string | null;
  delinquent?: boolean | null;
  default_source?: string | null;
  balance?: number;
  livemode: boolean;
}

export interface StripePaymentIntent {
  id: string;
  object: "payment_intent";
  amount: number;
  currency: string;
  status: string;
  customer?: string | null;
  description?: string | null;
  metadata?: Record<string, string>;
  client_secret?: string;
  payment_method?: string | null;
  created: number;
  livemode: boolean;
}

export interface StripeSubscription {
  id: string;
  object: "subscription";
  customer: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  canceled_at?: number | null;
  items?: { data: StripeSubscriptionItem[] };
  metadata?: Record<string, string>;
  created: number;
  livemode: boolean;
}

export interface StripeSubscriptionItem {
  id: string;
  price: StripePrice;
  quantity?: number;
}

export interface StripeInvoice {
  id: string;
  object: "invoice";
  customer?: string | null;
  subscription?: string | null;
  status?: string | null;
  total: number;
  amount_due: number;
  amount_paid: number;
  currency: string;
  lines?: { data: unknown[] };
  created: number;
  due_date?: number | null;
  paid: boolean;
  livemode: boolean;
}

export interface StripeProduct {
  id: string;
  object: "product";
  name: string;
  active: boolean;
  description?: string | null;
  metadata?: Record<string, string>;
  created: number;
  livemode: boolean;
}

export interface StripePrice {
  id: string;
  object: "price";
  product: string;
  active: boolean;
  currency: string;
  unit_amount?: number | null;
  recurring?: {
    interval: string;
    interval_count: number;
  } | null;
  type: "one_time" | "recurring";
  created: number;
  livemode: boolean;
}

export interface StripeCharge {
  id: string;
  object: "charge";
  amount: number;
  currency: string;
  status: string;
  customer?: string | null;
  description?: string | null;
  payment_intent?: string | null;
  refunded: boolean;
  amount_refunded: number;
  created: number;
  livemode: boolean;
}

export interface StripeRefund {
  id: string;
  object: "refund";
  amount: number;
  charge: string;
  currency: string;
  status: string;
  reason?: string | null;
  created: number;
}

export interface StripeList<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  url: string;
}
