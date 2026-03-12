// Stripe API Client
// Handles: Bearer auth, form-encoded POST bodies, circuit breaker, retry, rate limiting, keyset pagination

import { logger } from "./logger.js";
import type { StripeList } from "./types.js";

const STRIPE_BASE_URL = "https://api.stripe.com/v1";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;

// ============================================
// CIRCUIT BREAKER
// ============================================
type CircuitState = "closed" | "open" | "half-open";

class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenLock = false;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(failureThreshold = 5, resetTimeoutMs = 60_000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  canExecute(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        if (!this.halfOpenLock) {
          this.halfOpenLock = true;
          this.state = "half-open";
          logger.info("circuit_breaker.half_open");
          return true;
        }
        return false;
      }
      return false;
    }
    return false;
  }

  recordSuccess(): void {
    this.halfOpenLock = false;
    if (this.state !== "closed") {
      logger.info("circuit_breaker.closed", { previousFailures: this.failureCount });
    }
    this.failureCount = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.halfOpenLock = false;
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold || this.state === "half-open") {
      this.state = "open";
      logger.warn("circuit_breaker.open", {
        failureCount: this.failureCount,
        resetAfterMs: this.resetTimeoutMs,
      });
    }
  }
}

// ============================================
// STRIPE API CLIENT
// ============================================
export class StripeClient {
  private secretKey: string;
  private baseUrl: string;
  private circuitBreaker: CircuitBreaker;
  private timeoutMs: number;

  constructor(secretKey: string, timeoutMs?: number) {
    this.secretKey = secretKey;
    this.baseUrl = STRIPE_BASE_URL;
    this.timeoutMs = timeoutMs || DEFAULT_TIMEOUT_MS;
    this.circuitBreaker = new CircuitBreaker();
  }

  // === Core request ===
  async request<T = unknown>(
    endpoint: string,
    options: {
      method?: string;
      params?: Record<string, string | number | boolean | undefined | null>;
      body?: Record<string, string | number | boolean | undefined | null>;
    } = {}
  ): Promise<T> {
    if (!this.circuitBreaker.canExecute()) {
      throw new Error("Circuit breaker is open — Stripe API unavailable. Retry in 60 seconds.");
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const method = options.method || (options.body ? "POST" : "GET");

        // Build URL with query params for GET requests
        let url = `${this.baseUrl}${endpoint}`;
        if (options.params && Object.keys(options.params).length > 0) {
          const queryParams = new URLSearchParams();
          for (const [key, value] of Object.entries(options.params)) {
            if (value !== undefined && value !== null) {
              queryParams.set(key, String(value));
            }
          }
          url += `?${queryParams}`;
        }

        // Build form-encoded body for POST/DELETE requests
        // CRITICAL: Stripe uses application/x-www-form-urlencoded, NOT JSON
        let formBody: string | undefined;
        if (options.body) {
          formBody = this.toFormEncoded(options.body);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        const requestId = logger.requestId();
        const start = performance.now();

        logger.debug("api_request.start", {
          requestId,
          method,
          endpoint,
          attempt: attempt + 1,
        });

        try {
          const headers: Record<string, string> = {
            "Authorization": `Bearer ${this.secretKey}`,
            "Accept": "application/json",
            "Stripe-Version": "2024-06-20",
          };

          if (formBody !== undefined) {
            headers["Content-Type"] = "application/x-www-form-urlencoded";
          }

          const response = await fetch(url, {
            method,
            signal: controller.signal,
            headers,
            ...(formBody !== undefined ? { body: formBody } : {}),
          });

          const durationMs = Math.round(performance.now() - start);

          if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get("Retry-After") || "5", 10);
            logger.warn("api_request.rate_limited", { requestId, retryAfter, endpoint });
            await this.delay(retryAfter * 1000);
            continue;
          }

          if (response.status >= 500) {
            this.circuitBreaker.recordFailure();
            lastError = new Error(`Stripe server error: ${response.status} ${response.statusText}`);
            logger.warn("api_request.server_error", {
              requestId, durationMs, status: response.status, endpoint, attempt: attempt + 1,
            });
            const baseDelay = RETRY_BASE_DELAY * Math.pow(2, attempt);
            await this.delay(baseDelay + Math.random() * baseDelay * 0.5);
            continue;
          }

          if (!response.ok) {
            const errorBody = await response.json() as { error?: { message?: string; code?: string; type?: string } };
            const errorMsg = errorBody.error?.message || `HTTP ${response.status}`;
            logger.error("api_request.client_error", {
              requestId, durationMs, status: response.status, endpoint,
              stripeError: errorBody.error?.type,
              stripeCode: errorBody.error?.code,
            });
            throw new Error(`Stripe API error: ${errorMsg} (${errorBody.error?.code || response.status})`);
          }

          this.circuitBreaker.recordSuccess();
          logger.debug("api_request.done", { requestId, durationMs, status: response.status, endpoint });

          return await response.json() as T;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          this.circuitBreaker.recordFailure();
          lastError = new Error(`Request timeout after ${this.timeoutMs}ms: ${endpoint}`);
          logger.error("api_request.timeout", { endpoint, timeoutMs: this.timeoutMs });
          continue;
        }
        if (error instanceof Error && !error.message.includes("server error")) {
          throw error; // Don't retry client errors
        }
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError || new Error("Request failed after retries");
  }

