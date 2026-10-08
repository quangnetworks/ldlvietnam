import { Hono } from 'hono';
import { badRequest, jsonBody } from '../util.js';
import { vapidPublicKey, saveSubscription, removeSubscription, listSubscriptions, hasSubscription, pushToUsers } from '../push.js';

const r = new Hono();

/** Khoá công khai VAPID để trình duyệt đăng ký nhận đẩy. */
r.get('/push/key', async (c) => c.json({ key: await vapidPublicKey(c.env) }));

/** Trạng thái đăng ký của thiết bị hiện tại + danh sách thiết bị của tôi. */
r.post('/push/status', async (c) => {
  const b = await jsonBody(c);
  const user = c.get('user');
  return c.json({ subscribed: b.endpoint ? await hasSubscription(user, String(b.endpoint)) : false, devices: await listSubscriptions(user) });
});

r.post('/push/subscribe', async (c) => {
  const ok = await saveSubscription(c.get('user'), await jsonBody(c), c.req.header('user-agent'));
  if (!ok) throw badRequest('Đăng ký thông báo đẩy không hợp lệ');
  return c.json({ ok: true });
});

r.post('/push/unsubscribe', async (c) => {
  const b = await jsonBody(c);
  if (b.endpoint) await removeSubscription(c.get('user'), String(b.endpoint));
  return c.json({ ok: true });
});

/** Gửi thử một thông báo tới mọi thiết bị của tôi. */
r.post('/push/test', async (c) => {
  const user = c.get('user');
  const devices = await listSubscriptions(user);
  if (!devices.length) throw badRequest('Thiết bị này chưa bật thông báo đẩy');
  await pushToUsers([user.id], { title: 'LDL Việt Nam', body: `Xin chào ${user.name}! Thông báo đẩy đã hoạt động 🎉`, link: '/account/notifications', tag: 'push-test' });
  return c.json({ ok: true, devices: devices.length });
});

export default r;
