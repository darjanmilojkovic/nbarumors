import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

/**
 * Generate the app icons from a flattened frame of the masthead mark.
 *
 *   npm run make:icons
 *
 * The logo animates; an icon cannot. No browser runs SVG animation in a tab,
 * and social scrapers capture a single frame, so the icon set is drawn from a
 * still version of the same mark rather than exported from the animated file.
 *
 * Two stills. Above 64px the wings, orbit and antenna all read, so the large
 * icons carry the full mark. At 64 and below only the ball survives, so the
 * favicon is a basketball and nothing else — all four seams, filling the frame.
 */

/** The full mark, still. Used above 64px. */
const FULL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -40 80 80">
  <defs>
    <radialGradient id="s" cx="34%" cy="28%" r="78%">
      <stop offset="0%" stop-color="#ffc178"/><stop offset="38%" stop-color="#f08a2c"/>
      <stop offset="78%" stop-color="#d2691a"/><stop offset="100%" stop-color="#8f3f0c"/>
    </radialGradient>
    <radialGradient id="g" cx="50%" cy="50%" r="50%">
      <stop offset="55%" stop-color="#e07a2f" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#e07a2f" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="p" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6ba6e0"/><stop offset="50%" stop-color="#2f6098"/>
      <stop offset="100%" stop-color="#16324f"/>
    </linearGradient>
    <radialGradient id="h" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff3e0" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#fff3e0" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="c"><circle r="20"/></clipPath>
  </defs>
  <g transform="rotate(-24)">
    <ellipse rx="31" ry="12.5" fill="none" stroke="#5e9ad8" stroke-width="1.6" opacity="0.5"/>
    <circle cx="26" cy="-6.8" r="2.4" fill="#e3b23c"/>
  </g>
  <circle r="30" fill="url(#g)"/>
  <path d="M-20 0h-6M20 0h6" stroke="#9a9a9a" stroke-width="1.8"/>
  <rect x="-40" y="-7" width="14" height="14" rx="1.4" fill="url(#p)"/>
  <rect x="26" y="-7" width="14" height="14" rx="1.4" fill="url(#p)"/>
  <g stroke="#0f2036" stroke-width="0.7" opacity="0.85" fill="none">
    <path d="M-35.3-7v14M-30.7-7v14M-40-2.3h14M-40 2.3h14"/>
    <path d="M30.7-7v14M35.3-7v14M26-2.3h14M26 2.3h14"/>
  </g>
  <path d="M0-20v-7" stroke="#9a9a9a" stroke-width="1.6"/>
  <circle cy="-28.5" r="2.6" fill="none" stroke="#5e9ad8" stroke-width="1.6"/>
  <circle cy="-28.5" r="1" fill="#e3b23c"/>
  <circle r="20" fill="url(#s)"/>
  <g clip-path="url(#c)" stroke="#7d3608" stroke-width="1.9" fill="none" opacity="0.9">
    <path d="M0-21v42M-21 0h42"/>
    <path d="M-11.5-17.5c5.5 9.5 5.5 25.5 0 35M11.5-17.5c-5.5 9.5-5.5 25.5 0 35"/>
  </g>
  <circle r="20" fill="none" stroke="#5a2604" stroke-width="0.9" opacity="0.55"/>
  <ellipse cx="-6.5" cy="-7" rx="7.5" ry="5.5" fill="url(#h)" transform="rotate(-32 -6.5 -7)"/>
</svg>`;

/** Shared gradient, so both stills light the sphere identically. */
const SPHERE = `<radialGradient id="s" cx="34%" cy="28%" r="78%">
      <stop offset="0%" stop-color="#ffc178"/><stop offset="38%" stop-color="#f08a2c"/>
      <stop offset="78%" stop-color="#d2691a"/><stop offset="100%" stop-color="#8f3f0c"/>
    </radialGradient>`;

/**
 * All four seams, at a radius. A cross alone reads as a beach ball — it is the
 * two bowed pole-to-pole seams that say basketball, so they survive every
 * reduction even when the wings and the orbit do not.
 */
const seams = (r: number, w: number) => {
  const b = r * 0.75; // how far the side seams bow out
  return `<g stroke="#7d3608" stroke-width="${w}" fill="none" stroke-linecap="round">
    <path d="M0-${r}v${r * 2}M-${r} 0h${r * 2}"/>
    <path d="M0-${r}C-${b}-${r * 0.5}-${b} ${r * 0.5} 0 ${r}"/>
    <path d="M0-${r}C${b}-${r * 0.5} ${b} ${r * 0.5} 0 ${r}"/>
  </g>`;
};

/**
 * 64px and below: the ball alone, filling the frame.
 *
 * The wings are the first thing to go. At icon sizes they sit at the very
 * edge of the square, so they crop against the tab chrome and steal width
 * from the only shape that has to be recognisable. A basketball at 14 of 16
 * pixels reads; a satellite at 16 pixels is three grey specks.
 */
const TINY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -40 80 80">
  <defs>${SPHERE}</defs>
  <circle r="38" fill="url(#s)"/>
  ${seams(38, 5.5)}
</svg>`;

const render = (svg: string, size: number) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/**
 * Pack PNGs into a multi-resolution .ico.
 *
 * Written out rather than pulled from a package: the format is a 6-byte header,
 * a 16-byte directory entry per image, and the PNG payloads appended whole —
 * Vista and later read PNG-in-ICO directly, so nothing needs re-encoding to BMP.
 */
function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries: Buffer[] = [];
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

async function main() {
  const app = join(process.cwd(), "src", "app");

  // The tab icon: three resolutions, all of them the ball alone.
  const ico = buildIco([
    { size: 16, png: await render(TINY, 16) },
    { size: 32, png: await render(TINY, 32) },
    { size: 48, png: await render(TINY, 48) },
  ]);
  await writeFile(join(app, "favicon.ico"), ico);

  // Next picks these up by filename; no <link> tags to write.
  await writeFile(join(app, "icon.png"), await render(FULL, 192));
  await writeFile(join(app, "apple-icon.png"), await render(FULL, 180));

  console.log(`  favicon.ico    ${ico.length} bytes  (16 / 32 / 48, ball only)`);
  console.log(`  icon.png       192px`);
  console.log(`  apple-icon.png 180px`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
