// Client notifications. In-app notifications are always created (reliable, no
// config). If CLIENT_WEBHOOK_URL is set, each notification is also POSTed there
// so you can fan out to email/SMS/Slack with your own tool. Email via SMTP can
// be added later without changing callers.
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
  db.notifications.push(note);
  db.save();

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
