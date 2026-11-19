/**
 * ============================================================================
 *  LUMISTEK — ЯДРО ВКЛАДКИ «ТЕКСТЫ»: СЛОВАРЬ ПЕРЕВОДОВ assets/js/i18n.js
 *  adminpanel/texts-i18n.js
 * ============================================================================
 *
 *  ЭТО НЕ ИНТЕРФЕЙС. Ни DOM, ни сети, ни state — как и в texts.js.
 *
 *  ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ.
 *  i18n.js — не HTML и не текст, а литерал объекта:
 *
 *      window.LUMISTEK_I18N = {
 *          ar: { "nav.about": "عن الشركة", ... },
 *          en: { "nav.about": "About Us", ... }
 *      };
 *
 *  Значит, HTML-валидатор к нему неприменим (он ищет теги), а проверять
 *  всё равно надо: правка уезжает в main сразу на витрину.
 *
 *  ГЛАВНЫЕ ПРАВИЛА ЭТОГО ФАЙЛА:
 *
 *    1) КЛЮЧ НЕ РЕДАКТИРУЕТСЯ И НЕ УДАЛЯЕТСЯ. Список строится из словаря,
 *       а не из разметки, поэтому владелец физически не может переименовать
 *       ключ и порвать связь data-i18n="nav.about" → словарь.
 *
 *    2) ЗАПИСЬ — ОДИН СПЛАЙС ПО ГРАНИЦАМ СОДЕРЖИМОГО, без кавычек:
 *          src.slice(0, start) + escaped + src.slice(end)
 *       Кавычки-ограничители, двоеточие, запятая, переводы строк и
 *       комментарии остаются байт в байт.
 *
 *    3) ПОЗИЦИИ ИЩЕТ СВОЙ СКАНЕР, А НЕ РЕГУЛЯРКА ПО СТРОКЕ. В значениях
 *       встречается \" (восемь раз), и регулярка по строке рвёт такое
 *       значение на части молча. Сканер идёт по литералу и учитывает «\».
 *
 *    4) НИКАКОГО new Function / eval. Разбор — свой, на том же принципе,
 *       что parseJsLiteral в admin.js: читаем текст, а не выполняем его.
 *
 *  ФАЙЛ ОДИН И ТОТ ЖЕ В ОБОИХ РЕПОЗИТОРИЯХ, БАЙТ В БАЙТ:
 *  см. work/texts-editor/check-parity.cjs.
 *
 * ============================================================================
 */

