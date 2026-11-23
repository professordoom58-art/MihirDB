/**
 * Gaussian-ish blur on canvas pixels: three box-blur passes per axis (a classic,
 * close approximation of a true Gaussian), with a brightness/saturation tweak folded in.
 * Runs once per backdrop on a ~half-resolution canvas (a few ms), so the screen
 * shows a smooth, high-quality blur without a CSS `filter` (whose full-screen
 * offscreen buffers are what ran the iPhone WebView out of memory).
 */
export function blurImageData(img: ImageData, radius: number, brightness = 1, saturate = 1) {
  const { width: w, height: h, data } = img
  const r = Math.max(1, Math.round(radius))
  const a = new Float32Array(w * h * 3)
  const b = new Float32Array(w * h * 3)
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    a[j] = data[i]
    a[j + 1] = data[i + 1]
    a[j + 2] = data[i + 2]
  }
  // box sizes for 3 passes approximating a Gaussian with sigma ≈ radius
  const boxes = boxesForGauss(r, 3)
  for (const size of boxes) {
    const br = (size - 1) / 2
    boxH(a, b, w, h, br)
    boxV(b, a, w, h, br)
  }
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    let R = a[j] * brightness
    let G = a[j + 1] * brightness
    let B = a[j + 2] * brightness
    if (saturate !== 1) {
      const l = 0.2126 * R + 0.7152 * G + 0.0722 * B
      R = l + (R - l) * saturate
      G = l + (G - l) * saturate
      B = l + (B - l) * saturate
    }
    data[i] = R
    data[i + 1] = G
    data[i + 2] = B
    data[i + 3] = 255
  }
  return img
}

function boxesForGauss(sigma: number, n: number) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1)
  let wl = Math.floor(wIdeal)
  if (wl % 2 === 0) wl--
  const wu = wl + 2
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)
  const m = Math.round(mIdeal)
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu))
}

/** horizontal running-sum box blur, edges clamped */
function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (r + r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w * 3
    for (let c = 0; c < 3; c++) {
      const first = src[row + c]
      const last = src[row + (w - 1) * 3 + c]
      let acc = (r + 1) * first
      for (let x = 0; x < r; x++) acc += src[row + Math.min(x, w - 1) * 3 + c]
      for (let x = 0; x < w; x++) {
        acc += (x + r < w ? src[row + (x + r) * 3 + c] : last) - (x - r - 1 >= 0 ? src[row + (x - r - 1) * 3 + c] : first)
        dst[row + x * 3 + c] = acc * inv
      }
    }
  }
}

/** vertical running-sum box blur, edges clamped */
function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const inv = 1 / (r + r + 1)
  const stride = w * 3
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      const col = x * 3 + c
      const first = src[col]
      const last = src[(h - 1) * stride + col]
      let acc = (r + 1) * first
      for (let y = 0; y < r; y++) acc += src[Math.min(y, h - 1) * stride + col]
      for (let y = 0; y < h; y++) {
        acc += (y + r < h ? src[(y + r) * stride + col] : last) - (y - r - 1 >= 0 ? src[(y - r - 1) * stride + col] : first)
        dst[y * stride + col] = acc * inv
      }
    }
  }
}

// ------------------------------------------------------------------ off-main-thread
let worker: Worker | null | undefined
let seq = 0
const waiting = new Map<number, (img: ImageData) => void>()

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./blur.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; img: ImageData }>) => {
      waiting.get(e.data.id)?.(e.data.img)
      waiting.delete(e.data.id)
    }
    worker.onerror = () => {
      worker = null // fall back to the main thread from now on
    }
  } catch {
    worker = null
  }
  return worker
}

/** Blur in a Web Worker when possible (transferring the pixel buffer), else inline. */
export function blurAsync(img: ImageData, radius: number, brightness = 1, saturate = 1): Promise<ImageData> {
  const w = getWorker()
  if (!w) return Promise.resolve(blurImageData(img, radius, brightness, saturate))
  return new Promise((resolve) => {
    const id = ++seq
    // if the worker dies mid-job, finish on the main thread
    const timer = setTimeout(() => {
      if (!waiting.has(id)) return
      waiting.delete(id)
      resolve(blurImageData(img, radius, brightness, saturate))
    }, 4000)
    waiting.set(id, (out) => {
      clearTimeout(timer)
      resolve(out)
    })
    try {
      w.postMessage({ id, img, radius, brightness, saturate }, [img.data.buffer])
    } catch {
      waiting.delete(id)
      clearTimeout(timer)
      resolve(blurImageData(img, radius, brightness, saturate))
    }
  })
}
