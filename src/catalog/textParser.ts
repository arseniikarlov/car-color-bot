import { deduplicateColors, normalizeSearchText, toCatalogColor } from "./catalogUtils.js";
import type { CatalogColor } from "../types.js";

const CODE_RE = /\b([A-Z0-9]{2,}(?:[-/][A-Z0-9]+)*)\b/u;
const STOPWORDS = new Set([
  "цвет",
  "colors",
  "colour",
  "каталог",
  "палитра",
  "коллекция",
  "paint",
  "series",
  "brand"
]);

export function parseCatalogPageText(pageText: string, pageNumber: number, sourcePdf: string): CatalogColor[] {
  const lines = pageText
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const { brand, series } = guessPageMetadata(lines);
  const colors: CatalogColor[] = [];

  for (const line of lines) {
    const match = line.match(CODE_RE);
    if (!match || !match[1]) {
      continue;
    }

    const code = match[1].trim();
    const name = line.slice(match.index! + match[0].length).replace(/^[-:| ]+/u, "").trim();

    if (!isLikelyColorCode(code) || !isLikelyColorName(name)) {
      continue;
    }

    colors.push(
      toCatalogColor({
        brand,
        series,
        code,
        name,
        page: pageNumber,
        sourcePdf
      })
    );
  }

  return deduplicateColors(colors);
}

function guessPageMetadata(lines: string[]): { brand: string; series: string } {
  const candidates = lines
    .filter((line) => !CODE_RE.test(line))
    .filter((line) => normalizeSearchText(line).split(" ").length <= 6)
    .filter((line) => !STOPWORDS.has(normalizeSearchText(line)))
    .slice(0, 3);

  return {
    brand: candidates[0] ?? "",
    series: candidates[1] ?? ""
  };
}

function isLikelyColorCode(value: string): boolean {
  if (value.length < 2 || value.length > 20) {
    return false;
  }
  const compact = value.replace(/[-/]/gu, "");
  return /[0-9]/u.test(compact) && /^[A-Z0-9-/]+$/u.test(value);
}

function isLikelyColorName(value: string): boolean {
  if (!value || value.length < 2 || value.length > 80) {
    return false;
  }
  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return false;
  }
  if (STOPWORDS.has(normalized)) {
    return false;
  }
  return /[\p{L}]/u.test(value);
}
