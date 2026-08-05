"""Reference implementation of the URL -> Are.na blocks resolver.

This is the SPEC for `src/core/url.ts` + the search half of `src/core/arena.ts`.
Validated against the live API — see design-and-development-plan.md §2.5:
88% recall on article-like URLs, ~100% precision, measured identically on the
v3 and v2 backends. The TypeScript port should reproduce this behavior, and the
fixtures at the bottom should become unit tests.

    python3 resolver.py                 # offline checks (no network)
    python3 resolver.py --live <url>    # v3 lookup, needs ~/.arena-token

The tokenization rules are backend-independent. The MVP ships the v3 backend
(`find_blocks_v3`); `find_blocks_v2` is kept only to document the deferred
non-Premium fallback (plan §10.2).

IMPORTANT: always send an explicit User-Agent. Python's default
`Python-urllib/x.y` is rejected at the CDN with a 403 that looks exactly like
rate limiting and will mislead you — it cost a wrong finding during planning
(plan §2.6).
"""
import json, os, re, sys, urllib.parse, urllib.request

UA = 'arena-connections-ext/0.1'

TRACKING = re.compile(r'^(utm_\w*|fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src|source|_hsenc)$')
# Path segments that carry no identifying signal and actively over-constrain the query.
STOP = {'wiki','wikipedia','html','htm','php','asp','aspx','index','page','pages',
        'post','posts','blog','blogs','article','articles','story','stories','news',
        'item','items','view','default','home','main','content','en','www','amp',
        'id','p','s','a','the','and','for','watch','video','read','abs','pdf'}
MULTI = {'co','com','org','net','ac','gov','edu'}

def get(url, params=None, timeout=20, token=None):
    if params: url += '?' + urllib.parse.urlencode(params)
    headers = {'Accept': 'application/json', 'User-Agent': UA}
    if token: headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

def read_token(path='~/.arena-token'):
    return open(os.path.expanduser(path)).read().strip()

def normalize(u):
    p = urllib.parse.urlsplit(u)
    host = p.netloc.lower().split(':')[0].removeprefix('www.')
    path = p.path.rstrip('/')
    q = sorted((k,v) for k,v in urllib.parse.parse_qsl(p.query) if not TRACKING.match(k))
    return host + path + ('?' + urllib.parse.urlencode(q) if q else '')

def domain_label(host):
    parts = host.lower().split(':')[0].split('.')
    if len(parts) >= 3 and parts[-2] in MULTI: return parts[-3]
    return parts[-2] if len(parts) >= 2 else parts[0]

def host_tokens(host):
    parts = host.lower().split(':')[0].split('.')
    registrable = len(parts) - 3 if len(parts) >= 3 and parts[-2] in MULTI else max(0, len(parts) - 2)
    subdomains = [s for s in parts[:registrable] if len(s) > 2 and not s.isdigit() and s not in STOP]
    return list(dict.fromkeys(subdomains + [parts[registrable]]))

def queries(u, max_tokens=4):
    p = urllib.parse.urlsplit(u)
    label = domain_label(p.netloc)
    raw = [s for s in re.split(r'[/\-_.+]+', urllib.parse.unquote(p.path)) if s]
    slug = [s for s in raw if len(s) > 2 and not s.isdigit() and s.lower() not in STOP]
    slug = slug[:max_tokens]
    out = []
    if slug:
        out.append(' '.join([label] + slug) if label.lower() not in {s.lower() for s in slug}
                   else ' '.join(slug))
        out.append(' '.join(slug))
    else:
        out.append(' '.join(host_tokens(p.netloc)))
        out.append(label)
    # dedupe, preserve order, cap at 2 search requests
    seen, final = set(), []
    for q in out:
        if q not in seen: seen.add(q); final.append(q)
    return final[:2]

TYPES = 'Link,Embed,Image'   # plan §2.4 — tunable; wider net, exact filter downstream

