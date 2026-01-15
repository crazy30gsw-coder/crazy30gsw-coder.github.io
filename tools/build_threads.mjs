import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const API_KEY = process.env.OPENAI_API_KEY || process.env.KKK;
if (!API_KEY) throw new Error("OpenAI API key (OPENAI_API_KEY or KKK) が設定されていません");

const POSTS_PATH = "./posts.json";
const THREADS_PATH = "./threads.json";

function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function normalizePosts(data) {
  const posts = Array.isArray(data) ? data : (data.posts || []);
  return posts
    .map(p => ({
      title: p.title || "",
      url: p.url || p.link || "",
      source: p.source || "",
      date: p.date || p.published || p.pubDate || new Date().toISOString(),
      category: p.category || "その他"
    }))
    .filter(p => p.title && p.url)
    .sort((a,b)=> new Date(b.date) - new Date(a.date));
}

function clamp(s, n) {
  const t = String(s || "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

async function genThreadForPost(post) {
  // 重要：実在コメントの取得/転載はしない。あくまで “反応例” を生成する。
  const prompt = `
あなたは日本のまとめサイト編集者。
次の「ニュース1本」から、掲示板風の「反応例（架空コメント）」を作ってください。
※実在のコメントや他サイトの文章をコピーしない。固有表現の作り話もしない（事実断定・誹謗中傷・名誉毀損NG）。
※短く、テンポ良く。口調は「ネットの反応っぽい」程度に。

【ニュース】
タイトル: ${post.title}
カテゴリ: ${post.category}
ソースURL: ${post.url}

出力は必ずJSONのみ：
{
  "board": "芸能/政治/話題/社会/スポーツ/その他 のどれか",
  "hot": 0〜100の整数,
  "posts": [
    {"no": 1, "text": "コメント", "likes": 0〜50},
    {"no": 2, "text": "コメント", "likes": 0〜50},
    {"no": 3, "text": "コメント", "likes": 0〜50}
  ]
}
`.trim();

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 500,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error("OpenAI API error: " + text);
  }

  const data = await res.json();

  // data.output_text に JSON が入る想定（あなたの今のコードと同じ扱い）
  let obj = {};
  try {
    obj = JSON.parse(data.output_text || "{}");
  } catch (e) {
    obj = {};
  }

  const board = obj.board || (post.category === "芸能" ? "芸能" : post.category === "政治" ? "政治" : "話題");
  const hot = Number.isFinite(obj.hot) ? obj.hot : Math.floor(40 + Math.random() * 50);

  const posts = Array.isArray(obj.posts) ? obj.posts : [];
  const fixed = posts.slice(0,3).map((p,i)=>({
    no: i+1,
    text: clamp(p?.text || "", 60) || "（反応例）",
    likes: Number.isFinite(p?.likes) ? p.likes : Math.floor(Math.random()*20)
  }));

  while (fixed.length < 3) {
    fixed.push({ no: fixed.length+1, text: "（反応例）", likes: Math.floor(Math.random()*20) });
  }

  return {
    title: `【反応】${post.title}`,
    url: post.url,
    board,
    date: post.date,
    hot: Math.max(0, Math.min(100, parseInt(hot, 10) || 50)),
    posts: fixed
  };
}

async function main() {
  const raw = readJsonSafe(POSTS_PATH, { posts: [] });
  const posts = normalizePosts(raw);

  if (!posts.length) {
    const out = { updatedAt: new Date().toISOString(), threads: [] };
    fs.writeFileSync(THREADS_PATH, JSON.stringify(out, null, 2));
    console.log("posts.json が空なので threads.json を空で更新しました");
    return;
  }

  // 直近の上位ニュースから threads を作る（多すぎるとAPIコスト増）
  const target = posts.slice(0, 8);

  const threads = [];
  for (const p of target) {
    console.log("Generate thread:", p.title);
    const th = await genThreadForPost(p);
    threads.push(th);
  }

  const out = {
    updatedAt: new Date().toISOString(),
    note: "このthreadsはニュースから生成した『反応例（架空コメント）』です。実在の掲示板コメント転載ではありません。",
    threads
  };

  fs.writeFileSync(THREADS_PATH, JSON.stringify(out, null, 2));
  console.log("✅ threads.json を更新しました:", threads.length, "件");
}

main().catch(e => {
  console.error("❌ Error:", e);
  process.exit(1);
});