// Handing a slip to GamblyBot, which turns plain text into a one-click betslip deep linked to
// every book it supports.
//
// This cannot be automated and that is not a limitation of ours: GamblyBot ignores messages from
// other bots. Posting the slip with our own bot was tried three ways in the members' Discord and
// drew no reply; the identical text sent by a person was answered in eleven seconds. So the app's
// job is to make the member's own message trivial to send, not to send it for them.
//
// Gambly matches each line to a live market. It does NOT honour the number we quote: a slip sent
// with Ohio State -14.5 came back as -42.5, still reported as "3/3 bets found". The slip in this
// app stays the price of record and the member has to check the book's line before placing.
import type { SlipItem } from './slip';

/** GamblyBot's user id. `<@id>` renders as a real mention when a person pastes it. */
export const GAMBLY_BOT_ID = '1338973806383071392';

export const GAMBLY_WARNING =
  'Gambly matches your picks to whatever line is live now, which may not be the number on this slip. Check each leg before you place it.';

const fmt = (n: number | null | undefined) => (n == null ? '' : n > 0 ? ` +${n}` : ` ${n}`);

/**
 * One bet per line and nothing else. Our own slip text carries numbering, units, book names and a
 * tagline, all of which are noise to a parser, so this strips back to what Gambly reads.
 */
export function gamblyLines(items: SlipItem[]): string[] {
  const lines: string[] = [];
  for (const i of items) {
    // A parlay's legs are each their own bet; the ticket's name means nothing to a parser.
    if (i.legs && i.legs.length > 1) for (const l of i.legs) lines.push(`${l.label}${fmt(l.price)}`);
    else if (i.legs?.length === 1) lines.push(`${i.legs[0].label}${fmt(i.legs[0].price ?? i.price)}`);
    else lines.push(`${i.label}${fmt(i.price)}`);
  }
  // The same leg can appear in several tickets; sending it twice builds a slip with duplicates.
  return [...new Set(lines)];
}

/** The message the member sends. The mention has to be first for the bot to pick it up. */
export function gamblyMessage(items: SlipItem[]): string {
  const lines = gamblyLines(items);
  if (!lines.length) return '';
  return `<@${GAMBLY_BOT_ID}>\n${lines.join('\n')}`;
}

/**
 * Where to send them. The app scheme opens the Discord app directly on a phone; the https form is
 * the fallback and what the web build needs.
 */
export function discordChannelUrl(guildId: string, channelId: string, app = false): string {
  const path = `channels/${guildId}/${channelId}`;
  return app ? `discord://discord.com/${path}` : `https://discord.com/${path}`;
}
