import Parser from 'rss-parser';

// reddit was the original plan here, but its api now requires an approved
// Devvit app + explicit written approval for any use that isn't a Reddit-
// hosted app (see reddit's Data API Terms) -- not a fit for "read a few
// headlines into another app". Plain RSS is the opposite: publishers put
// these feeds up specifically to be read by outside software, no signup,
// no key, no approval process.
const parser = new Parser({
  customFields: {
    item: [
      ['media:thumbnail', 'mediaThumbnail'],
      ['media:content', 'mediaContent'],
    ],
  },
  requestOptions: { headers: { 'User-Agent': 'VonBookBot/1.0 (birthday present app; contact: dajuan.hume@gmail.com)' } },
});

// one feed per topic the birthday boy asked for -- gaming, anime, movies,
// and superhero movies/games (screenrant covers both). `label` is only
// used for VonBot's caption, not for fetching.
export const FEEDS = [
  { label: 'gaming', url: 'https://feeds.ign.com/ign/games-all' },
  { label: 'anime', url: 'https://myanimelist.net/rss/news.xml' },
  { label: 'movies', url: 'https://www.slashfilm.com/feed/' },
  { label: 'superhero movies & games', url: 'https://screenrant.com/feed/' },
];

// checked against 4 real feeds while building this -- none of them agree
// on where the image lives (a plain <enclosure>, a <media:thumbnail> as
// either a bare url or a url="" attribute, or nothing at all outside an
// <img> tag buried in the article body), so this tries each in turn.
function extractImage(item) {
  if (item.enclosure?.url) return item.enclosure.url;
  if (typeof item.mediaThumbnail === 'string') return item.mediaThumbnail;
  if (item.mediaThumbnail?.$?.url) return item.mediaThumbnail.$.url;
  if (typeof item.mediaContent === 'string') return item.mediaContent;
  if (item.mediaContent?.$?.url) return item.mediaContent.$.url;
  const match = /<img[^>]+src="([^"]+)"/i.exec(item.content || item['content:encoded'] || '');
  return match?.[1] || null;
}

// latest items from one feed, image-only (VonBot only knows how to post
// images -- see lib/vonbot.js). feeds are already newest-first.
export async function fetchFeedItems(source, limit = 10) {
  const feed = await parser.parseURL(source.url);
  return feed.items
    .slice(0, limit)
    .map((item) => ({
      id: item.guid || item.link,
      title: item.title,
      imageUrl: extractImage(item),
      link: item.link,
      label: source.label,
    }))
    .filter((item) => item.id && item.title && item.imageUrl);
}
