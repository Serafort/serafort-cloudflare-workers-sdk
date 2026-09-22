# @serafort/cloudflare-workers

Enterprise IAM, Edge Tenant Routing, KV Token Caching, and Web Crypto JWT validation for Cloudflare Workers.

## Features

- ⚡ **Zero-Dependency Web Crypto**: Local JWKS token validation in microseconds at the Cloudflare Edge using standard Web APIs.
- 🏢 **Edge Tenant Routing**: Subdomain (`tenant.example.com`) and header (`X-Tenant-ID`) resolution with cross-tenant boundary verification before reaching origin servers.
- 🛡️ **Edge Middleware Wrapper**: `withSerafortAuth(handler, protectOptions, config)` with wildcard RBAC (`org:*`), route exemptions, and automated 302 redirects or 401 JSON responses.
- 🗄️ **Cloudflare KV Caching**: `KVCacheAdapter` for fast caching of M2M tokens across globally distributed edge datacenters.
- 🔀 **Header Decoration**: Injects `x-serafort-user-id`, `x-serafort-tenant-id`, and `x-serafort-roles` headers for origin microservices.

## Installation

```bash
npm install @serafort/cloudflare-workers @serafort/core
```

## Quick Start

```typescript
// src/index.ts
import { withSerafortAuth, type WorkerAuthContext } from '@serafort/cloudflare-workers';

interface Env {
  SERAFORT_ENDPOINT: string;
}

export default {
  fetch: withSerafortAuth<Env>(
    async (request, env, ctx, auth: WorkerAuthContext) => {
      return new Response(JSON.stringify({
        message: 'Hello from Cloudflare Edge!',
        userId: auth.user?.userId,
        tenantId: auth.tenantId,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
    {
      roles: ['admin'],
      permissions: ['org:*'],
    },
    {
      endpoint: 'https://api.serafort.com',
      publicRoutes: ['/health', '/api/public/*'],
      tenantSubdomain: true,
      loginUrl: 'https://app.serafort.com/login',
    }
  ),
};
```
