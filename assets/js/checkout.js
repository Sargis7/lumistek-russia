/**
 * ============================================================================
 *  LUMISTEK — ОФОРМЛЕНИЕ ЗАКАЗА
 * ============================================================================
 *
 *  Этот файл делает три вещи:
 *    1. Проверяет, что покупатель заполнил форму правильно.
 *    2. Отправляет заказ в Telegram (бот → ваш чат).
 *    3. Показывает экран «Спасибо за заказ!».
 *
 *  Требует, чтобы на странице уже были загружены catalog.js и cart.js
 *  (window.LUMISTEK_CATALOG и window.LumistekCart).
 *
 * ----------------------------------------------------------------------------
 *  НАСТРОЙКА TELEGRAM — ПРОЧТИТЕ, ЭТО 2 МИНУТЫ
 * ----------------------------------------------------------------------------
 *
 *  1. Создайте бота.
 *     Откройте Telegram, найдите @BotFather, отправьте ему /newbot.
 *     Придумайте имя и username. Он выдаст токен такого вида:
 *         123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4-j1o
 *     Скопируйте его в TG_BOT_TOKEN ниже.
 *
 *  2. Узнайте chat_id.
 *     Напишите боту @userinfobot — он ответит вашим ID (число).
 *     Скопируйте его в TG_CHAT_ID ниже.
 *     Хотите, чтобы заказы падали в общий чат? Добавьте туда бота
 *     и возьмите ID группы — он начинается с -100.
 *
 *  3. ВАЖНО ПРО БЕЗОПАСНОСТЬ.
 *     Токен виден любому, кто откроет исходный код страницы
 *     (правая кнопка мыши → «Просмотр кода страницы»). Поэтому:
 *       • заведите ОТДЕЛЬНОГО бота только для заказов;
 *       • не используйте его для чего-то ещё;
 *       • если токен утёк — /revoke у @BotFather и вставьте новый.
 *     Посторонний сможет писать в этот чат от имени бота. Ничего
 *     страшнее спама он сделать не сможет, но знать об этом стоит.
 *
 *  Пока в TG_BOT_TOKEN стоит заглушка, сайт работает в ДЕМО-РЕЖИМЕ:
 *  заказ никуда не уходит, но экран «Спасибо» показывается — удобно
 *  проверять, как всё выглядит. В демо-режиме под номером заказа
 *  появляется пометка.
 * ============================================================================
 */

