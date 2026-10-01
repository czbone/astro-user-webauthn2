import { describe, expect, it } from 'vitest'
import { redirectToCanonicalHost } from '@/server/auth/canonical-host'

const CANONICAL = 'http://auth.localhost:3000'

describe('canonical host redirect', () => {
  it('sends a page opened on localhost to the auth server origin', async () => {
    const response = redirectToCanonicalHost(
      new Request('http://localhost:3000/login?next=%2Fposts'),
      CANONICAL
    )
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe('http://auth.localhost:3000/login?next=%2Fposts')
  })

  it('leaves a request that is already on the auth server host', () => {
    const response = redirectToCanonicalHost(
      new Request('http://auth.localhost:3000/login'),
      CANONICAL
    )
    expect(response).toBeNull()
  })

  it('does not redirect mutating requests', () => {
    const response = redirectToCanonicalHost(
      new Request('http://localhost:3000/api/auth/login/method', { method: 'POST' }),
      CANONICAL
    )
    expect(response).toBeNull()
  })
})
