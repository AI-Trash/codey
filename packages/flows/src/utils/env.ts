import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveWorkspaceRoot } from "./workspace-root";

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

export function loadWorkspaceEnv(): void {
  const envPath = path.join(resolveWorkspaceRoot(fileURLToPath(import.meta.url)), ".env");
  loadEnvFile(envPath);
}
