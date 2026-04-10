# Car Color Bot

Telegram-бот, который:

- ведет пользователя через сценарий в дружелюбном “карточном” формате сообщений;
- принимает код цвета от пользователя (из имени файла в JPG-каталоге);
- показывает картинку выбранного цвета из каталога;
- принимает фото автомобиля;
- показывает индикатор прогресса, пока генерируется превью;
- валидирует фото локально (без внешнего AI на этом шаге);
- генерирует превью перекраски только через Replicate с учётом реального оттенка свотча из каталога (`HEX/RGB`, если удалось извлечь);
- хранит состояние диалога в `SQLite`;
- импортирует каталог через CLI (PDF или директория с JPG/PNG/WebP) в `data/catalog.json`.
  - файлы каталога сохраняются в `data/catalog_pages/` и используются ботом как визуальный превью-источник.

## Структура

- `src/bot` — Telegram flow, команды и клавиатуры
- `src/catalog` — импорт каталога (PDF/изображения), поиск по каталогу
- `src/ai` — Replicate интеграция
- `src/state` — SQLite store и state machine

## Переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

```bash
TELEGRAM_BOT_TOKEN=...
CATALOG_PATH=./data/catalog.json
SQLITE_PATH=./data/bot.sqlite
REPLICATE_API_TOKEN=...
REPLICATE_IMAGE_MODEL=black-forest-labs/flux-kontext-pro
REPLICATE_API_BASE=https://api.replicate.com/v1
MAX_INPUT_IMAGE_MB=10
AI_TIMEOUT_SEC=90
```

Бот работает только через Replicate.  
`REPLICATE_IMAGE_MODEL` можно поменять на другую совместимую image-edit модель.

Пользовательский путь:
1. Пользователь вводит код цвета (например `7041` или `8237M`).
2. Бот подтверждает выбранный цвет и просит фото машины.
3. Пользователь отправляет фото машины.
4. Бот возвращает превью перекраски.

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

## Импорт каталога

CLI принимает либо PDF-файл, либо директорию с изображениями (`.jpg/.jpeg/.png/.webp`).

Импорт PDF:

```bash
npm run import-catalog -- /absolute/path/to/colors.pdf
```

Импорт директории JPG:

```bash
npm run import-catalog -- /absolute/path/to/JPG
```

Для JPG-каталога код цвета и название берутся из имени файла.

В режиме Replicate-only vision fallback для PDF не используется: если PDF сканированный и плохо читается как текст, лучше импортировать каталог из директории изображений.

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

Для импорта JPG-директории через Docker:

```bash
docker run --rm --env-file .env -v "$(pwd):/app" -w /app car-color-bot npm run import-catalog -- /app/JPG
```

## Тесты

```bash
npm test
```

Покрыты:

- парсинг и поиск по каталогу;
- state machine;
- импорт каталога;
- bot handlers с моками Telegram/AI.
