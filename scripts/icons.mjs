import sharp from "sharp";
import { mkdir } from "node:fs/promises";
await mkdir("public/icons", { recursive: true });
const svg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" fill="#17392e"/><rect x="149" y="119" width="214" height="254" rx="48" fill="#ddecac"/><rect x="175" y="152" width="162" height="102" rx="15" fill="#17392e"/><path d="M209 225l88-49m-36 0h36v35" stroke="#ddecac" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="194" cy="316" r="15" fill="#17392e"/><circle cx="318" cy="316" r="15" fill="#17392e"/><path d="M180 391l21-26m131 26l-21-26" stroke="#ddecac" stroke-width="14" stroke-linecap="round"/></svg>`;
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["maskable-512", 512],
])
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(`public/icons/${name}.png`);
