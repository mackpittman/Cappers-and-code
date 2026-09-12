// Page templates for the public site (landing, success, legal). Rendered to static HTML by
// scripts/build-site.mjs and published to GitHub Pages together with the web app.
// Only public values reach the browser: the Supabase URL and anon key.
const FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#050608"/><text x="32" y="44" text-anchor="middle" font-family="Impact,Arial Narrow,sans-serif" font-size="30" font-weight="700" fill="#F5F7F2">CC</text><path d="M10 20 L4 32 L10 44 M54 20 L60 32 L54 44" fill="none" stroke="#B6FF00" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  );
const LOCKUP =
  '<span class="logo"><span class="mark"><span class="brk">&lt;</span>CC<span class="brk">/&gt;</span></span><small>Cappers <em>&amp;</em> Code</small></span>';

export const esc = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const CSS = `
:root{--bg:#050608;--panel:#0B0E0C;--green:#B6FF00;--deep:#79E000;--white:#F5F7F2;--muted:#9DA59D;--line:rgba(182,255,0,.35)}
*{box-sizing:border-box}html{color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--white);font-family:Manrope,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.018) 0 1px,transparent 1px 4px);z-index:0}
a{color:var(--green);text-decoration:none}a:hover{text-decoration:underline}
.wrap{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:0 20px}
header{display:flex;align-items:center;justify-content:space-between;padding:18px 0;gap:16px;flex-wrap:wrap}
.logo{display:inline-flex;flex-direction:column;align-items:center;line-height:1;font-family:"Barlow Condensed",Impact,"Arial Narrow",sans-serif;font-weight:700;font-size:34px;color:var(--white);letter-spacing:.04em}
.logo .mark{display:block;white-space:nowrap}.logo .brk{color:var(--green);margin:0 3px}
.logo small{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:9px;letter-spacing:.32em;text-transform:uppercase;color:var(--white);margin-top:4px}.logo small em{font-style:normal;color:var(--green)}
header a:hover{text-decoration:none}
nav{display:flex;gap:18px;flex-wrap:wrap;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase}
nav a{color:var(--muted)}nav a:hover{color:var(--green);text-decoration:none}
h1,h2,h3{font-family:"Barlow Condensed",Impact,"Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.01em;line-height:.95;margin:0}
h1{font-size:clamp(46px,9vw,104px);font-weight:700}
h1 em{font-style:normal;color:var(--green)}
h2{font-size:clamp(30px,4.5vw,46px);margin-bottom:18px}
h3{font-size:24px;margin-bottom:8px}
.kicker{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--green);margin-bottom:14px}
.hero{padding:56px 0 40px;border-bottom:1px solid rgba(157,165,157,.15)}
.hero p.lead{max-width:640px;font-size:18px;color:var(--muted);margin:22px 0 28px}
.cta{display:inline-block;background:var(--green);color:#050608;font-family:"Barlow Condensed",Impact,sans-serif;font-weight:700;text-transform:uppercase;font-size:20px;letter-spacing:.06em;padding:14px 26px;border-radius:8px;border:0;cursor:pointer;box-shadow:0 0 24px rgba(182,255,0,.35)}
.cta:hover{background:var(--deep);text-decoration:none}
.cta.ghost{background:transparent;color:var(--green);border:1px solid var(--line);box-shadow:none}
.cta[disabled]{opacity:.5;cursor:default}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
section{padding:48px 0;border-bottom:1px solid rgba(157,165,157,.15)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
.panel{background:var(--panel);border:1px solid rgba(157,165,157,.18);border-radius:16px;padding:20px}
.panel.hot{border-color:var(--line);box-shadow:0 0 24px rgba(182,255,0,.12)}
.panel p{color:var(--muted);margin:6px 0 0;font-size:15px}
.price{font-family:"Barlow Condensed",Impact,sans-serif;font-size:56px;font-weight:700;line-height:1}
.price small{font-size:20px;color:var(--muted);font-weight:600}
.mono{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:13px;color:var(--muted)}
ul.checks{list-style:none;padding:0;margin:12px 0 0}
ul.checks li{padding:6px 0 6px 26px;position:relative;color:var(--white)}
ul.checks li:before{content:"//";position:absolute;left:0;color:var(--green);font-family:"JetBrains Mono",monospace;font-size:13px;top:9px}
form.auth{display:grid;gap:10px;margin-top:14px}
input{background:#050608;border:1px solid rgba(157,165,157,.3);color:var(--white);border-radius:8px;padding:12px 14px;font:inherit;font-size:16px}
input:focus{outline:none;border-color:var(--green)}
label.chk{display:flex;gap:10px;align-items:flex-start;color:var(--muted);font-size:14px}
.msg{font-size:14px;color:var(--muted);min-height:20px}.msg.err{color:#ff7a7a}.msg.ok{color:var(--green)}
.status{display:inline-block;padding:4px 10px;border-radius:999px;border:1px solid var(--line);font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--green)}
details{border-top:1px solid rgba(157,165,157,.15);padding:14px 0}
summary{cursor:pointer;font-weight:700;font-size:17px}
details p{color:var(--muted);margin:8px 0 0}
footer{padding:36px 0 48px;color:var(--muted);font-size:13px}
footer .links{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.1em;text-transform:uppercase}
.legal{max-width:760px}.legal h2{margin-top:36px;font-size:30px}.legal p,.legal li{color:#d6dbd4}
.draft{background:rgba(182,255,0,.08);border:1px solid var(--line);border-radius:8px;padding:10px 14px;font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--green);margin:20px 0}
.hidden{display:none!important}
`;