def find_blocks_v3(page_url, token, per=50):
    """MVP path. Authenticated v3 search + exact client-side URL equality."""
    target, calls, seen, matched = normalize(page_url), 0, set(), {}
    for q in queries(page_url):
        try:
            d = get('https://api.are.na/v3/search',
                    {'query': q, 'type': TYPES, 'per': per}, token=token)
        except Exception:
            continue
        calls += 1
        for b in (d.get('data') or []):
            if b['id'] in seen: continue
            seen.add(b['id'])
            su = ((b.get('source') or {}) or {}).get('url') or ''
            if su and normalize(su) == target: matched[b['id']] = b
        if len(matched) >= 5: break
    return matched, calls, len(seen)

def connections(block_id, per=10):
    """Public, no auth. Channel owner is `owner`, NOT `user`. Never re-sort."""
    d = get(f'https://api.are.na/v3/blocks/{block_id}/connections', {'per': per})
    return d.get('data') or [], (d.get('meta') or {}).get('total_count')

def find_blocks_v2(page_url, per=50):
    """Deferred non-Premium fallback only (plan §10.2). v2 is deprecated."""
    target, calls, seen, matched = normalize(page_url), 0, set(), {}
    for q in queries(page_url):
        try: d = get('https://api.are.na/v2/search', {'q': q, 'per': per})
        except Exception: continue
        calls += 1
        for b in (d.get('blocks') or []):
            if b['id'] in seen: continue
            seen.add(b['id'])
            su = ((b.get('source') or {}) or {}).get('url') or ''
            if su and normalize(su) == target: matched[b['id']] = b
        if len(matched) >= 5: break   # early exit: enough signal for a badge
    return matched, calls, len(seen)


# ---- Fixtures: these become the TypeScript unit tests -----------------------

NORMALIZE_CASES = [
    ('https://www.seangoedecke.com/llms-reward-expertise/', 'seangoedecke.com/llms-reward-expertise'),
    ('https://slate.com/tech/x.html?utm_source=pocket&utm_medium=email', 'slate.com/tech/x.html'),
    ('http://EN.Wikipedia.org:80/wiki/Foo/', 'en.wikipedia.org/wiki/Foo'),
]

# The domain label must be the registrable label, not the first host label.
LABEL_CASES = [
    ('www.seangoedecke.com', 'seangoedecke'), ('en.wikipedia.org', 'wikipedia'),
    ('news.ycombinator.com', 'ycombinator'), ('www.theguardian.co.uk', 'theguardian'),
]

# Regression: the 'wiki' stopword silently zeroed out results before it was dropped.
QUERY_CASES = [
    ('https://en.wikipedia.org/wiki/Walter_Van_Beirendonck', 'wikipedia Walter Van Beirendonck'),
    ('https://www.seangoedecke.com/llms-reward-expertise/', 'seangoedecke llms reward expertise'),
    ('https://negative.sanctuary.computer/', 'negative sanctuary'),
]

if __name__ == '__main__':
    if '--live' in sys.argv:
        url = sys.argv[sys.argv.index('--live') + 1]
        tok = read_token()
        blocks, calls, scanned = find_blocks_v3(url, tok)
        print(f'{url}\n  normalized: {normalize(url)}')
        print(f'  queries:    {queries(url)}')
        print(f'  {len(blocks)} block(s), {calls} search call(s), {scanned} scanned')
        for bid in list(blocks)[:8]:
            chans, total = connections(bid)
            for c in chans:
                owner = (c.get('owner') or {}).get('slug') or '?'
                print(f'    - {owner}/{c.get("slug")}   {c.get("title")!r}')
        raise SystemExit

    ok = True
    for u, want in NORMALIZE_CASES:
        got = normalize(u); ok &= got == want
        print(f'{"ok  " if got == want else "FAIL"} normalize {u[:48]:50s} -> {got}')
    for h, want in LABEL_CASES:
        got = domain_label(h); ok &= got == want
        print(f'{"ok  " if got == want else "FAIL"} label     {h:50s} -> {got}')
    for u, want in QUERY_CASES:
        got = queries(u)[0]; ok &= got == want
        print(f'{"ok  " if got == want else "FAIL"} query     {u[:48]:50s} -> {got}')
    print('\nPASS' if ok else '\nFAIL')
