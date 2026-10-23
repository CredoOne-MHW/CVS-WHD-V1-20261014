// Knowledge Base: compiles content/kb/*.md into shared/kb.generated.json on every build (prebuild),
// so the Super Admin's Knowledge Base tabs always match the deployed code. Add a .md file → a new tab appears.
//
// Front matter: title, slug, order, summary. Placeholders like {{metaCallback}} are filled in the browser
// with this deployment's real addresses (see src/app/sa/knowledgebase/page.tsx).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "content", "kb");
const tabs = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) {
  const raw = readFileSync(join(dir, f), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`content/kb/${f}: missing front matter (---)`);
  const meta = Object.fromEntries(
    m[1]
      .split("\n")
      .map((l) => l.match(/^(\w+):\s*(.*)$/))
      .filter(Boolean)
      .map((x) => [x[1], x[2].trim()])
  );
  if (!meta.title || !meta.slug) throw new Error(`content/kb/${f}: title and slug are required`);
  const html = marked.parse(m[2], { gfm: true, async: false });
  // md: the article's Markdown source, kept so Knowledge Base can offer it as a .md download (also rebuilt every deploy)
  tabs.push({ slug: meta.slug, title: meta.title, order: Number(meta.order || 50), summary: meta.summary || "", html, md: m[2].trim(), file: f });
}
tabs.sort((a, b) => a.order - b.order);
const out = { builtAt: new Date().toISOString(), commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null, tabs };
writeFileSync(join(root, "shared", "kb.generated.json"), JSON.stringify(out, null, 1));
console.log(`Knowledge Base: ${tabs.length} tab(s) → shared/kb.generated.json`);
