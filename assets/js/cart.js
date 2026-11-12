/**
 * ============================================================================
 *  LUMISTEK — КОРЗИНА (общий модуль)
 * ============================================================================
 *
 *  Этот файл подключается на ДВУХ страницах:
 *      - catalog.html  (каталог — кнопка «В корзину»)
 *      - cart.html     (корзина — оформление заказа)
 *
 *  Он умеет:
 *    1. Читать/писать корзину в localStorage.
 *    2. Считать количество товаров и итоговую сумму.
 *    3. Форматировать цены по-русски: 63990 -> '63 990 ₽'.
 *    4. Обновлять счётчик-бейдж в шапке сайта.
 *
 *  ФОРМАТ ХРАНЕНИЯ (менять нельзя — на него завязаны обе страницы):
 *      localStorage['lumistek_cart'] = [
 *          { id: 'clear-pro', unit: 'roll', qty: 1 },
 *          ...
 *      ]
 *      id   — product.id из assets/js/catalog.js
 *      unit — unit.key из assets/js/catalog.js
 *      qty  — целое число, всегда >= 1
 *
 *  СОБЫТИЯ:
 *      При любом изменении корзины на window летит событие
 *      'lumistek:cart-changed'. Ловите его так:
 *          window.addEventListener('lumistek:cart-changed', function (e) {
 *              console.log(e.detail.count, e.detail.total);
 *          });
 *
 *  ЗАВИСИМОСТИ: желательно, чтобы до этого файла был подключён
 *  assets/js/catalog.js (он задаёт window.LUMISTEK_CATALOG).
 *  Если каталога нет — корзина не падает, а возвращает пустой список.
 *
 *  Правила правки: не удаляйте скобки { } [ ] , : . Строки — в кавычках.
 * ============================================================================
 */

