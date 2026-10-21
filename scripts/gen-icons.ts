/** Render the app icon SVG into the PNG sizes the PWA manifest and iOS need. Usage: npm run icons */
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(__dirname, "../public/icons");

// Three book spines leaning on a shelf, on the night-reading-room blue.
const glyph = (scale: number, offset: number) => `
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <rect x="132" y="120" width="70" height="272" rx="12" fill="#f0b44c"/>
    <rect x="220" y="150" width="62" height="242" rx="12" fill="#8f84d8"/>
    <rect x="296" y="128" width="64" height="262" rx="12" fill="#5fbfb0" transform="rotate(12 328 390)"/>
    <rect x="110" y="392" width="292" height="16" rx="8" fill="#ece6da"/>
  </g>`;

const svg = (opts: { maskable?: boolean; radius?: number }) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${opts.radius ?? 0}" fill="#111a2c"/>
  ${opts.maskable ? glyph(0.72, 72) : glyph(1, 0)}
</svg>`;

async function main() {
  writeFileSync(resolve(OUT, "icon.svg"), svg({ radius: 112 }));
  const plain = Buffer.from(svg({}));
  const masked = Buffer.from(svg({ maskable: true }));
  await sharp(plain).resize(192, 192).png().toFile(resolve(OUT, "icon-192.png"));
  await sharp(plain).resize(512, 512).png().toFile(resolve(OUT, "icon-512.png"));
  await sharp(masked).resize(512, 512).png().toFile(resolve(OUT, "icon-maskable-512.png"));
  await sharp(masked).resize(180, 180).png().toFile(resolve(OUT, "apple-touch-icon.png"));
  await sharp(Buffer.from(svg({ radius: 112 }))).resize(48, 48).png().toFile(resolve(OUT, "favicon-48.png"));
  console.log("icons written to public/icons");
}
main();
