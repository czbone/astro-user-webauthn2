import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON
} from '@simplewebauthn/server'
import { authEnv } from '@/server/auth/env'
import {
  saveChallenge,
  takeAuthChallengeByValue,
  takeAuthChallengeForUser,
  takeChallenge
} from '@/server/auth/challenges'
import CredentialDB from '@/server/db/credential'
import UserDB from '@/server/db/user'

function rp() {
  return {
    rpID: authEnv.rpID(),
    rpName: authEnv.rpName(),
    origin: authEnv.origin()
  }
}

function parseTransports(
  value: string | null | undefined
): AuthenticatorTransport[] | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as AuthenticatorTransport[]
  } catch {
    return undefined
  }
}

function toCredentialDescriptor(cred: { credentialId: string }) {
  return { id: cred.credentialId }
}

function extractChallengeFromClientData(clientDataJSON: string): string | null {
  try {
    const json = Buffer.from(clientDataJSON, 'base64url').toString('utf8')
    const data = JSON.parse(json) as { challenge?: string }
    return data.challenge ?? null
  } catch {
    return null
  }
}

export async function createRegistrationOptions(userId: string, email: string, name: string) {
  const existing = await CredentialDB.listByUserId(userId)
  const options = await generateRegistrationOptions({
    rpName: rp().rpName,
    rpID: rp().rpID,
    userName: email,
    userDisplayName: name,
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    excludeCredentials: existing.map(toCredentialDescriptor),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred'
    }
  })

  await saveChallenge('reg', options.challenge, userId)
  return options
}

export async function verifyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  deviceName: string
) {
  const expected = await takeChallenge('reg', userId)
  if (!expected) {
    throw new Error('登録チャレンジが見つかりません')
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: expected.challenge,
    expectedOrigin: rp().origin,
    expectedRPID: rp().rpID
  })

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('パスキー登録の検証に失敗しました')
  }

  const { credential } = verification.registrationInfo

  await CredentialDB.create({
    userId,
    credentialId: credential.id,
    publicKey: Uint8Array.from(credential.publicKey),
    counter: BigInt(credential.counter),
    transports: credential.transports ? JSON.stringify(credential.transports) : null,
    deviceName
  })

  return verification
}

export async function createAuthenticationOptions(email: string) {
  const user = await UserDB.findByEmail(email)
  if (!user) {
    const options = await generateAuthenticationOptions({
      rpID: rp().rpID,
      userVerification: 'preferred'
    })
    await saveChallenge('auth', options.challenge)
    return { options, userExists: false as const, hasPasskey: false as const }
  }

  const credentials = await CredentialDB.listByUserId(user.id)
  if (credentials.length === 0) {
    const options = await generateAuthenticationOptions({
      rpID: rp().rpID,
      userVerification: 'preferred'
    })
    await saveChallenge('auth', options.challenge, user.id)
    return {
      options,
      userExists: true as const,
      hasPasskey: false as const,
      userId: user.id
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: rp().rpID,
    userVerification: 'preferred',
    allowCredentials: credentials.map(toCredentialDescriptor)
  })

  await saveChallenge('auth', options.challenge, user.id)
  return {
    options,
    userExists: true as const,
    hasPasskey: true as const,
    userId: user.id
  }
}

export async function verifyAuthentication(response: AuthenticationResponseJSON) {
  const credential = await CredentialDB.findByCredentialId(response.id)
  if (!credential) {
    throw new Error('クレデンシャルが見つかりません')
  }

  const challengeFromClient = extractChallengeFromClientData(response.response.clientDataJSON)
  const expected =
    (challengeFromClient && (await takeAuthChallengeByValue(challengeFromClient))) ||
    (await takeAuthChallengeForUser(credential.userId))

  if (!expected) {
    throw new Error('認証チャレンジが見つかりません')
  }

  const transports = parseTransports(credential.transports)
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: expected.challenge,
    expectedOrigin: rp().origin,
    expectedRPID: rp().rpID,
    credential: {
      id: credential.credentialId,
      publicKey: Uint8Array.from(credential.publicKey),
      counter: Number(credential.counter),
      ...(transports ? { transports } : {})
    }
  })

  if (!verification.verified) {
    throw new Error('パスキー認証の検証に失敗しました')
  }

  await CredentialDB.updateCounter(
    credential.id,
    BigInt(verification.authenticationInfo.newCounter)
  )
  return { verification, userId: credential.userId }
}

type ReauthKind = 'reauth' | 'emailchg-reauth'

function reauthOkKind(kind: ReauthKind): 'reauth-ok' | 'emailchg-reauth-ok' {
  return kind === 'reauth' ? 'reauth-ok' : 'emailchg-reauth-ok'
}

async function createScopedReauthOptions(userId: string, kind: ReauthKind) {
  const credentials = await CredentialDB.listByUserId(userId)
  if (credentials.length === 0) {
    throw new Error('パスキーが登録されていません')
  }

  const options = await generateAuthenticationOptions({
    rpID: rp().rpID,
    userVerification: 'required',
    allowCredentials: credentials.map(toCredentialDescriptor)
  })

  await saveChallenge(kind, options.challenge, userId)
  return options
}

async function verifyScopedReauth(
  userId: string,
  response: AuthenticationResponseJSON,
  kind: ReauthKind
) {
  const expected = await takeChallenge(kind, userId)
  if (!expected) {
    throw new Error('再認証チャレンジが見つかりません')
  }

  const credential = await CredentialDB.findByCredentialId(response.id)
  if (!credential || credential.userId !== userId) {
    throw new Error('クレデンシャルが見つかりません')
  }

  const transports = parseTransports(credential.transports)
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: expected.challenge,
    expectedOrigin: rp().origin,
    expectedRPID: rp().rpID,
    credential: {
      id: credential.credentialId,
      publicKey: Uint8Array.from(credential.publicKey),
      counter: Number(credential.counter),
      ...(transports ? { transports } : {})
    }
  })

  if (!verification.verified) {
    throw new Error('再認証に失敗しました')
  }

  await CredentialDB.updateCounter(
    credential.id,
    BigInt(verification.authenticationInfo.newCounter)
  )
  await saveChallenge(reauthOkKind(kind), '1', userId)
  return verification
}

export async function createReauthOptions(userId: string) {
  return createScopedReauthOptions(userId, 'reauth')
}

export async function verifyReauth(userId: string, response: AuthenticationResponseJSON) {
  return verifyScopedReauth(userId, response, 'reauth')
}

export async function consumeReauth(userId: string): Promise<boolean> {
  return Boolean(await takeChallenge('reauth-ok', userId))
}

export async function createEmailChangeReauthOptions(userId: string) {
  return createScopedReauthOptions(userId, 'emailchg-reauth')
}

export async function verifyEmailChangeReauth(
  userId: string,
  response: AuthenticationResponseJSON
) {
  return verifyScopedReauth(userId, response, 'emailchg-reauth')
}

export async function consumeEmailChangeReauth(userId: string): Promise<boolean> {
  return Boolean(await takeChallenge('emailchg-reauth-ok', userId))
}
