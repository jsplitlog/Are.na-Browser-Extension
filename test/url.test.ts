import { describe, expect, it } from 'vitest';
import { buildQueries, classifyUrl, domainLabel, normalizeUrl } from '../src/core/url';

describe('URL resolver helpers', () => {
  it.each([
    ['https://www.seangoedecke.com/llms-reward-expertise/', 'seangoedecke.com/llms-reward-expertise'],
    ['https://slate.com/tech/x.html?utm_source=pocket&utm_medium=email', 'slate.com/tech/x.html'],
    ['http://EN.Wikipedia.org:80/wiki/Foo/', 'en.wikipedia.org/wiki/Foo'],
  ])('normalizes %s', (url, expected) => expect(normalizeUrl(url)).toBe(expected));

  it.each([
    ['www.seangoedecke.com', 'seangoedecke'], ['en.wikipedia.org', 'wikipedia'],
    ['news.ycombinator.com', 'ycombinator'], ['www.theguardian.co.uk', 'theguardian'],
  ])('uses the registrable label for %s', (host, expected) => expect(domainLabel(host)).toBe(expected));

  it.each([
    ['https://en.wikipedia.org/wiki/Walter_Van_Beirendonck', 'wikipedia Walter Van Beirendonck'],
    ['https://www.seangoedecke.com/llms-reward-expertise/', 'seangoedecke llms reward expertise'],
  ])('builds the reference query for %s', (url, expected) => expect(buildQueries(url)[0]).toBe(expected));

  it('drops tracking params, sorts retained params, and caps query requests', () => {
    expect(normalizeUrl('https://www.example.com/a/?z=2&utm_source=x&a=1')).toBe('example.com/a?a=1&z=2');
    expect(normalizeUrl('https://example.com/a?UTM_SOURCE=x&FbClId=y&keep=1')).toBe('example.com/a?keep=1');
    expect(buildQueries('https://example.com/a-long-slug-with-many-words')).toEqual(['example long slug with many', 'long slug with many']);
  });

  it('does not duplicate a domain label that appears later in the slug', () => {
    expect(buildQueries('https://example.com/a-guide-to-example-design')[0]).toBe('guide example design');
  });

  it('uses a meaningful subdomain for a root-page lookup', () => {
    expect(buildQueries('https://negative.sanctuary.computer/')).toEqual([
      'negative sanctuary',
      'sanctuary',
    ]);
  });

  it('uses a descriptive domain suffix when a root hostname has no other search words', () => {
    expect(buildQueries('https://h-4.digital/')).toEqual(['h-4 digital', 'h-4']);
    expect(buildQueries('https://portfolio.design/')).toEqual(['portfolio design', 'portfolio']);
  });

  it('falls back to the full hostname for short and punycode-style roots', () => {
    expect(buildQueries('https://x.com/')).toEqual(['x com', 'x']);
    expect(buildQueries('https://xn--bcher-kva.com/')).toEqual(['xn--bcher-kva com', 'xn--bcher-kva']);
  });
});

describe('classifyUrl', () => {
  it.each(['mailto:test@example.com', 'chrome://extensions', 'not a url'])('rejects non-web URLs: %s', (url) => {
    expect(classifyUrl(url).resolvable).toBe(false);
  });

  it.each(['http://localhost:3000/article/path', 'http://127.0.0.1/article/path', 'http://10.0.0.1/article/path', 'http://172.20.0.1/article/path', 'http://192.168.1.1/article/path', 'http://100.64.0.1/article/path', 'http://[::1]/article/path', 'http://[fd00::1]/article/path', 'http://[::ffff:127.0.0.1]/article/path'])('rejects local and private addresses: %s', (url) => {
    expect(classifyUrl(url).resolvable).toBe(false);
  });

  it.each(['http://printer.local/design-article', 'http://intranet/design-article'])('rejects local hostnames: %s', (url) => {
    expect(classifyUrl(url).resolvable).toBe(false);
  });

  it('allows a public IPv4-mapped IPv6 address after Chrome canonicalizes it', () => {
    expect(classifyUrl('http://[::ffff:8.8.8.8]/')).toEqual({ resolvable: true, reason: null });
  });

  it.each(['https://ar.pinterest.com/pin/1688918604964037/', 'https://facebook.com/533722736653230/photos/pcb.2686724', 'https://cdn.shopify.com/s/files/1/1159/3118/files/00_2015.jpg', 'https://78.media.tumblr.com/311748aa9e2330c23f719ed78b23e795/image.jpg'])('rejects known opaque assets: %s', (url) => {
    expect(classifyUrl(url).resolvable).toBe(false);
  });

  it('accepts public URLs without treating word count as a validity requirement', () => {
    expect(classifyUrl('https://example.com/123456')).toEqual({ resolvable: true, reason: null });
    expect(classifyUrl('https://example.com/article')).toEqual({ resolvable: true, reason: null });
    expect(classifyUrl('https://x.com/')).toEqual({ resolvable: true, reason: null });
    expect(classifyUrl('https://example.com/essay')).toEqual({ resolvable: true, reason: null });
    expect(classifyUrl('https://negative.sanctuary.computer/')).toEqual({ resolvable: true, reason: null });
    expect(classifyUrl('https://h-4.digital/')).toEqual({ resolvable: true, reason: null });
    expect(classifyUrl('https://portfolio.design/')).toEqual({ resolvable: true, reason: null });
    expect(classifyUrl('https://xn--bcher-kva.com/')).toEqual({ resolvable: true, reason: null });
    expect(classifyUrl('https://example.com/an-essay-about-design')).toEqual({ resolvable: true, reason: null });
  });
});
