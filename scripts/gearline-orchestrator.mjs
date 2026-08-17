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
const assertRepositoryPath = (path) => {
  const absolute = resolve(root, path);
  if (!absolute.startsWith(`${root}${sep}`) || absolute.includes(`${sep}.git${sep}`)) {
    throw new Error(`公開対象外のパスです: ${path}`);
  }
  return absolute;
};
const assertArticlePlan = (plan) => {
  if (!plan || typeof plan !== "object") throw new Error("記事プランはJSONオブジェクトである必要があります。");
  if (typeof plan.articleFile !== "string" || !plan.articleFile.endsWith(".html")) throw new Error("articleFile が必要です。");
  if (!/^[a-z0-9-]+\.html$/u.test(plan.articleFile)) throw new Error("articleFile はサイト直下のslug.htmlに限定します。");
  if (!plan.product || !/^[A-Z0-9]{10}$/u.test(plan.product.asin ?? "")) throw new Error("product.asin が必要です。");
  if (plan.product.trackingId !== "gearlineweb-22") throw new Error("記事のtrackingIdは gearlineweb-22 に限定します。");
  if (!/^https:\/\//u.test(plan.product.primarySource ?? "")) throw new Error("一次情報URLが必要です。");
  if (!plan.introPost || typeof plan.introPost.text !== "string") throw new Error("記事紹介投稿が必要です。");
  const url = `https://gearline-lab.github.io/${plan.articleFile}`;
  if (!plan.introPost.text.includes(url)) throw new Error("記事紹介投稿に公開URLがありません。");
  const files = [...new Set([plan.articleFile, "index.html", "config/amazon-products.json", ...(plan.publishFiles ?? [])])];
  for (const file of files) assertRepositoryPath(file);
  return { ...plan, files, url };
};

const result = {
  date: dateJst,
  mode: execute ? "execute" : "check",
  dailySocial: "waiting-for-validated-plan",
  article: "waiting-for-researched-article-plan",
  weeklyReport: "not-due"
};

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
  await run("node", ["scripts/gearline-article-qa.mjs", plan.articleFile, "--pre-creator"]);
  result.article = execute ? "qa-passed-awaiting-publish" : "qa-passed";
  if (execute) {
    const slug = plan.articleFile.replace(/\.html$/u, "");
    const branch = `agent/publish-${slug}-${dateJst.replaceAll("-", "")}-${Date.now().toString(36)}`;
    const changed = await run("git", ["status", "--porcelain", "--", ...plan.files]);
    if (!changed) throw new Error("記事公開対象に未コミット変更がありません。");
    await run("git", ["fetch", "origin", "main"]);
    await run("git", ["checkout", "main"]);
    await run("git", ["merge", "--ff-only", "origin/main"]);
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

if (weekday === "Mon") {
  result.weeklyReport = "waiting-for-official-amazon-report-input";
  if (await exists(paths.reportInput)) {
    result.weeklyReport = JSON.parse(await run("node", ["scripts/gearline-weekly-report.mjs", "config/weekly-report-input.json"]));
  }
}

console.log(JSON.stringify(result));
