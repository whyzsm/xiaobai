export interface MemoryContextItem {
  path: string;
  title: string;
  kind: string;
  priority: number;
  characters: number;
  content: string;
}

export interface OmittedMemoryContextItem {
  path: string;
  title: string;
  reason: string;
  characters: number;
}

export interface MemoryContextBundle {
  projectId: string;
  loopId?: string;
  maxCharacters: number;
  usedCharacters: number;
  included: MemoryContextItem[];
  omitted: OmittedMemoryContextItem[];
  warnings: string[];
  content: string;
}
