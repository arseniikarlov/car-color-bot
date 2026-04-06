import path from "node:path";

import type { CatalogColor } from "../types.js";

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSearchTokens(parts: Array<string | number | null | undefined>): string[] {
  const tokens = new Set<string>();
  for (const part of parts) {
    if (part === null || part === undefined) {
      continue;
    }
    const normalized = normalizeSearchText(String(part));
    if (!normalized) {
      continue;
    }
    tokens.add(normalized);
    for (const piece of normalized.split(" ")) {
      if (piece.length >= 2) {
        tokens.add(piece);
      }
    }
  }
  return [...tokens];
}

export function buildColorId(input: {
  code: string;
  name: string;
  brand?: string;
  series?: string;
  page: number;
}): string {
  const base = [input.brand ?? "", input.series ?? "", input.code, input.name]
    .map((part) =>
      normalizeSearchText(part)
        .replace(/\s+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter(Boolean)
    .join("-");

  return `${base || "color"}-p${input.page}`.slice(0, 64);
}

export function deduplicateColors(items: CatalogColor[]): CatalogColor[] {
  const deduped = new Map<string, CatalogColor>();
  for (const item of items) {
    const key = `${normalizeSearchText(item.code)}::${normalizeSearchText(item.name)}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }
    const merged: CatalogColor = {
      ...existing,
      brand: existing.brand || item.brand,
      series: existing.series || item.series,
      page: Math.min(existing.page, item.page),
      search_tokens: [...new Set([...existing.search_tokens, ...item.search_tokens])]
    };
    const mergedPageImage = existing.page_image || item.page_image;
    if (mergedPageImage) {
      merged.page_image = mergedPageImage;
    }
    deduped.set(key, merged);
  }

  return [...deduped.values()].sort((left, right) => {
    if (left.page !== right.page) {
      return left.page - right.page;
    }
    return left.code.localeCompare(right.code);
  });
}

export function toCatalogColor(input: {
  brand?: string;
  series?: string;
  code: string;
  name: string;
  page: number;
  sourcePdf: string;
  pageImage?: string;
}): CatalogColor {
  const brand = (input.brand ?? "").trim();
  const series = (input.series ?? "").trim();
  const code = input.code.trim();
  const name = input.name.trim();

  const color: CatalogColor = {
    id: buildColorId({ brand, series, code, name, page: input.page }),
    brand,
    series,
    code,
    name,
    page: input.page,
    source_pdf: path.basename(input.sourcePdf),
    search_tokens: buildSearchTokens([brand, series, code, name])
  };

  if (input.pageImage) {
    color.page_image = input.pageImage;
  }

  return color;
}
