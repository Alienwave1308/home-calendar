/**
 * Хранилище сессий VK-бота (in-memory).
 * Каждая сессия привязана к vk_user_id и живёт 30 минут без активности.
 *
 * Структура сессии:
 * {
 *   state: 'IDLE' | 'SELECTING_SERVICE' | 'SELECTING_DATE' | 'SELECTING_SLOT' | 'CONFIRMING',
 *   dbUserId: number,       — id в таблице users
 *   masterId: number,
 *   masterTimezone: string,
 *   serviceId: number,
 *   serviceName: string,
 *   serviceDuration: number,
 *   servicePrice: number,
 *   date: string,           — 'YYYY-MM-DD'
 *   startAt: string,        — ISO UTC
 *   endAt: string,          — ISO UTC
 *   comment: string|null,
 * }
 */

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 минут

const store = new Map();

function getSession(vkUserId) {
  const key = String(vkUserId);
  const entry = store.get(key);
  if (!entry) return { state: 'IDLE' };
  if (Date.now() - entry.updatedAt > SESSION_TTL_MS) {
    store.delete(key);
    return { state: 'IDLE' };
  }
  return entry.data;
}

function setSession(vkUserId, data) {
  store.set(String(vkUserId), { data, updatedAt: Date.now() });
}

function clearSession(vkUserId) {
  store.delete(String(vkUserId));
}

// Periodic cleanup of expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.updatedAt > SESSION_TTL_MS) store.delete(key);
  }
}, 5 * 60 * 1000).unref();

module.exports = { getSession, setSession, clearSession };
