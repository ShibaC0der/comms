# Comms

Минимальный браузерный голосовой чат. Разрабатываем по этапам, чтобы как можно раньше проверить качество WebRTC-аудио.

## Структура

- `backend/` — Kotlin + Ktor, пока только `GET /health`.
- `frontend/` — React + TypeScript + Vite, пока стартовая страница.
- `docs/superpowers/` — согласованные спецификация и план.

## Требования

- JDK **25**.
- Node.js **22.12+** и npm.
- Gradle Wrapper **9.7.1** (см. замечание ниже).

## Локальный запуск

Терминал 1, backend:

```bash
cd backend
./gradlew test
./gradlew run
```

Проверка API: `curl http://127.0.0.1:8080/health` — должен вернуть `OK`.

Терминал 2, frontend:

```bash
cd frontend
npm install
npm run dev
```

Открыть `http://localhost:5173`. Проверить сборку: `npm run build`.

Для будущего `/ws` настроен dev proxy Vite → `ws://127.0.0.1:8080` с поддержкой WebSocket upgrade. Сам маршрут появится в шаге 2.

## Статус шага 1

Исходники и конфигурации созданы. **Сборки в рабочем окружении генерации не проверены**: там JDK 21 вместо JDK 25, Gradle не установлен и отсутствует доступ к npm/Maven/Gradle registry.

**Важное ограничение:** `backend/gradle/wrapper/gradle-wrapper.jar` не удалось получить из-за отсутствия сетевого доступа; стандартные скрипты `gradlew` и `gradlew.bat` также пока не сгенерированы. Для завершения первого шага нужно один раз установить Gradle локально и запустить из `backend/`:

```bash
gradle wrapper --gradle-version 9.7.1
./gradlew test
```

После этого следует закоммитить `gradlew`, `gradlew.bat` и `gradle/wrapper/gradle-wrapper.jar`; файл `gradle-wrapper.properties` уже подготовлен. В `frontend/` после `npm install` следует закоммитить `package-lock.json`, чтобы зафиксировать граф зависимостей.

До успешной сборки и проверки `/health` **не переходим к шагу 2**.
