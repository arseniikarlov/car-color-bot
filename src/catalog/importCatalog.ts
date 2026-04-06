import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CatalogColor, CatalogImportResult, OpenAIImageGateway } from "../types.js";
import { deduplicateColors, toCatalogColor } from "./catalogUtils.js";
import { extractPdfPageTexts, renderPdfPagesToImages } from "./pdfTools.js";
import { parseCatalogPageText } from "./textParser.js";

export interface CatalogImporterDeps {
  extractTexts(pdfPath: string): Promise<string[]>;
  renderPages(pdfPath: string): Promise<string[]>;
  openai: OpenAIImageGateway | null;
}

export async function importCatalog(
  pdfPath: string,
  outputPath: string,
  deps: CatalogImporterDeps
): Promise<CatalogImportResult> {
  const pageTexts = await deps.extractTexts(pdfPath);
  const warnings: string[] = [];
  let pageImages: string[] = [];

  try {
    pageImages = await deps.renderPages(pdfPath);
  } catch (error) {
    warnings.push(
      `Page rendering unavailable; vision fallback disabled until pdftoppm is installed. ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!pageTexts.length && !pageImages.length) {
    throw new Error("Unable to extract any catalog pages from the provided PDF.");
  }

  const items: CatalogColor[] = [];

  for (let index = 0; index < Math.max(pageTexts.length, pageImages.length); index += 1) {
    const pageNumber = index + 1;
    const pageText = pageTexts[index] ?? "";
    const pageImagePath = pageImages[index];
    let extracted = parseCatalogPageText(pageText, pageNumber, pdfPath);

    if (!extracted.length) {
      if (!deps.openai || !pageImagePath) {
        warnings.push(`Page ${pageNumber}: no text colors extracted and vision fallback unavailable.`);
      } else {
        const visionData = await deps.openai.extractCatalogColorsFromImage(pageImagePath);
        extracted = visionData.items
          .filter((item) => item.code && item.name)
          .map((item) =>
            toCatalogColor({
              brand: visionData.brand,
              series: visionData.series,
              code: item.code,
              name: item.name,
              page: pageNumber,
              sourcePdf: pdfPath
            })
          );

        if (!extracted.length) {
          warnings.push(`Page ${pageNumber}: vision fallback returned no colors.`);
        }
      }
    }

    items.push(...extracted);
  }

  const result: CatalogImportResult = {
    source_pdf: path.basename(pdfPath),
    generated_at: new Date().toISOString(),
    items: deduplicateColors(items),
    warnings
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        source_pdf: result.source_pdf,
        generated_at: result.generated_at,
        items: result.items
      },
      null,
      2
    )
  );

  return result;
}

export function createDefaultCatalogImporter(openai: OpenAIImageGateway | null): CatalogImporterDeps {
  return {
    extractTexts: extractPdfPageTexts,
    renderPages: renderPdfPagesToImages,
    openai
  };
}
