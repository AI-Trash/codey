import crypto from "crypto";
import fs from "fs";
import path from "path";

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function writeFileAtomic(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tempFilePath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );

  fs.writeFileSync(tempFilePath, content, "utf8");
  fs.renameSync(tempFilePath, filePath);
}
