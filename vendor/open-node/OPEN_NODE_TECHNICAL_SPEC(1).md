# Open Node — техническое задание

## 1. Статус документа

- **Проект:** Open Node
- **Тип:** самостоятельный open-source framework для нодовых интерфейсов и исполняемых графов
- **Назначение документа:** концепция, архитектурные требования и техническое задание для разработки
- **Основной сценарий использования:** встраивание Open Node в другие продукты
- **Референсный сценарий:** Topology Map внутри Exocortex Kernel
- **Тестовый сценарий:** самостоятельное приложение, запускаемое локально и доступное через `localhost`
- **Целевая платформа v0:** desktop web runtime с возможностью последующего расширения
- **Основной язык реализации:** TypeScript
- **Рекомендуемая лицензия:** MIT или Apache-2.0

---

# 2. Определение

**Open Node** — это открытый универсальный framework для создания нодовых интерфейсов, визуальных схем и исполняемых вычислительных пайплайнов.

Open Node не является только готовым редактором и не должен проектироваться как монолитное конечное приложение. Проект состоит из:

1. независимого ядра данных и исполнения;
2. UI-компонентов бесконечной канвы;
3. SDK для создания нод, типов данных и расширений;
4. API для встраивания;
5. API для машинного управления;
6. референсного standalone-приложения для разработки, тестирования и демонстрации.

Standalone-приложение должно позволять запустить Open Node локально, например:

```text
http://localhost:3000
```

Однако основной производственный сценарий — встраивание framework в другое приложение, web-сервис или desktop shell.

Open Node не содержит заранее заданной предметной логики. Он предоставляет универсальную инфраструктуру, поверх которой можно создавать:

- топологические и архитектурные карты;
- диаграммы зависимостей;
- визуальные инструкции;
- пайплайны обработки данных;
- media pipelines;
- вычислительные графы;
- автоматизации;
- редакторы логики;
- инструменты для нейросетевых систем;
- специализированные нодовые интерфейсы других продуктов.

Краткая формула:

```text
Open Node = Framework Core
          + Infinite Canvas
          + Nodes
          + Containers
          + Groups
          + Connections
          + Type System
          + Execution Runtime
          + Timeline
          + Asset System
          + SDK
          + Embed API
          + Machine API
          + Reference Application
```

---

# 3. Основные принципы

## 3.1 Framework-first

Open Node должен проектироваться прежде всего как framework.

Standalone-приложение является референсной оболочкой над framework и не должно становиться единственным способом его использования.

Ядро, UI и runtime должны подключаться к стороннему продукту как отдельные пакеты.

## 3.2 Универсальность

Framework предоставляет инструменты, но не навязывает смысл элементов.

Семантика конкретных нод, пресетов, типов данных и действий определяется:

- официальными пакетами Open Node;
- сторонними расширениями;
- host-приложением;
- конкретным проектом.

## 3.3 Одна нода — одно действие

Node является атомарным функциональным элементом.

Одна Node Definition должна:

- выполнять одну понятную операцию;
- иметь одну ответственность;
- иметь явно описанные входы и выходы;
- не содержать скрытый сложный пайплайн независимых действий.

Сложные процессы должны собираться из нескольких нод либо оформляться как preset Container.

## 3.4 Разделение представления и исполнения

Canvas и Execution Runtime должны быть независимыми слоями.

Open Node должен полноценно работать как визуальный инструмент даже при отключённом исполнении.

Проект может быть:

- декоративным;
- исполняемым;
- смешанным.

## 3.5 Явная типизация

Вычислительные соединения должны проверяться по типам данных.

Скрытые преобразования допускаются только для заранее определённых безопасных случаев.

## 3.6 Расширяемость

Новые ноды, типы данных, UI-компоненты, execution backends и интеграции должны добавляться через SDK без изменения ядра.

## 3.7 Производительность как свойство архитектуры

Ядро должно изначально учитывать:

- параллельное выполнение независимых ветвей;
- фоновые workers;
- асинхронные операции;
- потоковые данные;
- отмену выполнения;
- кэширование;
- CPU и GPU execution backends;
- работу с тяжёлыми media-данными.

GPU-ускорение не обязано быть полноценно реализовано в v0, но модель нод и runtime не должна препятствовать его добавлению.

## 3.8 Локальность и переносимость

Проект должен сохраняться в файл и открываться без обязательного облачного аккаунта.

Host-приложение может добавить облачное хранение отдельно.

## 3.9 Обратимость

Изменения карты должны поддерживать Undo/Redo.

Импорт, миграции и обновления формата не должны бесследно уничтожать исходные данные.

## 3.10 Machine-ready

Канвой и графом должен иметь возможность управлять не только человек, но и внешняя система:

- программный клиент;
- AI-агент;
- LLM;
- MCP-клиент;
- automation service;
- host-приложение.

Машинное управление должно использовать формальный API и не должно эмулировать действия мыши.

---

# 4. Что не входит в Open Node Core

В базовое ядро не должны входить:

- логика Exocortex или Kernel;
- конкретные сущности сторонних систем;
- авторизация пользователей конкретного продукта;
- облачная синхронизация;
- совместное редактирование в реальном времени;
- готовые интеграции с конкретными внешними API;
- предметная бизнес-логика;
- секреты host-приложения;
- автоматическая установка недоверенного исполняемого кода.

Эти функции могут подключаться через адаптеры и плагины.

---

# 5. Термины

## 5.1 Canvas

Практически бесконечный рабочий холст, на котором размещаются элементы проекта.

## 5.2 Node

Атомарный функциональный элемент, выполняющий одно действие, создающий одно значение либо представляющий один визуальный объект.

## 5.3 Container

Вертикальный упорядоченный контейнер нод.

В вычислительном режиме Container имеет строго один внешний вход и один внешний выход и последовательно обрабатывает значение внутренними нодами сверху вниз.

## 5.4 Group

Декоративная область, объединяющая несколько Node и/или Container в одну визуальную сущность. Group не является вычислительным оператором.

## 5.5 Port

Типизированная точка входа или выхода вычислительного элемента.

## 5.6 Connection

Связь между элементами. Может быть декоративной, data или control.

## 5.7 Node Definition

Кодовое описание типа ноды: идентификатор, версия, параметры, порты, UI, capabilities и функция исполнения.

## 5.8 Node Instance

Конкретный экземпляр Node Definition, размещённый на Canvas или внутри Container.

## 5.9 Preset

Сохранённая конфигурация Node или Container, которую можно повторно добавить в проект.

## 5.10 Project

Полное состояние Open Node проекта: элементы, связи, настройки, зависимости, viewport, timeline, assets и execution settings.

## 5.11 Execution Session

Один жизненный цикл запуска исполняемого графа: постановка задач, выполнение, прогресс, результат, ошибки и отмена.

## 5.12 Timeline

Опциональная временная шкала проекта, которая управляет временем, кадрами и time-aware нодами.

## 5.13 Asset

Импортированный ресурс: изображение, видео, аудио, таблица, документ, 3D-файл или другой поддерживаемый объект.

## 5.14 Host Application

Приложение, в которое встроен Open Node.

## 5.15 Machine API

Формальный интерфейс для программного чтения и изменения проекта без взаимодействия через UI.

