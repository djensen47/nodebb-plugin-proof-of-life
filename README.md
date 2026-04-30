# nodebb-plugin-proof-of-life

A tiny [NodeBB](https://nodebb.org/) plugin that drops a single cookie — `nbb_human=1` — on every authenticated session, so an upstream CDN or WAF (typically Cloudflare) can tell logged-in humans apart from anonymous traffic at the edge.

The cookie carries no payload, no signature, and no information about the user. It's just a marker: *"a human logged in from this browser at some point."*

## What it's for

Two operational wins, both at the Cloudflare layer:

1. **Bypass "Under Attack Mode"** for logged-in users. UAM's interstitial JS challenge is great against attackers, miserable for actual members. A cookie-based bypass rule lets your community keep posting through an attack while everyone else gets challenged.
2. **Cache anonymous traffic, skip cache for logged-in users.** Most of NodeBB's read traffic is anonymous (search engines, casual readers). Letting Cloudflare cache those responses is a huge origin-load win — but you need a way to *exclude* logged-in users so they always see fresh content (new posts, notifications, their own avatars in the header). The cookie is that signal.

The plugin doesn't talk to Cloudflare. It just sets the cookie. The Cloudflare-side rules are configured in your dashboard — see [Configuring Cloudflare](#configuring-cloudflare) below.

## How it works

Two hook handlers, ~20 lines of logic total:

| Hook | When it fires | What it does |
|---|---|---|
| `action:user.loggedIn` | Fired by NodeBB the moment a login succeeds | Sets `nbb_human=1` on the response |
| `filter:middleware.render` | Fired on every page render | If the user is authenticated (`req.uid > 0`) but the cookie is missing, sets it (backfill for sessions that pre-date the plugin or browsers that have lost the cookie) |

Logout is **not** handled — the cookie persists across logout/login cycles. Once a browser has proved a human used it, the marker stays.

## Cookie attributes

| Attribute | Value | Why |
|---|---|---|
| Name | `nbb_human` | Hard-coded |
| Value | `1` | Cloudflare just checks for presence |
| `HttpOnly` | `true` | No client JS needs to read it. Doesn't affect AJAX, fetch, or socket.io — those all carry cookies automatically |
| `Secure` | derived from request (`req.secure || req.protocol === 'https'`) | True in production, false on plain-HTTP dev |
| `SameSite` | `Lax` | Standard, doesn't break anything |
| `Max-Age` | 1 year | Refreshed on every login |
| `Path` | `/` | All routes |
| `Domain` | not set (defaults to request host) | Single-host deployments only — see [Caveats](#caveats) for multi-subdomain setups |

## Installation

From your NodeBB instance directory:

```sh
npm install nodebb-plugin-proof-of-life
./nodebb restart
```

Then activate the plugin in the ACP: **Extend → Plugins → "Proof of Life" → Activate** → restart NodeBB once more.

## Configuring Cloudflare

The plugin only sets the cookie. The actual edge behavior comes from rules you configure in your Cloudflare dashboard.

### Bypass Under Attack Mode for logged-in users

Cloudflare → your zone → **Security → WAF → Custom rules** → *Create rule*:

- **Field**: `Cookie`
- **Operator**: `contains`
- **Value**: `nbb_human=1`
- **Action**: `Skip` → check "All remaining custom rules" and "Bot Fight Mode" (and any managed rules you want to bypass)

Or, if you only want to skip UAM specifically and keep other protections active, use the dedicated UAM bypass that Cloudflare exposes for cookie-tagged users.

### Cache anonymous traffic, skip cache for logged-in users

Cloudflare → your zone → **Caching → Cache Rules** → *Create rule*:

- **Match**: `Hostname` equals your forum hostname (e.g., `www.example.com`)
- **Then**: `Cache eligibility` → set to `Eligible for cache`
- **Bypass cache**: add a sub-condition: `Cookie contains "nbb_human=1"` → `Bypass cache`

**Important sanity check before flipping caching on**: make sure the anonymous responses you're caching don't contain per-user content (CSRF tokens rendered into HTML, personalized navigation, etc.). NodeBB's anonymous-user pages are mostly safe, but verify with your specific theme and plugin set.

## Compatibility

| NodeBB | Status |
|---|---|
| 4.x | ✅ Tested — both hooks present and use the same `{ uid, req }` / `{ req, res }` payloads |
| 3.x | ✅ Tested — same payloads, same behavior |
| 2.x | ⚠️ Likely works — both hooks have existed since 1.x, but not actively tested |
| 1.x | ⚠️ Probably works, unsupported |

The `nbbpm.compatibility` field in `package.json` declares `>=3.0.0`. The plugin has no external runtime dependencies and only uses the standard Express `req`/`res` API exposed by NodeBB's hook system, so future major versions should continue to work as long as those hooks remain.

If you run on an older or unusual NodeBB and confirm the plugin works (or doesn't), open an issue and the compatibility table can be updated.

## Caveats

- **Single host only.** The cookie's `Domain` attribute is not set, so it defaults to the request host. If your forum lives on multiple subdomains and Cloudflare needs to read the cookie across them, you'll need to fork the plugin or contribute a config option for `domain`.
- **Cookie name is hard-coded.** No admin settings panel. If `nbb_human` collides with something, fork or PR.
- **`HttpOnly` means client-side JS can't see the cookie.** That's intentional (the cookie is read only by Cloudflare at the edge), but if you wanted to use it in client JS for some reason, you'd need to flip the flag.
- **Banned users keep the cookie.** They'll still bypass UAM and skip cache, but they're banned, so they can't actually do anything harmful. Revoking on ban is possible but adds complexity for negligible gain — see the design discussion in PR #1.

## License

MIT. See [LICENSE](./LICENSE).
