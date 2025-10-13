import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { DEFAULT_MODEL_NAME, MAX_INLINE_FILE_BYTES } from "./types.js";

export interface AppConfig {
  apiKey: string;
  model: string;
  maxInlineFileBytes: number;
}

export function loadConfig(): AppConfig {
  const apiKey = resolveGoogleApiKey();

  const model = process.env.GEMINI_MODEL && process.env.GEMINI_MODEL.trim().length > 0
    ? process.env.GEMINI_MODEL.trim()
    : DEFAULT_MODEL_NAME;

  return {
    apiKey,
    model,
    maxInlineFileBytes: MAX_INLINE_FILE_BYTES
  };
}

function resolveGoogleApiKey(): string {
  const fromEnv = process.env.GOOGLE_API_KEY;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  const fromZshrc = readApiKeyFromZshrc();
  if (fromZshrc) {
    process.env.GOOGLE_API_KEY = fromZshrc;
    return fromZshrc;
  }

  throw new Error(
    "GOOGLE_API_KEY が設定されていないため Gemini Video MCP サーバーに接続できません。環境変数 GOOGLE_API_KEY に Gemini API キーを設定してください。",
  );
}

function readApiKeyFromZshrc(): string | null {
  try {
    const zshrcPath = join(homedir(), ".zshrc");
    if (!existsSync(zshrcPath)) {
      return null;
    }

    const contents = readFileSync(zshrcPath, "utf8");
    const match = contents.match(/^[ \t]*(?:export[ \t]+)?GOOGLE_API_KEY=([^\n\r#]+)/m);
    if (!match) {
      return null;
    }

    const rawValue = match[1].trim();
    if (rawValue.length === 0) {
      return null;
    }

    const unquoted = rawValue.replace(/^['"]/, "").replace(/['"]$/, "");
    return unquoted.trim().length > 0 ? unquoted.trim() : null;
  } catch (error) {
    console.warn("Failed to read GOOGLE_API_KEY from ~/.zshrc:", error);
    return null;
  }
}
