import { ApiClient as BaseApiClient } from '../../../src/api/api-client.ts';
import type { HookFn } from './config.ts';

export class ApiClient extends BaseApiClient {
  private bootstrapHook?: HookFn;
  private teardownHook?: HookFn;

  constructor(baseEndpoint: string, defaultHeaders: Record<string, string> = {}, hooks?: { bootstrap?: HookFn; teardown?: HookFn }) {
    super(baseEndpoint, defaultHeaders);
    this.bootstrapHook = hooks?.bootstrap;
    this.teardownHook = hooks?.teardown;
  }

  async bootstrap(): Promise<void> {
    if (!this.bootstrapHook) return;
    const ctx = { headers: this.getHeaders(), baseEndpoint: this.getBaseEndpoint() };
    const result = await this.bootstrapHook(ctx);
    if (result && typeof result === 'object') {
      this.setHeaders(result);
    }
  }

  async teardown(): Promise<void> {
    if (!this.teardownHook) return;
    const ctx = { headers: this.getHeaders(), baseEndpoint: this.getBaseEndpoint() };
    await this.teardownHook(ctx);
  }
}
