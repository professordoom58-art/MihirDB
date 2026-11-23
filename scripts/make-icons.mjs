// Builds every app icon + the splash from ONE source image: assets/icon-source.png
// (1024×1024, opaque, full-bleed). Run: npm run icons
//   → assets/icon-only.png, assets/splash*.png   (inputs for @capacitor/assets → iOS)
//   → public/icons/*                               (PWA, home screen, favicon)
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const p = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url))
const SRC = p('assets/icon-source.png')
const APP_BG = '#050506' // the app's background, so launch → app has no colour jump
mkdirSync(p('public/icons'), { recursive: true })

const meta = await sharp(SRC).metadata()
if (meta.width !== meta.height) throw new Error(`icon-source.png must be square (is ${meta.width}×${meta.height})`)

// iOS applies its own rounded mask, and wants an opaque square
const square = (size) => sharp(SRC).resize(size, size, { kernel: 'lanczos3' }).flatten({ background: APP_BG }).png()
await square(1024).toFile(p('assets/icon-only.png'))

// splash: the icon (with iOS-like rounded corners) centred on the app background
async function splash(file) {
  const S = 2732
  const icon = Math.round(S * 0.17)
  const r = Math.round(icon * 0.2237) // iOS icon corner ratio
  const mask = Buffer.from(`<svg width="${icon}" height="${icon}"><rect width="${icon}" height="${icon}" rx="${r}" ry="${r}"/></svg>`)
  const rounded = await sharp(SRC).resize(icon, icon).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
  await sharp({ create: { width: S, height: S, channels: 4, background: APP_BG } })
    .composite([{ input: rounded, left: Math.round((S - icon) / 2), top: Math.round((S - icon) / 2) }])
    .png()
    .toFile(p(file))
}
await splash('assets/splash.png')
await splash('assets/splash-dark.png')

// PWA / home screen / favicon
await square(512).toFile(p('public/icons/icon-512.png'))
await square(192).toFile(p('public/icons/icon-192.png'))
await square(512).toFile(p('public/icons/icon-maskable-512.png')) // full-bleed artwork is already maskable-safe
await square(180).toFile(p('public/icons/apple-touch-icon.png'))
await square(64).toFile(p('public/icons/favicon.png'))
writeFileSync(p('public/icons/README.txt'), 'Generated from assets/icon-source.png by scripts/make-icons.mjs. Do not edit by hand.\n')
console.log('icons written from assets/icon-source.png')
