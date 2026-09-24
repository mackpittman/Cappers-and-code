import test from 'node:test';
import assert from 'node:assert/strict';
import { fitItems, fitEmbeds, validate, EMBED_DESCRIPTION, EMBED_TOTAL } from './discord-limits.mjs';

test('fitItems drops whole items and says how many', () => {
  const items = Array.from({ length: 10 }, (_, i) => `item ${i} ${'x'.repeat(500)}`);
  const out = fitItems(items);
  assert.ok(out.length <= EMBED_DESCRIPTION, `was ${out.length}`);
  assert.match(out, /\+\d+ more in the app\./);
  // Never cuts an item in half: every kept item is present whole.
  assert.ok(out.startsWith(items[0]));
});

test('fitItems adds no tail when everything fits', () => {
  const out = fitItems(['a', 'b', 'c']);
  assert.equal(out, 'a\n\nb\n\nc');
});

test('fitItems still returns something when one item alone is too long', () => {
  const out = fitItems(['y'.repeat(9000)]);
  assert.equal(out.length, EMBED_DESCRIPTION);
});

test('fitEmbeds enforces the 6000 total across embeds', () => {
  const embeds = Array.from({ length: 4 }, (_, i) => ({
    title: `T${i}`,
    description: 'z'.repeat(2500),
  }));
  const out = fitEmbeds(embeds);
  const total = out.reduce((n, e) => n + e.description.length + e.title.length, 0);
  assert.ok(total <= EMBED_TOTAL, `total was ${total}`);
  assert.ok(out.length < embeds.length, 'should have dropped or trimmed something');
  assert.equal(validate({ embeds: out }).length, 0);
});

test('validate catches exactly what Discord rejected', () => {
  // The real payload that failed: embed[0] at 5909 characters.
  const bad = {
    content: 'x',
    embeds: [
      { title: 'LOCKED IN', description: 'a'.repeat(5909) },
      { title: 'TD BOARD', description: 'b'.repeat(528) },
    ],
  };
  const problems = validate(bad);
  assert.ok(problems.some((p) => p.includes('embeds[0].description is 5909')));
  assert.ok(problems.some((p) => p.includes('total')));
  // And the fixed version passes.
  assert.equal(validate({ content: 'x', embeds: fitEmbeds(bad.embeds) }).length, 0);
});

test('validate rejects an empty description, which Discord also refuses', () => {
  assert.ok(validate({ embeds: [{ title: 'T', description: '' }] }).length > 0);
});