export function page(title, body, opts = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(opts.description ?? 'AI Models. Human Insight. One Edge. The Sports Intelligence Community.')}">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=JetBrains+Mono:wght@500;700&family=Manrope:wght@500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="wrap">
<header><a href="./" aria-label="Cappers &amp; Code home">${LOCKUP}</a>
<nav><a href="./#edge">The Edge</a><a href="./#join">Membership</a><a href="./#faq">FAQ</a><a href="https://instagram.com/cappersandcode" rel="noopener">@cappersandcode</a></nav></header>
${body}
<footer><div class="links"><a href="./legal/terms">Terms</a><a href="./legal/privacy">Privacy</a><a href="./legal/refunds">Refunds</a><a href="./legal/responsible-gambling">Responsible gambling</a></div>
<div>Cappers &amp; Code is a sports-analysis information service. Nothing here is a guarantee of results, financial advice, or an offer to place a wager. Members must be 21+ (or the legal age where they live) and are responsible for following their local laws. If gambling is a problem for you or someone you know, call 1-800-GAMBLER.</div>
<div style="margin-top:10px" class="mono">Locked In. Trust the Code. &copy; ${new Date().getFullYear()} Cappers &amp; Code</div></footer>
</div>${opts.script ? `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script><script>${opts.script}</script>` : ''}</body></html>`;
}

// ---------- Landing ----------
export function landing(founderEnd, discordInvite) {
  // Read at render time (after the build script has filled the env from app.json).
  const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://vcduwtgbclkwcxquqicl.supabase.co';
  const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
  const founderDate = new Date(founderEnd).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const body = `
<div class="hero"><div class="kicker">The Sports Intelligence Community</div>
<h1>AI Models.<br>Human Insight.<br><em>One Edge.</em></h1>
<p class="lead">A daily NFL board built from an offseason model of all 32 teams, live prices from the books, injuries, and a graded record you can check. Sides, totals, touchdown scorers, props, and stacks. More than picks.</p>
<div class="row"><a class="cta" href="#join">Unlock the Edge &middot; $10/mo</a><a class="cta ghost" href="#edge">What you get</a></div>
<p class="mono" style="margin-top:18px">NFL now &middot; CFB and NBA coming &middot; Already a member? <a href="./app/">Open the app</a></p></div>

