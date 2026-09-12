# Exocortex Kernel

## Автоматические резервные копии

Updater автоматически устанавливает общий Neptune после настройки Register и
доверия к релизам. Создайте в Saturn одноразовый Neptune setup code, откройте
Settings → Backup, нажмите **Initialize Neptune** и введите код. Эта операция
также установит отсутствующий агент. `sudo kernel-install backup` выполняет
тот же сценарий через CLI. Расписание задаётся только в Saturn → Synchronization.

## Production installation

Prepare the latest stable release without starting it:

```bash
curl -fsSL https://raw.githubusercontent.com/psewdon1m-exocortex/kernel/main/bootstrap.sh | sudo sh
```

Edit only the `OPERATOR INPUT` section in `/opt/exocortex/kernel/.env`, then
run:

```bash
sudo kernel-install
```

On a clean host the bootstrap downloads `kernel.pem` from the selected HTTPS
GitHub release, verifies that it signed the release manifest, and pins it in
`/etc/exocortex/release-trust/kernel.pem`. An existing pinned key is never
replaced automatically. The bootstrap populates the release version and immutable
image digest and generates the session, service, updater and local Kernel-to-Volt tokens. It
never generates the operator Access Key. Nginx, certificates, DNS and firewall policy
are intentionally handled separately through Sindri.

The release bundle contains an independent `nginx.security.conf`. Include it
inside Kernel's public HTTPS `server {}` block (for example,
`include /opt/exocortex/kernel/nginx.security.conf;`) and validate with
`nginx -t` before reload. It hides health, updater and documentation endpoints
and rejects probe paths before proxying them to Kernel. The login page and
authenticated UI/API remain reachable from every client IP; do not add an
`allow`/`deny` source-IP ACL for the public-authenticated deployment profile.

Пассивный registry-сервис для одного VPS:

- Dashboard с CPU, RAM, Disk, system uptime и кэшированными статусами доступности KERNEL, Chronos, Perimetr, Saturn, Laboratory и Volt;
- versioned `overview.md` и `constitution.md`;
- визуальная Topology Map на встроенном Excalidraw с серверным автосохранением и историей версий;
- Register с immutable revisions, checksum и restore-as-new;
- Settings, backup и audit для единственного оператора;
- read-only v1 API для внутренних сервисов.

Kernel не выполняет фоновые исходящие запросы и не управляет другими сервисами;
исключения — явно запущенная оператором проверка опубликованных релизов и
синхронное разрешение зарегистрированных Volt-ссылок по запросу сервиса.
Внутренние системы сами читают опубликованные ревизии со ссылками. Разрешённые
значения живут только в оперативной памяти; новый запуск требует доступных
Kernel и Volt.

## Границы сервисов

- Perimetr — периодический клиент Register.
- Agent Node общается только с Perimetr и Kernel не читает.
- Sindri — локальный CLI, который обновляет только себя.
- Pod общается только с Perimetr.

Полный backup Perimetr сохраняет Agent Registry, endpoints, сертификаты,
denylist и controller identity. При переносе Perimetr его публичный SNI должен
остаться прежним: DNS переводится на новый VPS, после чего восстанавливается
backup.

## Запуск

Создайте `.env` из `.env.example`, замените секреты и запустите:

```powershell
docker compose up -d --build
```

Локальный интерфейс:

```text
http://127.0.0.1:18180
```

Единый ключ оператора задаётся через `KERNEL_ACCESS_KEY` в локальном `.env`.
Во время staged migration существующий `KERNEL_ADMIN_PASSWORD` принимается как
совместимый источник verifier; имя оператора больше не требуется.

Production Compose contains no reverse proxy and publishes Kernel only on VPS
loopback. One shared host-level Nginx owns TCP 80/443 and routes the Kernel SNI
to `127.0.0.1:KERNEL_LISTEN_PORT`. Install and operate that Nginx through
Sindri; keep the certificate, SNI and public ports out of Kernel `.env`.
`services.kernel.port` is the client-facing HTTPS port (normally `443`), not
the private listener port. The canonical proxy configuration is documented in
the infrastructure repository's `NGINX_DEPLOYMENT.md`.

Keep the private Node listener on loopback and publish only the HTTPS Nginx
virtual host. Access Key verification, secure sessions, CSRF checks and
application rate limits protect operator data; crawler headers are not an
authentication mechanism.

