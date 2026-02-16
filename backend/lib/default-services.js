const DEFAULT_SERVICES = [
  // Сахар — комплексы
  { name: 'Сахар: Глубокое бикини + ноги полностью + подмышечные впадины', category: 'Комплексы', method: 'sugar', duration_minutes: 120, price: 2700 },
  { name: 'Сахар: Ноги полностью + бикини классика', category: 'Комплексы', method: 'sugar', duration_minutes: 105, price: 2200 },
  { name: 'Сахар: Глубокое бикини + голень', category: 'Комплексы', method: 'sugar', duration_minutes: 75, price: 1500 },
  { name: 'Сахар: Подмышечные впадины + ноги полностью', category: 'Комплексы', method: 'sugar', duration_minutes: 90, price: 1700 },

  // Сахар — услуги
  { name: 'Сахар: Бёдра', category: 'Услуги', method: 'sugar', duration_minutes: 40, price: 900 },
  { name: 'Сахар: Ноги полностью', category: 'Услуги', method: 'sugar', duration_minutes: 60, price: 1700 },
  { name: 'Сахар: Голень', category: 'Услуги', method: 'sugar', duration_minutes: 35, price: 800 },
  { name: 'Сахар: Руки до локтя', category: 'Услуги', method: 'sugar', duration_minutes: 30, price: 500 },
  { name: 'Сахар: Руки полностью', category: 'Услуги', method: 'sugar', duration_minutes: 45, price: 800 },
  { name: 'Сахар: Глубокое бикини (тотальное)', category: 'Услуги', method: 'sugar', duration_minutes: 45, price: 1500 },
  { name: 'Сахар: Бикини классика', category: 'Услуги', method: 'sugar', duration_minutes: 35, price: 1000 },
  { name: 'Сахар: Подмышечные впадины', category: 'Услуги', method: 'sugar', duration_minutes: 20, price: 500 },
  { name: 'Сахар: Лицо', category: 'Услуги', method: 'sugar', duration_minutes: 20, price: 350 },
  { name: 'Сахар: Живот', category: 'Услуги', method: 'sugar', duration_minutes: 20, price: 400 },
  { name: 'Сахар: Спина (поясница)', category: 'Услуги', method: 'sugar', duration_minutes: 25, price: 600 },

  // Воск — комплексы
  { name: 'Воск: Глубокое бикини + ноги полностью + подмышечные впадины', category: 'Комплексы', method: 'wax', duration_minutes: 120, price: 3000 },
  { name: 'Воск: Ноги полностью + бикини классика', category: 'Комплексы', method: 'wax', duration_minutes: 105, price: 2500 },
  { name: 'Воск: Глубокое бикини + голень', category: 'Комплексы', method: 'wax', duration_minutes: 75, price: 1800 },
  { name: 'Воск: Подмышечные впадины + ноги полностью', category: 'Комплексы', method: 'wax', duration_minutes: 90, price: 1500 },

  // Воск — услуги
  { name: 'Воск: Бёдра', category: 'Услуги', method: 'wax', duration_minutes: 40, price: 1200 },
  { name: 'Воск: Ноги полностью', category: 'Услуги', method: 'wax', duration_minutes: 60, price: 2000 },
  { name: 'Воск: Голень', category: 'Услуги', method: 'wax', duration_minutes: 35, price: 800 },
  { name: 'Воск: Руки до локтя', category: 'Услуги', method: 'wax', duration_minutes: 30, price: 800 },
  { name: 'Воск: Руки полностью', category: 'Услуги', method: 'wax', duration_minutes: 45, price: 1100 },
  { name: 'Воск: Глубокое бикини (тотальное)', category: 'Услуги', method: 'wax', duration_minutes: 45, price: 1800 },
  { name: 'Воск: Бикини классика', category: 'Услуги', method: 'wax', duration_minutes: 35, price: 1300 },
  { name: 'Воск: Подмышечные впадины', category: 'Услуги', method: 'wax', duration_minutes: 20, price: 800 },
  { name: 'Воск: Лицо', category: 'Услуги', method: 'wax', duration_minutes: 20, price: 350 },
  { name: 'Воск: Живот', category: 'Услуги', method: 'wax', duration_minutes: 20, price: 400 },
  { name: 'Воск: Спина (поясница)', category: 'Услуги', method: 'wax', duration_minutes: 25, price: 600 }
];

function toDescription(item) {
  const methodLabel = item.method === 'wax' ? 'Воск' : 'Сахар';
  return `${methodLabel} • ${item.category}`;
}

module.exports = {
  DEFAULT_SERVICES,
  toDescription
};
