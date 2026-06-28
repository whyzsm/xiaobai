import { MemoryContextItem, OmittedMemoryContextItem } from './bundle';

export function fitContextBudget(items: MemoryContextItem[], maxCharacters: number): {
  included: MemoryContextItem[];
  omitted: OmittedMemoryContextItem[];
  usedCharacters: number;
} {
  const included: MemoryContextItem[] = [];
  const omitted: OmittedMemoryContextItem[] = [];
  let usedCharacters = 0;

  for (const item of [...items].sort((a, b) => b.priority - a.priority)) {
    if (usedCharacters + item.characters <= maxCharacters) {
      included.push(item);
      usedCharacters += item.characters;
    } else {
      omitted.push({
        path: item.path,
        title: item.title,
        reason: 'character-budget',
        characters: item.characters
      });
    }
  }

  return { included, omitted, usedCharacters };
}
