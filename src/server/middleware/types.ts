import type { AuthUser } from '@/types/models'

export type AppVariables = {
  user: AuthUser
  sessionId: string
  sessionToken: string
  tokenHash: string
  appPermission: 'admin' | 'user'
}
