import { readFile } from "node:fs/promises";

import type { CatalogColor, CatalogFile } from "../types.js";
import { deduplicateColors } from "./catalogUtils.js";

export async function loadCatalog(catalogPath: string): Promise<CatalogFile> {
  const raw = await readFile(catalogPath, "utf8");
  const parsed = JSON.parse(raw) as CatalogFile;

  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error(`Invalid catalog file: ${catalogPath}`);
  }

  return {
    source_pdf: parsed.source_pdf ?? "",
    generated_at: parsed.generated_at ?? "",
    items: deduplicateColors(parsed.items as CatalogColor[])
  };
}