The host installer requires root for updater and Compose setup. The Kernel
application process does not: its Dockerfile switches to the
standard unprivileged `node` user, while production Compose uses a read-only
root filesystem, a dedicated data volume and drops all Linux capabilities.

## Machine API v1

```http
Authorization: Bearer <KERNEL_SERVICE_TOKEN>
```

```text
GET  /api/v1/health
GET  /api/v1/register/snapshot
HEAD /api/v1/register/snapshot
GET  /api/v1/register/sections/{section}
GET  /api/v1/register/resolve?key={dotted.key}
POST /api/v1/register/resolve   {"keys":["dotted.key"]}
GET  /api/v1/constitution/raw
GET  /api/v1/constitution/snapshot
GET  /api/v1/constitution/meta
```

Register и Constitution поддерживают `ETag`, `If-None-Match` и `304 Not
Modified`. Ответы содержат revision и SHA-256 checksum canonical UTF-8 JSON.

В Settings параметр `revision_request_logging` включает и выключает аудит
каждого machine request, включая неизменившиеся запросы с ответом `304`.
Записываются path, request ID, source address, status и revision.

## Service token

`KERNEL_SERVICE_TOKEN` в локальном `.env` — общий bootstrap trust anchor и
никогда не публикуется через Register. С этим token сервис может читать machine
API Kernel и передать до 20 Register keys в `POST /api/v1/register/resolve`.
Каждое значение Register обязано быть строгой ссылкой
`volt://<entry-id>/<value-position>`. Позиция начинается с `1`. Kernel разрешает все запрошенные ссылки в Volt
от своего имени и возвращает сервису только готовое отображение ключей.

Это сознательно простая модель доверенной зоны без ACL: любой сервис с
`KERNEL_SERVICE_TOKEN` может разрешить любое значение текущей опубликованной
ревизии Register. Компрометация одного сервиса поэтому открывает все значения
Register. Отдельный `VOLT_KERNEL_TOKEN` известен только Kernel и Volt. Его
задают в разделе Settings обоих приложений; Kernel хранит значение
AES-256-GCM-зашифрованным с ключом, производным от `KERNEL_SESSION_SECRET`, а
Volt хранит только SHA-256 verifier. Токен никогда не возвращается через API и
не передаётся сервисам.

## Активный Register

```text
repositories.kernel.url
repositories.perimetr.url
repositories.agent.url
repositories.pod.url
repositories.sindri.url
repositories.updater.url
repositories.volt.url
services.kernel.sni
services.kernel.port
services.kernel.health.path
services.kernel.health.contract
services.chronos.sni
services.chronos.port
services.chronos.health.path
services.chronos.health.contract
services.perimetr.sni
services.perimetr.port
services.perimetr.health.path
services.perimetr.health.contract
services.saturn.sni
services.saturn.port
services.saturn.health.path
services.saturn.health.contract
services.laboratory.sni
services.laboratory.port
services.laboratory.health.path
services.laboratory.health.contract
services.volt.sni
services.volt.port
services.volt.health.path
services.volt.health.contract
intervals.kernel.refresh_sec
```

`repositories.pod.url` — единственная общая координата релизов Pod. Perimetr
выводит из неё `<repository>/releases/download/pod-current/pod-update.json`,
проверяет подписанный манифест и хранит persistent last-known-good cache
исполняемых файлов. Pods не обращаются к Kernel: проверенные URL манифеста и
публичный ключ Perimetr встраивает в конфигурацию Subject.

Репозитории Agent и Sindri остаются в Register как общая
provenance/operator-информация, но сами Agent и Sindri их оттуда не читают.
Их self-update использует repository coordinates из собственного release
manifest.

`services.kernel.port` и `services.perimetr.port` — маршрутизация для клиентов,
а не управление listener. Сам listener меняется вручную через
`KERNEL_LISTEN_PORT`/`PERIMETR_LISTEN_PORT` с перезапуском контейнера.

Backend Dashboard проверяет только известные сервисы из этого списка. Публичный
SNI используется для отдельной EDGE-проверки, а `health.path` — для разрешённого
health-контракта. Проверки выполняются с ограниченным timeout, без redirects и
не превращают произвольные Register URL в сетевые probes. Neptune и Updater в
Dashboard не проверяются.

