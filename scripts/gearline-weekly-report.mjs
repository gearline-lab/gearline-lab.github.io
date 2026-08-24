import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const zeroMode = process.argv.includes("--zero");
const inputPath = process.argv.find((arg) => !arg.startsWith("--") && arg !== process.argv[0] && arg !== process.argv[1]);
const periodArg = process.argv.find((arg) => arg.startsWith("--period="))?.slice(9);
if (!zeroMode && !inputPath) throw new Error("Amazon公式画面から転記したJSONのパスを指定してください。");
if (zeroMode && !/^\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}$/u.test(periodArg ?? "")) {
  throw new Error("--zero では --period=YYYY-MM-DD_to_YYYY-MM-DD が必要です。");
}
const input = zeroMode
  ? {
      period: periodArg,
      targetFee: 0,
      amazonVerification: {
        source: "Amazon Associates official UI",
        status: "zero-activity-confirmed",
        verifiedAt: new Date().toISOString()
      },
      trackingIds: [
        { id: "gearlineweb-22", clicks: 0, orders: 0, shipped: 0, sales: 0, fee: 0 },
        { id: "gearlinebsky-22", clicks: 0, orders: 0, shipped: 0, sales: 0, fee: 0 }
      ]
    }
  : JSON.parse(await readFile(resolve(process.cwd(), inputPath), "utf8"));
const expectedIds = ["gearlineweb-22", "gearlinebsky-22"];
if (!Array.isArray(input.trackingIds) || input.trackingIds.length !== 2 || new Set(input.trackingIds.map((row) => row.id)).size !== 2 || !input.trackingIds.every((row) => expectedIds.includes(row.id))) {
  throw new Error("gearlineweb-22 と gearlinebsky-22 だけを入力してください。");
}
for (const row of input.trackingIds) {
  for (const key of ["clicks", "orders", "shipped", "sales", "fee"]) {
    if (!Number.isFinite(Number(row[key])) || Number(row[key]) < 0) throw new Error(`Amazon ${row.id} の ${key} は0以上の数値で入力してください。`);
  }
}
const totals = input.trackingIds.reduce((sum, row) => ({
  clicks: sum.clicks + Number(row.clicks || 0), orders: sum.orders + Number(row.orders || 0),
  shipped: sum.shipped + Number(row.shipped || 0), sales: sum.sales + Number(row.sales || 0), fee: sum.fee + Number(row.fee || 0)
}), { clicks: 0, orders: 0, shipped: 0, sales: 0, fee: 0 });
const cvr = totals.clicks ? (totals.orders / totals.clicks * 100).toFixed(2) : "0.00";
const analytics = input.analytics?.ga4;
const searchConsole = input.analytics?.searchConsole;
const nonNegative = (value, label) => {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`${label} は0以上の数値で入力してください。`);
  return Number(value);
};
let analyticsLines = ["## GA4 サイト利用状況", "", "- GA4の確認済み値は未入力です。次回、GA4公式画面で確認した値を入力してください。"];
if (analytics) {
  if (analytics.measurementId !== "G-711HXNH46X") throw new Error("GA4の測定IDは G-711HXNH46X に限定します。");
  if (analytics.source !== "Google Analytics 4 official UI") throw new Error("GA4の値はGoogle Analytics 4公式画面で確認したものだけを入力してください。");
  for (const [key, label] of [["activeUsers", "アクティブユーザー"], ["sessions", "セッション"], ["views", "表示回数"], ["engagementRate", "エンゲージメント率"], ["averageEngagementTimeSeconds", "平均エンゲージメント時間"], ["outboundClicks", "外部リンククリック"], ["affiliateCardViews", "Amazonカード表示"], ["affiliateClicks", "Amazonアフィリエイトクリック"]]) nonNegative(analytics[key] ?? 0, label);
  const rate = Number(analytics.engagementRate ?? 0).toFixed(2);
  const avgTime = Number(analytics.averageEngagementTimeSeconds ?? 0).toFixed(1);
  analyticsLines = [
    "## GA4 サイト利用状況", "",
    `- 測定ID: ${analytics.measurementId}`,
    `- 確認元: ${analytics.source}`,
    `- 確認時刻: ${analytics.verifiedAt ?? "未記録"}`,
    "",
    "| アクティブユーザー | セッション | 表示回数 | エンゲージメント率 | 平均エンゲージメント時間 | 外部リンククリック | Amazonカード表示 | Amazonクリック |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|",
    `| ${analytics.activeUsers ?? 0} | ${analytics.sessions ?? 0} | ${analytics.views ?? 0} | ${rate}% | ${avgTime}秒 | ${analytics.outboundClicks ?? 0} | ${analytics.affiliateCardViews ?? 0} | ${analytics.affiliateClicks ?? 0} |`,
    "",
    "- GA4は計測開始直後や集計遅延中に値が変動するため、紹介料・注文数とは別指標として扱います。"
  ];
}
let searchConsoleLines = ["## Google Search Console 検索流入", "", "- Search Consoleの確認済み値は未入力です。次回、検索パフォーマンス画面で確認した値を入力してください。"];
if (searchConsole) {
  if (searchConsole.source !== "Google Search Console official UI") throw new Error("Search Consoleの値はGoogle Search Console公式画面で確認したものだけを入力してください。");
  for (const [key, label] of [["clicks", "クリック数"], ["impressions", "表示回数"], ["ctr", "CTR"], ["averagePosition", "平均掲載順位"]]) nonNegative(searchConsole[key] ?? 0, `Search Console ${label}`);
  searchConsoleLines = [
    "## Google Search Console 検索流入", "",
    `- 確認元: ${searchConsole.source}`,
    `- 確認時刻: ${searchConsole.verifiedAt ?? "未記録"}`,
    "",
    "| クリック | 表示回数 | CTR | 平均掲載順位 |",
    "|---:|---:|---:|---:|",
    `| ${searchConsole.clicks ?? 0} | ${searchConsole.impressions ?? 0} | ${Number(searchConsole.ctr ?? 0).toFixed(2)}% | ${Number(searchConsole.averagePosition ?? 0).toFixed(1)} |`,
    "",
    "- Search Consoleは検索結果上の露出指標です。GA4の訪問・Amazonクリックとは別に比較します。"
  ];
}
const improvementLines = totals.clicks === 0
  ? [
      "## 改善案", "",
      "1. **大｜新規URLの記事資産を増やす** — 変更対象: 日次記事フロー。既存記事の更新を日次本数に含めず、検索意図が異なる新規URLを毎日1本公開する。期待指標: Search Consoleの表示回数とGA4表示回数。検証方法: 次週、公開した新規URL数と検索表示を確認する。",
      "2. **中｜記事内の購入判断を先に置く** — 変更対象: 新規記事テンプレート。導入直後に『向く条件・見送る条件』と商品カードを置く。期待指標: GA4のAmazonクリック。検証方法: 次週、商品カードのクリックイベントを記事別に比較する。",
      "3. **小｜SNSからの流入を識別する** — 変更対象: 記事紹介投稿。記事URLを1件だけ使い、投稿テーマと記事の結論を分ける。期待指標: GA4セッションと記事紹介投稿への公開反応。検証方法: 次週、投稿別の流入と反応を記録する。"
    ]
  : [
      "## 改善案", "",
      "- 実績データを確認後、優先度（大・中・小）ごとに最大3件をCodexが追記します。"
    ];
