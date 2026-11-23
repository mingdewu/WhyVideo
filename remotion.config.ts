import fs from "node:fs";
import path from "node:path";
import { Config } from "@remotion/cli/config";

// Remotion bundles this configuration as CommonJS; avoid importing modules
// that depend on import.meta.url from here.
const rootDir = process.cwd();
const projectsRoot = path.join(rootDir, "projects");
const projectIds = fs.existsSync(projectsRoot)
  ? fs.readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name).sort()
  : [];
const selectedId = process.env.PROJECT_ID || projectIds[0];
if (selectedId && !/^[a-zA-Z0-9_-]+$/.test(selectedId)) {
  throw new Error("工程 ID 只能包含字母、数字、下划线和连字符");
}
Config.setPublicDir(selectedId ? path.join(projectsRoot, selectedId, "public") : path.join(rootDir, "public"));
