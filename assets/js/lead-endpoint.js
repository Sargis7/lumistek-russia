/**
 * Lumistek — адрес серверного прокси для заявок.
 *
 * Токен бота в коде сайта больше не хранится: он живёт в секретах
 * Cloudflare Worker. Здесь только публичный адрес прокси — он безвреден.
 *
 * Один файл на оба сайта (Россия и ОАЭ), чтобы менять адрес в одном месте.
 *
 * Если адрес не задан, формы переходят в демо-режим: показывают успех,
 * но никуда не отправляют. Это безопасное поведение по умолчанию —
 * лучше не отправить заявку, чем отправить её в неизвестное место.
 */

/* Адрес развёрнутого прокси. Для сайта России — свой воркер,
   для сайта ОАЭ — свой: у них разные боты и разные чаты заказов. */
var LEAD_ENDPOINT = 'https://lumistek-tg-ru.lumistek.workers.dev/';

/**
 * Есть ли живой прокси.
 * @returns {boolean}
 */
function leadEndpointReady() {
    return typeof LEAD_ENDPOINT === 'string' && LEAD_ENDPOINT.length > 0;
}

/**
 * Отправляет заявку в Telegram через прокси.
 *
 * @param {Object} lead
 * @param {string} lead.name     ФИО
 * @param {string} [lead.city]   Город
 * @param {string} lead.phone    Телефон
 * @param {string} [lead.comment] Доп. текст (например, товар из каталога)
 * @param {string} [lead.message] Готовый текст заказа. Если передан,
 *                               воркер отправляет его как есть и поля
 *                               name/city/phone использует только для
 *                               проверки.
 * @param {string} [lead.source] Откуда заявка, для заголовка сообщения
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function sendLead(lead) {
    if (!leadEndpointReady()) {
        return { ok: false, error: 'not_configured' };
    }

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);

    try {
        /* message/comment — единственные длинные поля; воркер их
           обрезает по своим лимитам, здесь можно не считать. */
        var res = await fetch(LEAD_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lead),
            signal: controller.signal
        });
        clearTimeout(timer);

        var data = null;
        try { data = await res.json(); } catch (e) { /* не JSON */ }

        if (data && data.ok === true) {
            return { ok: true };
        }
        return { ok: false, error: (data && data.error) || 'server_error' };
    } catch (e) {
        clearTimeout(timer);
        if (e && e.name === 'AbortError') return { ok: false, error: 'timeout' };
        return { ok: false, error: 'network' };
    }
}

/**
 * Человекочитаемое объяснение ошибки.
 * @param {string} code
 * @returns {string}
 */
var LEAD_TEXTS_RU = {
    not_configured: 'Отправка пока не настроена. Позвоните или напишите в мессенджер.',
    timeout:        'Сервер долго не отвечает. Попробуйте ещё раз.',
    network:        'Нет связи с сервером. Проверьте интернет и попробуйте снова.',
    phone_invalid:  'Похоже, телефон указан неверно.',
    name_required:  'Укажите, пожалуйста, имя.',
    server_error:   'Не удалось отправить заявку. Попробуйте ещё раз или позвоните.'
};

function leadErrorMessage(code) {
    return LEAD_TEXTS_RU[code] || LEAD_TEXTS_RU.server_error;
}

if (typeof window !== 'undefined') {
    window.LEAD_ENDPOINT = LEAD_ENDPOINT;
    window.leadEndpointReady = leadEndpointReady;
    window.sendLead = sendLead;
    window.leadErrorMessage = leadErrorMessage;
    /* Сайт ОАЭ берёт отсюда русские формулировки для владельца,
       а видимый текст подставляет из своего словаря. */
    window.LUMISTEK_LEAD_TEXTS_RU = LEAD_TEXTS_RU;
}
