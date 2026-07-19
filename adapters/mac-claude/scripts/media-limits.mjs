import limits from "../contracts/media-limits.json" with { type: "json" };

if (limits.contract !== "cc-theme.media-limits" || limits.revision !== 1) {
  throw new Error("Unsupported CC Theme media limits contract");
}

export const MAX_IMAGE_BYTES = limits.imageBytes;
export const MAX_DIRECTIONAL_ATLAS_BYTES = limits.directionalAtlasBytes;
export const MAX_DIRECTIONAL_ATLAS_PIXELS = limits.directionalAtlasPixels;
export const MAX_DIRECTIONAL_ATLAS_DIMENSION = limits.directionalAtlasDimension;
export const MAX_STANDARD_VIDEO_BYTES = limits.standardVideoBytes;
export const MAX_VIDEO_BYTES = limits.largeVideoBytes;
export const MAX_INLINE_VIDEO_BYTES = limits.inlineVideoBytes;
export const MAX_TOTAL_MEDIA_BYTES = limits.totalThemeMediaBytes;
export const MAX_PACKAGE_BYTES = limits.packageBytes;
export const MAX_PACKAGE_ENTRIES = limits.maxEntries;
export const LARGE_VIDEO_WARNING_BYTES = limits.largeVideoWarningBytes;

export default Object.freeze({ ...limits });
