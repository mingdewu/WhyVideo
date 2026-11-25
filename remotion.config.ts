import fs from "node:fs";
import path from "node:path";
import { webpack } from "@remotion/bundler";
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
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(85);
Config.setConcurrency(4);
Config.setHardwareAcceleration("if-possible");
Config.setChromiumOpenGlRenderer("angle");
Config.setX264Preset("veryfast");
Config.setOffthreadVideoCacheSizeInBytes(1024 * 1024 * 1024);
if (selectedId) {
  const outputDir = path.join(projectsRoot, selectedId, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  Config.setOutputLocation(path.join(outputDir, `${selectedId}.mp4`));

  const studioOutLocationPath = path.join(
    rootDir,
    "packages",
    "video-template",
    "src",
    "studio-out-location.cjs",
  );
  Config.overrideWebpackConfig((currentConfiguration) => ({
    ...currentConfiguration,
    plugins: [
      ...(currentConfiguration.plugins ?? []),
      new webpack.DefinePlugin({
        "process.env.WHYVIDEO_STUDIO_PROJECT_ID": JSON.stringify(selectedId),
      }),
      new webpack.NormalModuleReplacementPlugin(
        /get-default-out-name(\.js)?$/,
        (resource) => {
          if (
            resource.context &&
            /[/\\]@remotion[/\\]studio-shared([/\\]|$)/.test(resource.context)
          ) {
            resource.request = studioOutLocationPath;
          }
        },
      ),
    ],
  }));
}
