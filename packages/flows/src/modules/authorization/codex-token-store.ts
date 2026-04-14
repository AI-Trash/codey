import fs from "fs";
import path from "path";
import { getRuntimeConfig } from "../../config";
import { ensureDir, writeFileAtomic } from "../../utils/fs";
import type { CodexTokenResponse } from "./codex-client";

function getStorePath(): string {
  const config = getRuntimeConfig();
  return path.join(config.rootDir, ".codey", "credentials", "codex-oauth.json");
}

export function saveCodexToken(token: CodexTokenResponse): string {
  const storePath = getStorePath();
  ensureDir(path.dirname(storePath));
  writeFileAtomic(storePath, `${JSON.stringify(token, null, 2)}\n`);
  return storePath;
}

export function readCodexToken(): CodexTokenResponse {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    throw new Error(
      "No stored Codex OAuth token found. Run `codey auth codex-login` first.",
    );
  }
  return JSON.parse(fs.readFileSync(storePath, "utf8")) as CodexTokenResponse;
}

export function clearCodexToken(): void {
  const storePath = getStorePath();
  if (fs.existsSync(storePath)) {
    fs.rmSync(storePath);
  }
}
