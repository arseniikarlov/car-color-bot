import { execFile } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function renderPdfPagesToImages(pdfPath: string, outputDir?: string): Promise<string[]> {
  const workingDir = outputDir ?? (await mkdtemp(path.join(os.tmpdir(), "catalog-pages-")));
  const prefix = path.join(workingDir, "page");

  try {
    await execFileAsync("pdftoppm", ["-png", pdfPath, prefix]);
  } catch (error) {
    throw new Error(
      `pdftoppm is required to render catalog pages. Install poppler-utils or run the Docker image. ${String(error)}`
    );
  }

  const files = await readdir(workingDir);
  return files
    .filter((file) => file.startsWith("page-") && file.endsWith(".png"))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((file) => path.join(workingDir, file));
}

export async function extractPdfPageTexts(pdfPath: string): Promise<string[]> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
    getDocument(input: string): { promise: Promise<any> };
  };
  const document = await pdfjs.getDocument(pdfPath).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const lineBuffer = new Map<number, string[]>();

    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      const text = item.str?.trim();
      if (!text) {
        continue;
      }
      const y = Math.round(item.transform?.[5] ?? 0);
      const values = lineBuffer.get(y) ?? [];
      values.push(text);
      lineBuffer.set(y, values);
    }

    const pageLines = [...lineBuffer.entries()]
      .sort((left, right) => right[0] - left[0])
      .map(([, values]) => values.join(" ").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    pages.push(pageLines.join("\n"));
  }

  return pages;
}