<section id="edge"><div class="kicker">What members get</div><h2>The board, every day</h2>
<div class="grid">
<div class="panel hot"><h3>Locked In</h3><p>The model's side and total on every game with confidence, the opening and current line, and the one-paragraph "why".</p></div>
<div class="panel"><h3>TD Board</h3><p>Top three anytime-touchdown scorers per game with model odds versus book odds, so the value shows itself.</p></div>
<div class="panel"><h3>Props &amp; Stacks</h3><p>Player-prop leans and same-game stacks tied to the model's game script, priced against live markets.</p></div>
<div class="panel"><h3>Trust the Code</h3><p>Every call is graded from the box score. The record is posted, wins and losses, nothing hidden.</p></div>
<div class="panel"><h3>The Code (Discord)</h3><p>Members-only channels: the daily drop, injury and line moves, model talk, and the community that argues the card with you.</p></div>
<div class="panel"><h3>The app</h3><p>Open it from any phone browser and add it to your home screen: the live board, results, and record. Native builds follow.</p></div>
</div></section>

<section id="join"><div class="kicker">Membership</div><h2>Pick your pass</h2>
<div class="grid">
<div class="panel hot"><div class="mono">Monthly</div><div class="price">$10<small>/month</small></div>
<ul class="checks"><li>Full daily board in the app and on the web</li><li>Members-only Discord role</li><li>Cancel anytime from your billing portal</li></ul>
<div style="margin-top:16px"><button class="cta" data-plan="monthly" disabled>Start membership</button></div></div>
<div class="panel"><div class="mono">Founder season pass &middot; first 100</div><div class="price">$20<small>/season</small></div>
<ul class="checks"><li>Everything in monthly through ${esc(founderDate)}</li><li>Founder role in Discord, grandfathered into NBA</li><li>One payment, no renewal</li></ul>
<div style="margin-top:16px"><button class="cta ghost" data-plan="founder_season" disabled>Founder pass</button></div></div>
<div class="panel" id="authpanel"><div class="mono" id="authtitle">Sign in or create your account to check out</div>
<form class="auth" id="authform">
<input type="email" id="email" placeholder="Email" autocomplete="email" required>
<input type="password" id="password" placeholder="Password (8+ characters)" autocomplete="current-password" minlength="8" required>
<label class="chk" id="agewrap"><input type="checkbox" id="age"> I am 21+ (or the legal age where I live) and I accept the <a href="./legal/terms">Terms</a> and <a href="./legal/responsible-gambling">Responsible Gambling</a> notice.</label>
<div class="row"><button class="cta" type="submit" id="authbtn">Sign in</button><button class="cta ghost" type="button" id="toggle">Create account</button></div>
<div class="msg" id="msg"></div>
</form>
<div id="signedin" class="hidden">
<div class="row" style="margin-bottom:10px"><span class="status" id="stat">checking</span><span class="mono" id="who"></span></div>
<div class="row"><a class="cta ghost hidden" id="openapp" href="./app/">Open the app</a>${discordInvite ? `<a class="cta ghost hidden" id="discord" href="${esc(discordInvite)}" rel="noopener">Join the Discord</a>` : ''}<button class="cta ghost hidden" id="portal" type="button">Manage billing</button><button class="cta ghost" id="signout" type="button">Sign out</button></div>
<div class="msg" id="msg2"></div></div>
</div></div>
<p class="mono" style="margin-top:16px">Payments are handled by Stripe. Card details never touch our servers. ${founderEnd ? 'Founder passes end ' + esc(founderDate) + '.' : ''}</p>
</section>

<section id="faq"><div class="kicker">FAQ</div><h2>Straight answers</h2>
<details><summary>Is this a guarantee I'll win?</summary><p>No. It is an information service. The model is graded in public and the record includes the losses. Bet only what you can afford to lose.</p></details>
<details><summary>What is actually in the daily board?</summary><p>For every game: the model's side and total with confidence, the opening and live line, the top three anytime-touchdown scorers with model odds against book odds, prop leans, stacks, and a short why. Plus the season record, graded from box scores.</p></details>
<details><summary>When does it update?</summary><p>Every morning in season, with extra price pulls when the week's designated market moves and again before kickoff. Deep team research refreshes weekly on Tuesday.</p></details>
<details><summary>How do I cancel?</summary><p>Sign in above and click Manage billing, or use the same button in the app. Monthly plans stop at the end of the paid period. See the <a href="./legal/refunds">refund policy</a>.</p></details>
<details><summary>How do I get into the Discord?</summary><p>After you pay, link your Discord in the app or from the success page and the bot assigns the Member role. Free channels stay open to everyone.</p></details>
</section>`;

  const script = `
