// Never treat a missing Retry-After header as zero seconds.
export function retryDelay(header, attempt, now = Date.now()) {
  const value = String(header ?? "").trim();
  const seconds = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  const date = value ? Date.parse(value) : NaN;
  const supplied = Number.isFinite(seconds) ? seconds * 1000 : date - now;
  return Math.max(5000 * 2 ** attempt, Number.isFinite(supplied) ? supplied : 0);
}

export function validateItem(item) {
  if (!/^[A-Z0-9]{10}$/.test(item?.asin ?? "")) throw new Error("Invalid Amazon ASIN");
  const link = new URL(item.detailPageURL);
  const image = new URL(item.imageURL);
  if (link.protocol !== "https:" || link.hostname !== "www.amazon.co.jp" ||
      link.username || link.password || link.searchParams.get("tag") !== "gearlineweb-22" ||
      image.protocol !== "https:" || image.hostname !== "m.media-amazon.com" ||
      image.username || image.password || !image.pathname.startsWith("/images/")) {
    throw new Error("Amazon link/image failed origin validation");
  }
  return item;
}