(function (root) {
    'use strict';

    /* ========================================================================
     *  0. МЕЛОЧИ
     * ====================================================================== */

    function problem(code, message, at, severity) {
        return {
            code: code,
            message: message,
            at: (typeof at === 'number' ? at : null),
            severity: severity || 'error'
        };
    }

    function lineOf(src, at) {
        var upto = String(src).slice(0, Math.max(0, at));
        var n = 1;
        for (var i = 0; i < upto.length; i++) if (upto.charCodeAt(i) === 10) n++;
        return n;
    }

    function verdict(problems) {
        var errors = [];
        var warns = [];
        for (var i = 0; i < problems.length; i++) {
            if (problems[i].severity === 'warn' || problems[i].severity === 'info') warns.push(problems[i]);
            else errors.push(problems[i]);
        }
        return { ok: errors.length === 0, problems: problems, errors: errors, warnings: warns };
    }

    /* ========================================================================
     *  1. СКАНЕР ЛИТЕРАЛА
     *
     *  Проход по тексту файла с учётом строк и комментариев. Возвращает
     *  позиции блоков языков и каждой пары «ключ: значение».
     * ====================================================================== */

    /* Пропуск пробелов и комментариев. */
    function skipSpace(src, pos) {
        var n = src.length;
        var i = pos;
        while (i < n) {
            var c = src.charAt(i);
            if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v' ||
                c === '\u00a0' || c === '\ufeff') {
                i++;
                continue;
            }
            if (c === '/' && src.charAt(i + 1) === '/') {
                i += 2;
                while (i < n && src.charAt(i) !== '\n') i++;
                continue;
            }
            if (c === '/' && src.charAt(i + 1) === '*') {
                var close = src.indexOf('*/', i + 2);
                if (close < 0) throw new Error('Не закрыт комментарий /* ... */');
                i = close + 2;
                continue;
            }
            break;
        }
        return i;
    }

    /*
     * Читает строку в кавычке и возвращает:
     *   { value, start, end, quote }
     * где start/end — границы СОДЕРЖИМОГО, без кавычек.
     * Учитывает «\», поэтому \" внутри значения не обрывает его.
     */
    function readString(src, pos) {
        var n = src.length;
        var quote = src.charAt(pos);
        if (quote !== '"' && quote !== "'") throw new Error('Ожидалась кавычка');
        var i = pos + 1;
        var start = i;
        var out = '';

        while (i < n) {
            var c = src.charAt(i);
            if (c === '\\') {
                var e = src.charAt(i + 1);
                if (e === '') break;
                if (e === 'n') { out += '\n'; i += 2; continue; }
                if (e === 't') { out += '\t'; i += 2; continue; }
                if (e === 'r') { out += '\r'; i += 2; continue; }
                if (e === 'b') { out += '\b'; i += 2; continue; }
                if (e === 'f') { out += '\f'; i += 2; continue; }
                if (e === 'v') { out += '\v'; i += 2; continue; }
                if (e === '0') { out += '\0'; i += 2; continue; }
                if (e === 'u') {
                    if (src.charAt(i + 2) === '{') {
                        var shut = src.indexOf('}', i + 3);
                        if (shut < 0) throw new Error('Не закрыт \\u{...} в строке');
                        var hex2 = src.slice(i + 3, shut);
                        if (!/^[0-9a-fA-F]+$/.test(hex2)) throw new Error('Некорректный \\u{...} в строке');
                        out += String.fromCodePoint(parseInt(hex2, 16));
                        i = shut + 1;
                        continue;
                    }
                    var hex4 = src.slice(i + 2, i + 6);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex4)) throw new Error('Некорректная последовательность \\uXXXX');
                    out += String.fromCharCode(parseInt(hex4, 16));
                    i += 6;
                    continue;
                }
                out += e;
                i += 2;
                continue;
            }
            if (c === quote) {
                return { value: out, start: start, end: i, quote: quote };
            }
            if (c === '\n') throw new Error('Строка не закрыта кавычкой');
            out += c;
            i++;
        }
        throw new Error('Строка не закрыта кавычкой');
    }

    /*
     * Читает объект-словарь и собирает записи по строкам.
     *
     * Возвращает:
     *   entries[] — { key, lang, value, start, end, quote, line }
     *   blocks    — { ar: {start, end}, en: {...} } для быстрых проверок
     *
     * Перебираем именно плоский объект «ключ: значение»: в i18n.js
     * вложенности нет и не будет — это словарь, а не дерево.
     */
    function readDictionary(src, openBrace, out, lang) {
        var n = src.length;
        var i = skipSpace(src, openBrace);
        if (src.charAt(i) !== '{') throw new Error('Ожидалась { для раздела ' + lang);

        var blockStart = i;
        i++;
        var depth = 1;

        while (i < n) {
            i = skipSpace(src, i);
            if (i >= n) throw new Error('Не закрыта фигурная скобка раздела ' + lang);

            if (src.charAt(i) === '}') {
                depth--;
                i++;
                out.blocks[lang] = { start: blockStart, end: i };
                return i;
            }

            var keyPos = i;
            var keyTok;
            var c = src.charAt(i);

            if (c === '"' || c === "'") {
                keyTok = readString(src, i);
                i = keyTok.end + 1;
            } else if (/[$A-Za-z_\u00c0-\uffff]/.test(c)) {
                var k0 = i;
                while (i < n && /[$A-Za-z0-9_\u00c0-\uffff]/.test(src.charAt(i))) i++;
                keyTok = { value: src.slice(k0, i), start: k0, end: i, quote: null };
            } else {
                throw new Error('В разделе ' + lang + ' ожидался ключ, а встретилось: ' + c);
            }

            i = skipSpace(src, i);
            if (src.charAt(i) !== ':') {
                throw new Error('После ключа «' + keyTok.value + '» ожидалось двоеточие');
            }
            i = skipSpace(src, i + 1);

            var q = src.charAt(i);
            if (q !== '"' && q !== "'") {
                /* Значение не строкой (число, true, вложенный объект) —
                   для словаря это ошибка формата, но словарь мы не ломаем:
                   просто не показываем такое поле владельцу. */
                var v0 = i;
                while (i < n && !',}'.includes(src.charAt(i))) i++;
                out.skipped.push({ key: keyTok.value, lang: lang, at: keyPos });
            } else {
                var val = readString(src, i);
                out.entries.push({
                    key: keyTok.value,
                    lang: lang,
                    value: val.value,
                    start: val.start,
                    end: val.end,
                    quote: val.quote,
                    line: lineOf(src, keyPos)
                });
                i = val.end + 1;
            }

            i = skipSpace(src, i);
            if (src.charAt(i) === ',') { i++; continue; }
            if (src.charAt(i) === '}') { continue; }
            throw new Error('После значения ключа «' + keyTok.value + '» ожидалась запятая или }');
        }

        throw new Error('Не закрыта фигурная скобка раздела ' + lang);
    }

    /* Позиция первого «{» после искомого имени. */
    function braceAfter(src, pos) {
        var i = skipSpace(src, pos);
        if (src.charAt(i) !== '{') return -1;
        return i;
    }

    /**
     * Разбирает файл словаря.
     *
     * @param {string} text Исходный текст assets/js/i18n.js.
     * @return {Object} { model, entries, blocks, skipped, problems }
     */
    function parseI18n(text) {
        var src = String(text == null ? '' : text);
        var out = { entries: [], blocks: {}, skipped: [] };
        var problems = [];

        var model = { ar: {}, en: {} };
        var anchor = -1;

        try {
            /* Точка отсчёта — присваивание window.LUMISTEK_I18N = { ... }.
               Если его нет, литерал ищем по первому «{ ar:» — так файл
               можно разобрать, даже если имя переменной поменяли. */
            var m = /window\.LUMISTEK_I18N\s*=\s*/.exec(src);
            if (m) {
                anchor = braceAfter(src, m.index + m[0].length);
            } else {
                var alt = /\{\s*ar\s*:/.exec(src);
                if (alt) anchor = alt.index;
            }

            if (anchor < 0) {
                problems.push(problem('no_literal',
                    'В файле не найден словарь (window.LUMISTEK_I18N = { ... }).'));
                return { model: model, entries: [], blocks: {}, skipped: [], problems: problems };
            }

            var i = skipSpace(src, anchor);
            if (src.charAt(i) !== '{') throw new Error('После window.LUMISTEK_I18N ожидалась {');
            i++;

            for (;;) {
                i = skipSpace(src, i);
                if (i >= src.length) throw new Error('Не закрыт словарь');
                if (src.charAt(i) === '}') break;

                /* Имя раздела: "ar" / 'ar' / ar — все три варианта валидны. */
                var langTok;
                var lc = src.charAt(i);
                if (lc === '"' || lc === "'") {
                    var lit = readString(src, i);
                    langTok = { value: lit.value, end: lit.end };
                    i = lit.end + 1;
                } else if (/[$A-Za-z_]/.test(lc)) {
                    var l0 = i;
                    while (i < src.length && /[$A-Za-z0-9_]/.test(src.charAt(i))) i++;
                    langTok = { value: src.slice(l0, i), end: i };
                } else {
                    throw new Error('Ожидалось имя раздела, а встретилось: ' + lc);
                }
                i = skipSpace(src, i);
                if (src.charAt(i) !== ':') throw new Error('Ожидалось двоеточие после ' + langTok.value);
                i = skipSpace(src, i + 1);

                var lang = langTok.value;
                if (!model[lang]) model[lang] = {};

                var blockOut = { entries: [], blocks: out.blocks, skipped: out.skipped };
                i = readDictionary(src, i, blockOut, lang);

                /* Значения — в модель. Именно из словаря строится список,
                   а не из HTML: HTML нужен только для «где используется». */
                for (var e = 0; e < blockOut.entries.length; e++) {
                    var rec = blockOut.entries[e];
                    model[lang][rec.key] = rec.value;
                    out.entries.push(rec);
                }

                i = skipSpace(src, i);
                if (src.charAt(i) === ',') { i++; continue; }
                if (src.charAt(i) === '}') break;
                throw new Error('После раздела ' + lang + ' ожидалась запятая или }');
            }
        } catch (err) {
            problems.push(problem('parse_error',
                'Не удалось прочитать словарь: ' + (err && err.message ? err.message : err)));
        }

        /* Дубли ключей внутри языка — тихая поломка: сайт возьмёт последний. */
        var seen = Object.create(null);
        for (var k = 0; k < out.entries.length; k++) {
            var en = out.entries[k];
            var sig = en.lang + '\u0000' + en.key;
            if (seen[sig] !== undefined) {
                problems.push(problem('duplicate_key',
                    'Ключ «' + en.key + '» записан в разделе ' + en.lang + ' дважды (строка ' +
                    en.line + '). Так делать нельзя: сайт возьмёт последнюю версию.', en.start, 'warn'));
            }
            seen[sig] = true;
        }

        /* Наборы ключей ar и en должны совпадать — иначе на сайте пустые места. */
        var arKeys = Object.keys(model.ar);
        var enKeys = Object.keys(model.en);
        for (var a = 0; a < arKeys.length; a++) {
            if (!(arKeys[a] in model.en)) {
                problems.push(problem('key_missing',
                    'Ключ «' + arKeys[a] + '» есть в арабском, но отсутствует в английском.', null, 'warn'));
            }
        }
        for (var b = 0; b < enKeys.length; b++) {
            if (!(enKeys[b] in model.ar)) {
                problems.push(problem('key_missing',
                    'Ключ «' + enKeys[b] + '» есть в английском, но отсутствует в арабском.', null, 'warn'));
            }
        }

        return {
            model: model,
            entries: out.entries,
            blocks: out.blocks,
            skipped: out.skipped,
            problems: problems
        };
    }

    /* ========================================================================
     *  2. ЭКРАНИРОВАНИЕ ЗНАЧЕНИЯ
     *
     *  Владелец вводит то, что должен увидеть посетитель. В файле это
     *  значение живёт внутри двойных кавычек, поэтому кавычку и обратный
     *  слэш надо экранировать. Переводы строк уходят в \n: многострочное
     *  значение разорвало бы литерал.
     * ====================================================================== */

    function escapeJsValue(value) {
        return String(value == null ? '' : value)
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }

    /* Обратная операция — для тестов и для показа значения в поле. */
    function unescapeJsValue(raw) {
        var s = String(raw == null ? '' : raw);
        try {
            return readString('"' + s + '"', 0).value;
        } catch (e) {
            return s;
        }
    }

    /* Найти запись по ключу и языку. Ключи уникальны, поэтому первая же. */
    function findEntry(entries, key, lang) {
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].key === key && entries[i].lang === lang) return entries[i];
        }
        return null;
    }

    /**
     * Правит одно значение словаря.
     *
     * @param {string} text Исходный текст i18n.js.
     * @param {string} key Ключ словаря (не меняется).
     * @param {string} lang 'ar' или 'en'.
     * @param {string} value Новое значение (как его увидит посетитель).
     * @param {Object=} entry Запись с известными смещениями (если уже разобрали).
     * @return {Object} { text, ok, problems, value }
     */
    function applyI18nEdit(text, key, lang, value, entry) {
        var src = String(text == null ? '' : text);
        var parsed = null;
        var rec = entry || null;

        if (!rec) {
            parsed = parseI18n(src);
            var fatal = parsed.problems.filter(function (p) { return p.severity === 'error'; });
            if (fatal.length) {
                return { text: null, ok: false, value: String(value), problems: fatal };
            }
            rec = findEntry(parsed.entries, key, lang);
        }

        if (!rec) {
            return {
                text: null, ok: false, value: String(value),
                problems: [problem('no_key',
                    'Ключ «' + key + '» не найден в разделе ' + lang + '. ' +
                    'Ключи через вкладку не добавляются и не удаляются — меняется только текст.')]
            };
        }

        var escaped = escapeJsValue(value);

        /* Смещения записи должны указывать на прежний разобранный текст.
           Иначе сплайс вырежет не тот кусок — а это молчаливая порча файла.
           Проверяем через unescape: значение содержит реальные переводы
           строк, а в файле лежит уже экранированным (\n, \"). */
        var current = src.slice(rec.start, rec.end);
        if (current !== rec.value && unescapeJsValue(current) !== rec.value) {
            return {
                text: null, ok: false, value: String(value),
                problems: [problem('position_stale',
                    'Файл словаря изменился с тех пор, как открыли список. ' +
                    'Обновите список и найдите ключ заново — запись не выполнялась.', rec.start)]
            };
        }

        /* ЕДИНСТВЕННАЯ МУТАЦИЯ: один сплайс по границам содержимого.
           Кавычки, двоеточие, запятая и отступы остаются байт в байт. */
        var after = src.slice(0, rec.start) + escaped + src.slice(rec.end);

        var check = validateI18nEdit(src, after, {
            key: rec.key,
            lang: rec.lang,
            value: String(value),
            entry: rec
        });

        if (!check.ok) {
            return { text: null, ok: false, value: String(value), problems: check.problems };
        }

        return { text: after, ok: true, value: String(value), problems: check.problems };
    }

    /* ========================================================================
     *  3. ВАЛИДАТОР СЛОВАРЯ
     * ====================================================================== */

    /*
     * Разрешённая разметка внутри значения: только <br> в любом написании —
     * <br>, <br/>, <br />, <br class="hidden md:block"/>. Именно так размечены
     * 16 значений словаря на самом деле.
     *
     * Причина ограничения: сайт вставляет такие значения через lang.js, и
     * лишний тег — это уже вставка разметки в страницу, а не правка текста.
     * Владелец, вставивший <div>, сломает вёрстку молча.
     */
    var BR_TAG = /<br(?:\s[^<>]*)?\/?>/gi;

    function badMarkupInValue(value) {
        var stripped = String(value).replace(BR_TAG, '');
        if (!/[<>]/.test(stripped)) return null;
        var m = /<\/?([a-zA-Z][-a-zA-Z0-9]*)/.exec(stripped);
        return m ? m[1].toLowerCase() : 'неизвестный тег';
    }

    /**
     * Проверка правки словаря.
     *
     * Порядок проверок — от самых опасных. Все выполняются, короткого
     * замыкания нет: владелец должен видеть полную картину.
     *
     * @param {string} before Исходный текст i18n.js.
     * @param {string} after Текст после сплайса.
     * @param {Object=} expect { key, lang, value, entry }.
     * @return {Object} { ok, problems, errors, warnings }
     */
    function validateI18nEdit(before, after, expect) {
        var b = String(before == null ? '' : before);
        var a = String(after == null ? '' : after);
        var problems = [];

        var want = expect || null;

        /* --- 1. Файл после правки разбирается целиком ---------------------- */
        var pa = parseI18n(a);
        var parseErrors = pa.problems.filter(function (p) { return p.severity === 'error'; });
        if (parseErrors.length) {
            for (var e = 0; e < parseErrors.length; e++) problems.push(parseErrors[e]);
            problems.push(problem('broken_literal',
                'После такой правки файл словаря перестал читаться, поэтому запись отменена. ' +
                'Скорее всего в тексте осталась незакрытая кавычка.'));
            return verdict(problems);
        }

        var pb = parseI18n(b);

        /* --- 2. Наборы ключей не изменились и порядок тот же ---------------- */
        var langs = ['ar', 'en'];
        for (var l = 0; l < langs.length; l++) {
            var lang = langs[l];
            var keysBefore = Object.keys(pb.model[lang] || {});
            var keysAfter = Object.keys(pa.model[lang] || {});
            if (keysBefore.length !== keysAfter.length) {
                problems.push(problem('keys_changed',
                    'Число ключей в разделе ' + lang + ' изменилось: было ' + keysBefore.length +
                    ', стало ' + keysAfter.length + '. Через вкладку ключи не добавляются и не удаляются.'));
                continue;
            }
            for (var k = 0; k < keysBefore.length; k++) {
                if (keysBefore[k] !== keysAfter[k]) {
                    problems.push(problem('keys_changed',
                        'Порядок ключей в разделе ' + lang + ' изменился на позиции ' + (k + 1) +
                        '. Такого быть не должно — запись отменена.'));
                    break;
                }
            }
        }

        /* --- 3. Новое значение лежит по своему ключу -----------------------
           expect может задавать ОДИН язык ({ key, lang, value }) или СРАЗУ
           ДВА ({ key, ar, en }) — владелец нередко правит обе колонки за
           одно сохранение, и тогда проверять надо обе. */
        var expects = [];
        if (want) {
            if (want.lang) {
                expects.push({ lang: want.lang, value: want.value });
            } else {
                if (want.ar != null) expects.push({ lang: 'ar', value: want.ar });
                if (want.en != null) expects.push({ lang: 'en', value: want.en });
            }
        }

        for (var ei = 0; ei < expects.length; ei++) {
            var ex = expects[ei];
            var got = (pa.model[ex.lang] || {})[want.key];
            if (got === undefined) {
                problems.push(problem('value_missing',
                    'После правки ключ «' + want.key + '» не найден в разделе ' + ex.lang + '.'));
            } else if (got !== String(ex.value)) {
                problems.push(problem('value_mismatch',
                    'Значение ключа «' + want.key + '» записалось неверно: получилось ' +
                    JSON.stringify(String(got).slice(0, 60)) + '. Запись отменена.'));
            }
        }

        /* --- 4. Остальные ключи не сдвинулись ------------------------------ */
        var moved = 0;
        var movedExample = '';
        for (var li = 0; li < langs.length; li++) {
            var lg = langs[li];
            var beforeModel = pb.model[lg] || {};
            var afterModel = pa.model[lg] || {};
            var allKeys = Object.keys(beforeModel);
            for (var ki = 0; ki < allKeys.length; ki++) {
                var kk = allKeys[ki];
                /* Разрешённые изменения: тот же ключ в тех языках, которые
                   мы сами и просили изменить. Всё остальное — сдвиг. */
                var allowed = false;
                for (var ai = 0; ai < expects.length; ai++) {
                    if (lg === expects[ai].lang && kk === want.key) { allowed = true; break; }
                }
                if (allowed) continue;
                if (beforeModel[kk] !== afterModel[kk]) {
                    moved++;
                    if (!movedExample) movedExample = lg + '.' + kk;
                }
            }
        }
        if (moved) {
            problems.push(problem('neighbour_changed',
                'Правка задела ещё ' + moved + ' ключ(а), например «' + movedExample +
                '». Должно меняться ровно одно значение — запись отменена.'));
        }

        /* --- 5. Вторая линия защиты: баланс скобок и кавычек --------------- */
        var balance = checkBalance(a);
        if (balance) {
            problems.push(problem('js_unsafe',
                'Файл получился бы с ошибкой: ' + balance + '. Запись отменена.'));
        }

        /* --- 6. Разрешена только разметка <br> ----------------------------- */
        var valueForMarkup = want ? String(want.value) : '';
        var badTag = badMarkupInValue(valueForMarkup);
        if (badTag) {
            problems.push(problem('bad_markup',
                'В словаре допустим только <br>, а здесь тег <' + badTag + '>. ' +
                'Остальные теги вставлять через переводы нельзя.'));
        }

        /* --- 7. Арифметика длин -------------------------------------------- */
        if (want && want.entry) {
            var escaped = escapeJsValue(want.value);
            var expectedDelta = escaped.length - (want.entry.end - want.entry.start);
            if (a.length - b.length !== expectedDelta) {
                problems.push(problem('length_sane',
                    'Длина файла изменилась на ' + (a.length - b.length) + ' символов вместо ' +
                    expectedDelta + '. Запись отменена.'));
            }
        }

        /* --- предупреждения ------------------------------------------------- */
        if (want && want.value && !String(want.value).trim()) {
            problems.push(problem('empty_value',
                'Текст пустой. На сайте на этом месте будет пусто.', null, 'warn'));
        }
        if (want && want.value && String(want.value).length > 600) {
            problems.push(problem('long_value',
                'Текст длиннее 600 символов — на телефоне он может не поместиться в блок.', null, 'warn'));
        }
        if (parseErrors.length === 0 && pa.problems.length) {
            for (var w = 0; w < pa.problems.length; w++) {
                if (pa.problems[w].severity !== 'error') problems.push(pa.problems[w]);
            }
        }

        return verdict(problems);
    }

    /*
     * Баланс скобок и кавычек — та же логика, что checkStructureBalance
     * в admin.js. Написана здесь заново намеренно: этот файл должен
     * работать самостоятельно, без загрузки admin.js (иначе офлайн-тест
     * не сможет его проверить).
     */
    function checkBalance(text) {
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
                if (close < 0) return 'не закрыт комментарий /* ... */ (строка ' + line + ')';
                for (var k = i; k < close; k++) if (src.charAt(k) === '\n') line++;
                i = close + 2;
                continue;
            }
            if (c === '"' || c === "'") {
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
                if (!closed) return 'не закрыта кавычка ' + quote + ' (строка ' + line + ')';
                continue;
            }
            if (c === '{' || c === '[') { stack.push({ ch: c, line: line }); i++; continue; }
            if (c === '}' || c === ']') {
                var wantCh = (c === '}') ? '{' : '[';
                var top = stack.pop();
                if (!top) return 'лишняя закрывающая скобка ' + c + ' (строка ' + line + ')';
                if (top.ch !== wantCh) {
                    return 'скобки перепутаны: открыли ' + top.ch + ' (строка ' + top.line +
                        '), а закрыли ' + c + ' (строка ' + line + ')';
                }
                i++;
                continue;
            }
            i++;
        }

        if (stack.length) {
            return 'не закрыта скобка ' + stack[stack.length - 1].ch +
                ' (строка ' + stack[stack.length - 1].line + ')';
        }
        return null;
    }

    /* ========================================================================
     *  4. ВСПОМОГАТЕЛЬНОЕ ДЛЯ ИНТЕРФЕЙСА
     *
     *  Здесь только чистые функции: список ключей, разделы, «где используется».
     *  DOM и сеть — в admin.js.
     * ====================================================================== */

    /*
     * Ключи, которые генерирует JS и которых нет в разметке. Их тоже надо
     * показывать: владелец должен суметь поправить «отправляется…» и
     * «недоступно». Список нужен только для подписи «используется из JS»
     * и для сортировки — он ничего не создаёт и не удаляет.
     */
    var JS_ONLY_HINT = 'используется из скрипта';

    /* Раздел ключа — часть до первой точки: nav, hero, cart, p1…p10, meta. */
    function sectionOf(key) {
        var at = String(key || '').indexOf('.');
        return at < 0 ? String(key || '') : String(key).slice(0, at);
    }

    /* Человеческие имена разделов для фильтра и подписи. */
    var SECTION_TITLES = {
        meta: 'Заголовок вкладки браузера',
        lang: 'Переключатель языка',
        nav: 'Меню',
        hero: 'Первый экран',
        about: 'О компании',
        products: 'Товары',
        gallery: 'Примеры работ',
        news: 'Новости',
        partners: 'Партнёры',
        footer: 'Подвал',
        cart: 'Корзина',
        catalog: 'Каталог',
        privacy: 'Политика конфиденциальности',
        lead: 'Форма заявки',
        cookie: 'Плашка про cookie',
        price: 'Цены и единицы',
        social: 'Соцсети',
        contact: 'Контакты',
        form: 'Поля формы'
    };

    function sectionTitle(section) {
        if (SECTION_TITLES[section]) return SECTION_TITLES[section];
        if (/^p\d+$/.test(section)) return 'Карточка товара ' + section.slice(1);
        return section;
    }

    /**
     * Строит список ключей для показа.
     *
     * @param {Object} parsed Результат parseI18n.
     * @param {Object=} usage { 'nav.about': ['index','cart'] }.
     * @return {Array.<Object>} [{ key, section, sectionTitle, ar, en, isHtml, usage, jsOnly }]
     */
    function buildKeyList(parsed, usage) {
        var model = (parsed && parsed.model) || { ar: {}, en: {} };
        var use = usage || {};
        var keys = Object.keys(model.ar || {});
        var out = [];

        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var ar = model.ar[key];
            var en = (model.en || {})[key];
            var where = use[key] || [];

            out.push({
                key: key,
                section: sectionOf(key),
                sectionTitle: sectionTitle(sectionOf(key)),
                ar: ar == null ? '' : String(ar),
                en: en == null ? '' : String(en),
                isHtml: /</.test(String(ar || '')) || /</.test(String(en || '')),
                usage: where,
                jsOnly: where.length === 0,
                note: where.length === 0 ? JS_ONLY_HINT : ''
            });
        }

        /* Сортировка: сначала разделы в порядке файла, внутри — по ключу.
           Порядок файла сохраняем, потому что владелец ищет глазами. */
        out.sort(function (x, y) {
            if (x.section === y.section) return 0;
            return 0;
        });

        return out;
    }

    /**
     * Собирает «где используется» из текстов страниц: только чтение, только
     * поиск подстроки data-i18n*="ключ". Без разбора DOM и без сети.
     *
     * @param {Object} pages { index: '<html>…', cart: '<html>…' }.
     * @return {Object} { 'nav.about': ['index','cart'] }
     */
    function collectUsage(pages) {
        var out = Object.create(null);
        var names = Object.keys(pages || {});

        for (var p = 0; p < names.length; p++) {
            var page = names[p];
            var html = String(pages[page] || '');

            for (var a = 0; a < I18N_ATTRS.length; a++) {
                var attr = I18N_ATTRS[a];
                var needle = attr + '="';
                var from = 0;

                for (;;) {
                    var at = html.indexOf(needle, from);
                    if (at < 0) break;
                    var vStart = at + needle.length;
                    var vEnd = html.indexOf('"', vStart);
                    if (vEnd < 0) break;
                    var key = html.slice(vStart, vEnd);

                    if (!out[key]) out[key] = [];
                    if (out[key].indexOf(page) < 0) out[key].push(page);
                    from = vEnd;
                }
            }
        }

        return out;
    }

    /* Семь атрибутов, по которым lang.js находит ключи в разметке. */
    var I18N_ATTRS = [
        'data-i18n', 'data-i18n-html', 'data-i18n-aria', 'data-i18n-alt',
        'data-i18n-placeholder', 'data-i18n-content', 'data-i18n-title'
    ];

    /* ========================================================================
     *  5. ЭКСПОРТ
     * ====================================================================== */

    var API = {
        parseI18n: parseI18n,
        applyI18nEdit: applyI18nEdit,
        validateI18nEdit: validateI18nEdit,
        escapeJsValue: escapeJsValue,
        unescapeJsValue: unescapeJsValue,
        buildKeyList: buildKeyList,
        collectUsage: collectUsage,
        sectionOf: sectionOf,
        sectionTitle: sectionTitle,
        checkBalance: checkBalance,
        badMarkupInValue: badMarkupInValue,
        I18N_ATTRS: I18N_ATTRS
    };

    if (typeof root !== 'undefined' && root) {
        root.LUMISTEK_TEXTS_I18N = API;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = API;
    }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
