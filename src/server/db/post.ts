import { prisma } from '@/lib/prisma'

type Viewer = {
  id: string
  permission: 'admin' | 'user'
}

class PostDB {
  async listForViewer(viewer: Viewer) {
    if (viewer.permission === 'admin') {
      return prisma.post.findMany({
        include: {
          author: { select: { id: true, email: true, name: true } }
        },
        orderBy: { createdAt: 'desc' }
      })
    }

    return prisma.post.findMany({
      where: {
        OR: [{ published: true }, { authorId: viewer.id }]
      },
      include: {
        author: { select: { id: true, email: true, name: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
  }

  async getByIdForViewer(id: string, viewer: Viewer) {
    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, email: true, name: true } }
      }
    })
    if (!post) return null
    if (viewer.permission === 'admin') return post
    if (post.published || post.authorId === viewer.id) return post
    return null
  }

  async create(data: {
    title: string
    content?: string | null
    published: boolean
    authorId: string
  }) {
    return prisma.post.create({
      data: {
        title: data.title,
        content: data.content ?? null,
        published: data.published,
        authorId: data.authorId
      },
      include: {
        author: { select: { id: true, email: true, name: true } }
      }
    })
  }

  async updateOwned(
    id: string,
    authorId: string,
    data: { title?: string; content?: string | null; published?: boolean }
  ) {
    const existing = await prisma.post.findUnique({ where: { id } })
    if (!existing || existing.authorId !== authorId) {
      return null
    }

    return prisma.post.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.published !== undefined && { published: data.published })
      },
      include: {
        author: { select: { id: true, email: true, name: true } }
      }
    })
  }

  async deleteOwned(id: string, authorId: string) {
    const existing = await prisma.post.findUnique({ where: { id } })
    if (!existing || existing.authorId !== authorId) {
      return false
    }
    await prisma.post.delete({ where: { id } })
    return true
  }

  async count() {
    return prisma.post.count()
  }

  async countPublished() {
    return prisma.post.count({ where: { published: true } })
  }
}

export default new PostDB()
