/**
 * Render the app icon into the sizes the PWA manifest, iOS and browsers need.
 * Usage: npm run icons
 *
 * Source: scripts/icon-source.svg, "Neon S with bookmark" (chosen 2026-10-22):
 * a glowing condensed S (Archivo 900, outlined to a path, so no font is needed)
 * on the darkroom ground, with a hot-pink bookmark ribbon over the corner.
 * Drawn in code for this project; no stock or generated imagery.
 */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(__dirname, "../public/icons");
const source = readFileSync(resolve(__dirname, "icon-source.svg"), "utf8");
const inner = source.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
// The darkroom ground, drawn full size so a shrunk (maskable) icon has no seam.
const GROUND = '<rect width="512" height="512" fill="url(#bg)"/>';
const art = inner.replace(GROUND, "");

const svg = (opts: { radius?: number; inset?: number }) => {
  const r = opts.radius ?? 0;
  const k = 1 - 2 * (opts.inset ?? 0);
  const off = 256 * (1 - k);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><clipPath id="tile"><rect width="512" height="512" rx="${r}"/></clipPath></defs>
  <g clip-path="url(#tile)">
    ${GROUND}
    <g transform="translate(${off} ${off}) scale(${k})">${art}</g>
  </g>
</svg>`;
};

async function main() {
  // Browsers: rounded tile.
  writeFileSync(resolve(OUT, "icon.svg"), svg({ radius: 112 }));
  // iOS and "any" manifest icons: full bleed (the OS rounds the corners).
  const plain = Buffer.from(svg({}));
  // Android "maskable": content kept inside the safe circle.
  const masked = Buffer.from(svg({ inset: 0.1 }));
  await sharp(plain).resize(192, 192).png().toFile(resolve(OUT, "icon-192.png"));
  await sharp(plain).resize(512, 512).png().toFile(resolve(OUT, "icon-512.png"));
  await sharp(masked).resize(512, 512).png().toFile(resolve(OUT, "icon-maskable-512.png"));
  await sharp(plain).resize(180, 180).png().toFile(resolve(OUT, "apple-touch-icon.png"));
  await sharp(Buffer.from(svg({ radius: 112 }))).resize(48, 48).png().toFile(resolve(OUT, "favicon-48.png"));
  console.log("icons written to public/icons");
}
main();
