import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveTenant } from '../src/routing.js';
import { extractToken, isPublicRoute, withSerafortAuth, createEdgeAuth } from '../src/middleware.js';
import { KVCacheAdapter } from '../src/kv-cache.js';
import { SerafortClient, type UserContext } from '@serafort/core';

describe('@serafort/cloudflare-workers Edge Suite', () => {
  const mockUser: UserContext = {
    userId: 'usr_cf_123',
    tenantId: 'tenant_cf',
    roles: ['admin', 'operator'],
    permissions: ['org:*', 'workers:deploy'],
  };

  let mockClient: SerafortClient;

  beforeEach(() => {
    mockClient = new SerafortClient({ endpoint: 'https://api.test.serafort.com' });
    vi.spyOn(mockClient.b2b, 'validateToken').mockImplementation(async (token: string) => {
      if (token === 'valid_worker_token') {
        return mockUser;
      }
      throw new Error('Invalid token');
    });
  });

  describe('resolveTenant', () => {
    it('extracts tenant from header', () => {
      const req = new Request('https://api.example.com/data', {
        headers: { 'X-Tenant-ID': 'tenant_alpha' },
      });
      expect(resolveTenant(req)).toBe('tenant_alpha');
    });

    it('extracts tenant from subdomain when enabled', () => {
      const req = new Request('https://beta.platform.com/data');
      expect(resolveTenant(req, { tenantSubdomain: true })).toBe('beta');
    });

    it('returns null when no tenant present', () => {
      const req = new Request('https://example.com/data');
      expect(resolveTenant(req, { tenantSubdomain: true })).toBeNull();
    });
  });

  describe('extractToken & isPublicRoute', () => {
    it('extracts token from Authorization header', () => {
      const req = new Request('https://example.com', {
        headers: { Authorization: 'Bearer my_token_123' },
      });
      expect(extractToken(req)).toBe('my_token_123');
    });

    it('extracts token from cookie', () => {
      const req = new Request('https://example.com', {
        headers: { Cookie: 'foo=bar; __serafort_token=cookie_tok; other=val' },
      });
      expect(extractToken(req)).toBe('cookie_tok');
    });

    it('identifies public route patterns', () => {
      const publicRoutes = ['/api/public/*', '/health', '/login'];
      expect(isPublicRoute('/health', publicRoutes)).toBe(true);
      expect(isPublicRoute('/api/public/config', publicRoutes)).toBe(true);
      expect(isPublicRoute('/api/private/secret', publicRoutes)).toBe(false);
    });
  });

  describe('withSerafortAuth middleware', () => {
    it('allows public routes to bypass authentication', async () => {
      const handler = vi.fn().mockResolvedValue(new Response('OK'));
      const worker = withSerafortAuth(handler, {}, {
        endpoint: 'https://api.test.serafort.com',
        publicRoutes: ['/public/*'],
        client: mockClient,
      });

      const req = new Request('https://example.com/public/status');
      const res = await worker(req, {}, {});
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalled();
    });

    it('rejects unauthenticated requests with 401 JSON', async () => {
      const handler = vi.fn();
      const worker = withSerafortAuth(handler, {}, {
        endpoint: 'https://api.test.serafort.com',
        client: mockClient,
      });

      const req = new Request('https://example.com/secure');
      const res = await worker(req, {}, {});
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
      expect(handler).not.toHaveBeenCalled();
    });

    it('redirects unauthenticated requests if loginUrl is configured', async () => {
      const handler = vi.fn();
      const worker = withSerafortAuth(handler, {}, {
        endpoint: 'https://api.test.serafort.com',
        loginUrl: 'https://auth.example.com/login',
        client: mockClient,
      });

      const req = new Request('https://example.com/secure/dashboard?tab=analytics');
      const res = await worker(req, {}, {});
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe(
        'https://auth.example.com/login?returnUrl=%2Fsecure%2Fdashboard%3Ftab%3Danalytics'
      );
    });

    it('authenticates valid tokens and enriches downstream headers with wildcard RBAC', async () => {
      let capturedRequest: Request | null = null;
      let capturedAuth: any = null;

      const handler = vi.fn().mockImplementation((req, env, ctx, auth) => {
        capturedRequest = req;
        capturedAuth = auth;
        return new Response('Edge Success');
      });

      const worker = withSerafortAuth(
        handler,
        {
          tenantId: 'tenant_cf',
          roles: ['admin'],
          permissions: ['workers:deploy', 'org:read'],
        },
        {
          endpoint: 'https://api.test.serafort.com',
          client: mockClient,
        }
      );

      const req = new Request('https://example.com/deploy', {
        headers: { Authorization: 'Bearer valid_worker_token' },
      });

      const res = await worker(req, {}, {});
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('Edge Success');

      expect(capturedAuth?.user?.userId).toBe('usr_cf_123');
      expect(capturedRequest?.headers.get('x-serafort-user-id')).toBe('usr_cf_123');
      expect(capturedRequest?.headers.get('x-serafort-tenant-id')).toBe('tenant_cf');
      expect(capturedRequest?.headers.get('x-serafort-roles')).toBe('admin,operator');
    });
  });

  describe('KVCacheAdapter', () => {
    it('stores, retrieves, and deletes token in KV namespace', async () => {
      const store = new Map<string, string>();
      const mockKV = {
        async get(k: string) { return store.get(k) || null; },
        async put(k: string, v: string) { store.set(k, v); },
        async delete(k: string) { store.delete(k); },
      };

      const kv = new KVCacheAdapter(mockKV);
      await kv.setToken('m2m_key', 'token_val', 3600);
      expect(await kv.getToken('m2m_key')).toBe('token_val');

      await kv.removeToken('m2m_key');
      expect(await kv.getToken('m2m_key')).toBeNull();
    });
  });
});
