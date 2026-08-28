import { access, readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
const files = (await readdir(root)).filter((file) => file.endsWith(".html"));
const read = (file) => readFile(resolve(root, file), "utf8");
const articleFiles = [];
const checks = [];
for (const file of files) {
  const html = await read(file);
  const cards = (html.match(/AMAZON_CARD:[A-Z0-9]+:START/gu) ?? []).length;
  if (!cards) continue;
  articleFiles.push(file);
  const required = {
    canonical: /<link\s+rel="canonical"\s+href="https:\/\/gearline-lab\.github\.io\/[^"]+"/u.test(html),
    description: /<meta\s+name="description"\s+content="[^"]{35,}"/u.test(html),
    articleSchema: /"@type":"Article"/u.test(html),
    thumbnail: /class="article-thumbnail"[\s\S]*?<img\s+/u.test(html),
    ogImage: /property="og:image"[\s\S]*?assets\/thumbnails\//u.test(html),
    analytics: /assets\/js\/affiliate-analytics\.js/u.test(html),
    cards: cards >= 2,
    trackingId: /gearlineweb-22/u.test(html),
    purchaseGuidance: /向く|見送る|比較|選び方/u.test(html)
  };
  checks.push({ file, passed: Object.values(required).every(Boolean), required });
}
const sitemap = await read("sitemap.xml");
const missingSitemap = articleFiles.filter((file) => !sitemap.includes(`https://gearline-lab.github.io/${file}`));
const growthPlanExists = await access(resolve(root, "config/next-week-growth-plan.json")).then(() => true).catch(() => false);
const reportInputExists = await access(resolve(root, "config/weekly-report-input.json")).then(() => true).catch(() => false);
const dailyArticlePlanExists = await access(resolve(root, "config/article-publish-plan.json")).then(() => true).catch(() => false);
const result = {
  checkedAt: new Date().toISOString(),
  articleCount: articleFiles.length,
  articlesPassingBaseline: checks.filter((item) => item.passed).length,
  articleChecks: checks,
  missingSitemap,
  nextWeekGrowthPlan: growthPlanExists,
  weeklyOfficialInput: reportInputExists,
  dailyArticlePlan: dailyArticlePlanExists,
  baselineOverall: checks.every((item) => item.passed) && missingSitemap.length === 0 && growthPlanExists,
  publicationReady: checks.every((item) => item.passed) && missingSitemap.length === 0 && growthPlanExists && dailyArticlePlanExists
};
result.overall = result.baselineOverall && result.publicationReady;
await mkdir(resolve(root, "reports"), { recursive: true });
await writeFile(resolve(root, "reports", `cross-functional-check-${today}.json`), `${JSON.stringify(result, null, 2)}\n`);
const failures = checks.flatMap((item) => Object.entries(item.required).filter(([, passed]) => !passed).map(([key]) => `${item.file}:${key}`));
const lines = [
  `# Gearline Lab 横断ヘルスチェック（${today}）`, "",
  `- 記事数: ${result.articleCount}`, `- 基本QA通過: ${result.articlesPassingBaseline}/${result.articleCount}`,
  `- Sitemap未登録: ${missingSitemap.length ? missingSitemap.join(", ") : "なし"}`,
  `- 次週改善指示: ${growthPlanExists ? "あり" : "なし"}`,
  `- 週次公式入力: ${reportInputExists ? "あり" : "なし"}`,
  `- 日次記事プラン: ${dailyArticlePlanExists ? "あり" : "なし"}`, `- 公開準備: ${result.publicationReady ? "完了" : "日次記事プラン待ち"}`, "",
  failures.length ? `## 不足項目\n\n- ${failures.join("\n- ")}` : "## 不足項目\n\n- なし",
  "", "判定はGearline Labのサイトファイルとローカル設定だけを対象にしています。"
];
const report = resolve(root, "reports", `cross-functional-check-${today}.md`);
await writeFile(report, `${lines.join("\n")}\n`);
console.log(JSON.stringify({ report, json: report.replace(/\.md$/u, ".json"), overall: result.overall, articleCount: result.articleCount, missingSitemap }));
