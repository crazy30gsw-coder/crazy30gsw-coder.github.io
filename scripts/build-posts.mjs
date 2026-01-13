import fs from "fs";
import path from "path";
import Parser from "rss-parser";

const ROOT = process.cwd();
const FEEDS_PATH = path.join(ROOT, "feeds.json");
const POSTS_PATH = path.join(ROOT, "posts.json");

function safeReadJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function pickImage(item) {
  // RSSによって入ってる場所が違うので、ありそうな所を総当たり
  const candidates = [];

  // rss-parser の標準っぽい
  if (item.enclosure?.url) candidates.push(item.enclosure.url);

  // media:content / media:thumbnail 系
  if (item["media:content"]?.$?.url) candidates.push(item["media:content"].$.url);
  if (item["media:thumbnail"]?.$?.url) candidates.push(item["media:thumbnail"].$.url);

  // content内の<img>から拾う（無理な時もある）
  const html = item["content:encoded"] || item.content || "";
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m?.[1]) candidates.push(m[1]);

  // 最初に「http」始まりだけ採用
  const img = candidates.find(u => typeof u === "string" && /^https?:\/\//i.test(u));
  return img || "";
}

function normalizeUrl(u) {
  if (!u) return "";
  // Google NewsのRSSはリンクが変な場合があるので、とりあえずそのまま使う（追跡解除は後で）
  return u.trim();
}

function toISODate(d) {
  if (!d) return new Date().toISOString();
  const t = new Date(d);
  return isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
}

(async () => {
  const conf = safeReadJSON(FEEDS_PATH);
  if (!conf?.feeds?.length) {
    console.error("feeds.json が見つからない or feeds が空です");
    process.exit(1);
  }

  const maxItems = Number(conf.maxItems || 80);

  const parser = new Parser({
    customFields: {
      item: [
        ["media:content", "media:content"],
        ["media:thumbnail", "media:thumbnail"],
        ["content:encoded", "content:encoded"]
      ]
    }
  });

  const all = [];

  for (const f of conf.feeds) {
    try {
      const feed = await parser.parseURL(f.url);
      for (const item of feed.items || []) {
        const url = normalizeUrl(item.link || item.guid || "");
        if (!url) continue;

        all.push({
          title: (item.title || "").trim() || "（無題）",
          url,
          source: (feed.title || f.name || "RSS").trim(),
          published: toISODate(item.isoDate || item.pubDate),
          image: pickImage(item)
        });
      }
    } catch (e) {
      console.error("Feed error:", f.url, e?.message || e);
    }
  }

  // URLで重複削除
  const map = new Map();
  for (const p of all) {
    if (!map.has(p.url)) map.set(p.url, p);
  }

  // 新しい順
  const posts = [...map.values()]
    .sort((a, b) => new Date(b.published) - new Date(a.published))
    .slice(0, maxItems);

  fs.writeFileSync(POSTS_PATH, JSON.stringify(posts, null, 2), "utf-8");
  console.log(`OK: posts.json updated (${posts.length} items)`);
})();