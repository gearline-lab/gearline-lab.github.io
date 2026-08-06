import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), "gearline-bsky-"));
const plan = {
  post: { text: "机の上で毎日使うものを先に決めると、配線を戻しやすくなります。 #GearlineLab #デスク環境" },
  reposts: [],
  follows: []
};
const planPath = join(dir, "plan.json");
await writeFile(planPath, JSON.stringify(plan));
const { stdout } = await execFileAsync(process.execPath, ["scripts/bluesky-daily.mjs", "--dry-run", "--plan", planPath]);
const result = JSON.parse(stdout);
if (!result.valid || result.postCharacters !== [...plan.post.text].length) throw new Error("dry-run validation failed");
console.log("Bluesky daily plan validation passed");