(function (window, document) {
    'use strict';

    /* ======================================================================
     * 1. КОНСТАНТЫ
     * ==================================================================== */

    // Ключ в localStorage. Менять НЕЛЬЗЯ — иначе пропадут корзины покупателей.
    var STORAGE_KEY = 'lumistek_cart';

    // Имя события об изменениях.
    var EVENT_NAME = 'lumistek:cart-changed';

    // Неразрывный пробел (U+00A0) — разделитель тысяч: '63 990 ₽'.
    var NBSP = '\u00A0';

    // Символ рубля.
    var RUB = '\u20BD';


    /* ======================================================================
     * 2. ФОРМАТИРОВАНИЕ ЦЕННЫ
     * ==================================================================== */

    /**
     * Превращает число в русскую цену с неразрывными пробелами.
     *   63990    -> '63 990 ₽'
     *   4490     -> '4 490 ₽'
     *   1234567  -> '1 234 567 ₽'
     *   0 / NaN  -> '' (пустая строка — см. isPriceOnRequest)
     *
     * @param {number|string} value — цена в рублях
     * @return {string}
     */
    function formatPrice(value) {
        var n = Number(value);

        // Некорректная или нулевая цена — отдаём пустую строку,
        // чтобы на странице вместо «0 ₽» показалась подпись из unit.note.
        if (!isFinite(n) || n <= 0) return '';

        // Округляем до целых рублей и разбиваем на классы вручную,
        // без toLocaleString — так результат одинаков во всех браузерах.
        var digits = String(Math.round(n));
        var out = '';
        var counter = 0;

        for (var i = digits.length - 1; i >= 0; i--) {
            out = digits.charAt(i) + out;
            counter++;
            if (counter === 3 && i > 0) {
                out = NBSP + out;
                counter = 0;
            }
        }

        return out + NBSP + RUB;
    }

    /**
     * Цена «по запросу»? Так мы считаем всё, что не положительное число.
     * @param {number|string} value
     * @return {boolean}
     */
    function isPriceOnRequest(value) {
        var n = Number(value);
        return !isFinite(n) || n <= 0;
    }

    /**
     * Убирает пробелы и знак ₽ — если цену вводят руками в input.
     * @param {string} str
     * @return {number}
     */
    function parsePrice(str) {
        if (typeof str === 'number') return str;
        if (!str) return 0;
        var cleaned = String(str).replace(/[^0-9,.\-]/g, '').replace(',', '.');
        var n = parseFloat(cleaned);
        return isFinite(n) ? n : 0;
    }


    /* ======================================================================
     * 3. ЧТЕНИЕ / ЗАПИСЬ КОРЗИНЫ
     * ==================================================================== */

    /**
     * Читает корзину из localStorage.
     * Никогда не бросает исключение: при битых данных вернёт [].
     * @return {Array<{id: string, unit: string, qty: number}>}
     */
    function read() {
        var raw;
        try {
            raw = window.localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            // Приватный режим / отключённое хранилище.
            return [];
        }

        if (!raw) return [];

        var parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            return [];
        }

        if (!parsed || Object.prototype.toString.call(parsed) !== '[object Array]') return [];

        // Чистим записи: выбрасываем мусор, приводим qty к целому >= 1.
        var clean = [];
        for (var i = 0; i < parsed.length; i++) {
            var line = parsed[i];
            if (!line || typeof line !== 'object') continue;
            if (!line.id || !line.unit) continue;

            var qty = Math.floor(Number(line.qty));
            if (!isFinite(qty) || qty < 1) qty = 1;

            clean.push({
                id: String(line.id),
                unit: String(line.unit),
                qty: qty
            });
        }

        return clean;
    }

    /**
     * Записывает корзину в localStorage и рассылает событие.
     * @param {Array} lines
     * @return {Array} то, что реально записали
     */
    function write(lines) {
        var safe = (Object.prototype.toString.call(lines) === '[object Array]') ? lines : [];

        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
        } catch (e) {
            // Квота или приватный режим — молча продолжаем,
            // интерфейс всё равно обновится в текущей вкладке.
        }

        broadcast(safe);
        return safe;
    }

    /**
     * Сообщает странице, что корзина изменилась.
     */
    function broadcast(lines) {
        var count = countOf(lines);
        var total = totalOf(lines);

        var evt;
        try {
            evt = new window.CustomEvent(EVENT_NAME, {
                detail: { lines: lines, count: count, total: total }
            });
        } catch (e) {
            // Очень старые браузеры — запасной путь.
            evt = document.createEvent('CustomEvent');
            evt.initCustomEvent(EVENT_NAME, false, false, {
                lines: lines, count: count, total: total
            });
        }

        window.dispatchEvent(evt);
    }


    /* ======================================================================
     * 4. ПОИСК ТОВАРА И ВАРИАНТА В КАТАЛОГЕ
     * ==================================================================== */

    /**
     * Достаёт массив товаров из window.LUMISTEK_CATALOG.
     * @return {Array}
     */
    function allProducts() {
        var cat = window.LUMISTEK_CATALOG;
        if (!cat || !cat.products) return [];
        return cat.products;
    }

    /**
     * Находит товар по id.
     * @param {string} productId
     * @return {Object|null}
     */
    function findProduct(productId) {
        var list = allProducts();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === productId) return list[i];
        }
        return null;
    }

    /**
     * Находит вариант покупки внутри товара.
     * @param {Object} product
     * @param {string} unitKey
     * @return {Object|null}
     */
    function findUnit(product, unitKey) {
        if (!product || !product.units) return null;
        for (var i = 0; i < product.units.length; i++) {
            if (product.units[i].key === unitKey) return product.units[i];
        }
        return null;
    }

    /**
     * Обогащает строку корзины данными о товаре и варианте.
     * cart.html использует это, чтобы рисовать таблицу заказа.
     *
     * @param {{id: string, unit: string, qty: number}} line
     * @return {Object|null} null, если товар пропал из каталога
     */
    function enrich(line) {
        var product = findProduct(line.id);
        if (!product) return null;

        var unit = findUnit(product, line.unit);
        if (!unit) return null;

        var qty = Math.floor(Number(line.qty));
        if (!isFinite(qty) || qty < 1) qty = 1;

        var price = Number(unit.price);
        var onRequest = isPriceOnRequest(price);
        var lineTotal = onRequest ? 0 : price * qty;

        return {
            // Идентификаторы
            id: product.id,
            unitKey: unit.key,

            // Объекты целиком — удобно для разметки
            product: product,
            unit: unit,

            // Количество
            qty: qty,

            // Цены (числа)
            price: onRequest ? 0 : price,
            lineTotal: lineTotal,

            // Цены (готовые строки для вывода)
            priceFormatted: formatPrice(price),
            lineTotalFormatted: formatPrice(lineTotal),

            // Цена «по запросу»
            isOnRequest: onRequest,
            priceNote: unit.note || 'Цена по запросу',

            // Часто нужные поля товара — чтобы не лазить через .product
            name: product.name,
            subtitle: product.subtitle || '',
            image: product.image || '',
            badge: product.badge || '',
            unitLabel: unit.label || ''
        };
    }

    /**
     * Возвращает все строки корзины, обогащённые данными каталога.
     * Битые строки (товар удалён из каталога) пропускаются.
     * @return {Array<Object>}
     */
    function items() {
        var lines = read();
        var out = [];

        for (var i = 0; i < lines.length; i++) {
            var item = enrich(lines[i]);
            if (item) out.push(item);
        }

        return out;
    }


    /* ======================================================================
     * 5. ОПЕРАЦИИ НАД КОРЗИНОЙ
     * ==================================================================== */

    /**
     * Добавляет товар. Если такая пара (id + unit) уже есть — увеличивает qty.
     * @param {string} productId
     * @param {string} unitKey
     * @param {number} [qty=1]
     * @return {Array} новая корзина
     */
    function add(productId, unitKey, qty) {
        var amount = Math.floor(Number(qty));
        if (!isFinite(amount) || amount < 1) amount = 1;

        var lines = read();
        var found = false;

        for (var i = 0; i < lines.length; i++) {
            if (lines[i].id === productId && lines[i].unit === unitKey) {
                lines[i].qty = lines[i].qty + amount;
                found = true;
                break;
            }
        }

        if (!found) {
            lines.push({ id: String(productId), unit: String(unitKey), qty: amount });
        }

        return write(lines);
    }

    /**
     * Удаляет строку целиком.
     * @param {string} productId
     * @param {string} unitKey
     * @return {Array}
     */
    function remove(productId, unitKey) {
        var lines = read();
        var out = [];

        for (var i = 0; i < lines.length; i++) {
            if (lines[i].id === productId && lines[i].unit === unitKey) continue;
            out.push(lines[i]);
        }

        return write(out);
    }

    /**
     * Ставит точное количество. Если qty <= 0 — строка удаляется.
     * @param {string} productId
     * @param {string} unitKey
     * @param {number} qty
     * @return {Array}
     */
    function setQty(productId, unitKey, qty) {
        var amount = Math.floor(Number(qty));
        if (!isFinite(amount)) amount = 1;

        var lines = read();

        if (amount < 1) return remove(productId, unitKey);

        var found = false;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].id === productId && lines[i].unit === unitKey) {
                lines[i].qty = amount;
                found = true;
                break;
            }
        }

        if (!found) lines.push({ id: String(productId), unit: String(unitKey), qty: amount });

        return write(lines);
    }

    /**
     * Полностью очищает корзину.
     * @return {Array} []
     */
    function clear() {
        return write([]);
    }

    /**
     * Сколько всего единиц товара в корзине (сумма qty).
     * @param {Array} [lines] — если не передать, прочитает из localStorage
     * @return {number}
     */
    function countOf(lines) {
        var list = lines || read();
        var total = 0;
        for (var i = 0; i < list.length; i++) {
            total += Math.floor(Number(list[i].qty)) || 0;
        }
        return total;
    }

    /**
     * Количество единиц в корзине (публичный вариант).
     * @return {number}
     */
    function count() {
        return countOf(read());
    }

    /**
     * Итоговая сумма по сырым строкам корзины (без учёта названий товаров).
     * @param {Array} [lines]
     * @return {number}
     */
    function totalOf(lines) {
        var list = lines || read();
        var sum = 0;

        for (var i = 0; i < list.length; i++) {
            var product = findProduct(list[i].id);
            if (!product) continue;

            var unit = findUnit(product, list[i].unit);
            if (!unit) continue;

            var price = Number(unit.price);
            if (!isFinite(price) || price <= 0) continue;

            sum += price * (Math.floor(Number(list[i].qty)) || 0);
        }

        return sum;
    }

    /**
     * Итоговая сумма корзины.
     * @return {number}
     */
    function total() {
        return totalOf(read());
    }

    /**
     * Сколько единиц товара с конкретным id (по всем вариантам).
     * Удобно для карточки: показать «в корзине: 2».
     * @param {string} productId
     * @return {number}
     */
    function qtyOfProduct(productId) {
        var lines = read();
        var sum = 0;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].id === productId) sum += lines[i].qty;
        }
        return sum;
    }

    /**
     * Есть ли в корзине хотя бы одна позиция с ценой «по запросу».
     * Нужно на странице корзины, чтобы предупредить покупателя.
     * @return {boolean}
     */
    function hasOnRequest() {
        var list = items();
        for (var i = 0; i < list.length; i++) {
            if (list[i].isOnRequest) return true;
        }
        return false;
    }


    /* ======================================================================
     * 6. СЧЁТЧИК В ШАПКЕ САЙТА
     * ==================================================================== */

    /**
     * Обновляет ВСЕ бейджи с id="cart-count" на странице.
     * Если товаров 0 — бейдж скрывается.
     * Вызывается автоматически при каждом изменении корзины.
     */
    function updateBadge() {
        var badges = document.querySelectorAll('#cart-count');
        var n = count();

        for (var i = 0; i < badges.length; i++) {
            var badge = badges[i];

            if (n > 0) {
                badge.textContent = n > 99 ? '99+' : String(n);
                badge.classList.remove('hidden');
                badge.removeAttribute('aria-hidden');
            } else {
                badge.textContent = '0';
                badge.classList.add('hidden');
                badge.setAttribute('aria-hidden', 'true');
            }
        }

        return n;
    }

    /**
     * Запускает слежение за корзиной:
     *   - обновляет бейдж при старте;
     *   - обновляет бейдж при изменениях внутри этой вкладки;
     *   - обновляет бейдж, если корзину поменяли в другой вкладке.
     */
    function watch() {
        // Первичная отрисовка — после того как DOM готов.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', updateBadge);
        } else {
            updateBadge();
        }

        window.addEventListener(EVENT_NAME, updateBadge);

        // Другая вкладка изменила корзину.
        window.addEventListener('storage', function (e) {
            if (e && e.key === STORAGE_KEY) updateBadge();
        });
    }


    /* ======================================================================
     * 7. ПУБЛИЧНЫЙ ИНТЕРФЕЙС
     * ==================================================================== */

    window.LumistekCart = {
        // Константы — чтобы страницы не хардкодили строки
        STORAGE_KEY: STORAGE_KEY,
        EVENT_NAME: EVENT_NAME,

        // --- хранилище ---
        read: read,             // () -> [{id, unit, qty}]
        write: write,           // (lines) -> lines
        add: add,               // (productId, unitKey, qty?) -> lines
        remove: remove,         // (productId, unitKey) -> lines
        setQty: setQty,         // (productId, unitKey, qty) -> lines
        clear: clear,           // () -> []
        items: items,           // () -> обогащённые строки

        // --- подсчёты ---
        count: count,           // () -> число единиц
        total: total,           // () -> сумма в рублях
        totalFormatted: function () { return formatPrice(total()); },
        qtyOfProduct: qtyOfProduct,
        hasOnRequest: hasOnRequest,

        // --- каталог ---
        findProduct: findProduct,
        findUnit: findUnit,
        enrich: enrich,

        // --- цены ---
        formatPrice: formatPrice,
        isPriceOnRequest: isPriceOnRequest,
        parsePrice: parsePrice,

        // --- интерфейс ---
        updateBadge: updateBadge,
        watch: watch
    };

    // Сразу вешаем слежение за бейджем — страницам ничего вызывать не нужно.
    watch();

})(window, document);
