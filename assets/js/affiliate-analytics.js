(() => {
  const affiliateHost = /(^|\.)amazon\.co\.jp$/u;
  const trackedLinks = document.querySelectorAll('a[href*="amazon.co.jp/"]');

  const placementFor = (link) => {
    const card = link.closest('.product-card');
    if (!card) return 'inline-link';
    const cards = [...document.querySelectorAll('.product-card')];
    const index = cards.indexOf(card);
    if (index === 0) return 'intro-card';
    if (index === cards.length - 1) return 'closing-card';
    return `card-${index + 1}`;
  };

  trackedLinks.forEach((link) => {
    let url;
    try {
      url = new URL(link.href);
    } catch {
      return;
    }
    if (!affiliateHost.test(url.hostname) || !url.searchParams.get('tag')?.startsWith('gearline')) return;
    const asin = url.pathname.match(/\/dp\/([A-Z0-9]{10})/iu)?.[1] ?? 'unknown';
    link.addEventListener('click', () => {
      if (typeof window.gtag !== 'function') return;
      window.gtag('event', 'affiliate_click', {
        affiliate_asin: asin,
        article_slug: location.pathname.replace(/^\//u, '').replace(/\.html$/u, '') || 'index',
        placement: placementFor(link),
        transport_type: 'beacon'
      });
    }, { passive: true });
  });
})();
