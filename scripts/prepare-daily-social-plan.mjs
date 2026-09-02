import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Turn the research result into a bounded Bluesky execution plan.  This is
// deliberately content-conservative: it never copies candidate text and it
// only uses the already safety-filtered URI/DID fields for optional follows.
const root = process.cwd();
const output = resolve(root, "config/bluesky-daily-plan.json");
const candidatesArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const candidatesPath = resolve(root, candidatesArg ?? "config/bluesky-daily-candidates.json");
const dateArg = process.argv.find((arg) => arg.startsWith("--date="))?.slice(7);
const date = dateArg ? new Date(`${dateArg}T12:00:00+09:00`) : new Date();
if (Number.isNaN(date.valueOf())) throw new Error("--date は YYYY-MM-DD で指定してください。");
const day = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", day: "numeric" }).format(date));

const evergreen = [
  ["接続と配線", "USB-Cハブを選ぶときは、端子の数より先に「映像・データ・給電」の役割を分けて確認します。同じ形でも対応する信号は別です。使う機器ごとに必要な規格を書き出すと、買った後の挿し直しを減らせます。", ["#USBCHub", "#配線整理"]],
  ["入力デバイス", "キーボードの比較では、配列だけでなく数字入力の頻度とマウスまでの距離を先に決めると選びやすくなります。テンキーを残すかどうかは、机の幅と作業内容の条件分岐で考えるのが安全です。", ["#キーボード", "#デスク環境"]],
  ["机上配置", "ドックや充電器は、毎日抜き差しする端子と固定する端子を分けて置くと、配線の戻し先が決まります。見た目を整える前に、手元で使う端子を一つに絞るのが失敗回避の近道です。", ["#デスク環境", "#配線整理"]],
  ["3Dプリントの実用", "3Dプリントの実用品は、造形前に「交換する部品か、固定する部品か」を決めると寸法の考え方が変わります。固定用なら荷重方向と取り付け穴を先に確認し、見た目だけで厚みを決めないことが重要です。", ["#3Dプリント", "#ものづくり"]],
  ["購入前比較", "製品比較で迷ったら、スペック表を増やす前に「今の不便を一つだけ解消できるか」を書き出します。候補ごとに、向く条件と見送る条件を一行で並べると、機能の多さに引っ張られにくくなります。", ["#購入ガイド", "#ガジェット"]],
  ["macOS作業", "Macの周辺機器は、接続できるかだけでなく、スリープ復帰後も同じ状態で戻るかを確認します。外部ディスプレイやUSB機器を常用するなら、購入前に自分のMacの対応仕様と接続経路を一度図にすると安心です。", ["#Mac周辺機器", "#Mac"]],
  ["メンテナンス安全", "机まわりの電源タップを見直すときは、口数を増やす前に消費電力の大きい機器を洗い出します。ACアダプターが隣の差し口を塞ぐ場合もあるので、配置と定格を一緒に確認するのが安全です。", ["#デスク環境", "#ガジェット"]]
];

const hasFile = await access(candidatesPath).then(() => true).catch(() => false);
const source = hasFile ? JSON.parse(await readFile(candidatesPath, "utf8")) : { candidates: [] };
const checkedAt = Date.parse(source.checkedAt ?? "");
const fresh = Number.isFinite(checkedAt) && Date.now() - checkedAt <= 24 * 60 * 60 * 1000;
const candidates = fresh && Array.isArray(source.candidates) ? source.candidates : [];
const seenDids = new Set();
const follows = [];
for (const candidate of candidates) {
  const did = candidate?.author?.did;
  if (!did?.startsWith("did:") || seenDids.has(did)) continue;
  seenDids.add(did);
  follows.push({ did });
  if (follows.length === 3) break;
}

const [, text, hashtags] = evergreen[(day - 1) % evergreen.length];
const plan = {
  post: { text: `${text} ${hashtags.join(" ")}` },
  // Reposts remain opt-in from the researched plan; an empty list is safer
  // than repeating a post when the candidate feed has not been rechecked.
  reposts: [],
  follows,
  generatedAt: new Date().toISOString(),
  source: fresh ? "bluesky-research" : "evergreen-fallback"
};
await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({ output, theme: evergreen[(day - 1) % evergreen.length][0], follows: follows.length }));
