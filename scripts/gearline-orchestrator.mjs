import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const dateArg = process.argv.find((arg) => arg.startsWith("--date="))?.slice(7);
const date = dateArg ? new Date(`${dateArg}T12:00:00+09:00`) : new Date();
if (Number.isNaN(date.valueOf())) throw new Error("--date は YYYY-MM-DD で指定してください。");
const dateJst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(date);
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Tokyo" }).format(date);
const execute = args.has("--execute");
const dryRun = args.has("--dry-run");
if (execute && dryRun) throw new Error("--execute と --dry-run は同時に指定できません。");

const paths = {
  dailyPlan: resolve(root, "config/bluesky-daily-plan.json"),
  articlePlan: resolve(root, "config/article-publish-plan.json"),
  articleIntroPlan: resolve(root, "config/article-intro-plan.json"),
  reportInput: resolve(root, "config/weekly-report-input.json")
};

const exists = async (path) => access(path).then(() => true).catch(() => false);
// GitHub publishing must use the Gearline Lab credential configured for this
// checkout. A parent shell can carry an unrelated GITHUB_TOKEN, which Git
// prefers over the repository credential and causes a misleading 403.
const childEnv = { ...process.env };
delete childEnv.GITHUB_TOKEN;
// Prefer the authenticated GitHub CLI identity over any stale system
// keychain entry (which can otherwise report a misleading 403 for pushes).
childEnv.GIT_CONFIG_NOSYSTEM = "1";
childEnv.GIT_TERMINAL_PROMPT = "0";
childEnv.GIT_ASKPASS = resolve(root, "scripts/github-askpass.sh");
const run = (command, commandArgs) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(command, commandArgs, { cwd: root, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", rejectRun);
  child.on("close", (code) => code === 0 ? resolveRun(stdout.trim()) : rejectRun(new Error(stderr || `${command} failed: ${code}`)));
});
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const formatJstDate = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(value);
const priorWeekPeriod = () => {
  const start = new Date(date.valueOf());
  start.setDate(start.getDate() - 7);
  const end = new Date(date.valueOf());
  end.setDate(end.getDate() - 1);
  return `${formatJstDate(start)}_to_${formatJstDate(end)}`;
};
const assertRepositoryPath = (path) => {
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${root}${sep}`) || absolute.includes(`${sep}.git${sep}`)) {
    throw new Error(`公開対象外のパスです: ${path}`);
  }
  return absolute;
};
const assertArticlePlan = (plan) => {
  if (!plan || typeof plan !== "object") throw new Error("記事プランはJSONオブジェクトである必要があります。");
  if (plan.publicationType !== "new") throw new Error("日次記事は publicationType: new の新規記事に限定します。既存記事の更新は日次公開として扱えません。");
  if (typeof plan.articleFile !== "string" || !plan.articleFile.endsWith(".html")) throw new Error("articleFile が必要です。");
  if (!/^[a-z0-9-]+\.html$/u.test(plan.articleFile)) throw new Error("articleFile はサイト直下のslug.htmlに限定します。");
  if (!plan.product || !/^[A-Z0-9]{10}$/u.test(plan.product.asin ?? "")) throw new Error("product.asin が必要です。");
  if (plan.product.trackingId !== "gearlineweb-22") throw new Error("記事のtrackingIdは gearlineweb-22 に限定します。");
  if (!/^https:\/\//u.test(plan.product.primarySource ?? "")) throw new Error("一次情報URLが必要です。");
  const intent = plan.searchIntent;
  if (!intent || typeof intent !== "object") throw new Error("検索意図の設計が必要です。");
  for (const key of ["primaryQuery", "readerSituation", "decisionToMake", "comparisonAxis"]) {
    if (typeof intent[key] !== "string" || !intent[key].trim()) throw new Error(`searchIntent.${key} が必要です。`);
  }
  if (intent.primaryQuery.length < 6) throw new Error("searchIntent.primaryQuery は具体的な検索語にしてください。");
  const demand = plan.searchDemand;
  const allowedDemandSignals = new Set(["new-release", "compatibility-change", "comparison-query", "problem-query", "seasonal-demand"]);
  if (!demand || !Array.isArray(demand.signals) || !demand.signals.some((signal) => allowedDemandSignals.has(signal))) {
    throw new Error("検索需要シグナル（新製品・互換性変更・比較・悩み・季節性）を1つ以上設定してください。");
  }
  if (typeof demand.evidence !== "string" || !demand.evidence.trim()) throw new Error("検索需要の根拠が必要です。");
  if (!Number.isFinite(plan.searchOpportunityScore) || plan.searchOpportunityScore < 70 || plan.searchOpportunityScore > 100) {
    throw new Error("searchOpportunityScore は70〜100で設定してください。");
  }
  if (!plan.introPost || typeof plan.introPost.text !== "string") throw new Error("記事紹介投稿が必要です。");
  const url = `https://gearline-lab.github.io/${plan.articleFile}`;
  if (!plan.introPost.text.includes(url)) throw new Error("記事紹介投稿に公開URLがありません。");
  const siteUrls = plan.introPost.text.match(/https:\/\/gearline-lab\.github\.io\/[^\s]+/gu) ?? [];
  if (siteUrls.length !== 1 || siteUrls[0] !== url) throw new Error("記事紹介投稿には対象記事のURLを1件だけ入れてください。");
  if (/(?:amazon\.(?:co\.jp|com)|amzn\.to|tag=|価格|在庫)/iu.test(plan.introPost.text)) throw new Error("記事紹介投稿にAmazonリンク・価格・在庫は含められません。");
  const trackedUrl = new URL(url);
  trackedUrl.searchParams.set("utm_source", "bluesky");
  trackedUrl.searchParams.set("utm_medium", "social");
  trackedUrl.searchParams.set("utm_campaign", "article_intro");
  const introPost = { ...plan.introPost, text: plan.introPost.text.replace(url, trackedUrl.toString()) };
  const files = [...new Set([plan.articleFile, "index.html", "sitemap.xml", "config/amazon-products.json", ...(plan.publishFiles ?? [])])];
  for (const file of files) assertRepositoryPath(file);
  return { ...plan, introPost, files, url };
};

