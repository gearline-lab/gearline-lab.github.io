import { test } from "node:test";
import assert from "node:assert/strict";
import { retryDelay, validateItem } from "./amazon-request-policy.mjs";
test("missing, empty or zero Retry-After never creates a busy retry", () => {
  for (const header of [null, "", "0", "garbage"]) assert.equal(retryDelay(header, 0), 5000);
  assert.equal(retryDelay(null, 2), 20000);
  assert.equal(retryDelay("60", 0), 60000);
  assert.equal(retryDelay("Thu, 01 Jan 1970 00:01:00 GMT", 0, 0), 60000);
});
const valid = { asin: "B0B1Q6VB16", detailPageURL: "https://www.amazon.co.jp/dp/B0B1Q6VB16?tag=gearlineweb-22", imageURL: "https://m.media-amazon.com/images/I/example.jpg" };
test("only Gearline Japan links and Amazon image origins are accepted", () => {
  assert.equal(validateItem(valid), valid);
  for (const detailPageURL of ["https://evil.example/?tag=gearlineweb-22", "https://www.amazon.co.jp.evil.example/?tag=gearlineweb-22", "https://www.amazon.co.jp/?tag=other-22", "http://www.amazon.co.jp/?tag=gearlineweb-22"]) assert.throws(() => validateItem({ ...valid, detailPageURL }));
  assert.throws(() => validateItem({ ...valid, imageURL: "https://evil.example/image.jpg" }));
});
