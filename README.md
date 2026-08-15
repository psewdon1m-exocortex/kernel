# Exocortex Kernel

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

The bootstrap populates the release version and immutable image digest and
generates the session, service and updater tokens. It never generates the
operator username or password. Nginx, certificates, DNS and firewall policy
are intentionally handled separately through Sindri.

Пассивный registry-сервис для одного VPS:

- Dashboard с CPU, RAM, Disk и system uptime;
- versioned `overview.md` и `constitution.md`;
- визуальная Topology Map на vendored Open Node;
- Register с immutable revisions, checksum и restore-as-new;
- Settings, backup и audit для единственного оператора;
- read-only v1 API для внутренних сервисов.

Kernel не выполняет исходящие запросы и не управляет другими сервисами.
Внутренние системы сами читают опубликованные ревизии и сохраняют
last-known-good.

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

Логин и пароль оператора задаются через `KERNEL_ADMIN_USERNAME` и
`KERNEL_ADMIN_PASSWORD` в локальном `.env`.

Production Compose contains no reverse proxy and publishes Kernel only on VPS
loopback. One shared host-level Nginx owns TCP 80/443 and routes the Kernel SNI
to `127.0.0.1:KERNEL_LISTEN_PORT`. Install and operate that Nginx through
Sindri; keep the certificate, SNI and public ports out of Kernel `.env`.
`services.kernel.port` is the client-facing HTTPS port (normally `443`), not
the private listener port. The canonical proxy configuration is documented in
the infrastructure repository's `NGINX_DEPLOYMENT.md`.

Kernel should still be restricted to the intended operator and internal
service clients by firewall, VPN, or an access layer where possible. Never
publish the private Node listener directly.

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

`KERNEL_SERVICE_TOKEN` в локальном `.env` — bootstrap trust anchor. На первом
запуске Kernel создаёт в Register запись:

```text
services.kernel.service_token
```

Bootstrap-токен продолжает приниматься, поэтому сервис не может заблокировать
себя: он сначала аутентифицируется локальным значением, затем читает
распределённое значение из Register. Изменять Register-токен может только
оператор; service token имеет только read-only доступ к machine API.

## Активный Register

```text
repositories.kernel.url
repositories.perimetr.url
repositories.agent.url
repositories.pod.url
repositories.sindri.url
repositories.updater.url
services.kernel.sni
services.kernel.port
services.kernel.service_token
services.perimetr.sni
services.perimetr.port
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

Perimetr делает conditional GET с периодом `intervals.kernel.refresh_sec`,
проверяет schema/revision/checksum и атомарно сохраняет snapshot. При
недоступности Kernel он продолжает работать с последней валидной ревизией.

## Данные и документы

Состояние хранится в `data/kernel.sqlite`; Docker использует persistent volume.
Overview и Constitution изменяются только загрузкой `overview.md` и
`constitution.md` с устройства. Upload и restore создают новую immutable
revision.

Register обычно запрещает реальные секреты. Единственное явное исключение —
`services.kernel.service_token`, добавленное по архитектурному решению для
закрытой внутренней сети одного VPS.

## Обновления Kernel и Perimetr

Production-обновление не должно клонировать и собирать весь репозиторий на VPS.
Используется отдельный host-level updater, checksummed release manifest,
предсобранный OCI image по digest, backup, health check и automatic rollback.
Подробности: [WEB_SERVICE_UPDATE_ARCHITECTURE.md](WEB_SERVICE_UPDATE_ARCHITECTURE.md).

Settings содержит операторский `Updater`: по явному запросу он читает
`repositories.kernel.url` из Register и проверяет только релизы `kernel-v*`.
Автоматического polling нет. Audit ограничен одновременно числом записей,
возрастом и суммарным размером хранимых событий через
`KERNEL_AUDIT_MAX_ENTRIES`, `KERNEL_AUDIT_RETENTION_DAYS` и
`KERNEL_AUDIT_MAX_BYTES`. ZIP-архив подробных логов доступен оператору через
`GET /api/logs/download`; web-интерфейс показывает сокращённое представление.
Backup JSON можно как скачать, так и
восстановить через Settings; восстановление создаёт новые актуальные ревизии и
не меняет пароль оператора.

## Разработка

Требуется Node.js 24+:

```powershell
npm install
$env:KERNEL_ADMIN_PASSWORD='development-password'
$env:KERNEL_ADMIN_USERNAME='operator'
$env:KERNEL_SESSION_SECRET='development-session-secret-at-least-32-characters'
$env:KERNEL_SERVICE_TOKEN='development-service-token-at-least-24-characters'
npm run check
```

## Документы

- [Концепция](kernel-concept.md)
- [Machine interaction specification](KERNEL_INTERNAL_SERVICES_INTERACTION_SPEC(1).md)
- [Compliance report](KERNEL_SPEC_COMPLIANCE_REPORT.md)
- [Web update architecture](WEB_SERVICE_UPDATE_ARCHITECTURE.md)
- [Release process](RELEASING.md)
- [Open Node snapshot](vendor/open-node/VENDORED_FROM.md)
- Общая спецификация унификации: `../UNIFICATION_SPECIFICATION.md`
