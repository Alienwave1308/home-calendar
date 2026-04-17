'use strict';

const request = require('supertest');
const app = require('../server');

describe('VK OAuth routes', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.VK_APP_ID = '54478943';
    process.env.VK_APP_SECRET = 'test-secret';
    process.env.APP_DOMAIN = 'rova-epil.ru';
  });

  afterEach(() => {
    Object.keys(process.env).forEach((k) => {
      if (!(k in origEnv)) delete process.env[k];
    });
    Object.assign(process.env, origEnv);
  });

  describe('GET /api/auth/vk/oauth', () => {
    it('redirects to VK OAuth with correct params', async () => {
      const res = await request(app)
        .get('/api/auth/vk/oauth?slug=lera')
        .expect(302);

      const location = res.headers.location;
      expect(location).toMatch(/oauth\.vk\.com\/authorize/);
      expect(location).toMatch(/client_id=54478943/);
      expect(location).toMatch(/response_type=code/);
      expect(location).toMatch(/rova-epil\.ru/);
    });

    it('returns 503 if VK_APP_ID not set', async () => {
      delete process.env.VK_APP_ID;
      const res = await request(app)
        .get('/api/auth/vk/oauth')
        .expect(503);
      expect(res.text).toMatch(/не настроен/i);
    });
  });

  describe('GET /api/auth/vk/callback', () => {
    it('redirects to /book/lera with vk_auth_error on error param', async () => {
      const res = await request(app)
        .get('/api/auth/vk/callback?error=access_denied&state=')
        .expect(302);
      expect(res.headers.location).toMatch(/vk_auth_error=1/);
    });

    it('redirects to /book/lera with vk_auth_error when no code', async () => {
      const res = await request(app)
        .get('/api/auth/vk/callback')
        .expect(302);
      expect(res.headers.location).toMatch(/vk_auth_error=1/);
    });
  });
});