var SB=supabase.createClient(${JSON.stringify(SUPABASE_URL)},${JSON.stringify(ANON_KEY)});
var mode='signin';var $=function(id){return document.getElementById(id)};
function say(id,t,cls){var m=$(id);m.textContent=t||'';m.className='msg'+(cls?' '+cls:'')}
function setMode(m){mode=m;$('authbtn').textContent=m==='signin'?'Sign in':'Create account';$('toggle').textContent=m==='signin'?'Create account':'Have an account? Sign in';$('agewrap').style.display=m==='signin'?'none':'flex';$('password').autocomplete=m==='signin'?'current-password':'new-password';say('msg','')}
setMode('signin');
$('toggle').onclick=function(){setMode(mode==='signin'?'signup':'signin')};
$('authform').onsubmit=async function(e){e.preventDefault();var email=$('email').value.trim(),password=$('password').value;$('authbtn').disabled=true;say('msg','Working...');
try{if(mode==='signup'){if(!$('age').checked){say('msg','Please confirm your age and accept the terms.','err');return}
var r=await SB.auth.signUp({email:email,password:password,options:{data:{age_confirmed:true,terms_accepted_at:new Date().toISOString()}}});if(r.error)throw r.error;if(!r.data.session){say('msg','Check your email to confirm, then sign in.','ok');return}}
else{var r2=await SB.auth.signInWithPassword({email:email,password:password});if(r2.error)throw r2.error}
say('msg','');await render()}catch(err){say('msg',err.message||String(err),'err')}finally{$('authbtn').disabled=false}};
$('signout').onclick=async function(){await SB.auth.signOut();await render()};
async function fnErr(err){try{var j=await err.context.json();return j.error||err.message}catch(_){return err.message}}
async function checkout(plan){var btns=document.querySelectorAll('[data-plan]');btns.forEach(function(b){b.disabled=true});say('msg2','Opening secure checkout...');
try{var r=await SB.functions.invoke('stripe-checkout',{body:{plan:plan}});if(r.error)throw new Error(await fnErr(r.error));window.location.href=r.data.url}
catch(err){say('msg2',err.message,'err');btns.forEach(function(b){b.disabled=false})}}
document.querySelectorAll('[data-plan]').forEach(function(b){b.onclick=function(){checkout(b.getAttribute('data-plan'))}});
$('portal').onclick=async function(){say('msg2','Opening billing portal...');try{var r=await SB.functions.invoke('stripe-portal',{body:{}});if(r.error)throw new Error(await fnErr(r.error));window.location.href=r.data.url}catch(err){say('msg2',err.message,'err')}};
async function render(){var s=(await SB.auth.getSession()).data.session;var signed=!!s;
$('authform').classList.toggle('hidden',signed);$('signedin').classList.toggle('hidden',!signed);$('authtitle').textContent=signed?'Your membership':'Sign in or create your account to check out';
document.querySelectorAll('[data-plan]').forEach(function(b){b.disabled=!signed;b.textContent=signed?(b.getAttribute('data-plan')==='monthly'?'Start membership':'Founder pass'):(b.getAttribute('data-plan')==='monthly'?'Sign in to start':'Sign in for founder pass')});
if(!signed)return;$('who').textContent=s.user.email||'';
var e=await SB.rpc('my_entitlement');var row=e.data&&e.data[0];var active=!!(row&&row.active);
$('stat').textContent=active?('member · '+(row.plan||'')):'no active membership';
$('openapp').classList.toggle('hidden',!active);var d=$('discord');if(d)d.classList.toggle('hidden',!active);
$('portal').classList.toggle('hidden',!(row&&row.plan==='monthly'));
if(active){var end=row.current_period_end?new Date(row.current_period_end).toLocaleDateString():'';say('msg2','Access through '+end+(row.cancel_at_period_end?' (cancels at period end)':''),'ok')}else say('msg2','Pick a pass above to unlock the board.')}
if(location.search.indexOf('canceled=1')>-1)say('msg2','Checkout canceled. Nothing was charged.');
render();`;
  return page('Cappers & Code — AI Models. Human Insight. One Edge.', body, { script });
}

// ---------- Success ----------
export function success(discordInvite) {
  const body = `<div class="hero"><div class="kicker">Payment received</div><h1>You're <em>in.</em></h1>
