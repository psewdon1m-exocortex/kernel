# Exocortex Kernel

## 1. Определение

**Exocortex Kernel** — самостоятельный пассивный сервис одного VPS, который
хранит и отображает нормативную, справочную и конфигурационную модель
Exocortex.

```text
Kernel = Dashboard + Overview + Topology Map + Register + Constitution + Settings
```

Kernel:

- не является LLM или агентом;
- не исполняет задачи других модулей;
- не управляет другими сервисами;
- не обнаруживает и не опрашивает другие сервисы;
- не отражает фактическое состояние всей системы;
- не является обязательным runtime-посредником между сервисами;
- не выполняет исходящие сетевые запросы.

Kernel отвечает только на входящие запросы оператора и внутренних систем
Exocortex.

## 2. Граница сервиса

```text
Оператор
  ├─ открывает Web UI
  ├─ загружает overview.md и constitution.md с устройства
  ├─ редактирует Register
  ├─ строит Topology Map
  └─ просматривает Dashboard

Внутренние системы Exocortex
  ├─ сами обращаются к read API Kernel
  ├─ получают Overview/Constitution и опубликованный Register snapshot
  ├─ проверяют и сохраняют её локально
  └─ используют last-known-good при недоступности Kernel

Kernel
  ├─ отвечает на входящие запросы
  ├─ хранит данные локально
  ├─ читает метрики своего VPS
  └─ не инициирует взаимодействие с другими сервисами
```

Недоступность Kernel не должна останавливать уже работающие внутренние
сервисы. Клиент Kernel обязан самостоятельно хранить последнюю проверенную
ревизию нужного ему документа или Register snapshot.

## 3. Развёртывание и доверительная граница

Kernel предназначен для:

- одного оператора;
- одного VPS;
- одного окружения;
- развёртывания отдельным Docker-сервисом;
- работы за закрытым сетевым контуром или reverse proxy.

Сложная ролевая модель не требуется. Достаточно одной операторской учётной
записи и отдельного read-only токена для внутренних систем.

Все страницы и данные Kernel закрыты авторизацией, кроме минимального endpoint
liveness.

## 4. Разделы интерфейса

Основная навигация:

```text
Dashboard
Overview
Topology Map
Register
Constitution
Settings
```

Web UI следует правилам `UI_UX_SPECIFICATION.md`:

- истинно чёрная рабочая поверхность;
- белые информационные линии;
- один настраиваемый accent;
- моноширинная типографика;
- прямоугольная геометрия;
- Sidebar шириной 220 px;
- иерархия через прозрачность линий;
- отсутствие декоративных градиентов, теней и marketing-блоков;
- custom overlays, confirmations и notices;
- keyboard focus и reduced-motion;
- отсутствие layout shift при hover и изменении статусов.

## 5. Dashboard

Dashboard показывает только состояние VPS, на котором работает Kernel:

- CPU current usage;
- RAM used/free/total;
- Disk used/free/total;
- system uptime.

Kernel получает эти данные только из локального API операционной системы.
Dashboard не агрегирует состояние других сервисов и не является системой
мониторинга.

Backend может собирать дополнительные локальные метрики для будущего развития,
но UI v0 их не показывает.

Если метрика недоступна, UI показывает `N/A`, а не выдуманное значение.

## 6. Overview

Overview — человекочитаемое описание Exocortex.

Единственный способ изменить Overview в v0:

```text
Settings
  → Upload overview.md
  → локальная валидация
  → сохранение новой immutable revision
  → публикация новой активной версии
```

Overview:

- не подтягивается из Git;
- не читается из другого сервиса;
- не редактируется в web-редакторе;
- загружается только с устройства оператора;
- отображается как безопасно обработанный Markdown.

## 7. Constitution

Constitution — главный человекочитаемый нормативный документ Exocortex.

В v0 Constitution:

- хранится как `constitution.md`;
- загружается только с устройства оператора;
- не синхронизируется с другими частями системы;
- не является machine-readable policy;
- не используется как policy engine;
- не требует отдельного формата для LLM.

