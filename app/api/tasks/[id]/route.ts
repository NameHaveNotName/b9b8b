export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return NextResponse.json({ message: 'Task status', id: params.id })
}