---

# 6. Архитектура

## 6.1 Общая схема

```text
Open Node Framework
├─ Graph Model
├─ Command / History Layer
├─ Canvas Runtime
├─ Node Registry
├─ Type Registry
├─ Asset Registry
├─ Connection Validator
├─ Execution Runtime
├─ Parallel Scheduler
├─ CPU Backend
├─ GPU Backend Interface
├─ Timeline Runtime
├─ Preset Library
├─ Project Serializer
├─ Settings Manager
├─ Telemetry Adapter
├─ Embed API
├─ Machine API
├─ Plugin SDK
└─ Reference Application
```

## 6.2 Ключевое разделение

Open Node должен быть разделён минимум на четыре независимых уровня:

```text
Model Layer
Runtime Layer
Presentation Layer
Integration Layer
```

### Model Layer

Источник истины проекта:

- Node;
- Container;
- Group;
- Connection;
- Timeline;
- Asset;
- Settings;
- Dependencies;
- Viewport.

Model Layer не зависит от React, Rete.js или конкретного renderer.

### Runtime Layer

Отвечает за:

- исполнение;
- scheduling;
- кэширование;
- streaming;
- timeline evaluation;
- CPU/GPU dispatch;
- progress;
- cancellation;
- error propagation.

### Presentation Layer

Отвечает за:

- Canvas;
- Node UI;
- библиотеки;
- Inspector;
- minimap;
- timeline UI;
- progress UI;
- dashboard;
- themes.

### Integration Layer

Отвечает за:

- embedding;
- host adapters;
- file system adapters;
- telemetry adapters;
- Machine API;
- MCP adapter;
- standalone shell.

## 6.3 Рекомендуемая структура monorepo

```text
open-node/
├─ apps/
│  ├─ playground/
│  ├─ standalone-web/
│  └─ documentation/
│
├─ packages/
│  ├─ model/
│  ├─ commands/
│  ├─ canvas/
│  ├─ engine/
│  ├─ scheduler/
│  ├─ timeline/
│  ├─ assets/
│  ├─ type-system/
│  ├─ sdk/
│  ├─ ui/
│  ├─ io/
│  ├─ core-nodes/
│  ├─ import-nodes/
│  ├─ embed/
│  ├─ machine-api/
│  ├─ mcp-adapter/
│  └─ telemetry/
│
├─ examples/
├─ docs/
├─ tests/
└─ package.json
```

## 6.4 Рекомендуемый стек

Для первой реализации:

- TypeScript;
- React;
- Vite;
- Rete.js v2 либо иной framework как адаптер canvas/graph UI;
- Zod и/или JSON Schema;
- Zustand либо эквивалент для UI state;
- Web Workers для фонового исполнения;
- WebGPU abstraction как будущий GPU backend;
- Vitest;
- Playwright;
- Storybook для UI-компонентов и Node UI examples.

Критическое требование:

```text
Open Node Project Model != internal format сторонней библиотеки
```

Rete.js или любой другой framework должен быть заменяемым адаптером.

---

# 7. Режимы поставки и запуска

## 7.1 Embedded Mode

Основной режим.

Host-приложение подключает Open Node как framework:

```ts
const instance = createOpenNode({
  container,
  project,
  nodeDefinitions,
  hostAdapters,
  mode: "edit"
});
```

## 7.2 Standalone Mode

Референсное приложение с полным интерфейсом.

Используется для:

- разработки;
- тестирования;
- демонстрации;
- создания проектов вне host-приложения.

В development режиме может запускаться на `localhost`.

## 7.3 Embedded Readonly

Только просмотр, навигация и инспекция.

## 7.4 Headless Runtime

Исполнение проекта без визуального Canvas.

Нужно для:

- серверных workers;
- тестов;
- автоматизаций;
- batch processing;
- запуска через API.

---

# 8. Infinite Canvas

## 8.1 Координатная система

Canvas должен быть практически бесконечным в любом направлении.

Используется world coordinate system:

```text
screen coordinates ↔ viewport transform ↔ world coordinates
```

Все элементы хранят позиции в world coordinates.

Начальная точка мира:

```text
X = 0
Y = 0
```

## 8.2 Перемещение

Обязательные способы pan:

- зажатое колесо мыши + движение;
- `Space` + левая кнопка мыши + движение;
- touchpad pan;
- программный pan через API.

## 8.3 Масштабирование

Обязательные способы zoom:

- колесо мыши;
- touchpad pinch;
- UI-кнопки;
- `Reset Zoom`;
- `Fit All`;
- `Fit Selection`;
- программный zoom через API.

Zoom выполняется относительно курсора.

Рекомендуемый диапазон:

```text
5% — 800%
```

Диапазон настраивается.

## 8.4 Возврат в начало координат

По умолчанию:

```text
Double tap Space → центрировать viewport на X=0, Y=0
```

Команда должна быть переназначаемой.

Должна существовать отдельная API-команда:

```ts
editor.viewport.goToOrigin();
```

## 8.5 Индикаторы координат и масштаба

В интерфейсе постоянно отображаются:

- текущий zoom в процентах;
- текущая world coordinate мыши `X / Y`;
- координаты центра viewport по необходимости.

Пример:

```text
Zoom: 75% | Mouse: X 1240, Y -380
```

## 8.6 Minimap

Minimap обязателен для v0.

Minimap должен:

- показывать упрощённое превью всего проекта;
- показывать текущий viewport;
- учитывать Node, Container и Group;
- позволять кликнуть для перехода;
- позволять перетянуть рамку viewport;
- скрываться через Settings;
- сворачиваться в компактную кнопку.

Minimap не должен отрисовывать тяжёлые preview media в полном качестве.

## 8.7 Фон

Фон поддерживает:

1. сплошной цвет;
2. линейный градиент;
3. радиальный градиент;
4. загруженное изображение;
5. готовые presets.

Настройки изображения:

- `cover`;
- `contain`;
- `stretch`;
- `tile`;
- масштаб;
- прозрачность;
- смещение;
- world/viewport binding.

Режимы:

```text
world
viewport
```

Рекомендуемые presets:

- Light Grid;
- Dark Grid;
- Plain Light;
- Plain Dark;
- Blueprint;
- Paper;
- Transparent.

## 8.8 Сетка

Поддержать:

- enable/disable;
- step;
- color;
- opacity;
- snap to grid;
- temporary snap disable;
- major/minor grid lines.

---

# 9. Темы и визуальный стиль

## 9.1 Дизайн

UI должен быть минималистичным, нейтральным и пригодным для встраивания.

Базовые темы:

```text
Light
Dark
```

## 9.2 Theme API

Host-приложение должно иметь возможность:

- переопределять CSS variables;
- передавать theme tokens;
- менять типографику;
- менять radius, spacing и borders;
- задавать default colors элементов.

## 9.3 Требования

- интерфейс не должен конкурировать с Canvas;
- панели должны сворачиваться;
- цвет не является единственным индикатором состояния;
- поддерживается reduced motion;
- сохраняется достаточный contrast;
- theme preference сохраняется в config.

---

# 10. Node

## 10.1 Назначение

Node — атомарный функциональный элемент.

Примеры:

