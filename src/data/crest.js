/**
 * Club crest upload for manual entry.
 *
 * A club has a badge; the lettered monogram fallback is a stand-in, not a
 * result. Uploaded files are decoded, downscaled and re-encoded as a PNG data
 * URL so that:
 *  - the canvas is never tainted (a data URL is same-origin, so export works),
 *  - a 6MB phone photo does not sit in localStorage,
 *  - transparency survives, which club badges rely on.
 */

/** Longest edge of a stored crest. Crests draw at ~300px at most. */
export const MAX_CREST_EDGE = 512

/** Refuse anything implausible before spending time decoding it. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

const ACCEPTED = /^image\/(png|jpeg|jpg|webp|gif|svg\+xml)$/i

/** Read a File into a data URL. */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

function decode(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('That file is not an image the browser can open.'))
    image.src = dataUrl
  })
}

/**
 * Downscale to fit MAX_CREST_EDGE, preserving aspect and transparency.
 * An image already small enough is returned untouched.
 */
function downscale(image, maxEdge = MAX_CREST_EDGE) {
  const longest = Math.max(image.width, image.height)
  // A zero on either axis cannot be scaled into a usable crest.
  if (!image.width || !image.height) throw new Error('That image has no dimensions.')

  const ratio = Math.min(1, maxEdge / longest)
  const width = Math.max(1, Math.round(image.width * ratio))
  const height = Math.max(1, Math.round(image.height * ratio))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot process images right now.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}

/**
 * Turn a picked File into a crest data URL ready for the canvas.
 * Throws with a message worth showing the user.
 */
export async function readCrestFile(file) {
  if (!file) throw new Error('No file chosen.')
  if (file.size > MAX_UPLOAD_BYTES) {
    // Rounding down could say "8MB ... use one under 8MB".
    const megabytes = (file.size / 1024 / 1024).toFixed(1)
    throw new Error(`That image is ${megabytes}MB. Please use one under 8MB.`)
  }
  if (file.type && !ACCEPTED.test(file.type)) {
    throw new Error('Please choose a PNG, JPG, WEBP, GIF or SVG image.')
  }

  const original = await readAsDataUrl(file)
  const image = await decode(original)
  return downscale(image)
}
