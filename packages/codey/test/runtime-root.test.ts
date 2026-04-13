import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";

import { resolveConfig } from "../src/config";
import { loadWorkspaceEnv } from "../src/utils/env";
import { resolveWorkspaceRoot } from "../src/utils/workspace-root";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const packageRoot = path.resolve(import.meta.dirname, "..");

function withTempDir<T>(run: (dir: string) => T): T {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codey-workspace-"));
  try {
    return run(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function withChdir<T>(directory: string, run: () => T): T {
  const previous = process.cwd();
  process.chdir(directory);
  try {
    return run();
  } finally {
    process.chdir(previous);
  }
}

test("resolveConfig keeps workspace root semantics", () => {
  withChdir(packageRoot, () => {
    const config = resolveConfig();
    assert.equal(config.rootDir, workspaceRoot);
    assert.equal(config.artifactsDir, path.join(workspaceRoot, "artifacts"));
  });
});

test("resolveConfig resolves relative config paths from workspace root", () => {
  withTempDir((tempDir) => {
    const configPath = path.join(tempDir, "sample-config.json");
    fs.writeFileSync(configPath, JSON.stringify({ browser: { headless: true } }), "utf8");

    const workspaceRelative = path.relative(workspaceRoot, configPath);

    withChdir(packageRoot, () => {
      const config = resolveConfig({ configFile: workspaceRelative });
      assert.equal(config.browser.headless, true);
    });
  });
});

test("loadWorkspaceEnv reads the workspace root .env", () => {
  const envPath = path.join(workspaceRoot, ".env");
  const originalExists = fs.existsSync(envPath);
  const originalContent = originalExists ? fs.readFileSync(envPath, "utf8") : undefined;
  const previousValue = process.env.CODEY_TEST_ENV_SENTINEL;

  try {
    fs.writeFileSync(envPath, "CODEY_TEST_ENV_SENTINEL=workspace-root\n", "utf8");
    delete process.env.CODEY_TEST_ENV_SENTINEL;

    withChdir(packageRoot, () => {
      loadWorkspaceEnv();
    });

    assert.equal(process.env.CODEY_TEST_ENV_SENTINEL, "workspace-root");
  } finally {
    if (originalExists && originalContent != null) {
      fs.writeFileSync(envPath, originalContent, "utf8");
    } else {
      fs.rmSync(envPath, { force: true });
    }

    if (previousValue == null) {
      delete process.env.CODEY_TEST_ENV_SENTINEL;
    } else {
      process.env.CODEY_TEST_ENV_SENTINEL = previousValue;
    }
  }
});

test("resolveWorkspaceRoot falls back to cwd outside a workspace", () => {
  withTempDir((tempDir) => {
    const simulatedBundlePath = path.join(tempDir, "dist", "index.js");

    withChdir(tempDir, () => {
      assert.equal(resolveWorkspaceRoot(simulatedBundlePath), tempDir);
    });
  });
});
