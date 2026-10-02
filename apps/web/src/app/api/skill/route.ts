import { renderSkillMarkdown } from '@/server/agent-access/skill-template';
import { packageVersion } from '@/server/agent-access/version';

// GET /api/skill — a ready-to-install Agent Skill document describing every
// way to drive this instance (REST, MCP, RSS), with this instance's origin
// already interpolated. Public by design: it leaks no data, only the shape of
// the API — the token does the gating.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const markdown = renderSkillMarkdown(url.origin, packageVersion);
  const headers: Record<string, string> = {
    'content-type': 'text/markdown; charset=utf-8',
    'cache-control': 'public, max-age=300',
    'x-content-type-options': 'nosniff',
  };
  if (url.searchParams.get('download') === '1') {
    headers['content-disposition'] = 'attachment; filename="markpocket-SKILL.md"';
  }
  return new Response(markdown, { status: 200, headers });
}
