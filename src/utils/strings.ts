export function truncateJson(input: any): string {
  if (!input) return '';
  const str = JSON.stringify(input);
  return str.length <= 80 ? str : `${str.slice(0, 77)}...`;
}

export function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}