- создать integer;
- сложить два числа;
- импортировать файл;
- получить текущий кадр видео;
- преобразовать цвет;
- вывести значение.

## 10.2 Размещение

Node может находиться:

- непосредственно на Canvas;
- внутри Container;
- внутри Group;
- внутри Container, находящегося в Group.

Node не может одновременно принадлежать двум Container.

## 10.3 Базовое состояние

```text
id
nodeTypeId
nodeTypeVersion
position
size
label
color
bypassed
parameters
ports
parentContainerId | null
parentGroupId | null
uiState
runtimeHints
```

## 10.4 Порты

По умолчанию шаблон Node может иметь:

```text
1 input
1 output
```

Но Node Definition задаёт произвольное допустимое количество портов.

Примеры:

```text
Integer Constant: 0 input, 1 output
Add:              2 inputs, 1 output
Display:          1 input, 0 output
Branch:           1 control input, 2 control outputs
Import:           0 input, N typed outputs
```

## 10.5 Preview

Node может иметь preview area.

Preview обязателен для импортированных visual/media assets:

- image;
- video;
- audio waveform, если реализовано;
- document thumbnail;
- 3D thumbnail, если доступен renderer.

Preview должен:

- иметь ограничение размера;
- использовать thumbnail/proxy, а не всегда оригинал;
- не блокировать UI;
- обновляться асинхронно;
- отключаться в Settings;
- не сериализовать bitmap напрямую, если asset уже существует отдельно.

## 10.6 Цвет

Каждая Node поддерживает custom color.

## 10.7 Inspector

Inspector показывает:

- type;
- label;
- parameters;
- color;
- bypass;
- ports;
- runtime status;
- progress;
- errors;
- execution backend;
- preview settings;
- version.

## 10.8 Перемещение

При движении:

- connections следуют за element anchors;
- world position обновляется;
- операция агрегируется в одну Undo-команду.

---

# 11. Node Library

## 11.1 Открытие

```text
Tap Left Alt → Node Library
```

Приоритет жестов:

```text
Tap Left Alt                    → Node Library
Hold Left Alt + drag on canvas  → Create Group
Left Alt + Space                → Container Library
```

Все сочетания переназначаются.

## 11.2 Интерфейс

Library содержит:

- search;
- categories;
- display name;
- description;
- input/output types;
- Container compatibility;
- icon;
- recent;
- favorites;
- plugin/source;
- CPU/GPU capability indicator при необходимости.

## 11.3 Drag and Drop

Node можно перетащить:

- на Canvas;
- внутрь Container;
- внутрь Group;
- внутрь Container внутри Group.

Во время drag показываются допустимые drop zones и причина запрета.

## 11.4 Создание новых Node

Новые Node должны добавляться через публичный SDK и автоматически появляться в Library.

---

# 12. Container

## 12.1 Определение

Container — вертикальный упорядоченный контейнер Node.

Визуально это карточка с названием и списком Node сверху вниз.

Единственное предметное поле Container:

```text
name
```

Цвет, position, collapse и bypass являются системными свойствами.

## 12.2 Состав

Container может содержать только Node Instance.

В v0 Container не содержит:

- другой Container;
- Group;
- произвольный canvas content.

## 12.3 Порядок

Пользователь может:

- reorder Node;
- insert в выбранную позицию;
- detach Node на Canvas;
- duplicate;
- delete.

Порядок сверху вниз является порядком serial processing.

## 12.4 Внешние порты

Каждый вычислительный Container строго имеет:

```text
1 input
1 output
```

Внешние computational connections подключаются только к портам Container.

Нельзя подключаться извне непосредственно к внутренней Node.

## 12.5 Исполнение

```text
Container Input
  ↓
Node 1
  ↓
Node 2
  ↓
Node 3
  ↓
Container Output
```

Внутри передаётся `ValueEnvelope`.

Node может быть помещена в Container только если Node Definition объявляет:

```text
containerCompatible = true
```

и предоставляет `containerAdapter`.

## 12.6 Ошибки

Default policy:

```text
stop-on-error
```

Policy должна быть расширяемой в будущем.

## 12.7 Collapse

Container можно свернуть.

В свернутом состоянии:

- внутренние Node скрыты;
- name и ports видны;
- execution продолжается;
- connections сохраняются;
- runtime status виден на header.

## 12.8 Bypass

При bypass:

```text
Container Input → Container Output
```

Внутренние Node не выполняются.

## 12.9 Preset

Container можно сохранить как preset.

Preset содержит:

- name;
- color;
- Node definitions;
- versions;
- order;
- parameters;
- bypass states;
- Container settings.

Не содержит:

- world position;
- runtime cache;
- external connections;
- старые UUID.

## 12.10 Container Library

```text
Left Alt + Space → Container Library
```

Preset можно drag-and-drop на Canvas или внутрь Group.

---

# 13. Group

## 13.1 Определение

Group — декоративная область, объединяющая Node и/или Container.

Group не выполняет вычисления.

## 13.2 Создание

```text
Hold Left Alt + drag on empty canvas
```

## 13.3 Membership

Membership является явным отношением.

Group может содержать:

- Node;
- Container.

Вложенные Group не обязательны для v0.

## 13.4 Размер

Границы редактируются resize handles.

## 13.5 Перемещение

Все элементы внутри перемещаются синхронно.

## 13.6 Название

Name optional.

## 13.7 Цвет

Group поддерживает custom color, opacity и border.

## 13.8 Collapse

При collapse:

- члены визуально скрываются;
- execution продолжается;
- connections остаются логически подключёнными;
- endpoints могут визуально проецироваться на border Group.

## 13.9 Bypass

Group bypass является пакетным override для вычислительных элементов внутри.

До включения сохраняется snapshot исходных bypass states.

## 13.10 Connections

К самой Group подключаются только decorative connections.

---

# 14. Bypass

## 14.1 Node bypass

Node Definition обязана описать bypass strategy:

```text
passthrough
constant
block
unsupported
```

Система не должна угадывать mapping для multi-input Node.

## 14.2 Container bypass

Input напрямую передаётся в Output.

## 14.3 Group bypass

Временный grouped override с восстановлением исходных состояний.

## 14.4 Timeline-aware bypass

Bypass time-aware Node не должен останавливать Timeline целиком.

Node возвращает bypass result либо passthrough в соответствии с definition.

---

# 15. Connections

## 15.1 Виды

```text
decorative
data
control
```

### Decorative

Не участвует в вычислении.

### Data

Передаёт типизированное значение.

### Control

Передаёт trigger/event исполнения.

## 15.2 Направление

Decorative может быть:

- line;
- arrow;
- bidirectional arrow.

Data/Control направленные.

## 15.3 Routing styles

- Straight;
- Bezier;
- Smooth Step;
- Orthogonal / Angular.

Default задаётся в Settings, individual override — в Inspector связи.

## 15.4 Свойства связи

- color;
- thickness;
- opacity;
- dash pattern;
- arrowhead;
- label;
- routing style;
- reroute points.

## 15.5 Tracking

Endpoint хранит:

```text
elementId + portId
```

или для decorative:

```text
elementId + normalizedAnchor
```

## 15.6 Валидация

Проверяются:

