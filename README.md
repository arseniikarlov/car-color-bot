# Car Color Bot

Telegram-бот, который:

- ведет пользователя через сценарий в дружелюбном “карточном” формате сообщений;
- показывает пользователю каталог цветов с кнопками и поиском;
- показывает картинку страницы каталога для выбранного цвета;
- принимает фото автомобиля;
- показывает индикатор прогресса, пока генерируется превью;
- валидирует фото через `gpt-4o`;
- генерирует превью перекраски через `gpt-image-1` с учётом реального оттенка свотча из каталога (`HEX/RGB`, если удалось извлечь);
- хранит состояние диалога в `SQLite`;
- импортирует PDF-каталог в `data/catalog.json` через CLI.
  - страницы каталога сохраняются в `data/catalog_pages/` и используются ботом как визуальный превью-источник.

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
IMAGE_PROVIDER=openai
CATALOG_PATH=./data/catalog.json
SQLITE_PATH=./data/bot.sqlite
OPENAI_VISION_MODEL=gpt-4o
OPENAI_IMAGE_MODEL=gpt-image-1
GEMINI_API_KEY=...
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
GEMINI_API_BASE=https://generativelanguage.googleapis.com/v1beta
REPLICATE_API_TOKEN=...
REPLICATE_IMAGE_MODEL=black-forest-labs/flux-kontext-pro
REPLICATE_API_BASE=https://api.replicate.com/v1
MAX_INPUT_IMAGE_MB=10
OPENAI_TIMEOUT_SEC=90
```

Для переключения генерации превью на Gemini:

```bash
IMAGE_PROVIDER=gemini
GEMINI_API_KEY=...
```

В этом режиме в боте остается текущая OpenAI-проверка входного фото, а генерация превью уходит в Gemini image editing.

Для переключения генерации превью на Replicate:

```bash
IMAGE_PROVIDER=replicate
REPLICATE_API_TOKEN=...
# опционально: можно указать другую image-edit модель Replicate
REPLICATE_IMAGE_MODEL=black-forest-labs/flux-kontext-pro
```

В этом режиме:
- OpenAI остается для валидации входного фото и vision-задач импорта;
- генерация превью выполняется через модель Replicate.

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
При наличии изображений страниц импортёр также обогащает элементы каталога цветом свотча (HEX/RGB), чтобы превью точнее совпадало с образцом.

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
