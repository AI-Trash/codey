import fs from "fs";
import path from "path";
import { getRuntimeConfig } from "../../config";
import { ensureDir, writeFileAtomic } from "../../utils/fs";

export interface StoredAppSession {
  accessToken: string;
  target?: string;
  user?: {
    id: string;
    email?: string | null;
    githubLogin?: string | null;
    name?: string | null;
    role?: "ADMIN" | "USER";
  };
  createdAt: string;
}

function getStorePath(): string {
  const config = getRuntimeConfig();
  return path.join(config.rootDir, ".codey", "credentials", "app-session.json");
}

export function saveAppSession(session: StoredAppSession): string {
  const storePath = getStorePath();
  ensureDir(path.dirname(storePath));
  writeFileAtomic(storePath, `${JSON.stringify(session, null, 2)}\n`);
  return storePath;
}

export function readAppSession(): StoredAppSession {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    throw new Error(
      "No stored app session found. Run `codey auth login` first.",
    );
  }
  return JSON.parse(fs.readFileSync(storePath, "utf8")) as StoredAppSession;
}

export function clearAppSession(): void {
  const storePath = getStorePath();
  if (fs.existsSync(storePath)) {
    fs.rmSync(storePath);
  }
}
