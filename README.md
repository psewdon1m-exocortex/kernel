# Exocortex Kernel

## Автоматические резервные копии

Updater автоматически устанавливает общий Neptune после настройки Register и
доверия к релизам. Создайте в Saturn одноразовый Neptune setup code, откройте
Settings → Backup, нажмите **Initialize Neptune** и введите код. Эта операция
также установит отсутствующий агент. `sudo kernel-install backup` выполняет
тот же сценарий через CLI. Расписание задаётся только в Saturn → Synchronization.

## Production installation

Prepare one explicit immutable release without starting it (replace `X.Y.Z`):

```bash
curl -fsSL https://github.com/psewdon1m-exocortex/kernel/releases/download/kernel-vX.Y.Z/bootstrap.sh | sudo sh
```

Edit only the `OPERATOR INPUT` section in `/opt/exocortex/kernel/.env`, then
run:

```bash
sudo kernel-install
```

Release CI derives the public key from Kernel's private signing key in GitHub
Secrets and embeds only that public key in this versioned `bootstrap.sh`. On a
clean host the bootstrap writes it to
`/etc/exocortex/release-trust/kernel.pem`, verifies the signed manifest before
trusting any artifact URL or digest, and only then downloads and prepares
Kernel. An existing mismatching key is never replaced automatically. No
`scp`, manually supplied release-key fingerprint or separate public-key
preparation is part of installation. The bootstrap populates the release
version and immutable image digest and generates the session, service, updater
and local Kernel-to-Volt tokens in Kernel's own mode-`0600` `.env`; it never
generates the operator Access Key. Nginx, certificates, DNS and firewall policy
are intentionally handled separately through Sindri.

After a successful Kernel install, its installer writes one-time, root-only
credential handoffs for Volt and Saturn under
`/etc/exocortex/bootstrap-credentials/`. Each consuming bootstrap imports and
deletes only its own file; it never opens Kernel's `.env`. On an already
installed Kernel, regenerate both handoffs with `sudo kernel-install
credentials` before bootstrapping the consumers.

The release bundle contains an independent `nginx.security.conf`. Include it
inside Kernel's public HTTPS `server {}` block (for example,
`include /opt/exocortex/kernel/nginx.security.conf;`) and validate with
`nginx -t` before reload. It hides health, updater and documentation endpoints
and rejects probe paths before proxying them to Kernel. The login page and
authenticated UI/API remain reachable from every client IP; do not add an
`OPERATOR_CIDR`, a VPN prerequisite or an `allow`/`deny` source-IP ACL for the
public-authenticated deployment profile. Access Key verification and the
bounded Kernel session protect every operator data/API route.

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
repositories.updater.url
repositories.neptune.url
repositories.gryphon.url
repositories.volt.url
repositories.saturn.url
services.kernel.sni
services.kernel.port
services.kernel.health.path
services.kernel.health.contract
services.kernel.backup.saturn_slug
services.saturn.sni
services.saturn.port
services.saturn.health.path
services.saturn.health.contract
services.saturn.paths.backup_ingest
services.saturn.paths.sync
services.saturn.paths.sync_preferences
services.saturn.backup.saturn_slug
services.volt.sni
services.volt.port
services.volt.health.path
services.volt.health.contract
services.volt.backup.saturn_slug
intervals.kernel.refresh_sec
intervals.neptune.register_refresh_sec
services.gryphon.sni
services.gryphon.port
```

Поля `services.*.port` описывают клиентскую HTTPS-маршрутизацию, а не управляют
локальными listener. Их меняют в конфигурации конкретного сервиса и общего
server Nginx.

Backend Dashboard проверяет Kernel, Saturn и Volt. Публичный SNI используется
для отдельной EDGE-проверки, а `health.path` — только для заранее разрешённого
health-контракта. Saturn публикует краткий dependency-aware результат по
`/api/v1/public/reachability`, не раскрывая детали зависимостей. Проверки имеют
ограниченный timeout, запрещают redirects и не превращают произвольные Register
URL в сетевые probes. Updater и Neptune не являются HTTP-сервисами, а публичная
поверхность Gryphon принимает только аутентифицированные Telegram webhooks,
поэтому эти компоненты в Dashboard не проверяются.

## Данные и документы

Состояние хранится в `data/kernel.sqlite`; Docker использует persistent volume.
Overview и Constitution изменяются только загрузкой `overview.md` и
`constitution.md` с устройства. Upload и restore создают новую immutable
revision.

Register запрещает любые реальные значения и любые ссылки, кроме строгого
формата `volt://<entry-id>/<value-position>`. Все ключи конфигурации, например
`services.saturn.sni`, оператор добавляет только как ссылку
на поле Volt. Kernel разрешает ссылку только при явном machine-запросе и не
сохраняет plaintext в Register, snapshots, audit или backups. Единственный
machine token Volt хранится как одинаковый локальный secret file на серверах
Kernel и Volt.
Если существующая база содержит legacy-значения, Kernel не удаляет единственную
копию автоматически: Register показывает оператору предупреждение, а machine
API отвечает `REGISTER_VALUE_MIGRATION_REQUIRED`. После замены всех таких
значений на Volt-ссылки старые value-bearing revisions очищаются и публикация
возобновляется.

## Обновления Kernel

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
