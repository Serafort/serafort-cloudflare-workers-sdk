import { SerafortClient, type UserContext } from '@serafort/core';
import { resolveTenant } from './routing.js';
import type {
  SerafortWorkersOptions,
  WorkerAuthContext,
  WorkerProtectOptions,
  AuthenticatedWorkerHandler,
} from './types.js';

function matchesRoute(path: string, pattern: string): boolean {
  if (pattern === path) return true;
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(prefix + '/');
  }
  return false;
}

export function isPublicRoute(pathname: string, publicRoutes: string[] = []): boolean {
  return publicRoutes.some((route) => matchesRoute(pathname, route));
}

export function extractToken(request: Request, cookieName: string = '__serafort_token'): string | null {
  // 1. Authorization header
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  // 2. Cookie
  const cookieHeader = request.headers.get('Cookie') || request.headers.get('cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith(`${cookieName}=`)) {
        return c.substring(cookieName.length + 1).trim();
      }
    }
  }

  return null;
}

export function createEdgeAuth(options: SerafortWorkersOptions) {
  const client =
    options.client ||
    new SerafortClient({
      endpoint: options.endpoint,
    });

  const cookieName = options.cookieName || '__serafort_token';

  async function authenticate(request: Request): Promise<WorkerAuthContext> {
    const token = extractToken(request, cookieName);
    const resolvedTenant = resolveTenant(request, {
      tenantHeader: options.tenantHeader,
      tenantSubdomain: options.tenantSubdomain,
    });

    if (!token) {
      return {
        user: null,
        token: null,
        isAuthenticated: false,
        tenantId: resolvedTenant,
      };
    }

    try {
      const user = await client.b2b.validateToken(token);
      return {
        user,
        token,
        isAuthenticated: true,
        tenantId: resolvedTenant || user.tenantId,
      };
    } catch {
      return {
        user: null,
        token: null,
        isAuthenticated: false,
        tenantId: resolvedTenant,
      };
    }
  }

  function requireAuthorization(
    auth: WorkerAuthContext,
    protectOptions: WorkerProtectOptions = {}
  ): { authorized: boolean; error?: string; status?: number } {
    if (!auth.isAuthenticated || !auth.user) {
      return { authorized: false, error: 'Authentication required', status: 401 };
    }

    const user = auth.user;

    // Tenant check
    if (protectOptions.tenantId && user.tenantId !== protectOptions.tenantId) {
      return { authorized: false, error: 'Tenant access denied', status: 403 };
    }

    // Role check
    if (protectOptions.roles && protectOptions.roles.length > 0) {
      const hasRole = protectOptions.roles.some((r) => user.roles.includes(r));
      if (!hasRole) {
        return {
          authorized: false,
          error: `Required role missing: ${protectOptions.roles.join(', ')}`,
          status: 403,
        };
      }
    }

    // Permission check with wildcards
    if (protectOptions.permissions && protectOptions.permissions.length > 0) {
      for (const perm of protectOptions.permissions) {
        if (!client.b2b.hasPermission(user, perm)) {
          return {
            authorized: false,
            error: `Required permission missing: ${perm}`,
            status: 403,
          };
        }
      }
    }

    return { authorized: true };
  }

  return {
    client,
    authenticate,
    requireAuthorization,
    resolveTenant: (req: Request) =>
      resolveTenant(req, {
        tenantHeader: options.tenantHeader,
        tenantSubdomain: options.tenantSubdomain,
      }),
  };
}

/**
 * Wraps a Cloudflare Worker fetch handler with Serafort edge authentication and RBAC.
 */
export function withSerafortAuth<Env = unknown>(
  handler: AuthenticatedWorkerHandler<Env>,
  protectOptions: WorkerProtectOptions = {},
  workerOptions: SerafortWorkersOptions
) {
  const edgeAuth = createEdgeAuth(workerOptions);

  return async (request: Request, env: Env, ctx: any): Promise<Response> => {
    const url = new URL(request.url);

    // Bypass public routes
    if (isPublicRoute(url.pathname, workerOptions.publicRoutes)) {
      const emptyAuth: WorkerAuthContext = {
        user: null,
        token: null,
        isAuthenticated: false,
        tenantId: null,
      };
      return handler(request, env, ctx, emptyAuth);
    }

    const auth = await edgeAuth.authenticate(request);
    const authCheck = edgeAuth.requireAuthorization(auth, protectOptions);

    if (!authCheck.authorized) {
      if (workerOptions.loginUrl) {
        const returnUrl = encodeURIComponent(url.pathname + url.search);
        return Response.redirect(`${workerOptions.loginUrl}?returnUrl=${returnUrl}`, 302);
      }
      return Response.json(
        { error: 'Unauthorized', message: authCheck.error },
        { status: authCheck.status || 401 }
      );
    }

    // Enrich request headers for downstream origins
    const enrichedHeaders = new Headers(request.headers);
    if (auth.user) {
      enrichedHeaders.set('x-serafort-user-id', auth.user.userId);
      enrichedHeaders.set('x-serafort-tenant-id', auth.user.tenantId);
      enrichedHeaders.set('x-serafort-roles', auth.user.roles.join(','));
    }

    const enrichedRequest = new Request(request, {
      headers: enrichedHeaders,
    });

    return handler(enrichedRequest, env, ctx, auth);
  };
}