const assertNewDailyArticle = async (plan) => {
  try {
    await run("git", ["cat-file", "-e", `origin/main:${plan.articleFile}`]);
    throw new Error(`日次記事は新規URLである必要があります。既存記事は公開できません: ${plan.articleFile}`);
  } catch (error) {
    if (String(error.message).includes("日次記事は新規URL")) throw error;
  }
  const html = await readFile(assertRepositoryPath(plan.articleFile), "utf8");
  const publishedOn = new RegExp(`datePublished[\\s\\S]{0,80}${dateJst}`, "u");
  if (!publishedOn.test(html)) {
    throw new Error(`新規記事には当日の日付を datePublished として設定してください: ${dateJst}`);
  }
};

const articleExistsOnOrigin = async (articleFile) => {
  try {
    await run("git", ["cat-file", "-e", `origin/main:${articleFile}`]);
    return true;
  } catch {
    return false;
  }
};

const registerArticleInSitemap = async (plan) => {
  const sitemapPath = assertRepositoryPath("sitemap.xml");
  const url = plan.url;
  const entry = `  <url><loc>${url}</loc><lastmod>${dateJst}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>`;
  let sitemap = await readFile(sitemapPath, "utf8");
  const existing = new RegExp(`<url><loc>${url.replaceAll(".", "\\.")}</loc>[\\s\\S]*?</url>`, "u");
  sitemap = existing.test(sitemap)
    ? sitemap.replace(existing, entry)
    : sitemap.replace("</urlset>", `${entry}\n</urlset>`);
  if (!sitemap.includes(`<loc>${url}</loc>`)) throw new Error(`sitemap.xml に記事URLを登録できませんでした: ${url}`);
  await writeFile(sitemapPath, sitemap);
};

const result = {
  date: dateJst,
  mode: execute ? "execute" : "check",
  dailySocial: "waiting-for-validated-plan",
  article: "waiting-for-researched-article-plan",
  weeklyReport: "not-due"
};

// A heartbeat should not stall merely because its ignored, per-run social
// plan has not been materialized yet.  Research is read-only and the planner
// writes a bounded plan; the existing Bluesky runner still performs all
// validation and authenticated side effects.
if (!(await exists(paths.dailyPlan)) && execute) {
  // Search is best-effort.  If the public search endpoint is temporarily
  // unavailable, the planner still emits a verified evergreen post plan;
  // it never fabricates a repost or follow candidate from the failed query.
  try {
    await run("node", ["scripts/bluesky-research.mjs", "config/bluesky-daily-candidates.json"]);
  } catch {
    // prepare-daily-social-plan.mjs will use the evergreen fallback and an
    // empty engagement list when no fresh candidate file is available.
  }
  await run("node", ["scripts/prepare-daily-social-plan.mjs", "config/bluesky-daily-candidates.json"]);
}

