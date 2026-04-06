import path from "node:path";

import { loadImportConfig } from "../config.js";
import { importCatalog, createDefaultCatalogImporter } from "../catalog/importCatalog.js";
import { OpenAIService } from "../openai/openAIService.js";

async function main(): Promise<void> {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    throw new Error("Usage: npm run import-catalog -- /absolute/path/to/colors.pdf");
  }

  const config = loadImportConfig(process.cwd());
  const openai = config.openaiApiKey
    ? new OpenAIService({
        apiKey: config.openaiApiKey,
        visionModel: config.openaiVisionModel,
        imageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1",
        timeoutMs: 90_000
      })
    : null;

  const result = await importCatalog(path.resolve(pdfPath), config.catalogPath, createDefaultCatalogImporter(openai));
  console.log(
    JSON.stringify(
      {
        source_pdf: result.source_pdf,
        generated_at: result.generated_at,
        imported_colors: result.items.length,
        warnings: result.warnings
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