- direction;
- type compatibility;
- cardinality;
- duplicate edge policy;
- computational cycle;
- port availability;
- Container restrictions.

---

# 16. Type System

## 16.1 Type Registry

Тип определяется стабильным ID:

```text
namespace.type
```

Примеры:

```text
core.exec
core.boolean
core.integer
core.float
core.string
core.color
core.table
media.image
media.video
media.audio
geometry.mesh
```

## 16.2 Core types v0

```text
core.exec
core.boolean
core.integer
core.float
core.string
core.color
core.vector2
core.vector3
core.list
core.table
core.json
core.binary
core.file
core.any
media.image
media.video
media.audio
```

## 16.3 Расширяемость

Архитектура предусматривает:

```text
list<T>
optional<T>
stream<T>
table<schema>
frame<T>
```

## 16.4 Type families

Для удобства Library типы могут объединяться в family:

- Values;
- Math;
- Logic;
- Text;
- Color;
- Table/Data;
- Media;
- Geometry;
- Control;
- IO;
- AI;
- Custom.

Family является категорией и не заменяет реальную типизацию портов.

## 16.5 Compatibility

Default:

```text
same type → allowed
integer → float → allowed
other mismatch → denied
```

Остальные преобразования выполняются converter Node.

## 16.6 Stream types

Поточные данные должны представляться отдельно от единичных значений:

```text
T
stream<T>
```

Соединение `T → stream<T>` или обратное требует explicit adapter.

---

# 17. Execution Runtime

## 17.1 Назначение

Execution Runtime запускает исполняемые части проекта.

Decorative connections и Group игнорируются runtime.

## 17.2 Run controls

В UI обязателен явный блок исполнения:

- `Run`;
- `Pause`, если поддерживается режимом;
- `Stop`;
- `Cancel`;
- mode selector;
- progress bar.

Кнопка `Run` должна быть заметна и доступна в Top Bar.

## 17.3 Режимы исполнения

Минимальные режимы:

```text
Manual One-shot
Reactive
Continuous / Streaming
Timeline-driven
```

### Manual One-shot

Пайплайн выполняется один раз после нажатия `Run`.

Команды:

- Run All;
- Run Selected;
- Run Downstream;
- Run From Here;
- Fetch Output.

### Reactive

Изменение входа или параметра инвалидирует downstream и запускает перерасчёт.

Side-effect Node не должны автоматически исполняться без explicit permission.

### Continuous / Streaming

Execution Session остаётся активной и обрабатывает поступающие значения постоянно.

Требования:

- start/stop lifecycle;
- backpressure policy;
- bounded queues;
- dropped-frame/drop-value policy;
- stream cancellation;
- health status;
- metrics throughput/latency;
- корректное освобождение ресурсов.

### Timeline-driven

Исполнение зависит от текущего времени или frame Timeline.

Time-aware Node пересчитываются при scrub/playback.

## 17.4 Progress Bar

При запуске показывается общий progress bar.

Он должен отображать:

- progress percent, если его можно определить;
- completed tasks / total tasks;
- indeterminate mode для неизвестной длительности;
- текущую Node или stage;
- elapsed time;
- status: queued/running/success/error/cancelled.

Для Continuous Mode вместо конечного процента показываются:

- running indicator;
- processed items;
- current throughput;
- error count;
- elapsed time.

## 17.5 Статусы элементов

```text
idle
queued
running
success
error
bypassed
cancelled
paused
streaming
```

## 17.6 Dataflow

- demand-driven fetch;
- result caching;
- downstream invalidation;
- async Promise execution;
- AbortSignal cancellation;
- deterministic pure Node where possible.

## 17.7 Control Flow

Для side effects и последовательности:

- trigger;
- branch;
- delay;
- export;
- network request;
- logging.

## 17.8 Hybrid Flow

Node может одновременно иметь data и control ports.

## 17.9 Циклы

В v0 arbitrary computational cycles запрещены.

В будущем controlled feedback допускается через explicit Feedback/Delay Node.

## 17.10 Ошибки

Ошибка содержит:

```text
code
message
nodeId
portId | null
backend
stack | null
timestamp
```

Ошибка одной Node не должна ломать UI process.

---

# 18. Parallel Scheduler и GPU

## 18.1 Общий принцип

Execution Runtime должен строить execution DAG и запускать независимые branches параллельно.

Пример:

```text
       ┌→ Branch A ─┐
Input ─┤            ├→ Merge
       └→ Branch B ─┘
```

Branch A и Branch B могут выполняться одновременно.

## 18.2 Scheduler

Scheduler должен учитывать:

- dependencies;
- resource requirements;
- priority;
- cancellation;
- concurrency limit;
- memory pressure;
- backend availability;
- Node purity;
- side effects.

## 18.3 Execution backends

Архитектура:

```text
Main Thread Backend
Web Worker Backend
Host Worker Backend
Server Worker Backend
GPU Backend Interface
```

Не все backends обязаны быть реализованы в v0.

## 18.4 Node capabilities

Node Definition должна иметь возможность объявить:

```ts
capabilities: {
  cpu?: boolean;
  worker?: boolean;
  gpu?: boolean;
  streaming?: boolean;
  timelineAware?: boolean;
}
```

И resource hints:

```ts
resources?: {
  estimatedMemoryMb?: number;
  preferredBackend?: "main" | "worker" | "gpu" | "host";
  parallelSafe?: boolean;
  maxConcurrency?: number;
}
```

## 18.5 GPU Backend

GPU execution должен быть adapter-based.

Возможные реализации в будущем:

- WebGPU;
- native host GPU bridge;
- CUDA worker service;
- Metal/Vulkan host adapter;
- remote GPU service.

Node не должна напрямую зависеть от одного vendor API.

## 18.6 Fallback

Node Definition может объявлять:

```text
GPU preferred, CPU fallback
GPU required
CPU only
```

Если backend недоступен:

- использовать fallback;
- либо показать formal error;
- не зависать молча.

## 18.7 UI responsiveness

Тяжёлые операции не должны блокировать Canvas UI.

Минимум:

- heavy execution вне UI thread;
- throttled status updates;
- cancellation;
- resource cleanup.

---

# 19. Timeline

## 19.1 Общий принцип

Timeline является опциональной частью проекта.

Проект может включать или отключать Timeline.

## 19.2 UI

Timeline располагается в нижней части интерфейса и может сворачиваться.

Минимальные элементы:

- current time;
- current frame;
- play;
- pause;
- stop;
- step forward/backward;
- scrubber;
- duration;
- start/end range;
- loop;
- FPS;
- playback speed.

## 19.3 Настройки

```text
enabled
fps
duration
startTime
endTime
loop
playbackRate
timeUnit
```

## 19.4 Time-aware Node

Node может объявить:

```text
timelineAware = true
```

Она получает в execution context:

```ts
{
  timeSeconds: number;
  frame: number;
  fps: number;
  deltaTime: number;
  playbackState: "stopped" | "playing" | "paused" | "scrubbing";
}
```

## 19.5 Media playback

Если в проект импортированы два видео отдельными Import Node, их preview/playback должны синхронно обновляться при движении Timeline.

Пример:

```text
Video Import A ─→ Preview A
Video Import B ─→ Preview B

Timeline frame 120
→ обе Node показывают frame 120 в своём media time mapping
```

