const MIN_SECRET_LENGTH = 4;
const secretValues = new Set<string>();

export function registerSecret(value: string): void {
  if (!value) return;
  if (value.length < MIN_SECRET_LENGTH) return;
  secretValues.add(value);
}

export function redactSecrets(text: string): string {
  if (!text) return text;
  let result = text;
  for (const value of secretValues) {
    if (!result.includes(value)) continue;
    result = result.split(value).join('***REDACTED***');
  }
  return result;
}

export function clearRegisteredSecrets(): void {
  secretValues.clear();
}

const SECRET_NAME_TOKENS = ['password', 'passwd', 'secret', 'token', 'apikey', 'api_key', 'credential', 'private_key', 'privatekey', 'access_key'];

export function isSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  return SECRET_NAME_TOKENS.some((token) => lower.includes(token));
}
