import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const { _internal } = await import("./sources/rss.js");

describe("RSS parser", () => {
  it("extracts items from a minimal RSS 2.0 envelope", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Security News</title>
  <item>
    <title>Critical RCE in Acme Server actively exploited</title>
    <link>https://example.com/article-1</link>
    <description><![CDATA[An RCE on Acme Server is being actively exploited in the wild.]]></description>
    <pubDate>Fri, 22 May 2026 14:00:00 GMT</pubDate>
  </item>
  <item>
    <title>New patch from Vendor X</title>
    <link>https://example.com/article-2</link>
    <description>routine update</description>
  </item>
</channel></rss>`;
    const items = _internal.extractItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toContain("Critical RCE in Acme Server");
    expect(items[0]?.link).toBe("https://example.com/article-1");
    expect(items[0]?.description).toMatch(/actively exploited/);
  });

  it("extracts items from a minimal Atom 1.0 envelope", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Zero-day exploit chain on Acme</title>
    <link href="https://example.com/atom-1" rel="alternate"/>
    <summary>Two bugs chained together; PoC released.</summary>
    <published>2026-05-22T14:00:00Z</published>
  </entry>
</feed>`;
    const items = _internal.extractItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0]?.link).toBe("https://example.com/atom-1");
    expect(items[0]?.description).toMatch(/PoC released/);
  });

  it("flags 'actively exploited' / 'zero-day' titles as CRITICAL", () => {
    expect(_internal.severityFromTitle("Actively exploited RCE", "")).toBe("CRITICAL");
    expect(_internal.severityFromTitle("Zero day in Acme", "")).toBe("CRITICAL");
    expect(_internal.severityFromTitle("Critical bug found", "")).toBe("HIGH");
    expect(_internal.severityFromTitle("Routine patch", "")).toBe("MEDIUM");
  });

  it("strips HTML tags + collapses whitespace", () => {
    const dirty = "<p>Hello <strong>world</strong></p>  <br/>  more";
    expect(_internal.stripHtml(dirty)).toBe("Hello world more");
  });
});
