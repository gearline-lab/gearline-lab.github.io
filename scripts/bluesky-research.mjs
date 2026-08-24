import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, process.argv[2] ?? "config/bluesky-daily-candidates.json");
const endpoints = [
  "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts",
  "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts"
];
const ownDid = "did:plc:m2ewkc3ld4d3woonfzxuhaod";
const queries = ["デスク環境", "キーボード", "Mac周辺機器", "3Dプリント", "作業環境", "PCデスク", "ものづくり", "ゲーム環境"];
const topicPattern = /デスク|キーボード|Mac|USB.?C|配線|3Dプリント|3D.?print|CAD|モニター|周辺機器|作業環境|PC|自作|制作|ゲーム環境/iu;
const unsafePattern = /#PR\b|Amazonアソシエイト|amzn\.to|amazon\.|懸賞|プレゼント企画|相互フォロー|フォロバ/iu;
const promotionalPattern = /新発売！|魅力とは|コスパ最強|作業効率.*爆上|今すぐ|限定|セール/iu;
const urlPattern = /https?:\/\/|www\./iu;
const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
// 検索APIが一時的に不安定でも、過去に公開プロフィール・活動実態を
// 確認した周辺テーマの個人アカウントの最新フィードを候補に使う。
const fallbackAuthors = [
  "watatoji.bsky.social",
  "kzkr.xyz",
  "eeergs.me",
  "99lv.bsky.social",
  "hayashi-j.bsky.social"
];

const search = async (query) => {
  const failures = [];
  for (const endpoint of endpoints) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ q: query, sort: "latest", limit: "25" }).toString();
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const payload = await response.json();
      return payload.posts ?? [];
    } catch (error) {
      failures.push(`${new URL(endpoint).host}: ${error.message}`);
    }
  }
  throw new Error(`Bluesky検索に失敗しました: ${failures.join(" / ")}`);
};

const fallbackFeed = async (actor) => {
  const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed");
  url.search = new URLSearchParams({ actor, limit: "10" }).toString();
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${actor}: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  return (payload.feed ?? []).map((item) => item.post).filter(Boolean);
};

const queryResults = await Promise.allSettled(queries.map(search));
const failedQueries = queryResults.flatMap((result, index) => result.status === "rejected" ? [queries[index]] : []);
let allPosts = queryResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
let source = endpoints.join(",");
let fallbackFailedAuthors = [];
if (!allPosts.length) {
  const fallbackResults = await Promise.allSettled(fallbackAuthors.map(fallbackFeed));
  fallbackFailedAuthors = fallbackResults.flatMap((result, index) => result.status === "rejected" ? [fallbackAuthors[index]] : []);
  allPosts = fallbackResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  source = "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed";
}
if (!allPosts.length) throw new Error(`Bluesky候補を取得できませんでした: 検索=${failedQueries.join(", ")} / フォールバック=${fallbackFailedAuthors.join(", ")}`);
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
  source,
  queries,
  failedQueries,
  fallbackFailedAuthors,
  candidates: candidates.slice(0, 20),
  excluded: allPosts.length - candidates.length,
  note: "検索API失敗時は確認済み個人アカウントの最新フィードを使う。候補はリポスト・フォロー実行前に、公開状態、未フォロー状態、明確なスパム兆候がないことを確認する。テーマは周辺でも可。"
};

await mkdir(resolve(root, "config"), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, candidates: result.candidates.length, source: result.source }));