При разном FPS используется project timeline time, а конкретная Node сама вычисляет source frame.

## 19.6 Scrubbing

При перетаскивании playhead:

- time-aware previews обновляются;
- дорогое вычисление может использовать preview quality;
- устаревшие requests отменяются;
- UI не блокируется.

## 19.7 Timeline execution

Должны поддерживаться:

- evaluate current frame;
- play in realtime;
- render frame range;
- execute on frame change;
- execute only marked output nodes.

Полный offline render может быть будущим этапом, но модель должна быть заложена.

## 19.8 Serialization

Timeline settings и current editor state сохраняются в Project.

Опционально current playhead может не влиять на semantic result и храниться как UI state.

---

# 20. Asset System и Universal Import Node

## 20.1 Назначение

Open Node должен иметь универсальную систему импорта файлов.

Базовый элемент:

```text
Universal Import Node
```

Эта Node принимает файл или reference и определяет его тип.

## 20.2 Определение типа

Тип определяется по комбинации:

1. MIME type;
2. magic bytes/signature;
3. file extension;
4. optional parser probe.

Нельзя полагаться только на extension.

## 20.3 Категории файлов

Архитектура должна поддерживать расширяемый список.

Базовая поддержка/распознавание:

### Images

- PNG;
- JPEG;
- WebP;
- GIF;
- SVG;
- BMP;
- TIFF, если decoder доступен;
- HDR/EXR через plugin.

### Video

- MP4;
- WebM;
- MOV при наличии decoder;
- MKV через host/plugin;
- image sequences через отдельный adapter.

### Audio

- WAV;
- MP3;
- OGG;
- FLAC при наличии decoder;
- AAC/M4A при наличии decoder.

### Data

- JSON;
- YAML;
- CSV;
- TSV;
- TXT;
- Markdown;
- XML;
- binary.

### Documents

- PDF preview/metadata;
- office formats через plugin/host adapter.

### Geometry / 3D

- glTF/GLB;
- OBJ;
- FBX через plugin;
- STL;
- PLY.

### Archives

- ZIP metadata/import policy;
- другие архивы через plugin.

Поддержка конкретного decoder зависит от runtime и host application.

## 20.4 Outputs Universal Import Node

Node должна иметь dynamic typed outputs.

Примеры:

```text
file
metadata
image
video
audio
text
table
json
binary
```

После распознавания активируются релевантные outputs.

## 20.5 Preview

На самой Import Node отображается preview:

- image thumbnail;
- video frame;
- audio waveform/metadata;
- text excerpt;
- table preview;
- PDF thumbnail;
- 3D thumbnail при renderer.

## 20.6 Asset references

Asset может храниться:

```text
embedded
external local reference
remote reference
host-managed reference
```

Project должен явно фиксировать storage mode.

## 20.7 Missing assets

Если asset недоступен:

- Node сохраняется;
- показывается Missing Asset;
- original reference не удаляется;
- пользователь может relink.

## 20.8 Security

- MIME validation;
- size limits;
- archive bomb protection;
- no automatic script execution;
- SVG sanitization;
- URL permission policy;
- no implicit upload to external service.

---

# 21. Базовые Node v0

## 21.1 Values

- Text;
- Integer;
- Float;
- Boolean;
- Color;
- Table;
- JSON;
- File Reference.

## 21.2 Math

- Add;
- Subtract;
- Multiply;
- Divide.

## 21.3 Conversion

- Integer to Float;
- To String;
- Parse Number;
- Table to JSON;
- JSON to Table, если schema допустима.

## 21.4 Import / Media

- Universal Import;
- Image Preview;
- Video Preview;
- Audio Preview;
- Current Timeline Time;
- Current Timeline Frame.

## 21.5 Output

- Display;
- Log;
- Export File, как side-effect Node;
- Media Preview.

---

# 22. Создание новых Node через SDK

## 22.1 Node Definition

```ts
export interface NodeDefinition<Params = unknown> {
  typeId: string;
  version: string;
  displayName: string;
  description?: string;
  category: string;
  tags?: string[];
  defaultColor?: string;
  icon?: string;

  inputs: PortDefinition[];
  outputs: PortDefinition[];
  parameters: ParameterDefinition[];

  pure: boolean;
  containerCompatible?: boolean;
  bypass?: BypassDefinition;

  capabilities?: {
    cpu?: boolean;
    worker?: boolean;
    gpu?: boolean;
    streaming?: boolean;
    timelineAware?: boolean;
    preview?: boolean;
  };

  resources?: {
    estimatedMemoryMb?: number;
    preferredBackend?: "main" | "worker" | "gpu" | "host";
    parallelSafe?: boolean;
    maxConcurrency?: number;
  };

  createDefaultParams(): Params;
  validate(params: Params): ValidationResult;

  execute?(context: ExecuteContext<Params>): Promise<NodeExecutionResult>;
  executeStream?(context: StreamExecuteContext<Params>): AsyncIterable<NodeStreamResult>;
  containerAdapter?(context: ContainerExecuteContext<Params>): Promise<ValueEnvelope>;
  renderPreview?(context: PreviewContext<Params>): Promise<PreviewResult>;
  migrate?(oldVersion: string, state: unknown): unknown;
}
```

## 22.2 Регистрация

```ts
openNode.registerNode(definition);
```

## 22.3 ID

```text
publisher.package.node
```

## 22.4 Версионирование

Semantic Versioning.

Project хранит конкретные dependency versions.

## 22.5 Migration

При несовместимости:

- original Project не перезаписывается;
- Node становится `Unresolved Node`;
- raw state сохраняется.

## 22.6 UI controls

Core предоставляет:

- text;
- number;
- toggle;
- select;
- color picker;
- table editor;
- file picker;
- button;
- readonly value;
- preview surface.

## 22.7 Plugin permissions

Future permission manifest:

```text
network
filesystem
clipboard
camera
microphone
gpu
worker
host-api
```

Project file не содержит plugin executable code.

---

# 23. Machine API и MCP

## 23.1 Назначение

Open Node должен предоставлять формальный API для внешних программ и AI-систем.

## 23.2 Возможные transports

Framework должен поддерживать адаптерную модель:

- in-process TypeScript API;
- JSON-RPC;
- REST;
- WebSocket;
- MCP server adapter;
- host message bridge.

Не обязательно реализовывать все transports в v0, но command model должна быть общей.

## 23.3 Machine operations

Минимальные операции:

- получить metadata проекта;
- получить список Node/Container/Group;
- получить connections;
- получить selected elements;
- найти элементы по ID/type/name/tag;
- создать Node;
- создать Container;
- создать Group;
- переместить/resize element;
- изменить parameters;
- создать/delete connection;
- set bypass;
- load/save/export Project;
- fit viewport;
- set timeline time/frame;
- run/pause/stop pipeline;
- получить progress;
- получить execution result/errors;
- получить screenshot/preview, если разрешено host.

## 23.4 Command transactions

Машинные изменения должны выполняться транзакционно.

Пример:

```ts
const tx = api.beginTransaction();
tx.createNode(...);
tx.createNode(...);
tx.connect(...);
await tx.commit();
```

При ошибке изменения откатываются.

