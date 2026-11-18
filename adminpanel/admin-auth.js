/**
 * ============================================================================
 *  LUMISTEK — ВХОД В АДМИН-ПАНЕЛЬ (клиентская часть привратника)
 * ============================================================================
 *
 *  ЗДЕСЬ НЕТ НИ ПАРОЛЯ, НИ ХЭША ПАРОЛЯ.
 *
 *  Пароль проверяет сервер — небольшой воркер Cloudflare
 *  (см. work/admin-gate/worker.js). Он же выдаёт cookie сессии:
 *  HttpOnly, поэтому прочитать её из JavaScript нельзя, а подделать —
 *  без серверного ключа тоже.
 *
 *  ПОЧЕМУ БЫЛО ПЛОХО РАНЬШЕ: в admin.js лежал SHA-256 от пароля.
 *  Хэш от пароля — это не защита, а его копия: любой, кто открыл
 *  исходник, мог подбирать пароль офлайн, без ограничения попыток,
 *  и в итоге зайти. Теперь перебор упирается в сервер.
 *
 *  ЧТО ЗДЕСЬ НАСТРАИВАЕТСЯ: адрес воркера в ADMIN_GATE_URL.
 * ========================================================================= */

(function () {
    'use strict';

    /* Адрес привратника. Один воркер обслуживает оба сайта,
       поэтому адрес одинаковый — различается только параметр site. */
    var ADMIN_GATE_URL = 'https://lumistek-admin-gate.lumistek.workers.dev/';

    /* Кто мы: 'ru' или 'uae'. Ставится в index.html до подключения файла. */
    var SITE = (window.LUM_ADMIN_SITE === 'uae') ? 'uae' : 'ru';

    function url(path) {
        var base = String(ADMIN_GATE_URL || '').replace(/\/+$/, '');
        return base + '/' + path;
    }

    function ready() {
        return !!String(ADMIN_GATE_URL || '').trim();
    }

    /* Проверка состояния: авторизован ли этот браузер.
       Возвращает { auth: bool, configured: bool, offline: bool }. */
    function session() {
        if (!ready()) return Promise.resolve({ auth: false, configured: false, offline: true });
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 12000);

        return fetch(url('session?site=' + SITE), {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal
        }).then(function (res) {
            clearTimeout(timer);
            if (!res.ok) return { auth: false, configured: true };
            return res.json().then(function (data) {
                return { auth: !!(data && data.auth), configured: true };
            });
        }).catch(function () {
            clearTimeout(timer);
            return { auth: false, configured: true, offline: true };
        });
    }

    /* Вход. Возвращает { ok, error }. Коды ошибок переводим на русский. */
    function login(password) {
        if (!ready()) return Promise.resolve({ ok: false, error: 'not_configured' });

        return fetch(url('login'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ site: SITE, password: String(password || '') })
        }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
                if (res.ok && data && data.ok === true) return { ok: true };
                return { ok: false, error: (data && data.error) || 'server_error', status: res.status };
            });
        }).catch(function () {
            return { ok: false, error: 'network' };
        });
    }

    /* Выход: гасим cookie на сервере. */
    function logout() {
        if (!ready()) return Promise.resolve({ ok: true });
        return fetch(url('logout?site=' + SITE), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ site: SITE })
        }).then(function () {
            return { ok: true };
        }).catch(function () {
            return { ok: true };
        });
    }

    /* Понятный текст вместо кода. */
    function errorText(code) {
        var map = {
            empty_password: 'Введите пароль.',
            bad_password: 'Неверный пароль. Попробуйте еще раз.',
            bad_site: 'Сайт определён неверно. Обновите страницу.',
            not_configured: 'Пароль панели не задан на сервере. Обратитесь к администратору.',
            network: 'Нет связи с сервером входа. Проверьте интернет и попробуйте снова.',
            server_error: 'Сервер не смог проверить пароль. Попробуйте позже.'
        };
        return map[code] || 'Не удалось войти. Попробуйте еще раз.';
    }

    window.LumAdminAuth = {
        site: SITE,
        ready: ready,
        session: session,
        login: login,
        logout: logout,
        errorText: errorText
    };
})();
