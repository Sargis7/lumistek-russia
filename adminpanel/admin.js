/**
 * ============================================================================
 *  LUMISTEK — АДМИН-ПАНЕЛЬ
 * ============================================================================
 *
 *  Скрытая страница для правки сайта БЕЗ кода.
 *  Адрес:  https://<сайт>/adminpanel/
 *
 *  КАК ЭТО РАБОТАЕТ (коротко):
 *  Панель сохраняет изменения прямо в репозиторий GitHub через их API.
 *  После сохранения Railway сам пересобирает сайт (1-2 минуты),
 *  и правки видят все посетители.
 *
 *  ПАРОЛЬ ПО УМОЛЧАНИЮ:  lumistek2026
 *  Он хранится здесь в виде SHA-256-хэша (см. PASS_HASH ниже).
 *  Чтобы поменять пароль: откройте любую страницу сайта, нажмите F12
 *  (вкладка Console) и выполните:
 *      crypto.subtle.digest('SHA-256', new TextEncoder().encode('НОВЫЙ_ПАРОЛЬ'))
 *        .then(function (b) { console.log([].map.call(new Uint8Array(b),
 *            function (x) { return ('0' + x.toString(16)).slice(-2); }).join('')); });
 *  Полученную строку вставьте в PASS_HASH.
 *
 *  ЧЕСТНО О ЗАЩИТЕ: это НЕ настоящая защита, а просто заслонка от
 *  случайных посетителей. Страница статическая, поэтому тот, кто
 *  откроет исходный код, увидит и хэш пароля, и токен GitHub в
 *  localStorage. Не публикуйте адрес панели и не давайте токен никому.
 *  Для настоящей защиты нужен сервер — его у сайта нет.
 *
 * ============================================================================
 */

