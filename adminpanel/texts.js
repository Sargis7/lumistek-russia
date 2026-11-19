/**
 * ============================================================================
 *  LUMISTEK — ЯДРО ВКЛАДКИ «ТЕКСТЫ»: ИЗВЛЕЧЕНИЕ И БЕЗОПАСНАЯ ЗАПИСЬ HTML
 *  adminpanel/texts.js
 * ============================================================================
 *
 *  ЭТО НЕ ИНТЕРФЕЙС. Здесь нет ни одного обращения к DOM, к сети и к state.
 *  Файл только читает строку HTML, находит в ней тексты и умеет заменить
 *  ровно один из них, ничего больше не тронув. Интерфейс — в admin.js,
 *  и именно поэтому этот файл можно прогнать офлайн-тестом под Node.
 *
 *  ЗАЧЕМ ТАКОЙ ФАЙЛ.
 *  Вкладка «Тексты» коммитит правку прямо в main, а оттуда она уезжает на
 *  витрину без ревью и без отката. Значит, цена ошибки — мёртвый магазин.
 *  Поэтому вся опасная работа вынесена сюда и покрыта проверками:
 *
 *    1) СМЕЩЕНИЯ ТОЛЬКО UTF-16. Всё считается через String.prototype.slice,
 *       как в самой JS-строке. Никаких байтов: на первой же кириллической
 *       букве байтовое смещение уехало бы, на арабском — вдвойне.
 *
 *    2) ЕДИНСТВЕННАЯ МУТАЦИЯ — ОДИН СПЛАЙС:
 *          src.slice(0, start) + value + src.slice(end)
 *       Никаких String.replace и никаких arr.map().join('') при записи.
 *       Причина конкретная: в текстах сайта встречаются «$&» и "$'" внутри
 *       инструкций по замене, и строковая замена в String.replace
 *       истолковала бы их как подстановку и съела молча. slice этого не
 *       делает никогда.
 *
 *    3) НИКАКОГО new Function / eval. CSP сайта запрещает динамическое
 *       выполнение кода, поэтому разметка разбирается своим токенайзером.
 *       DOMParser тоже не годится: он ПЕРЕПИСЫВАЕТ разметку, а нам нужны
 *       позиции в исходном файле.
 *
 *    4) ВАЛИДАТОР СРАВНИВАЕТ «ДО» И «ПОСЛЕ», А НЕ С ИДЕАЛОМ.
 *       Причина: lumistek-russia/cart.html исторически был обрезан (в нём
 *       не было </body></html>). Проверка «документ обязан закрываться
 *       </html>» забраковала бы любую правку на этой странице и спрятала бы
 *       настоящую поломку. Поэтому все проверки — про РАЗНИЦУ: число тегов
 *       не уменьшилось, баланс не стал хуже, файл не стал короче.
 *       (Сам cart.html при этом починили отдельным коммитом.)
 *
 *    5) НЕОДНОЗНАЧНО — НЕ ПИШЕМ. Перед записью файл перечитывается, узел
 *       ищется заново (reLocate). Нашли ноль или два кандидата — отказ.
 *
 *  ФАЙЛ ОДИН И ТОТ ЖЕ В ОБОИХ РЕПОЗИТОРИЯХ, БАЙТ В БАЙТ. Различие сайта
 *  приходит параметром opts.site ('ru' | 'uae'), а не форком файла:
 *  см. work/texts-editor/check-parity.cjs, который сверяет md5 копий.
 *
 * ============================================================================
 */

