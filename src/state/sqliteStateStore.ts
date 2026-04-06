import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { BotSession } from "../types.js";
import { defaultSession } from "./stateMachine.js";

export interface StateStore {
  getSession(telegramUserId: number): BotSession;
  saveSession(session: BotSession): void;
  close(): void;
}

export class SQLiteStateStore implements StateStore {
  private readonly db: InstanceType<typeof Database>;

  constructor(sqlitePath: string) {
    mkdirSync(path.dirname(sqlitePath), { recursive: true });
    this.db = new Database(sqlitePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bot_sessions (
        telegram_user_id INTEGER PRIMARY KEY,
        state TEXT NOT NULL,
        selected_color_id TEXT,
        last_photo_file_id TEXT,
        job_status TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }

  getSession(telegramUserId: number): BotSession {
    const statement = this.db.prepare(`
      SELECT telegram_user_id, state, selected_color_id, last_photo_file_id, job_status, updated_at
      FROM bot_sessions
      WHERE telegram_user_id = ?
    `);

    const row = statement.get(telegramUserId) as BotSession | undefined;
    if (row) {
      return row;
    }

    const session = defaultSession(telegramUserId);
    this.saveSession(session);
    return session;
  }

  saveSession(session: BotSession): void {
    const statement = this.db.prepare(`
      INSERT INTO bot_sessions (
        telegram_user_id,
        state,
        selected_color_id,
        last_photo_file_id,
        job_status,
        updated_at
      ) VALUES (
        @telegram_user_id,
        @state,
        @selected_color_id,
        @last_photo_file_id,
        @job_status,
        @updated_at
      )
      ON CONFLICT (telegram_user_id) DO UPDATE SET
        state = excluded.state,
        selected_color_id = excluded.selected_color_id,
        last_photo_file_id = excluded.last_photo_file_id,
        job_status = excluded.job_status,
        updated_at = excluded.updated_at
    `);

    statement.run(session);
  }

  close(): void {
    this.db.close();
  }
}
