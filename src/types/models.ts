export type UserRole = 'admin' | 'manager' | 'user'

export type AuthUser = {
  id: string
  email: string
  name: string
  role: UserRole
  hasPasskey: boolean
  mustSetupPasskey: boolean
}

export type UserPublic = {
  id: string
  email: string
  name: string
  role: UserRole
  createdAt: string
  credentialCount?: number
}

export type DeviceCredential = {
  id: string
  deviceName: string | null
  createdAt: string
  lastUsedAt: string | null
}
