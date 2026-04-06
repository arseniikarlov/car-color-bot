import type { CatalogColor } from "../types.js";
import { normalizeSearchText } from "./catalogUtils.js";

export class CatalogIndex {
  private readonly items: CatalogColor[];
  private readonly itemsById: Map<string, CatalogColor>;
  private readonly pickKeyById: Map<string, string>;
  private readonly itemsByPickKey: Map<string, CatalogColor>;

  constructor(items: CatalogColor[]) {
    this.items = [...items];
    this.itemsById = new Map(items.map((item) => [item.id, item]));
    this.pickKeyById = new Map();
    this.itemsByPickKey = new Map();

    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index]!;
      const key = index.toString(36);
      this.pickKeyById.set(item.id, key);
      this.itemsByPickKey.set(key, item);
    }
  }

  total(): number {
    return this.items.length;
  }

  pageCount(pageSize: number): number {
    return Math.max(1, Math.ceil(this.items.length / pageSize));
  }

  listPage(page: number, pageSize: number): CatalogColor[] {
    const safePage = Math.max(0, page);
    const start = safePage * pageSize;
    return this.items.slice(start, start + pageSize);
  }

  getById(id: string): CatalogColor | null {
    return this.itemsById.get(id) ?? null;
  }

  pickKeyForId(id: string): string | null {
    return this.pickKeyById.get(id) ?? null;
  }

  getByPickKey(key: string): CatalogColor | null {
    return this.itemsByPickKey.get(key) ?? null;
  }

  search(query: string, limit = 10): CatalogColor[] {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
      return [];
    }

    const scored = this.items
      .map((item) => ({
        item,
        score: scoreItem(item, normalizedQuery)
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.page - right.item.page);

    return scored.slice(0, limit).map((entry) => entry.item);
  }
}

function scoreItem(item: CatalogColor, query: string): number {
  let score = 0;
  for (const token of item.search_tokens) {
    if (token === query) {
      score += 100;
    } else if (token.startsWith(query)) {
      score += 60;
    } else if (token.includes(query)) {
      score += 30;
    }
  }
  return score;
}
