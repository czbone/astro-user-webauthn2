import { describe, expect, it } from 'vitest'
import { collectEnvIssues } from '@/server/env-check'

const productionBase = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db:5432/app',
  REDIS_URL: 'redis://redis:6379/',
  APP_URL: 'https://auth.example.com',
  WEBAUTHN_RP_ID: 'auth.example.com',
  WEBAUTHN_ORIGIN: 'https://auth.example.com',
  APP_ID: 'auth',
  PARENT_DOMAIN: 'example.com'
}

describe('collectEnvIssues', () => {
  it('reports no errors when production variables are set', () => {
    expect(collectEnvIssues(productionBase, true)).toEqual([])
  })

  it('errors on missing required variables in production', () => {
    const issues = collectEnvIssues({ NODE_ENV: 'production' }, true)
    const names = issues.filter((issue) => issue.level === 'error').map((issue) => issue.name)
    expect(names).toEqual([
      'DATABASE_URL',
      'REDIS_URL',
      'APP_URL',
      'WEBAUTHN_RP_ID',
      'WEBAUTHN_ORIGIN',
      'APP_ID',
      'PARENT_DOMAIN'
    ])
  })

  it('warns on missing variables outside production', () => {
    const issues = collectEnvIssues({}, false)
    expect(issues.some((issue) => issue.name === 'NODE_ENV' && issue.level === 'warn')).toBe(true)
    expect(issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect(issues.some((issue) => issue.name === 'WEBAUTHN_RP_ID' && issue.level === 'warn')).toBe(
      true
    )
  })

  it('errors on localhost defaults in production', () => {
    const issues = collectEnvIssues(
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db:5432/app',
        REDIS_URL: 'redis://localhost:6379/',
        APP_URL: 'http://auth.localhost:3000',
        WEBAUTHN_RP_ID: 'auth.localhost',
        WEBAUTHN_ORIGIN: 'http://auth.localhost:3000',
        APP_ID: 'auth',
        PARENT_DOMAIN: 'localhost'
      },
      true
    )
    const names = issues.filter((issue) => issue.level === 'error').map((issue) => issue.name)
    expect(names).toEqual([
      'REDIS_URL',
      'APP_URL',
      'WEBAUTHN_RP_ID',
      'WEBAUTHN_ORIGIN',
      'PARENT_DOMAIN'
    ])
  })

  it('errors when smtp is selected without host or from', () => {
    const issues = collectEnvIssues({ ...productionBase, MAIL_MODE: 'smtp' }, true)
    expect(issues.some((issue) => issue.name === 'SMTP' && issue.level === 'error')).toBe(true)
  })

  it('errors on an invalid DB_LOG_LEVEL in production', () => {
    const issues = collectEnvIssues({ ...productionBase, DB_LOG_LEVEL: 'debug' }, true)
    expect(issues.some((issue) => issue.name === 'DB_LOG_LEVEL' && issue.level === 'error')).toBe(
      true
    )
  })

  it('accepts a valid DB_LOG_LEVEL in production', () => {
    expect(collectEnvIssues({ ...productionBase, DB_LOG_LEVEL: 'query' }, true)).toEqual([])
  })

  it('errors when production seed uses the default password', () => {
    const issues = collectEnvIssues(
      { ...productionBase, RUN_SEED: 'true', SEED_ADMIN_PASSWORD: 'admin-change-me' },
      true
    )
    expect(
      issues.some((issue) => issue.name === 'SEED_ADMIN_PASSWORD' && issue.level === 'error')
    ).toBe(true)
  })

  it('accepts a trailing slash on APP_URL in production', () => {
    expect(
      collectEnvIssues({ ...productionBase, APP_URL: 'https://auth.example.com/' }, true)
    ).toEqual([])
  })

  it('errors when APP_URL and WEBAUTHN_ORIGIN differ in production', () => {
    const issues = collectEnvIssues(
      {
        ...productionBase,
        APP_URL: 'https://sample1.example.test',
        WEBAUTHN_ORIGIN: 'https://sample.example.test',
        WEBAUTHN_RP_ID: 'sample.example.test',
        PARENT_DOMAIN: 'example.test'
      },
      true
    )
    expect(
      issues.some(
        (issue) =>
          issue.name === 'WEBAUTHN_ORIGIN' &&
          issue.level === 'error' &&
          issue.message.includes('origin が一致しません')
      )
    ).toBe(true)
  })

  it('errors when WEBAUTHN_RP_ID does not match the origin hostname in production', () => {
    const issues = collectEnvIssues(
      {
        ...productionBase,
        WEBAUTHN_RP_ID: 'sample.example.test'
      },
      true
    )
    expect(
      issues.some((issue) => issue.name === 'WEBAUTHN_RP_ID' && issue.level === 'error')
    ).toBe(true)
  })

  it('errors when WEBAUTHN_ORIGIN is http in production', () => {
    const issues = collectEnvIssues(
      {
        ...productionBase,
        APP_URL: 'http://auth.example.com',
        WEBAUTHN_ORIGIN: 'http://auth.example.com'
      },
      true
    )
    expect(
      issues.some(
        (issue) =>
          issue.name === 'WEBAUTHN_ORIGIN' &&
          issue.level === 'error' &&
          issue.message.includes('https')
      )
    ).toBe(true)
  })

  it('does not check origin consistency outside production', () => {
    const issues = collectEnvIssues(
      {
        APP_URL: 'https://sample1.example.test',
        WEBAUTHN_ORIGIN: 'https://sample.example.test',
        WEBAUTHN_RP_ID: 'sample.example.test'
      },
      false
    )
    expect(issues.filter((issue) => issue.level === 'error')).toEqual([])
    expect(issues.some((issue) => issue.message.includes('origin が一致しません'))).toBe(false)
  })
})
