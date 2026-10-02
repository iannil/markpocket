'use client';

import { toast } from '@/lib/toast';

// Shared clipboard helper for one-time secrets and URLs (share links, invite
// links, API tokens, MCP config snippets). Extracted from the members page
// when the agent-access settings page became the third caller.
export function copyToClipboard(text: string, successMessage: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(successMessage),
    () => toast.error('Copy failed'),
  );
}
