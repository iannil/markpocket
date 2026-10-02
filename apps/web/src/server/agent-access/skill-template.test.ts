import { describe, expect, it } from 'vitest';

import { renderSkillMarkdown } from './skill-template';
import { packageVersion } from './version';

describe('renderSkillMarkdown', () => {
  it('produces Agent Skills frontmatter with the instance origin baked in', () => {
    const md = renderSkillMarkdown('http://localhost:7420', packageVersion);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('name: markpocket');
    expect(md).toContain('description:');
    expect(md).toContain('http://localhost:7420/api/v1');
    expect(md).toContain('http://localhost:7420/api/mcp');
    expect(md).toContain('http://localhost:7420/feed/{shareToken}');
    expect(md).toContain(`version: ${packageVersion}`);
  });

  it('documents all four integration channels', () => {
    const md = renderSkillMarkdown('https://db.example.com', '1.0.0');
    for (const marker of ['## REST API', '## MCP server', '## RSS feeds', 'Bearer']) {
      expect(md).toContain(marker);
    }
  });

  it('never interpolates a token', () => {
    const md = renderSkillMarkdown('https://db.example.com', '1.0.0');
    expect(md).not.toMatch(/mpk_[0-9a-f]{48}/);
  });
});