(function (root) {
    'use strict';

    /* ========================================================================
     *  0. КОНСТАНТЫ РАЗБОРА
     * ====================================================================== */

    /*
     * Содержимое этих тегов — не разметка, и внутрь мы НЕ ЗАХОДИМ вообще.
     * Причина конкретная: в assets/js/cart.js есть строки «$&» и "$'" внутри
     * инструкций по замене. Правка такой строки ломает innerHTML-замену
     * молча, а ошибки в браузере не будет — просто перестанет работать
     * корзина. svg здесь по той же логике: его <path d="..."> — координаты,
     * а не текст, а <title> внутри svg — подсказка иконки.
     */
    var RAW_TEXT = {
        script: true, style: true, svg: true, textarea: true,
        xmp: true, noscript: true, template: true, math: true,
        /* Содержимое <title> — это SEO-заголовок документа, а не текст
           страницы. Извлекаем его как атрибут-поле отдельно (см. ниже),
           чтобы он попал в группу «SEO (осторожно)», а не в обычный список. */
        title: true
    };

    /*
     * На сайте ОАЭ у <title> две разные судьбы, и это видно только по телу
     * тега — поэтому решаем не по имени тега, а по атрибутам:
     *
     *   <title data-i18n="meta.title"> — им управляет словарь (ключ уже
     *       есть в блоке «Ключи словаря»), трогать текстом нельзя;
     *   <title> на catalog.html и cart.html ОАЭ — статический английский
     *       текст, который lang.js ПЕРЕЗАПИСЫВАЕТ из словаря по
     *       <body data-page="catalog|crt"> -> ключ meta.title.catalog /
     *       meta.title.cart (lang.js, стр. 148–156). Правка текста внутри
     *       тега молча не сработает: сохранили, а на сайте старое.
     *
     * Поэтому на ОАЭ <title> не извлекается никогда, и владелец правит
     * его ключом. На РФ всё наоборот: ключей нет, <title> — обычный текст.
     */
    var TITLE_SEO_BY_SITE = { ru: true, uae: false };

    /* Пустые элементы: закрывающего тега у них не бывает. */
    var VOID = {
        area: true, base: true, br: true, col: true, embed: true, hr: true,
        img: true, input: true, link: true, meta: true, param: true,
        source: true, track: true, wbr: true
    };

    /*
     * Теги-контейнеры, по которым считается «где это». Список короткий
     * намеренно: подпись должна быть понятной человеку, а не подробной.
     */
    var ZONE = {
        nav: true, header: true, main: true, section: true, article: true,
        aside: true, footer: true, form: true, dialog: true
    };

    /*
     * Атрибуты, чей текст видит посетитель. Базовый набор — RU.
     * В UAE к нему добавляются ключи словаря data-i18n*: они показываются
     * отдельным блоком «Ключи словаря», но извлекаются тем же проходом,
     * чтобы список «где используется» был точным.
     */
    var TEXT_ATTRS_RU = [
        'alt', 'title', 'placeholder', 'content',
        'aria-label', 'aria-placeholder', 'aria-description', 'aria-roledescription'
    ];

    var TEXT_ATTRS_UAE = TEXT_ATTRS_RU.concat([
        'data-i18n', 'data-i18n-html', 'data-i18n-aria', 'data-i18n-alt',
        'data-i18n-placeholder', 'data-i18n-content', 'data-i18n-title'
    ]);

    /* Все семь ключей, которые читает lang.js — они же колонка «где используется». */
    var I18N_ATTRS = [
        'data-i18n', 'data-i18n-html', 'data-i18n-aria', 'data-i18n-alt',
        'data-i18n-placeholder', 'data-i18n-content', 'data-i18n-title'
    ];

    /*
     * Что именно перезаписывает каждый ключ. По этой таблице решается,
     * можно ли предлагать поле как свободный текст: если поле стоит в паре
     * с ключом, его пишет lang.js, и правка текста не доживёт до показа.
     */
    var I18N_ATTR_MAP = {
        'data-i18n': 'text',
        'data-i18n-html': 'html',
        'data-i18n-aria': 'aria-label',
        'data-i18n-alt': 'alt',
        'data-i18n-placeholder': 'placeholder',
        'data-i18n-content': 'content',
        'data-i18n-title': 'title'
    };

    /*
     * Инлайн-теги, появление которых в тексте допустимо: браузер и так
     * позволяет их внутри абзаца. Всё остальное — только уменьшение.
     */
    var INLINE_OK = {
        br: true, b: true, strong: true, i: true, em: true, u: true,
        small: true, sup: true, sub: true, span: true, a: true
    };

    /* Короткие человеческие имена тегов для подписи «где это». */
    var ROLE_BY_TAG = {
        h1: 'главный заголовок', h2: 'заголовок', h3: 'подзаголовок',
        h4: 'подзаголовок', h5: 'подзаголовок', h6: 'подзаголовок',
        p: 'абзац', span: 'надпись', a: 'ссылка', button: 'кнопка',
        li: 'пункт списка', td: 'ячейка', th: 'заголовок столбца',
        label: 'подпись поля', legend: 'заголовок блока', figcaption: 'подпись',
        blockquote: 'цитата', dt: 'термин', dd: 'описание',
        div: 'строка', option: 'вариант выбора', summary: 'заголовок раскрывашки'
    };

    /* Понятные имена частей страницы по id. */
    var ID_TITLES = {
        about: 'О компании', products: 'Товары', news: 'Новости',
        gallery: 'Примеры работ', partners: 'Партнёры', contacts: 'Контакты',
        hero: 'Первый экран', catalog: 'Каталог', 'catalog-grid': 'Сетка товаров',
        'catalog-filters': 'Фильтры каталога', 'catalog-empty': 'Пустой каталог',
        'lead-modal': 'Форма заявки', 'privacy-modal': 'Политика конфиденциальности',
        'video-modal': 'Окно видео', 'cookie-banner': 'Плашка про cookie',
        'mobile-menu': 'Мобильное меню', header: 'Шапка сайта',
        footer: 'Подвал', main: 'Основное содержимое', cart: 'Корзина',
        'cart-items': 'Список товаров в корзине', 'cart-empty': 'Пустая корзина',
        checkout: 'Оформление заказа', reviews: 'Отзывы', faq: 'Вопросы и ответы',
        tariffs: 'Тарифы', advantages: 'Преимущества', stats: 'Цифры',
        'lang-switch': 'Переключатель языка', breadcrumbs: 'Хлебные крошки'
    };

    /*
     * Технические id служебных обёрток (модальные окна, доказательство вёрстки).
     * Владельцу такие имена ничего не говорят, поэтому контейнер с id из этого
     * списка зоной не считается — текст в нём подпишется родительской зоной
     * («Форма заявки», «Политика конфиденциальности»), а не «modal-content».
     */
    var BOILERPLATE_IDS = {
        'modal-content': true, 'modal-shell': true, 'modal-body': true,
        'video-modal-shell': true, 'privacy-modal-content': true,
        'lead-modal-content': true, 'submit': true, 'root': true, 'app': true,
        'toasts': true, 'busy': true, 'busy-text': true,
        'cart-count': true, 'cart-count-mobile': true, 'cart-badge': true,
        'repo-label': true, 'screen-gate': true, 'screen-setup': true,
        'screen-panel': true, 'gate-form': true, 'gate-pass': true,
        'gate-error': true, 'gate-btn': true
    };

    /* Имена, которые складываются из технического слова и производного id. */
    var WORD_RU = {
        cart: 'Корзина', count: 'счётчик', mobile: 'мобильная версия',
        desktop: 'полная версия', wrap: 'блок', shell: 'окно', content: 'содержимое',
        body: 'содержимое', inner: 'внутри', slide: 'слайд', item: 'элемент',
        items: 'элементы', row: 'строка', rows: 'строки', box: 'блок',
        group: 'группа', block: 'блок', panel: 'панель', section: 'раздел',
        title: 'заголовок', text: 'текст', desc: 'описание', note: 'примечание',
        form: 'форма', submit: 'кнопка', btn: 'кнопка', button: 'кнопка',
        link: 'ссылка', links: 'ссылки', nav: 'меню', menu: 'меню',
        footer: 'подвал', header: 'шапка', main: 'основное', hero: 'первый экран',
        news: 'новости', gallery: 'галерея', partners: 'партнёры',
        contacts: 'контакты', about: 'о компании', catalog: 'каталог',
        product: 'товар', products: 'товары', office: 'филиал', offices: 'филиалы',
        privacy: 'политика', lead: 'заявка', video: 'видео', videos: 'видео',
        cookie: 'cookie', lang: 'язык', head: 'шапка', top: 'верх',
        bottom: 'низ', left: 'слева', right: 'справа', center: 'по центру',
        list: 'список', grid: 'сетка', cards: 'карточки', card: 'карточка',
        tabs: 'вкладки', tab: 'вкладка', step: 'шаг', steps: 'шаги',
        info: 'сведения', meta: 'служебное', logo: 'логотип', icon: 'значок',
        badge: 'плашка', badge1: 'плашка', price: 'цена', prices: 'цены',
        summary: 'итог', empty: 'пустое состояние', error: 'ошибка',
        status: 'статус', loader: 'загрузка', spinner: 'загрузка',
        sticky: 'закреплённый', fixed: 'закреплённый', overlay: 'затемнение',
        backdrop: 'затемнение', close: 'закрыть', open: 'открыть',
        arrow: 'стрелка', arrows: 'стрелки', dots: 'точки', filter: 'фильтр',
        filters: 'фильтры', sort: 'сортировка', search: 'поиск'
    };

    /* Уточнения к id: «catalog-title» -> «Каталог · заголовок». */
    var ID_SUFFIX_RU = [
        ['-subtitle', 'подзаголовок'], ['-title', 'заголовок'], ['-heading', 'заголовок'],
        ['-desc', 'описание'], ['-text', 'текст'], ['-note', 'примечание'],
        ['-hint', 'подсказка'], ['-label', 'подпись'], ['-button', 'кнопка'],
        ['-btn', 'кнопка'], ['-list', 'список'], ['-grid', 'сетка'],
        ['-items', 'элементы'], ['-form', 'форма'], ['-empty', 'пустое состояние'],
        ['-error', 'ошибка'], ['-status', 'статус'], ['-count', 'счётчик'],
        ['-more', '«показать ещё»'], ['-modal', 'окно'], ['-body', 'содержимое'],
        ['-wrap', 'блок'], ['-box', 'блок'], ['-row', 'строка']
    ];

    /* Сколько символов контекста слева/справа хранить в отпечатке. */
    var PRE_LEN = 60;
    var POST_LEN = 20;

    /* Окно живого поиска узла перед записью. */
    var RELOCATE_RADIUS = 4000;

    /* ========================================================================
     *  1. МЕЛОЧИ
     * ====================================================================== */

    /* Есть ли в строке то, что человек назвал бы «текстом». */
    function hasLetterOrDigit(s) {
        return /[\p{L}\p{N}]/u.test(String(s == null ? '' : s));
    }

    function siteOf(opts) {
        var s = opts && opts.site ? String(opts.site).toLowerCase() : 'ru';
        return (s === 'uae' || s === 'ae') ? 'uae' : 'ru';
    }

    function textAttrsFor(site) {
        return (site === 'uae') ? TEXT_ATTRS_UAE : TEXT_ATTRS_RU;
    }

    /* Извлекаем ли <title> этой страницы как текст (см. TITLE_SEO_BY_SITE). */
    function titleIsText(site) {
        return TITLE_SEO_BY_SITE[site] === true;
    }

    /*
     * Есть ли у тега пара «ключ словаря -> поле». Наличие такой пары значит,
     * что содержимое атрибута — не свободный текст, а ссылка на словарь:
     * lang.js всё равно перезапишет поле при загрузке страницы, поэтому
     * предлагать его как текст нельзя — правка уйдёт в никуда.
     */
    function hasI18nPair(attrs) {
        if (!attrs) return false;
        for (var i = 0; i < attrs.length; i++) {
            if (I18N_ATTR_MAP[attrs[i].name]) return true;
        }
        return false;
    }

    /* Какое поле перезаписывает ключ из data-i18n-*; null — ключа нет. */
    function i18nFieldOf(attrs) {
        if (!attrs) return null;
        for (var i = 0; i < attrs.length; i++) {
            var f = I18N_ATTR_MAP[attrs[i].name];
            if (f && attrs[i].value) return f;
        }
        return null;
    }

    /* Номер строки (1-based) для смещения — только для подписи и ошибок. */
    function lineOf(src, at) {
        var upto = String(src).slice(0, Math.max(0, at));
        var n = 1;
        for (var i = 0; i < upto.length; i++) if (upto.charCodeAt(i) === 10) n++;
        return n;
    }

    function problem(code, message, at, severity) {
        return {
            code: code,
            message: message,
            at: (typeof at === 'number' ? at : null),
            severity: severity || 'error'
        };
    }

    /* Сколько раз подстрока входит в строку. Без RegExp: в текстах есть «.» и «(». */
    function countOccurrences(hay, needle) {
        var h = String(hay);
        var n = String(needle);
        if (!n) return 0;
        var count = 0;
        var i = 0;
        for (;;) {
            var at = h.indexOf(n, i);
            if (at < 0) return count;
            count++;
            i = at + n.length;
        }
    }

    /*
     * Отрезать крайние пробелы, сохранив внутренние переводы строк.
     * trim() срезает и неразрывный пробел — это нам и нужно.
     */
    function trimValue(s) {
        return String(s == null ? '' : s).trim();
    }

    /* ========================================================================
     *  2. ТОКЕНАЙЗЕР: ЧИТАЕМ РАЗМЕТКУ, А НЕ ВЫПОЛНЯЕМ ЕЁ
     * ====================================================================== */

    /**
     * Читает один открывающий тег с позиции «<».
     *
     * Возвращает:
     *   { name, attrs, selfClosing, start, end }  — нормальный тег;
     *   { badQuote: { name, attr, at, reason } }  — кавычка атрибута не закрыта;
     *   null                                      — это не тег («< » или «<3»).
     *
     * Важное свойство: «>» внутри значения атрибута НЕ означает конец тега.
     * Именно на этом ломается наивный indexOf('>'): в Tailwind-классах и в
     * data-атрибутах встречаются и стрелки, и «=>».
     *
     * @param {string} src Исходный текст файла.
     * @param {number} at Позиция символа «<».
     * @return {Object|null}
     */
    function readOpenTag(src, at) {
        var n = src.length;
        var i = at + 1;
        if (i >= n) return null;
        if (!/[a-zA-Z]/.test(src.charAt(i))) return null;

        var name = '';
        while (i < n && /[-a-zA-Z0-9:_]/.test(src.charAt(i))) {
            name += src.charAt(i);
            i++;
        }
        var lower = name.toLowerCase();

        var attrs = [];
        var selfClosing = false;

        while (i < n) {
            while (i < n && /\s/.test(src.charAt(i))) i++;
            if (i >= n) break;

            var c = src.charAt(i);
            if (c === '>') return done(i + 1);
            if (c === '/' && src.charAt(i + 1) === '>') {
                selfClosing = true;
                return done(i + 2);
            }
            if (c === '/') { i++; continue; }

            /* Имя атрибута до пробела, «=», «>» или «/». */
            var aName = '';
            while (i < n && !/[\s=>\/]/.test(src.charAt(i))) {
                aName += src.charAt(i);
                i++;
            }
            if (!aName) { i++; continue; }

            while (i < n && /\s/.test(src.charAt(i))) i++;

            var value = null;
            var quote = null;
            var vStart = -1;
            var vEnd = -1;

            if (src.charAt(i) === '=') {
                i++;
                while (i < n && /\s/.test(src.charAt(i))) i++;
                var q = src.charAt(i);

                if (q === '"' || q === "'") {
                    quote = q;
                    i++;
                    var close = src.indexOf(q, i);
                    if (close < 0) {
                        /* Незакрытая кавычка — самая опасная поломка:
                           остаток файла превращается в значение атрибута. */
                        return {
                            badQuote: {
                                name: lower,
                                attr: aName.toLowerCase(),
                                at: at,
                                reason: 'eof'
                            }
                        };
                    }
                    vStart = i;
                    vEnd = close;
                    value = src.slice(i, close);
                    i = close + 1;
                } else {
                    var b0 = i;
                    while (i < n && !/[\s>]/.test(src.charAt(i))) i++;
                    vStart = b0;
                    vEnd = i;
                    value = src.slice(b0, i);
                }
            }

            attrs.push({
                name: aName.toLowerCase(),
                value: value,
                quote: quote,
                vStart: vStart,
                vEnd: vEnd
            });
        }

        /* Дошли до конца файла, не встретив «>» — тег не закончен. */
        return { badQuote: { name: lower, attr: null, at: at, reason: 'eof' } };

        function done(endIdx) {
            return {
                name: lower,
                attrs: attrs,
                selfClosing: selfClosing,
                start: at,
                end: endIdx
            };
        }
    }

    /**
     * Один проход по разметке. Отдаёт события в порядке следования:
     *   { type:'open'|'close'|'text'|'raw', name, start, end, attrs, selfClosing }
     *
     * Внутрь RAW_TEXT-тегов не заходим: содержимое отдаётся одним событием
     * 'raw' и в тексты не попадает.
     */
    function walk(src) {
        var n = src.length;
        var events = [];
        var problems = [];
        var skip = [];
        var i = 0;

        function pushText(from, to) {
            if (to > from) events.push({ type: 'text', name: '#text', start: from, end: to, attrs: null });
        }

        while (i < n) {
            var lt = src.indexOf('<', i);
            if (lt < 0) {
                if (!skip.length) pushText(i, n);
                break;
            }
            if (lt > i && !skip.length) pushText(i, lt);

            /* Комментарий: целиком мимо. Внутри него бывают и «<», и примеры разметки. */
            if (src.startsWith('<!--', lt)) {
                var cClose = src.indexOf('-->', lt + 4);
                if (cClose < 0) {
                    problems.push(problem('unterminated_comment',
                        'Не закрыт комментарий <!-- ... -->', lt));
                    i = n;
                    break;
                }
                i = cClose + 3;
                continue;
            }

            /* <!DOCTYPE ...> и прочие <! ... > */
            if (src.charAt(lt + 1) === '!') {
                var gt = src.indexOf('>', lt + 2);
                if (gt < 0) { i = n; break; }
                i = gt + 1;
                continue;
            }

            /* Закрывающий тег. */
            if (src.charAt(lt + 1) === '/') {
                var m = /^<\/([a-zA-Z][-a-zA-Z0-9:_]*)\s*>/.exec(src.slice(lt, lt + 200));
                if (!m) { i = lt + 2; continue; }
                var cName = m[1].toLowerCase();
                var at = skip.lastIndexOf(cName);
                if (at >= 0) skip.length = at;
                events.push({ type: 'close', name: cName, start: lt, end: lt + m[0].length, attrs: null });
                i = lt + m[0].length;
                continue;
            }

            var tag = readOpenTag(src, lt);
            if (!tag) { i = lt + 1; continue; }
            if (tag.badQuote) {
                problems.push(problem('unclosed_quote',
                    'Не закрыта кавычка в атрибуте' +
                    (tag.badQuote.attr ? ' ' + tag.badQuote.attr : '') +
                    ' тега <' + tag.badQuote.name + '>', lt));
                i = n;
                break;
            }

            events.push({
                type: 'open', name: tag.name, start: tag.start, end: tag.end,
                attrs: tag.attrs, selfClosing: tag.selfClosing
            });
            i = tag.end;

            /* Содержимое raw-тега — не разметка. Глотаем одним куском. */
            if (RAW_TEXT[tag.name] && !tag.selfClosing) {
                var re = new RegExp('<\\/\\s*' + tag.name + '\\s*>', 'i');
                var rest = src.slice(i);
                var mm = re.exec(rest);
                if (!mm) {
                    if (i < n) events.push({ type: 'raw', name: tag.name, start: i, end: n, attrs: null });
                    i = n;
                    continue;
                }
                var rawEnd = i + mm.index;
                if (rawEnd > i) events.push({ type: 'raw', name: tag.name, start: i, end: rawEnd, attrs: null });
                var closeEnd = rawEnd + mm[0].length;
                events.push({ type: 'close', name: tag.name, start: rawEnd, end: closeEnd, attrs: null });
                i = closeEnd;
            }
        }

        return { events: events, problems: problems };
    }

    /* ========================================================================
     *  3. ИЗВЛЕЧЕНИЕ ТЕКСТОВ
     * ====================================================================== */

    /* Тексты, которые браузер не показывает посетителю. */
    var SEO_TAGS = { title: true };

    function isSeoAttr(attr, tag) {
        return (attr === 'title' && tag === 'meta');
    }

    /* Является ли узел SEO-полем: <title> документа или <meta name="description">. */
    function isSeoNode(node) {
        if (!node) return false;
        if (node.kind !== 'attr') return false;
        if (node.attr !== 'title' && node.attr !== 'content') return false;
        return !!(node.seo);
    }

    /**
     * Отпечаток узла. Без него нельзя «сохранить»: смещение может уехать,
     * а повторить поиск по одной строке значения нельзя — «Контроль
     * качества» встречается на странице несколько раз.
     *
     *   fp   = (kind === 'text' ? 't' : 'a') + ':' + tag + ':' + attr
     *   pre  = 60 символов слева (в нижнем регистре)
     *   post = 20 символов справа (в нижнем регистре)
     */
    function fingerprint(src, start, end, kind, tag, attr) {
        return {
            fp: (kind === 'text' ? 't' : 'a') + ':' + (tag || '') + ':' + (attr || ''),
            pre: src.slice(Math.max(0, start - PRE_LEN), start).toLowerCase(),
            post: src.slice(end, end + POST_LEN).toLowerCase()
        };
    }

    /*
     * Значение крайних пробелов не содержит: смещение сдвигаем внутрь.
     * allowMarkup — текстовый узел разрешено показывать, даже если внутри
     * него стоит инлайн-разметка (сейчас не используется, оставлено для
     * единообразия с атрибутной ветвью).
     */
    function collectTextNode(src, from, to, out) {
        var raw = src.slice(from, to);
        var trimmed = raw.trim();
        if (!trimmed) return;
        if (!hasLetterOrDigit(trimmed)) return;

        var lead = raw.length - raw.replace(/^\s+/, '').length;
        var start = from + lead;
        var end = start + trimmed.length;
        out.push({
            kind: 'text',
            tag: null,
            attr: null,
            value: src.slice(start, end),
            start: start,
            end: end
        });
    }

    /**
     * Открывающий тег (или пустой), чьё поле управляется словарём.
     *
     * Правило одно на оба сайта: если у тега есть data-i18n-*-пара, то
     * поле, которое эта пара перезаписывает, показывать как текст нельзя
     * — lang.js всё равно перерисует его из словаря при загрузке.
     * Свободными остаются те поля, у которых пары нет: например alt без
     * data-i18n-alt на ОАЭ или любой alt на РФ.
     */
    function i18nDrivenField(attrs, field) {
        if (!field) return false;
        var map = I18N_ATTR_MAP;
        for (var i = 0; i < attrs.length; i++) {
            if (map[attrs[i].name] === field && attrs[i].value) return true;
        }
        return false;
    }

    /**
     * Основной проход извлечения.
     *
     * @param {string} html Исходный текст файла.
     * @param {Object=} opts { site: 'ru' | 'uae' }.
     * @return {Object} { nodes, problems }
     */
    function textNodes(html, opts) {
        var src = String(html == null ? '' : html);
        var site = siteOf(opts);
        var wantAttrs = textAttrsFor(site);
        var walked = walk(src);
        var events = walked.events;
        var raw = [];
        var i;

        for (i = 0; i < events.length; i++) {
            var ev = events[i];

            if (ev.type === 'text') {
                collectTextNode(src, ev.start, ev.end, raw);
                continue;
            }
            if (ev.type === 'open' && ev.name === 'title' && !ev.selfClosing) {
                /* Заголовок вкладки браузера. На РФ владелец должен его
                   видеть и править, но это SEO: отдельная группа
                   «SEO (осторожно)». На ОАЭ — наоборот, им управляет
                   словарь, и текстом он не показывается (см.
                   TITLE_SEO_BY_SITE и §3.4 архитектуры). */
                if (titleIsText(site) && !hasI18nPair(ev.attrs)) {
                    var titleClose = -1;
                    for (var t = 0; t < events.length; t++) {
                        if (events[t].type === 'close' && events[t].name === 'title' &&
                            events[t].start >= ev.end) { titleClose = events[t].start; break; }
                    }
                    if (titleClose > ev.end) {
                        var titleRaw = src.slice(ev.end, titleClose);
                        var titleText = trimValue(titleRaw);
                        if (titleText && hasLetterOrDigit(titleText)) {
                            var titleLead = titleRaw.length - titleRaw.replace(/^\s+/, '').length;
                            raw.push({
                                kind: 'attr',
                                tag: 'title',
                                attr: 'title',
                                value: titleRaw.slice(titleLead, titleLead + titleText.length),
                                start: ev.end + titleLead,
                                end: ev.end + titleLead + titleText.length,
                                seo: true
                            });
                        }
                    }
                }
                continue;
            }

            if (ev.type !== 'open' || !ev.attrs) continue;

            for (var a = 0; a < ev.attrs.length; a++) {
                var at = ev.attrs[a];
                if (at.value == null) continue;
                if (wantAttrs.indexOf(at.name) < 0) continue;
                if (!hasLetterOrDigit(at.value)) continue;

                /* Поле, которое перезаписывает data-i18n-*-пара, — не наш
                   текст: оно уже есть в блоке «Ключи словаря», а правка
                   здесь молча потеряется при следующей загрузке страницы. */
                if (i18nDrivenField(ev.attrs, at.name)) continue;

                /* Голый content вне meta name="description" — это URL
                   (og:image и подобное), а не текст. */
                if (at.name === 'content' && ev.name !== 'meta') continue;

                /* SEO-поля выносим отдельной группой «SEO (осторожно)»:
                   их правка влияет на выдачу в поиске, а не на вид страницы. */
                var seo = false;
                if (ev.name === 'meta' && at.name === 'content') {
                    seo = hasMetaDescription(ev.attrs);
                }
                if (!seo && ev.name === 'meta') continue;

                raw.push({
                    kind: 'attr',
                    tag: ev.name,
                    attr: at.name,
                    value: at.value,
                    start: at.vStart,
                    end: at.vEnd,
                    seo: seo
                });
            }
        }

        /* Вложенные перекрытия при битой разметке: оставляем внешний узел. */
        raw.sort(function (x, y) {
            return x.start - y.start || ((y.end - y.start) - (x.end - x.start));
        });
        var clean = [];
        var lastEnd = -1;
        for (i = 0; i < raw.length; i++) {
            if (raw[i].start < lastEnd) continue;
            clean.push(raw[i]);
            lastEnd = raw[i].end;
        }

        /* Геометрия страницы считается один раз на файл. */
        var geo = geometry(src, clean);

        var nodes = [];
        for (i = 0; i < clean.length; i++) {
            nodes.push(finalizeNode(src, clean[i], geo, i));
        }

        return { nodes: nodes, problems: walked.problems };
    }

    /* meta name="description" — единственный content, который считаем SEO. */
    function hasMetaDescription(attrs) {
        for (var i = 0; i < attrs.length; i++) {
            if (attrs[i].name === 'name' && attrs[i].value &&
                attrs[i].value.toLowerCase() === 'description') return true;
        }
        return false;
    }

    /**
     * Извлекает тексты. Это тот же контракт, что у эталонного извлекателя
     * QA: [{ value, start, end, kind, tag, attr }] плюс служебные поля.
     *
     * @param {string} html Исходный текст файла.
     * @param {Object=} opts { site: 'ru' | 'uae' }.
     * @return {Array.<Object>} TextNode[]
     */
    function extractTexts(html, opts) {
        return textNodes(html, opts).nodes;
    }

    /* ========================================================================
     *  4. ГЕОМЕТРИЯ СТРАНИЦЫ: «ГДЕ ЭТО» БЕЗ МАРКЕРОВ В РАЗМЕТКЕ
     *
     *  Владельцу нужно различить десять одинаковых «Контроль качества».
     *  Вместо инъекции якорей подпись ВЫЧИСЛЯЕТСЯ из уже существующего HTML:
     *  контейнер (nav/section/footer/...), его id или первый заголовок,
     *  и порядковый номер элемента среди одноуровневых соседей.
     *  Ноль правок в продукте, нет фазы миграции, нет 400 атрибутов.
     * ====================================================================== */

    /* Человеческое имя части страницы: сперва по id, потом по первому заголовку. */
    function zoneTitle(id, headingText, tag) {
        if (id) {
            var base = ID_TITLES[id];
            if (!base) base = titleFromId(id);
            if (base) return base;
        }

        if (headingText) return headingText;

        if (tag === 'nav') return 'Меню';
        if (tag === 'header') return 'Шапка сайта';
        if (tag === 'footer') return 'Подвал';
        if (tag === 'aside') return 'Боковая вставка';
        if (tag === 'form') return 'Форма';
        if (tag === 'dialog') return 'Окно';
        if (tag === 'article') return 'Блок';
        if (tag === 'section') return 'Раздел';
        return '';
    }

    /*
     * Имя зоны из технического id: «cart-title» -> «Корзина · заголовок»,
     * «offices-section» -> «Филиалы», «privacy-modal-content» -> «Политика».
     * Незнакомые слова отбрасываем: лучше «строка N», чем «Section».
     */
    function titleFromId(id) {
        var parts = String(id || '').toLowerCase().split(/[-_.]+/);
        var ru = [];
        for (var i = 0; i < parts.length; i++) {
            var w = WORD_RU[parts[i]];
            if (w && ru.indexOf(w) < 0) ru.push(w);
        }
        if (!ru.length) return '';
        return ru[0].charAt(0).toUpperCase() + ru[0].slice(1) +
            (ru.length > 1 ? ' · ' + ru.slice(1).join(' ') : '');
    }

    /* «lead-form-block» -> «Lead form block». Только латиница и цифры. */
    function humanizeId(id) {
        var s = String(id || '').replace(/[-_]+/g, ' ').trim();
        if (!s) return '';
        if (!/^[a-zA-Z0-9 ]+$/.test(s)) return s;
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    /* Заголовок внутри диапазона [from, to) — для section без id. */
    function firstHeading(src, events, from, to) {
        var sawH1 = false;
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            if (ev.type !== 'open') continue;
            if (ev.start < from || ev.start >= to) continue;
            if (!/^h[12]$/.test(ev.name)) continue;

            var t = headingTextOf(src, events, ev);
            if (!t) continue;
            if (t.length > 42) t = t.slice(0, 42).replace(/\s+\S*$/, '') + '…';

            /* Первый экран начинается с h1 и не имеет id — назовём его
               «первый экран», это понятнее владельцу, чем сам заголовок. */
            if (ev.name === 'h1') return 'Первый экран';
            if (!sawH1) return t;
        }
        return '';
    }

    /* Текст заголовка: между <hN> и его закрывающим тегом, без вложенных тегов. */
    function headingTextOf(src, events, openEv) {
        var acc = '';
        var depth = 1;
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            if (ev.start < openEv.end) continue;
            if (ev.type === 'open' && ev.name === openEv.name) depth++;
            if (ev.type === 'close' && ev.name === openEv.name) {
                depth--;
                if (depth === 0) break;
            }
            if (ev.type === 'text') acc += src.slice(ev.start, ev.end);
        }
        return trimValue(acc).replace(/\s+/g, ' ');
    }

    /**
     * Собирает геометрию файла одним проходом:
     *   - диапазоны ZONE-контейнеров (для «зоны»),
     *   - цепочку открытых предков для каждого смещения,
     *   - номер элемента среди одноуровневых соседей того же тега.
     *
     * Возвращает массив «точек» — по одной на каждое событие open/close/text,
     * чтобы затем двоичным поиском получить состояние для любого смещения.
     */
    function geometry(src, nodes) {
        var walked = walk(src);
        var events = walked.events;

        var stack = [];          /* [{ name, id, start, end, heading }] */
        var ranges = [];         /* закрытые и открытые ZONE-диапазоны */
        var marks = [];          /* [{ at, chain: [compIdx...] }] */

        /* Компоненты: каждый ZONE-контейнер — отдельная область. */
        var comps = [];

        function snapshot(at) {
            var chain = [];
            for (var i = 0; i < stack.length; i++) {
                if (stack[i].comp >= 0) chain.push(stack[i].comp);
            }
            marks.push({ at: at, chain: chain });
        }

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];

            if (ev.type === 'open') {
                snapshot(ev.start);

                var comp = -1;
                var openId = attrOf(ev, 'id');
                /* Контейнером считаем не только ZONE-теги, но и любой элемент
                   со «знакомым» id: в разметке сайтов окна и плашки сделаны на
                   <div id="cookie-banner">, и без этого подпись в них была бы
                   «строка N». Служебную обёртку (BOILERPLATE_IDS) пропускаем. */
                var isZone = !!ZONE[ev.name];
                var idZone = !!openId && !BOILERPLATE_IDS[openId] && !!titleFromId(openId);
                if (!VOID[ev.name] && (isZone || idZone)) {
                    comp = comps.length;
                    comps.push({
                        tag: ev.name,
                        id: openId,
                        title: '',
                        start: ev.start,
                        end: src.length
                    });
                }
                if (!VOID[ev.name] && !ev.selfClosing) {
                    stack.push({ name: ev.name, comp: comp, start: ev.start });
                }
                continue;
            }

            if (ev.type === 'close') {
                for (var s = stack.length - 1; s >= 0; s--) {
                    if (stack[s].name === ev.name) {
                        for (var q = stack.length - 1; q >= s; q--) {
                            if (stack[q].comp >= 0) comps[stack[q].comp].end = ev.end;
                            stack.splice(q, 1);
                        }
                        break;
                    }
                }
                snapshot(ev.end);
                continue;
            }

            if (ev.type === 'text' || ev.type === 'raw') snapshot(ev.start);
        }

        /* Заголовки для зон без id. */
        for (var c = 0; c < comps.length; c++) {
            if (comps[c].id) continue;
            if (comps[c].tag !== 'section' && comps[c].tag !== 'article') continue;
            comps[c].title = firstHeading(src, events, comps[c].start, comps[c].end);
        }

        /* Номера среди одноуровневых соседей: считаем по родителю и тегу. */
        var seen = Object.create(null);
        var ordOf = [];          /* для каждого события open — { index, total, of } */
        var parentKey = [];

        for (var e = 0; e < events.length; e++) {
            var oe = events[e];
            if (oe.type !== 'open') { ordOf.push(null); continue; }

            /* Ключ родителя: ближайший незакрытый ZONE-компонент + глубина. */
            var pk = '#root';
            for (var d = e - 1; d >= 0; d--) {
                var pe = events[d];
                if (pe.type === 'open' && !VOID[pe.name] && !pe.selfClosing) {
                    pk = 'o' + pe.start;
                    break;
                }
            }
            parentKey.push(pk);
            var key = pk + '|' + oe.name;
            seen[key] = (seen[key] || 0) + 1;
            ordOf.push({ index: seen[key], total: 0, of: oe.name });
        }

        /* Итог: сколько всего таких же соседей под тем же родителем. */
        var totals = Object.create(null);
        for (var t = 0; t < parentKey.length; t++) {
            if (!ordOf[t]) continue;
            var tk = parentKey[t] + '|' + ordOf[t].of;
            totals[tk] = (totals[tk] || 0) + 1;
        }
        for (var u = 0; u < ordOf.length; u++) {
            if (!ordOf[u]) continue;
            ordOf[u].total = totals[parentKey[u] + '|' + ordOf[u].of];
        }

        /* Таблица «событие open -> композиция и ординал». */
        var openInfo = [];
        var oi = 0;
        for (var g = 0; g < events.length; g++) {
            if (events[g].type !== 'open') { openInfo.push(null); continue; }
            openInfo.push({ ord: ordOf[g] });
            oi++;
        }

        return {
            comps: comps,
            marks: marks,
            events: events,
            openInfo: openInfo
        };
    }

    function attrOf(ev, name) {
        if (!ev.attrs) return '';
        for (var i = 0; i < ev.attrs.length; i++) {
            if (ev.attrs[i].name === name && ev.attrs[i].value != null) return ev.attrs[i].value;
        }
        return '';
    }

    /* Состояние для смещения: цепочка компонентов из последней метки до at. */
    function chainAt(geo, at) {
        var marks = geo.marks;
        var lo = 0;
        var hi = marks.length - 1;
        var found = -1;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (marks[mid].at <= at) { found = mid; lo = mid + 1; }
            else hi = mid - 1;
        }
        return found < 0 ? [] : marks[found].chain;
    }

    /* Глубочайший ZONE-компонент, содержащий смещение. */
    function componentAt(geo, at) {
        var chain = chainAt(geo, at);
        return chain.length ? chain[chain.length - 1] : -1;
    }

    /* Собирает итоговый узел: отпечаток, зона, ординал, подпись. */
    function finalizeNode(src, raw, geo, index) {
        var fp = fingerprint(src, raw.start, raw.end, raw.kind, raw.tag, raw.attr);
        var comp = componentAt(geo, raw.start);
        var zone = null;
        var labelMain = '';
        var labelSub = '';

        if (comp >= 0) {
            var c = geo.comps[comp];
            zone = {
                tag: c.tag,
                id: c.id,
                title: zoneTitle(c.id, c.title, c.tag),
                start: c.start,
                end: c.end
            };
            labelMain = zone.title;
        }

        /* Ординал: сколько таких же элементов уже было в этой зоне. */
        var ord = null;
        var owners = ownersInComponent(geo, comp, raw.start);
        if (owners) {
            ord = owners;
            if (owners.total > 1) labelSub = 'элемент ' + owners.index + ' из ' + owners.total;
        }

        var node = {
            id: (raw.kind === 'text' ? 't' : 'a') + index,
            kind: raw.kind,
            tag: raw.tag,
            attr: raw.attr,
            value: raw.value,
            start: raw.start,
            end: raw.end,
            fp: fp.fp,
            pre: fp.pre,
            post: fp.post,
            line: lineOf(src, raw.start),
            zone: zone,
            ord: ord,
            markerTs: null,
            seo: !!raw.seo
        };

        node.labelMain = labelMain || ('строка ' + node.line);
        if (node.seo) node.labelMain = 'SEO — заголовок и описание для поиска';
        node.labelSub = labelSub;
        node.labelRole = roleOf(node);
        node.label = buildLabel(node);

        return node;
    }

    /*
     * Сколько всего и какой по счёту таких же «владельцев» в компоненте.
     * Владелец — открывающий тег ближайшего к тексту элемента. Для
     * атрибутов это сам тег, для текста — его родитель.
     */
    function ownersInComponent(geo, comp, at) {
        var events = geo.events;

        /* Ближайший открывающий тег, чей диапазон содержит at. */
        var ownerStart = -1;
        var ownerName = '';
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            if (ev.type !== 'open') continue;
            if (ev.start > at) break;
            if (ev.end > at) continue;
        }
        /* Проходим от конца и берём последний открытый до at и не закрытый. */
        var stack = [];
        for (var e = 0; e < events.length; e++) {
            var ee = events[e];
            if (ee.start > at) break;
            if (ee.type === 'open' && !VOID[ee.name] && !ee.selfClosing) {
                stack.push(ee);
            }
            if (ee.type === 'close') {
                for (var s = stack.length - 1; s >= 0; s--) {
                    if (stack[s].name === ee.name) { stack.length = s; break; }
                }
            }
        }
        if (stack.length) {
            ownerStart = stack[stack.length - 1].start;
            ownerName = stack[stack.length - 1].name;
        }
        if (ownerStart < 0) return null;

        /* Считаем такие же теги среди соседей под тем же родителем. */
        var parentStart = stack.length > 1 ? stack[stack.length - 2].start : -1;
        var idx = 0;
        var total = 0;
        var reached = false;
        var parent = [];
        for (var k = 0; k < events.length; k++) {
            var x = events[k];
            if (x.type === 'open' && !VOID[x.name] && !x.selfClosing) parent.push(x);
            else if (x.type === 'close') {
                for (var p = parent.length - 1; p >= 0; p--) {
                    if (parent[p].name === x.name) { parent.length = p; break; }
                }
            }
            if (x.type !== 'open') continue;
            if (x.name !== ownerName) continue;
            if (componentAt(geo, x.start) !== comp) continue;
            var par = parent.length >= 2 ? parent[parent.length - 2].start : -1;
            if (x.start === ownerStart) {
                total++;
                idx = total;
                reached = true;
                continue;
            }
            if (par === parentStart) {
                total++;
                if (!reached) idx = total;
            }
        }

        if (!total) return null;
        return { index: idx, total: total, of: ownerName };
    }

    function roleOf(node) {
        if (node.kind === 'attr') {
            if (node.seo && node.tag === 'title') return 'заголовок вкладки браузера';
            if (node.seo) return 'описание для поиска (meta description)';
            if (node.attr === 'alt') return 'подпись картинки (alt)';
            if (node.attr === 'placeholder') return 'подсказка в поле (placeholder)';
            if (node.attr === 'title') return 'всплывающая подсказка (title)';
            if (node.attr === 'aria-label') return 'озвучка для незрячих (aria-label)';
            if (node.attr.indexOf('data-i18n') === 0) return 'ключ словаря (' + node.attr + ')';
            return node.attr;
        }
        return ROLE_BY_TAG[node.tag || ''] || 'текст';
    }

    function buildLabel(node) {
        var parts = [node.labelMain];
        if (node.labelSub) parts.push(node.labelSub);
        parts.push(node.labelRole);
        return parts.join(' · ');
    }

    /* Подпись по строке — для случаев, когда контейнера нет вовсе. */
    function describeNode(html, node) {
        var src = String(html == null ? '' : html);
        var out = [];

        if (node && typeof node.start === 'number' &&
            node.start >= 0 && node.end <= src.length) {
            if (src.slice(node.start, node.end) !== node.value) {
                out.push(problem('position_stale',
                    'Страница изменилась: текст на этом месте уже другой. ' +
                    'Обновите список и найдите строку заново.', node.start));
            }
        }
        var last = null;
        if (stack.length) {
            last = stack[stack.length - 1];
            var attrs = [];
            for (var a = 0; a < last.attrs.length; a++) {
                if (last.attrs[a].value != null && last.attrs[a].name !== 'class') {
                    attrs.push(last.attrs[a].name + '="' + last.attrs[a].value + '"');
                }
            }
            out.push(problem('context',
                'Строка ' + line + '. Внутри <' + last.name + '> уже открыто: ' +
                (stack.slice(0, 6).map(function (x) { return '<' + x.name + '>'; }).join(' ') || '—') +
                (attrs.length ? ' (атрибуты: ' + attrs.join(' ') + ')' : ''),
                node.start, 'info'));
        }

        return out;
    }

    /* ========================================================================
     *  5. ВАЛИДАТОР HTML: СРАВНЕНИЕ «ДО» И «ПОСЛЕ»
     *
     *  Десять проверок. Все выполняются без короткого замыкания — владелец
     *  должен увидеть полную картину, а не первую строку.
     *  severity='error' блокирует запись, severity='warn' только сообщает.
     * ====================================================================== */

    /* Разбор структуры: счётчики тегов и незакрытые/лишние. */
    function structureOf(html) {
        var walked = walk(html);
        var events = walked.events;
        var counts = Object.create(null);
        var stack = [];
        var unbalanced = [];

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];

            if (ev.type === 'open') {
                counts[ev.name] = (counts[ev.name] || 0) + 1;
                if (VOID[ev.name] || ev.selfClosing) continue;
                stack.push(ev.name);
                continue;
            }

            if (ev.type === 'close') {
                if (VOID[ev.name]) {
                    unbalanced.push('close_on_void:' + ev.name);
                    continue;
                }
                var at = stack.lastIndexOf(ev.name);
                if (at < 0) {
                    if (stack.length) stack.pop();
                    unbalanced.push('unmatched_close:' + ev.name);
                    continue;
                }
                if (at !== stack.length - 1) {
                    unbalanced.push('misnested:' + ev.name + '/' + stack[stack.length - 1]);
                }
                stack.length = at;
            }
        }

        if (stack.length) unbalanced.push('unclosed:' + stack.join(','));

        return {
            counts: counts,
            unbalanced: unbalanced,
            left: stack.slice(),
            problems: walked.problems
        };
    }

    /* Новые элементы списка «после» относительно «до». */
    function newOnly(before, after) {
        var budget = Object.create(null);
        var i;
        for (i = 0; i < before.length; i++) {
            budget[before[i]] = (budget[before[i]] || 0) + 1;
        }
        var out = [];
        for (i = 0; i < after.length; i++) {
            if (budget[after[i]] > 0) { budget[after[i]]--; continue; }
            out.push(after[i]);
        }
        return out;
    }

    /* Значения атрибутов: самая коварная поломка — съеденная кавычка. */
    function inspectAttributes(html) {
        var walked = walk(html);
        var events = walked.events;
        var out = [];

        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            if (ev.type !== 'open' || !ev.attrs) continue;

            for (var a = 0; a < ev.attrs.length; a++) {
                var at = ev.attrs[a];
                if (at.value == null) continue;

                if (/[<>]/.test(at.value) && !allowsMarkup(at.name)) {
                    out.push(problem('attr_markup',
                        'в атрибуте ' + at.name + ' тега <' + ev.name + '> разметка ' +
                        JSON.stringify(at.value.slice(0, 40)), ev.start));
                }
                if (at.value.length > 400) {
                    out.push(problem('attr_runaway',
                        'значение атрибута ' + at.name + ' разрослось до ' + at.value.length + ' символов',
                        ev.start));
                }
            }
        }

        return out;
    }

    function allowsMarkup(attrName) {
        return /^(data-|aria-|href|src|srcset|action|formaction|content|value|style|title|alt|placeholder|class)/.test(attrName);
    }

    /* Новые «<» внутри текстовых узлов. */
    function inspectTextNodes(html) {
        var walked = walk(html);
        var events = walked.events;
        var out = [];
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            if (ev.type !== 'text') continue;
            var raw = html.slice(ev.start, ev.end);
            var lt = raw.indexOf('<');
            if (lt < 0) continue;
            out.push(problem('stray_lt',
                'в тексте остался символ «<»: ' + raw.slice(lt, lt + 24).trim(), ev.start + lt));
        }
        return out;
    }

    /* Кончается ли документ на </tag> (с учётом пробелов в конце). */
    function endsWithClose(html, tag) {
        var re = new RegExp('<\\/\\s*' + tag + '\\s*>\\s*$', 'i');
        return re.test(html);
    }

    /* Оборвали посреди тега: последний «<» так и не закрылся. */
    function incompleteTail(html) {
        var lt = html.lastIndexOf('<');
        if (lt < 0) return false;
        return html.indexOf('>', lt) < 0;
    }

    /* Запрещённое содержимое в самом вводе владельца. */
    function forbiddenInInput(value, node, limiter) {
        var out = [];
        var v = String(value);

        if (v.indexOf('\u0000') >= 0) {
            out.push(problem('forbidden_content', 'В тексте есть невидимый служебный символ. Уберите его.'));
        }
        if (v.indexOf('\r') >= 0) {
            out.push(problem('forbidden_content', 'В тексте есть символ возврата каретки — он ломает переводы строк страницы. Уберите его.'));
        }
        if (/<script/i.test(v)) {
            out.push(problem('forbidden_content', 'Вставить <script> нельзя: сайт запрещает выполнять код со страницы.'));
        }
        if (/<style/i.test(v)) {
            out.push(problem('forbidden_content', 'Вставить <style> нельзя: оформление живёт отдельно от текста.'));
        }
        if (/<(iframe|object|embed)\b/i.test(v)) {
            out.push(problem('forbidden_content', 'Встроить чужую страницу или объект в текст нельзя.'));
        }
        if (/\son[a-z]+\s*=/i.test(v)) {
            out.push(problem('forbidden_content', 'Обработчик события (onclick= и подобные) в тексте запрещён.'));
        }
        if (/javascript:/i.test(v) && node.kind === 'attr') {
            out.push(problem('forbidden_content', 'Ссылка javascript: запрещена.'));
        }

        if (node.kind === 'attr') {
            if (v.indexOf('<') >= 0 || v.indexOf('>') >= 0) {
                out.push(problem('forbidden_content',
                    'В подписи к элементу нельзя ставить «<» и «>» — браузер примет их за разметку.'));
            }
            if (limiter === '"' && v.indexOf('"') >= 0) {
                out.push(problem('forbidden_content',
                    'Здесь нельзя использовать двойную кавычку — она закроет атрибут раньше времени. ' +
                    'Замените её на «ёлочки» или на &quot;.'));
            }
            if (limiter === "'" && v.indexOf("'") >= 0) {
                out.push(problem('forbidden_content',
                    'Здесь нельзя использовать одинарную кавычку — она закроет атрибут раньше времени. ' +
                    'Замените её на &apos;.'));
            }
            if (/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/.test(v)) {
                out.push(problem('forbidden_content',
                    'Символ «&» в подписи к элементу надо писать как &amp; — иначе браузер прочитает его как код символа.'));
            }
        } else {
            if (v.indexOf('<') >= 0) {
                out.push(problem('forbidden_content',
                    'В обычном тексте нельзя ставить «<» — браузер примет его за начало тега. ' +
                    'Если нужен сам символ, напишите &lt;.'));
            }
        }

        return out;
    }

    /* Предупреждения: не блокируют запись, но о них надо сказать. */
    function warningsForInput(value, node, limiter) {
        var out = [];
        var v = String(value);

        if (node.kind === 'text' && /&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/.test(v)) {
            out.push(problem('ampersand',
                'В тексте есть «&». Если это просто амперсанд — всё в порядке. ' +
                'Если вы писали код символа, используйте &amp;.', null, 'warn'));
        }
        if (node.kind === 'attr' && v.indexOf('\n') >= 0) {
            out.push(problem('newline_in_attr',
                'В подписи к элементу перевод строки браузер схлопнет в пробел.', null, 'warn'));
        }
        if (node.kind === 'text' && v.indexOf('\n') >= 0) {
            out.push(problem('newline_in_text',
                'Перевод строки сохранится, но браузер покажет его как пробел. ' +
                'Перенос на странице делает отдельный элемент <br>.', null, 'warn'));
        }
        if (limiter === "'" && v.indexOf('"') >= 0) {
            out.push(problem('quote_inside',
                'Внутри одинарной кавычки двойная безопасна, но проверьте результат на сайте.', null, 'warn'));
        }
        return out;
    }

    /* Собирает вердикт из списка проблем. */
    function verdict(problems) {
        var errors = [];
        var warns = [];
        for (var i = 0; i < problems.length; i++) {
            if (problems[i].severity === 'warn' || problems[i].severity === 'info') warns.push(problems[i]);
            else errors.push(problems[i]);
        }
        return {
            ok: errors.length === 0,
            problems: problems,
            errors: errors,
            warnings: warns
        };
    }

    /* Новые проблемы одного вида: «после» минус «до». */
    function diffProblems(beforeList, afterList) {
        var keys = afterList.map(function (p) { return p.code + '|' + p.message; });
        return newOnly(
            beforeList.map(function (p) { return p.code + '|' + p.message; }), keys);
    }
    /**
     * Кавычка, которой ограничено значение атрибута: '"' или "'".
     * Нужна, чтобы не дать владельцу съесть ограничитель и не превратить
     * разметку в текст атрибута (это ломает страницу молча).
     */
    function attrLimiter(html, node) {
        if (!node || node.kind !== 'attr') return null;
        var start = node.start;
        if (typeof start !== 'number' || start < 1) return null;
        var q = String(html).charAt(start - 1);
        if (q === '"' || q === "'") return q;
        return null;
    }

    /* Человеческое имя вида узла — для бейджа в списке. */
    function kindLabel(node) {
        if (!node) return '';
        if (node.kind === 'text') return 'текст';
        if (node.attr === 'alt') return 'alt';
        if (node.attr === 'placeholder') return 'placeholder';
        if (node.attr === 'title') return 'title';
        if (node.attr === 'aria-label') return 'aria';
        if (node.attr && node.attr.indexOf('data-i18n') === 0) return 'ключ';
        return node.attr || 'attr';
    }

    /**
     * Проверка правки HTML — десять проверок из §5.2 архитектуры.
     *
     * Порядок намеренно «от дешёвого к дорогому», но короткого замыкания нет:
     * владелец должен увидеть полную картину, а не первую строку.
     *
     * @param {string} before Исходный текст файла.
     * @param {string} after Текст после сплайса.
     * @param {Object} node Правленый узел (смещения в before).
     * @param {string} newValue Значение, которое вставлено.
     * @param {Object=} opts { site }.
     * @return {Object} { ok, problems, errors, warnings }
     */
    function validateHtmlEdit(before, after, node, newValue, opts) {
        var b = String(before == null ? '' : before);
        var a = String(after == null ? '' : after);
        var value = String(newValue == null ? '' : newValue);
        var site = siteOf(opts);
        var problems = [];

        if (!node || typeof node.start !== 'number') {
            return verdict([problem('no_node', 'Не выбран текст для правки.')]);
        }

        var start = node.start;
        var end = node.end;

        /* --- 1. slice_invariants ------------------------------------------ */
        var headOK = a.slice(0, start) === b.slice(0, start);
        var tailOK = a.slice(start + value.length) === b.slice(end);
        if (!headOK || !tailOK) {
            problems.push(problem('slice_invariants',
                'Правка задела текст вне выбранной строки — запись отменена, файл не тронут. ' +
                'Обновите список текстов и повторите.', start));
        }

        /* --- 2. tag_counts ------------------------------------------------ */
        var sb = structureOf(b);
        var sa = structureOf(a);
        var names = Object.create(null);
        Object.keys(sb.counts).forEach(function (k) { names[k] = true; });
        Object.keys(sa.counts).forEach(function (k) { names[k] = true; });

        Object.keys(names).sort().forEach(function (name) {
            var nb = sb.counts[name] || 0;
            var na = sa.counts[name] || 0;
            if (na < nb) {
                problems.push(problem('tag_counts',
                    'Пропали элементы <' + name + '>: было ' + nb + ', стало ' + na +
                    '. Так с витрины выпадает целый блок, поэтому запись отменена.'));
            }
            if (na > nb && !INLINE_OK[name] && !RAW_TEXT[name]) {
                problems.push(problem('tag_counts',
                    'Появились лишние элементы <' + name + '>: было ' + nb + ', стало ' + na +
                    '. Теги в обычный текст вставлять нельзя.'));
            }
        });

        /* --- 3. tag_balance ----------------------------------------------- */
        var danglingB = sb.unbalanced.length;
        var danglingA = sa.unbalanced.length;
        var newDangling = newOnly(sb.unbalanced, sa.unbalanced);
        if (newDangling.length) {
            problems.push(problem('tag_balance',
                'Правка сломала вложенность тегов (' + newDangling.slice(0, 3).join(', ') + '). ' +
                'Такой файл браузер покажет неправильно, поэтому запись отменена.'));
        } else if (danglingA > danglingB) {
            problems.push(problem('tag_balance',
                'После правки стало больше незакрытых тегов: было ' + danglingB +
                ', стало ' + danglingA + '. Запись отменена.'));
        }

        /* --- 4. stray_markup ---------------------------------------------- */
        var strayNew = diffProblems(inspectTextNodes(b), inspectTextNodes(a));
        if (strayNew.length) {
            problems.push(problem('stray_markup',
                'В тексте остался символ «<» — браузер примет его за начало тега. ' +
                'Уберите его или напишите &lt;.', start));
        }
        var attrAfter = inspectAttributes(a);
        var attrNew = diffProblems(inspectAttributes(b), attrAfter);
        for (var ap = 0; ap < attrAfter.length; ap++) {
            var key = attrAfter[ap].code + '|' + attrAfter[ap].message;
            if (attrNew.indexOf(key) < 0) continue;
            problems.push(problem(attrAfter[ap].code,
                'Подпись к элементу получилась с ошибкой: ' + attrAfter[ap].message,
                attrAfter[ap].at));
            attrNew.splice(attrNew.indexOf(key), 1);
        }

        /* --- 5. attr_quote_intact ----------------------------------------- */
        if (node.kind === 'attr') {
            var limiterBefore = attrLimiter(b, node);
            var afterNodes = extractTexts(a, { site: site });
            var found = null;
            for (var i = 0; i < afterNodes.length; i++) {
                var cand = afterNodes[i];
                if (cand.fp === node.fp && cand.start === start && cand.value === value) {
                    found = cand;
                    break;
                }
            }
            if (!found) {
                problems.push(problem('attr_quote_intact',
                    'После правки подпись к элементу не находится на своём месте. Похоже, ' +
                    'сломалась кавычка атрибута. Запись отменена.', start));
            } else if (limiterBefore !== null && attrLimiter(a, found) !== limiterBefore) {
                problems.push(problem('attr_quote_intact',
                    'Кавычка атрибута изменилась. Так разметка молча превращается в текст, ' +
                    'поэтому запись отменена.', start));
            }
        }

        /* --- 6. value_present_once ---------------------------------------- */
        if (value) {
            var prevCount = countOccurrences(b, value);
            var nowCount = countOccurrences(a, value);
            if (nowCount !== prevCount + 1) {
                problems.push(problem('value_present_once',
                    'Новый текст встречается на странице ' + nowCount + ' раз вместо ' +
                    (prevCount + 1) + '. Он совпадает с другим местом — выберите формулировку ' +
                    'подлиннее, чтобы правка была однозначной.'));
            }
        }

        /* --- 7. length_sane ------------------------------------------------ */
        var expectedDelta = value.length - String(node.value).length;
        var realDelta = a.length - b.length;
        if (realDelta !== expectedDelta) {
            problems.push(problem('length_sane',
                'Длина файла изменилась на ' + realDelta + ' символов вместо ' + expectedDelta +
                '. Запись отменена.', start));
        }

        /* --- 8. no_doc_truncation ----------------------------------------- */
        var DOC_TAGS = ['html', 'body'];
        for (var d = 0; d < DOC_TAGS.length; d++) {
            var tag = DOC_TAGS[d];
            if (endsWithClose(b, tag) && !endsWithClose(a, tag)) {
                problems.push(problem('no_doc_truncation',
                    'Документ перестал закрываться </' + tag + '> — файл не должен обрываться.'));
            }
            if ((sb.counts[tag] || 0) > 0 && (sa.counts[tag] || 0) === 0) {
                problems.push(problem('no_doc_truncation',
                    'Из документа пропал элемент <' + tag + '>.'));
            }
        }
        if (incompleteTail(a) && !incompleteTail(b)) {
            problems.push(problem('no_doc_truncation',
                'Файл обрывается внутри тега. Запись отменена.'));
        }

        /* --- 9. forbidden_content ----------------------------------------- */
        var forbidden = forbiddenInInput(value, node, attrLimiter(b, node));
        for (var f = 0; f < forbidden.length; f++) problems.push(forbidden[f]);

        /* --- 10. rescan ---------------------------------------------------- */
        var rescanProblems = [];
        try {
            var saNodes = extractTexts(a, { site: site });
            if (saNodes.length !== extractTexts(b, { site: site }).length) {
                rescanProblems.push('число строк изменилось');
            }
            var seen = false;
            for (var r = 0; r < saNodes.length; r++) {
                if (saNodes[r].fp === node.fp && saNodes[r].value === value) { seen = true; break; }
            }
            if (!seen) rescanProblems.push('правка не видна в файле');
        } catch (e) {
            rescanProblems.push('файл не разбирается');
        }
        if (rescanProblems.length) {
            problems.push(problem('rescan',
                'После правки страница перестала нормально читаться (' + rescanProblems.join(', ') +
                '). Запись отменена.'));
        }

        /* --- 11. crlf_style ------------------------------------------------
           Файлы сайта — CRLF. Если правка превратит файл в LF (или наоборот),
           git покажет изменённым весь файл, и владелец больше не увидит,
           что именно он поправил. Проверяем не «число \r\n не изменилось»
           (владелец вправе убрать перевод строки внутри своего текста),
           а сохранение стиля файла: доля CRLF среди переводов строк не
           должна обнулиться или появиться с нуля. */
        var crlfB = (b.match(/\r\n/g) || []).length;
        var crlfA = (a.match(/\r\n/g) || []).length;
        var lfB = (b.match(/\n/g) || []).length;
        var lfA = (a.match(/\n/g) || []).length;
        var crlfOnlyB = lfB > 0 && crlfB === lfB;
        var crlfOnlyA = lfA > 0 && crlfA === lfA;
        if (crlfOnlyB !== crlfOnlyA) {
            problems.push(problem('crlf_style',
                'Сбились переводы строк: файл был в формате ' + (crlfOnlyB ? 'Windows' : 'Unix') +
                ', а стал ' + (crlfOnlyA ? 'Windows' : 'Unix') + '. Из-за этого в истории ' +
                'изменений файл покажется переписанным целиком. Запись отменена.', start));
        }
        if (crlfB > 0 && crlfA === 0) {
            problems.push(problem('crlf_style',
                'В файле пропали переводы строк Windows (\\r\\n). Запись отменена — ' +
                'история изменений стала бы бесполезной.', start));
        }

        /* Предупреждения: показываем, но не блокируем. */
        var warns = warningsForInput(value, node, attrLimiter(b, node));
        for (var w = 0; w < warns.length; w++) problems.push(warns[w]);

        return verdict(problems);
    }
    /**
     * Живой поиск узла перед сохранением (§5.5).
     *
     * Зачем: смещения, показанные владельцу, относятся к тексту, прочитанному
     * при открытии вкладки. Пока он думал над формулировкой, файл мог
     * измениться (робот, второй администратор, наш же предыдущий коммит).
     * Кэшировать текст между сохранениями нельзя — позиция проверяется заново.
     *
     * Правило жёсткое: ноль или больше одного кандидата — отказ. Неоднозначно
     * не пишем никогда: лучше попросить владельца обновить список, чем
     * заменить не ту строку.
     *
     * @param {string} html Свежий текст файла.
     * @param {Object} node Узел, который правили (смещения в старом тексте).
     * @param {Object=} opts { site }.
     * @return {Object|null} Узел со свежими смещениями либо null.
     */
    function reLocate(html, node, opts) {
        var src = String(html == null ? '' : html);
        if (!node) return null;

        /* 1. Быстрая удача: старые смещения всё ещё указывают на тот же текст. */
        if (typeof node.start === 'number' && src.slice(node.start, node.end) === node.value) {
            return withFreshPosition(src, node);
        }

        /* 2. Окно вокруг прежнего места. */
        var from = Math.max(0, (node.start || 0) - RELOCATE_RADIUS);
        var to = Math.min(src.length, (node.start || 0) + RELOCATE_RADIUS);
        var window = src.slice(from, to);
        var candidates = textNodes(window, opts).nodes;
        var match = [];

        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            if (c.fp !== node.fp) continue;

            var preOK = c.pre === node.pre;
            var valOK = c.value === node.value;
            var postOK = c.post === node.post;
            if (!preOK) continue;
            if (!valOK && !postOK) continue;

            match.push({
                node: c,
                start: from + c.start,
                end: from + c.end
            });
        }

        /* Уточняем по совпадению post, если кандидатов несколько. */
        if (match.length > 1) {
            var strict = match.filter(function (m) {
                return m.start === node.start || (node.post && src.slice(m.end, m.end + node.post.length).toLowerCase() === node.post);
            });
            if (strict.length === 1) match = strict;
        }

        if (match.length !== 1) return null;

        var fresh = withFreshPosition(src, match[0].node);
        fresh.start = match[0].start;
        fresh.end = match[0].end;
        fresh.value = src.slice(fresh.start, fresh.end);
        fresh.line = lineOf(src, fresh.start);
        fresh.labelMain = fresh.labelMain || ('строка ' + fresh.line);
        fresh.label = buildLabel(fresh);
        return fresh;
    }

    /* Пересчитать служебные поля узла по текущему тексту файла. */
    function withFreshPosition(src, node) {
        var fp = fingerprint(src, node.start, node.end, node.kind, node.tag, node.attr);
        var out = {
            id: node.id,
            kind: node.kind,
            tag: node.tag,
            attr: node.attr,
            value: src.slice(node.start, node.end),
            start: node.start,
            end: node.end,
            fp: fp.fp,
            pre: fp.pre,
            post: fp.post,
            line: lineOf(src, node.start),
            zone: node.zone || null,
            ord: node.ord || null,
            markerTs: null,
            seo: !!node.seo,
            labelMain: node.labelMain || '',
            labelSub: node.labelSub || '',
            labelRole: node.labelRole || '',
            label: node.label || ''
        };
        return out;
    }

    /**
     * Единственная мутация файла: один сплайс по смещению.
     *
     * ВАЖНО: именно slice, а не String.replace. В текстах сайта встречаются
     * «$&» и "$'" — строковая замена истолковала бы их как подстановку и
     * съела молча. slice этого не делает никогда.
     *
     * @param {string} html Исходный текст файла.
     * @param {Object} node Правленый узел.
     * @param {string} newValue Новое значение.
     * @param {Object=} opts { site }.
     * @return {Object} { text, problems, ok, value }
     */
    function applyEdit(html, node, newValue, opts) {
        var src = String(html == null ? '' : html);

        if (!node || typeof node.start !== 'number') {
            return {
                text: null,
                ok: false,
                value: '',
                problems: [problem('no_node', 'Не выбран текст для правки.')]
            };
        }

        /* Нормализация: только края. Внутренние переводы строк сохраняются —
           владелец пишет их осознанно. */
        var value = trimValue(newValue);

        /* Ничего не изменилось — писать нечего, это не ошибка. */
        if (value === node.value) {
            return { text: src, ok: true, value: value, problems: [] };
        }

        /* Смещения должны указывать на исходное значение, иначе сплайс
           вырежет не тот кусок. */
        if (src.slice(node.start, node.end) !== node.value) {
            return {
                text: null,
                ok: false,
                value: value,
                problems: [problem('position_stale',
                    'Страница изменилась с тех пор, как вы открыли список. ' +
                    'Обновите список и найдите строку заново — запись не выполнялась.', node.start)]
            };
        }

        var after = src.slice(0, node.start) + value + src.slice(node.end);
        var check = validateHtmlEdit(src, after, node, value, opts);

        if (!check.ok) {
            return { text: null, ok: false, value: value, problems: check.problems };
        }

        return { text: after, ok: true, value: value, problems: check.problems };
    }

    /* ========================================================================
     *  7. ЭКСПОРТ
     * ====================================================================== */

    var API = {
        /* --- разбор --- */
        extractTexts: extractTexts,
        textNodes: textNodes,
        readOpenTag: readOpenTag,
        hasLetterOrDigit: hasLetterOrDigit,

        /* --- подписи и классификация --- */
        describeNode: describeNode,
        kindLabel: kindLabel,
        isSeoNode: isSeoNode,
        attrLimiter: attrLimiter,

        /* --- запись --- */
        applyEdit: applyEdit,
        validateHtmlEdit: validateHtmlEdit,
        reLocate: reLocate,

        /* --- служебное (пригодится тестам и панели) --- */
        structureOf: structureOf,
        I18N_ATTRS: I18N_ATTRS,
        I18N_ATTR_MAP: I18N_ATTR_MAP,
        TITLE_SEO_BY_SITE: TITLE_SEO_BY_SITE,
        hasI18nPair: hasI18nPair,
        i18nFieldOf: i18nFieldOf,
        TEXT_ATTRS_RU: TEXT_ATTRS_RU,
        TEXT_ATTRS_UAE: TEXT_ATTRS_UAE,
        RAW_TEXT: RAW_TEXT,
        ZONE: ZONE
    };

    if (typeof root !== 'undefined' && root) {
        root.LUMISTEK_TEXTS = API;
    }

    /* Офлайн-тесты под Node: та же схема, что в admin.js. */
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = API;
    }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
