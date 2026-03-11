/**
 * VK API helper — отправка сообщений и построение клавиатур.
 */

const VK_API_BASE = 'https://api.vk.com/method';
const VK_API_VERSION = '5.131';

async function vkApiCall(method, params) {
  const token = process.env.VK_GROUP_TOKEN;
  if (!token) {
    console.error('[vk-api] VK_GROUP_TOKEN не задан');
    return null;
  }

  const url = new URL(`${VK_API_BASE}/${method}`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('v', VK_API_VERSION);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  }

  try {
    const response = await fetch(url.toString(), { method: 'POST' });
    const data = await response.json();
    if (data.error) {
      console.error('[vk-api] Ошибка:', data.error.error_msg);
      return null;
    }
    return data.response;
  } catch (err) {
    console.error('[vk-api] fetch error:', err.message);
    return null;
  }
}

/**
 * Отправить сообщение пользователю ВК.
 * @param {number} userId   — vk user_id
 * @param {string} message  — текст
 * @param {object} keyboard — клавиатура (необязательно)
 */
async function sendVkMessage(userId, message, keyboard) {
  const params = {
    user_id: userId,
    message,
    random_id: Math.floor(Math.random() * 1e9)
  };
  if (keyboard) {
    params.keyboard = JSON.stringify(keyboard);
  }
  return vkApiCall('messages.send', params);
}

/**
 * Построить клавиатуру VK из массива рядов кнопок.
 * @param {Array<Array<object>>} rows — [[btn, btn], [btn], ...]
 * @param {boolean} oneTime           — скрыть после нажатия
 */
function buildKeyboard(rows, oneTime = true) {
  return { one_time: oneTime, inline: false, buttons: rows };
}

/** Пустая клавиатура — убирает текущую у пользователя */
function emptyKeyboard() {
  return { one_time: true, inline: false, buttons: [] };
}

/**
 * Создать кнопку.
 * @param {string} label   — текст кнопки (макс 40 символов)
 * @param {object} payload — данные действия
 * @param {string} color   — primary | secondary | negative | positive
 */
function makeButton(label, payload, color = 'secondary') {
  return {
    action: {
      type: 'text',
      label: String(label).slice(0, 40),
      payload: JSON.stringify(payload)
    },
    color
  };
}

/** Разбить массив на чанки заданного размера */
function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

module.exports = { sendVkMessage, buildKeyboard, emptyKeyboard, makeButton, chunkArray };
