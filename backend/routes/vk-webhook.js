/**
 * VK Callback API webhook.
 *
 * POST /api/vk/webhook
 *
 * VK отправляет сюда события сообщества.
 * При подтверждении адреса возвращаем VK_CONFIRMATION_STRING.
 * При входящем сообщении — передаём в handleVkMessage.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { handleVkMessage } = require('../lib/vk-bot-handler');

router.post('/webhook', async (req, res) => {
  const body = req.body;

  // Проверяем секретный ключ
  const secret = process.env.VK_SECRET;
  if (secret && body.secret !== secret) {
    return res.status(403).send('forbidden');
  }

  // Подтверждение адреса сервера
  if (body.type === 'confirmation') {
    const confirmString = process.env.VK_CONFIRMATION_STRING;
    if (!confirmString) {
      console.error('[vk-webhook] VK_CONFIRMATION_STRING не задан');
      return res.status(500).send('error');
    }
    return res.status(200).send(confirmString);
  }

  // Все события отвечаем 'ok' как можно быстрее
  res.status(200).send('ok');

  // Обрабатываем входящее сообщение
  if (body.type === 'message_new') {
    const msg = body.object && body.object.message;
    if (!msg || !msg.from_id || msg.from_id < 0) return; // игнорируем групповые чаты

    // Пытаемся получить имя из client_info (если VK его прислал)
    // или делаем отдельный запрос к VK Users API
    let info = {};
    try {
      const token = process.env.VK_GROUP_TOKEN;
      if (token && msg.from_id > 0) {
        const url = `https://api.vk.com/method/users.get?user_ids=${msg.from_id}&fields=first_name,last_name&access_token=${token}&v=5.131`;
        const vkRes = await fetch(url);
        const vkData = await vkRes.json();
        if (vkData.response && vkData.response[0]) {
          info = vkData.response[0];
        }
      }
    } catch (e) {
      console.error('[vk-webhook] users.get error:', e.message);
    }

    try {
      await handleVkMessage(msg, info);
    } catch (err) {
      console.error('[vk-webhook] handleVkMessage error:', err);
    }
  }
});

module.exports = router;