## 23.5 Permissions

Machine API не должен быть публично открыт по умолчанию.

Host Application определяет:

- auth;
- read/write permissions;
- allowed Node types;
- execution permissions;
- filesystem/network permissions.

## 23.6 MCP

MCP adapter может предоставлять tools:

```text
open_project
inspect_graph
search_nodes
create_node
connect_nodes
set_parameter
run_pipeline
stop_pipeline
get_execution_status
set_timeline_frame
export_project
```

MCP является адаптером поверх Machine API, а не отдельным источником истины.

---

# 24. Settings и Hotkeys

## 24.1 Hotkeys

Все основные команды переназначаются.

Минимальный список:

- Open Node Library;
- Open Container Library;
- Create Group;
- Pan;
- Delete;
- Duplicate;
- Copy/Paste;
- Undo/Redo;
- Bypass;
- Collapse;
- Run;
- Pause;
- Stop;
- Fit All;
- Fit Selection;
- Go To Origin;
- Toggle Minimap;
- Toggle Timeline;
- Toggle Grid;
- Toggle Snapping.

## 24.2 Defaults

```text
Tap Left Alt                   Node Library
Left Alt + Space               Container Library
Hold Left Alt + drag           Create Group
Middle Mouse + drag            Pan
Space + Left Mouse + drag      Pan
Double tap Space               Go To Origin
Delete                         Delete selection
Ctrl/Cmd + Z                   Undo
Ctrl/Cmd + Shift + Z           Redo
Ctrl/Cmd + D                   Duplicate
B                              Toggle bypass
```

## 24.3 Conflict detection

Settings должна обнаруживать duplicate/system conflicts и позволять reset defaults.

## 24.4 Другие настройки

- theme;
- background;
- connection default;
- element colors;
- zoom range;
- grid;
- snapping;
- execution mode;
- concurrency;
- preferred backend;
- autosave;
- reduced motion;
- interface scale;
- minimap visibility;
- timeline visibility;
- preview quality;
- telemetry/dashboard visibility.

## 24.5 Export Config

Пользователь должен иметь возможность выгрузить актуальные настройки системы в config file.

Рекомендуемый формат:

```text
open-node.config.json
```

Config содержит:

- UI preferences;
- theme;
- hotkeys;
- canvas defaults;
- connection defaults;
- execution defaults;
- concurrency limits;
- timeline defaults;
- preview settings;
- enabled feature flags.

Config не должен содержать секреты и project-specific assets.

Поддержать:

- Export Config;
- Import Config;
- Validate Config;
- Reset to Defaults;
- merge/replace import mode.

---

# 25. Presets

## 25.1 Node Preset

Сохраняет parameters/color/UI state без старого instance ID.

## 25.2 Container Preset

Сохраняет сформированный последовательный набор Node.

## 25.3 Хранение

- user library;
- Project;
- plugin package;
- host-managed library.

---

# 26. Selection, Copy/Paste, History

## 26.1 Selection

- click;
- multi-select;
- marquee;
- select all;
- connected;
- downstream;
- upstream.

## 26.2 Copy/Paste

Сохраняются выбранные элементы и внутренние connections.

Внешние connections не копируются.

## 26.3 Undo/Redo

Через Command Layer.

Обязательные operations:

- create/delete;
- move/resize;
- parameter change;
- color;
- connection;
- reorder Container;
- Group membership;
- collapse;
- bypass;
- timeline settings;
- import;
- config changes, если они project-scoped.

---

# 27. Project Format

## 27.1 Канонический формат

```text
*.onode.json
```

Для assets:

```text
*.onode
```

ZIP package.

## 27.2 Верхний уровень

```json
{
  "format": "open-node-project",
  "schemaVersion": "1.0.0",
  "createdWith": "0.1.0",
  "metadata": {},
  "dependencies": [],
  "settings": {},
  "execution": {},
  "timeline": {},
  "viewport": {},
  "background": {},
  "nodes": [],
  "containers": [],
  "groups": [],
  "connections": [],
  "presets": [],
  "assets": []
}
```

## 27.3 Execution settings

```json
{
  "mode": "manual",
  "concurrency": 4,
  "preferredBackend": "auto",
  "cacheEnabled": true
}
```

## 27.4 Timeline settings

```json
{
  "enabled": true,
  "fps": 30,
  "durationSeconds": 60,
  "startTime": 0,
  "endTime": 60,
  "loop": false,
  "playbackRate": 1
}
```

## 27.5 Dependencies

Package ID, version, integrity, required.

Missing plugin → `Unresolved Node`, raw state preserved.

## 27.6 Assets

```text
project.onode/
├─ project.json
├─ dependencies.lock.json
└─ assets/
```

## 27.7 Save State

Сохраняются:

- background;
- viewport;
- grid;
- snapping;
- theme/project style;
- Nodes;
- Containers;
- Groups;
- Connections;
- collapse;
- bypass;
- Timeline;
- execution defaults;
- assets;
- dependencies;
- presets.

## 27.8 Autosave

- local autosave;
- crash recovery;
- Save As;
- unsaved indicator.

## 27.9 Import validation

1. syntax;
2. schemaVersion;
3. schema;
4. IDs;
5. parent relationships;
6. dependencies;
7. connections;
8. assets;
9. migration plan;
10. transactional load.

---

# 28. UI/UX

## 28.1 Основная компоновка

```text
┌────────────────────────────────────────────────────────────────────┐
│ File | Edit | View | Run ▼ | ▶ Run | Stop | Mode | Settings       │
├───────────────┬────────────────────────────────────────────────────┤
│ Optional      │                                                    │
│ Library /     │                 Infinite Canvas                    │
│ Inspector     │                                                    │
│               │                                      ┌──────────┐  │
│               │                                      │ Minimap  │  │
│               │                                      └──────────┘  │
│               │                                      ┌──────────┐  │
│               │                                      │ CPU/GPU  │  │
│               │                                      │ RAM/Disk │  │
│               │                                      └──────────┘  │
├───────────────┴────────────────────────────────────────────────────┤
│ Timeline (optional)                                                │
├────────────────────────────────────────────────────────────────────┤
│ Progress | Status | Zoom | Mouse X/Y | Errors | Save state         │
└────────────────────────────────────────────────────────────────────┘
```

## 28.2 Run UI

Top Bar содержит:

- Run button;
- Run mode selector;
- Stop/Cancel;
- execution status.

## 28.3 Progress

Progress bar располагается в нижней status area или возле Run controls.

## 28.4 Context menus

Canvas:

- Add Node;
- Add Container;
- Paste;
- Create Group;
- Fit All;
- Go To Origin;
- Background Settings.

Node:

- Run Node;
- Run Downstream;
- Bypass;
- Duplicate;
- Save Preset;
- Disconnect;
- Delete;
- Inspect.

Container:

- Run Container;
- Collapse;
- Bypass;
- Save Preset;
- Rename;
- Delete.

Group:

- Collapse;
- Bypass Children;
- Rename;
- Recalculate Members;
- Delete Group Only;
- Delete Group and Contents.

## 28.5 Dashboard

В углу Canvas отображается компактный dashboard:

- RAM usage;
- CPU usage;
- GPU usage;
- Disk space usage.

Dashboard должен быть:

