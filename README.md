# Car Color Bot

Telegram-бот, который:

- показывает пользователю каталог цветов с кнопками и поиском;
- принимает фото автомобиля;
- валидирует фото через `gpt-4o`;
- генерирует превью перекраски через `gpt-image-1`;
- хранит состояние диалога в `SQLite`;
- импортирует PDF-каталог в `data/catalog.json` через CLI.

## Структура

- `src/bot` — Telegram flow, команды и клавиатуры
- `src/catalog` — импорт PDF, парсинг текста, поиск по каталогу
- `src/openai` — OpenAI vision/image edit интеграция
- `src/state` — SQLite store и state machine

## Переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

```bash
TELEGRAM_BOT_TOKEN=...
OPENAI_API_KEY=...
CATALOG_PATH=./data/catalog.json
SQLITE_PATH=./data/bot.sqlite
OPENAI_VISION_MODEL=gpt-4o
OPENAI_IMAGE_MODEL=gpt-image-1
MAX_INPUT_IMAGE_MB=10
OPENAI_TIMEOUT_SEC=90
```

## Локальный запуск

Нужны:

- Node.js 22+
- `pdftoppm` из `poppler-utils` для импорта PDF

Установка и старт:

```bash
npm install
npm run build
npm start
```

Dev-режим:

```bash
npm run dev
```

## Импорт PDF-каталога

Импортирует PDF в структурированный JSON:

```bash
npm run import-catalog -- /absolute/path/to/colors.pdf
```

Если текст из PDF извлекается плохо, импортёр использует vision fallback через OpenAI, если задан `OPENAI_API_KEY`.

## Команды бота

- `/start`
- `/catalog`
- `/search`
- `/reset`

## Docker

Если на хосте нет Node.js или `pdftoppm`, можно использовать контейнер:

```bash
docker build -t car-color-bot .
docker run --rm --env-file .env -v "$(pwd)/data:/app/data" car-color-bot
```

Для импорта PDF через Docker:

```bash
docker run --rm --env-file .env -v "$(pwd):/app" -w /app car-color-bot npm run import-catalog -- /app/colors.pdf
```

## Тесты

```bash
npm test
```

Покрыты:

- парсинг и поиск по каталогу;
- state machine;
- импорт с vision fallback;
- bot handlers с моками Telegram/OpenAI.
