import { NextResponse } from 'next/server';

// Liveness probe for the Docker HEALTHCHECK and orchestrators.
export async function GET() {
  return NextResponse.json({ ok: true });
}
