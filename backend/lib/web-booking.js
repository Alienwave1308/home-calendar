'use strict';

const { pool } = require('../db');

const WEB_BOOKING_MIGRATION = '033_web_booking_confirmation.sql';
const SCHEMA_CACHE_TTL_MS = 30000;

let schemaCache = null;
let schemaCacheAt = 0;

function isTestEnv() {
  return process.env.NODE_ENV === 'test';
}

function isWebBookingEnabled() {
  const raw = String(process.env.WEB_BOOKING_ENABLED || '').trim();
  if (!raw) return isTestEnv();
  return raw.toLowerCase() === 'true';
}

function normalizeSlug(slug) {
  return String(slug || '').trim().toLowerCase();
}

function getAllowedWebBookingSlugs() {
  const raw = String(process.env.WEB_BOOKING_ALLOWED_SLUGS || '').trim();
  if (!raw) return [];
  return raw.split(',').map(normalizeSlug).filter(Boolean);
}

function isWebBookingAllowedForSlug(slug) {
  const allowed = getAllowedWebBookingSlugs();
  if (!allowed.length) return true;
  return allowed.includes(normalizeSlug(slug));
}

function getTelegramBotUsername() {
  const value = String(process.env.TELEGRAM_BOT_USERNAME || '').trim();
  return value || 'Rova_Epil_Bot';
}

function getVkGroupId() {
  return String(process.env.VK_GROUP_ID || '').trim();
}

function getVkAppId() {
  return String(process.env.VK_APP_ID || '').trim();
}

function getWebBookingPublicConfig(slug) {
  return {
    enabled: isWebBookingEnabled() && isWebBookingAllowedForSlug(slug),
    telegramBotUsername: getTelegramBotUsername(),
    vkGroupId: getVkGroupId(),
    vkAppId: getVkAppId()
  };
}

async function isWebBookingSchemaReady() {
  if (isTestEnv()) return true;

  const now = Date.now();
  if (schemaCache !== null && (now - schemaCacheAt) < SCHEMA_CACHE_TTL_MS) {
    return schemaCache;
  }

  try {
    const { rows } = await pool.query(
      'SELECT 1 FROM migrations WHERE name = $1 LIMIT 1',
      [WEB_BOOKING_MIGRATION]
    );
    schemaCache = rows.length > 0;
    schemaCacheAt = now;
    return schemaCache;
  } catch (error) {
    console.error('[web-booking] schema readiness check failed:', error);
    schemaCache = false;
    schemaCacheAt = now;
    return false;
  }
}

function unavailable(reason) {
  return { ok: false, status: 503, reason, error: 'Web booking is temporarily unavailable' };
}

async function getWebBookingAvailability(slug) {
  if (!isWebBookingEnabled()) return unavailable('web_booking_disabled');
  if (!isWebBookingAllowedForSlug(slug)) return unavailable('web_booking_slug_not_enabled');
  const schemaReady = await isWebBookingSchemaReady();
  if (!schemaReady) return unavailable('web_booking_schema_not_ready');
  return { ok: true };
}

module.exports = {
  getTelegramBotUsername,
  getVkGroupId,
  getWebBookingAvailability,
  getWebBookingPublicConfig,
  isWebBookingAllowedForSlug,
  isWebBookingEnabled,
  isWebBookingSchemaReady
};