Constitution содержит принципы модульности, безопасности, работы с данными,
секретами, доступом, логированием и обратимостью.

Базовые правила:

1. **Modularity** — модули имеют отдельные зоны ответственности.
2. **Source of Truth Separation** — домены не дублируют состояние друг друга.
3. **No Secret Exposure** — секреты не попадают в Kernel, логи или LLM.
4. **Human Direct / AI Controlled** — будущие AI-инструменты работают только
   через контролируемые интерфейсы.
5. **Reversibility** — изменения должны быть обратимыми, когда это технически
   возможно.
6. **Auditability** — мутации фиксируют actor, время, действие и результат.
7. **Non-Monolithic Kernel** — Kernel не становится центром исполнения.
8. **Explicit Integration** — взаимодействия модулей описываются явно.

## 8. Версии документов

Overview и Constitution хранятся как последовательность immutable revisions.

Каждая ревизия содержит:

- revision ID;
- тип документа;
- SHA-256 содержимого;
- дату создания;
- actor;
- исходную ревизию для restore;
- содержимое Markdown.

Загрузка нового документа не удаляет старый.

Restore не переписывает историю. Он создаёт новую ревизию с содержимым
выбранной старой версии.

Минимальная валидация upload:

- разрешено только расширение `.md`;
- максимальный размер ограничен;
- файл не пустой;
- файл является корректным UTF-8 текстом;
- NUL и бинарное содержимое отклоняются;
- имя файла не используется как путь хранения;
- код и HTML из Markdown не исполняются.

## 9. Topology Map

Topology Map — вручную построенная оператором концептуальная архитектурная
карта.

Полная карта доступна только операторской web-сессии и не выдаётся внутреннему
service token.

Она:

- нужна для собственного понимания системы;
- не показывает реальное состояние сервисов;
- не получает данные из PERIMETR или других модулей;
- не является health/status dashboard;
- не используется для автоматического исполнения.

### 9.1 Основа

В Kernel включается локальная vendored-копия проекта Open Node. Kernel не
зависит от опубликованного пакета или соседней директории репозитория.

Используется только визуальная часть Open Node:

- Infinite Canvas;
- pan/zoom;
- minimap;
- grid/background;
- Node Library;
- Inspector;
- nodes, groups и containers;
- connections;
- annotations;
- перемещение и изменение размеров;
- undo/redo;
- сериализация и autosave.

Отключены:

- execution runtime;
- Run/Stop;
- Timeline;
- Machine API;
- MCP;
- workers/GPU;
- исполняемые Node;
- Open Node resource dashboard.

### 9.2 Хранение

Канонический формат карты — Open Node project:

```text
topology.onode.json
```

Сохранение карты создаёт новую ревизию. Kernel проверяет формат, schema version,
ограничение размера и структуру проекта.

История доступна оператору в UI. Restore старой карты не изменяет существующую
ревизию, а публикует её содержимое как новую активную revision с
`source_revision`.

Оригинальный дизайн Open Node сохраняется внутри Canvas. Оболочка страницы и
основная навигация Kernel следуют `UI_UX_SPECIFICATION.md`.

## 10. Register

Register — не документ и не YAML-файл. Это структурированный key-value
реестр, который редактируется непосредственно через Web UI.

Примеры:

```text
repositories.kernel.url                  → https://github.com/example/exocortex-kernel
repositories.perimetr.url                → https://github.com/example/exocortex-perimetr
repositories.agent.url                   → https://github.com/example/exocortex-agent
repositories.pod.url                     → https://github.com/example/exocortex-pod
repositories.sindri.url                  → https://github.com/example/exocortex-sindri
repositories.updater.url                 → https://github.com/example/exocortex-updater
services.kernel.sni                      → kernel.example.com
services.kernel.port                     → 443
services.kernel.service_token            → <distributed service token>
services.perimetr.sni                    → perimetr.example.com
services.perimetr.port                   → 443
intervals.kernel.refresh_sec             → 60
```

