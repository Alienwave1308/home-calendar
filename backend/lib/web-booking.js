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
  const raw = process.env.WEB_BOOKING_ENABLED;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return isTestEnv();
  }
  return String(raw).trim().toLowerCase() === 'true';
}

function getTelegramBotUsername() {
  const value = String(process.env.TELEGRAM_BOT_USERNAME || '').trim();
  return value || 'Rova_Epil_Bot';
}

function getVkGroupId() {
  return String(process.env.VK_GROUP_ID || '').trim();
}

function getWebBookingPublicConfig() {
  return {
    enabled: isWebBookingEnabled(),
    telegramBotUsername: getTelegramBotUsername(),
    vkGroupId: getVkGroupId()
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

async function getWebBookingAvailability() {
  if (!isWebBookingEnabled()) {
    return {
      ok: false,
      status: 503,
      reason: 'web_booking_disabled',
      error: 'Web booking is temporarily unavailable'
    };
  }

  const schemaReady = await isWebBookingSchemaReady();
  if (!schemaReady) {
    return {
      ok: false,
      status: 503,
      reason: 'web_booking_schema_not_ready',
      error: 'Web booking is temporarily unavailable'
    };
  }

  return { ok: true };
}

module.exports = {
  getTelegramBotUsername,
  getVkGroupId,
  getWebBookingAvailability,
  getWebBookingPublicConfig,
  isWebBookingEnabled,
  isWebBookingSchemaReady
};