- сворачиваемым;
- отключаемым;
- обновляться с ограниченной частотой;
- не влиять заметно на производительность.

Важно: чистое web-приложение не всегда имеет доступ к точным system metrics.

Поэтому telemetry получает данные через adapter:

```text
Browser Approximation Adapter
Host Application Adapter
Local Agent Adapter
Server Adapter
```

Если метрика недоступна, отображается:

```text
N/A
```

Нельзя подменять отсутствующие данные выдуманными значениями.

## 28.6 Accessibility

- keyboard alternatives;
- focus states;
- contrast;
- reduced motion;
- screen-reader labels для основных controls;
- interface zoom отдельно от Canvas zoom.

---

# 29. Embed API

## 29.1 Пример

```ts
const editor = createOpenNode({
  container,
  mode: "edit",
  project,
  nodeDefinitions,
  adapters: {
    assets,
    telemetry,
    execution,
    machineApi
  }
});

editor.load(project);
editor.serialize();
editor.run({ mode: "manual" });
editor.timeline.setFrame(120);
editor.viewport.fitAll();
editor.destroy();
```

## 29.2 Modes

```text
standalone
embedded-edit
embedded-readonly
headless
```

## 29.3 Events

```text
projectChanged
selectionChanged
nodeCreated
nodeDeleted
connectionCreated
connectionRejected
executionStarted
executionProgress
executionFinished
executionFailed
executionCancelled
timelineChanged
assetImported
saveRequested
```

---

# 30. Безопасность

## 30.1 Project files

- no eval;
- no executable code in JSON;
- string escaping;
- HTML sanitization;
- MIME validation;
- ZIP path traversal protection;
- decompression bomb protection;
- unknown Node raw data preservation.

## 30.2 Plugins

v0:

- trusted bundled/build-time plugins;
- no dynamic arbitrary code from Project;
- explicit package ID/version.

## 30.3 Execution

- no eval;
- cancellation;
- timeout policy;
- worker isolation;
- side-effect permissions;
- host controls filesystem/network access;
- GPU resources released after execution.

## 30.4 Machine API

- disabled by default outside in-process API;
- authentication for remote transports;
- authorization scopes;
- audit hooks;
- rate limits;
- transaction limits.

## 30.5 Assets

- safe decoders;
- SVG sanitization;
- size limits;
- no automatic script/macros;
- remote URL policy.

---

# 31. Производительность

## 31.1 Canvas

- viewport culling;
- render memoization;
- batched updates;
- transaction drag;
- connection path caching;
- pointer throttling;
- lazy controls;
- low-resolution minimap model;
- thumbnail previews.

## 31.2 Runtime

- DAG scheduling;
- parallel independent branches;
- Web Workers;
- async execution;
- cache;
- downstream invalidation;
- streaming queues;
- cancellation;
- backend adapters;
- GPU interface.

## 31.3 Media

- proxy thumbnails;
- frame request cancellation;
- preview quality levels;
- lazy decode;
- host decoder adapter;
- no full media decode in UI thread.

## 31.4 Target benchmark v0

На зафиксированной reference desktop machine:

- 500 видимых элементов;
- 1 000 connections;
- smooth pan/zoom;
- обычное UI action не блокирует main thread более 50 ms;
- project open/save остаётся стабильным.

Stress test:

- 1 000 elements;
- 2 000 connections;
- проект открывается и редактируется.

## 31.5 Execution benchmark

Должны существовать отдельные benchmarks:

- serial CPU graph;
- parallel CPU graph;
- worker graph;
- streaming graph;
- media timeline scrub;
- future GPU benchmark.

---

# 32. Документация

Подробная документация является обязательной частью проекта, а не отдельной задачей после разработки.

## 32.1 Разделы документации

```text
Getting Started
Architecture
Embedding Guide
Standalone Guide
Node SDK
Type System
Execution Runtime
Parallel Scheduler
Timeline
Asset System
Universal Import Node
Machine API
MCP Adapter
Project Format
Plugin Development
Security Model
Performance Guide
Migration Guide
API Reference
Examples
```

## 32.2 Требования

Документация должна включать:

- install instructions;
- localhost playground launch;
- embedding example;
- custom Node tutorial;
- custom Type tutorial;
- custom execution backend example;
- Timeline-aware Node example;
- Universal Import extension example;
- Machine API example;
- MCP example;
- Project JSON schema;
- version migration rules;
- troubleshooting.

## 32.3 Documentation as code

Документация хранится в репозитории, версионируется и проверяется CI.

Code examples должны проходить type-check/build test.

## 32.4 Examples

Обязательные example projects:

1. decorative architecture map;
2. simple math pipeline;
3. Container serial processor;
4. streaming counter/log pipeline;
5. two-video timeline preview;
6. image import and processing;
7. embedded readonly map;
8. Machine API graph creation.

---

# 33. Логирование и диагностика

Developer Mode показывает:

- schema version;
- dependencies;
- unresolved Node;
- validation errors;
- execution timings;
- scheduler queue;
- backend selection;
- CPU/GPU dispatch;
- cache hits;
- stream metrics;
- render performance;
- migration report;
- asset decoder status.

Обычный пользователь видит только полезные сообщения.

---

# 34. Тестирование

## 34.1 Unit

- type compatibility;
- cycle detection;
- serialization;
- migration;
- bypass;
- Container execution;
- Group membership;
- command history;
- timeline frame calculation;
- asset type detection;
- scheduler dependencies;
- progress aggregation;
- config validation.

## 34.2 Integration

- drag Node;
- drag в Container;
- reorder;
- collapse;
- Group move;
- connections tracking;
- save/load;
- missing plugin;
- invalid file;
- hotkey conflict;
- Run/Cancel;
- Continuous Mode start/stop;
- Timeline scrub;
- two video previews;
- minimap navigation;
- config export/import;
- Machine API transaction.

## 34.3 End-to-end

- create executable pipeline;
- press Run;
- see progress;
- get result;
- save project;
- reload;
- restore state;
- open in embedded mode;
- operate through API;
- import image/video and see preview.

## 34.4 Golden projects

Хранить проекты предыдущих schema versions и проверять migration без потери данных.

---

# 35. Этапы разработки

## Stage 0 — Contracts

Результат:

- Graph Model;
- schemas;
- Node SDK draft;
- Type Registry;
- Project Schema;
- execution contracts;
- timeline contracts;
- asset contracts;
- Machine API command model;
- ADR.

Checkpoint: project программно создаётся, сохраняется и загружается без UI.

## Stage 1 — Canvas Foundation

- infinite canvas;
- pan/zoom;
- background;
- grid;
- selection;
- coordinates;
- zoom indicator;
- origin command;
- minimap;
- Undo/Redo base;
- Light/Dark themes.

Checkpoint: 500 dummy elements smooth navigation.

## Stage 2 — Node and Library

- Node renderer;
- ports;
- Inspector;
- Library;
- search;
- drag/drop;
- core values;
- preview surface base.

## Stage 3 — Connections

- decorative/data/control;
- routing styles;
- typed validation;
- reroute points;
- connection Inspector.

## Stage 4 — Container

- Container UI;
- reorder;
- input/output;
- adapters;
- collapse;
- bypass;
- presets;
- Container Library.

