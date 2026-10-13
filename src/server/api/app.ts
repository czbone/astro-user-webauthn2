import { Hono } from 'hono'
import auth from '@/server/api/routes/auth'
import admin from '@/server/api/routes/admin'
import devices from '@/server/api/routes/devices'
import { requireAuthOrigin } from '@/server/middleware/auth'

const app = new Hono()

app.use('*', requireAuthOrigin)
app.route('/auth', auth)
app.route('/admin', admin)
app.route('/devices', devices)

export default app
