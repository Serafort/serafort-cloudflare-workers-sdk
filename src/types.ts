import type { UserContext, SerafortClient } from '@serafort/core';

export interface SerafortWorkersOptions {
  /** Serafort IAM backend endpoint */
  endpoint: string;
  /** Name of the session cookie. Default: '__serafort_token' */
  cookieName?: string;
  /** Routes exempt from authentication checks (e.g. ['/api/public/*', '/health', '/login']) */
  publicRoutes?: string[];
  /** Default redirect URL when unauthenticated. If not provided, returns JSON 401 */
  loginUrl?: string;
  /** Header containing requested tenant ID. Default: 'X-Tenant-ID' */
  tenantHeader?: string;
  /** Extract tenant from first subdomain of host (e.g. 'acme.example.com' -> 'acme') */
  tenantSubdomain?: boolean;
  /** Optional Cloudflare KV Namespace for token/key caching */
  kvNamespace?: any;
  /** Pre-configured SerafortClient instance */
  client?: SerafortClient;
}

export interface WorkerAuthContext {
  user: UserContext | null;
  token: string | null;
  isAuthenticated: boolean;
  tenantId: string | null;
}

export interface WorkerProtectOptions {
  /** Required roles */
  roles?: string[];
  /** Required permissions (supports wildcards e.g. 'org:*') */
  permissions?: string[];
  /** Target tenant ID requirement */
  tenantId?: string;
  /** Optional redirect URL when unauthorized */
  redirectTo?: string;
}

export type AuthenticatedWorkerHandler<Env = unknown> = (
  request: Request,
  env: Env,
  ctx: any,
  auth: WorkerAuthContext
) => Promise<Response> | Response;
