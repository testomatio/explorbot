export function deepMerge(target: any, source: any): any {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key].constructor === Object) {
      result[key] = deepMerge(result[key] || {}, source[key]);
      continue;
    }
    result[key] = source[key];
  }

  return result;
}
