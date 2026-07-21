import { describe, expect, it } from 'vitest';
import { extractChangelogSection } from './changelog.ts';

/**
 * The post-merge release job reuses the version's CHANGELOG.md section as the GitHub Release notes.
 * commit-and-tag-version renders a major bump as an `#` heading and minor/patch as `##`, both with a
 * `[version](compare-url)` link; the extractor returns just that version's body, up to the next
 * version heading.
 */
const CHANGELOG = `# [2.0.0](https://example.com/compare/v1.0.2...v2.0.0) (2026-07-05)


* feat(mcp)!: serve MCP over streamable HTTP


### BREAKING CHANGES

* the stdio MCP transport is removed.

## [1.0.2](https://example.com/compare/v1.0.1...v1.0.2) (2026-07-05)


### Bug Fixes

* **slskd:** parse the real per-user downloads response shape ([491fc54](https://example.com/commit/491fc54))

## [1.0.1](https://example.com/compare/v1.0.0...v1.0.1) (2026-07-05)


### Bug Fixes

* **deps:** update dependency pino to v10 ([66447c9](https://example.com/commit/66447c9))
`;

describe('extractChangelogSection', () => {
  it('extracts a minor/patch (##) section body without bleeding into the next version', () => {
    const section = extractChangelogSection(CHANGELOG, '1.0.2');

    expect(section).toContain('### Bug Fixes');
    expect(section).toContain('parse the real per-user downloads response shape');
    expect(section).not.toContain('1.0.1');
    expect(section).not.toContain('pino');
    expect(section).not.toContain('2.0.0');
  });

  it('extracts a major (#) section including its breaking-changes block', () => {
    const section = extractChangelogSection(CHANGELOG, '2.0.0');

    expect(section).toContain('serve MCP over streamable HTTP');
    expect(section).toContain('### BREAKING CHANGES');
    expect(section).toContain('the stdio MCP transport is removed.');
    expect(section).not.toContain('1.0.2');
  });

  it('extracts the last section up to end of file', () => {
    const section = extractChangelogSection(CHANGELOG, '1.0.1');

    expect(section).toContain('update dependency pino to v10');
    expect(section.trim().length).toBeGreaterThan(0);
  });

  it('does not include the version heading line itself', () => {
    const section = extractChangelogSection(CHANGELOG, '2.0.0');

    expect(section).not.toMatch(/^#{1,2} \[?2\.0\.0/);
  });

  it('throws when the version is absent so the release fails loudly', () => {
    expect(() => extractChangelogSection(CHANGELOG, '9.9.9')).toThrow(/9\.9\.9/);
  });

  it('does not match a version that is only a prefix of another', () => {
    // 1.0 must not match 1.0.2's heading
    expect(() => extractChangelogSection(CHANGELOG, '1.0')).toThrow();
  });
});
