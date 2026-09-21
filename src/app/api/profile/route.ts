// NEXUS ARMOR — optional profile sync API. The game is fully playable without it
// (offline-first localStorage); this endpoint is the path toward online features.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface SyncBody {
  clientId?: string
  profile?: {
    updatedAt?: number
    [key: string]: unknown
  }
}

export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get('clientId')
    if (!clientId) {
      return NextResponse.json({ error: 'clientId required' }, { status: 400 })
    }
    const row = await db.playerSave.findUnique({ where: { clientId } })
    if (!row) return NextResponse.json({ profile: null })
    return NextResponse.json({ profile: JSON.parse(row.data) })
  } catch (err) {
    console.error('[profile] GET failed', err)
    // graceful: the game treats any failure as "no server copy"
    return NextResponse.json({ profile: null })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SyncBody
    const clientId = body.clientId
    const profile = body.profile
    if (!clientId || !profile || typeof profile.updatedAt !== 'number') {
      return NextResponse.json({ error: 'clientId and profile.updatedAt required' }, { status: 400 })
    }
    const data = JSON.stringify(profile)
    await db.playerSave.upsert({
      where: { clientId },
      update: { data, updatedAt: new Date() },
      create: { clientId, data },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[profile] POST failed', err)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
