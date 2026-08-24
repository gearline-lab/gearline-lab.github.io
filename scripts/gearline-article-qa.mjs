import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = process.argv[2];
if (!file) throw new Error("記事HTMLのパスを指定してください。");
const preCreator = process.argv.includes("--pre-creator");
const html = await readFile(resolve(process.cwd(), file), "utf8");
const required = [
  ["広告表記", /Amazonアソシエイト|広告|PR/u],
  ["目次", /<nav[^>]+(?:toc|table-of-contents)|目次/u],
  ["Amazon商品カード2件", /AMAZON_CARD:[A-Z0-9]+:START/g],
  ["追跡ID", /gearlineweb-22/u],
  ...(preCreator ? [] : [
    ["Creators API商品画像", /https:\/\/m\.media-amazon\.com\/images\//u],
    ["静的価格なし", /価格・在庫はAmazonの商品ページで最新情報を確認してください。/u]
  ]),
  ["一次情報リンク", /https:\/\//u],
  ["購入判断の条件", /向く|見送る|比較|選び方/u],
  ["関連する内部リンク", /href="[a-z0-9-]+\.html"/u],
  ["サムネイル", /class="article-thumbnail"[\s\S]*?<img\s+/u],
  ["OG画像", /<meta\s+property="og:image"\s+content="https:\/\/gearline-lab\.github\.io\/assets\/thumbnails\//u],
  ["生成画像の明示", /イメージ：|概念図/u],
  ["Amazonクリック計測", /assets\/js\/affiliate-analytics\.js/u]
];
const failures = required.flatMap(([label, pattern]) => {
  const hits = html.match(pattern)?.length ?? 0;
  return label === "Amazon商品カード2件" ? (hits >= 2 ? [] : [label]) : (hits ? [] : [label]);
});
if (failures.length) throw new Error(`公開QA不合格: ${failures.join("、")}`);
console.log(JSON.stringify({ valid: true, file }));