const lines = [
  `# Gearline Lab 週次収益レポート（${input.period}）`, "", "| ID | クリック | 注文 | 発送済 | 売上 | 紹介料 |", "|---|---:|---:|---:|---:|---:|",
  ...input.trackingIds.map((r) => `| ${r.id} | ${r.clicks || 0} | ${r.orders || 0} | ${r.shipped || 0} | ${r.sales || 0} | ${r.fee || 0} |`),
  `| 合計 | ${totals.clicks} | ${totals.orders} | ${totals.shipped} | ${totals.sales} | ${totals.fee} |`, "",
  `- CVR: ${cvr}%`, `- 週次紹介料目標: ${input.targetFee}円`, `- 目標差: ${totals.fee - Number(input.targetFee || 0)}円`, "",
  ...(input.amazonVerification ? [
    "## Amazonアソシエイト確認", "",
    `- 確認元: ${input.amazonVerification.source}`,
    `- 状態: ${input.amazonVerification.status}`,
    `- 確認時刻: ${input.amazonVerification.verifiedAt ?? "未記録"}`,
    "",
    "- 対象IDの活動が表示されないことを公式画面で確認した週は、推測ではなくゼロ実績として集計します。"
  ] : []),
  ...(input.amazonVerification ? [""] : []),
  ...analyticsLines, "",
  ...searchConsoleLines, "",
  ...improvementLines
];
await mkdir(resolve(process.cwd(), "reports"), { recursive: true });
const output = resolve(process.cwd(), "reports", `weekly-${input.period}.md`);
await writeFile(output, `${lines.join("\n")}\n`);
console.log(JSON.stringify({ report: output, totals, cvr, analyticsIncluded: Boolean(analytics), searchConsoleIncluded: Boolean(searchConsole) }));
