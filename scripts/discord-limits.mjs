// Discord's embed limits, enforced before a post is attempted rather than discovered from a 400.
//
// A digest went silent for a day because embed[0] reached 5909 characters against a 4096 cap and
// the payload totalled 7346 against a 6000 cap. Discord answers that with {"embeds": ["0"]}, which
// names the offending index and nothing else, and the pipeline reported it as a 502 from the edge
// function. The limits are fixed and known, so the payload is trimmed to fit here instead.
//
// https://discord.com/developers/docs/resources/message#embed-object-embed-limits
export const EMBED_DESCRIPTION = 4096;
export const EMBED_TITLE = 256;
export const EMBED_TOTAL = 6000;
export const EMBED_COUNT = 10;

/**
 * Join items into a description that fits, dropping whole items rather than cutting one in half.
 * The tail says what was left out, because a silently shortened list reads as a shorter board.
 */
export function fitItems(items, limit = EMBED_DESCRIPTION, tail = (n) => `\n\n_+${n} more in the app._`) {
  const kept = [];
  let used = 0;
  for (let i = 0; i < items.length; i++) {
    const piece = items[i];
    const sep = kept.length ? 2 : 0; // the "\n\n" between items
    const remaining = items.length - i;
    // Reserve room for the tail only while something is still going to be left out.
    const reserve = remaining > 1 ? tail(remaining).length : 0;
    if (used + sep + piece.length + reserve > limit) break;
    kept.push(piece);
    used += sep + piece.length;
  }
  const dropped = items.length - kept.length;
  // Nothing fit at all: hard-cut the first item so the embed is not empty.
  if (!kept.length && items.length) return items[0].slice(0, limit);
  return kept.join('\n\n') + (dropped > 0 ? tail(dropped) : '');
}

/** Clamp a whole payload's embeds to the per-embed and total limits, in order of importance. */
export function fitEmbeds(embeds) {
  const out = [];
  let total = 0;
  for (const e of embeds.slice(0, EMBED_COUNT)) {
    const title = String(e.title ?? '').slice(0, EMBED_TITLE);
    let description = String(e.description ?? '').slice(0, EMBED_DESCRIPTION);
    const footer = e.footer?.text ? String(e.footer.text) : '';
    const fixed = title.length + footer.length;
    // Drop an embed entirely rather than emit one with an empty description.
    if (total + fixed >= EMBED_TOTAL) break;
    if (total + fixed + description.length > EMBED_TOTAL)
      description = description.slice(0, EMBED_TOTAL - total - fixed);
    if (!description) break;
    out.push({ ...e, title, description });
    total += fixed + description.length;
  }
  return out;
}

/** Everything wrong with a payload, as a list. Empty means Discord will accept it. */
export function validate(payload) {
  const problems = [];
  const embeds = payload.embeds ?? [];
  if (embeds.length > EMBED_COUNT) problems.push(`${embeds.length} embeds, limit ${EMBED_COUNT}`);
  let total = 0;
  embeds.forEach((e, i) => {
    const d = String(e.description ?? '').length;
    const t = String(e.title ?? '').length;
    if (d > EMBED_DESCRIPTION) problems.push(`embeds[${i}].description is ${d}, limit ${EMBED_DESCRIPTION}`);
    if (t > EMBED_TITLE) problems.push(`embeds[${i}].title is ${t}, limit ${EMBED_TITLE}`);
    if (!d) problems.push(`embeds[${i}].description is empty`);
    total += d + t + String(e.footer?.text ?? '').length;
  });
  if (total > EMBED_TOTAL) problems.push(`embeds total ${total} characters, limit ${EMBED_TOTAL}`);
  if (String(payload.content ?? '').length > 2000)
    problems.push(`content is ${payload.content.length}, limit 2000`);
  return problems;
}
