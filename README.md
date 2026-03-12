# Stripe MCP Server 2026

Production-quality [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for the **Stripe API v1**. Enables AI agents to manage payments, subscriptions, customers, invoices, products, and refunds through a fully typed, resilient interface.

## Features

- **20 tools** covering Customers, PaymentIntents, Subscriptions, Invoices, Products, Prices, Charges, and Refunds
- **Stripe API v1** with keyset pagination (`starting_after` / `has_more`)
- **Form-encoded POST bodies** (`application/x-www-form-urlencoded`) — exactly as Stripe expects
- **Nested metadata support** — `metadata[key]=value` flattening for form encoding
- **Circuit breaker** with configurable failure threshold and reset timeout
- **Automatic retry** with exponential backoff + jitter for 5xx and rate-limit responses
- **30-second request timeout** with AbortController
- **Structured JSON logging** on stderr (stdout reserved for MCP protocol)
- **Both `content` (text) and `structuredContent` (JSON)** in every tool response
- **stdio + Streamable HTTP** transport support
- **MCP SDK v1.26.0** — patched for cross-client data leak (GHSA-345p-7cg4-v4c7)
- **Zod v3** — compatible with MCP SDK v1.x (v4 is incompatible)

## Tools

### Health
| Tool | Description |
|------|-------------|
| `health_check` | Validate API key, account info, and live/test mode |

### Customers
| Tool | Description |
|------|-------------|
| `list_customers` | List customers with email filter and date range |
| `get_customer` | Get customer with optional payment methods |
| `create_customer` | Create customer with email/name/metadata |
| `update_customer` | Update customer fields (metadata merges) |

### PaymentIntents
| Tool | Description |
|------|-------------|
| `list_payment_intents` | List payment intents by customer/date |
| `get_payment_intent` | Get payment intent details and status |
| `create_payment_intent` | Create payment intent with amount/currency |

### Subscriptions
| Tool | Description |
|------|-------------|
| `list_subscriptions` | List subscriptions by customer/status |
| `get_subscription` | Get subscription with plan details |
| `create_subscription` | Create subscription with price and trial |
| `cancel_subscription` | Cancel immediately or at period end |

### Invoices
| Tool | Description |
|------|-------------|
| `list_invoices` | List invoices by customer/subscription/status |
| `get_invoice` | Get invoice with line items |

### Products & Prices
| Tool | Description |
|------|-------------|
| `list_products` | List Stripe products |
| `get_product` | Get product details |
| `create_product` | Create product with optional attached price |
| `list_prices` | List prices by product/type |

### Charges & Refunds
| Tool | Description |
|------|-------------|
| `list_charges` | List charges by customer/date |
| `create_refund` | Refund a charge (full or partial) |

## Setup

### 1. Get Stripe API key

1. Log into your [Stripe Dashboard](https://dashboard.stripe.com)
2. Go to **Developers → API keys**
3. Copy your **Secret key** (starts with `sk_live_` for production or `sk_test_` for test mode)
4. **Never commit your secret key** — use `.env` file or environment variables

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. Build and run

```bash
npm install
npm run build
npm start
```

### 4. Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "stripe": {
      "command": "node",
      "args": ["/path/to/stripe-mcp-2026-complete/dist/index.js"],
      "env": {
        "STRIPE_SECRET_KEY": "sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

## HTTP Transport

For remote/network deployment:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3000 npm start
```

Endpoints:
- `POST /mcp` — MCP protocol (creates or resumes session)
- `GET /mcp` — SSE stream for server-initiated messages (requires `mcp-session-id` header)
- `DELETE /mcp` — Close session
- `GET /health` — Health check (non-MCP)

## Pagination

Stripe uses keyset pagination. When `meta.hasMore` is `true`, pass `meta.lastId` as `starting_after` in the next call:

```json
// First call
{ "limit": 20 }

// Response
{ "data": [...], "meta": { "count": 20, "hasMore": true, "lastId": "cus_xxx123" } }

// Next call
{ "limit": 20, "starting_after": "cus_xxx123" }
```

## Auth Pattern

- **Header:** `Authorization: Bearer sk_...`
- **POST bodies:** `application/x-www-form-urlencoded` (NOT JSON)
- **Stripe-Version:** `2024-06-20`
- **Base URL:** `https://api.stripe.com/v1`

### Nested Parameters (Form Encoding)

Stripe's form encoding supports nested objects and arrays:
- Metadata: `metadata[key]=value`
- Subscription items: `items[0][price]=price_xxx&items[0][quantity]=1`
- Recurring prices: `recurring[interval]=month`

The client handles this automatically via the `toFormEncoded()` method.

## Amount Format

All monetary amounts in Stripe use the **smallest currency unit**:
- USD: **cents** — $10.00 = `1000`
- EUR: **cents** — €10.00 = `1000`
- JPY: **yen** (no decimal) — ¥1000 = `1000`

## Development

```bash
npm run dev     # Run with tsx (no build required)
npm run build   # Compile TypeScript
npm start       # Run compiled server
```

## Architecture

```
src/
├── index.ts              # Server entry, transport selection, tool registration
├── client.ts             # StripeClient with form-encoding, circuit breaker, keyset pagination
├── logger.ts             # Structured JSON logger (stderr)
├── types.ts              # Shared TypeScript interfaces
└── tools/
    ├── health.ts         # health_check
    ├── customers.ts      # list_customers, get_customer, create_customer, update_customer
    ├── payment_intents.ts # list_payment_intents, get_payment_intent, create_payment_intent
    ├── subscriptions.ts  # list_subscriptions, get_subscription, create_subscription, cancel_subscription
    ├── invoices.ts       # list_invoices, get_invoice
    ├── products.ts       # list_products, get_product, create_product, list_prices
    └── charges.ts        # list_charges, create_refund
```

## MCP Spec Compliance

- **SDK:** `@modelcontextprotocol/sdk ^1.26.0` (2025-11-25 spec)
- **Tools:** All include `name`, `title`, `description`, `inputSchema`, `outputSchema`, `annotations`
- **Annotations:** `readOnlyHint: true` for all list/get tools; `destructiveHint: true` for `cancel_subscription` and `create_refund`
- **Responses:** Both `content` (text fallback) and `structuredContent` (typed JSON) in every response
- **Transport:** stdio (default) + Streamable HTTP (set `MCP_TRANSPORT=http`)

## Security Notes

- **Never use live keys in development** — always use test mode (`sk_test_`) for testing
- **Rotate keys immediately** if exposed in logs or source control
- The server logs to stderr only — Stripe keys never appear in stdout (MCP protocol stream)

## License

MIT
