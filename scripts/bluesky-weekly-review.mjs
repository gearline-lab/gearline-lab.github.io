import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const actor = "gearline-lab.bsky.social";
const api = "https://api.bsky.app/xrpc";
const snapshotPath = resolve(root, "data/bluesky-weekly-snapshots.json");
const getJson = async (path) => {
  const response = await fetch(`${api}/${path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Bluesky API取得に失敗しました: ${response.status} ${response.statusText}`);
  return response.json();
};
const profile = await getJson(`app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
const feed = await getJson(`app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=100`);
const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
const posts = (feed.feed ?? []).map((item) => item.post).filter((post) =>
  post?.author?.did === profile.did && Date.parse(post.record?.createdAt ?? post.indexedAt ?? "") >= cutoff
);
const isArticleIntro = (post) => /https:\/\/gearline-lab\.github\.io\/[a-z0-9-]+\.html/iu.test(post.record?.text ?? "");
const totals = posts.reduce((sum, post) => ({
  likes: sum.likes + (post.likeCount ?? 0),
  replies: sum.replies + (post.replyCount ?? 0),
  reposts: sum.reposts + (post.repostCount ?? 0)
}), { likes: 0, replies: 0, reposts: 0 });
const snapshot = {
  checkedAt: new Date().toISOString(),
  profile: { followers: profile.followersCount ?? 0, follows: profile.followsCount ?? 0, posts: profile.postsCount ?? 0 },
  last7Days: {
    authoredPosts: posts.length,
    articleIntros: posts.filter(isArticleIntro).length,
    standalonePosts: posts.filter((post) => !isArticleIntro(post)).length,
    interactions: totals,
    interactionRatePerPost: posts.length ? Number(((totals.likes + totals.replies + totals.reposts) / posts.length).toFixed(3)) : 0
  }
};
let history = [];
try { history = JSON.parse(await readFile(snapshotPath, "utf8")); } catch { /* first run */ }
const previous = history.at(-1) ?? null;
history = [...history, snapshot].slice(-26);
await mkdir(resolve(root, "data"), { recursive: true });
await writeFile(snapshotPath, `${JSON.stringify(history, null, 2)}\n`);
const delta = previous ? {
  followers: snapshot.profile.followers - previous.profile.followers,
  follows: snapshot.profile.follows - previous.profile.follows,
  posts: snapshot.profile.posts - previous.profile.posts
} : null;
console.log(JSON.stringify({ snapshot, previous: previous?.checkedAt ?? null, delta }));
