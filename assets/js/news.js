/**
 * ============================================================================
 *  LUMISTEK — БЛОК НОВОСТЕЙ (YouTube Shorts)
 * ============================================================================
 *
 *  НАСТРАИВАТЬ ЭТОТ ФАЙЛ НЕ НУЖНО. Все настройки — в assets/js/config.js.
 *
 *  Откуда берутся видео (от быстрого к запасному):
 *
 *    1. fallbackShorts из config.js — рисуются мгновенно, ещё до загрузки
 *       чего-либо. Поэтому блок никогда не выглядит пустым.
 *
 *    2. news.json в корне сайта — основной источник. Свой домен, без CORS,
 *       загружается за доли секунды. Обновляется сам раз в сутки
 *       (GitHub Actions → scripts/fetch-news.mjs).
 *
 *    3. Сторонний сервис-посредник — только если news.json старше суток
 *       И в config.js включено liveRefresh: true. По умолчанию выключено.
 *
 *    4. Всё упало — на экране остаётся то, что уже нарисовано. Сайт
 *       не ломается никогда.
 *
 * ============================================================================
 */

(function () {
    'use strict';

    var DEFAULT_CONFIG = {
        youtubeChannelId: '',
        youtubeChannelUrl: 'https://youtube.com/@lumistekrussia',
        maxVideos: 8,
        shortsOnly: true,
        fallbackShorts: [],
        scrollStepPx: 320,
        refreshTimeoutMs: 6000,
        liveRefresh: false,
        newsJsonUrl: 'news.json'
    };

    var CFG = Object.assign({}, DEFAULT_CONFIG, window.LUMISTEK_CONFIG || {});
    var MAX = Math.max(1, Math.min(15, parseInt(CFG.maxVideos, 10) || 8));
    var STALE_AFTER_MS = 24 * 60 * 60 * 1000;

    /* ========================================================================
     * УТИЛИТЫ
     * ====================================================================== */

    var MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                     'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

    /** '2026-08-12' или '2026-08-12T18:04:55+00:00' → '12 августа 2026'. */
    function formatDate(value) {
        if (!value) return '';
        var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
        if (!match) return String(value);
        var month = parseInt(match[2], 10);
        if (!month || month < 1 || month > 12) return String(value);
        return parseInt(match[3], 10) + ' ' + MONTHS_RU[month - 1] + ' ' + match[1];
    }

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Приводит любой источник к единому виду { id, title, date }.
     * Понимает и news.json (published + url), и config.js (date).
     * При shortsOnly = true отбрасывает горизонтальные видео там,
     * где ссылка известна.
     */
    function normaliseVideos(list, onlyShorts) {
        if (!Array.isArray(list)) return [];

        return list.filter(function (item) {
            if (!item || typeof item.id !== 'string') return false;
            if (!/^[A-Za-z0-9_-]{11}$/.test(item.id.trim())) return false;
            if (onlyShorts && typeof item.url === 'string' && item.url) {
                if (item.url.indexOf('/shorts/') === -1) return false;
            }
            return true;
        }).slice(0, MAX).map(function (item) {
            return {
                id: item.id.trim(),
                title: item.title || 'Видео Lumistek',
                date: item.published || item.date || ''
            };
        });
    }

    /** Список видео не изменился — перерисовывать не нужно. */
    function sameVideos(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) {
            if (a[i].id !== b[i].id) return false;
        }
        return true;
    }

    /* ========================================================================
     * УРОВЕНЬ 2 — news.json С СВОЕГО ДОМЕНА
     * ====================================================================== */

    function loadNewsJson() {
        var url = CFG.newsJsonUrl || 'news.json';
        var timeout = Math.max(1000, parseInt(CFG.refreshTimeoutMs, 10) || 6000);
        var controller = ('AbortController' in window) ? new AbortController() : null;
        var timer = null;
        var opts = { cache: 'no-cache' };

        if (controller) {
            opts.signal = controller.signal;
            timer = setTimeout(function () { controller.abort(); }, timeout);
        }

        return fetch(url, opts).then(function (response) {
            if (timer) clearTimeout(timer);
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        }, function (error) {
            if (timer) clearTimeout(timer);
            throw error;
        }).then(function (data) {
            if (!data || !Array.isArray(data.videos) || !data.videos.length) {
                throw new Error('news.json пустой');
            }
            return data;
        });
    }

    /** news.json старше суток? Если даты нет — считаем свежим. */
    function isStale(data) {
        var stamp = Date.parse(data && data.updated);
        if (!stamp) return false;
        return (Date.now() - stamp) > STALE_AFTER_MS;
    }

    /* ========================================================================
     * УРОВЕНЬ 3 — СВЕЖИЕ ДАННЫЕ ОТ YOUTUBE (запасной путь)
     * ------------------------------------------------------------------------
     * YouTube не отдаёт ленту напрямую в браузер (запрет CORS), поэтому
     * запрос идёт через сторонний сервис-посредник. Включается только
     * при liveRefresh: true.
     * ====================================================================== */

    var LIVE_PROVIDERS = [
        {
            build: function (u) { return 'https://r.jina.ai/' + u; },
            // Без этого заголовка сервис отдаёт Markdown вместо XML.
            headers: { 'x-respond-with': 'html' },
            format: 'xml'
        },
        {
            build: function (u) { return 'https://api.allorigins.win/get?url=' + encodeURIComponent(u); },
            headers: {},
            format: 'json',
            jsonField: 'contents'
        },
        {
            build: function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); },
            headers: {},
            format: 'xml'
        }
    ];

    /** Разбирает XML ленты YouTube. Выполняется в браузере. */
    function parseFeedXml(xmlText) {
        var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('XML не разобран');

        var entries = doc.getElementsByTagName('entry');
        var out = [];

        for (var i = 0; i < entries.length && out.length < MAX; i++) {
            var entry = entries[i];
            var idEl = entry.getElementsByTagNameNS('http://www.youtube.com/xml/schemas/2015', 'videoId')[0]
                || entry.getElementsByTagName('yt:videoId')[0];
            if (!idEl) continue;

            var id = (idEl.textContent || '').trim();
            if (!/^[A-Za-z0-9_-]{11}$/.test(id)) continue;

            var titleEl = entry.getElementsByTagName('title')[0];
            var pubEl = entry.getElementsByTagName('published')[0];

            // Ссылка нужна, чтобы отличить Shorts от обычного видео.
            var url = '';
            var links = entry.getElementsByTagName('link');
            for (var j = 0; j < links.length; j++) {
                var href = links[j].getAttribute('href') || '';
                if (href.indexOf('/shorts/') !== -1 || href.indexOf('/watch') !== -1) {
                    url = href;
                    break;
                }
            }
            if (!url) url = 'https://www.youtube.com/watch?v=' + id;

            out.push({
                id: id,
                title: titleEl ? (titleEl.textContent || '').trim() : 'Видео Lumistek',
                published: pubEl ? (pubEl.textContent || '').trim() : '',
                url: url
            });
        }

        if (!out.length) throw new Error('в ленте нет видео');
        return out;
    }

    function fetchLive(channelId) {
        var feedUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId;
        var timeout = Math.max(2000, parseInt(CFG.refreshTimeoutMs, 10) || 6000);

        function tryProvider(provider) {
            var controller = ('AbortController' in window) ? new AbortController() : null;
            var timer = null;
            var opts = { headers: provider.headers || {} };

            if (controller) {
                opts.signal = controller.signal;
                timer = setTimeout(function () { controller.abort(); }, timeout);
            }

            return fetch(provider.build(feedUrl), opts).then(function (response) {
                if (timer) clearTimeout(timer);
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.text();
            }, function (error) {
                if (timer) clearTimeout(timer);
                throw error;
            }).then(function (body) {
                if (provider.format === 'json') {
                    var parsed;
                    try {
                        parsed = JSON.parse(body);
                    } catch (e) {
                        throw new Error('ответ не JSON');
                    }
                    body = parsed && parsed[provider.jsonField];
                    if (typeof body !== 'string') throw new Error('нет нужного поля');
                }
                if (body.indexOf('<entry') === -1) throw new Error('не похоже на ленту');
                return parseFeedXml(body);
            });
        }

        // Пробуем сервисы по очереди, пока какой-нибудь не ответит.
        return LIVE_PROVIDERS.reduce(function (chain, provider) {
            return chain.catch(function () { return tryProvider(provider); });
        }, Promise.reject(new Error('нет доступных сервисов')));
    }

    /* ========================================================================
     * ОТРИСОВКА КАРТОЧЕК
     * ====================================================================== */

    function thumbUrl(id) {
        // oardefault — вертикальное превью 1080x1920, которое YouTube отдаёт
        // для Shorts. Горизонтальные maxresdefault/hqdefault в вертикальной
        // рамке 9:16 дают лишь узкую полосу кадра, поэтому они только в резерве.
        return 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/oardefault.jpg';
    }

    // Порядок отката, если вертикального превью у видео нет.
    var THUMB_FALLBACKS = ['oardefault', 'oar2', 'maxresdefault', 'hqdefault'];

    // События error и load у <img> не всплывают — слушаем на фазе перехвата.
    function bindThumbHandlers(track) {
        if (!track || track.dataset.thumbHandlersBound) return;
        track.dataset.thumbHandlersBound = '1';

        track.addEventListener('error', function (e) {
            var img = e.target;
            if (!img || img.tagName !== 'IMG' || !img.dataset.vid) return;
            var next = parseInt(img.dataset.fb, 10) + 1;
            if (next >= THUMB_FALLBACKS.length) return;
            img.dataset.fb = String(next);
            img.src = 'https://i.ytimg.com/vi/' + img.dataset.vid + '/' + THUMB_FALLBACKS[next] + '.jpg';
        }, true);

        // Горизонтальное видео (не Shorts) вписываем целиком, а не обрезаем.
        track.addEventListener('load', function (e) {
            var img = e.target;
            if (!img || img.tagName !== 'IMG' || !img.dataset.vid) return;

            var w = img.naturalWidth;
            var h = img.naturalHeight;

            // Если YouTube не отдал превью нужного размера, он возвращает
            // серую заглушку 120x90 (с HTTP-кодом 200, поэтому событие error
            // не срабатывает). Такую картинку считаем неудачной и идём дальше
            // по списку резервных вариантов.
            if (w <= 120 || h <= 90) {
                var next = parseInt(img.dataset.fb, 10) + 1;
                if (next < THUMB_FALLBACKS.length) {
                    img.dataset.fb = String(next);
                    img.src = 'https://i.ytimg.com/vi/' + img.dataset.vid + '/' + THUMB_FALLBACKS[next] + '.jpg';
                }
                return;
            }

            // Настоящая картинка горизонтальная — вписываем её целиком,
            // чтобы кадр был виден, а не обрезан в узкую полосу.
            img.classList.remove('object-cover');
            img.classList.add(w > h ? 'object-contain' : 'object-cover');
        }, true);
    }

    function cardHtml(video) {
        var id = escapeHtml(video.id);
        var title = escapeHtml(video.title);
        var dateText = escapeHtml(formatDate(video.date));

        return '<button type="button" class="news-card group relative flex-none w-[70vw] sm:w-[45vw] md:w-[240px] lg:w-[260px] ' +
                'aspect-[9/16] rounded-2xl overflow-hidden border border-white/10 bg-brand-darker ' +
                'snap-center text-left shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan ' +
                'focus-visible:ring-offset-2 focus-visible:ring-offset-brand-dark transition-all duration-300 ' +
                'hover:border-brand-cyan/50 hover:-translate-y-1" ' +
                'data-video-id="' + id + '" data-video-title="' + title + '" ' +
                'aria-label="Смотреть видео: ' + title + '">' +

                '<img src="' + thumbUrl(video.id) + '" alt="Превью видео: ' + title + '" decoding="async" ' +
                    'data-vid="' + id + '" data-fb="0" ' +
                    'class="absolute inset-0 w-full h-full object-cover z-0 transition-transform duration-500 group-hover:scale-105">' +

                '<div class="absolute inset-0 z-10 bg-gradient-to-t from-black via-black/40 to-transparent"></div>' +

                '<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none">' +
                    '<span class="w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm border border-white/30 ' +
                        'flex items-center justify-center text-white transition-all duration-300 ' +
                        'group-hover:bg-brand-cyan group-hover:border-brand-cyan group-hover:scale-110">' +
                        '<svg class="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
                            '<path d="M8 5v14l11-7z"></path>' +
                        '</svg>' +
                    '</span>' +
                '</div>' +

                '<div class="absolute bottom-0 left-0 right-0 z-20 p-3 md:p-4">' +
                    '<h3 class="text-white text-sm md:text-base font-semibold leading-snug line-clamp-2">' + title + '</h3>' +
                    (dateText ? '<p class="text-gray-300 text-xs mt-1.5">' + dateText + '</p>' : '') +
                '</div>' +
            '</button>';
    }

    function renderCards(videos) {
        var track = document.getElementById('news-track');
        if (!track || !videos || !videos.length) return false;

        track.innerHTML = videos.map(cardHtml).join('');
        bindThumbHandlers(track);
        track.scrollLeft = 0;
        updateArrowState();
        return true;
    }

    function hideSection() {
        var section = document.getElementById('news');
        if (section) section.classList.add('hidden');
    }

    /* ========================================================================
     * КАРУСЕЛЬ
     * ====================================================================== */

    function updateArrowState() {
        var track = document.getElementById('news-track');
        var prev = document.getElementById('news-prev');
        var next = document.getElementById('news-next');
        if (!track) return;

        var maxScroll = track.scrollWidth - track.clientWidth;
        var nothingToScroll = maxScroll <= 4;

        if (prev) {
            prev.disabled = nothingToScroll || track.scrollLeft <= 4;
            prev.classList.toggle('opacity-30', prev.disabled);
            prev.classList.toggle('cursor-not-allowed', prev.disabled);
        }
        if (next) {
            next.disabled = nothingToScroll || track.scrollLeft >= maxScroll - 4;
            next.classList.toggle('opacity-30', next.disabled);
            next.classList.toggle('cursor-not-allowed', next.disabled);
        }
    }

    function initCarousel() {
        var track = document.getElementById('news-track');
        if (!track) return;

        var step = Math.max(120, parseInt(CFG.scrollStepPx, 10) || 320);
        var prev = document.getElementById('news-prev');
        var next = document.getElementById('news-next');

        if (prev) {
            prev.addEventListener('click', function () {
                track.scrollBy({ left: -step, behavior: 'smooth' });
            });
        }
        if (next) {
            next.addEventListener('click', function () {
                track.scrollBy({ left: step, behavior: 'smooth' });
            });
        }

        track.addEventListener('scroll', updateArrowState, { passive: true });
        window.addEventListener('resize', updateArrowState);

        track.addEventListener('click', function (e) {
            var card = e.target.closest ? e.target.closest('.news-card') : null;
            if (!card) return;
            openVideoModal(card.getAttribute('data-video-id'), card.getAttribute('data-video-title'));
        });

        // Колесо мыши листает карусель по горизонтали, но не мешает обычной
        // прокрутке страницы, когда карусель уже у края.
        track.addEventListener('wheel', function (e) {
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            var maxScroll = track.scrollWidth - track.clientWidth;
            if (maxScroll <= 0) return;

            var goingRight = e.deltaY > 0;
            if ((goingRight && track.scrollLeft >= maxScroll - 1) ||
                (!goingRight && track.scrollLeft <= 1)) return;

            e.preventDefault();
            track.scrollLeft += e.deltaY;
        }, { passive: false });
    }

    /* ========================================================================
     * МОДАЛЬНОЕ ОКНО С ВИДЕО
     * ====================================================================== */

    var lastFocused = null;

    function openVideoModal(videoId, videoTitle) {
        if (!videoId) return;

        var modal = document.getElementById('video-modal');
        var shell = document.getElementById('video-modal-shell');
        var frame = document.getElementById('video-modal-iframe');
        var heading = document.getElementById('video-modal-title');
        if (!modal || !frame) return;

        lastFocused = document.activeElement;

        // nocookie — домен без рекламных cookie; rel=0 — без чужих видео в конце.
        frame.setAttribute('src',
            'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId) +
            '?autoplay=1&rel=0&playsinline=1');

        if (heading) heading.textContent = videoTitle || 'Видео Lumistek';

        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');

        setTimeout(function () {
            modal.classList.remove('opacity-0');
            if (shell) {
                shell.classList.remove('scale-95');
                shell.classList.add('scale-100');
            }
        }, 10);

        var closeBtn = document.getElementById('video-modal-close');
        if (closeBtn) closeBtn.focus();
    }

    function closeVideoModal() {
        var modal = document.getElementById('video-modal');
        var shell = document.getElementById('video-modal-shell');
        var frame = document.getElementById('video-modal-iframe');
        if (!modal) return;

        modal.classList.add('opacity-0');
        if (shell) {
            shell.classList.remove('scale-100');
            shell.classList.add('scale-95');
        }

        setTimeout(function () {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
            // Без этого видео продолжает играть в фоне.
            if (frame) frame.setAttribute('src', '');
        }, 300);

        if (lastFocused && typeof lastFocused.focus === 'function') {
            lastFocused.focus();
            lastFocused = null;
        }
    }

    function initVideoModalHandlers() {
        var modal = document.getElementById('video-modal');
        if (!modal) return;

        // Кнопки в разметке вызывают closeVideoModal() напрямую,
        // поэтому функция должна быть доступна глобально.
        window.closeVideoModal = closeVideoModal;

        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeVideoModal();
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
                closeVideoModal();
            }
        });
    }


    /* ========================================================================
     * МОДАЛЬНОЕ ОКНО С ВИДЕО
     * ====================================================================== */

    var lastFocused = null;

    function openVideoModal(videoId, videoTitle) {
        if (!videoId) return;

        var modal = document.getElementById('video-modal');
        var shell = document.getElementById('video-modal-shell');
        var frame = document.getElementById('video-modal-iframe');
        var heading = document.getElementById('video-modal-title');
        if (!modal || !frame) return;

        lastFocused = document.activeElement;

        // nocookie — домен без рекламных cookie; rel=0 — без чужих видео в конце.
        frame.setAttribute('src',
            'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId) +
            '?autoplay=1&rel=0&playsinline=1');

        if (heading) heading.textContent = videoTitle || 'Видео Lumistek';

        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');

        // Небольшая задержка, чтобы сработал переход прозрачности.
        setTimeout(function () {
            modal.classList.remove('opacity-0');
            if (shell) {
                shell.classList.remove('scale-95');
                shell.classList.add('scale-100');
            }
        }, 10);

        var closeBtn = document.getElementById('video-modal-close');
        if (closeBtn) closeBtn.focus();
    }

    function closeVideoModal() {
        var modal = document.getElementById('video-modal');
        var shell = document.getElementById('video-modal-shell');
        var frame = document.getElementById('video-modal-iframe');
        if (!modal) return;

        modal.classList.add('opacity-0');
        if (shell) {
            shell.classList.remove('scale-100');
            shell.classList.add('scale-95');
        }

        setTimeout(function () {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
            // Без этого видео продолжает играть в фоне.
            if (frame) frame.setAttribute('src', '');
        }, 300);

        if (lastFocused && typeof lastFocused.focus === 'function') {
            lastFocused.focus();
            lastFocused = null;
        }
    }

    function initVideoModalHandlers() {
        var modal = document.getElementById('video-modal');
        if (!modal) return;

        // Кнопки закрытия в разметке вызывают closeVideoModal() напрямую,
        // поэтому функция должна быть доступна глобально.
        window.closeVideoModal = closeVideoModal;

        // Клик по тёмному фону закрывает окно.
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeVideoModal();
        });

        // Escape закрывает окно — и только его.
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
                closeVideoModal();
            }
        });
    }

    /* ========================================================================
     * ЗАПУСК: четыре уровня загрузки
     * ====================================================================== */

    function init() {
        var track = document.getElementById('news-track');
        if (!track) return; // блока на странице нет — молча выходим

        try {
            initCarousel();
            initVideoModalHandlers();
        } catch (error) {
            // Даже если что-то не привязалось, данные попробуем показать.
        }

        var onlyShorts = CFG.shortsOnly !== false;

        // --- Уровень 1: резервный список из config.js — рисуем сразу --------
        var fallback = normaliseVideos(CFG.fallbackShorts, onlyShorts);

        if (fallback.length) {
            try { renderCards(fallback); } catch (error) {}
        }

        var shown = fallback;

        // --- Уровень 2: news.json ------------------------------------------
        loadNewsJson().then(function (data) {
            var fromJson = normaliseVideos(data.videos, onlyShorts);

            if (!fromJson.length) {
                // Подходящих видео нет (например, включён shortsOnly,
                // а все записи горизонтальные) — оставляем что нарисовано.
                if (!shown.length) hideSection();
                return;
            }

            // Не перерисовываем, если список тот же — иначе картинки
            // мигали бы без всякой причины.
            if (!sameVideos(shown, fromJson)) {
                renderCards(fromJson);
                shown = fromJson;
            }

            // --- Уровень 3: свежие данные, только если файл устарел ---------
            if (!CFG.liveRefresh) return;
            if (!isStale(data)) return;

            var channelId = (CFG.youtubeChannelId || '').trim();
            if (!channelId) return;

            fetchLive(channelId).then(function (videos) {
                var fresh = normaliseVideos(videos, onlyShorts);
                if (fresh.length && !sameVideos(shown, fresh)) {
                    renderCards(fresh);
                }
            }).catch(function () {
                // Не удалось — остаётся то, что уже показано. Это норма.
            });
        }).catch(function () {
            // --- Уровень 4: news.json недоступен ---------------------------
            // На экране уже резервный список. Если его тоже нет — прячем
            // блок, чтобы не оставалась пустая полоса.
            if (!shown.length) hideSection();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
