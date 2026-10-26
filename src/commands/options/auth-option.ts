import { KnowledgeTracker } from '../../knowledge-tracker.js';
import { registerSecret } from '../../utils/secrets.js';
import { BaseOption } from './base-option.js';

export class AuthOption extends BaseOption {
  flags = '--auth <text>';
  description = 'Auth details for this run only, not saved to disk, in free form (e.g. "login: admin password: secret" or "Bearer: <token>"). Falls back to EXPLORBOT_AUTH';

  protected apply(options: Record<string, any>): void {
    const auth = options.auth || process.env.EXPLORBOT_AUTH;
    if (!auth) return;
    registerSecret(auth);
    KnowledgeTracker.appendSessionKnowledge(auth);
  }
}
