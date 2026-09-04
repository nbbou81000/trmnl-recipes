#!/usr/bin/env node
/**
 * Génère README.md à partir des recipes TRMNL publiques de l'utilisateur.
 * Source : https://docs.trmnl.com/go/public-api/recipes-api
 *
 * Usage : node scripts/generate-readme.mjs
 * Variables d'env :
 *   TRMNL_USER_ID   (obligatoire) - ton user_id TRMNL, ex: 40325
 *   AUTHOR_NAME     (optionnel)   - nom affiché en titre, défaut "Nico"
 */

const USER_ID = process.env.TRMNL_USER_ID;
const AUTHOR_NAME = process.env.AUTHOR_NAME || "Nico";

if (!USER_ID) {
  console.error("❌ TRMNL_USER_ID manquant (env var).");
  process.exit(1);
}

const API_URL = `https://trmnl.com/recipes.json?user_id=${USER_ID}&per_page=100&sort-by=newest`;

function shieldsBadge(label, value, color = "1a73e8") {
  const enc = (s) => encodeURIComponent(String(s).replace(/-/g, "--").replace(/_/g, "__"));
  return `https://img.shields.io/badge/${enc(label)}-${enc(value)}-${color}`;
}

async function main() {
  console.log(`→ Fetch ${API_URL}`);
  const res = await fetch(API_URL, {
    headers: { "User-Agent": "trmnl-recipes-readme-bot" },
  });
  if (!res.ok) {
    throw new Error(`API TRMNL a répondu ${res.status}`);
  }
  const { data: recipes } = await res.json();

  if (!recipes || recipes.length === 0) {
    console.warn("⚠️ Aucune recipe trouvée pour cet user_id.");
  }

  // Tri par nombre de connexions décroissant (le plus populaire en premier)
  recipes.sort((a, b) => installs(b) - installs(a));

  const totalConnections = recipes.reduce((sum, r) => sum + installs(r), 0);

  const toc = recipes
    .map((r) => `[![Icon](${r.icon_url})](#${slugify(r.name)}) [${r.name}](#${slugify(r.name)})`)
    .join(" &nbsp;·&nbsp; ");

  const cards = recipes.map(renderCard).join("\n\n");

  const readme = `# ${AUTHOR_NAME}'s TRMNL Recipes

[![Recipes](${shieldsBadge("recipes", recipes.length)})](https://trmnl.com/recipes?user_id=${USER_ID})
[![Total Connections](${shieldsBadge("connections", totalConnections, "34a853")})](https://trmnl.com/recipes?user_id=${USER_ID})
[![Last update](${shieldsBadge("updated", new Date().toISOString().slice(0, 10), "grey")})](#)

[What is TRMNL?](https://trmnl.com/)

## Table of Contents

${toc}

${cards}

---

*README généré automatiquement depuis l'[API publique TRMNL Recipes](https://docs.trmnl.com/go/public-api/recipes-api).*
`;

  const fs = await import("node:fs/promises");
  await fs.writeFile(new URL("../README.md", import.meta.url), readme, "utf8");
  console.log(`✅ README.md régénéré avec ${recipes.length} recipe(s), ${totalConnections} connexions au total.`);
}

function installs(r) {
  return r?.stats?.installs ?? 0;
}

function description(r) {
  // La description publique vit dans le custom_field de type "author_bio"
  return r?.author_bio?.description ?? "";
}

function renderCard(r) {
  const anchor = slugify(r.name);
  const connBadge = shieldsBadge("connections", installs(r), "34a853");
  const forksBadge = shieldsBadge("forks", r?.stats?.forks ?? 0, "orange");
  const screenshot = r.screenshot_url
    ? `[![Screenshot](${r.screenshot_url})](${r.screenshot_url})`
    : "";
  return `## <a id="${anchor}"></a>![Icon](${r.icon_url}) ${r.name}

[![Connections](${connBadge})](https://trmnl.com/recipes/${r.id}) [![Forks](${forksBadge})](https://trmnl.com/recipes/${r.id})

${description(r)}

[View recipe on TRMNL](https://trmnl.com/recipes/${r.id})

${screenshot}`;
}

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
