// Public web pages served by the `site` edge function (landing, checkout, legal drafts).
// The URL moves to the custom domain later by changing app.json extra.siteUrl only.
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { siteUrl?: string };
export const SITE_URL = (
  extra.siteUrl ?? 'https://vcduwtgbclkwcxquqicl.supabase.co/functions/v1/site'
).replace(/\/+$/, '');

export type LegalPage = 'terms' | 'privacy' | 'refunds' | 'responsible-gambling';
export const LEGAL_PAGES: { key: LegalPage; label: string }[] = [
  { key: 'terms', label: 'Terms' },
  { key: 'privacy', label: 'Privacy' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'responsible-gambling', label: 'Responsible gambling' },
];
export const legalUrl = (page: LegalPage) => `${SITE_URL}/legal/${page}`;
