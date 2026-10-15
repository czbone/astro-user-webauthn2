import { describe, expect, it } from 'vitest'
import {
  readDefaultPermission,
  readGrantPermission,
  resolveEffectivePermission
} from '@/server/auth/permissions'

describe('resolveEffectivePermission', () => {
  it('uses the default when there is no grant row', () => {
    expect(resolveEffectivePermission({ defaultPermission: 'allow' }, null)).toBe('allow')
  })

  it('lets a grant replace the default', () => {
    expect(resolveEffectivePermission({ defaultPermission: null }, { permission: 'allow' })).toBe(
      'allow'
    )
    expect(resolveEffectivePermission({ defaultPermission: 'allow' }, { permission: 'none' })).toBe(
      null
    )
  })

  it('does not fall through to the default for none, empty, or unknown grant values', () => {
    expect(resolveEffectivePermission({ defaultPermission: 'allow' }, { permission: 'none' })).toBe(
      null
    )
    expect(resolveEffectivePermission({ defaultPermission: 'allow' }, { permission: '' })).toBe(
      null
    )
    expect(
      resolveEffectivePermission({ defaultPermission: 'allow' }, { permission: 'editor' })
    ).toBe(null)
    expect(
      resolveEffectivePermission({ defaultPermission: 'allow' }, { permission: 'admin' })
    ).toBe(null)
  })

  it('grants nothing when the app is missing, the default is null, or the default is not access', () => {
    expect(resolveEffectivePermission(null, null)).toBe(null)
    expect(resolveEffectivePermission({ defaultPermission: null }, null)).toBe(null)
    expect(resolveEffectivePermission({ defaultPermission: 'editor' }, null)).toBe(null)
    expect(resolveEffectivePermission({ defaultPermission: 'user' }, null)).toBe(null)
    expect(resolveEffectivePermission({ defaultPermission: '' }, null)).toBe(null)
    expect(resolveEffectivePermission({ defaultPermission: 'none' }, null)).toBe(null)
  })
})

describe('permission input', () => {
  it('accepts null or allow as a default', () => {
    expect(readDefaultPermission(null)).toEqual({ ok: true, value: null })
    expect(readDefaultPermission('allow')).toEqual({ ok: true, value: 'allow' })
    expect(readDefaultPermission('user').ok).toBe(false)
    expect(readDefaultPermission('admin').ok).toBe(false)
    expect(readDefaultPermission('none').ok).toBe(false)
    expect(readDefaultPermission('').ok).toBe(false)
    expect(readDefaultPermission(undefined).ok).toBe(false)
  })

  it('accepts allow or none as a grant', () => {
    expect(readGrantPermission('allow')).toBe('allow')
    expect(readGrantPermission('none')).toBe('none')
    expect(readGrantPermission('user')).toBeNull()
    expect(readGrantPermission('admin')).toBeNull()
    expect(readGrantPermission('')).toBeNull()
    expect(readGrantPermission(null)).toBeNull()
  })
})