<p class="lead">Your membership activates within seconds. Open the app, sign in with the same email, and add it to your home screen (Share &rarr; Add to Home Screen on iPhone). The Discord role follows once you link your account.</p>
<div class="row"><a class="cta" href="./app/">Open the app</a>${discordInvite ? `<a class="cta ghost" href="${esc(discordInvite)}" rel="noopener">Join the Discord</a>` : '<span class="mono">Discord invite arrives with the members bot.</span>'}<a class="cta ghost" href="./">Back to the site</a></div>
<p class="mono" style="margin-top:22px">Receipt and billing portal: sign in on the site and choose Manage billing. Questions: <span id="support"></span></p></div>`;
  return page("You're in — Cappers & Code", body);
}

// ---------- Legal (drafts pending founder review) ----------
const DRAFT =
  '<div class="draft">Draft v0.1 &middot; pending founder review &middot; September 2026</div>';
export function legalPage(title, html, support) {
  return page(
    `${title} — Cappers & Code`,
    `<div class="legal"><div class="kicker">Legal</div><h1 style="font-size:clamp(38px,6vw,64px)">${esc(title)}</h1>${DRAFT}${html.replaceAll('{{support}}', esc(support))}</div>`,
  );
}
export const TERMS = `
<p>These Terms govern your use of the Cappers &amp; Code website, mobile app, Discord community, and membership (the "Service"). By creating an account or paying for a membership you agree to them.</p>
<h2>1. What the Service is</h2><p>Cappers &amp; Code publishes sports-analysis content: model outputs, projected lines, touchdown and prop leans, and commentary. It is an information and entertainment service. It is not a sportsbook, does not accept or place wagers, and does not provide financial, legal, or investment advice.</p>
<h2>2. No guarantee of results</h2><p>Sports outcomes are uncertain. Past performance, posted records, confidence scores, and model odds are not promises of future results. You are solely responsible for any wagering decision you make and for any loss that results.</p>
<h2>3. Eligibility</h2><p>You must be at least 21 years old, or the legal age for sports wagering where you live if higher, and you must comply with the laws of your jurisdiction. Do not use the Service where doing so is illegal.</p>
<h2>4. Accounts</h2><p>Keep your login private. You are responsible for activity under your account. One person per account; sharing the board, screenshots of members-only content, or Discord invites for resale is grounds for termination without refund.</p>
<h2>5. Membership and billing</h2><p>Monthly memberships renew automatically each month until cancelled. Founder season passes are a single payment for access through the date shown at checkout. Payments are processed by Stripe under its own terms. Prices may change with notice before your next renewal. See the <a href="./legal/refunds">Refund Policy</a>.</p>
<h2>6. Content and intellectual property</h2><p>The board, model outputs, artwork, and text are owned by Cappers &amp; Code and licensed to you for personal, non-commercial use while your membership is active. Do not scrape, republish, or resell them.</p>
<h2>7. Community conduct</h2><p>In Discord and elsewhere: no harassment, no touting, no selling picks, no soliciting deposits, no bookmaking. Moderators may remove content and members at their discretion.</p>
<h2>8. Disclaimer and limitation of liability</h2><p>The Service is provided "as is". To the fullest extent allowed by law, Cappers &amp; Code disclaims all warranties and is not liable for indirect, incidental, or consequential damages, or for any wagering loss. Total liability is limited to the fees you paid in the three months before the claim.</p>
<h2>9. Termination</h2><p>You may cancel at any time. We may suspend or terminate accounts that violate these Terms.</p>
<h2>10. Changes and contact</h2><p>We may update these Terms; continued use after an update is acceptance. Questions: {{support}}.</p>`;
export const PRIVACY = `
<p>This policy explains what Cappers &amp; Code collects and why. We collect as little as the Service needs.</p>
<h2>What we store</h2><ul><li><strong>Account:</strong> email address, a hashed password, and the date you accepted the Terms and age notice.</li><li><strong>Membership:</strong> your Stripe customer id, subscription status, plan, and period end. Stripe holds your card details; we never see them.</li><li><strong>Discord link:</strong> your Discord user id if you link it, so the bot can assign roles.</li><li><strong>Usage:</strong> server logs with request times and errors for reliability. No advertising trackers, no third-party analytics SDKs.</li></ul>
<p>We do not collect bets you place, sportsbook logins, location, or contacts.</p>
<h2>How we use it</h2><p>To sign you in, deliver the board to members, bill you, assign Discord roles, answer support requests, and keep the Service secure.</p>
<h2>Who we share it with</h2><p>Stripe (payments), Supabase (hosting and database), Discord (role assignment), and email delivery providers for account messages. We do not sell personal data.</p>
<h2>Retention and deletion</h2><p>Account data is kept while your account exists and for up to 90 days after deletion for billing records required by law. Email {{support}} to delete your account.</p>
<h2>Your rights</h2><p>You can request a copy of your data, correct it, or delete it. Residents of California, the EU, and the UK have additional rights under their local laws; email {{support}} to exercise them.</p>
<h2>Children</h2><p>The Service is for adults 21+. We do not knowingly collect data from anyone under 18.</p>
<h2>Changes</h2><p>We will post updates here and note the date. Questions: {{support}}.</p>`;
export const REFUNDS = `
<p>We want members who get value from the board. Here is how billing works.</p>
<h2>Monthly membership</h2><p>Renews every month on the date you first paid. Cancel any time from Manage billing on the site or in the app. Access continues through the end of the paid period and there is no further charge. Partial months are not refunded.</p>
<h2>Founder season pass</h2><p>A single payment for access through the season end date shown at checkout. It is non-refundable once the board has been delivered after purchase, except as required by law.</p>
<h2>Something went wrong</h2><p>If you were charged twice, could not access the board for more than 48 hours because of an outage on our side, or paid by mistake within 24 hours and did not use the Service, email {{support}} with the receipt and we will refund it.</p>
<h2>Chargebacks</h2><p>Please contact us before disputing a charge. Accounts with an open chargeback lose access until it is resolved.</p>`;
export const RG = `
<p>Cappers &amp; Code exists to make people sharper, not to make anyone bet more. Please read this before you join.</p>
<h2>Bet responsibly</h2><ul><li>Only wager money you can afford to lose. Set a budget and keep it.</li><li>Never chase losses. A bad day is not a reason to raise stakes.</li><li>The model loses too. Confidence scores are estimates, not certainties.</li><li>Take breaks. If betting stops being fun, stop.</li></ul>
<h2>Age and legality</h2><p>You must be 21+ (or the legal age where you live) and may only wager where it is legal. Cappers &amp; Code does not take bets and does not partner with any sportsbook to place them for you.</p>
<h2>Get help</h2><p>If gambling is causing problems for you or someone you know, help is free and confidential:</p><ul><li>United States: call or text <strong>1-800-GAMBLER</strong> (1-800-426-2537), <a href="https://www.ncpgambling.org" rel="noopener">ncpgambling.org</a></li><li>Gamblers Anonymous: <a href="https://www.gamblersanonymous.org" rel="noopener">gamblersanonymous.org</a></li><li>Self-exclusion programs are available through your state gaming commission and most sportsbooks.</li></ul>
<p>If you would like your membership paused or cancelled for this reason, email {{support}} and we will do it the same day, with a refund of any unused founder pass time.</p>`;
