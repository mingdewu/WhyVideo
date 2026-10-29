import fs from "node:fs";
import path from "node:path";
import { Config } from "@remotion/cli/config";

function resolveProjectPublicDir(): string {
  const projectsRoot = path.join(process.cwd(), "projects");
  const envProjectId = process.env.PROJECT_ID;
  if (envProjectId) {
    return path.join(projectsRoot, envProjectId, "public");
  }
  if (fs.existsSync(projectsRoot)) {
    const dirs = fs
      .readdirSync(projectsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort();
    if (dirs.length > 0) {
      return path.join(projectsRoot, dirs[0], "public");
    }
  }
  return path.join(process.cwd(), "public");
}

Config.setPublicDir(resolveProjectPublicDir());