if (!(await exists(paths.articlePlan)) && execute) {
  // Use the latest locally verified Creator-API result to materialize a new
  // article URL and its QA-ready draft.  The publication path below still
  // performs the final Creator API card refresh and all existing QA gates.
  await run("node", ["scripts/prepare-daily-article-plan.mjs"]);
}

if (await exists(paths.dailyPlan)) {
  if (execute) {
    result.dailySocial = JSON.parse(await run("zsh", ["scripts/run-bluesky-daily-with-keychain.sh"]));
    await rm(paths.dailyPlan, { force: true });
  } else {
    result.dailySocial = JSON.parse(await run("zsh", ["scripts/run-bluesky-daily-with-keychain.sh", "--dry-run"]));
  }
}

if (await exists(paths.articlePlan)) {
  const plan = assertArticlePlan(await readJson(paths.articlePlan));
  if (execute) await run("git", ["fetch", "origin", "main"]);
  // A completed publish can leave its local, ignored plan behind if an
  // earlier run stopped after pushing. It must not block all later daily and
  // Monday work; only discard it after confirming the exact URL is on main.
  if (await articleExistsOnOrigin(plan.articleFile)) {
    if (execute) await rm(paths.articlePlan, { force: true });
    result.article = execute ? "stale-published-plan-cleared" : "stale-published-plan";
  } else {
    await assertNewDailyArticle(plan);
    await run("node", ["scripts/gearline-article-qa.mjs", plan.articleFile, "--pre-creator"]);
    result.article = execute ? "qa-passed-awaiting-publish" : "qa-passed";
    if (execute) {
    await registerArticleInSitemap(plan);
    const slug = plan.articleFile.replace(/\.html$/u, "");
    const branch = `agent/publish-${slug}-${dateJst.replaceAll("-", "")}-${Date.now().toString(36)}`;
    const changed = await run("git", ["status", "--porcelain", "--", ...plan.files]);
    if (!changed) throw new Error("記事公開対象に未コミット変更がありません。");
    await run("git", ["checkout", "main"]);
    // A local run may have created maintenance commits through the GitHub API
    // while the remote also advanced. Merge the fetched main safely instead
    // of stopping on a non-fast-forward divergence.
    await run("git", ["merge", "--no-edit", "--no-ff", "origin/main"]);
    await run("git", ["checkout", "-b", branch]);
    await run("git", ["add", "--", ...plan.files]);
    await run("git", ["commit", "-m", `Publish ${plan.articleFile}`]);
    await run("git", ["push", "origin", `HEAD:refs/heads/${branch}`]);
    await run("node", ["scripts/run-amazon-card-workflow-with-keychain.mjs", "--ref", branch]);
    await run("git", ["fetch", "origin", branch]);
    // A one-off fetch stores the remote branch in FETCH_HEAD even when no
    // local remote-tracking ref exists. Merge that explicit revision.
    await run("git", ["merge", "--ff-only", "FETCH_HEAD"]);
    await run("node", ["scripts/gearline-article-qa.mjs", plan.articleFile]);
    await run("git", ["push", "origin", "HEAD:main"]);
    await run("git", ["checkout", "main"]);
    await run("git", ["merge", "--ff-only", "origin/main"]);
    await mkdir(resolve(root, "config"), { recursive: true });
    await writeFile(paths.articleIntroPlan, `${JSON.stringify({ post: plan.introPost, reposts: [], follows: [] }, null, 2)}\n`);
    const intro = JSON.parse(await run("zsh", ["scripts/run-bluesky-daily-with-keychain.sh", "--article-intro", "--plan", "config/article-intro-plan.json"]));
    await rm(paths.articleIntroPlan, { force: true });
    await rm(paths.articlePlan, { force: true });
      result.article = { published: plan.url, introPost: intro.posted };
    }
  }
}

if (weekday === "Mon") {
  result.weeklyReport = "waiting-for-official-amazon-report-input";
  if (await exists(paths.reportInput)) {
    const report = JSON.parse(await run("node", ["scripts/gearline-weekly-report.mjs", "config/weekly-report-input.json"]));
    const growth = JSON.parse(await run("node", ["scripts/gearline-growth-review.mjs", "config/weekly-report-input.json"]));
    result.weeklyReport = { report, growth };
  } else if (execute) {
    const period = priorWeekPeriod();
    const report = JSON.parse(await run("node", ["scripts/gearline-weekly-report.mjs", "--zero", `--period=${period}`]));
    const growth = JSON.parse(await run("node", ["scripts/gearline-growth-review.mjs", "--zero", `--period=${period}`]));
    result.weeklyReport = { report, growth };
  }
}

console.log(JSON.stringify(result));
