import { prisma } from '@/lib/prisma'

class UserDB {
  async findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  }

  async findById(id: string) {
    return prisma.user.findUnique({ where: { id } })
  }

  async countCredentials(userId: string) {
    return prisma.webAuthnCredential.count({ where: { userId } })
  }

  async create(data: { email: string; password: string; name: string; role: string }) {
    return prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        password: data.password,
        name: data.name,
        role: data.role
      }
    })
  }

  async updatePassword(userId: string, passwordHash: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { password: passwordHash }
    })
  }

  async list() {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { credentials: true, posts: true } }
      }
    })

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      credentialCount: user._count.credentials,
      postCount: user._count.posts
    }))
  }

  async count() {
    return prisma.user.count()
  }

  async countAdmins() {
    return prisma.user.count({ where: { role: 'admin' } })
  }
}

export default new UserDB()
