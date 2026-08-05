const trackingParam = /^(utm_\w*|fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src|source|_hsenc)$/i;
const stopWords = new Set([
  'wiki', 'wikipedia', 'html', 'htm', 'php', 'asp', 'aspx', 'index', 'page', 'pages',
  'post', 'posts', 'blog', 'blogs', 'article', 'articles', 'story', 'stories', 'news',
  'item', 'items', 'view', 'default', 'home', 'main', 'content', 'en', 'www', 'amp',
  'id', 'p', 's', 'a', 'the', 'and', 'for', 'watch', 'video', 'read', 'abs', 'pdf',
]);
const multiPartTlds = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);

const pathTokens = (pathname: string): string[] => {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* keep the encoded path */ }
  return decoded.split(/[/\-_.+]+/).filter(Boolean);
};

const searchableTokens = (tokens: string[]): string[] => tokens.filter((token) =>
  token.length > 2 && !/^\d+$/.test(token) && !stopWords.has(token.toLowerCase()));

const hostTokens = (host: string): string[] => {
  const parts = host.toLowerCase().split(':')[0]!.split('.').filter(Boolean);
  const registrableIndex = parts.length >= 3 && multiPartTlds.has(parts.at(-2)!)
    ? parts.length - 3
    : Math.max(0, parts.length - 2);
  const label = parts[registrableIndex];
  const subdomains = searchableTokens(parts.slice(0, registrableIndex));
  return [...new Set([...subdomains, ...(label ? [label] : [])])];
};

export const normalizeUrl = (url: string): string => {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.replace(/\/+$/, '');
  const query = [...parsed.searchParams.entries()]
    .filter(([key]) => !trackingParam.test(key))
    .sort(([aKey, aValue], [bKey, bValue]) => (aKey < bKey ? -1 : aKey > bKey ? 1 : aValue < bValue ? -1 : aValue > bValue ? 1 : 0));
  return `${host}${path}${query.length ? `?${new URLSearchParams(query)}` : ''}`;
};

export const domainLabel = (host: string): string => {
  const parts = host.toLowerCase().replace(/^\[|\]$/g, '').split(':')[0]!.split('.');
  if (parts.length >= 3 && multiPartTlds.has(parts.at(-2)!)) return parts.at(-3)!;
  return parts.length >= 2 ? parts.at(-2)! : parts[0]!;
};

export const buildQueries = (url: string): string[] => {
  const parsed = new URL(url);
  const label = domainLabel(parsed.host);
  const slug = searchableTokens(pathTokens(parsed.pathname)).slice(0, 4);
  const host = hostTokens(parsed.hostname);
  const queries = slug.length
    ? [slug.some((token) => label.toLowerCase() === token.toLowerCase()) ? slug.join(' ') : `${label} ${slug.join(' ')}`, slug.join(' ')]
    : [host.join(' '), label];
  return [...new Set(queries)].slice(0, 2);
};

const isPrivateAddress = (host: string): boolean => {
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return false;
    const [a, b] = octets as [number, number, number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const ipv6 = host.toLowerCase();
  const mappedIpv4 = ipv6.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  return ipv6 === '::' || ipv6 === '::1' || (mappedIpv4 ? isPrivateAddress(mappedIpv4) : false) ||
    ipv6.startsWith('fc') || ipv6.startsWith('fd') || ipv6.startsWith('fe8') ||
    ipv6.startsWith('fe9') || ipv6.startsWith('fea') || ipv6.startsWith('feb');
};

const isOpaqueAsset = (host: string, pathname: string): boolean =>
  host === 'cdn.shopify.com' || host.endsWith('.media.tumblr.com') ||
  (host.endsWith('pinterest.com') && /^\/pin\/\d+\/?$/.test(pathname)) ||
  (host === 'facebook.com' || host.endsWith('.facebook.com')) && /\/(photos|photo)\//.test(pathname);

export const classifyUrl = (url: string): { resolvable: boolean; reason: string | null } => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { resolvable: false, reason: 'Invalid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { resolvable: false, reason: 'Only HTTP(S) URLs are supported' };
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLocalHostname = host === 'localhost' || host.endsWith('.localhost') ||
    host.endsWith('.local') || (!host.includes('.') && !host.includes(':'));
  if (isLocalHostname || isPrivateAddress(host)) {
    return { resolvable: false, reason: 'Local and private addresses are not supported' };
  }
  if (isOpaqueAsset(host, parsed.pathname)) {
    return { resolvable: false, reason: 'This URL is an opaque asset' };
  }
  const lexicalTokens = [...hostTokens(host), ...searchableTokens(pathTokens(parsed.pathname))];
  if (new Set(lexicalTokens.map((token) => token.toLowerCase())).size < 2) {
    return { resolvable: false, reason: 'This URL does not contain enough searchable words' };
  }
  return { resolvable: true, reason: null };
};
