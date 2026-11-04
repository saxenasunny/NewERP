import { describe, expect, it } from "vitest";

import { cleanRichText, richTextToPlain } from "@/modules/content/rich-text";

describe("course rich text", () => {
  it("keeps ordinary formatting", () => {
    const html = "<h2>Week 1</h2><p>Read <strong>carefully</strong>.</p><ul><li>One</li></ul>";
    expect(cleanRichText(html)).toBe(html);
  });

  it("removes scripts and event handlers", () => {
    const cleaned = cleanRichText(
      '<p onclick="steal()">Hello</p><script>alert(1)</script><img src=x onerror="alert(2)">',
    );
    expect(cleaned).toBe("<p>Hello</p>");
  });

  it("removes javascript: links but keeps http links", () => {
    const cleaned = cleanRichText(
      '<a href="javascript:alert(1)">bad</a><a href="https://example.com/doc">good</a>',
    );
    expect(cleaned).toContain("https://example.com/doc");
    expect(cleaned).not.toContain("javascript:");
  });

  it("adds noopener to links", () => {
    const cleaned = cleanRichText('<a href="https://example.com">x</a>');
    expect(cleaned).toContain('rel="nofollow noopener noreferrer"');
  });

  it("drops iframes and styles", () => {
    const cleaned = cleanRichText(
      '<iframe src="https://evil.example"></iframe><style>body{}</style>',
    );
    expect(cleaned).toBeNull();
  });

  it("returns null for blank input", () => {
    expect(cleanRichText("   ")).toBeNull();
    expect(cleanRichText(null)).toBeNull();
  });

  it("produces plain text for previews", () => {
    const plain = richTextToPlain("<h2>Title</h2><p>Some <em>body</em> text.</p>");
    expect(plain).toBe("Title Some body text.");
  });

  it("truncates long plain text with an ellipsis", () => {
    const plain = richTextToPlain("<p>" + "a".repeat(300) + "</p>", 20);
    expect(plain).toHaveLength(20);
    expect(plain.endsWith("…")).toBe(true);
  });
});
