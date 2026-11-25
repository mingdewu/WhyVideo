"use strict";

/**
 * Override Remotion Studio's default `out/{composition}.{ext}` output path so
 * renders initiated from the Studio UI write directly into the active project's
 * own `projects/<projectId>/output/` folder using `<projectId>` as filename.
 */
const getDefaultOutLocation = ({ compositionName, defaultExtension, type }) => {
  const projectId = process.env.WHYVIDEO_STUDIO_PROJECT_ID;
  if (projectId) {
    const isPreview = compositionName === "WhyExplainerMVP";
    const baseName = isPreview ? `${projectId}_preview` : projectId;
    const outDir = `projects/${projectId}/output`;
    return type === "sequence"
      ? `${outDir}/${baseName}`
      : `${outDir}/${baseName}.${defaultExtension}`;
  }
  if (type === "sequence") {
    return `out/${compositionName}`;
  }
  return `out/${compositionName}.${defaultExtension}`;
};

exports.getDefaultOutLocation = getDefaultOutLocation;
