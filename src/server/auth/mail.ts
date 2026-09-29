import nodemailer from 'nodemailer'
import { authEnv } from '@/server/auth/env'

export type MailMessage = {
  to: string
  subject: string
  text: string
  html?: string
}

export async function sendMail(message: MailMessage): Promise<void> {
  const mode = authEnv.mailMode()

  if (mode === 'console') {
    console.log('----- MAIL (console) -----')
    console.log(`To: ${message.to}`)
    console.log(`Subject: ${message.subject}`)
    console.log(message.text)
    console.log('--------------------------')
    return
  }

  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || '587')
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM

  if (!host || !from) {
    throw new Error('SMTP_HOST and SMTP_FROM are required when MAIL_MODE=smtp')
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined
  })

  await transporter.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html
  })
}

export async function sendUserInviteMail(params: { to: string; name: string; token: string }) {
  const url = `${authEnv.appUrl()}/auth/link/${params.token}`
  const text = [
    `${params.name} 様`,
    '',
    'アカウントが作成されました。以下のリンクからログインしてください（1時間有効）。',
    '',
    url,
    '',
    'リンクを開いたあと、画面のボタンでログインを確定してください。',
    'ログイン後、パスキー（WebAuthn）の登録が必要です。'
  ].join('\n')

  await sendMail({
    to: params.to,
    subject: 'アカウント招待のご案内',
    text
  })
}

export async function sendDeviceInviteMail(params: { to: string; name: string; token: string }) {
  const url = `${authEnv.appUrl()}/invite/device/${params.token}`
  const text = [
    `${params.name} 様`,
    '',
    '新しいデバイスへのパスキー登録用リンクです（1時間有効）。',
    '',
    url,
    '',
    '心当たりがない場合はこのメールを無視してください。'
  ].join('\n')

  await sendMail({
    to: params.to,
    subject: 'デバイス追加のご案内',
    text
  })
}

export async function sendPasswordResetMail(params: { to: string; name: string; token: string }) {
  const url = `${authEnv.appUrl()}/reset-password/${params.token}`
  const text = [
    `${params.name} 様`,
    '',
    'ログインできないときの復旧用リンクです（1時間有効）。',
    '',
    url,
    '',
    'この操作を完了すると、登録済みのパスキーはすべて無効になります。',
    '心当たりがない場合はこのメールを無視してください。'
  ].join('\n')

  await sendMail({
    to: params.to,
    subject: 'ログインできないときの復旧',
    text
  })
}
