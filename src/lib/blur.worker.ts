// Runs the backdrop blur off the main thread (in a no-JIT WebView a main-thread blur
// could stall a frame or two each time the movie changes).
import { blurImageData } from './blur'

self.onmessage = (e: MessageEvent<{ id: number; img: ImageData; radius: number; brightness: number; saturate: number }>) => {
  const { id, img, radius, brightness, saturate } = e.data
  const out = blurImageData(img, radius, brightness, saturate)
  ;(self as unknown as Worker).postMessage({ id, img: out }, [out.data.buffer])
}
