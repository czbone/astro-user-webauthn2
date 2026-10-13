import { describe, expect, it } from 'vitest'
import {
  readDefaultPermission,
  readGrantPermission,
  resolveEffectivePermission
} from '@/server/auth/permissions'

describe('resolveEffectivePermission', () => {
  it('uses the default when there is no grant row', () => {
    expect(resolveEffectivePermission({ defaultPermission: 'user' }, null)).toBe('user')
    expect(resolveEffectivePermission({ defaultPermission: 'admin' }, null)).toBe('admin')
  })

  it('lets a grant replace the default, including a lower or higher value', () => {
    expect(resolveEffectivePermission({ defaultPermission: 'user' }, { permission: 'admin' })).toBe(
      'admin'
    )
    expect(resolveEffectivePermission({ defaultPermission: 'admin' }, { permission: 'user' })).toBe(
      'user'
    )
  })

  it('does not fall through to the default for none, empty, or unknown grant values', () => {
    expect(resolveEffectivePermission({ defaultPermission: 'user' }, { permission: 'none' })).toBe(
      null
    )
    expect(resolveEffectivePermission({ defaultPermission: 'admin' }, { permission: '' })).toBe(
      null
    )
    expect(
      resolveEffectivePermission({ defaultPermission: 'user' }, { permission: 'editor' })
    ).toBe(null)
  })

  it('grants nothing when the app is missing, the default is null, or the default is not positive', () => {
    expect(resolveEffectivePermission(null, null)).toBe(null)
    expect(resolveEffectivePermission({ defaultPermission: null }, null)).toBe(null)
    expect(resolveEffectivePermission({ defaultPermission: 'editor' }, null)).toBe(null)
    expect(resolveEffectivePermission({ defaultPermission: '' }, null)).toBe(null)
    expect(resolveEffectivePermission({ defaultPermission: 'none' }, null)).toBe(null)
  })

  it('uses a positive grant when the default is null', () => {
    expect(resolveEffectivePermission({ defaultPermission: null }, { permission: 'user' })).toBe(
      'user'
    )
  })
})

describe('permission input', () => {
  it('accepts null or a positive permission as a default', () => {
    expect(readDefaultPermission(null)).toEqual({ ok: true, value: null })
    expect(readDefaultPermission('user')).toEqual({ ok: true, value: 'user' })
    expect(readDefaultPermission('admin')).toEqual({ ok: true, value: 'admin' })
    expect(readDefaultPermission('none').ok).toBe(false)
    expect(readDefaultPermission('').ok).toBe(false)
    expect(readDefaultPermission('editor').ok).toBe(false)
    expect(readDefaultPermission(undefined).ok).toBe(false)
  })

  it('accepts a positive permission or none as a grant', () => {
    expect(readGrantPermission('admin')).toBe('admin')
    expect(readGrantPermission('user')).toBe('user')
    expect(readGrantPermission('none')).toBe('none')
    expect(readGrantPermission('')).toBeNull()
    expect(readGrantPermission('editor')).toBeNull()
    expect(readGrantPermission(null)).toBeNull()
  })
})
