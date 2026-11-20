# File Organizer CLI

Консольний застосунок на **Node.js (ES Modules)** для аналізу директорій, пошуку дублікатів за SHA-256 хешами, сортування файлів по категоріях та безпечного видалення застарілих даних.

Застосунок побудований на базі вбудованих модулів Node.js (`fs/promises`, `fs`, `path`, `crypto`, `events`, `stream/promises`) без сторонніх залежностей.

---

## Вимоги та встановлення

- **Node.js** версії `18.17.0` або вище (необхідно для `fs.readdir()` з опцією `recursive: true`; перевірено на `v24.x`).

```bash
git clone <url-репозиторію>
cd file-organizer
```

Оскільки проєкт не використовує зовнішніх пакетів, `npm install` не є обов'язковим — CLI готовий до запуску одразу.

---

## Структура проєкту

```text
file-organizer/
├── package.json        # Конфігурація проєкту ("type": "module") та npm-скрипти
├── .gitignore          # Виключення службових файлів із Git
├── README.md           # Документація та приклади використання
├── file-organizer.js   # Точка входу CLI: парсинг аргументів, підписка на події, вивід у консоль
└── lib/
    ├── scanner.js      # Клас Scanner (EventEmitter) — рекурсивне сканування та статистика
    ├── duplicates.js   # Клас DuplicateFinder (EventEmitter) — потоковий SHA-256 пошук дублікатів
    ├── organizer.js    # Клас Organizer (EventEmitter) — сортування файлів, streams для >= 10 MB, конфлікти назв
    ├── cleanup.js      # Клас Cleanup (EventEmitter) — пошук старих файлів, dry run та видалення
    └── utils.js        # Допоміжні функції (formatSize, drawProgressBar, collectFiles, обробка помилок)
```

---

## Архітектура на основі `EventEmitter`

Кожна команда реалізована як окремий клас, що наслідується від `EventEmitter` і містить лише бізнес-логіку (без прямого виводу в консоль):

| Клас | Файл | Основні події |
| :--- | :--- | :--- |
| `Scanner` | `lib/scanner.js` | `scan-start`, `file-found`, `scan-error`, `scan-complete` |
| `DuplicateFinder` | `lib/duplicates.js` | `search-start`, `file-processed`, `hash-error`, `duplicates-found` |
| `Organizer` | `lib/organizer.js` | `organize-start`, `folder-created`, `copy-start`, `copy-complete`, `copy-error`, `organize-complete` |
| `Cleanup` | `lib/cleanup.js` | `cleanup-start`, `file-found`, `delete-start`, `file-deleted`, `cleanup-error`, `cleanup-complete` |

Головний файл `file-organizer.js` підписується на ці події для відображення прогрес-бару (`████░░░░`) та форматованої статистики в реальному часі.

---

## Команди та приклади використання

Запускати команди можна напряму через `node file-organizer.js ...` або через `npm run <command> -- ...`.

### 1. `scan` — аналіз директорії

Рекурсивно сканує директорію та виводить загальну кількість і розмір файлів, групування за розширеннями, розподіл за віком (останні 7 днів, останні 30 днів, старіші за 90 днів), топ-3 найбільших файлів та найстаріший файл.

```bash
node file-organizer.js scan /path/to/directory
# або через npm-скрипт:
npm run scan -- /path/to/directory
```

**Аргументи:**
- `<directory>` — шлях до директорії для аналізу (обов'язковий).

### 2. `duplicates` — пошук дублікатів

Обчислює криптографічний хеш **SHA-256** для кожного файлу через `fs.createReadStream()` (що дозволяє безпечно обробляти великі файли без перевантаження оперативної пам'яті), групує ідентичні файли та підраховує витрачений дисковий простір.

```bash
node file-organizer.js duplicates /path/to/directory
# або:
npm run duplicates -- /path/to/directory
```

**Аргументи:**
- `<directory>` — шлях до директорії для пошуку дублікатів (обов'язковий).

### 3. `organize` — сортування файлів по категоріях

Копіює (без видалення оригіналів) усі файли з вихідної директорії у цільову, розподіляючи їх по папках:
- `Documents`: `.pdf`, `.docx`, `.doc`, `.txt`, `.md`, `.xlsx`, `.pptx`
- `Images`: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp`
- `Archives`: `.zip`, `.rar`, `.tar`, `.gz`, `.7z`
- `Code`: `.js`, `.py`, `.java`, `.cpp`, `.html`, `.css`, `.json`
- `Videos`: `.mp4`, `.avi`, `.mkv`, `.mov`, `.webm`
- `Other`: усі інші розширення

**Технічні особливості:**
- Файли розміром **< 10 MB** копіюються через `fs.copyFile()`.
- Файли розміром **>= 10 MB** копіюються потоково через `stream/promises` (`pipeline(fs.createReadStream(), fs.createWriteStream())`).
- Конфлікти імен вирішуються автоматично додаванням числового суфікса: `file.pdf` -> `file(1).pdf` -> `file(2).pdf`.

```bash
node file-organizer.js organize /source/directory --output /target/directory
# або:
npm run organize -- /source/directory --output /target/directory
```

**Аргументи та опції:**
- `<source>` — вихідна директорія (обов'язковий).
- `--output <target>` (або `-o <target>`) — цільова директорія (обов'язковий).

### 4. `cleanup` — пошук та видалення старих файлів

Знаходить файли, дата останньої модифікації (`mtime`) яких старша за вказану кількість днів. За замовчуванням працює у безпечному режимі **dry run** (лише показує список). Фактичне видалення відбувається лише з прапорцем `--confirm`.

```bash
# Режим попереднього перегляду (dry run — без видалення):
node file-organizer.js cleanup /path/to/directory --older-than 90
npm run cleanup -- /path/to/directory --older-than 90

# Фактичне видалення файлів:
node file-organizer.js cleanup /path/to/directory --older-than 90 --confirm
npm run cleanup -- /path/to/directory --older-than 90 --confirm
```

**Аргументи та опції:**
- `<directory>` — директорія для очищення (обов'язковий).
- `--older-than <days>` — поріг віку файлів у днях (обов'язковий, невід'ємне число).
- `--confirm` — підтвердження фактичного видалення файлів (опціональний).

---

## Обробка помилок

Усі операції з файловою системою обгорнуті у `try...catch`. При критичних помилках (`ENOENT` — шлях не знайдено, `EACCES` — немає прав доступу, `ENOTDIR` — вказано файл замість директорії тощо) виводиться зрозуміле повідомлення в `stderr`, а процес завершується з кодом виходу `1` (`process.exit(1)`).