## Stage 5 — Group

- Alt+drag;
- membership;
- resize;
- move;
- collapse;
- bypass snapshot.

## Stage 6 — Execution v0

- Run button;
- Manual Mode;
- Dataflow;
- Control flow base;
- statuses;
- errors;
- progress bar;
- cancellation;
- cycle prevention.

## Stage 7 — Scheduler

- parallel branches;
- Web Worker backend;
- resource hints;
- concurrency settings;
- backend interface;
- GPU abstraction contract.

## Stage 8 — Timeline

- optional Timeline UI;
- FPS;
- playback;
- scrub;
- time-aware Node;
- video preview synchronization.

## Stage 9 — Assets

- Asset Registry;
- Universal Import Node;
- image/video/text/table detection;
- previews;
- relink;
- package assets.

## Stage 10 — Persistence and Settings

- `.onode.json`;
- `.onode`;
- autosave;
- crash recovery;
- hotkeys;
- config export/import;
- validation;
- migration.

## Stage 11 — Streaming

- Continuous Mode;
- queues;
- backpressure;
- stream status;
- metrics;
- start/stop lifecycle.

## Stage 12 — Embed and Machine API

- public Embed API;
- readonly;
- headless;
- Machine API;
- MCP adapter prototype;
- Kernel integration example.

## Stage 13 — Documentation and Release

- docs site;
- tutorials;
- API reference;
- examples;
- benchmark docs;
- release packaging.

---

# 36. Acceptance Criteria v0

Open Node v0 считается готовым, если:

1. Framework может быть встроен в стороннее web-приложение.
2. Есть standalone reference app на localhost.
3. Model Layer не зависит от UI framework.
4. Есть infinite Canvas.
5. Pan работает через middle mouse и `Space + drag`.
6. Zoom выполняется относительно курсора.
7. Отображается текущий zoom.
8. Отображаются текущие world coordinates мыши.
9. Double tap Space возвращает viewport к `0,0`.
10. Есть Minimap с viewport navigation.
11. Фон поддерживает color, gradient, image и presets.
12. Есть Light и Dark themes.
13. Node создаются из Library через `Left Alt`.
14. Library имеет search.
15. Node можно drag-and-drop на Canvas и в Container.
16. Node поддерживает custom color.
17. Есть SDK создания новых Node.
18. Node может иметь preview.
19. Imported image/video показывает preview на Import Node.
20. Сущность `Container` используется единообразно во всей модели, SDK, API и формате проекта.
21. Container содержит вертикально упорядоченные Node.
22. Container имеет один input и один output.
23. Node внутри Container можно reorder.
24. Container сохраняется как preset.
25. Container Library открывается hotkey.
26. Container поддерживает color, collapse и bypass.
27. Group создаётся `Left Alt + drag`.
28. Group перемещает членов синхронно.
29. Group поддерживает optional name, color, collapse и bypass children.
30. Есть decorative, data и control connections.
31. Connections следуют за elements.
32. Есть Straight, Bezier, Smooth Step и Orthogonal routing.
33. Type Registry работает.
34. Несовместимые ports нельзя соединить.
35. Есть базовые Value/Math/Conversion Node.
36. Есть Universal Import Node.
37. Universal Import определяет тип не только по extension.
38. Есть явная Run button.
39. Есть Manual One-shot execution.
40. Есть progress bar.
41. Есть Stop/Cancel.
42. Есть statuses Node и Container.
43. Независимые branches могут выполняться параллельно.
44. Heavy execution может выполняться вне UI thread.
45. В Node Definition заложены CPU/worker/GPU capabilities.
46. GPU backend имеет стабильный abstraction interface.
47. Есть Reactive Mode либо его production-ready foundation.
48. Есть Continuous/Streaming Mode либо минимально рабочая реализация для core stream example.
49. Есть опциональная Timeline.
50. Timeline имеет FPS, play, pause, stop, scrub и loop.
51. Два импортированных видео синхронно обновляют preview от Timeline.
52. Project сохраняется в `.onode.json`.
53. Assets могут упаковываться в `.onode`.
54. Project хранит Containers, Timeline и execution settings.
55. Missing plugin не уничтожает raw Node state.
56. Hotkeys переназначаются.
57. Settings экспортируются в config.
58. Config можно импортировать и валидировать.
59. Есть компактный resource dashboard: RAM, CPU, GPU, Disk.
60. Недоступные metrics честно отображаются как `N/A`.
61. Есть Embed API.
62. Есть Machine API command model.
63. Внешняя система может программно создавать и соединять Node.
64. Внешняя система может запускать и останавливать pipeline.
65. Есть MCP adapter design и хотя бы reference implementation/prototype.
66. Работает Undo/Redo.
67. Есть unit, integration и E2E tests.
68. Есть полная документация framework и SDK.
69. Есть example integration в Kernel.
70. Open Node не содержит предметной логики Exocortex в Core.

---

# 37. Зафиксированные архитектурные решения

1. Open Node — framework, а не только редактор.
2. Standalone app является reference shell.
3. Основной сценарий — embedding.
4. Node — атомарная операция.
5. Container — serial processor с одним входом и выходом.
6. Group — декоративная сущность.
7. Canvas и Execution Runtime независимы.
8. Decorative и computational connections различаются.
9. Computational connections типизированы.
10. Type System расширяется через registry.
11. Convert operations преимущественно явные.
12. Есть явная Run button и Execution Session.
13. Поддерживаются Manual, Reactive, Continuous и Timeline-driven modes.
14. Runtime строится с учётом parallel execution.
15. GPU представлен через заменяемый backend interface.
16. Timeline является опциональной частью Project.
17. Universal Import Node использует MIME, signature и extension.
18. Imported visual assets имеют preview на Node.
19. Minimap обязателен.
20. Zoom и mouse coordinates отображаются постоянно.
21. Double tap Space возвращает viewport к origin.
22. Resource dashboard использует adapter и не выдумывает недоступные metrics.
23. Настройки экспортируются отдельно от Project.
24. Machine API является частью framework architecture.
25. MCP является адаптером поверх Machine API.
26. Собственная Open Node Project Model является источником истины.
27. Project file не содержит исполняемый plugin code.
28. В v0 plugins являются trusted dependencies.
29. Arbitrary computational cycles в v0 запрещены.
30. Документация является частью Definition of Done.

---

# 38. Краткое определение результата

После выполнения ТЗ должен получиться универсальный open-source framework для нодовых интерфейсов, а не демонстрационный Canvas и не узкоспециализированное приложение.

Open Node должен позволять:

- встраивать нодовый интерфейс в другие продукты;
- запускать reference application локально;
- строить декоративные карты;
- создавать типизированные вычислительные пайплайны;
- запускать пайплайны вручную, реактивно, поточно и по Timeline;
- выполнять независимые branches параллельно;
- подключать CPU, worker и будущие GPU backends;
- импортировать широкий набор файлов через Universal Import Node;
- показывать previews изображений и видео;
- сохранять проекты и assets;
- экспортировать настройки;
- управлять проектом через API и MCP;
- расширять систему через SDK;
- использовать Open Node как основу Topology Map внутри Kernel без добавления Exocortex-логики в Core.
