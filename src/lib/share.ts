// Publishing a slip: a read-only snapshot behind a short code, so the slip you built here can be
// opened on the phone you bet from, or handed to the group without a screenshot.
import { supabase } from './supabase';
import { SITE_URL } from './site';
import type { SlipItem, SlipLeg } from './slip';

export type SharedLeg = Pick<SlipLeg, 'label' | 'price' | 'book'>;
export type SharedPick = {
  label: string;
  detail: string | null;
  game: string | null;
  price: number | null;
  book: string | null;
  units: number;
  kind: string;
  legs: SharedLeg[] | null;
};
export type SharedSlip = {
  id: string;
  day: string;
  title: string | null;
  created_at: string;
  payload: { picks: SharedPick[] };
};

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const code = (n = 8) =>
  Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

/** Strip a slip row down to what a reader needs. No ids, no user, no grading state. */
export const toSharedPick = (i: SlipItem): SharedPick => ({
  label: i.label,
  detail: i.detail ?? null,
  game: i.game_label ?? null,
  price: i.price ?? null,
  book: i.book ?? null,
  units: Number(i.units) || 0,
  kind: i.kind,
  legs:
    i.legs?.map((l) => ({ label: l.label, price: l.price ?? null, book: l.book ?? null })) ?? null,
});

export const sharedSlipUrl = (id: string) => `${SITE_URL}/app/s/${id}`;

/** Publish today's slip. Requires a signed-in user: the table only accepts owned rows. */
export async function publishSlip(
  day: string,
  items: SlipItem[],
  title?: string,
): Promise<{ id: string; url: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error('Sign in to share a slip link.');
  if (!items.length) throw new Error('Slip is empty.');
  const id = code();
  const { error } = await supabase.from('shared_slips').insert({
    id,
    user_id: userId,
    day,
    title: title ?? null,
    payload: { picks: items.map(toSharedPick) },
  });
  if (error) throw new Error(error.message);
  return { id, url: sharedSlipUrl(id) };
}

export async function loadSharedSlip(id: string): Promise<SharedSlip | null> {
  const { data, error } = await supabase
    .from('shared_slips')
    .select('id, day, title, created_at, payload')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SharedSlip) ?? null;
}
