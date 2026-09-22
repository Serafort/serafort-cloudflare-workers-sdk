export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export class KVCacheAdapter {
  constructor(private readonly kv: KVLike) {}

  async getToken(key: string): Promise<string | null> {
    try {
      return await this.kv.get(`serafort:m2m:${key}`);
    } catch {
      return null;
    }
  }

  async setToken(key: string, token: string, ttlSeconds: number = 3600): Promise<void> {
    try {
      await this.kv.put(`serafort:m2m:${key}`, token, { expirationTtl: ttlSeconds });
    } catch {
      // Gracefully handle KV write failures
    }
  }

  async removeToken(key: string): Promise<void> {
    try {
      await this.kv.delete(`serafort:m2m:${key}`);
    } catch {
      // Gracefully handle KV delete failures
    }
  }
}
