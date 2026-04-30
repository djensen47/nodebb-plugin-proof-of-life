# nodebb-plugin-proof-of-life

A tiny [NodeBB](https://nodebb.org/) plugin that drops a single cookie — `nbb_human=1` — on every authenticated session, so an upstream CDN, WAF, reverse proxy, or any other edge layer can distinguish logged-in sessions from everything else.

The cookie carries no payload, no signature, and no information about the user. It's just a presence-or-absence marker.

## What it actually tells you (and what it doesn't)

Be precise about this: the cookie marks **authenticated sessions**, not "humans." The plugin has no way to fingerprint a request as human; it only knows whether NodeBB has a logged-in user attached to it.

Three populations of traffic, two of which the cookie can't separate:

|  | Has cookie? |
|---|---|
| Authenticated user (logged in) | ✅ |
| Anonymous human (lurker, search engine visitor, RSS reader) | ❌ |
| Bot / crawler / scraper | ❌ |

The cookie name is `nbb_human` because logging in is a half-decent proxy for "real person" — the friction of registration filters out most casual bots. But it's a proxy, not a guarantee. A determined bot that creates an account will get the cookie. An anonymous human reader will not.

That gap matters because it shapes what edge rules you can usefully build with this signal: the cookie is good for **"give logged-in users different treatment"** decisions. It is not good for **"is this request a bot?"** decisions — that question requires a real bot-detection layer (TLS fingerprinting, behavior, IP reputation), which the cookie does not provide.

## What it's for

Generic edge-layer use cases where "logged-in" is the discriminator you need:

- **Skip aggressive challenge modes** (CAPTCHA interstitials, JS-challenge pages, "Under Attack Mode") for logged-in users so they aren't bounced out of their session during a flood, while everyone else still gets the challenge.
- **Cache the anonymous bucket, bypass cache for logged-in users.** Most forum read traffic is anonymous and serves identical responses to everyone — cacheable. Logged-in users see personalized content (notifications, header avatar, draft posts) and need fresh responses every time. The cookie is the cache-key splitter.
- **Apply different rate limits per population.** Logged-in users get higher limits; everyone else gets stricter ones.
- **Different routing or origin selection.** Send logged-in traffic to a faster origin pool; let cached anonymous traffic absorb the spike.

The plugin doesn't talk to your edge. It just sets the cookie. The rules and lookups live wherever you run your edge — Cloudflare WAF, Fastly VCL, AWS CloudFront functions, Varnish, nginx, etc.

## How it works

Two hook handlers, ~20 lines of logic total:

| Hook | When it fires | What it does |
|---|---|---|
| `action:user.loggedIn` | Fired by NodeBB the moment a login succeeds | Sets `nbb_human=1` on the response |
| `filter:middleware.render` | Fired on every page render | If the user is authenticated (`req.uid > 0`) but the cookie is missing, sets it (backfill for sessions that pre-date the plugin or browsers that have lost the cookie) |

Logout is **not** handled — the cookie persists across logout/login cycles. Once a browser has authenticated, the marker stays. That's a deliberate trade-off: a logged-out browser will still skip cache (small cost) but will also still bypass challenge modes (the value).

## Cookie attributes

| Attribute | Value | Why |
|---|---|---|
| Name | `nbb_human` | Hard-coded |
| Value | `1` | Edge layers just check for presence |
| `HttpOnly` | `true` | No client JS needs to read it. Doesn't affect AJAX, fetch, or socket.io — those all carry cookies automatically |
| `Secure` | derived from request (`req.secure \|\| req.protocol === 'https'`) | True in production, false on plain-HTTP dev |
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

## Wiring it up at the edge

The cookie is just `nbb_human=1`. Any edge layer that can read request cookies can branch on it. A few sketches:

**Cloudflare WAF custom rule** — skip a managed challenge for logged-in users:

```
(http.cookie contains "nbb_human=1") → Skip
```

**Cloudflare Cache Rule** — bypass cache when the cookie is present:

```
(http.cookie contains "nbb_human=1") → Bypass cache
```

**Fastly VCL** — different cache key per population:

```vcl
if (req.http.Cookie ~ "nbb_human=1") {
  set req.http.X-Logged-In = "1";
  return(pass);
}
```

**nginx** — split the upstream:

```nginx
map $http_cookie $is_logged_in {
  default       0;
  "~*nbb_human=1" 1;
}
```

The shape is the same everywhere: read `Cookie`, check for `nbb_human=1`, branch.

**Cache sanity check before flipping caching on**: make sure the anonymous responses you're caching don't contain per-user content (CSRF tokens rendered into HTML, personalized navigation, etc.). NodeBB's anonymous-user pages are mostly safe, but verify with your specific theme and plugin set.

## Compatibility

| NodeBB | Status |
|---|---|
| 4.x | ✅ Tested — both hooks present and use the same `{ uid, req }` / `{ req, res }` payloads |
| 3.x | ✅ Tested — same payloads, same behavior |
| 2.x | ⚠️ Likely works — both hooks have existed since 1.x, but not actively tested |
| 1.x | ⚠️ Probably works, unsupported |

The `nbbpm.compatibility` field in `package.json` declares `^3.0.0 || ^4.0.0`. The same value is mirrored in `plugin.json`'s (now-deprecated) `compatibility` field for the benefit of any older NodeBB releases that still read from the legacy location. The plugin has no external runtime dependencies and only uses the standard Express `req`/`res` API exposed by NodeBB's hook system, so a future v5 should still work — but the manifest would need to be updated to advertise that explicitly.

If you run on an older or unusual NodeBB and confirm the plugin works (or doesn't), open an issue and the compatibility table can be updated.

## Caveats

- **Single host only.** The cookie's `Domain` attribute is not set, so it defaults to the request host. Most forums live on a single hostname, so this default keeps things simple. If your forum spans multiple subdomains and your edge needs to read the cookie across them, that's a reasonable feature request — open an issue. NodeBB's plugin framework supports admin-configurable settings, so adding a `domain` option is straightforward; we just didn't need it.
- **Cookie name is hard-coded.** No admin settings panel today. If `nbb_human` collides with something in your stack, open an issue — making the name configurable is the same kind of small addition as the `domain` option above.
- **`HttpOnly` means client-side JS can't see the cookie.** That's intentional (the cookie is read at the edge, not in the browser), but if you wanted to use it in client JS, you'd need to flip the flag.
- **Banned users keep the cookie.** They'll still hit edge rules as if logged in, but they're banned, so they can't actually do anything harmful. Revoking on ban is possible but adds complexity for negligible gain.
- **Not a bot signal.** As discussed above, this cookie cannot tell you whether an anonymous request is a human or a bot. If you need that distinction, layer a real bot-detection product on top.

## License

MIT. See [LICENSE](./LICENSE).
