#!/usr/bin/env node
/**
 * Génère une vignette de partage (1200x630, format "OG image") pour chaque
 * recipe TRMNL publique, prête à coller sur Reddit/Discord.
 *
 * Image de fond :
 *  - Pour "Patent Drawings" (repo nbbou81000/trmnl-patents) : une planche
 *    tirée au hasard dans son corpus (docs/img/<n>.png, n < count.json).
 *  - Pour toutes les autres recipes : le screenshot_url fourni par l'API.
 *
 * Sortie : share/<recipe-id>.png (committé dans le repo, régénéré à chaque
 * run du bot -> l'image tourne toutes les 6h, comme le README).
 *
 * Dépendance : sharp (voir package.json)
 */

import sharp from "sharp";
import fs from "node:fs/promises";

const USER_ID = process.env.TRMNL_USER_ID;
if (!USER_ID) {
  console.error("❌ TRMNL_USER_ID manquant (env var).");
  process.exit(1);
}

const API_URL = `https://trmnl.com/recipes.json?user_id=${USER_ID}&per_page=100&sort-by=newest`;

// Corpus dédié pour Patent Drawings. Ajoute d'autres entrées ici si tu
// publies un autre plugin "à corpus" (planches naturalistes, anatomie...).
const CORPUS_POOLS = {
  "trmnl-patents": {
    match: (r) => /patent/i.test(r.name) || /trmnl-patents/i.test(r?.author_bio?.github_url ?? ""),
    countUrl: "https://nbbou81000.github.io/trmnl-patents/count.json",
    imageUrl: (n) => `https://nbbou81000.github.io/trmnl-patents/img/${n}.png`,
  },
};

const W = 1200;
const H = 630;

async function main() {
  const res = await fetch(API_URL, { headers: { "User-Agent": "trmnl-recipes-share-bot" } });
  if (!res.ok) throw new Error(`API TRMNL a répondu ${res.status}`);
  const { data: recipes } = await res.json();

  await fs.mkdir(new URL("../share/", import.meta.url), { recursive: true });

  for (const r of recipes) {
    try {
      const buf = await renderCard(r);
      const path = new URL(`../share/${r.id}.png`, import.meta.url);
      await fs.writeFile(path, buf);
      console.log(`✅ share/${r.id}.png (${r.name})`);
    } catch (err) {
      console.error(`❌ ${r.name} (${r.id}) :`, err.message);
    }
  }
}

async function renderCard(r) {
  const bgUrl = await pickBackgroundUrl(r);
  const bgBuf = await fetchBuffer(bgUrl);

  // 1. Fond : cover-fit sur 1200x630
  const background = await sharp(bgBuf)
    .resize(W, H, { fit: "cover", position: "attention" })
    .toBuffer();

  // 2. Icône en base64 (petit badge en haut à gauche)
  let iconDataUri = "";
  try {
    const iconBuf = await fetchBuffer(r.icon_url);
    const iconPng = await sharp(iconBuf).resize(56, 56, { fit: "cover" }).png().toBuffer();
    iconDataUri = `data:image/png;base64,${iconPng.toString("base64")}`;
  } catch {
    // pas grave si l'icône ne charge pas, on affiche sans
  }

  const title = escapeXml(r.name);
  const desc = wrapText(stripHtml(r?.author_bio?.description ?? r?.description ?? ""), 62, 3);

  const overlay = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="30%" stop-color="#000000" stop-opacity="0.55"/>
      <stop offset="65%" stop-color="#000000" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect x="0" y="320" width="${W}" height="${H - 320}" fill="url(#fade)"/>

  ${iconDataUri ? `
  <rect x="32" y="32" width="230" height="88" rx="14" fill="#000000" opacity="0.6"/>
  <rect x="48" y="48" width="56" height="56" rx="12" fill="#ffffff"/>
  <image href="${iconDataUri}" x="48" y="48" width="56" height="56" />
  <text x="118" y="83" font-family="sans-serif" font-size="18" font-weight="700"
        fill="#ffffff" letter-spacing="1.5">TRMNL</text>
  <text x="118" y="103" font-family="sans-serif" font-size="18" font-weight="700"
        fill="#ffffff" letter-spacing="1.5">RECIPE</text>
  ` : ""}

  <text x="40" y="460" font-family="sans-serif" font-size="52" font-weight="800" fill="#ffffff">
    ${title}
  </text>

  ${desc
    .map(
      (line, i) =>
        `<text x="40" y="${505 + i * 34}" font-family="sans-serif" font-size="26" fill="#e5e5e5">${escapeXml(line)}</text>`
    )
    .join("\n")}

  <text x="${W - 40}" y="${H - 32}" font-family="monospace" font-size="22" fill="#ffffff" opacity="0.65" text-anchor="end">
    trmnl.com/recipes/${r.id}
  </text>
</svg>`;

  const overlayBuf = await sharp(Buffer.from(overlay)).png().toBuffer();

  return sharp(background).composite([{ input: overlayBuf, top: 0, left: 0 }]).png().toBuffer();
}

async function pickBackgroundUrl(r) {
  for (const pool of Object.values(CORPUS_POOLS)) {
    if (pool.match(r)) {
      const { count } = await (await fetch(pool.countUrl)).json();
      const n = Math.floor(Math.random() * count);
      return pool.imageUrl(n);
    }
  }
  return r.screenshot_url || r.icon_url;
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { "User-Agent": "trmnl-recipes-share-bot" } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function stripHtml(s) {
  return String(s).replace(/<[^>]*>/g, "");
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text, maxCharsPerLine, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      cur = candidate;
    } else {
      lines.push(cur);
      cur = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);

  const consumed = lines.join(" ").length;
  if (consumed < text.length && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.slice(0, Math.max(0, maxCharsPerLine - 1)).trimEnd() + "…";
  }
  return lines;
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
