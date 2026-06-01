export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

export async function GET(request: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ message: 'Task status', id: params.id })
}
