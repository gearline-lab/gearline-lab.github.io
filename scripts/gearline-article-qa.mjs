import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = process.argv[2];
if (!file) throw new Error("記事HTMLのパスを指定してください。");
const html = await readFile(resolve(process.cwd(), file), "utf8");
const required = [
  ["広告表記", /Amazonアソシエイト|広告|PR/u],
  ["目次", /<nav[^>]+(?:toc|table-of-contents)|目次/u],
  ["Amazon商品カード2件", /AMAZON_CARD:[A-Z0-9]+:START/g],
  ["追跡ID", /gearlineweb-22/u],
  ["一次情報リンク", /https:\/\//u]
];
const failures = required.flatMap(([label, pattern]) => {
  const hits = html.match(pattern)?.length ?? 0;
  return label === "Amazon商品カード2件" ? (hits >= 2 ? [] : [label]) : (hits ? [] : [label]);
});
if (failures.length) throw new Error(`公開QA不合格: ${failures.join("、")}`);
console.log(JSON.stringify({ valid: true, file }));