Repository URLs and client-facing Kernel/Perimetr ports are central Register
values retained in each client's last-known-good snapshot. A client combines
the service SNI and port from Register with the fixed route contract. Register
never changes a running listener: `KERNEL_LISTEN_PORT` and
`PERIMETR_LISTEN_PORT` are changed manually during deployment, followed by a
container restart. Agent's listener port remains device-local. Stable route
suffixes, Pod/Xray runtime pins and service-owned timeouts live in the
corresponding service `.env`. Perimetr is the current periodic Register client.
Agent communicates only with Perimetr, while Agent and Sindri discover their
own releases from their product release manifests rather than from Kernel.

Каждая запись содержит:

- внутренний ID;
- уникальный key;
- value;
- необязательное описание;
- позицию в UI;
- время создания;
- время изменения.

Поддерживаются:

- создание;
- редактирование;
- удаление;
- изменение порядка;
- поиск;
- просмотр даты изменения;
- просмотр истории;
- восстановление старой версии как новой активной ревизии.

В v0 key и value являются строками.

### 10.1 Ревизии Register

Каждая мутация создаёт атомарный snapshot всего реестра:

```json
{
  "revision": "register-000014",
  "checksum": "sha256:...",
  "updated_at": "2026-07-25T12:00:00Z",
  "values": {
    "perimetr.api": "https://perimetr.example.com/api",
    "kernel.timezone": "Europe/Istanbul"
  }
}
```

Snapshot нужен оператору для истории, проверки целостности и восстановления.
Service token получает только опубликованный snapshot с `revision`, `checksum`,
`updated_at` и `values`. Внутренние ID, позиции, описания, audit и mutation
endpoints ему не выдаются.

Checksum — SHA-256 от UTF-8 JSON без пробелов в форме `{"values":{...}}`.
Ключи `values` перед сериализацией сортируются лексикографически, поэтому
проверка не зависит от UI-порядка карточек.

Внутренние системы самостоятельно:

1. периодически запрашивают snapshot;
2. проверяют структуру и checksum;
3. сохраняют его локально;
4. применяют новую ревизию;
5. используют last-known-good при ошибке или недоступности Kernel.

Kernel не отправляет уведомления и не вызывает клиентов.

### 10.2 Запрещённые значения

Register не хранит, кроме явно описанного bootstrap-исключения ниже:

- пароли;
- API tokens;
- private keys;
- cookies;
- session tokens;
- recovery codes;
- seed phrases;
- любые значения, дающие прямой доступ.

Единственное разрешённое исключение для закрытой сети одного VPS:
`services.kernel.service_token`. Локальный `KERNEL_SERVICE_TOKEN` остаётся
bootstrap trust anchor и продолжает приниматься, поэтому сервис может
аутентифицироваться до чтения распределённого значения.

Secret references допустимы только как неавторизующие идентификаторы, например
`secret://global/storage`.

## 11. Settings

Settings содержит:

### Appearance

- цвета `dark`, `light`, `accent`;
- reset к значениям по умолчанию;
- переключатель логирования каждого machine revision request, включая `304`;
- режим Sidebar.

### Documents

- upload `overview.md`;
- upload `constitution.md`;
- список ревизий;
- просмотр metadata;
- restore с обязательным confirmation.

### Security

- смена операторского пароля;
- информация о текущей сессии.

### Backup

- экспорт локального состояния Kernel;
- импорт требует отдельной защищённой операции.

### Logger

- список audit events;
- actor, действие, объект, время и результат.

## 12. Хранение

Рекомендуемая структура:

```text
kernel/
├─ data/
│  ├─ kernel.sqlite
│  └─ defaults/
│     ├─ overview.md
│     ├─ constitution.md
│     └─ topology.onode.json
├─ server/
├─ src/
├─ vendor/
│  └─ open-node/
├─ tests/
├─ Dockerfile
└─ compose.yaml
```

SQLite хранит:

- Register entries;
- Register revisions;
- document revisions;
- topology revisions;
- audit events;
- UI settings.

Markdown и Open Node project могут храниться в SQLite как versioned content,
но остаются импортируемыми и экспортируемыми в своих канонических форматах.

