// Client notifications. In-app notifications are always created (reliable, no
// config). If CLIENT_WEBHOOK_URL is set, each notification is also POSTed there
// so you can fan out to email/SMS/Slack with your own tool.
import { db } from '../db.js';

export function notifyClient(clientId, { orderId = null, type = 'info', message }) {
  const note = {
    id: db.uid(),
    client_id: clientId,
    order_id: orderId,
    type,
    message,
    read: false,
    created_at: new Date().toISOString(),
  };
  db.run('INSERT INTO notifications (id, client_id, order_id, type, message, read, created_at) VALUES (?,?,?,?,?,?,?)',
    note.id, note.client_id, note.order_id, note.type, note.message, 0, note.created_at);

  const hook = process.env.CLIENT_WEBHOOK_URL;
  if (hook) {
    fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(note),
    }).catch((e) => console.warn('[notify] webhook failed:', e.message));
  }
  return note;
}