Perimetr делает conditional GET с периодом `intervals.kernel.refresh_sec`,
проверяет schema/revision/checksum и атомарно сохраняет reference snapshot.
Перед применением он разрешает свои ключи через Kernel; фактические значения на
диск не записываются.

## Данные и документы

Состояние хранится в `data/kernel.sqlite`; Docker использует persistent volume.
Overview и Constitution изменяются только загрузкой `overview.md` и
`constitution.md` с устройства. Upload и restore создают новую immutable
revision.

Register запрещает любые реальные значения и любые ссылки, кроме строгого
формата `volt://<entry-id>/<value-position>`. Все ключи конфигурации, например
`services.laboratory.ai.gemini_api_key`, оператор добавляет только как ссылку
на поле Volt. Kernel разрешает ссылку только при явном machine-запросе и не
сохраняет plaintext в Register, snapshots, audit или backups. Единственный
machine token Volt хранится как одинаковый локальный secret file на серверах
Kernel и Volt.
Если существующая база содержит legacy-значения, Kernel не удаляет единственную
копию автоматически: Register показывает оператору предупреждение, а machine
API отвечает `REGISTER_VALUE_MIGRATION_REQUIRED`. После замены всех таких
значений на Volt-ссылки старые value-bearing revisions очищаются и публикация
возобновляется.

## Обновления Kernel и Perimetr

Production-обновление не должно клонировать и собирать весь репозиторий на VPS.
Используется отдельный host-level updater, checksummed release manifest,
предсобранный OCI image по digest, backup, health check и automatic rollback.
Подробности: [WEB_SERVICE_UPDATE_ARCHITECTURE.md](WEB_SERVICE_UPDATE_ARCHITECTURE.md).

Settings содержит операторский `Updater`: по явному запросу он читает
`repositories.kernel.url` из Register и проверяет только релизы `kernel-v*`.
Отдельная ручная проверка версии Updater читает `repositories.updater.url` и
проверяет релизы `updater-v*`; безопасная установка самого Updater остаётся
host-командой `updater update --head kernel`.
Автоматического polling нет. Audit ограничен одновременно числом записей,
возрастом и суммарным размером хранимых событий через
`KERNEL_AUDIT_MAX_ENTRIES`, `KERNEL_AUDIT_RETENTION_DAYS` и
`KERNEL_AUDIT_MAX_BYTES`. ZIP-архив подробных логов доступен оператору через
`GET /api/logs/download`; web-интерфейс показывает сокращённое представление.
Backup ZIP можно создать и скачать через Settings. Выбор локального архива
открывается непосредственно из карточки; затем Restore проверяет его без
изменения live state, показывает метаданные и требует отдельного подтверждения.
Там же отображается доступность Neptune, настраивается расписание экспорта в
Saturn и запускается немедленная копия. Импорт создаёт новые актуальные ревизии
и не меняет Access Key.

## Разработка

Требуется Node.js 24+:

```powershell
npm install
$env:KERNEL_ACCESS_KEY='development-access-key'
$env:KERNEL_SESSION_SECRET='development-session-secret-at-least-32-characters'
$env:KERNEL_SERVICE_TOKEN='development-service-token-at-least-24-characters'
npm run check
```

После входа откройте Settings → Security → Volt connection, укажите URL Volt и
общий токен длиной не менее 32 символов. То же значение задайте в Volt Settings.
Если меняется `KERNEL_SESSION_SECRET`, токен в Kernel необходимо задать заново.
Старые `VOLT_URL`, `VOLT_KERNEL_TOKEN` и `VOLT_KERNEL_TOKEN_FILE` принимаются
только как источник однократной миграции в настройки существующих установок.

## Документы

- [Концепция](kernel-concept.md)
- [Machine interaction specification](KERNEL_INTERNAL_SERVICES_INTERACTION_SPEC(1).md)
- [Compliance report](KERNEL_SPEC_COMPLIANCE_REPORT.md)
- [Web update architecture](WEB_SERVICE_UPDATE_ARCHITECTURE.md)
- [Release process](RELEASING.md)
- [Open Node snapshot](vendor/open-node/VENDORED_FROM.md)
- Общая спецификация унификации: `../UNIFICATION_SPECIFICATION.md`

The current six-service deployment, trust, recovery and acceptance contract is documented in [Deployment readiness](DEPLOYMENT_READINESS.md).
