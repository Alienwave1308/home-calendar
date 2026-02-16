const { pool } = require('../db');
const { processPendingReminders } = require('./reminders');
const { notifyClientReminder } = require('./telegram-notify');

async function runReminderWorkerTick() {
  const due = await processPendingReminders();
  if (!due.length) return { processed: 0 };

  let processed = 0;
  for (const reminder of due) {
    const sendResult = await notifyClientReminder(reminder);
    if (!sendResult.ok && sendResult.retryable) {
      await pool.query(
        'UPDATE booking_reminders SET sent = false WHERE id = $1',
        [reminder.reminder_id]
      );
    }
    processed += 1;
  }

  return { processed };
}

module.exports = { runReminderWorkerTick };
