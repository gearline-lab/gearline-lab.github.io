import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const planFlagIndex = process.argv.indexOf("--plan");
const planPath = planFlagIndex >= 0
  ? process.argv[planFlagIndex + 1]
  : "config/bluesky-daily-plan.json";
const dryRun = args.has("--dry-run");
const verifySession = args.has("--verify-session");
const articleIntro = args.has("--article-intro");
const root = process.cwd();
const forbiddenUrl = /(?:https?:\/\/|www\.|amzn\.to|amazon\.[a-z.]+|tag=)/iu;
const gearlineSiteUrl = /https:\/\/gearline-lab\.github\.io\/[a-z0-9-]+\.html(?:\?[^\s]+)?/giu;

const buildHashtagFacets = (text) => [...text.matchAll(/#[\p{L}\p{N}_]+/gu)].map((match) => {
  const start = Buffer.byteLength(text.slice(0, match.index), "utf8");
  const end = start + Buffer.byteLength(match[0], "utf8");
  return {
    index: { byteStart: start, byteEnd: end },
    features: [{ $type: "app.bsky.richtext.facet#tag", tag: match[0].slice(1) }]
  };
});

const buildLinkFacets = (text) => [...text.matchAll(gearlineSiteUrl)].map((match) => {
  const start = Buffer.byteLength(text.slice(0, match.index), "utf8");
  const end = start + Buffer.byteLength(match[0], "utf8");
  return {
    index: { byteStart: start, byteEnd: end },
    features: [{ $type: "app.bsky.richtext.facet#link", uri: match[0] }]
  };
});

const fail = (message) => {
  throw new Error(`Bluesky daily plan: ${message}`);
};

const readPlan = async () => JSON.parse(await readFile(resolve(root, planPath), "utf8"));

const assertPlan = (plan, { articleIntro = false } = {}) => {
  if (!plan || typeof plan !== "object") fail("JSONオブジェクトが必要です。");
  if (!plan.post || typeof plan.post.text !== "string") fail("post.text が必要です。");
  const text = plan.post.text.trim();
  if (!text) fail("投稿本文が空です。");
  if ([...text].length > 300) fail("投稿は300文字以内にしてください。");
  const hashtags = buildHashtagFacets(text);
  if (hashtags.length < 1 || hashtags.length > 2) fail("検索用のテーマハッシュタグを1〜2件付けてください。");
  if (/(?:^|\s)#GearlineLab(?:\s|$)/u.test(text)) fail("#GearlineLab ではなく、テーマに合う検索用ハッシュタグを使ってください。");
  const hasForbiddenUrl = forbiddenUrl.test(text);
  const siteUrls = [...text.matchAll(gearlineSiteUrl)];
  if (articleIntro) {
    const allUrls = [...text.matchAll(/https?:\/\/[^\s]+/gu)];
    if (allUrls.length !== 1 || siteUrls.length !== 1 || /(?:amazon|amzn\.to|tag=)/iu.test(text)) {
      fail("記事紹介投稿にはGearline Labの記事URLを1件だけ含められます。");
    }
  } else if (hasForbiddenUrl) {
    fail("日次投稿にURL・アフィリエイトリンクは含められません。");
  }
  if (Array.isArray(plan.reposts) && plan.reposts.length > 3) fail("リポストは最大3件です。");
  if (Array.isArray(plan.follows) && plan.follows.length > 3) fail("フォローは最大3件です。");
  for (const repost of plan.reposts ?? []) {
    if (!repost?.uri?.startsWith("at://") || !repost?.cid) fail("リポストには uri と cid が必要です。");
  }
  for (const follow of plan.follows ?? []) {
    if (!follow?.did?.startsWith("did:")) fail("フォローには DID が必要です。");
  }
  return { ...plan, post: { text }, reposts: plan.reposts ?? [], follows: plan.follows ?? [] };
};

const api = async (service, path, options = {}) => {
  const response = await fetch(`${service}/xrpc/${path}`, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} が失敗しました: ${response.status} ${body.slice(0, 300)}`);
  }
  return response.json();
};

const createRecord = (service, accessJwt, repo, collection, record) => api(service, "com.atproto.repo.createRecord", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessJwt}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ repo, collection, record })
});

const hasDuplicateRecentPost = async (service, accessJwt, actor, text) => {
  const feed = await api(service, `app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=100`, {
    headers: { Authorization: `Bearer ${accessJwt}` }
  });
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  return (feed.feed ?? []).some(({ post }) =>
    post?.record?.text?.trim() === text && Date.parse(post.indexedAt ?? post.record?.createdAt ?? 0) >= cutoff
  );
};

if (verifySession && dryRun) fail("--verify-session と --dry-run は同時に指定できません。");

if (dryRun) {
  const plan = assertPlan(await readPlan(), { articleIntro });
  console.log(JSON.stringify({ valid: true, postCharacters: [...plan.post.text].length, hashtags: buildHashtagFacets(plan.post.text).length, links: buildLinkFacets(plan.post.text).length, reposts: plan.reposts.length, follows: plan.follows.length }));
  process.exit(0);
}

const identifier = process.env.BSKY_IDENTIFIER?.trim();
const password = process.env.BSKY_APP_PASSWORD?.trim();
const service = (process.env.BSKY_SERVICE?.trim() || "https://bsky.social").replace(/\/$/, "");
if (!identifier || !password) fail("BSKY_IDENTIFIER と BSKY_APP_PASSWORD を環境変数で設定してください。");
if (service !== "https://bsky.social") fail("認証先は公式の https://bsky.social に限定されています。");

const session = await api(service, "com.atproto.server.createSession", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier, password })
});

if (verifySession) {
  console.log(JSON.stringify({ connected: true, did: session.did, handle: session.handle }));
  process.exit(0);
}

const plan = assertPlan(await readPlan(), { articleIntro });

if (await hasDuplicateRecentPost(service, session.accessJwt, session.did, plan.post.text)) {
  fail("直近14日以内に同じ本文の投稿があります。実行を中止しました。");
}

const now = new Date().toISOString();
const results = {};
results.post = await createRecord(service, session.accessJwt, session.did, "app.bsky.feed.post", {
  $type: "app.bsky.feed.post",
  text: plan.post.text,
  facets: [...buildHashtagFacets(plan.post.text), ...buildLinkFacets(plan.post.text)],
  createdAt: now
});

results.reposts = [];
for (const repost of plan.reposts) {
  results.reposts.push(await createRecord(service, session.accessJwt, session.did, "app.bsky.feed.repost", {
    $type: "app.bsky.feed.repost",
    subject: { uri: repost.uri, cid: repost.cid },
    createdAt: new Date().toISOString()
  }));
}

results.follows = [];
for (const follow of plan.follows) {
  results.follows.push(await createRecord(service, session.accessJwt, session.did, "app.bsky.graph.follow", {
    $type: "app.bsky.graph.follow",
    subject: follow.did,
    createdAt: new Date().toISOString()
  }));
}

console.log(JSON.stringify({
  posted: results.post.uri,
  reposted: results.reposts.length,
  followed: results.follows.length
}));
