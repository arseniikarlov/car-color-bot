import type { BotSession } from "../types.js";

export function defaultSession(telegramUserId: number): BotSession {
  return {
    telegram_user_id: telegramUserId,
    state: "idle",
    selected_color_id: null,
    last_photo_file_id: null,
    job_status: null,
    updated_at: new Date().toISOString()
  };
}

export function resetSession(session: BotSession): BotSession {
  return {
    ...session,
    state: "idle",
    selected_color_id: null,
    last_photo_file_id: null,
    job_status: null,
    updated_at: new Date().toISOString()
  };
}

export function startSearch(session: BotSession): BotSession {
  return {
    ...session,
    state: "awaiting_search_query",
    job_status: null,
    updated_at: new Date().toISOString()
  };
}

export function selectColor(session: BotSession, colorId: string): BotSession {
  return {
    ...session,
    selected_color_id: colorId,
    state: "awaiting_photo",
    job_status: "awaiting_photo",
    updated_at: new Date().toISOString()
  };
}

export function markProcessing(session: BotSession, fileId: string): BotSession {
  return {
    ...session,
    last_photo_file_id: fileId,
    state: "processing",
    job_status: "processing",
    updated_at: new Date().toISOString()
  };
}

export function markAwaitingPhoto(session: BotSession, fileId?: string): BotSession {
  return {
    ...session,
    last_photo_file_id: fileId ?? session.last_photo_file_id,
    state: "awaiting_photo",
    job_status: "awaiting_photo",
    updated_at: new Date().toISOString()
  };
}

export function markCompleted(session: BotSession, fileId: string): BotSession {
  return {
    ...session,
    last_photo_file_id: fileId,
    state: "awaiting_photo",
    job_status: "completed",
    updated_at: new Date().toISOString()
  };
}

export function markFailed(session: BotSession, fileId?: string): BotSession {
  return {
    ...session,
    last_photo_file_id: fileId ?? session.last_photo_file_id,
    state: "awaiting_photo",
    job_status: "failed",
    updated_at: new Date().toISOString()
  };
}