(function (window, document) {

    'use strict';

    /* ======================================================================
     *  1. НАСТРОЙКИ — ВПИШИТЕ СВОИ ЗНАЧЕНИЯ СЮДА
     * ====================================================================== */
    var TG_BOT_TOKEN = '9036359024:AAE_jBRlw-O_JtgT-ykpAHTVci-qU0MwdO8';

    /* ВАЖНО: это ID ГРУППЫ «Lumistek Orders Russia».
       У групп Telegram ID всегда отрицательный — минус в начале обязателен.
       Именно поэтому здесь -5447041065, а не 5447041065. */
    var TG_CHAT_ID   = '-5447041065';

    /* Сколько ждать ответа Telegram, мс. 15000 = 15 секунд. */
    var SEND_TIMEOUT_MS = 15000;

    /* Телефон компании — показывается, если отправка не удалась. */
    var PHONE = '+7 (991) 718-44-42';


    /* ======================================================================
     *  2. МЕЛКИЕ ПОМОЩНИКИ
     * ====================================================================== */

    function byId(id) { return document.getElementById(id); }

    function all(sel, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    }

    /* Токен заполнен и похож на настоящий? */
    function telegramConfigured() {
        var t = String(TG_BOT_TOKEN).trim();
        var c = String(TG_CHAT_ID).trim();
        if (t.indexOf('ВСТАВЬТЕ') !== -1 || c.indexOf('ВСТАВЬТЕ') !== -1) return false;
        if (c === '') return false;
        /* Настоящий токен: цифры, двоеточие, длинная строка. */
        return /^\d{6,}:[A-Za-z0-9_\-]{30,}$/.test(t);
    }

    /* Номер заказа вида LM-M4K2P1-X7 — коротко и не повторяется. */
    function makeOrderNumber() {
        var t = Date.now().toString(36).toUpperCase();
        var r = Math.floor(Math.random() * 1296).toString(36).toUpperCase();
        while (r.length < 2) { r = '0' + r; }
        return 'LM-' + t + '-' + r;
    }

    /* Время по Москве — менеджеру понятнее, чем время браузера клиента. */
    function moscowStamp() {
        var d = new Date();
        try {
            return d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        } catch (e) {
            return d.toLocaleString('ru-RU');
        }
    }

    /* Телефон: минимум 10 цифр, допускаем +, пробелы, скобки, дефисы. */
    function isPhoneValid(value) {
        var s = String(value).trim();
        if (!/^[+\d][\d\s()\-]*$/.test(s)) return false;
        var digits = s.replace(/\D/g, '');
        return digits.length >= 10 && digits.length <= 15;
    }


    /* ======================================================================
     *  3. ТЕКСТ СООБЩЕНИЯ ДЛЯ TELEGRAM
     * ======================================================================
     *  Отправляем обычным текстом, без parse_mode. Так сообщение
     *  не сломается из-за кавычек, звёздочек или скобок в названии товара.
     */

    function buildOrderText(order) {
        var L = [];

        L.push('🛒 НОВЫЙ ЗАКАЗ — Lumistek');
        L.push('Номер: ' + order.number);
        L.push('Время: ' + order.stamp + ' (МСК)');
        L.push('');
        L.push('——— СОСТАВ ЗАКАЗА ———');

        order.lines.forEach(function (it, i) {
            var sum = it.isOnRequest ? 'цена по запросу'
                                     : window.LumistekCart.formatPrice(it.lineTotal);
            L.push((i + 1) + '. ' + it.name);
            L.push('    ' + it.unitLabel + ' × ' + it.qty + ' = ' + sum);
        });

        L.push('');
        L.push('Позиций: ' + order.lines.length + ', единиц: ' + order.totalQty);
        L.push('ИТОГО: ' + order.totalText +
               (order.hasOnRequest ? ' (плюс позиции по запросу)' : ''));
        L.push('');
        L.push('——— ПОКУПАТЕЛЬ ———');
        L.push('ФИО: ' + order.name);
        L.push('Телефон: ' + order.phone);
        L.push('Город: ' + order.city);
        L.push('Получение: ' + order.delivery);
        if (order.address) { L.push('Адрес: ' + order.address); }
        if (order.comment) { L.push('Комментарий: ' + order.comment); }

        return L.join('\n');
    }


    /* ======================================================================
     *  4. ОШИБКИ В ФОРМЕ
     * ====================================================================== */

    function clearFieldErrors() {
        all('[data-error-for]').forEach(function (p) {
            p.classList.add('hidden');
            p.textContent = '';
        });
        ['order-name', 'order-phone', 'order-city', 'order-address'].forEach(function (id) {
            var el = byId(id);
            if (el) { el.classList.remove('border-brand-pink'); }
        });
    }

    /* Показывает подсказку у поля. Возвращает id поля — контракт явный:
       раньше функция ничего не возвращала, и это легко принять за ошибку. */
    function showFieldError(fieldId, message) {
        var p = document.querySelector('[data-error-for="' + fieldId + '"]');
        if (p) {
            p.textContent = message;
            p.classList.remove('hidden');
        }
        var el = byId(fieldId);
        if (el && el.type !== 'checkbox') { el.classList.add('border-brand-pink'); }
        return fieldId;
    }

    /* Прячем плашку общей ошибки И стираем текст.
       Обнулять текст обязательно: без этого в скрытом блоке остаётся
       старое сообщение (например «В корзине нет товаров»), и оно
       всплывёт при следующем показе — уже не по делу. */
    function hideOrderError() {
        var box = byId('order-error');
        var txt = byId('order-error-text');
        if (box) {
            box.classList.add('hidden');
            box.classList.remove('flex');
        }
        if (txt) { txt.textContent = ''; }
    }

    function showOrderError(message) {
        var box = byId('order-error');
        var txt = byId('order-error-text');
        if (txt && message) { txt.textContent = message; }
        if (box) {
            box.classList.remove('hidden');
            box.classList.add('flex');
            if (box.scrollIntoView) {
                box.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }


    /* ======================================================================
     *  5. СБОР И ПРОВЕРКА ДАННЫХ ФОРМЫ
     * ====================================================================== */

    function addressRequired() {
        var wrap = byId('order-address-wrap');
        return !!wrap && !wrap.classList.contains('hidden');
    }

    /* Возвращает объект заказа или null, если что-то не заполнено.
       При ошибке показывает подсказки и переводит фокус на проблемное поле. */
    function collectOrder() {
        clearFieldErrors();
        hideOrderError();

        var nameEl    = byId('order-name');
        var phoneEl   = byId('order-phone');
        var cityEl    = byId('order-city');
        var addrEl    = byId('order-address');
        var delivEl   = byId('order-delivery');
        var commEl    = byId('order-comment');
        var consentEl = byId('order-consent');

        var name     = nameEl    ? nameEl.value.trim()    : '';
        var phone    = phoneEl   ? phoneEl.value.trim()   : '';
        var city     = cityEl    ? cityEl.value.trim()    : '';
        var address  = addrEl    ? addrEl.value.trim()    : '';
        var delivery = delivEl   ? delivEl.value          : 'Самовывоз';
        var comment  = commEl    ? commEl.value.trim()    : '';
        var consent  = !!(consentEl && consentEl.checked);

        var firstBad = null;
        function bad(id, msg) {
            showFieldError(id, msg);
            if (!firstBad) { firstBad = id; }
        }

        if (name.length < 2) {
            bad('order-name', 'Укажите ваше имя.');
        }
        if (!phone) {
            bad('order-phone', 'Укажите номер телефона.');
        } else if (!isPhoneValid(phone)) {
            bad('order-phone', 'Проверьте номер — нужно не меньше 10 цифр.');
        }
        if (city.length < 2) {
            bad('order-city', 'Укажите город.');
        }
        if (addressRequired() && address.length < 4) {
            bad('order-address', 'Укажите адрес доставки.');
        }
        if (!consent) {
            var p = document.querySelector('[data-error-for="order-consent"]');
            if (p) {
                p.textContent = 'Нужно согласие на обработку данных.';
                p.classList.remove('hidden');
            }
            if (!firstBad) { firstBad = 'order-consent'; }
        }

        if (firstBad) {
            var el = byId(firstBad);
            if (el) {
                if (el.scrollIntoView) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                if (el.focus) {
                    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
                }
            }
            return null;
        }

        var items = window.LumistekCart.items();
        var totalQty = 0;
        items.forEach(function (i) { totalQty += i.qty; });

        return {
            number:       makeOrderNumber(),
            stamp:        moscowStamp(),
            lines:        items,
            totalQty:     totalQty,
            totalText:    window.LumistekCart.totalFormatted(),
            hasOnRequest: window.LumistekCart.hasOnRequest
                            ? window.LumistekCart.hasOnRequest() : false,
            name:         name,
            phone:        phone,
            city:         city,
            delivery:     delivery,
            address:      address,
            comment:      comment
        };
    }


    /* ======================================================================
     *  6. ОТПРАВКА В TELEGRAM
     * ====================================================================== */

    function sendToTelegram(order) {
        var url = 'https://api.telegram.org/bot' +
                  String(TG_BOT_TOKEN).trim() + '/sendMessage';

        var body = {
            chat_id: String(TG_CHAT_ID).trim(),
            text: buildOrderText(order),
            disable_web_page_preview: true
        };

        /* Таймаут — чтобы кнопка не висела вечно при плохой сети. */
        var controller = null;
        var opts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        };

        if (typeof window.AbortController === 'function') {
            controller = new window.AbortController();
            opts.signal = controller.signal;
        }

        var timer = window.setTimeout(function () {
            if (controller) { controller.abort(); }
        }, SEND_TIMEOUT_MS);

        return window.fetch(url, opts).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
                window.clearTimeout(timer);
                if (!res.ok || !data || data.ok !== true) {
                    var why = (data && data.description) ? data.description
                                                         : ('HTTP ' + res.status);
                    throw new Error(why);
                }
                return true;
            });
        }).catch(function (err) {
            window.clearTimeout(timer);
            throw err;
        });
    }

    /* Понятное объяснение вместо технической ошибки. */
    function humanSendError(err) {
        var d = (err && err.message) ? String(err.message) : '';

        if (/abort/i.test(d)) {
            return 'Telegram не ответил вовремя. Проверьте интернет и попробуйте ещё раз.';
        }
        if (/chat not found/i.test(d)) {
            return 'Бот не может написать в этот чат. Проверьте TG_CHAT_ID или напишите боту первым.';
        }
        if (/bot was blocked|user is deactivated/i.test(d)) {
            return 'Бот заблокирован получателем. Разблокируйте бота в Telegram.';
        }
        if (/unauthorized/i.test(d)) {
            return 'Токен бота неверный. Проверьте TG_BOT_TOKEN.';
        }
        if (/not found/i.test(d) && /404/i.test(d)) {
            return 'Токен или чат указаны неверно. Проверьте TG_BOT_TOKEN и TG_CHAT_ID.';
        }
        if (/Failed to fetch|NetworkError|load failed/i.test(d)) {
            return 'Нет связи с Telegram. Проверьте интернет — или позвоните нам, мы оформим заказ вручную.';
        }
        return 'Не удалось отправить заказ. Позвоните нам: ' + PHONE;
    }


    /* ======================================================================
     *  7. ЭКРАН «СПАСИБО ЗА ЗАКАЗ»
     * ====================================================================== */

    function showSuccess(order, demo) {
        var checkout   = byId('checkout');
        var cartBlock  = byId('cart-main');
        var emptyBlock = byId('cart-empty');
        var success    = byId('order-success');
        var head       = byId('cart-page-head');
        var numEl      = byId('success-order-number');
        var demoNote   = byId('success-demo-note');
        var demoSpace  = byId('success-demo-spacer');

        /* Заказ ушёл — плашка ошибки не должна пережить успех.
           Иначе при следующем показе блока всплывёт старое сообщение,
           которое противоречит уже оформленному заказу. */
        hideOrderError();

        if (numEl)     { numEl.textContent = order.number; }
        if (demoNote)  { demoNote.classList.toggle('hidden', !demo); }
        if (demoSpace) { demoSpace.classList.toggle('hidden', !!demo); }

        if (cartBlock)  { cartBlock.classList.add('hidden'); }
        if (emptyBlock) { emptyBlock.classList.add('hidden'); }
        if (checkout)   { checkout.classList.add('hidden'); }
        if (head)       { head.classList.add('hidden'); }

        if (success) {
            success.classList.remove('hidden');
            if (success.scrollIntoView) {
                success.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        /* Корзину чистим только после успешной отправки. Если Telegram
           не ответил, заказ остаётся — клиент может попробовать снова. */
        window.LumistekCart.clear();
        window.LumistekCart.updateBadge();

        /* ВАЖНО: clear() выбрасывает событие, и render() внутри cart.html
           снова показывает блок «Ваша корзина пуста». Поэтому после очистки
           прячем его ещё раз — экран «Спасибо» должен быть единственным. */
        window.setTimeout(function () {
            var eb = byId('cart-empty');
            var cb = byId('cart-main');
            var co = byId('checkout');
            var hd = byId('cart-page-head');
            if (eb) { eb.classList.add('hidden'); }
            if (cb) { cb.classList.add('hidden'); }
            if (co) { co.classList.add('hidden'); }
            if (hd) { hd.classList.add('hidden'); }
            if (success && success.scrollIntoView) {
                success.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 60);
    }


    /* ======================================================================
     *  8. ОТПРАВКА ФОРМЫ
     * ====================================================================== */

    function setSubmitBusy(on, label) {

        var btn = byId('order-submit');
        if (!btn) return;
        btn.disabled = !!on;
        btn.textContent = on ? (label || 'Отправляем…') : 'Оформить заказ';
    }

    function submitOrder(e) {
        if (e && e.preventDefault) { e.preventDefault(); }

        var order = collectOrder();
        if (!order) { return; }

        if (!order.lines.length) {
            showOrderError('В корзине нет товаров. Добавьте товар и попробуйте снова.');
            return;
        }

        var configured = telegramConfigured();
        setSubmitBusy(true, configured ? 'Отправляем…' : 'Отправляем… (демо)');

        /* Страховка: перед отправкой на экране не должно остаться
           следов прошлой неудачи. collectOrder() уже гасит плашку,
           но повторяем явно — так инвариант не зависит от его правок. */
        hideOrderError();

        var work;
        if (configured) {
            work = sendToTelegram(order);
        } else {
            /* Демо-режим: имитируем задержку, чтобы поведение было похожим
               на настоящую отправку. Заказ при этом никуда не уходит. */
            work = new Promise(function (resolve) {
                window.setTimeout(resolve, 900);
            });
        }

        work.then(function () {
            setSubmitBusy(false);
            showSuccess(order, !configured);
        }).catch(function (err) {
            setSubmitBusy(false);
            showOrderError(humanSendError(err));
        });
    }


    /* ======================================================================
     *  9. АДРЕС: показываем, только если выбран не самовывоз
     * ====================================================================== */

    function syncAddressVisibility() {
        var delivEl = byId('order-delivery');
        var wrap    = byId('order-address-wrap');
        if (!delivEl || !wrap) { return; }

        var need = delivEl.value !== 'Самовывоз';
        wrap.classList.toggle('hidden', !need);

        /* Если человек вернулся к самовывозу — гасим ошибку по адресу. */
        if (!need) {
            var el = byId('order-address');
            if (el) { el.classList.remove('border-brand-pink'); }
            var p = document.querySelector('[data-error-for="order-address"]');
            if (p) { p.classList.add('hidden'); }
        }
    }


    /* ======================================================================
     *  10. ТЕЛЕФОН: мягкая подстановка «+7 »
     * ====================================================================== */

    function initPhoneMask() {
        var el = byId('order-phone');
        if (!el) { return; }

        el.addEventListener('input', function () {
            var v = el.value;
            /* Начал с 8 — превращаем в +7, чтобы номер был единообразным. */
            if (/^8/.test(v.trim())) {
                el.value = '+7 ' + v.trim().slice(1).trim();
            } else if (v === '+7') {
                el.value = '+7 ';
            }
        });
    }


    /* ======================================================================
     *  11. ПРИВЯЗКА К ФОРМЕ
     * ====================================================================== */

    function bindCheckout() {
        var form = byId('order-form');
        if (form) {
            form.addEventListener('submit', submitOrder);
        }

        var delivEl = byId('order-delivery');
        if (delivEl) {
            delivEl.addEventListener('change', syncAddressVisibility);
        }

        /* Гасим красную подсветку, как только человек начал исправлять. */
        ['order-name', 'order-phone', 'order-city', 'order-address'].forEach(function (id) {
            var el = byId(id);
            if (!el) { return; }
            el.addEventListener('input', function () {
                el.classList.remove('border-brand-pink');
                var p = document.querySelector('[data-error-for="' + id + '"]');
                if (p) { p.classList.add('hidden'); }
                hideOrderError();
            });
        });

        var consentEl = byId('order-consent');
        if (consentEl) {
            consentEl.addEventListener('change', function () {
                var p = document.querySelector('[data-error-for="order-consent"]');
                if (p) { p.classList.add('hidden'); }
            });
        }

        initPhoneMask();
        syncAddressVisibility();

        /* Если корзину опустошили — прячем форму оформления.
           Но не трогаем экран «Спасибо»: заказ уже ушёл. */
        window.addEventListener(window.LumistekCart.EVENT_NAME, function () {
            var success = byId('order-success');
            if (success && !success.classList.contains('hidden')) { return; }

            var checkout = byId('checkout');
            if (checkout) {
                checkout.classList.toggle('hidden',
                    window.LumistekCart.items().length === 0);
            }
        });
    }


    /* ======================================================================
     *  12. ЗАПУСК
     * ====================================================================== */

    function boot() {
        if (!window.LumistekCart || !window.LUMISTEK_CATALOG) {
            /* Без общих скриптов оформление работать не может. */
            return;
        }
        bindCheckout();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})(window, document);
