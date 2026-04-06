import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CatalogColor, CatalogImportResult, ExtractedVisionCatalog, OpenAIImageGateway } from "../types.js";
import { deduplicateColors, hexToRgb, normalizeHexColor, normalizeRgbColor, normalizeSearchText, toCatalogColor } from "./catalogUtils.js";
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

  const pageAssets = await persistCatalogPageAssets(pageImages, outputPath);
  const items: CatalogColor[] = [];

  for (let index = 0; index < Math.max(pageTexts.length, pageImages.length); index += 1) {
    const pageNumber = index + 1;
    const pageText = pageTexts[index] ?? "";
    const pageImagePath = pageImages[index];
    const pageAsset = pageAssets.get(pageNumber);
    let extracted = parseCatalogPageText(pageText, pageNumber, pdfPath);
    extracted = extracted.map((item) => (pageAsset ? { ...item, page_image: pageAsset } : item));

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
              sourcePdf: pdfPath,
              ...(pageAsset ? { pageImage: pageAsset } : {}),
              ...(item.swatch_hex ? { swatchHex: item.swatch_hex } : {}),
              ...(item.swatch_rgb ? { swatchRgb: item.swatch_rgb } : {})
            })
          );

        if (!extracted.length) {
          warnings.push(`Page ${pageNumber}: vision fallback returned no colors.`);
        }
      }
    } else if (deps.openai && pageImagePath) {
      extracted = await enrichWithVisionSwatches(extracted, pageImagePath, deps.openai, pageNumber, warnings);
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

async function persistCatalogPageAssets(pageImages: string[], outputPath: string): Promise<Map<number, string>> {
  const outputDir = path.dirname(outputPath);
  const imagesDirName = "catalog_pages";
  const imagesDirPath = path.join(outputDir, imagesDirName);
  await mkdir(imagesDirPath, { recursive: true });

  const pageAssets = new Map<number, string>();

  for (let index = 0; index < pageImages.length; index += 1) {
    const pageNumber = index + 1;
    const sourceImagePath = pageImages[index];
    if (!sourceImagePath) {
      continue;
    }

    try {
      await access(sourceImagePath);
    } catch {
      continue;
    }

    const fileName = `page-${String(pageNumber).padStart(3, "0")}.png`;
    const targetImagePath = path.join(imagesDirPath, fileName);
    if (path.resolve(sourceImagePath) !== path.resolve(targetImagePath)) {
      await copyFile(sourceImagePath, targetImagePath);
    }

    pageAssets.set(pageNumber, path.posix.join(imagesDirName, fileName));
  }

  return pageAssets;
}

type VisionColorItem = ExtractedVisionCatalog["items"][number];

async function enrichWithVisionSwatches(
  baseColors: CatalogColor[],
  pageImagePath: string,
  openai: OpenAIImageGateway,
  pageNumber: number,
  warnings: string[]
): Promise<CatalogColor[]> {
  try {
    const visionData = await openai.extractCatalogColorsFromImage(pageImagePath);
    const byCode = new Map<string, VisionColorItem[]>();
    const byName = new Map<string, VisionColorItem[]>();

    for (const item of visionData.items) {
      const codeKey = normalizeSearchText(item.code);
      const nameKey = normalizeSearchText(item.name);
      if (codeKey) {
        const bucket = byCode.get(codeKey) ?? [];
        bucket.push(item);
        byCode.set(codeKey, bucket);
      }
      if (nameKey) {
        const bucket = byName.get(nameKey) ?? [];
        bucket.push(item);
        byName.set(nameKey, bucket);
      }
    }

    return baseColors.map((color) => {
      if (color.swatch_hex || color.swatch_rgb) {
        return color;
      }

      const codeKey = normalizeSearchText(color.code);
      const nameKey = normalizeSearchText(color.name);
      const candidate =
        (codeKey ? byCode.get(codeKey)?.[0] : null) ?? (nameKey ? byName.get(nameKey)?.[0] : null);
      if (!candidate) {
        return color;
      }

      const swatchHex = normalizeHexColor(candidate.swatch_hex);
      const swatchRgb = normalizeRgbColor(candidate.swatch_rgb) ?? hexToRgb(swatchHex);
      if (!swatchHex && !swatchRgb) {
        return color;
      }

      const enriched: CatalogColor = { ...color };
      if (swatchHex) {
        enriched.swatch_hex = swatchHex;
      }
      if (swatchRgb) {
        enriched.swatch_rgb = swatchRgb;
      }
      return enriched;
    });
  } catch (error) {
    warnings.push(
      `Page ${pageNumber}: unable to enrich swatch colors from vision. ${error instanceof Error ? error.message : String(error)}`
    );
    return baseColors;
  }
}
