import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, process.argv[2] ?? "config/bluesky-daily-candidates.json");
const endpoint = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";
const ownDid = "did:plc:m2ewkc3ld4d3woonfzxuhaod";
const queries = ["デスク環境", "キーボード", "Mac周辺機器", "3Dプリント", "作業環境", "PCデスク", "ものづくり", "ゲーム環境"];
const topicPattern = /デスク|キーボード|Mac|USB.?C|配線|3Dプリント|3D.?print|CAD|モニター|周辺機器|作業環境|PC|自作|制作|ゲーム環境/iu;
const unsafePattern = /#PR\b|Amazonアソシエイト|amzn\.to|amazon\.|懸賞|プレゼント企画|相互フォロー|フォロバ/iu;
const promotionalPattern = /新発売！|魅力とは|コスパ最強|作業効率.*爆上|今すぐ|限定|セール/iu;
const urlPattern = /https?:\/\/|www\./iu;
const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;

const search = async (query) => {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ q: query, sort: "latest", limit: "25" }).toString();
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Bluesky検索に失敗しました: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  return payload.posts ?? [];
};

const allPosts = (await Promise.all(queries.map(search))).flat();
const seen = new Set();
const candidates = [];
for (const post of allPosts) {
  const text = post.record?.text?.trim() ?? "";
  const authorText = [post.author?.handle, post.author?.displayName, post.author?.description].filter(Boolean).join(" ");
  const createdAt = Date.parse(post.record?.createdAt ?? post.indexedAt ?? "");
  if (!post.uri || !post.cid || !post.author?.did || seen.has(post.uri)) continue;
  seen.add(post.uri);
  if (post.author.did === ownDid || !text || !Number.isFinite(createdAt) || createdAt < cutoff) continue;
  if (!topicPattern.test(text)) continue;
  // 読者層を広げるため、日常のPC利用・制作・ゲーム環境も候補にする。
  // ただし、外部リンクを含む投稿や上記の明確な宣伝・スパム兆候は除外する。
  if (unsafePattern.test(text) || unsafePattern.test(authorText) || promotionalPattern.test(text) || urlPattern.test(text) || /公式アカウント|更新情報/iu.test(authorText)) continue;
  candidates.push({
    uri: post.uri,
    cid: post.cid,
    author: { did: post.author.did, handle: post.author.handle, displayName: post.author.displayName ?? null },
    createdAt: post.record?.createdAt ?? post.indexedAt,
    text
  });
}

const result = {
  checkedAt: new Date().toISOString(),
  source: "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts",
  queries,
  candidates: candidates.slice(0, 20),
  excluded: allPosts.length - candidates.length,
  note: "候補はリポスト・フォロー実行前に、公開状態、未フォロー状態、明確なスパム兆候がないことを確認する。テーマは周辺でも可。"
};

await mkdir(resolve(root, "config"), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, candidates: result.candidates.length, source: result.source }));
