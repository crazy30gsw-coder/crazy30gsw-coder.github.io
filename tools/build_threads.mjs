/**
 * tools/build_threads.mjs
 * Node.js v20+ 対応（node-fetch 不要）
 */

import fs from "fs";

// ========= 設定 =========
const API_KEY = process.env.OPENAI_API_KEY || process.env.KKK;
if (!API_KEY) {
  throw new Error("❌ OpenAI APIキーが設定されていません（OPENAI_API_KEY or KKK）");
}

const POSTS_PATH = "./posts.json";
const THREADS_PATH = "./threads.json";

// ========= ユーティリティ =========
function readJsonSafe(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizePosts(data) {
  const posts = Array.isArray(data) ? data : (data.posts || []);
  return posts
    .map(p => ({
      title: p.title || "",
      url: p.url || p.link || "",
      date: p.date || p.published || p.pubDate || new Date().toISOString(),
      category: p.category || "その他"
    }))
    .filter(p => p.title && p.url)
    .sort((a,b)=> new Date(b.date) - new Date(a.date));
}

function short(s, n=60) {
  return s.length > n ? s.slice(0, n-1) + "…" : s;
}

// ========= OpenAI 呼び出し =========
async function generateThread(post) {
  const prompt = `
あなたは日本のまとめサイト編集者です。
以下のニュースから「2ちゃんねる風の反応（架空）」を作ってください。

【重要ルール】
・実在の掲示板コメントを転載しない
・誹謗中傷、断定的事実、名誉毀損は禁止
・あくまで「ネットの反応っぽい例」

【ニュース】
タイトル：${post.title}
カテゴリ：${post.category}

JSONのみで出力：
{
  "board": "芸能/政治/話題/社会/スポーツ/その他",
  "hot": 0〜100,
  "posts": [
    {"no":1,"text":"コメント","likes":0},
    {"no":2,"text":"コメント","likes":0},
    {"no":3,"text":"コメント","likes":0}
  ]
}
`;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 500
    })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error("OpenAI API Error: " + t);
  }

  const json = await res.json();
  let out = {};

  try {
    out = JSON.parse(json.output_text);
  } catch {
    out = {};
  }

  const posts = (out.posts || []).slice(0,3).map((p,i)=>({
    no: i+1,
    text: short(p?.text || "反応あり"),
    likes: Number.isFinite(p?.likes) ? p.likes : Math.floor(Math.random()*20)
  }));

  while (posts.length < 3) {
    posts.push({ no: posts.length+1, text: "反応あり", likes: Math.floor(Math.random()*20) });
  }

  return {
    title: `【反応】${post.title}`,
    url: post.url,
    board: out.board || post.category || "話題",
    date: post.date,
    hot: Number.isFinite(out.hot) ? out.hot : Math.floor(40 + Math.random()*40),
    posts
  };
}

// ========= メイン処理 =========
async function main() {
  const raw = readJsonSafe(POSTS_PATH, { posts: [] });
  const posts = normalizePosts(raw);

  if (!posts.length) {
    fs.writeFileSync(THREADS_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), threads: [] }, null, 2));
    console.log("⚠ posts.json が空です");
    return;
  }

  const targets = posts.slice(0, 8);
  const threads = [];

  for (const p of targets) {
    console.log("▶ 生成中:", p.title);
    threads.push(await generateThread(p));
  }

  const out = {
    updatedAt: new Date().toISOString(),
    notice: "※本ページの反応はニュースから生成した架空コメントです",
    threads
  };

  fs.writeFileSync(THREADS_PATH, JSON.stringify(out, null, 2));
  console.log("✅ threads.json 更新完了:", threads.length);
}

main().catch(e=>{
  console.error("❌ Build失敗", e);
  process.exit(1);
});