(function () {
    'use strict';

    /* ========================================================================
     *  0. КОНСТАНТЫ
     * ====================================================================== */

    /*
     * SHA-256 от пароля 'lumistek2026'.
     * Это ЗАВОДСКОЙ пароль — обязательно поменяйте его (инструкция выше).
     */
    var PASS_HASH = '1a0c84dbc63bb652b7f83b952128cbefd0d3a91402e9b8899150fedcff28ff7f';

    var SS_AUTH = 'lum_admin_ok';
    var LS_SETTINGS = 'lumistek_admin_settings_v1';

    var DEFAULT_SETTINGS = {
        owner: 'Sargis7',
        repo: 'lumistek-russia',
        branch: 'main',
        token: ''
    };

    var PATHS = {
        catalog: 'assets/js/catalog.js',
        gallery: 'assets/js/gallery.js',
        config: 'assets/js/config.js',
        news: 'news.json',
        galleryDir: 'img/gallery/',
        productDir: 'img/products/'
    };

    var MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024;   /* 1.5 МБ — предупреждаем */
    var MAX_IMAGE_EDGE = 1600;                  /* длинная сторона после сжатия */
    var JPEG_QUALITY = 0.85;

    var BADGES = [
        { key: 'brand-cyan', title: 'Голубая', css: '#1cb0c6' },
        { key: 'brand-pink', title: 'Розовая', css: '#f2668b' },
        { key: 'brand-blue', title: 'Синяя', css: '#1b75bc' }
    ];

    /* ========================================================================
     *  1. ЧИСТЫЕ ФУНКЦИИ РАБОТЫ С ТЕКСТОМ
     *
     *  ВАЖНО: этот раздел не трогает DOM и сеть.
     *  Его проверяет офлайн-тест (см. module.exports в самом низу файла).
     * ====================================================================== */

    /* ---- 1.1 Base64 с поддержкой кириллицы -------------------------------- */

    function b64encode(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }

    function b64decode(b64) {
        return decodeURIComponent(escape(atob(String(b64).replace(/\s/g, ''))));
    }

    /* ---- 1.2 Транслитерация и slug ---------------------------------------- */

    var TRANSLIT = {
        'а': 'a',  'б': 'b',  'в': 'v',  'г': 'g',  'д': 'd',  'е': 'e',
        'ё': 'e',  'ж': 'zh', 'з': 'z',  'и': 'i',  'й': 'y',  'к': 'k',
        'л': 'l',  'м': 'm',  'н': 'n',  'о': 'o',  'п': 'p',  'р': 'r',
        'с': 's',  'т': 't',  'у': 'u',  'ф': 'f',  'х': 'h',  'ц': 'c',
        'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '',  'ы': 'y',  'ь': '',
        'э': 'e',  'ю': 'yu', 'я': 'ya',
        'А': 'A',  'Б': 'B',  'В': 'V',  'Г': 'G',  'Д': 'D',  'Е': 'E',
        'Ё': 'E',  'Ж': 'Zh', 'З': 'Z',  'И': 'I',  'Й': 'Y',  'К': 'K',
        'Л': 'L',  'М': 'M',  'Н': 'N',  'О': 'O',  'П': 'P',  'Р': 'R',
        'С': 'S',  'Т': 'T',  'У': 'U',  'Ф': 'F',  'Х': 'H',  'Ц': 'C',
        'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Sch', 'Ъ': '', 'Ы': 'Y',  'Ь': '',
        'Э': 'E',  'Ю': 'Yu', 'Я': 'Ya'
    };

    function translit(str) {
        var s = String(str);
        var out = '';
        for (var i = 0; i < s.length; i++) {
            var ch = s.charAt(i);
            out += Object.prototype.hasOwnProperty.call(TRANSLIT, ch) ? TRANSLIT[ch] : ch;
        }
        return out;
    }

    /* 'Lumistek Clear PPF' -> 'lumistek-clear-ppf'; 'Пленка для фар' -> 'plenka-dlya-far' */
    function slugify(name) {
        var s = translit(name || '').toLowerCase();
        s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (s.length > 48) s = s.slice(0, 48).replace(/-+$/, '');
        return s || 'tovar';
    }

    /* 'clear-ppf' занят -> 'clear-ppf-2'. taken — массив уже занятых id. */
    function uniqueId(base, taken) {
        var used = {};
        (taken || []).forEach(function (t) { used[String(t)] = true; });
        var id = base;
        var n = 2;
        while (used[id]) {
            id = base + '-' + n;
            n++;
        }
        return id;
    }

    /* ---- 1.3 Разбор литералов и проверка текста БЕЗ eval ------------------ */

    /*
     * ЗАЧЕМ ЭТО ЗДЕСЬ.
     *
     * Раньше проверка «текст — валидный JS» делалась через конструктор
     * динамического выполнения кода, а разбор catalog.js/gallery.js — через
     * тот же конструктор с 'return (...)' внутри.
     * Но Railway отдает страницы с таким заголовком:
     *
     *   content-security-policy: ... script-src 'self' 'unsafe-inline' https: *; ...
     *
     * В нем НЕТ 'unsafe-eval', поэтому браузер запрещает динамическое
     * выполнение кода (конструктор Function и eval).
     * Каждый такой вызов падал с ошибкой CSP, из-за чего вкладка «Товары»
     * показывала «Товаров пока нет», хотя товары в файле есть.
     *
     * Поэтому здесь написан свой разборщик литералов: он читает текст,
     * а не выполняет его. Никакой внешней библиотеки — файл должен
     * остаться одним <script src="/adminpanel/admin.js">.
     */

    /* Ошибка с указанием строки и позиции — чтобы админ понял, где искать. */
    function litError(text, pos, message) {
        var upto = String(text).slice(0, Math.max(0, pos));
        var line = upto.split('\n').length;
        return new Error(message + ' (строка ' + line + ', символ ' + pos + ')');
    }

    /* Пропускаем пробелы, // комментарии и /* блочные комментарии. */
    function litSkip(text, pos) {
        var n = text.length;
        var i = pos;
        while (i < n) {
            var c = text.charAt(i);
            if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v') {
                i++;
                continue;
            }
            if (c === '/' && text.charAt(i + 1) === '/') {
                i += 2;
                while (i < n && text.charAt(i) !== '\n') i++;
                continue;
            }
            if (c === '/' && text.charAt(i + 1) === '*') {
                var close = text.indexOf('*/', i + 2);
                if (close < 0) throw litError(text, i, 'Не закрыт комментарий /* ... */');
                i = close + 2;
                continue;
            }
            break;
        }
        return i;
    }

    /*
     * Идентификатор: буква, _ или $, дальше буквы, цифры, _ и $.
     * Кириллицу тоже разрешаем, чтобы ключ вида { цена: 100 } разбирался,
     * хотя в наших файлах таких ключей нет.
     */
    function litIsIdentStart(c) {
        return /[A-Za-z_$\u00c0-\uffff]/.test(c);
    }
    function litIsIdentPart(c) {
        return /[A-Za-z0-9_$\u00c0-\uffff]/.test(c);
    }

    /* Строка в одинарных или двойных кавычках, с escape-последовательностями. */
    function litReadString(text, pos) {
        var n = text.length;
        var quote = text.charAt(pos);
        var out = '';
        var i = pos + 1;

        while (i < n) {
            var c = text.charAt(i);

            if (c === '\\') {
                var e = text.charAt(i + 1);
                if (e === '') break;
                if (e === 'n') { out += '\n'; i += 2; continue; }
                if (e === 't') { out += '\t'; i += 2; continue; }
                if (e === 'r') { out += '\r'; i += 2; continue; }
                if (e === 'b') { out += '\b'; i += 2; continue; }
                if (e === 'f') { out += '\f'; i += 2; continue; }
                if (e === 'v') { out += '\v'; i += 2; continue; }
                if (e === '0') { out += '\0'; i += 2; continue; }
                if (e === 'u') {
                    /* \uXXXX и \u{XXXX} — второй в старых браузерах не нужен,
                     * но разобрать его ничего не стоит. */
                    if (text.charAt(i + 2) === '{') {
                        var shut = text.indexOf('}', i + 3);
                        if (shut < 0) throw litError(text, i, 'Не закрыт \\u{...} в строке');
                        var hex2 = text.slice(i + 3, shut);
                        if (!/^[0-9a-fA-F]+$/.test(hex2)) {
                            throw litError(text, i, 'Некорректный \\u{...} в строке');
                        }
                        out += String.fromCharCode(parseInt(hex2, 16));
                        i = shut + 1;
                        continue;
                    }
                    var hex4 = text.slice(i + 2, i + 6);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex4)) {
                        throw litError(text, i, 'Некорректная последовательность \\uXXXX в строке');
                    }
                    out += String.fromCharCode(parseInt(hex4, 16));
                    i += 6;
                    continue;
                }
                /* \' \" \\ \/ и любой другой символ — просто сам символ. */
                out += e;
                i += 2;
                continue;
            }

            if (c === quote) return { value: out, pos: i + 1 };
            if (c === '\n') throw litError(text, i, 'Строка не закрыта кавычкой');
            out += c;
            i++;
        }
        throw litError(text, pos, 'Строка не закрыта кавычкой');
    }

    /* Число: 12, -3.5, 0.25. Никаких 1e5 и .5 — в наших файлах их нет. */
    function litReadNumber(text, pos) {
        var m = /^-?\d+(?:\.\d+)?/.exec(text.slice(pos));
        if (!m) throw litError(text, pos, 'Ожидалось число');
        return { value: parseFloat(m[0]), pos: pos + m[0].length };
    }

    /*
     * Значение. Поддерживаем ровно то, что встречается в catalog.js,
     * gallery.js и config.js: строка, число, true/false/null, массив,
     * объект. Вызовы функций, шаблонные строки и склейка через +
     * намеренно НЕ поддерживаются: лучше честная ошибка, чем тихо
     * неверные данные.
     */
    function litParseValue(text, pos) {
        var i = litSkip(text, pos);
        if (i >= text.length) throw litError(text, i, 'Неожиданный конец файла — значение не дописано');
        var c = text.charAt(i);

        if (c === "'" || c === '"') return litReadString(text, i);
        if (c === '{') return litParseObject(text, i);
        if (c === '[') return litParseArray(text, i);
        if (c === '-' || (c >= '0' && c <= '9')) return litReadNumber(text, i);

        if (c === '`') {
            throw litError(text, i, 'Шаблонные строки (`...`) не поддерживаются — нужны обычные кавычки');
        }
        if (c === '+' || c === '(') {
            throw litError(text, i, 'Склейка (+) и вызовы функций не поддерживаются в этих файлах');
        }

        if (litIsIdentStart(c)) {
            var j = i;
            while (j < text.length && litIsIdentPart(text.charAt(j))) j++;
            var word = text.slice(i, j);
            if (word === 'true') return { value: true, pos: j };
            if (word === 'false') return { value: false, pos: j };
            if (word === 'null') return { value: null, pos: j };
            if (word === 'undefined') return { value: undefined, pos: j };
            throw litError(text, i, 'Непонятное значение: ' + word);
        }

        throw litError(text, i, 'Непонятный символ: ' + c);
    }

    /*
     * Объект. Ключ — идентификатор, строка или число.
     * Запятая перед } разрешена (лишняя не ломает разбор).
     */
    function litParseObject(text, pos) {
        var i = litSkip(text, pos);
        if (text.charAt(i) !== '{') throw litError(text, i, 'Ожидалась {');

        var out = {};
        i = i + 1;

        for (;;) {
            i = litSkip(text, i);
            if (i >= text.length) throw litError(text, pos, 'Не закрыта фигурная скобка {');

            if (text.charAt(i) === '}') return { value: out, pos: i + 1 };

            var c = text.charAt(i);
            var key;
            var ks;
            var kn;
            var j;
            if (c === "'" || c === '"') {
                ks = litReadString(text, i);
                key = ks.value;
                i = ks.pos;
            } else if (c === '-' || (c >= '0' && c <= '9')) {
                kn = litReadNumber(text, i);
                key = String(kn.value);
                i = kn.pos;
            } else if (litIsIdentStart(c)) {
                j = i;
                while (j < text.length && litIsIdentPart(text.charAt(j))) j++;
                key = text.slice(i, j);
                i = j;
            } else {
                throw litError(text, i, 'В объекте ожидался ключ, а встретилось: ' + c);
            }

            i = litSkip(text, i);
            if (text.charAt(i) !== ':') {
                throw litError(text, i, 'После ключа «' + key + '» ожидалось двоеточие');
            }

            var v = litParseValue(text, i + 1);
            out[key] = v.value;
            i = litSkip(text, v.pos);

            if (text.charAt(i) === ',') { i++; continue; }
            if (text.charAt(i) === '}') return { value: out, pos: i + 1 };
            throw litError(text, i, 'После значения ключа «' + key + '» ожидалась запятая или }');
        }
    }

    /* Массив. Запятая перед ] разрешена. */
    function litParseArray(text, pos) {
        var i = litSkip(text, pos);
        if (text.charAt(i) !== '[') throw litError(text, i, 'Ожидалась [');

        var out = [];
        i = i + 1;

        for (;;) {
            i = litSkip(text, i);
            if (i >= text.length) throw litError(text, pos, 'Не закрыта квадратная скобка [');

            if (text.charAt(i) === ']') return { value: out, pos: i + 1 };

            var v = litParseValue(text, i);
            out.push(v.value);
            i = litSkip(text, v.pos);

            if (text.charAt(i) === ',') { i++; continue; }
            if (text.charAt(i) === ']') return { value: out, pos: i + 1 };
            throw litError(text, i, 'В списке ожидалась запятая или ]');
        }
    }

    /*
     * Разбирает текст целиком и требует, чтобы после значения не осталось
     * ничего, кроме пробелов и комментариев. Так «{...} мусор» не пройдет молча.
     */
    function parseJsLiteral(text) {
        var src = String(text == null ? '' : text);
        var r = litParseValue(src, 0);
        var rest = litSkip(src, r.pos);
        if (rest < src.length) {
            throw litError(src, rest, 'Лишний текст после значения: ' + src.charAt(rest));
        }
        return r.value;
    }

    /*
     * Баланс скобок и кавычек. Строки и комментарии пропускаются, поэтому
     * скобка внутри блочного комментария или внутри кавычек счет не сбивает.
     * Возвращает null, если все в порядке, иначе — текст ошибки.
     */
    function checkStructureBalance(text) {
        var src = String(text == null ? '' : text);
        var stack = [];
        var i = 0;
        var n = src.length;
        var line = 1;

        while (i < n) {
            var c = src.charAt(i);

            if (c === '\n') { line++; i++; continue; }

            if (c === '/' && src.charAt(i + 1) === '/') {
                i += 2;
                while (i < n && src.charAt(i) !== '\n') i++;
                continue;
            }
            if (c === '/' && src.charAt(i + 1) === '*') {
                var close = src.indexOf('*/', i + 2);
                if (close < 0) return 'Не закрыт комментарий /* ... */ (строка ' + line + ')';
                for (var k = i; k < close; k++) if (src.charAt(k) === '\n') line++;
                i = close + 2;
                continue;
            }
            if (c === "'" || c === '"') {
                var quote = c;
                i++;
                var closed = false;
                while (i < n) {
                    var q = src.charAt(i);
                    if (q === '\\') { i += 2; continue; }
                    if (q === '\n') break;
                    if (q === quote) { closed = true; i++; break; }
                    i++;
                }
                if (!closed) return 'Не закрыта кавычка ' + quote + ' (строка ' + line + ')';
                continue;
            }

            if (c === '{' || c === '[') { stack.push({ ch: c, line: line }); i++; continue; }
            if (c === '}' || c === ']') {
                var want = (c === '}') ? '{' : '[';
                var top = stack.pop();
                if (!top) return 'Лишняя закрывающая скобка ' + c + ' (строка ' + line + ')';
                if (top.ch !== want) {
                    return 'Скобки перепутаны: открыли ' + top.ch + ' (строка ' + top.line +
                        '), а закрыли ' + c + ' (строка ' + line + ')';
                }
                i++;
                continue;
            }
            i++;
        }

        if (stack.length) {
            var last = stack[stack.length - 1];
            return 'Не закрыта скобка ' + last.ch + ' (строка ' + last.line + ')';
        }
        return null;
    }

    /*
     * Проверяет, что текст — валидный JS, и только потом пишет его в GitHub.
     * Это последняя линия обороны: если генератор что-то сломал,
     * на сайте не появится битый файл.
     *
     * ВАЖНОЕ ОГРАНИЧЕНИЕ (честно).
     * Раньше здесь текст прогонялся через конструктор Function — браузер
     * проверял синтаксис по-настоящему. Теперь CSP это запрещает,
     * поэтому проверка СЛАБЕЕ:
     *   1) если текст — файл вида window.LUMISTEK_XXX = { ... };,
     *      его литерал разбирается нашим разборщиком целиком;
     *   2) для любого другого текста проверяется только баланс скобок
     *      и кавычек.
     * Значит, произвольную синтаксическую ошибку в куске обычного JS
     * (забытый return, лишняя запятая вне списка) мы НЕ поймаем.
     * Для наших файлов это не страшно: их целиком пишет сама админка,
     * и они всегда имеют форму window.LUMISTEK_XXX = { ... };
     */
    function isJsSafe(text) {
        var src = String(text == null ? '' : text);

        var balance = checkStructureBalance(src);
        if (balance) return { ok: false, error: balance };

        /*
         * Ищем присваивание window.LUMISTEK_XXX = { ... }.
         * Если это не файл настроек — ограничиваемся проверкой баланса выше.
         */
        var m = /window\.LUMISTEK_[A-Z0-9_]+\s*=\s*\{/.exec(src);
        if (!m) return { ok: true };

        var open = src.indexOf('{', m.index + m[0].length - 1);
        var end = findMatchingBrace(src, open);
        if (end < 0) {
            return { ok: false, error: 'Не сходятся фигурные скобки после window.LUMISTEK_...' };
        }

        try {
            parseJsLiteral(src.slice(open, end + 1));
        } catch (e) {
            return { ok: false, error: (e && e.message) ? e.message : String(e) };
        }

        return { ok: true };
    }

    /* ---- 1.4 Кавычки и числа --------------------------------------------- */

    /* Экранируем все, что ломает строку в одинарных кавычках. */
    function q(value) {
        var s = (value === null || value === undefined) ? '' : String(value);
        return "'" + s
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r?\n/g, '\\n') + "'";
    }

    function num(value) {
        var n = Number(value);
        if (!isFinite(n) || n < 0) n = 0;
        return String(Math.round(n * 100) / 100);
    }

    function today() {
        var d = new Date();
        function p(x) { return (x < 10 ? '0' : '') + x; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    /* ========================================================================
     *  1.5 ГЕНЕРАТОР assets/js/catalog.js
     * ====================================================================== */

    /* Шапка файла — сохраняется дословно при каждой перезаписи. */
    var CATALOG_HEADER = [
        '/**',
        ' * ============================================================================',
        ' *  LUMISTEK — КАТАЛОГ ТОВАРОВ',
        ' * ============================================================================',
        ' *',
        ' *  ЭТО ФАЙЛ С ТОВАРАМИ. Его читают: каталог, корзина и главная страница.',
        ' *',
        ' *  Обычно править его руками НЕ нужно — для этого есть админка:',
        ' *      https://lumistek.ru/adminpanel/',
        ' *',
        ' *  Но если админка недоступна, можно править и здесь, прямо на GitHub:',
        ' *  нажмите на файл → карандаш (Edit) → правьте → Commit changes.',
        ' *',
        ' *  ПРАВИЛА:',
        ' *   1. Не удаляйте скобки { } [ ] , :  — сайт сломается.',
        " *   2. Текст — в кавычках: 'вот так'.",
        ' *   3. После каждого значения запятая, КРОМЕ последнего в списке.',
        ' *   4. id у товара должен быть уникальным (любая латиница/цифры).',
        ' *',
        ' *  ЧТО ЗНАЧИТ КАЖДОЕ ПОЛЕ:',
        ' *   id          — уникальный код товара. Не меняйте у существующих!',
        " *   category    — раздел каталога: 'ppf' | 'tint' | 'windshield' | 'headlight'",
        ' *   name        — название на карточке',
        ' *   subtitle    — подпись под названием (мелким шрифтом)',
        ' *   description — описание. Можно вставлять <br><br> для абзацев.',
        ' *   image       — путь к фото. Положите файл в папку img/products/',
        " *   badge       — цветная плашка: 'brand-cyan' | 'brand-pink' | 'brand-blue'",
        ' *   units       — варианты покупки:',
        ' *                   key   — код варианта (не меняйте у существующих)',
        ' *                   label — что видит покупатель',
        ' *                   price — цена в рублях (число, без пробелов и знака ₽)',
        " *                   note  — подпись мелким шрифтом (можно убрать строкой note: '')",
        ' *   spec        — короткие характеристики внизу карточки (список строк)',
        ' *   popular     — true, чтобы показать товар в блоке «Хиты» на главной',
        ' *',
        ' * ============================================================================',
        ' */',
        ''
    ].join('\n');

    /* Заголовки-разделители внутри products[]. */
    var CATALOG_CAT_COMMENTS = {
        ppf: 'PPF',
        tint: 'ТОНИРОВКА',
        windshield: 'ЗАЩИТА ЛОБОВОГО СТЕКЛА',
        headlight: 'ОПТИКА'
    };

    /*
     * Строка-разделитель внутри products[]:
     *      /* ============================ PPF ============================ *\/
     * Длина полосы считается от длины названия: pad = 30 - ceil(len/2).
     * Так строка остается примерно одной ширины и совпадает с исходным
     * catalog.js. Полосы слева и справа всегда одинаковые.
     */
    function separatorLine(title) {
        var t = String(title || '');
        var pad = 30 - Math.ceil(t.length / 2);
        if (pad < 4) pad = 4;

        var bar = new Array(pad + 1).join('=');
        return '/* ' + bar + ' ' + t + ' ' + bar + ' */';
    }

    /*
     * Достает из исходного catalog.js уже написанные строки-разделители.
     * Возвращает объект { 'PPF': '/* ==== PPF ==== *\/', ... }.
     *
     * Зачем: полосы в исходном файле рисовал человек, и они не ложатся
     * ни в одну формулу (у «PPF» полоса 28, у «ОПТИКА» — 27 при близкой
     * длине). Поэтому при сохранении мы НЕ пересчитываем их, а переносим
     * дословно. Формула separatorLine остается только для новых разделов,
     * которых в исходнике не было.
     */
    function collectSeparators(originalText) {
        var out = {};
        if (!originalText) return out;

        /* Ищем только внутри products[] — в других местах таких строк нет. */
        var re = /\/\*[ \t]*(=+)[ \t]+([^*\n]+?)[ \t]+\1[ \t]*\*\//g;
        var m;
        while ((m = re.exec(originalText)) !== null) {
            var title = m[2].trim();
            if (!title) continue;
            if (!Object.prototype.hasOwnProperty.call(out, title)) {
                out[title] = m[0];
            }
        }
        return out;
    }

    /* Один товар. last = это последний товар в общем списке (тогда без запятой). */
    function productBlock(p, last) {        var L = [];
        var units = Array.isArray(p.units) ? p.units : [];
        var spec = Array.isArray(p.spec) ? p.spec : [];

        L.push('        {');
        L.push('            id: ' + q(p.id) + ',');
        L.push('            category: ' + q(p.category) + ',');
        L.push('            name: ' + q(p.name) + ',');
        L.push('            subtitle: ' + q(p.subtitle) + ',');
        L.push('            image: ' + q(p.image) + ',');
        L.push('            badge: ' + q(p.badge || 'brand-cyan') + ',');
        L.push('            popular: ' + (p.popular ? 'true' : 'false') + ',');
        L.push('            hidden: ' + (p.hidden ? 'true' : 'false') + ',');        L.push('            description: ' + q(p.description) + ',');
        L.push('            units: [');

        units.forEach(function (u, i) {
            var line = '                { key: ' + q(u.key) +
                ', label: ' + q(u.label) +
                ', price: ' + num(u.price) +
                ', note: ' + q(u.note) + ' }';
            if (i < units.length - 1) line += ',';
            L.push(line);
        });

        L.push('            ],');
        L.push('            spec: [' + spec.map(function (s) { return q(s); }).join(', ') + ']');
        L.push('        }' + (last ? '' : ','));
        return L.join('\n');
    }

    /*
     * Собирает полный текст assets/js/catalog.js из модели:
     *   { updated: '2026-11-11', categories: [{key,title}], products: [...] }
     *
     * Второй аргумент (необязательный) — исходный текст файла. Он нужен,
     * чтобы сохранить уже написанные заголовки-разделители дословно:
     * их рисовал человек, и пересчитывать их ширину нельзя.
     */
    function buildCatalogText(model, originalText) {
        var data = model || {};
        var categories = Array.isArray(data.categories) ? data.categories : [];
        var products = Array.isArray(data.products) ? data.products : [];
        var keptSeparators = collectSeparators(originalText);
        var L = [];

        L.push(CATALOG_HEADER);
        L.push('window.LUMISTEK_CATALOG = {');
        L.push('');
        L.push('    /* Дата последнего изменения — обновляется админкой автоматически. */');
        L.push('    updated: ' + q(data.updated || today()) + ',');
        L.push('');
        L.push('    /* ------------------------------------------------------------------');
        L.push('     *  РАЗДЕЛЫ КАТАЛОГА');
        L.push('     *  Порядок здесь = порядок кнопок-фильтров в каталоге.');
        L.push('     * ------------------------------------------------------------------ */');
        L.push('    categories: [');
        /*
         * Ключи выравниваем по самому длинному, чтобы блок читался
         * ровным столбиком — как в исходном catalog.js.
         */
        var keyWidth = 0;
        categories.forEach(function (c) {
            var len = q(c.key).length;
            if (len > keyWidth) keyWidth = len;
        });
        categories.forEach(function (c, i) {
            var key = q(c.key);
            var gap = new Array(keyWidth - key.length + 2).join(' ');
            var line = '        { key: ' + key + ',' + gap + 'title: ' + q(c.title) + ' }';
            if (i < categories.length - 1) line += ',';
            L.push(line);
        });
        L.push('    ],');
        L.push('');
        L.push('');
        L.push('    /* ------------------------------------------------------------------');
        L.push('     *  ТОВАРЫ');
        L.push('     * ------------------------------------------------------------------ */');
        L.push('    products: [');
        L.push('');

        /* Группируем по разделам (в порядке categories), чтобы сохранить заголовки. */
        var groups = [];
        var byCat = {};
        function bucket(key) {
            if (!Object.prototype.hasOwnProperty.call(byCat, key)) {
                byCat[key] = [];
                groups.push({ key: key, items: byCat[key] });
            }
            return byCat[key];
        }
        categories.forEach(function (c) { bucket(c.key); });
        products.forEach(function (p) { bucket(p.category).push(p); });

        var written = 0;
        groups.forEach(function (g) {
            if (!g.items.length) return;

            var title = CATALOG_CAT_COMMENTS[g.key];
            if (!title) {
                var match = categories.filter(function (c) { return c.key === g.key; })[0];
                title = match ? String(match.title).toUpperCase() : String(g.key).toUpperCase();
            }

            /*
             * Разделитель берем из исходного файла дословно, если он там был.
             * Иначе рисуем по формуле — но только для новых разделов.
             */
            var existing = keptSeparators[title];
            L.push('        ' + (existing || separatorLine(title)));

            g.items.forEach(function (p, idx) {
                written++;
                L.push(productBlock(p, written === products.length));
                /* Пустая строка между товарами группы. */
                if (idx < g.items.length - 1) L.push('');
            });
            L.push('');
        });

        /* После последней группы уже есть пустая строка; лишние убираем. */
        while (L.length && L[L.length - 1] === '') L.pop();
        L.push('');
        L.push('    ]');
        L.push('};');
        L.push('');
        return L.join('\n');
    }

    /* ========================================================================
     *  1.6 ГЕНЕРАТОР assets/js/gallery.js
     * ====================================================================== */

    var GALLERY_HEADER = [
        '/**',
        ' * ============================================================================',
        ' *  LUMISTEK — ГАЛЕРЕЯ РАБОТ (фото партнеров)',
        ' * ============================================================================',
        ' *',
        ' *  ЭТОТ ФАЙЛ ОБНОВЛЯЕТСЯ АДМИНКОЙ АВТОМАТИЧЕСКИ:',
        ' *      https://lumistek.ru/adminpanel/   → раздел «Работы»',
        ' *',
        ' *  Руками тут править не нужно. Но если админка недоступна — можно:',
        ' *  на GitHub нажмите на файл, потом на карандаш (Edit), затем «Commit changes».',
        ' *',
        ' *  КАК ЭТО РАБОТАЕТ:',
        ' *  Главная страница берет отсюда список фотографий и рисует карусель сама.',
        ' *  Пока этот файл не подключен на главной, там показываются старые',
        ' *  картинки gallery-1.jpg ... gallery-5.jpg, и ничего не ломается.',
        ' *',
        ' *  ПРАВИЛА:',
        ' *   1. Не удаляйте скобки { } [ ] , :  — сайт сломается.',
        " *   2. Текст — в кавычках: 'вот так'.",
        ' *   3. После каждого значения запятая, КРОМЕ последнего в списке.',
        " *   4. file   — путь к фото от корня сайта. Например 'img/gallery/work-1.jpg'",
        " *               или 'gallery-1.jpg' (старые фото лежат в корне).",
        " *      caption — подпись мелким шрифтом. Можно оставить пустой: ''.",
        ' *',
        ' * ============================================================================',
        ' */',
        ''
    ].join('\n');

    /* Список старых фото — запасной вариант, если файла gallery.js еще нет. */
    function seedGallery() {
        var photos = [];
        for (var i = 1; i <= 5; i++) {
            photos.push({ file: 'gallery-' + i + '.jpg', caption: '' });
        }
        return { updated: today(), photos: photos };
    }

    /* Собирает текст assets/js/gallery.js из модели { updated, photos[] }. */
    function buildGalleryText(model) {
        var data = model || {};
        var photos = Array.isArray(data.photos) ? data.photos : [];
        var L = [];

        L.push(GALLERY_HEADER);
        L.push('window.LUMISTEK_GALLERY = {');
        L.push('');
        L.push('    /* Дата последнего изменения — обновляется админкой автоматически. */');
        L.push('    updated: ' + q(data.updated || today()) + ',');
        L.push('');
        L.push('    photos: [');
        photos.forEach(function (p, i) {
            var line = '        { file: ' + q(p.file) + ', caption: ' + q(p.caption) + ' }';
            if (i < photos.length - 1) line += ',';
            L.push(line);
        });
        L.push('    ]');
        L.push('};');
        L.push('');
        return L.join('\n');
    }

    /* ========================================================================
     *  1.7 ПРАВКА assets/js/config.js — ТОЛЬКО блок fallbackShorts
     *
     *  Это самая опасная запись в панели: в config.js много русских
     *  комментариев, которые клиент читает. Поэтому мы НЕ пересобираем
     *  файл целиком, а заменяем ровно один блок [ ... ],
     *  оставляя все остальные байты нетронутыми.
     * ====================================================================== */

    var SHORTS_START = 'fallbackShorts: [';
    var SHORTS_END = '    ],';

    /*
     * Находит границы массива fallbackShorts: позицию сразу после '['
     * и позицию закрывающей ']' с учетом строк и комментариев.
     * Возвращает null, если блок не найден или скобки не сходятся.
     */
    function findShortsRange(text) {
        var src = String(text);
        var startIdx = src.indexOf(SHORTS_START);
        if (startIdx < 0) return null;

        var open = startIdx + SHORTS_START.length - 1;  /* индекс '[' */
        var depth = 0;
        var i = open;
        var inLineComment = false;
        var inBlockComment = false;
        var quote = null;

        for (; i < src.length; i++) {
            var c = src.charAt(i);
            var next = src.charAt(i + 1);

            if (inLineComment) {
                if (c === '\n') inLineComment = false;
                continue;
            }
            if (inBlockComment) {
                if (c === '*' && next === '/') { inBlockComment = false; i++; }
                continue;
            }
            if (quote) {
                if (c === '\\') { i++; continue; }
                if (c === quote) quote = null;
                continue;
            }
            if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
            if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
            if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
            if (c === '[') depth++;
            if (c === ']') {
                depth--;
                if (depth === 0) {
                    return { open: open, close: i };
                }
            }
        }
        return null;
    }

    /* Внутренняя часть блока — чтобы понять, что там уже лежит. */
    function parseShortsEntries(text) {
        var range = findShortsRange(text);
        if (!range) return [];
        var body = String(text).slice(range.open + 1, range.close);
        var entries = [];
        /*
         * Блок видео в config.js выглядит так:
         *      { id: 'XXXXXXXXXXX', title: '...', date: '...' }
         * Паттерн ниже ищет ровно такую строку. Строка REG_BODY собирается
         * из частей, чтобы этот файл не пострадал от собственных проверок
         * и от минификаторов.
         */
        var REG_BODY =
            '\\{\\s*id:\\s*([\'"])([\\w-]+)\\1\\s*,' +
            '\\s*title:\\s*([\'"])((?:\\\\.|(?!\\3)[\\s\\S])*?)\\3\\s*,' +
            '\\s*date:\\s*([\'"])([\\s\\S]*?)\\5\\s*\\}';
        var re = new RegExp(REG_BODY, 'g');
        var m;
        while ((m = re.exec(body)) !== null) {
            entries.push({
                id: m[2],
                title: unescapeJsString(m[4], m[3]),
                date: m[6]
            });
        }
        return entries;
    }

    function unescapeJsString(s, quote) {
        return String(s)
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(new RegExp('\\\\' + quote, 'g'), quote)
            .replace(/\\\\/g, '\\');
    }

    /*
     * Заменяет ТОЛЬКО блок fallbackShorts: [ ... ], и возвращает новый текст.
     * Все остальное (включая русские комментарии) остается байт-в-байт.
     */
    function replaceShortsBlock(text, entries) {
        var src = String(text);
        var range = findShortsRange(src);
        if (!range) {
            return { ok: false, error: 'В файле config.js не найден блок fallbackShorts. Правка отменена, чтобы ничего не сломать.' };
        }

        var list = Array.isArray(entries) ? entries : [];
        var lines = [];
        list.forEach(function (e, i) {
            lines.push('        {');
            lines.push('            id: ' + q(e.id) + ',');
            lines.push('            title: ' + q(e.title) + ',');
            lines.push('            date: ' + q(e.date));
            lines.push('        }' + (i < list.length - 1 ? ',' : ''));
        });

        /*
         * Файл может быть с Windows-переводами строк (\r\n). Если вставить
         * блок с \n, получится смесь, и git покажет лишний шум в диффе.
         * Поэтому подстраиваемся под стиль самого файла.
         */
        var eol = src.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
        var body = lines.join(eol);

        /* Тело блока начинается с перевода строки после '['. */
        var newBody = list.length ? eol + body + eol + '    ' : '';
        var out = src.slice(0, range.open + 1) + newBody + src.slice(range.close);

        var check = isJsSafe(out);
        if (!check.ok) {
            return { ok: false, error: 'После правки файл config.js перестал быть корректным: ' + check.error };
        }
        return { ok: true, text: out };
    }

    /* ---- 1.8 Разбор ссылки YouTube --------------------------------------- */

    /*
     * Достает 11-символьный id из любой формы ссылки:
     *   youtube.com/watch?v=ID   youtu.be/ID
     *   youtube.com/shorts/ID    youtube.com/embed/ID   youtube.com/live/ID
     * Возвращает id или null.
     */
    function parseYouTubeId(input) {
        var s = String(input || '').trim();
        if (!s) return null;

        /* Уже просто id. */
        if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;

        var patterns = [
            /[?&]v=([A-Za-z0-9_-]{11})/,
            /youtu\.be\/([A-Za-z0-9_-]{11})/,
            /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
            /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
            /youtube\.com\/live\/([A-Za-z0-9_-]{11})/,
            /youtube\.com\/v\/([A-Za-z0-9_-]{11})/
        ];
        for (var i = 0; i < patterns.length; i++) {
            var m = s.match(patterns[i]);
            if (m) return m[1];
        }
        return null;
    }

    /* Дополняет дату до вида '2026-11-11' и проверяет её. */
    function normalizeDate(value) {
        var s = String(value || '').trim();
        if (!s) return today();

        /* Уже готовый вид. */
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

        /* 2026-1-5 -> 2026-01-05 (человек мог не добить нули). */
        var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (iso) {
            var mm = ('0' + iso[2]).slice(-2);
            var dd = ('0' + iso[3]).slice(-2);
            if (Number(iso[2]) >= 1 && Number(iso[2]) <= 12 &&
                Number(iso[3]) >= 1 && Number(iso[3]) <= 31) {
                return iso[1] + '-' + mm + '-' + dd;
            }
        }

        /* 5.1.2026 -> 2026-01-05 (русский формат). */
        var ru = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        if (ru) {
            var m2 = ('0' + ru[2]).slice(-2);
            var d2 = ('0' + ru[1]).slice(-2);
            if (Number(ru[2]) >= 1 && Number(ru[2]) <= 12 &&
                Number(ru[1]) >= 1 && Number(ru[1]) <= 31) {
                return ru[3] + '-' + m2 + '-' + d2;
            }
        }

        /* Не разобрали — лучше сегодняшняя дата, чем мусор на сайте. */
        return today();
    }

    /* ========================================================================
     *  2. GITHUB API
     * ====================================================================== */

    function apiUrl(path) {
        var s = state.settings;
        return 'https://api.github.com/repos/' + encodeURIComponent(s.owner) + '/' +
            encodeURIComponent(s.repo) + '/' + path;
    }

    /* Понятный русский текст вместо кода ошибки. */
    function humanError(status, fallback) {
        if (status === 401 || status === 403) {
            return 'Токен неверный или истёк / нет прав на запись. ' +
                'Проверьте токен в настройках (нужно право Contents: Read and write).';
        }
        if (status === 404) {
            return 'Файл или репозиторий не найден. Проверьте владельца, название репозитория и ветку.';
        }
        if (status === 409 || status === 422) {
            return 'Конфликт версий — обновите страницу и попробуйте снова.';
        }
        if (status === 429) {
            return 'Слишком много запросов к GitHub. Подождите минуту и повторите.';
        }
        if (status >= 500) {
            return 'GitHub временно недоступен (ошибка ' + status + '). Попробуйте позже.';
        }
        return fallback || ('Не удалось выполнить запрос (код ' + status + ').');
    }

    function ghFetch(path, options) {
        var opts = options || {};
        var headers = {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
        if (state.settings.token) headers.Authorization = 'Bearer ' + state.settings.token;
        if (opts.headers) {
            Object.keys(opts.headers).forEach(function (k) { headers[k] = opts.headers[k]; });
        }

        return fetch(apiUrl(path), {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined,
            cache: 'no-store'
        }).then(function (res) {
            if (res.status === 204) return { res: res, data: null };
            return res.json().catch(function () { return null; }).then(function (data) {
                return { res: res, data: data };
            });
        });
    }

    /* Проверка подключения: доступен ли репозиторий и есть ли право на запись. */
    function testConnection() {
        return ghFetch('').then(function (r) {
            if (!r.res.ok) throw new Error(humanError(r.res.status, r.data && r.data.message));
            var perms = (r.data && r.data.permissions) || {};
            return {
                name: r.data.full_name,
                isPrivate: !!r.data.private,
                canPush: perms.push !== false,
                defaultBranch: r.data.default_branch
            };
        });
    }

    /*
     * Читает файл из репозитория.
     * Возвращает { text, sha } или { text: null, sha: null }, если файла нет.
     */
    function readFile(path) {
        return ghFetch('contents/' + path + '?ref=' + encodeURIComponent(state.settings.branch))
            .then(function (r) {
                if (r.res.status === 404) return { text: null, sha: null, exists: false };
                if (!r.res.ok) throw new Error(humanError(r.res.status, r.data && r.data.message));
                if (Array.isArray(r.data)) throw new Error('По пути ' + path + ' лежит папка, а не файл.');
                return { text: b64decode(r.data.content), sha: r.data.sha, exists: true };
            });
    }

    /*
     * Записывает файл.
     *   text === null  -> удалить файл (нужен sha)
     *   sha отсутствует -> создать новый файл
     *   sha есть       -> обновить существующий
     */
    function writeFile(path, text, sha, message) {
        if (text === null) {
            if (!sha) throw new Error('Нельзя удалить файл, которого нет в репозитории.');
            return ghFetch('contents/' + path, {
                method: 'DELETE',
                body: { message: message || ('admin: удаление ' + path), sha: sha, branch: state.settings.branch }
            }).then(function (r) {
                if (!r.res.ok) throw new Error(humanError(r.res.status, r.data && r.data.message));
                return r.data;
            });
        }

        var body = {
            message: message || ('admin: обновление ' + path),
            content: b64encode(text),
            branch: state.settings.branch
        };
        if (sha) body.sha = sha;

        return ghFetch('contents/' + path, { method: 'PUT', body: body }).then(function (r) {
            if (!r.res.ok) throw new Error(humanError(r.res.status, r.data && r.data.message));
            return r.data;
        });
    }

    /*
     * Безопасная запись: всегда заново спрашивает актуальный sha прямо
     * перед записью. Кэшировать sha между сохранениями нельзя — это
     * главная причина ошибок 409.
     */
    function writeFileFresh(path, text, message) {
        return readFile(path).then(function (cur) {
            return writeFile(path, text, cur.sha, message);
        });
    }

    /* Загрузка картинки (base64 без обертки data:). */
    function uploadImage(path, base64, message) {
        return readFile(path).then(function (cur) {
            var body = { message: message, content: base64, branch: state.settings.branch };
            if (cur.sha) body.sha = cur.sha;
            return ghFetch('contents/' + path, { method: 'PUT', body: body }).then(function (r) {
                if (!r.res.ok) throw new Error(humanError(r.res.status, r.data && r.data.message));
                return r.data;
            });
        });
    }

    /* ========================================================================
     *  3. СОСТОЯНИЕ
     * ====================================================================== */

    var state = {
        settings: Object.assign({}, DEFAULT_SETTINGS),
        catalog: null,          /* { updated, categories, products } */
        catalogSha: null,
        gallery: null,          /* { updated, photos } */
        gallerySha: null,
        configText: null,
        configSha: null,
        shorts: [],             /* [{ id, title, date }] */
        news: null,             /* news.json — только чтение */
        tab: 'products',
        editing: null           /* товар, который сейчас в форме */
    };

    function loadSettings() {
        try {
            var raw = localStorage.getItem(LS_SETTINGS);
            if (raw) {
                var parsed = JSON.parse(raw);
                Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
                    if (parsed[k] !== undefined && parsed[k] !== null) state.settings[k] = parsed[k];
                });
            }
        } catch (e) { /* поврежденные настройки просто игнорируем */ }
    }

    function saveSettings() {
        localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
    }

    function hasToken() {
        return !!String(state.settings.token || '').trim();
    }

    /* ========================================================================
     *  4. МЕЛОЧИ ИНТЕРФЕЙСА
     * ====================================================================== */

    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function toast(message, kind) {
        var box = $('#toasts');
        if (!box) return;
        var el = document.createElement('div');
        var colors = {
            ok: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200',
            err: 'border-red-500/50 bg-red-500/10 text-red-200',
            info: 'border-brand-cyan/50 bg-brand-cyan/10 text-white'
        };
        el.className = 'max-w-sm px-4 py-3 rounded-xl border text-sm shadow-lg ' +
            (colors[kind] || colors.info);
        el.textContent = message;
        box.appendChild(el);
        setTimeout(function () {
            el.style.opacity = '0';
            el.style.transition = 'opacity .4s';
            setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
        }, kind === 'err' ? 9000 : 5000);
    }

    var busyCount = 0;
    function busy(on, text) {
        var overlay = $('#busy');
        if (!overlay) return;
        if (on) busyCount++;
        else busyCount = Math.max(0, busyCount - 1);
        if (busyCount > 0) {
            $('#busy-text').textContent = text || 'Загрузка…';
            overlay.classList.remove('hidden');
        } else {
            overlay.classList.add('hidden');
        }
    }

    function withBusy(text, fn) {
        busy(true, text);
        return Promise.resolve()
            .then(fn)
            .finally(function () { busy(false); });
    }

    function sha256Hex(text) {
        var data = new TextEncoder().encode(text);
        return crypto.subtle.digest('SHA-256', data).then(function (buf) {
            return Array.prototype.map.call(new Uint8Array(buf), function (x) {
                return ('0' + x.toString(16)).slice(-2);
            }).join('');
        });
    }

    /* Сжимает картинку в браузере: максимум 1600 px по длинной стороне. */
    function downscaleImage(file) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                var w = img.naturalWidth;
                var h = img.naturalHeight;
                var scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(w, h));
                var tw = Math.max(1, Math.round(w * scale));
                var th = Math.max(1, Math.round(h * scale));

                var canvas = document.createElement('canvas');
                canvas.width = tw;
                canvas.height = th;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, tw, th);
                URL.revokeObjectURL(url);

                canvas.toBlob(function (blob) {
                    if (!blob) { reject(new Error('Не удалось сжать изображение.')); return; }
                    resolve({ blob: blob, width: tw, height: th });
                }, 'image/jpeg', JPEG_QUALITY);
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('Не удалось прочитать файл изображения.'));
            };
            img.src = url;
        });
    }

    function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                var s = String(reader.result);
                resolve(s.slice(s.indexOf(',') + 1));
            };
            reader.onerror = function () { reject(new Error('Не удалось прочитать файл.')); };
            reader.readAsDataURL(blob);
        });
    }

    function bytesText(n) {
        if (n < 1024) return n + ' Б';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' КБ';
        return (n / 1024 / 1024).toFixed(2) + ' МБ';
    }

    /* ========================================================================
     *  5. ЭКРАНЫ: ПАРОЛЬ → НАСТРОЙКИ → ПАНЕЛЬ
     * ====================================================================== */

    function showScreen(name) {
        ['gate', 'setup', 'panel'].forEach(function (id) {
            var el = document.getElementById('screen-' + id);
            if (el) el.classList.toggle('hidden', id !== name);
        });
    }

    function initGate() {
        var form = $('#gate-form');
        var input = $('#gate-pass');
        var err = $('#gate-error');
        var btn = $('#gate-btn');

        /* Разметки нет — работаем без заслонки, чтобы панель не встала. */
        if (!form || !input || !err || !btn) return false;

        if (sessionStorage.getItem(SS_AUTH) === '1') return false;

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            err.classList.add('hidden');
            var value = input.value;
            if (!value) return;

            btn.disabled = true;
            btn.textContent = 'Проверяем…';

            sha256Hex(value).then(function (hash) {
                if (hash === PASS_HASH) {
                    sessionStorage.setItem(SS_AUTH, '1');
                    input.value = '';
                    boot();
                } else {
                    err.textContent = 'Неверный пароль. Попробуйте еще раз.';
                    err.classList.remove('hidden');
                    input.value = '';
                    input.focus();
                }
            }).catch(function () {
                err.textContent = 'Браузер не смог проверить пароль. Обновите страницу.';
                err.classList.remove('hidden');
            }).finally(function () {
                btn.disabled = false;
                btn.textContent = 'Войти';
            });
        });

        input.focus();
        return true;
    }

    /* Настройки подключения — заполняем поля текущими значениями. */
    function fillSettingsForm() {
        var owner = $('#set-owner');
        var repo = $('#set-repo');
        var branch = $('#set-branch');
        var token = $('#set-token');

        if (owner) owner.value = state.settings.owner;
        if (repo) repo.value = state.settings.repo;
        if (branch) branch.value = state.settings.branch;
        if (token) token.value = state.settings.token;
    }

    function readSettingsForm() {
        state.settings.owner = ($('#set-owner') ? $('#set-owner').value.trim() : '') || DEFAULT_SETTINGS.owner;
        state.settings.repo = ($('#set-repo') ? $('#set-repo').value.trim() : '') || DEFAULT_SETTINGS.repo;
        state.settings.branch = ($('#set-branch') ? $('#set-branch').value.trim() : '') || DEFAULT_SETTINGS.branch;
        state.settings.token = $('#set-token') ? $('#set-token').value.trim() : state.settings.token;
    }

    function setSetupStatus(kind, text) {
        var el = $('#setup-status');
        if (!el) return;
        el.classList.remove('hidden');
        el.className = 'mt-4 text-sm rounded-xl px-4 py-3 border ' + (
            kind === 'ok' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' :
            kind === 'err' ? 'border-red-500/40 bg-red-500/10 text-red-200' :
            'border-white/15 bg-white/5 text-gray-300'
        );
        el.textContent = text;
    }

    function initSetup() {
        fillSettingsForm();

        var testBtn = $('#setup-test');
        var saveBtn = $('#setup-save');

        if (testBtn) testBtn.addEventListener('click', function () {
            readSettingsForm();
            if (!state.settings.owner || !state.settings.repo) {
                setSetupStatus('err', 'Заполните владельца и название репозитория.');
                return;
            }
            var btn = this;
            btn.disabled = true;
            setSetupStatus('info', 'Проверяем подключение к GitHub…');
            testConnection().then(function (info) {
                saveSettings();
                var msg = 'Подключение работает. Репозиторий: ' + info.name +
                    (info.isPrivate ? ' (приватный)' : ' (публичный)') + '. ';
                msg += info.canPush
                    ? 'Права на запись есть — можно сохранять.'
                    : 'ВНИМАНИЕ: у токена нет права на запись (Contents: Read and write). Сохранять не получится.';
                setSetupStatus(info.canPush ? 'ok' : 'err', msg);
            }).catch(function (e) {
                setSetupStatus('err', e.message || 'Не удалось подключиться.');
            }).finally(function () { btn.disabled = false; });
        });

        if (saveBtn) saveBtn.addEventListener('click', function () {
            readSettingsForm();
            if (!state.settings.owner || !state.settings.repo) {
                setSetupStatus('err', 'Заполните владельца и название репозитория.');
                return;
            }
            if (!state.settings.token) {
                setSetupStatus('err', 'Вставьте токен GitHub — без него панель не сможет сохранять изменения.');
                return;
            }
            saveSettings();
            toast('Настройки сохранены в этом браузере.', 'ok');
            openPanel();
        });
    }

    function openPanel() {
        showScreen('panel');
        var label = $('#repo-label');
        if (label) {
            label.textContent = state.settings.owner + '/' + state.settings.repo +
                ' (' + state.settings.branch + ')';
        }
        switchTab(state.tab);
    }

    /* ========================================================================
     *  6. ВКЛАДКИ
     * ====================================================================== */

    var TABS = [
        { key: 'products', btn: '#tab-products', view: '#view-products' },
        { key: 'gallery',  btn: '#tab-gallery',  view: '#view-gallery'  },
        { key: 'videos',   btn: '#tab-videos',   view: '#view-videos'   }
    ];

    /*
     * Переключает вкладку и при первом открытии подгружает её данные
     * из репозитория. Повторно не перезагружаем — только если данных нет.
     */
    function switchTab(name) {
        var known = TABS.filter(function (t) { return t.key === name; })[0];
        if (!known) name = 'products';
        state.tab = name;

        TABS.forEach(function (t) {
            var btn = $(t.btn);
            var view = $(t.view);
            var active = (t.key === name);

            if (view) view.classList.toggle('hidden', !active);
            if (!btn) return;

            btn.classList.toggle('border-brand-cyan', active);
            btn.classList.toggle('text-white', active);
            btn.classList.toggle('border-transparent', !active);
            btn.classList.toggle('text-gray-400', !active);
        });

        /* Ленивая загрузка данных вкладки. */
        if (name === 'products' && !state.catalog) loadCatalog();
        if (name === 'gallery' && !state.gallery) loadGallery();
        if (name === 'videos' && !state.configText) loadVideos();
    }

    /* ========================================================================
     *  7. ОБЩИЕ ОПЕРАЦИИ С ЗАПИСЬЮ В РЕПОЗИТОРИЙ
     * ====================================================================== */

    /*
     * Проверяет, что текст — валидный JS, и только потом пишет его в GitHub.
     * Это последняя линия обороны: если генератор что-то сломал,
     * на сайте не появится битый файл.
     */
    function safeWrite(path, text, message) {
        var check = isJsSafe(text);
        if (!check.ok) {
            return Promise.reject(new Error(
                'Правка отменена: файл ' + path + ' получился бы с ошибкой (' + check.error +
                '). Сообщите об этом разработчику.'
            ));
        }
        return writeFileFresh(path, text, message);
    }

    /* ========================================================================
     *  8. ВКЛАДКА «ТОВАРЫ»
     * ====================================================================== */

    /*
     * Читает assets/js/catalog.js и превращает его в объект.
     * Файл обернут в 'window.LUMISTEK_CATALOG = {...};' — отрезаем присваивание
     * и вычисляем только литерал, без доступа к document.
     */
    function parseCatalogText(text) {
        var src = String(text || '');
        var at = src.indexOf('window.LUMISTEK_CATALOG');
        if (at < 0) at = src.indexOf('LUMISTEK_CATALOG');
        if (at < 0) throw new Error('В файле catalog.js не найдена строка window.LUMISTEK_CATALOG.');

        var open = src.indexOf('{', at);
        if (open < 0) throw new Error('В файле catalog.js не найдена открывающая скобка.');

        /* Ищем парную закрывающую скобку, пропуская строки и комментарии. */
        var end = findMatchingBrace(src, open);
        if (end < 0) throw new Error('В файле catalog.js не сходятся скобки.');

        var literal = src.slice(open, end + 1);
        var model;
        try {
            model = parseJsLiteral(literal);
        } catch (e) {
            throw new Error('Не удалось прочитать список товаров: ' + (e && e.message ? e.message : e));
        }
        if (!model || typeof model !== 'object') throw new Error('Список товаров пустой или поврежден.');

        if (!Array.isArray(model.categories)) model.categories = [];
        if (!Array.isArray(model.products)) model.products = [];
        return model;
    }

    /*
     * Позиция парной '}' для '{' на позиции open.
     * Корректно пропускает строки в кавычках и комментарии,
     * чтобы скобки внутри текстов не сбивали счет.
     */
    function findMatchingBrace(src, open) {
        var text = String(src);
        var depth = 0;
        var inLineComment = false;
        var inBlockComment = false;
        var quote = null;

        for (var i = open; i < text.length; i++) {
            var c = text.charAt(i);
            var next = text.charAt(i + 1);

            if (inLineComment) {
                if (c === '\n') inLineComment = false;
                continue;
            }
            if (inBlockComment) {
                if (c === '*' && next === '/') { inBlockComment = false; i++; }
                continue;
            }
            if (quote) {
                if (c === '\\') { i++; continue; }
                if (c === quote) quote = null;
                continue;
            }
            if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
            if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
            if (c === "'" || c === '"' || c === '`') { quote = c; continue; }

            if (c === '{') depth++;
            if (c === '}') {
                depth--;
                if (depth === 0) return i;
            }
        }
        return -1;
    }

    function loadCatalog() {
        return withBusy('Загружаем товары…', function () {
            return readFile(PATHS.catalog).then(function (r) {
                if (!r.exists) {
                    state.catalog = seedCatalog();
                    state.catalogSha = null;
                    renderProducts();
                    toast('Файл catalog.js не найден — начали с пустого списка.', 'info');
                    return;
                }
                state.catalog = parseCatalogText(r.text);
                state.catalogSha = r.sha;
                renderProducts();
            });
        }).catch(function (e) {
            /*
             * Загрузка не удалась (нет сети, плохой токен, нет прав).
             * Заглушку «Загружаем…» обязательно убираем, иначе она
             * останется висеть над пустой таблицей навсегда.
             */
            var loading = $('#products-loading');
            if (loading) loading.classList.add('hidden');
            var empty = $('#products-empty');
            if (empty) empty.classList.remove('hidden');
            toast(e.message || 'Не удалось загрузить товары.', 'err');
        });
    }

    /* Запасная модель, если файла catalog.js в репозитории нет. */
    function seedCatalog() {
        return {
            updated: today(),
            categories: [
                { key: 'ppf', title: 'Антигравийные (PPF)' },
                { key: 'tint', title: 'Тонировочные' },
                { key: 'windshield', title: 'Защита лобового стекла' },
                { key: 'headlight', title: 'Защита и стайлинг оптики' }
            ],
            products: []
        };
    }

    function formatPrice(n) {
        var s = String(Math.round(Number(n) || 0));
        var out = '';
        for (var i = 0; i < s.length; i++) {
            if (i > 0 && (s.length - i) % 3 === 0) out += ' ';
            out += s.charAt(i);
        }
        return out + ' ₽';
    }

    /* Короткая сводка цен — для колонки «Цены» в таблице. */
    function priceSummary(product) {
        var units = Array.isArray(product.units) ? product.units : [];
        if (!units.length) return '—';

        var paid = units
            .map(function (u) { return Number(u.price) || 0; })
            .filter(function (n) { return n > 0; });

        if (!paid.length) return 'По запросу';

        var min = Math.min.apply(null, paid);
        if (min === Math.max.apply(null, paid)) return formatPrice(min);
        return 'от ' + formatPrice(min);
    }

    function categoryTitle(key) {
        var list = (state.catalog && state.catalog.categories) || [];
        var match = list.filter(function (c) { return c.key === key; })[0];
        return match ? match.title : String(key || '');
    }

    /* Цвет плашки товара. */
    function badgeCss(key) {
        var match = BADGES.filter(function (b) { return b.key === key; })[0];
        return match ? match.css : BADGES[0].css;
    }

    function renderProducts() {
        var body = $('#products-body');
        var empty = $('#products-empty');
        var loading = $('#products-loading');
        if (!body) return;

        /* Данные пришли (или попытка закончилась) — убираем заглушку. */
        if (loading) loading.classList.add('hidden');

        var products = (state.catalog && state.catalog.products) || [];

        if (!products.length) {
            body.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        body.innerHTML = products.map(function (p, index) {
            var img = p.image
                ? '<img src="' + esc('../' + p.image) + '" alt="" ' +
                  'class="w-12 h-12 rounded-lg object-cover bg-white/5">'
                : '<span class="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center ' +
                  'text-gray-600 text-[10px] text-center leading-tight">нет<br>фото</span>';

            var popular = p.popular
                ? '<span class="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-brand-pink/20 text-brand-pink">Хит</span>'
                : '';

            var hidden = p.hidden
                ? '<span class="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-gray-400">Скрыт</span>'
                : '';

            return '' +
                '<tr class="border-t border-white/10 hover:bg-white/[0.03]">' +
                    '<td class="py-3 pr-3">' + img + '</td>' +
                    '<td class="py-3 pr-3">' +
                        '<div class="font-medium text-white">' + esc(p.name) + popular + hidden + '</div>' +
                        '<div class="text-xs text-gray-500">' + esc(p.subtitle) + '</div>' +
                        '<div class="text-[11px] text-gray-600 font-mono">' + esc(p.id) + '</div>' +
                    '</td>' +
                    '<td class="py-3 pr-3 text-sm text-gray-400">' + esc(categoryTitle(p.category)) + '</td>' +
                    '<td class="py-3 pr-3 text-sm text-gray-300 whitespace-nowrap">' + esc(priceSummary(p)) + '</td>' +
                    '<td class="py-3 text-right whitespace-nowrap">' +
                        '<button type="button" data-edit="' + index + '" ' +
                            'class="px-3 py-1.5 rounded-lg border border-white/15 text-sm text-gray-200 ' +
                            'hover:border-brand-cyan hover:text-white transition">Изменить</button> ' +
                        '<button type="button" data-del="' + index + '" ' +
                            'class="px-3 py-1.5 rounded-lg border border-red-500/30 text-sm text-red-300 ' +
                            'hover:bg-red-500/10 transition">Удалить</button>' +
                    '</td>' +
                '</tr>';
        }).join('');
    }

    /*
     * Открывает форму. product = null → новый товар.
     * В state.editing всегда лежит «черновик», который правит пользователь.
     */
    function openProductForm(product) {
        var form = $('#product-form');
        var title = $('#product-form-title');
        if (!form) return;

        var isNew = !product;
        var cats = (state.catalog && state.catalog.categories) || [];
        var p = product || {
            id: '',
            category: (cats[0] && cats[0].key) || 'ppf',
            name: '',
            subtitle: '',
            image: '',
            badge: 'brand-cyan',
            popular: false,
            hidden: false,
            description: '',
            units: [{ key: 'unit-1', label: '', price: 0, note: '' }],
            spec: []
        };

        state.editing = JSON.parse(JSON.stringify(p));

        if (title) title.textContent = isNew ? 'Новый товар' : 'Товар: ' + p.name;

        setValue('#prod-name', p.name || '');
        setValue('#prod-subtitle', p.subtitle || '');
        setValue('#prod-description', p.description || '');
        setChecked('#prod-popular', !!p.popular);
        setChecked('#prod-hidden', !!p.hidden);

        var pathLabel = $('#prod-image-path');
        if (pathLabel) pathLabel.textContent = p.image || 'файл не выбран';

        var idNote = $('#prod-id-note');
        if (idNote) {
            idNote.textContent = p.id
                ? 'Код товара: ' + p.id + ' (не меняется)'
                : 'Код товара будет создан автоматически из названия.';
        }

        /* Раздел. */
        var select = $('#prod-category');
        if (select) {
            select.innerHTML = cats.map(function (c) {
                return '<option value="' + esc(c.key) + '">' + esc(c.title) + '</option>';
            }).join('');
            if (p.category) select.value = p.category;
        }

        /* Плашка. */
        var badgeSel = $('#prod-badge');
        if (badgeSel) {
            badgeSel.innerHTML = BADGES.map(function (b) {
                return '<option value="' + esc(b.key) + '">' + esc(b.title) + '</option>';
            }).join('');
            badgeSel.value = p.badge || 'brand-cyan';
        }

        renderUnitRows();
        renderSpecRows();

        var del = $('#product-delete');
        if (del) del.classList.toggle('hidden', isNew);

        form.classList.remove('hidden');
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });

        var nameField = $('#prod-name');
        if (nameField) nameField.focus();
    }

    /* Мелкие помощники: не падают, если поля нет на странице. */
    function setValue(sel, value) {
        var el = $(sel);
        if (el) el.value = value;
    }

    function setChecked(sel, value) {
        var el = $(sel);
        if (el) el.checked = value;
    }

    function fieldValue(sel) {
        var el = $(sel);
        return el ? el.value : '';
    }

    function closeProductForm() {
        state.editing = null;
        var form = $('#product-form');
        if (form) form.classList.add('hidden');
        var file = $('#prod-image');
        if (file) file.value = '';
    }

    /* ---- Строки вариантов покупки (units) -------------------------------- */

    function unitRowHtml(u, i) {
        var unit = u || { key: '', label: '', price: 0, note: '' };
        return '' +
            '<div class="unit-row grid grid-cols-12 gap-2 items-center" data-index="' + i + '">' +
                '<input class="unit-label col-span-5 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm" ' +
                    'placeholder="Что видит покупатель" value="' + esc(unit.label) + '">' +
                '<input class="unit-price col-span-2 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm" ' +
                    'type="number" min="0" step="1" placeholder="Цена" value="' + esc(unit.price) + '">' +
                '<input class="unit-note col-span-3 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm" ' +
                    'placeholder="Подпись (необязательно)" value="' + esc(unit.note) + '">' +
                '<input class="unit-key col-span-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" ' +
                    'placeholder="код" value="' + esc(unit.key) + '">' +
                '<button type="button" class="unit-del col-span-1 py-2 rounded-lg border border-red-500/30 ' +
                    'text-red-300 hover:bg-red-500/10 transition" title="Удалить вариант">&times;</button>' +
            '</div>';
    }

    function renderUnitRows() {
        var box = $('#unit-rows');
        if (!box) return;
        var units = (state.editing && state.editing.units) || [];
        if (!units.length) units = [{ key: 'unit-1', label: '', price: 0, note: '' }];
        box.innerHTML = units.map(unitRowHtml).join('');
    }

    /* ---- Строки характеристик (spec) ------------------------------------- */

    function specRowHtml(value, i) {
        return '' +
            '<div class="spec-row flex gap-2" data-index="' + i + '">' +
                '<input class="spec-value flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm" ' +
                    'placeholder="Например: Толщина 190 мкм" value="' + esc(value) + '">' +
                '<button type="button" class="spec-del px-3 rounded-lg border border-red-500/30 text-red-300 ' +
                    'hover:bg-red-500/10 transition" title="Удалить характеристику">&times;</button>' +
            '</div>';
    }

    function renderSpecRows() {
        var box = $('#spec-rows');
        if (!box) return;
        var spec = (state.editing && state.editing.spec) || [];
        box.innerHTML = spec.map(specRowHtml).join('');
    }

    /* ---- Чтение формы ---------------------------------------------------- */

    /*
     * Собирает товар из полей формы. Возвращает { product } или { error }.
     * Ключи вариантов сохраняются, если поле непустое, — иначе генерируются.
     */
    function readProductForm() {
        var name = fieldValue('#prod-name').trim();
        if (!name) return { error: 'Введите название товара.' };

        var editingId = state.editing && state.editing.id;
        var isNew = !editingId;

        var taken = ((state.catalog && state.catalog.products) || [])
            .map(function (p) { return p.id; })
            .filter(function (id) { return id !== editingId; });

        var id = isNew ? uniqueId(slugify(name), taken) : editingId;

        var seen = {};
        var units = $$('.unit-row', $('#unit-rows')).map(function (row, i) {
            var label = $('.unit-label', row).value.trim();
            if (!label) return null;

            var rawKey = $('.unit-key', row).value.trim();
            var key = rawKey || slugify(label || ('unit-' + (i + 1)));
            if (seen[key]) key = key + '-' + (i + 1);
            seen[key] = true;

            return {
                key: key,
                label: label,
                price: Number($('.unit-price', row).value) || 0,
                note: $('.unit-note', row).value.trim()
            };
        }).filter(Boolean);

        if (!units.length) {
            return { error: 'Добавьте хотя бы один вариант покупки (например «Рулон» или «За метр»).' };
        }

        var spec = $$('.spec-row', $('#spec-rows')).map(function (row) {
            return $('.spec-value', row).value.trim();
        }).filter(Boolean);

        return {
            product: {
                id: id,
                category: fieldValue('#prod-category'),
                name: name,
                subtitle: fieldValue('#prod-subtitle').trim(),
                image: (state.editing && state.editing.image) || '',
                badge: fieldValue('#prod-badge') || 'brand-cyan',
                popular: !!($('#prod-popular') && $('#prod-popular').checked),
                hidden: !!($('#prod-hidden') && $('#prod-hidden').checked),
                description: fieldValue('#prod-description'),
                units: units,
                spec: spec
            }
        };
    }

    /*
     * Сохраняет товар. Порядок такой:
     *   1) если выбрано новое фото — сжимаем его и кладем в img/products/;
     *   2) собираем новый catalog.js и пишем одним коммитом.
     * Фото кладется ПЕРВЫМ: если второй шаг упадет, картинка уже будет
     * в репозитории, а catalog.js останется целым.
     */
    function saveProduct() {
        var read = readProductForm();
        if (read.error) { toast(read.error, 'err'); return; }

        var product = read.product;
        var isNew = !(state.editing && state.editing.id);
        var fileInput = $('#prod-image');

        return withBusy('Сохраняем товар…', function () {
            var prepared = Promise.resolve();

            if (fileInput && fileInput.files && fileInput.files[0]) {
                prepared = prepareProductImage(fileInput.files[0], product.id)
                    .then(function (path) { product.image = path; });
            }

            return prepared.then(function () {
                var model = state.catalog;
                model.updated = today();

                if (isNew) {
                    model.products.push(product);
                } else {
                    var idx = model.products.map(function (p) { return p.id; }).indexOf(product.id);
                    if (idx < 0) model.products.push(product);
                    else model.products[idx] = product;
                }

                return safeWrite(PATHS.catalog, buildCatalogText(model),
                    'admin: ' + (isNew ? 'добавлен товар ' : 'изменён товар ') + product.id
                ).then(function () {
                    state.editing = null;
                    return loadCatalog();
                }).then(function () {
                    closeProductForm();
                    toast(isNew
                        ? 'Товар добавлен. Сайт обновится через 1-2 минуты.'
                        : 'Товар сохранён. Сайт обновится через 1-2 минуты.', 'ok');
                });
            });
        }).catch(function (e) {
            toast(e.message || 'Не удалось сохранить товар.', 'err');
        });
    }

    /*
     * Сжимает картинку и кладет её в img/products/<slug>.jpg.
     * Имя детерминированное: повторная загрузка фото для того же товара
     * перезапишет старый файл, а не создаст мусор.
     */
    function prepareProductImage(file, productId) {
        if (!/^image\//.test(file.type)) {
            return Promise.reject(new Error('Это не изображение. Выберите файл JPG или PNG.'));
        }
        return downscaleImage(file).then(function (out) {
            var path = PATHS.productDir + slugify(productId) + '.jpg';
            if (out.blob.size > MAX_UPLOAD_BYTES) {
                toast('Фото большое (' + bytesText(out.blob.size) + '), загрузка займет время.', 'info');
            }
            return blobToBase64(out.blob).then(function (base64) {
                return uploadImage(path, base64, 'admin: фото товара ' + productId)
                    .then(function () { return path; });
            });
        });
    }

    function deleteProduct(index) {
        var products = (state.catalog && state.catalog.products) || [];
        var product = products[index];
        if (!product) return;

        var ok = window.confirm(
            'Удалить товар «' + product.name + '»?\n\n' +
            'Файл с фото останется в папке img/products/ — при желании удалите его на GitHub.'
        );
        if (!ok) return;

        return withBusy('Удаляем товар…', function () {
            var model = state.catalog;
            model.products = model.products.filter(function (p) { return p.id !== product.id; });
            model.updated = today();

            return safeWrite(PATHS.catalog, buildCatalogText(model),
                'admin: удалён товар ' + product.id
            ).then(function () {
                if (state.editing && state.editing.id === product.id) closeProductForm();
                return loadCatalog();
            }).then(function () {
                toast('Товар удалён. Сайт обновится через 1-2 минуты.', 'ok');
            });
        }).catch(function (e) {
            toast(e.message || 'Не удалось удалить товар.', 'err');
        });
    }

    /* ========================================================================
     *  9. ВКЛАДКА «РАБОТЫ» (галерея)
     * ====================================================================== */

    /*
     * Читает gallery.js. Если файла нет — предлагаем список старых фото
     * (gallery-1.jpg ... gallery-5.jpg) через seedGallery().
     */
    function parseGalleryText(text) {
        var src = String(text || '');
        var at = src.indexOf('window.LUMISTEK_GALLERY');
        if (at < 0) at = src.indexOf('LUMISTEK_GALLERY');
        if (at < 0) throw new Error('В файле gallery.js не найдена строка window.LUMISTEK_GALLERY.');

        var open = src.indexOf('{', at);
        if (open < 0) throw new Error('В файле gallery.js не найдена открывающая скобка.');

        var end = findMatchingBrace(src, open);
        if (end < 0) throw new Error('В файле gallery.js не сходятся скобки.');

        var model;
        try {
            model = parseJsLiteral(src.slice(open, end + 1));
        } catch (e) {
            throw new Error('Не удалось прочитать список работ: ' + (e && e.message ? e.message : e));
        }
        if (!model || typeof model !== 'object') throw new Error('Список работ пустой или поврежден.');
        if (!Array.isArray(model.photos)) model.photos = [];
        return model;
    }

    function loadGallery() {
        return withBusy('Загружаем работы…', function () {
            return readFile(PATHS.gallery).then(function (r) {
                if (!r.exists) {
                    state.gallery = seedGallery();
                    state.gallerySha = null;
                    renderGallery();
                    toast('Файла gallery.js нет — показан список старых фото.', 'info');
                    return;
                }
                state.gallery = parseGalleryText(r.text);
                state.gallerySha = r.sha;
                renderGallery();
            });
        }).catch(function (e) {
            toast(e.message || 'Не удалось загрузить работы.', 'err');
        });
    }

    function renderGallery() {
        var grid = $('#gallery-grid');
        var empty = $('#gallery-empty');
        var count = $('#gallery-count');
        if (!grid) return;

        var photos = (state.gallery && state.gallery.photos) || [];
        if (count) count.textContent = String(photos.length);

        if (!photos.length) {
            grid.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        grid.innerHTML = photos.map(function (p, i) {
            /*
             * Путь может быть от корня сайта ('img/gallery/x.jpg') или
             * просто из корня ('gallery-1.jpg'). Панель лежит в /adminpanel/,
             * поэтому к относительным путям добавляем '../'.
             */
            var src = /^(https?:)?\/\//.test(p.file) ? p.file : '../' + p.file;

            return '' +
                '<figure class="relative group rounded-xl overflow-hidden border border-white/10 bg-white/5">' +
                    '<img src="' + esc(src) + '" alt="" class="w-full h-32 object-cover" loading="lazy">' +
                    '<button type="button" data-gdel="' + i + '" ' +
                        'class="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/70 border border-red-500/40 ' +
                        'text-red-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition" ' +
                        'title="Удалить фото">&times;</button>' +
                    '<figcaption class="px-2 py-1.5">' +
                        '<div class="text-[11px] text-gray-500 font-mono truncate" title="' + esc(p.file) + '">' +
                            esc(p.file) + '</div>' +
                    '</figcaption>' +
                '</figure>';
        }).join('');
    }

    /*
     * Готовит одно фото: сжимает и кладет в img/gallery/.
     * Имя — из исходного названия плюс дата и случайное число,
     * чтобы разные фото не перезаписывали друг друга.
     */
    function uploadGalleryPhoto(file) {
        if (!/^image\//.test(file.type)) {
            return Promise.reject(new Error('Файл «' + file.name + '» — не изображение.'));
        }

        return downscaleImage(file).then(function (out) {
            if (out.blob.size > MAX_UPLOAD_BYTES) {
                toast('Фото «' + file.name + '» большое (' + bytesText(out.blob.size) + ').', 'info');
            }
            var base = String(file.name).replace(/\.[^.]+$/, '');
            var name = slugify(base) + '-' + today().replace(/-/g, '') + '-' +
                Math.floor(Math.random() * 9000 + 1000) + '.jpg';
            var path = PATHS.galleryDir + name;

            return blobToBase64(out.blob)
                .then(function (base64) {
                    return uploadImage(path, base64, 'admin: добавлено фото ' + name);
                })
                .then(function () {
                    return { file: path, caption: '' };
                });
        });
    }

    function saveGallery() {
        var model = state.gallery;
        if (!model) return Promise.reject(new Error('Список работ не загружен.'));

        model.updated = today();
        return safeWrite(PATHS.gallery, buildGalleryText(model), 'admin: обновлён список работ')
            .then(function () { return loadGallery(); })
            .then(function () {
                toast('Список работ сохранён. Сайт обновится через 1-2 минуты.', 'ok');
            });
    }

    /* Файлы загружаем по очереди — чтобы не перегружать GitHub параллелью. */
    function handleGalleryFiles(files) {
        var list = Array.prototype.slice.call(files || []);
        if (!list.length) return Promise.resolve();

        return withBusy('Загружаем фото (0/' + list.length + ')…', function () {
            var chain = Promise.resolve();
            var done = 0;

            list.forEach(function (file) {
                chain = chain.then(function () {
                    return uploadGalleryPhoto(file).then(function (photo) {
                        state.gallery.photos.push(photo);
                        done++;
                        var label = $('#busy-text');
                        if (label) label.textContent = 'Загружаем фото (' + done + '/' + list.length + ')…';
                        renderGallery();
                    });
                });
            });

            return chain.then(function () { return saveGallery(); });
        }).catch(function (e) {
            toast(e.message || 'Не удалось загрузить фото.', 'err');
        });
    }

    function deleteGalleryPhoto(index) {
        var photos = (state.gallery && state.gallery.photos) || [];
        var photo = photos[index];
        if (!photo) return;

        var ok = window.confirm(
            'Убрать это фото из галереи?\n\n' + photo.file + '\n\n' +
            'Сам файл останется в папке img/gallery/ — при желании удалите его на GitHub.'
        );
        if (!ok) return;

        return withBusy('Убираем фото…', function () {
            state.gallery.photos.splice(index, 1);
            return saveGallery();
        }).catch(function (e) {
            toast(e.message || 'Не удалось убрать фото.', 'err');
        });
    }

    /* ========================================================================
     *  10. ВКЛАДКА «ВИДЕО»
     * ====================================================================== */

    /*
     * Читает config.js ЦЕЛИКОМ и запоминает sha. Файл не пересобирается:
     * заменяется ровно блок fallbackShorts, остальные байты (включая
     * русские комментарии) остаются нетронутыми.
     */
    function loadVideos() {
        return withBusy('Загружаем видео…', function () {
            var jobs = [
                readFile(PATHS.config).then(function (r) {
                    if (!r.exists) throw new Error('В репозитории нет файла assets/js/config.js.');
                    state.configText = r.text;
                    state.configSha = r.sha;
                    state.shorts = parseShortsEntries(r.text);
                }),

                /* news.json только читаем: он показывает, что уже на сайте. */
                readFile(PATHS.news).then(function (r) {
                    if (!r.exists) { state.news = null; return; }
                    try { state.news = JSON.parse(r.text); }
                    catch (e) { state.news = null; }
                }).catch(function () { state.news = null; })
            ];

            return Promise.all(jobs);
        }).then(function () {
            renderVideos();
        }).catch(function (e) {
            toast(e.message || 'Не удалось загрузить видео.', 'err');
        });
    }

    function renderVideos() {
        renderLiveVideos();
        renderShorts();
    }

    /* Видео из news.json — только для справки, панель их не меняет. */
    function renderLiveVideos() {
        var box = $('#videos-live');
        if (!box) return;

        var videos = (state.news && Array.isArray(state.news.videos)) ? state.news.videos : [];
        var label = $('#videos-live-count');
        if (label) label.textContent = String(videos.length);

        if (!videos.length) {
            box.innerHTML = '<li class="text-sm text-gray-500 py-2">' +
                'Список пуст или news.json недоступен. Он обновляется роботом раз в сутки.</li>';
            return;
        }

        box.innerHTML = videos.map(function (v) {
            var date = String(v.published || '').slice(0, 10);
            return '' +
                '<li class="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">' +
                    '<span class="text-[11px] text-gray-600 font-mono w-20 shrink-0">' + esc(date) + '</span>' +
                    '<span class="text-sm text-gray-300 flex-1 truncate" title="' + esc(v.title) + '">' +
                        esc(v.title) + '</span>' +
                    '<a href="https://www.youtube.com/watch?v=' + encodeURIComponent(v.id) + '" ' +
                        'target="_blank" rel="noopener" ' +
                        'class="text-xs text-brand-cyan hover:underline shrink-0">открыть</a>' +
                '</li>';
        }).join('');
    }

    /* Резервный список fallbackShorts — его панель и правит. */
    function renderShorts() {
        var box = $('#shorts-list');
        var empty = $('#shorts-empty');
        var count = $('#shorts-count');
        if (!box) return;

        var list = state.shorts || [];
        if (count) count.textContent = String(list.length);

        if (!list.length) {
            box.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        box.innerHTML = list.map(function (s, i) {
            return '' +
                '<div class="shorts-row grid grid-cols-12 gap-2 items-center" data-index="' + i + '">' +
                    '<span class="col-span-1 text-xs text-gray-600 text-center font-mono">' + (i + 1) + '</span>' +
                    '<input class="short-title col-span-6 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm" ' +
                        'placeholder="Подпись на карточке" value="' + esc(s.title) + '">' +
                    '<input class="short-date col-span-2 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm" ' +
                        'placeholder="2026-01-01" value="' + esc(s.date) + '">' +
                    '<span class="col-span-2 text-[11px] text-gray-500 font-mono truncate" title="' + esc(s.id) + '">' +
                        esc(s.id) + '</span>' +
                    '<button type="button" class="short-del col-span-1 py-2 rounded-lg border border-red-500/30 ' +
                        'text-red-300 hover:bg-red-500/10 transition" title="Удалить">&times;</button>' +
                '</div>';
        }).join('');
    }

    /*
     * Добавляет видео: из ссылки достаем 11-символьный код.
     * Новое видео встает СВЕРХУ — на сайте порядок сверху вниз,
     * самые новые первыми.
     */
    function addShort(url, title) {
        var id = parseYouTubeId(url);
        if (!id) {
            toast('Не удалось разобрать ссылку. Нужна ссылка вида ' +
                'https://www.youtube.com/shorts/XXXXXXXXXXX', 'err');
            return false;
        }

        var exists = (state.shorts || []).some(function (s) { return s.id === id; });
        if (exists) {
            toast('Это видео уже есть в списке.', 'err');
            return false;
        }

        state.shorts.unshift({
            id: id,
            title: String(title || '').trim() || 'Видео Lumistek',
            date: today()
        });

        renderShorts();
        toast('Видео добавлено в список. Не забудьте нажать «Сохранить».', 'info');
        return true;
    }

    function removeShort(index) {
        if (!state.shorts || !state.shorts[index]) return;
        state.shorts.splice(index, 1);
        renderShorts();
    }

    /* Считывает подписи и даты прямо из полей списка видео. */
    function collectShortsFromForm() {
        var rows = $$('.shorts-row', $('#shorts-list'));
        var list = [];

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var id = (state.shorts[i] && state.shorts[i].id) || '';
            if (!id) continue;

            var title = $('.short-title', row).value.trim();
            if (!title) {
                return { error: 'У видео №' + (i + 1) + ' пустая подпись. Заполните её или удалите видео.' };
            }

            list.push({
                id: id,
                title: title,
                date: normalizeDate($('.short-date', row).value)
            });
        }

        return { list: list };
    }

    /*
     * Заменяет блок fallbackShorts в config.js и пишет файл.
     * Перед записью заново читаем текст и свежий sha — чтобы не потерять
     * чужие правки и не получить конфликт версий.
     */
    function saveShorts() {
        var fromForm = collectShortsFromForm();
        if (fromForm.error) { toast(fromForm.error, 'err'); return Promise.resolve(); }
        state.shorts = fromForm.list;

        return withBusy('Сохраняем видео…', function () {
            return readFile(PATHS.config).then(function (r) {
                if (!r.exists) throw new Error('В репозитории нет файла assets/js/config.js.');

                var out = replaceShortsBlock(r.text, state.shorts);
                if (!out.ok) throw new Error(out.error);

                return writeFile(PATHS.config, out.text, r.sha, 'admin: обновлён список видео');
            });
        }).then(function () {
            return loadVideos();
        }).then(function () {
            toast('Список видео сохранён. Сайт обновится через 1-2 минуты.', 'ok');
        }).catch(function (e) {
            toast(e.message || 'Не удалось сохранить видео.', 'err');
        });
    }

    /* ========================================================================
     *  11. ЗАПУСК
     * ====================================================================== */

    function initPanel() {
        /* Выход: забываем вход в этой вкладке браузера. */
        var logout = $('#logout-btn');
        if (logout) {
            logout.addEventListener('click', function () {
                sessionStorage.removeItem(SS_AUTH);
                state.catalog = null;
                state.gallery = null;
                state.configText = null;
                state.shorts = [];
                state.news = null;
                location.reload();
            });
        }

        /* Возврат к экрану подключения. */
        var toSetup = $('#open-settings');
        if (toSetup) toSetup.addEventListener('click', function () { showScreen('setup'); });

        TABS.forEach(function (t) {
            var btn = $(t.btn);
            if (btn) btn.addEventListener('click', function () { switchTab(t.key); });
        });

        initProductsTab();
        initGalleryTab();
        initVideosTab();
    }

    function initProductsTab() {
        var add = $('#product-add');
        if (add) add.addEventListener('click', function () { openProductForm(null); });

        var cancel = $('#product-cancel');
        if (cancel) cancel.addEventListener('click', closeProductForm);

        var save = $('#product-save');
        if (save) save.addEventListener('click', function () { saveProduct(); });

        /*
         * Изменить/удалить товар. Вешаем на таблицу через делегирование:
         * строки перерисовываются, отдельные обработчики бы потерялись.
         */
        var body = $('#products-body');
        if (body) {
            body.addEventListener('click', function (e) {
                var editBtn = e.target.closest ? e.target.closest('[data-edit]') : null;
                if (editBtn) {
                    var idxEdit = Number(editBtn.getAttribute('data-edit'));
                    var products = (state.catalog && state.catalog.products) || [];
                    if (products[idxEdit]) openProductForm(products[idxEdit]);
                    return;
                }

                var delBtn = e.target.closest ? e.target.closest('[data-del]') : null;
                if (delBtn) deleteProduct(Number(delBtn.getAttribute('data-del')));
            });
        }

        var del = $('#product-delete');
        if (del) {
            del.addEventListener('click', function () {
                if (!state.editing) return;
                var products = (state.catalog && state.catalog.products) || [];
                var idx = products.map(function (p) { return p.id; }).indexOf(state.editing.id);
                if (idx >= 0) deleteProduct(idx);
            });
        }

        /* Новый вариант покупки. */
        var addUnit = $('#unit-add');
        if (addUnit) {
            addUnit.addEventListener('click', function () {
                var saved = collectUnitRows();
                saved.push({ key: '', label: '', price: 0, note: '' });
                if (state.editing) state.editing.units = saved;
                renderUnitRows();
            });
        }

        var unitBox = $('#unit-rows');
        if (unitBox) {
            unitBox.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('.unit-del') : null;
                if (!btn) return;

                var saved = collectUnitRows();
                saved.splice(Number(btn.parentNode.getAttribute('data-index')), 1);
                if (state.editing) state.editing.units = saved;
                renderUnitRows();
            });
        }

        /* Новая характеристика. */
        var addSpec = $('#spec-add');
        if (addSpec) {
            addSpec.addEventListener('click', function () {
                var saved = collectSpecRows();
                saved.push('');
                if (state.editing) state.editing.spec = saved;
                renderSpecRows();
            });
        }

        var specBox = $('#spec-rows');
        if (specBox) {
            specBox.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('.spec-del') : null;
                if (!btn) return;

                var saved = collectSpecRows();
                saved.splice(Number(btn.parentNode.getAttribute('data-index')), 1);
                if (state.editing) state.editing.spec = saved;
                renderSpecRows();
            });
        }

        /* Подпись выбранного файла. */
        var file = $('#prod-image');
        if (file) {
            file.addEventListener('change', function () {
                var chosen = this.files && this.files[0];
                $('#prod-image-path').textContent = chosen
                    ? chosen.name + ' (' + bytesText(chosen.size) + ')'
                    : ((state.editing && state.editing.image) || 'файл не выбран');
            });
        }
    }

    /*
     * Считывает строки вариантов прямо из DOM, включая пустые.
     * Нужно, чтобы правки не терялись при нажатии «добавить»/«удалить»,
     * пока пользователь еще не сохранил товар.
     */
    function collectUnitRows() {
        return $$('.unit-row', $('#unit-rows')).map(function (row) {
            return {
                key: $('.unit-key', row).value.trim(),
                label: $('.unit-label', row).value,
                price: Number($('.unit-price', row).value) || 0,
                note: $('.unit-note', row).value
            };
        });
    }

    function collectSpecRows() {
        return $$('.spec-row', $('#spec-rows')).map(function (row) {
            return $('.spec-value', row).value;
        });
    }

    function initGalleryTab() {
        var picker = $('#gallery-files');
        if (picker) {
            picker.addEventListener('change', function () {
                var files = this.files;
                this.value = '';
                handleGalleryFiles(files);
            });
        }

        var grid = $('#gallery-grid');
        if (grid) {
            grid.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('[data-gdel]') : null;
                if (btn) deleteGalleryPhoto(Number(btn.getAttribute('data-gdel')));
            });
        }

        var reload = $('#gallery-reload');
        if (reload) reload.addEventListener('click', function () { loadGallery(); });
    }

    function initVideosTab() {
        var add = $('#short-add');
        if (add) {
            add.addEventListener('click', function () {
                var url = $('#short-url').value;
                var title = $('#short-title').value;
                if (addShort(url, title)) {
                    $('#short-url').value = '';
                    $('#short-title').value = '';
                }
            });
        }

        var box = $('#shorts-list');
        if (box) {
            box.addEventListener('click', function (e) {
                var btn = e.target.closest ? e.target.closest('.short-del') : null;
                if (btn) removeShort(Number(btn.parentNode.getAttribute('data-index')));
            });
        }

        var save = $('#shorts-save');
        if (save) save.addEventListener('click', function () { saveShorts(); });

        var reload = $('#videos-reload');
        if (reload) reload.addEventListener('click', function () { loadVideos(); });
    }

    /* Запуск после входа: нет токена — сразу настройки, иначе панель. */
    function boot() {
        if (!hasToken()) {
            showScreen('setup');
            setSetupStatus('info',
                'Впишите токен GitHub и нажмите «Проверить подключение». ' +
                'Без токена панель не сможет сохранять изменения.');
        } else {
            openPanel();
        }
    }

    /* ========================================================================
     *  12. СТАРТ
     * ====================================================================== */

    function main() {
        loadSettings();

        if (initGate()) {
            /* Пароль еще не введен — показываем только заслонку. */
            showScreen('gate');
        } else {
            /* Уже входили в этой вкладке браузера. */
            boot();
        }

        initSetup();
        initPanel();
    }

    /*
     * Запуск только в браузере. Под Node (офлайн-тест чистых функций)
     * объекта document нет — тогда просто отдаем экспорт ниже.
     */
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', main);
        } else {
            main();
        }
    }

    /* ========================================================================
     *  13. ЭКСПОРТ ДЛЯ ОФЛАЙН-ТЕСТА
     *
     *  Это чистые функции текста: они не трогают DOM и сеть.
     *  Браузеру module не нужен, поэтому сначала проверяем, что он есть.
     * ====================================================================== */

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            buildCatalogText: buildCatalogText,
            buildGalleryText: buildGalleryText,
            replaceShortsBlock: replaceShortsBlock,
            findShortsRange: findShortsRange,
            parseShortsEntries: parseShortsEntries,
            parseCatalogText: parseCatalogText,
            collectSeparators: collectSeparators,
            separatorLine: separatorLine,
            parseGalleryText: parseGalleryText,
            slugify: slugify,
            uniqueId: uniqueId,
            parseYouTubeId: parseYouTubeId,
            seedGallery: seedGallery,
            translit: translit,
            normalizeDate: normalizeDate,
            isJsSafe: isJsSafe,
            parseJsLiteral: parseJsLiteral,
            checkStructureBalance: checkStructureBalance
        };
    }

})();
