# Comms

Браузерный голосовой чат для друзей. Аудио передаётся через WebRTC; сервер на Kotlin отвечает за сигналинг и управление комнатами.

## Структура проекта

- `backend/` — Kotlin + Ktor.
- `frontend/` — React + TypeScript + Vite.
- `docs/superpowers/specs/` — дизайн-спецификации.
- `docs/superpowers/plans/` — планы реализации.

## Требования для разработки

- JDK 25.
- Node.js 22.12+ и npm.

## Локальный запуск

### Backend

Из каталога `backend/` на Linux и macOS:

```bash
./gradlew test
./gradlew run
```

В PowerShell на Windows:

```powershell
.\gradlew.bat test
.\gradlew.bat run
```

Проверка сервера:

```bash
curl http://127.0.0.1:8080/health
```

Ожидаемый ответ: `OK`.

При первом запуске Wrapper скачивает Gradle 9.7.1.

### Frontend

Из каталога `frontend/`:

```bash
npm install
npm run dev
```

Открой `http://localhost:5173`.

Проверка сборки:

```bash
npm run build
```

Vite проксирует WebSocket-маршрут сигналинга `/ws` на backend.

## Документация

- [Дизайн этапа 1](docs/superpowers/specs/2026-11-22-stage-1-voice-design.md)
- [План этапа 1](docs/superpowers/plans/2026-11-22-stage-1-voice-plan.md)
