export interface CatalogColor {
  id: string;
  brand: string;
  series: string;
  code: string;
  name: string;
  page: number;
  source_pdf: string;
  page_image?: string;
  swatch_hex?: string;
  swatch_rgb?: {
    r: number;
    g: number;
    b: number;
  };
  search_tokens: string[];
}

export interface CatalogFile {
  source_pdf: string;
  generated_at: string;
  items: CatalogColor[];
}

export type SessionState =
  | "idle"
  | "awaiting_search_query"
  | "awaiting_photo"
  | "processing";

export interface BotSession {
  telegram_user_id: number;
  state: SessionState;
  selected_color_id: string | null;
  last_photo_file_id: string | null;
  job_status: string | null;
  updated_at: string;
}

export interface PhotoValidationResult {
  is_valid: boolean;
  reason: string;
  view: string;
  issues: string[];
}

export interface PreviewResult {
  output_image_path: string;
  prompt_version: string;
  model: string;
}

export interface CatalogImportResult {
  source_pdf: string;
  generated_at: string;
  items: CatalogColor[];
  warnings: string[];
}

export interface ExtractedVisionCatalog {
  brand: string;
  series: string;
  items: Array<{
    code: string;
    name: string;
    swatch_hex?: string;
    swatch_rgb?: {
      r: number;
      g: number;
      b: number;
    };
  }>;
}

export interface OpenAIImageGateway {
  validateCarPhoto(imagePath: string): Promise<PhotoValidationResult>;
  generatePreview(imagePath: string, color: CatalogColor): Promise<PreviewResult>;
  extractCatalogColorsFromImage(imagePath: string): Promise<ExtractedVisionCatalog>;
}
