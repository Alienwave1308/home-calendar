# PSP docs package (CAS)

## Что сделано
- Собрана официальная документация по shortlist: dLocal, EBANX, PayRetailers, Kushki, Pagsmile, Nuvei, Paysafe, Unlimit.
- Нормализованы поля для сравнения: auth, webhooks, retry, sandbox, payin/payout, status page.
- Сформирован машиночитаемый манифест: `docs/research/psp_docs_manifest_2026-03-24.json`.

## Что важно перед анализом
- `Kushki`: документация сильно country-specific, оценивать по GEO (CL/CO/EC/MX/PE) отдельно.
- `Nuvei`: параллельно существуют разные поколения API/гайдов; нужно зафиксировать целевую версию.
- `Unlimit`: найденные CardPay-материалы выглядят legacy; обязательно подтверждение текущего API у вендора.
- `Paysafe`: поведение callback/webhook зависит от метода оплаты (card vs redirect/APM).

## Быстрый next step для сравнения
1. Зафиксировать целевые GEO для CAS (например: BR, MX, CO, CL, PE).
2. По каждому PSP заполнить матрицу 0-5 по 7 критериям из JSON.
3. Прозвонить 3 приоритетных вендора (dLocal, EBANX, PayRetailers) и подтвердить SLA + onboarding сроки + тарифную модель.
4. Поднять минимальный sandbox POC на 1 payin + 1 payout + webhook verify.

## Файлы
- `docs/research/psp_docs_manifest_2026-03-24.json`
- `docs/research/psp_docs_brief_2026-03-24.md`