## 13. API

### Системные endpoints

```text
GET  /api/health
GET  /api/dashboard
```

### Документы

```text
GET  /api/documents/:type
GET  /api/documents/:type/versions
POST /api/documents/:type/upload
POST /api/documents/:type/restore
```

`type` принимает только `overview` или `constitution`.

### Topology

```text
GET /api/topology
PUT /api/topology
GET /api/topology/versions
POST /api/topology/restore
```

### Register

```text
GET    /api/register
POST   /api/register/entries
PUT    /api/register/entries/:id
DELETE /api/register/entries/:id
PUT    /api/register/order
GET    /api/register/versions
POST   /api/register/restore
```

### Auth и Settings

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
GET  /api/settings
PUT  /api/settings
GET  /api/audit
```

Оператор входит по `username` и `password`. Оба значения задаются локально
через `KERNEL_ADMIN_USERNAME` и `KERNEL_ADMIN_PASSWORD`; Register их не
публикует.

Операторская web-сессия имеет доступ ко всем административным endpoints.
Внутренний service token имеет read-only доступ только к стабильному machine
API v1:

```text
GET  /api/v1/health
GET  /api/v1/register/snapshot
HEAD /api/v1/register/snapshot
GET  /api/v1/register/sections/{section}
GET  /api/v1/register/resolve?key={key}
GET  /api/v1/constitution/raw
GET  /api/v1/constitution/snapshot
GET  /api/v1/constitution/meta
```

Overview, Topology, Dashboard, Settings, backup, audit, история и мутации
являются operator-only. Внутренние сервисы не используют Overview или Topology
как machine-readable источник конфигурации.

## 14. Безопасность

- все чувствительные endpoints требуют авторизации;
- session cookie имеет `HttpOnly`, `SameSite=Strict` и `Secure` за HTTPS;
- мутации проверяют origin;
- password hash создаётся через memory-hard KDF;
- сравнение токенов выполняется constant-time;
- Markdown рендерится без raw HTML;
- ссылки допускают только безопасные protocols;
- upload имеет ограничение размера;
- SQL выполняется параметризованными запросами;
- все мутации пишут audit event;
- API не возвращает stack traces;
- Content Security Policy запрещает внешний script execution;
- Kernel не выполняет исходящие HTTP-запросы.

## 15. Acceptance Criteria v0

Kernel готов, если:

1. Запускается отдельным Docker-сервисом на одном VPS.
2. Имеет single-operator login с username и password из локального `.env`.
3. Dashboard показывает локальные CPU, RAM, Disk и system uptime.
4. Overview безопасно отображает загруженный с устройства `overview.md`.
5. Constitution безопасно отображает загруженный с устройства
   `constitution.md`.
6. Загрузка документов создаёт immutable revisions.
7. Restore документов, Register и Topology создаёт новую ревизию и не меняет
   историю.
8. Topology Map использует vendored Open Node visual editor.
9. В Topology отсутствуют Run, Timeline, MCP и execution.
10. Topology сохраняется как валидный Open Node project.
11. Register редактируется через key-value UI.
12. Каждая мутация Register создаёт атомарный revision и checksum.
13. Read API возвращает revision metadata.
14. Внутренние системы могут читать опубликованные документы и Register
    snapshot, но Kernel сам их не вызывает.
15. Недоступность Kernel не требует остановки клиентов.
16. Register не хранит секреты, кроме явно разрешённого
    `services.kernel.service_token`.
17. UI следует `UI_UX_SPECIFICATION.md`.
18. Интерфейс работает с клавиатурой и на узком viewport без overlap.
19. Мутации фиксируются в audit.
20. Unit, API и browser tests проходят.

## 16. Краткая формула

**Exocortex Kernel — самостоятельный пассивный registry одного VPS с
операторским Web UI, локальным Dashboard, versioned Markdown, визуальной
Topology Map и редактируемым Register. Он отвечает на запросы, но не
инициирует интеграции и не исполняет задачи других сервисов.**
