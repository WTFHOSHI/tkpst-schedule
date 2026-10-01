# Сервер посещаемости

Netlify Functions + Blobs для вкладки «Посещаемость» в админ-панели (`web/admin/att.js`).
Проект Netlify: `tkpst-poseshchaemost`, Base directory — `attendance-api`.

Переменные окружения (Netlify → Project configuration → Environment variables):
`ATT_PASSWORD_ADMIN`, `ATT_PASSWORD_KURATOR`, `ATT_PASSWORD_STAROSTA`, `ATT_SECRET`.
После их изменения нужен новый деплой (Deploys → Trigger deploy).

Тесты: `node --test test/*.test.mjs`
