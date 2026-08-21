/**
 * The crest scales that exist on disk.
 *
 * Shared because scripts/mirror-crests.mjs WRITES these files and
 * src/render/primitives.js READS them by appending the size to the path. Two
 * private copies meant changing one would 404 every crest into a monogram with
 * nothing failing loudly.
 */
export const CREST_SIZES = Object.freeze([96, 320])
