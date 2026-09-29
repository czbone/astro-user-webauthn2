export type UserRole = 'admin' | 'user'

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

export type Post = {
  id: string
  title: string
  content: string | null
  published: boolean
  authorId: string
  createdAt: string
  updatedAt: string
  author: {
    id: string
    email: string
    name: string
  }
}

export type DeviceCredential = {
  id: string
  deviceName: string | null
  createdAt: string
  lastUsedAt: string | null
}
