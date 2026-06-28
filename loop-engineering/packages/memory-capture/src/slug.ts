export function slugifyTitle(title: string): string {
  const ascii = title
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return ascii || 'memory-case';
}
