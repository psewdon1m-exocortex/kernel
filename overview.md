# EXOCORTEX

Этот документ специализирует [Part 00 — System Unification Specification](https://github.com/psewdon1m-exocortex/general/blob/main/PART_00_SYSTEM_UNIFICATION_SPECIFICATION.md). Центральный комплект `.docs` остаётся нормативным источником для общесистемных UI/UX, deployment, security, backup, release и service-agent контрактов.

> **Назначение:** человекочитаемая карта актуальной системы Exocortex, её работающих компонентов, границ ответственности и основных потоков.
>
> **Статус:** живой архитектурный документ Kernel.
>
> **Актуальность:** 16 сентября 2026 года.
>
> **Текущий production-профиль:** Kernel, Volt и Saturn как основные сервисы; Updater, Neptune и Gryphon как общие host/deployment-компоненты.

---

## 1. Что такое Exocortex

Exocortex — модульная персональная система памяти, конфигурации, безопасного доступа, резервного копирования, автоматизации и будущего нейросетевого взаимодействия.

Система строится не как монолит и не как обязательный единый AI-интерфейс. Каждый сервис владеет ограниченным доменом, публикует явный контракт и может обновляться отдельно. Человек остаётся владельцем системы, финальным арбитром и получателем аварийного доступа.

Практические цели текущей итерации:

- один проверяемый источник глобальных координат и правил;
- отдельное зашифрованное хранилище фактических значений;
- централизованные backup/sync workflows без передачи root-полномочий web-приложениям;
- подписанные, воспроизводимые релизы и локальный rollback;
- единый операторский UI/UX без смешения источников истины;
- документированные границы для будущих агентов и LLM.

---

## 2. Основные принципы

### 2.1 Модульность

Каждый модуль отвечает за ограниченную предметную область. Отказ или замена одного модуля не должны неявно менять authority соседнего.

### 2.2 Явные источники истины

Для каждого класса данных назначается один authority. UI, кэши, Topology Map и поисковые индексы не становятся источниками истины только потому, что отображают данные.

### 2.3 Минимальные полномочия

Web-процессы не получают Docker socket, `sudo`, произвольное выполнение команд или административные sockets helper-сервисов. Привилегированные операции выполняются типизированными локальными агентами.

### 2.4 Обратимость и доказательства

Документы, Register, Topology и важные настройки версионируются. Обновление проходит через backup, проверку подписанного артефакта, health check и rollback. Успешный запрос не считается успешным конечным состоянием без terminal evidence.

### 2.5 Человек остаётся владельцем

Автоматизация, агенты и LLM не могут самостоятельно расширять scope, менять Constitution, скрывать audit или считать молчание подтверждением рискованного действия.

---

## 3. Актуальный production-профиль

```text
Owner / browser
  │
  ├── public HTTPS via one host-managed Nginx
  │     ├── Kernel
  │     ├── Volt
  │     └── Saturn
  │
  ├── Kernel ── authenticated resolve ──> Volt
  │      ▲
  │      └── internal consumers read Register/Constitution
  │
  ├── typed local operations ──> Updater
  │                                ├── installs/updates Neptune
  │                                └── installs/updates Gryphon
  │
  ├── Neptune ── outbound HTTPS ──> Saturn
  │      ├── recovery archives
  │      └── approved mirrors
  │
  └── Telegram ── webhook ──> Gryphon ──> Chronos / Saturn adapters
```

Текущий согласованный профиль состоит из шести компонентов:

| Компонент | Роль | Authority / граница |
|---|---|---|
| Kernel | governance и configuration service | Overview, Constitution, Register, Topology, UI settings и их revisions |
| Volt | encrypted value authority | фактические значения, immutable history, `personal.volt`, unlock и value resolution |
| Saturn | backup/sync control plane и storage gateway | schedules, setup codes, archive ingest, mirrors, remote jobs и observed state |
| Updater | один root-owned daemon на Linux host | allow-listed install/update/rollback jobs; не владеет продуктовым состоянием |
| Neptune | один unprivileged backup/sync agent на host | экспорт архивов и разрешённых mirrors в Saturn |
| Gryphon | единый Telegram gateway deployment | bot tokens, webhooks, deduplication, callbacks и service-scoped bindings |

Kernel, Volt и Saturn являются основными приложениями. Updater, Neptune и Gryphon — общие host/deployment-компоненты и не должны изображаться как самостоятельные пользовательские приложения Kernel Dashboard.

---

## 4. Kernel

Kernel — справочный, нормативный и конфигурационный сервис Exocortex для одного deployment.

### 4.1 Разделы интерфейса

1. **Dashboard** — CPU, RAM, Disk, uptime процесса Kernel и доступность Kernel, Saturn, Volt, Laboratory и Chronos.
2. **Overview** — этот документ.
3. **Topology Map** — версионируемое визуальное полотно Excalidraw.
4. **Register** — опубликованные ключи, содержащие только ссылки на значения Volt.
5. **Constitution** — нормативные правила системы.
6. **Settings** — appearance, security, backup, updates, logs и управление revisions документов.
7. **Documentation** — встроенное операторское руководство Kernel.

### 4.2 Граница ответственности

Kernel хранит revisions документов, Register, Topology, настройки представления и bounded audit. Он предоставляет операторский web-интерфейс и стабильные machine API.

Kernel не является общим API gateway, task runner, secret vault, пользовательским file storage или runtime-шиной всей системы. Он не хранит plaintext значений Register и не передаёт свой Kernel-to-Volt token потребителям.

Topology Map в текущей версии использует Excalidraw и предназначена только для человека. Изменение рисунка не меняет runtime-конфигурацию. Open Node остаётся отдельным framework-направлением и не является текущей реализацией Kernel Topology.

### 4.3 Dashboard availability

Kernel показывает только сервисы, для которых определена реальная проверка: Kernel, Saturn, Volt, зарегистрированные Laboratory и Chronos. Laboratory проверяется через публичный readiness-контракт `/api/health`, Chronos — через `/api/public/reachability`, поскольку его `/api/health` остаётся локальным. Если четыре Register-привязки сервиса отсутствуют или не соответствуют контракту, карточка показывает `unconfigured`. Neptune и Updater не проверяются карточками Dashboard; их локальное состояние отображается в соответствующих Settings-панелях. Статус разделяет liveness, readiness, unconfigured, degraded, stale и unavailable, а не сводит любой ответ `curl` к «доступен».

---

## 5. Register и поток значений через Volt

Register хранит ключи и metadata, но каждое непустое значение обязано быть строгой ссылкой:

```text
volt://<entry-uuid>/<value-position>
```

`value-position` — число от `1` до `5`. Это позиция значения внутри записи Volt, а не field UUID и не plaintext.

Рабочий поток:

1. оператор создаёт или обновляет запись в Volt;
2. оператор публикует соответствующую `volt://UUID/position` ссылку в Kernel Register;
3. внутренний сервис аутентифицируется общим `KERNEL_SERVICE_TOKEN` и запрашивает ключ через `POST /api/v1/register/resolve`;
4. Kernel проверяет текущую Register revision и обращается к Volt через отдельный Kernel-to-Volt token;
5. Volt возвращает значения только Kernel;
6. Kernel возвращает готовое отображение потребителю; значения не записываются обратно в Register.

Batch resolution ограничен 20 уникальными элементами и работает all-or-nothing. В текущей доверенной зоне нет per-service grants: holder действующего `KERNEL_SERVICE_TOKEN` может разрешить любую опубликованную ссылку. Поэтому этот token является чувствительным bootstrap credential.

Сервис может хранить last-known-good snapshot ссылок, но не resolved plaintext. Новый процесс, которому требуется значение, должен иметь доступ и к Kernel, и к разблокированному Volt; кэш ссылок не является кэшем секретов.

---

## 6. Volt 0.1.5

Последняя релизная версия, использованная для этой редакции, — `volt-v0.1.5`.

Volt — локальное зашифрованное хранилище и единственный authority для значений, на которые ссылается Kernel Register.

Основные свойства релиза:

- записи и их revisions находятся в переносимом `personal.volt`;
- payload зашифрован AES-256-GCM, а vault master key обёрнут ключом, выведенным из Access Key через Argon2id;
- Access Key необходим для offline-open и unlock; один device key не заменяет явный Access Key;
- процесс без ключа остаётся доступным для login/unlock, но readiness не становится успешным;
- Kernel-to-Volt machine endpoint защищён отдельным token; Volt хранит только его verifier;
- обычный сервис не обращается к Volt напрямую и не получает Kernel-to-Volt token;
- согласованный ZIP backup и `personal.volt` mirror являются независимыми recovery paths;
- существовавшие direct service principals/grants и legacy service tokens не входят в актуальный broker-контракт.

Access Key — точное непрозрачное значение. Он не должен trim-иться, нормализоваться, менять регистр или проверяться локальной password-policy; ошибкой является отсутствие настройки, а не форма значения.

---

## 7. Saturn, Neptune и восстановление

Saturn выдаёт одноразовые setup codes, хранит desired schedules и remote jobs, принимает recovery archives и approved mirrors. Setup code имеет тип, срок жизни и одноразовое применение.

Neptune устанавливается один раз на Linux host, работает без root и использует отдельные credentials каждого проекта. Main service создаёт логический архив через свой authenticated loopback endpoint; Neptune передаёт точные байты в Saturn и не переупаковывает архив.

Текущие профили:

- Kernel: recovery archive;
- Saturn: recovery archive;
- Volt: recovery ZIP плюс отдельный single-file mirror `personal.volt`;
- Chronos: recovery archive в расширенном профиле.

Расписания и fleet state принадлежат Saturn. Кнопка Initialize в Settings main service запускает typed job через Updater и ждёт terminal `COMPLETED` или `FAILED`; наличие binary или socket само по себе не означает enrollment.

Recovery archive должен иметь manifest, checksums, allow-list путей, limits и проверяемый restore. Секреты внешней инфраструктуры, release trust, executables и произвольное содержимое host не включаются автоматически.

---

## 8. Updater и релизы

Updater — один root-owned daemon на Linux host. Каждый head получает отдельный control token и может вызывать только разрешённые операции своего profile. Main-service контейнеры не получают Docker socket или произвольный root shell.

Текущий coordinated baseline требует Updater `0.4.3` или новее; Kernel 0.2.11 закрепляет `0.4.3` как проверенную release dependency. Репозиторий сервиса хранит точную версию в `.release/updater.version`.

Релиз main/helper service обязан:

- запускаться только service-qualified tag;
- собрать артефакты один раз;
- сформировать manifest и checksums;
- подписать manifest из изолированного release job;
- встроить только public trust в versioned bootstrap;
- проверить подпись до распаковки и запуска;
- создать backup до update;
- выполнить health check и rollback при ошибке;
- пройти актуальный Part 12 known-problem gate.

Один host-managed Nginx владеет TCP 80/443, TLS, WebSocket forwarding и fail-closed default host. Приложения слушают loopback и не устанавливают собственный proxy.

---

## 9. Gryphon и Telegram

Gryphon — единый gateway для Telegram. Consuming services не хранят bot token и не запускают собственный polling/webhook runtime.

Gryphon владеет:

- bot tokens и проверкой bot identity;
- публичным подписанным webhook path;
- deduplication и callback state;
- service-scoped bindings;
- client socket для Chronos и Saturn;
- отдельным root/local admin socket.

Успешный webhook ping доказывает только маршрут и общий secret. Полная проверка должна включать реальное событие, очередь, worker и ожидаемый доменный результат.

---

## 10. Другие активные направления

Шестикомпонентный профиль не описывает всю долгосрочную экосистему.

| Направление | Текущее место в системе |
|---|---|
| Chronos | сервис времени/задач и потребитель Neptune/Gryphon contracts; не входит в первый шестикомпонентный deployment |
| Perimetr | security/control plane для Subjects, Projects, устройств и прав |
| Pods | device-bound browser gates Perimetr с изолированной identity и маршрутом |
| Laboratory | AI/экспериментальный сервис с конфигурацией через Kernel/Volt |
| Mastermind | canonical Markdown knowledge base и qualification tooling |
| Agent | отдельное направление удалённого исполнения с минимальными полномочиями |
| Library | область пользовательского знания и контента; контракт развивается отдельно |
| Cognitive Plane | будущие Context Broker, Model Router, Evaluator и Tool Gateway |

Эти направления не должны автоматически добавляться в Register profile, Dashboard или production topology без отдельного согласованного контракта и migration.

---

## 11. UI, документация и наблюдаемость

Все операторские сервисы следуют Part 01:

- true-black поверхность, белая двухуровневая геометрия и один accent;
- Space Grotesk только для service/page names, Consolas для остального UI;
- фиксированный desktop sidebar 250 px и header 123 px;
- page titles, cards, search, overlays и Settings имеют единые размеры и состояния;
- search фильтрует сразу и содержит доступный clear-cross внутри поля;
- состояние выражается текстом, а не только цветом;
- mutation показывает pending и terminal result;
- документация обновляется в той же revision, что и операторский workflow.

Audit фиксирует значимые мутации и machine requests без secret values. Logs имеют bounded retention и безопасную выгрузку. Liveness, readiness, public edge и dependency state проверяются отдельно.

---

## 12. Снимок релизов на дату документа

| Компонент | Релизная линия, использованная при сверке |
|---|---|
| Kernel | `kernel-v0.2.11` |
| Volt | `volt-v0.1.5` |
| Saturn | `saturn-v0.1.15` |
| Updater | coordinated minimum `updater-v0.4.3`; более новые helper releases требуют отдельной compatibility verification |
| Neptune | `neptune-v0.1.7` для общей Linux release line |
| Gryphon | `gryphon-v0.1.4` |

Версия в этой таблице — контекст документа, а не floating update source. Фактический update определяется signed release discovery и exact pin конкретного service release.

---

## 13. Краткая формула

```text
Owner определяет цели и сохраняет финальный контроль.
Central .docs задаёт общесистемные контракты.
Constitution фиксирует допустимые границы Exocortex.
Kernel публикует документы, ссылки и координаты.
Volt хранит и раскрывает фактические значения только через Kernel broker.
Saturn управляет backup/sync intent и принимает результаты.
Updater выполняет allow-listed привилегированные операции.
Neptune переносит recovery data, Gryphon маршрутизирует Telegram.
Каждый authority владеет только своим доменом.
Topology и UI объясняют состояние, но не подменяют его.
LLM рассуждает и предлагает, но не получает власть над системой.
```
