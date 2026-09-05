# InstaPilot — multi-tenant SaaS для автоматизации Instagram

Автопостинг по расписанию, автоответы на комментарии (и позже директ) через Gemini,
панель управления для клиентов. Архитектура multi-tenant: один деплой рассчитан на
много клиентских Instagram Business/Creator-аккаунтов.

> **Сейчас включён режим одного аккаунта** (`shared/config.mjs`): в проекте живёт
> ровно один бренд и один подключённый Instagram — тот, что отвечает на комментарии
> и публикует посты. Схема данных при этом осталась multi-tenant.
> Подробнее — [Режим одного аккаунта](#режим-одного-аккаунта).

> Название InstaPilot — рабочее, меняется поиском по проекту.

## Стек

- **Frontend:** React + Vite, хостинг Netlify
- **Backend:** Netlify Functions (Node.js, serverless)
- **БД / Auth:** Firebase (Firestore + Firebase Auth)
- **AI:** Google Gemini API
- **Instagram:** Instagram Graph API (Meta for Developers)

## Структура проекта

```
.
├── index.html                  # входная точка Vite
├── vite.config.mjs
├── package.json
├── netlify.toml                # сборка, functions, редиректы /api/* и SPA-fallback
├── shared/config.mjs           # общий тумблер SINGLE_ACCOUNT_MODE (панель + функции)
├── firestore.rules             # multi-tenant правила безопасности
├── firebase.json               # для деплоя правил через firebase CLI
├── firestore.indexes.json
├── .env.example                # шаблон переменных окружения
├── src/                        # React-панель
│   ├── main.jsx                # роутер
│   ├── styles.css
│   ├── lib/firebase.js         # инициализация клиентского SDK
│   ├── context/
│   │   ├── AuthContext.jsx     # сессия Firebase Auth
│   │   └── AccountContext.jsx  # текущий бренд-аккаунт (tenant)
│   ├── components/
│   │   ├── Layout.jsx          # сайдбар + шапка
│   │   └── ProtectedRoute.jsx
│   ├── lib/
│   │   ├── firebase.js         # клиентский SDK
│   │   └── api.js              # вызов функций с Firebase ID token
│   └── pages/
│       ├── Login.jsx           # вход / регистрация
│       ├── Dashboard.jsx       # обзор + подключение Instagram
│       ├── Accounts.jsx        # аккаунт(ы): подключение Instagram, статус токена (этап 2)
│       ├── Posts.jsx           # автопостинг (этап 3)
│       ├── Settings.jsx        # настройки бота (этап 4)
│       └── Interactions.jsx    # лог ответов (этап 5)
└── netlify/functions/
    ├── health.mjs              # smoke-тест деплоя функций: GET /api/health
    ├── connect-instagram.mjs   # старт OAuth + отвязка (авторизованный вызов)
    ├── instagram-callback.mjs  # redirect_uri: обмен code -> long-lived token
    ├── refresh-tokens.mjs      # cron: продление токенов (ежедневно 03:00 UTC)
    ├── scheduled-publish.mjs   # cron: публикация постов по расписанию (каждые 5 мин)
    ├── publish-now.mjs         # мгновенная публикация одного поста (авторизованный)
    ├── webhook-instagram.mjs   # приём вебхуков Meta (комментарии + директ) -> очередь
    ├── poll-comments.mjs       # cron (5 мин): читает комментарии через API (обход вебхуков)
    ├── process-comments.mjs    # cron (1 мин): Gemini -> черновик/отправка/пропуск (комментарии)
    ├── process-dm.mjs          # cron (1 мин): то же для директа (этап 6, за тумблером)
    ├── moderate-comment.mjs    # одобрить/отклонить/перегенерировать (авторизованный)
    ├── account-health.mjs      # здоровье аккаунта для дашборда: токен, квота, доступность (этап 7)
    └── _lib/                   # общий код функций:
        ├── http.mjs            #   ответы, ошибки, requireEnv
        ├── firebaseAdmin.mjs   #   Admin SDK (обходит security rules)
        ├── crypto.mjs          #   AES-256-GCM токенов + HMAC-подпись OAuth-state
        ├── auth.mjs            #   verifyIdToken + проверка владения аккаунтом
        ├── instagram.mjs       #   IG Graph API: OAuth, профиль, публикация, комментарии, вебхуки
        ├── tokens.mjs          #   сохранение/чтение зашифрованных токенов
        ├── publisher.mjs       #   очередь публикаций: claim/lease + машина состояний
        ├── gemini.mjs          #   Google Gemini: генерация ответа + решение (skip/escalate)
        ├── comments.mjs        #   обработка комментариев + ручная модерация
        └── poller.mjs          #   чтение комментариев опросом (водяной знак, дедуп)
```

Запланированные функции (по следующим этапам): `process-dm` (этап 6, после App Review).

## Схема Firestore

```
accounts/{accountId}                        — клиент (tenant)
  ownerUid              uid владельца (Firebase Auth)
  brandName             название бренда
  instagramBusinessId   IG user id              (пишет только backend)
  instagramUsername     @username               (пишет только backend)
  igAccountType         BUSINESS | MEDIA_CREATOR | ... (пишет только backend)
  connectionStatus      disconnected | connected | expired | error
  tokenExpiresAt        ms-таймстамп протухания токена (для UI и cron)

  connectedAt, lastConnectionError, createdAt

accounts/{accountId}/private/credentials    — ТОЛЬКО Admin SDK, клиенту закрыто правилами
  ciphertext            long-lived токен, зашифрованный AES-256-GCM (base64)
  iv, authTag           параметры GCM (base64)
  igUserId, scopes
  tokenIssuedAt         для правила «продлевать можно с 24ч»
  tokenExpiresAt        срок жизни (~60 дней) — по нему работает cron-обновление

accounts/{accountId}/settings/bot
  toneOfVoice           стиль общения бренда (свободный текст — идёт в промпт Gemini)
  brandContext          факты о бренде (часы, адрес, FAQ) — чтобы бот не выдумывал
  forbiddenTopics       string[] — запрещённые темы (бот их не комментирует)
  language              язык ответов: auto | ru | en | ...
  useEmojis             bool — разрешить эмодзи
  signature             подпись в конце ответа
  autoReplyComments     bool — автоответы на комментарии
  autoReplyDms          bool — модуль директа (этап 6, после Meta App Review)
  draftMode             bool — ответы сначала в черновики на ручное одобрение
  escalateNegative      bool — негатив не комментировать, помечать вручную

accounts/{accountId}/scheduled_posts/{postId}
  caption, mediaUrl, mediaType (image | video | carousel)
  scheduledAt           когда публиковать
  status                pending | processing | published | failed
  publishedMediaId, error, createdAt, updatedAt

accounts/{accountId}/interactions/{interactionId}   — пишет только backend
  id = igCommentId      (дедуп повторных доставок вебхука)
  type                  comment | dm(этап 6)
  igMediaId, parentCommentId, authorUsername, authorId
  source                poll — прочитано опросом (у вебхука поля нет)
  inboundText           текст входящего комментария
  botReply              ответ, сгенерированный Gemini
  sentReply, igReplyId  что реально отправлено и id ответа
  sentiment             positive | neutral | negative
  aiAction, aiReason    решение модели (reply/skip/escalate) и причина
  status                received | processing | draft | sent | skipped |
                        needs_attention | rejected | failed
  leaseUntil, error, createdAt, processedAt, sentAt
```

Ключевое решение: токены лежат в подколлекции `private`, к которой у клиентского SDK
нет доступа вообще (`allow read, write: if false`) — Netlify Functions ходят туда через
Admin SDK, который обходит правила. Так зашифрованный токен даже не попадает в браузер.

## Режим одного аккаунта

Тумблер лежит в `shared/config.mjs`:

```js
export const SINGLE_ACCOUNT_MODE = true
```

Файл читают обе стороны — панель (через Vite-бандл) и Netlify Functions (esbuild кладёт
его в бандл функции), поэтому правило не разъезжается между фронтом и бэком.

Что делает `true`:

- в сайдбаре вместо переключателя брендов — название единственного бренда (клик ведёт
  на страницу аккаунта);
- страница «Instagram-аккаунт» показывает один профиль: статус, `@username`, тип аккаунта,
  остаток жизни токена, подключение/отвязку;
- кнопка «Создать бренд» видна, только пока бренда нет; повторный `createAccount()`
  отклоняется;
- `POST /api/connect-instagram` отвечает `409 SINGLE_ACCOUNT`, если у владельца уже есть
  другой подключённый профиль. Это страховка на случай прямого вызова API: правила
  Firestore считать документы не умеют, поэтому лимит держит функция.

Чего режим **не** меняет:

- схему Firestore (`accounts/{accountId}/...`) и `firestore.rules` — данные по-прежнему
  лежат под `accountId`, изоляция по `ownerUid` работает как раньше;
- cron-функции: `process-comments` и `scheduled-publish` идут по всем аккаунтам со
  `connectionStatus == 'connected'` — просто такой аккаунт один.

Чтобы единственный аккаунт начал отвечать на комментарии: подключить Instagram →
**Настройки бота** → включить «Автоответы на комментарии». По умолчанию там же включён
режим черновиков (`draftMode`) — ответы копятся в «Логе ответов» и уходят в Instagram
после ручного одобрения; выключите его, когда бот начнёт отвечать так, как нужно.

Вернуть несколько брендов — поставить `false`: переключатель, список аккаунтов и кнопка
«Добавить бренд» вернутся. Миграция данных не нужна.

## Настройка Firebase (один раз)

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
   (Google Analytics можно выключить).
2. **Build → Authentication → Get started → Sign-in method** → включить **Email/Password**.
3. **Build → Firestore Database → Create database** → production mode → выбрать регион
   (например `europe-west1`).
4. **Project settings (шестерёнка) → Your apps → Web (</>)** → зарегистрировать
   приложение → скопировать значения `firebaseConfig`.
5. Скопировать `.env.example` в `.env` и заполнить `VITE_FIREBASE_*` значениями из шага 4.
6. **Firestore → Rules** → вставить содержимое `firestore.rules` → **Publish**.
   Либо через CLI: `npm i -g firebase-tools && firebase login && firebase use <project-id> && firebase deploy --only firestore:rules`.

## Локальный запуск

```bash
npm install
npm run dev        # только фронтенд: http://localhost:5173 (этап 1, без функций)
# для этапа 2+ (нужны функции и серверные env):
npx netlify dev    # фронтенд + functions: http://localhost:8888
```

> Кнопки «Подключить Instagram» работают только под `netlify dev` (порт 8888) —
> в чистом `vite` (5173) serverless-функций нет, и панель честно скажет об этом.

## Настройка этапа 2 — подключение Instagram (OAuth + токены)

Всё уже написано; чтобы заработало, нужны учётки Meta/Firebase в переменных окружения.

**1. Ключи шифрования** — уже сгенерированы в `.env` (`TOKEN_ENCRYPTION_KEY`,
`OAUTH_STATE_SECRET`). На проде задайте свои: `openssl rand -base64 32`.

**2. Firebase service account** (для Admin SDK в функциях):
Console → ⚙ Project settings → **Service accounts** → **Generate new private key** →
скачается JSON. Закодируйте его в base64 и вставьте в `FIREBASE_SERVICE_ACCOUNT`:
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\serviceAccount.json"))
```

**3. Приложение Meta / Instagram** ([developers.facebook.com](https://developers.facebook.com/apps)):
- **Create App** → тип **Business**.
- Добавьте продукт **Instagram** → **Set up** → раздел **API setup with Instagram login**.
- Скопируйте **Instagram App ID** и **Instagram App Secret** → в `.env`
  (`INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`).
- В **Business login settings** → **Valid OAuth Redirect URIs** добавьте адрес,
  ТОЧНО совпадающий с `OAUTH_REDIRECT_URI`:
  - прод: `https://<ваш-сайт>/api/instagram-callback`
  - локально: см. пункт 4 (Instagram требует HTTPS — чистый localhost не примут).
- В разделе разрешений запросите scopes: `instagram_business_basic`,
  `instagram_business_content_publish`, `instagram_business_manage_comments`.
- Добавьте свой Instagram Business/Creator-аккаунт как тестовый
  (**Roles → Instagram testers**) — в Development mode иначе не пустит.

**4. Локальный тест OAuth** (нужен публичный HTTPS):
```bash
npx netlify dev --live      # даёт временный https://<...>.netlify.live URL
```
Возьмите этот HTTPS-адрес, пропишите `<url>/api/instagram-callback` в Valid OAuth
Redirect URIs приложения Meta и в `OAUTH_REDIRECT_URI` + `APP_URL` (`.env`), перезапустите.

**5. Как это работает:**
- «Подключить Instagram» → `connect-instagram` проверяет ваш Firebase-токен и владение
  аккаунтом, выдаёт подписанный `state` и ссылку на `instagram.com/oauth/authorize`.
- После согласия Instagram возвращает браузер на `instagram-callback`: проверка подписи
  `state`, обмен `code` → короткий → **long-lived** токен (~60 дней), запрос профиля,
  **шифрование AES-256-GCM** и запись в `accounts/{id}/private/credentials`.
- Токен виден только backend'у (Admin SDK); клиентские rules закрывают `private/*` полностью.
- `refresh-tokens` (cron, ежедневно 03:00 UTC) продлевает токены, которым осталось
  <15 дней и уже есть 24ч; протухшие помечает `expired` (нужен повторный OAuth).
- Механика рассчитана на несколько брендов у одного пользователя, но сейчас включён
  [режим одного аккаунта](#режим-одного-аккаунта): бренд один, страница **Instagram-аккаунт**
  подключает и отвязывает его единственный Instagram.

**6. Прод-переменные Netlify** (Site configuration → Environment variables): все серверные
из `.env` (`FIREBASE_SERVICE_ACCOUNT`, `TOKEN_ENCRYPTION_KEY`, `OAUTH_STATE_SECRET`,
`INSTAGRAM_APP_ID/SECRET`, `OAUTH_REDIRECT_URI`, `APP_URL`) + клиентские `VITE_FIREBASE_*`.

## Этап 3 — автопостинг

Страница **Автопостинг**: планирование, поиск, фильтры по статусу, создание/редактирование/
удаление, «Опубликовать сейчас» и повтор упавших. Всё живое (Firestore onSnapshot).

- **Композер поста.** Загрузка фото/видео **прямо с устройства** (Firebase Storage) или вставка
  публичной ссылки; подпись со счётчиком (2200) и счётчиком хэштегов; первый комментарий
  (уходит отдельным комментарием после публикации — удобно для хэштегов); стилизованный выбор
  даты/времени; в «Дополнительно» — соавторы (до 3), alt-текст, location_id, а для Reels —
  обложка и «показывать в ленте» (`share_to_feed`). Всё это — реальные параметры Graph API.
- **Загрузка медиа.** Файл кладётся в Firebase Storage (`uploads/{uid}/{accountId}/…`), а
  Instagram забирает его по публичной download-ссылке. **Нужно включить Storage:** Firebase
  Console → **Storage** → Get started, затем опубликовать `storage.rules` (или
  `firebase deploy --only storage`). Первый комментарий требует scope
  `instagram_business_manage_comments`.
- **Как публикуется.** `scheduled-publish` (cron `*/5 * * * *`) находит подключённые аккаунты
  и посты, у которых наступило время: создаёт медиа-контейнер → ждёт обработки (видео дольше) →
  публикует. Не успевшее видео до-публикуется на следующем прогоне. «Опубликовать сейчас»
  (`publish-now`) делает то же немедленно для одного поста.
- **Без дублей.** Пост «арендуется» транзакцией (`status: processing` + `leaseUntil`), так что
  параллельный запуск cron и ручная публикация не опубликуют его дважды.
- **Лимиты Meta.** Уважается суточный лимит публикаций (обычно 25/24ч); при исчерпании посты
  ждут в очереди. Между запросами — задержки (rate-limit throttle из `instagram.mjs`).
- **Статусы:** `pending` (в очереди) → `processing` (публикуется) → `published` (со ссылкой на
  пост) либо `failed` (с текстом ошибки; кнопка вернуть в очередь). Требует scope
  `instagram_business_content_publish` и, для чужих аккаунтов, Advanced Access (App Review).

- **Целостность очереди.** Правила `firestore.rules` для `scheduled_posts` ужесточены: клиент
  может только ставить в очередь (`status: pending`) и править контент, но не подделывать поля
  пайплайна (`publishedMediaId`, `permalink`, `status: published/processing`). **После этапа 3
  переопубликуйте правила** (Firebase Console → Firestore → Rules, вставить `firestore.rules` →
  Publish). Без этого приложение всё равно работает — но без этой защиты целостности.

> Публикацию можно проверить только на подключённом аккаунте под `netlify dev` — как и OAuth,
> это требует реального Instagram и токена.

## Этап 5 — автоответы на комментарии (Gemini)

Поток: комментарий под постом → вебхук Meta → очередь в `interactions` → cron `process-comments`
раз в минуту зовёт Gemini → **черновик** (ждёт одобрения) или **авто-отправка** ответа. Всё видно
на странице **Лог ответов**: правка/одобрение/отклонение/перегенерация черновиков, фильтры, поиск.

- **Gemini.** Модель `gemini-2.5-flash`, structured output: возвращает `{action, reply, sentiment,
  reason}`. Системный промпт собирается из настроек бота (тон, факты о бренде, запрещённые темы,
  язык, эмодзи, подпись). Бот сам **пропускает** спам/запрещённые темы и **эскалирует** негатив
  (плюс страховка в коде). Устойчив к prompt-injection (текст комментария — данные, не команды).
  Ключ — `GEMINI_API_KEY`. ⚠️ **Бесплатный тариф Gemini ≈ 5 запросов/мин** — для продакшена
  подключите платный тариф, иначе часть комментариев уйдёт в «ошибка» (можно перегенерировать).
- **Режим «черновик»** (по умолчанию вкл. в настройках бота) — ответы не уходят сами, вы
  одобряете/правите их вручную. Снизить риск неуместного ответа под именем бренда.
- **Настройка вебхука Meta** (нужен публичный HTTPS, напр. `netlify dev --live` или прод):
  1. `.env`/Netlify: задайте `META_WEBHOOK_VERIFY_TOKEN` (уже сгенерирован в `.env`).
  2. Meta App → **Webhooks** → **Instagram** → Callback URL = `https://<site>/api/webhook-instagram`,
     Verify token = ваш `META_WEBHOOK_VERIFY_TOKEN` → **Verify and Save**.
  3. Подпишитесь на поле **`comments`** (в дашборде; через API поле не подключить).
  4. Подписка конкретного аккаунта на вебхуки делается автоматически при подключении Instagram
     (`subscribed_apps`), поле — из дашборда.
- **Безопасность вебхука.** Каждый POST проверяется по `X-Hub-Signature-256` (HMAC-SHA256 сырого
  тела с App Secret, сравнение постоянного времени). Собственные комментарии аккаунта игнорируются
  (защита от петли), повторные доставки дедуплицируются (id комментария = id документа).
- **Безопасность модерации.** `moderate-comment` требует Firebase ID token и владения аккаунтом;
  взаимодействие ищется строго в подколлекции этого аккаунта (tenant-изоляция). Клиент читает
  `interactions`, но не пишет — публикацией ответа занимается backend (Admin SDK).

> Как и раньше: реальные автоответы проверяются только на подключённом аккаунте с настроенным
> вебхуком. Сам Gemini-пайплайн (тон, факты, skip/escalate, устойчивость к инъекциям) проверен
> локально и работает.

## Комментарии без вебхуков (опрос)

Meta **не доставляет вебхуки о комментариях посторонних людей**, пока у приложения
Standard Access. Это установлено опытом 5 сентября 2026: комментарий с самого аккаунта
доходит до `webhook-instagram` за секунды, комментарии с чужих аккаунтов не вызывают
функцию ни разу — без ошибок и без оповещений. Advanced Access выдаётся только через
App Review, а тот требует подтверждения компании.

Зато **чтение комментариев тем же токеном работает**: `GET /{ig-id}/media` и
`GET /{media-id}/comments` отвечают нормально. Поэтому есть обходной путь:

```
poll-comments (cron, каждые 5 мин)
  -> последние N публикаций аккаунта
  -> комментарии к каждой
  -> новые кладутся в interactions со status 'received'
  -> дальше как обычно: process-comments -> Gemini -> черновик/отправка
```

- **Порядок.** Instagram отдаёт комментарии только от старых к новым и игнорирует
  `order=reverse_chronological` (проверено: выборка из 25 давала комментарии с февраля
  по август). Свежие достаются пролистыванием до конца ленты, курсор `after` хранится
  в `accounts/{id}/poll_state/{mediaId}`.
- **Флаг `bootstrapped`.** Пока публикация не дочитана до конца хотя бы раз, её
  комментарии НЕ ставятся в очередь; флаг взводится при достижении последней страницы,
  а не при первом запуске. Разница принципиальна: проход по десяти постам с сотнями
  комментариев не укладывается в лимит времени функции, и если считать пост известным
  со второго прогона, остаток истории уедет в очередь как новые комментарии — так и
  случилось 5 сентября, 141 старый комментарий попал в обработку.
- **Дедуп общий с вебхуком:** id документа = id комментария, `.create()` падает на
  повторе. Поэтому опрос и вебхуки безопасно работают одновременно, и если после
  App Review события всё-таки пойдут, дублей не будет.
- **Защита от петли** здесь сравнивает ник автора с `instagramUsername` аккаунта:
  эндпоинт комментариев не отдаёт id автора.
- **Ограничения.** Задержка до 5 минут вместо секунд; читаются только последние
  `POLL_MEDIA_LIMIT` публикаций (по умолчанию 5) и `POLL_COMMENTS_LIMIT` комментариев
  к каждой (25); ответы на комментарии (вложенные) пока не читаются.
- На дашборде доступность видна бейджем «комментарии читаются: N» — его отдаёт
  `account-health`, спрашивая Meta напрямую.

## Этап 6 — автоответы в директ (отключаемый модуль)

Тот же движок, что и для комментариев, но для личных сообщений. Директ **выключен по умолчанию**
и включается после Meta App Review — код готов и ждёт разрешений.

- **Приём.** `webhook-instagram` обрабатывает и `messaging` (формат Messenger Platform): пропускает
  эхо собственных сообщений (`is_echo`) и сообщения без `mid`, дедуп по `mid`, защита от петли.
- **Ответ.** Общий обработчик (`comments.mjs`) по типу выбирает канал: комментарий → публичный
  ответ, директ → Send API (`POST /{ig-id}/messages`, 24-часовое окно соблюдается автоматически).
  `process-dm` (cron) генерирует ответы, если у бренда включён тумблер **«Автоответы в директ»**.
- **Как включить:** (1) пройдите App Review на `instagram_business_manage_messages`;
  (2) добавьте scope в `INSTAGRAM_SCOPES` и переподключите аккаунт; (3) задайте
  `INSTAGRAM_WEBHOOK_FIELDS=comments,messages` и подпишитесь на поле `messages` в дашборде Meta;
  (4) включите тумблер в «Настройках бота». В «Логе ответов» директ отображается отдельным
  фильтром канала.

## Этап 7 — продакшен-готовность

- **Живой дашборд.** Реальные метрики бренда (посты в очереди/опубликовано, ответы/черновики),
  статус подключения и срок токена, подписчики/публикации, суточная квота публикаций Meta
  (через `account-health`), и **health-алерты**: токен истёк/истекает, посты с ошибкой, обращения,
  требующие внимания — со ссылками на нужный раздел.
- **Ретраи и устойчивость (уже встроено по этапам):** экспоненциальный backoff и уважение
  rate-limit у Instagram (`igFetch`) и Gemini (429/503); авто-refresh токенов (cron, ~за 15 дней);
  идемпотентная публикация постов и отправка ответов (claim/lease + транзакции против дублей);
  лимит попыток для «зависшего» медиа; дедлайн-бюджет у всех cron под лимит Netlify 30с; падения
  помечаются статусом с текстом ошибки и кнопкой повтора.

### Чек-лист перед продом

- [ ] Firebase: Auth (Email/Password), Firestore + **опубликованы** `firestore.rules`, Storage +
      `storage.rules`, сервис-аккаунт в `FIREBASE_SERVICE_ACCOUNT`.
- [ ] Netlify env: все серверные переменные (`FIREBASE_SERVICE_ACCOUNT`, `TOKEN_ENCRYPTION_KEY`,
      `OAUTH_STATE_SECRET`, `INSTAGRAM_APP_ID/SECRET`, `OAUTH_REDIRECT_URI`, `APP_URL`,
      `META_WEBHOOK_VERIFY_TOKEN`, `GEMINI_API_KEY`) + клиентские `VITE_FIREBASE_*`.
- [ ] Свои секреты на проде (перегенерировать ключи, не использовать засветившиеся в чате).
- [ ] **Gemini** — платный тариф (бесплатный ≈ 5 req/мин не потянет поток).
- [ ] Redirect URI и Callback вебхука указывают на прод-домен (HTTPS).
- [ ] Проверить `GET /api/health` и вход в панель после деплоя.

### Чек-лист Meta App Review

- [ ] Business-верификация компании в Meta.
- [ ] Запрос Advanced Access на разрешения: `instagram_business_basic`,
      `instagram_business_content_publish`, `instagram_business_manage_comments`
      (и `instagram_business_manage_messages` — для директа).
- [ ] Скринкасты сценариев (подключение, публикация, ответ на комментарий/директ) —
      Meta требует видео потока для каждого разрешения.
- [ ] Заполнить Data Deletion / Deauthorize callback и политику конфиденциальности.
- [ ] До ревью тестировать на своих аккаунтах, добавленных как Instagram testers (Development mode).

## Деплой на Netlify

1. Запушить репозиторий на GitHub.
2. Netlify → **Add new site → Import an existing project**. Build-настройки подтянутся
   из `netlify.toml`.
3. **Site configuration → Environment variables** → добавить все `VITE_FIREBASE_*`
   (серверные переменные добавятся на этапе 2).
4. Проверка: открыть сайт (логин должен работать) и `https://<site>/api/health` →
   `{"ok":true,...}`.

## План этапов

- [x] **Этап 1.** Фундамент: скелет Vite+React, Firebase Auth (логин/регистрация),
      схема Firestore + security rules, netlify.toml, health-функция.
- [x] **Этап 2.** Подключение Instagram: OAuth (`connect-instagram` + `instagram-callback`),
      обмен на long-lived token, AES-256-GCM шифрование, cron-обновление (`refresh-tokens`),
      страница «Аккаунты» с мульти-подключением и scoping по брендам.
- [x] **Этап 3.** Автопостинг: CRUD/поиск/фильтры/редактирование в панели,
      `scheduled-publish` (cron, каждые 5 мин) + `publish-now`, машина состояний
      контейнера (create → poll → publish), lease против двойной публикации, уважение
      суточного лимита Meta, живые статусы (pending/processing/published/failed).
- [x] **Этап 4.** Настройки бота: тон общения, факты о бренде, запрещённые темы (теги),
      язык/эмодзи/подпись, тумблеры автоответов (комментарии/директ), режим «черновик»,
      эскалация негатива. Живое сохранение в `settings/bot` с dirty-детектом.
- [x] **Этап 5.** Комментарии: `webhook-instagram` (verify-token + подпись X-Hub-Signature-256 +
      защита от петли + дедуп), `process-comments` (cron, Gemini structured output с учётом тона/
      фактов/запрещённых тем/языка/эмодзи/подписи, skip/escalate/draft/send), `moderate-comment`
      (одобрить/отклонить/перегенерировать), живой лог с ручным одобрением и правкой черновиков.
- [x] **Этап 6.** Директ: `webhook-instagram` принимает и `messages` (формат Messenger),
      `process-dm` (cron) и общий обработчик отвечают в директ через Send API; отключаемый
      модуль за тумблером `autoReplyDms` — включается после Meta App Review.
- [x] **Этап 7.** Продакшен-готовность: живой дашборд (реальные метрики + health-алерты),
      `account-health` (токен/квота/доступность IG), ретраи и backoff, чек-листы ниже.

## Ограничения Meta, о которых важно помнить

- **App Review нужен не только для директа.** В Development mode приложение Meta
  работает только с аккаунтами, у которых есть роль в приложении
  (админ/разработчик/тестировщик). Для произвольных клиентов почти все разрешения
  (`instagram_content_publish`, `instagram_manage_comments`, messaging) требуют
  Advanced Access через App Review. Стратегия: разрабатываем и тестируем на
  своих/тестовых аккаунтах, ревью на постинг и комментарии подаём когда модули готовы,
  директ — отдельным ревью позже (поэтому он и вынесен в отключаемый модуль).
- Long-lived токены живут ~60 дней → обновление по cron (этап 2).
- Rate limits Graph API → все публикации и ответы идут через очередь с задержками,
  а не пачкой (этап 3+).

## Примечания

- Проект лежит в папке OneDrive — `node_modules` будет синхронизироваться и заметно
  тормозить установку и сборку. Рекомендую перенести проект из OneDrive
  (например в `C:\dev\instapilot`) или исключить папку из синхронизации.
- Репозиторий ещё не инициализирован: `git init` перед первым пушем на GitHub.
