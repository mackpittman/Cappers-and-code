// What we hand GamblyBot decides what it can build. Our own slip text carries numbering, units,
// book names and a tagline, all noise to a parser, so this is pinned separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gamblyLines, gamblyMessage, GAMBLY_BOT_ID, discordChannelUrl } from '../src/lib/gambly.ts';

const item = (o) => ({ id: o.label, day: 'd', key: 'k', units: 1, status: 'placed', created_at: '', kind: 'atd', ...o });

test('one bet per line, price attached', () => {
  assert.deepEqual(
    gamblyLines([item({ label: 'BUF -4.5', price: -110 }), item({ label: 'Over 54.5', price: -110 })]),
    ['BUF -4.5 -110', 'Over 54.5 -110'],
  );
});

test('a parlay is sent as its legs, not its nickname', () => {
  // "The value pair" means nothing to a parser; the two legs are the bets.
  const t = item({
    kind: 'parlay',
    label: 'The value pair',
    legs: [{ label: 'Amon-Ra St. Brown anytime TD', price: 115 }, { label: 'DJ Moore anytime TD', price: 135 }],
  });
  assert.deepEqual(gamblyLines([t]), ['Amon-Ra St. Brown anytime TD +115', 'DJ Moore anytime TD +135']);
});

test('a leg shared by two tickets is only sent once', () => {
  // Otherwise the built slip carries the same selection twice.
  const a = item({ id: 'a', kind: 'parlay', label: 'A', legs: [{ label: 'Josh Allen anytime TD', price: -140 }, { label: 'X anytime TD', price: 100 }] });
  const b = item({ id: 'b', kind: 'parlay', label: 'B', legs: [{ label: 'Josh Allen anytime TD', price: -140 }, { label: 'Y anytime TD', price: 200 }] });
  const lines = gamblyLines([a, b]);
  assert.equal(lines.filter((l) => l.startsWith('Josh Allen')).length, 1);
  assert.equal(lines.length, 3);
});

test('a price that is missing is simply left off', () => {
  assert.deepEqual(gamblyLines([item({ label: 'BUF -4.5', price: null })]), ['BUF -4.5']);
});

test('the mention leads, because the bot reads it first', () => {
  const msg = gamblyMessage([item({ label: 'BUF -4.5', price: -110 })]);
  assert.ok(msg.startsWith(`<@${GAMBLY_BOT_ID}>`));
  assert.equal(msg.split('\n')[1], 'BUF -4.5 -110');
});

test('an empty slip produces nothing to send', () => {
  assert.equal(gamblyMessage([]), '');
});

test('the channel link has an app form and a web form', () => {
  assert.equal(discordChannelUrl('g', 'c', true), 'discord://discord.com/channels/g/c');
  assert.equal(discordChannelUrl('g', 'c'), 'https://discord.com/channels/g/c');
});
