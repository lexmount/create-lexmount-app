export function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function fallbackSummary(
  itemText: string | null | undefined,
  title: string
): string | null {
  const normalizedItem = normalizeText(itemText);
  const normalizedTitle = normalizeText(title);
  if (!normalizedItem) return null;

  const withoutTitle = normalizedItem.startsWith(normalizedTitle)
    ? normalizedItem.slice(normalizedTitle.length)
    : normalizedItem.replace(normalizedTitle, '');
  return normalizeText(withoutTitle) || null;
}
