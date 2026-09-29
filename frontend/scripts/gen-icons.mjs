// PWA আইকন জেনারেটর — favicon.svg ডিজাইন থেকে আসল PNG আইকন বানায়।
// 4 ফরম্যাট: any-192, any-512 (rounded-rect, স্বচ্ছ কোণ), maskable-192/512
// (ফুল-ব্লিড গ্রেডিয়েন্ট + সেফ-জোনে গ্লিফ), apple-touch-icon (180, opaque)।
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'fs'

const OUT = 'public/icons'
mkdirSync(OUT, { recursive: true })

const GLYPH = `<path d="M18 22c0-2.2 1.8-4 4-4h20a4 4 0 010 8H26v6h12a4 4 0 010 8H26v8a4 4 0 01-8 0V22z" fill="#fff"/>`
const GRAD = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d6ef3"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>`

// রেগুলার (any) — রাউন্ডেড স্কয়ার, স্বচ্ছ কোণ
const regular = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${GRAD}<rect width="64" height="64" rx="16" fill="url(#g)"/>${GLYPH}</svg>`

// মাস্কেবল — ফুল-ব্লিড ব্যাকগ্রাউন্ড, গ্লিফ সেফ-জোনে (~62%)
const maskable = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${GRAD}<rect width="64" height="64" fill="url(#g)"/><g transform="translate(18 18)">${GLYPH}</g></svg>`

// apple-touch — opaque ফুল স্কয়ার (iOS নিজেই মাস্ক করে)
const apple = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${GRAD}<rect width="64" height="64" rx="14" fill="url(#g)"/><g transform="translate(19 19)">${GLYPH}</g></svg>`

const JOBS = [
  { name: 'icon-192.png', size: 192, svg: regular(192) },
  { name: 'icon-512.png', size: 512, svg: regular(512) },
  { name: 'icon-maskable-192.png', size: 192, svg: maskable(192) },
  { name: 'icon-maskable-512.png', size: 512, svg: maskable(512) },
]

const browser = await chromium.launch()
const page = await browser.newPage()

for (const job of JOBS) {
  await page.setViewportSize({ width: job.size, height: job.size })
  await page.setContent(`<html><body style="margin:0;padding:0;overflow:hidden">${job.svg}</body></html>`)
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: job.size, height: job.size } })
  writeFileSync(`${OUT}/${job.name}`, buf)
  console.log(`OK ${job.name} (${job.size}x${job.size}, ${buf.length} bytes)`)
}

// apple-touch-icon অপাক হলে iOS ভুল রেন্ডার করতে পারে — opaque শট
await page.setViewportSize({ width: 180, height: 180 })
await page.setContent(`<html><body style="margin:0;padding:0;overflow:hidden;background:#ffffff">${apple(180)}</body></html>`)
const buf2 = await page.screenshot({ clip: { x: 0, y: 0, width: 180, height: 180 } })
writeFileSync(`${OUT}/apple-touch-icon.png`, buf2)
console.log(`OK apple-touch-icon.png (opaque, ${buf2.length} bytes)`)

await browser.close()
console.log('All PWA icons generated.')
