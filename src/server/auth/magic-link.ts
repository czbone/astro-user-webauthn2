import { MAGIC_LINK_TTL_MS } from '@/server/auth/env'
import { sendUserInviteMail } from '@/server/auth/mail'
import { generateToken, hashToken } from '@/server/auth/tokens'
import MagicLinkDB from '@/server/db/magic-link'
import SessionDB from '@/server/db/session'

export async function issueInviteMagicLink(params: {
  userId: string
  email: string
  name: string
  revokeSessions: boolean
}) {
  if (params.revokeSessions) {
    await SessionDB.revokeAllForUser(params.userId)
  }

  await MagicLinkDB.invalidatePendingForUser(params.userId)
  const token = generateToken()
  await MagicLinkDB.create(
    params.userId,
    hashToken(token),
    new Date(Date.now() + MAGIC_LINK_TTL_MS)
  )
  await sendUserInviteMail({
    to: params.email,
    name: params.name,
    token
  })
}
