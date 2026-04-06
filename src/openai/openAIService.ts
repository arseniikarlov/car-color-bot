import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import OpenAI from "openai";

import type {
  CatalogColor,
  ExtractedVisionCatalog,
  OpenAIImageGateway,
  PhotoValidationResult,
  PreviewResult
} from "../types.js";
import { hexToRgb, normalizeHexColor, normalizeRgbColor } from "../catalog/catalogUtils.js";

export interface OpenAIServiceOptions {
  apiKey: string;
  visionModel: string;
  imageModel: string;
  timeoutMs: number;
}

export class OpenAIService implements OpenAIImageGateway {
  private readonly client: OpenAI;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly visionModel: string;
  private readonly imageModel: string;

  constructor(options: OpenAIServiceOptions) {
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
    this.visionModel = options.visionModel;
    this.imageModel = options.imageModel;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      timeout: options.timeoutMs
    });
  }

  async validateCarPhoto(imagePath: string): Promise<PhotoValidationResult> {
    const dataUrl = await fileToDataUrl(imagePath);
    const completion = await this.client.chat.completions.create({
      model: this.visionModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You validate user photos for a car repaint preview bot. Respond with JSON only: " +
            '{"is_valid":boolean,"reason":string,"view":string,"issues":string[]}. ' +
            "A valid photo must contain one car, visible body panels, acceptable lighting, and minimal occlusion."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Validate this car photo. Reject if there are multiple cars, too little body visible, very dark lighting, heavy blur, or strong occlusion."
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl
              }
            }
          ]
        }
      ]
    });

    const parsed = safeJsonParse<PhotoValidationResult>(completion.choices[0]?.message?.content);
    if (!parsed) {
      throw new Error("OpenAI validation returned invalid JSON");
    }

    return {
      is_valid: Boolean(parsed.is_valid),
      reason: parsed.reason?.trim() || "Unable to validate the image",
      view: parsed.view?.trim() || "unknown",
      issues: Array.isArray(parsed.issues) ? parsed.issues.map((item) => String(item)) : []
    };
  }

  async generatePreview(imagePath: string, color: CatalogColor): Promise<PreviewResult> {
    const swatchHex = normalizeHexColor(color.swatch_hex);
    const swatchRgb = normalizeRgbColor(color.swatch_rgb) ?? hexToRgb(swatchHex);
    const swatchHint =
      swatchHex || swatchRgb
        ? `Target paint shade from the catalog swatch: ${formatSwatchHint(swatchHex, swatchRgb)}. Match this tone closely while preserving natural reflections and lighting.`
        : null;

    const prompt = [
      "Task: change only the paint color of the same car in this exact photo.",
      `Target color: catalog code ${color.code}, name ${color.name}.`,
      ...(swatchHint ? [swatchHint] : []),
      "Strict rules:",
      "- Recolor only painted exterior body panels.",
      "- Do NOT modify camera angle, framing, perspective, or composition.",
      "- Do NOT modify background, road, sky, people, buildings, or any non-car objects.",
      "- Do NOT modify wheels, tires, windows, mirrors, lights, grille, badges, plate, trim, shadows, reflections, or body geometry.",
      "- Keep realism and original texture; only hue/saturation/value of body paint may change.",
      "If uncertain, preserve original pixels and avoid any non-color edits."
    ].join(" ");

    const response = isGptImageModel(this.imageModel)
      ? await this.editImageViaJsonEndpoint(imagePath, prompt)
      : await this.client.images.edit({
          model: this.imageModel,
          image: createReadStream(imagePath) as any,
          prompt,
          size: "1024x1024"
        } as any);

    const base64 = response.data?.[0]?.b64_json;
    if (!base64) {
      throw new Error("OpenAI image edit returned an empty result");
    }

    const outputPath = path.join(path.dirname(imagePath), `preview-${Date.now()}.png`);
    await writeFile(outputPath, Buffer.from(base64, "base64"));

    return {
      output_image_path: outputPath,
      prompt_version: "v2-color-only",
      model: this.imageModel
    };
  }

  private async editImageViaJsonEndpoint(imagePath: string, prompt: string): Promise<{ data?: Array<{ b64_json?: string }> }> {
    const imageDataUrl = await fileToDataUrl(imagePath);
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.imageModel,
        images: [{ image_url: imageDataUrl }],
        prompt,
        size: "1024x1024",
        output_format: "png"
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    const json = (await response.json().catch(() => null)) as
      | { data?: Array<{ b64_json?: string }>; error?: { message?: string } }
      | null;
    if (!response.ok) {
      const errorMessage = json?.error?.message || `OpenAI image edit failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    return json?.data ? { data: json.data } : {};
  }

  async extractCatalogColorsFromImage(imagePath: string): Promise<ExtractedVisionCatalog> {
    const dataUrl = await fileToDataUrl(imagePath);
    const completion = await this.client.chat.completions.create({
      model: this.visionModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract paint catalog entries from a catalog page image. Return JSON only with shape " +
            '{"brand":string,"series":string,"items":[{"code":string,"name":string,"swatch_hex":string,"swatch_rgb":{"r":number,"g":number,"b":number}}]}. ' +
            "For each row, read the corresponding color swatch and provide its closest swatch_hex and swatch_rgb. " +
            "Do not hallucinate codes or names."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Read this catalog page and extract each visible color entry. Infer brand and series from the page heading if possible. " +
                "For each extracted color, estimate the swatch color from the page and return hex/rgb."
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl
              }
            }
          ]
        }
      ]
    });

    const parsed = safeJsonParse<ExtractedVisionCatalog>(completion.choices[0]?.message?.content);
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error("OpenAI catalog extraction returned invalid JSON");
    }

    return {
      brand: parsed.brand?.trim() ?? "",
      series: parsed.series?.trim() ?? "",
      items: parsed.items.map((item) => {
        const swatchHex = normalizeHexColor(item.swatch_hex);
        const swatchRgb = normalizeRgbColor(item.swatch_rgb);
        return {
          code: String(item.code ?? "").trim(),
          name: String(item.name ?? "").trim(),
          ...(swatchHex ? { swatch_hex: swatchHex } : {}),
          ...(swatchRgb ? { swatch_rgb: swatchRgb } : {})
        };
      })
    };
  }
}

function formatSwatchHint(
  swatchHex: string | null,
  swatchRgb: { r: number; g: number; b: number } | null
): string {
  const rgbText = swatchRgb ? `RGB(${swatchRgb.r}, ${swatchRgb.g}, ${swatchRgb.b})` : null;
  if (swatchHex && rgbText) {
    return `${swatchHex}, ${rgbText}`;
  }
  if (swatchHex) {
    return swatchHex;
  }
  if (rgbText) {
    return rgbText;
  }
  return "unknown";
}

function isGptImageModel(model: string): boolean {
  return model.startsWith("gpt-image-") || model === "chatgpt-image-latest";
}

async function fileToDataUrl(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function safeJsonParse<T>(content: string | null | undefined): T | null {
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