  // === GET ===
  async get<T>(endpoint: string, params?: Record<string, string | number | boolean | undefined | null>): Promise<T> {
    return this.request<T>(endpoint, { method: "GET", params });
  }

  // === POST (form-encoded) ===
  async post<T>(endpoint: string, body?: Record<string, string | number | boolean | undefined | null>): Promise<T> {
    return this.request<T>(endpoint, { method: "POST", body });
  }

  // === DELETE ===
  async delete<T>(endpoint: string, body?: Record<string, string | number | boolean | undefined | null>): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE", body });
  }

  // === Keyset pagination (Stripe-style: starting_after=obj_xxx, has_more) ===
  // Returns first page; caller passes starting_after from last item's ID for subsequent pages
  async list<T>(
    endpoint: string,
    params: Record<string, string | number | boolean | undefined | null> = {}
  ): Promise<StripeList<T>> {
    return this.request<StripeList<T>>(endpoint, { method: "GET", params });
  }

  // === Health check ===
  async healthCheck(): Promise<{
    reachable: boolean;
    authenticated: boolean;
    latencyMs: number;
    accountId?: string;
    livemode?: boolean;
    error?: string;
  }> {
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(`${this.baseUrl}/account`, {
          signal: controller.signal,
          headers: {
            "Authorization": `Bearer ${this.secretKey}`,
            "Accept": "application/json",
            "Stripe-Version": "2024-06-20",
          },
        });
        const latencyMs = Math.round(performance.now() - start);
        if (response.ok) {
          const body = await response.json() as { id?: string; charges_enabled?: boolean; livemode?: boolean };
          return {
            reachable: true,
            authenticated: true,
            latencyMs,
            accountId: body.id,
            livemode: body.livemode,
          };
        }
        return {
          reachable: true,
          authenticated: response.status !== 401 && response.status !== 403,
          latencyMs,
          error: `Status ${response.status}`,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      return {
        reachable: false,
        authenticated: false,
        latencyMs: Math.round(performance.now() - start),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // === Convert object to application/x-www-form-urlencoded ===
  // Handles nested objects (e.g. metadata[key]=value) and arrays (items[0][price]=xxx)
  private toFormEncoded(
    obj: Record<string, unknown>,
    prefix?: string
  ): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) continue;

      const fullKey = prefix ? `${prefix}[${key}]` : key;

      if (typeof value === "object" && !Array.isArray(value)) {
        parts.push(this.toFormEncoded(value as Record<string, unknown>, fullKey));
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (typeof item === "object" && item !== null) {
            parts.push(this.toFormEncoded(item as Record<string, unknown>, `${fullKey}[${i}]`));
          } else {
            parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(String(item))}`);
          }
        }
      } else {
        parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
      }
    }

    return parts.join("&");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
