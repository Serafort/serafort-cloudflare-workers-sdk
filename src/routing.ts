export interface TenantResolutionOptions {
  tenantHeader?: string;
  tenantSubdomain?: boolean;
}

/**
 * Resolves the target tenant from the incoming Cloudflare Worker Request.
 * Inspects headers (e.g. X-Tenant-ID) and optional subdomains.
 */
export function resolveTenant(
  request: Request,
  options: TenantResolutionOptions = {}
): string | null {
  const headerKey = options.tenantHeader || 'X-Tenant-ID';

  // 1. Check Header
  const headerValue = request.headers.get(headerKey) || request.headers.get(headerKey.toLowerCase());
  if (headerValue && headerValue.trim().length > 0) {
    return headerValue.trim();
  }

  // 2. Check Subdomain (e.g. acme.myplatform.com -> 'acme')
  if (options.tenantSubdomain) {
    try {
      const url = new URL(request.url);
      const hostname = url.hostname;
      const parts = hostname.split('.');

      // Only extract if there is a distinct subdomain and not an IP or localhost
      if (parts.length >= 3 && !hostname.match(/^(\d+\.){3}\d+$/)) {
        const sub = parts[0];
        if (sub && sub !== 'www' && sub !== 'api') {
          return sub;
        }
      }
    } catch {
      // Ignore URL parsing errors
    }
  }

  return null;
}
