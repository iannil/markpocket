import { handlePublicFormGet, handlePublicFormPost } from '@/server/forms/http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ token: string }> };
export async function GET(req: Request, context: Context): Promise<Response> {
  return handlePublicFormGet(req, (await context.params).token);
}
export async function POST(req: Request, context: Context): Promise<Response> {
  return handlePublicFormPost(req, (await context.params).token);
}
