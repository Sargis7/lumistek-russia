#!/usr/bin/env node
/**
 * ============================================================================
 *  LUMISTEK — СБОР НОВОСТЕЙ С YOUTUBE
 * ============================================================================
 *
 *  Этот скрипт запускается НЕ на сайте, а на сервере GitHub Actions
 *  (см. .github/workflows/update-news.yml) раз в сутки.
 *
 *  Что делает:
 *    1. Забирает RSS-ленту канала YouTube.
 *    2. Разбирает её и достаёт список видео.
 *    3. Записывает результат в файл news.json в корне репозитория.
 *
 *  Сайт потом просто читает news.json со своего же домена — без прокси,
 *  без CORS, мгновенно.
 *
 *  Запуск вручную (если на компьютере установлен Node.js 20+):
 *      node scripts/fetch-news.mjs
 *
 *  Сторонних библиотек не требует.
 * ============================================================================
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ========================================================================
 * НАСТРОЙКИ
 * ====================================================================== */

// ID канала YouTube (LUMISTEK RUSSIA).
// Это постоянный адрес канала, менять не нужно.
const CHANNEL_ID = 'UCyhr8rFgCRcHOntrHR3tU0w';

// Сколько последних видео записывать в news.json.
// YouTube отдаёт максимум 15. Сайт всё равно покажет не больше, чем
// указано в maxVideos в assets/js/config.js.
const MAX_VIDEOS = 15;

// Показывать только вертикальные Shorts.
// false — писать в news.json все видео (решение принимает сайт через
//         настройку shortsOnly в config.js).
// true  — писать только Shorts (те, что открываются по адресу /shorts/).
// Обычно оставляйте false: пусть сайт сам решает по настройке клиента.
const SHORTS_ONLY = false;

// Таймаут запроса к YouTube, миллисекунды.
const TIMEOUT_MS = 20000;

/* ========================================================================
 * ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
 * ====================================================================== */

/** Убирает HTML-теги и раскрывает самые частые HTML-сущности. */
function cleanText(input) {
    if (!input) return '';

    let text = String(input);

    // Снимаем CDATA, если она есть.
    text = text.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1');

    // Раскрываем сущности. Порядок важен: &amp; последним, у него составная буква.
    text = text
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');

    // Убираем любые оставшиеся теги — на случай разметки в заголовке.
    text = text.replace(/<[^>]*>/g, '');

    // Схлопываем переносы строк и лишние пробелы.
    return text.replace(/\s+/g, ' ').trim();
}

/** Достаёт значение первого вхождения тега, например <title>Вот это</title>. */
function pickTag(entry, tag) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`);
    const match = re.exec(entry);
    return match ? match[1] : '';
}

/** Проверяет, что строка похожа на ссылку: адрес видео содержит /shorts/. */
function isShortsUrl(url) {
    return typeof url === 'string' && /\/shorts\//.test(url);
}

/* ========================================================================
 * РАЗБОР ЛЕНТЫ
 * ====================================================================== */

/**
 * Разбирает XML ленты YouTube в массив объектов видео.
 * Используем регулярные выражения, потому что в Node нет DOMParser
 * и не хочется тащить библиотеки.
 */
function parseFeed(xml) {
    if (typeof xml !== 'string' || !xml.trim()) {
        throw new Error('получен пустой ответ от YouTube');
    }

    const blocks = xml.match(/<entry\b[\s\S]*?<\/entry>/g);
    if (!blocks || !blocks.length) {
        // Это не обязательно ошибка: канал может быть пустым.
        return [];
    }

    const videos = [];

    for (const entry of blocks) {
        // Идентификатор видео. Берём из yt:videoId, при его отсутствии —
        // из тега <id> вида "yt:video:XXXXXXXXXXX".
        let id = cleanText(pickTag(entry, 'yt:videoId'));

        if (!id) {
            const idMatch = /<id>\s*yt:video:([A-Za-z0-9_-]{11})\s*<\/id>/.exec(entry);
            if (idMatch) id = idMatch[1];
        }

        // Пропускаем записи без корректного ID (11 символов).
        if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
            process.stderr.write(`  предупреждение: пропущена запись без yt:videoId\n`);
            continue;
        }

        const title = cleanText(pickTag(entry, 'title')) || 'Видео Lumistek';
        const published = cleanText(pickTag(entry, 'published'));

        // Ссылка на видео. В ленте она лежит в <link rel="alternate" href="...">.
        let url = '';
        const hrefMatch = /<link\b[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(entry);
        if (hrefMatch) {
            url = hrefMatch[1];
        } else {
            const anyHref = /<link\b[^>]*href="(https:\/\/www\.youtube\.com\/(?:shorts|watch)[^"]*)"/.exec(entry);
            if (anyHref) url = anyHref[1];
        }

        // Если ссылки нет совсем — собираем стандартную.
        if (!url) url = `https://www.youtube.com/watch?v=${id}`;

        videos.push({
            id,
            title,
            published,
            url: cleanText(url),
            isShorts: isShortsUrl(url)
        });
    }

    // Сортировка: от новых к старым.
    videos.sort((a, b) => {
        const ta = Date.parse(a.published) || 0;
        const tb = Date.parse(b.published) || 0;
        return tb - ta;
    });

    return videos;
}

/* ========================================================================
 * ОСНОВНАЯ ЧАСТЬ
 * ====================================================================== */

async function main() {
    const here = dirname(fileURLToPath(import.meta.url));
    // news.json всегда кладём в корень репозитория — рядом с index.html.
    const outPath = join(here, '..', 'news.json');

    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
    process.stdout.write(`Загружаю ленту: ${feedUrl}\n`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let xml;
    try {
        const response = await fetch(feedUrl, {
            signal: controller.signal,
            headers: {
                // Представляемся браузером, иначе YouTube может отдать заглушку.
                'User-Agent': 'Mozilla/5.0 (compatible; LumistekNewsBot/1.0)',
                'Accept': 'application/atom+xml, application/xml, text/xml'
            }
        });

        if (!response.ok) {
            throw new Error(`YouTube ответил HTTP ${response.status}`);
        }

        xml = await response.text();
    } finally {
        clearTimeout(timer);
    }

    let videos = parseFeed(xml);
    process.stdout.write(`Найдено видео в ленте: ${videos.length}\n`);

    if (SHORTS_ONLY) {
        videos = videos.filter((video) => video.isShorts);
        process.stdout.write(`Из них Shorts: ${videos.length}\n`);
    }

    videos = videos.slice(0, MAX_VIDEOS);

    // Если лента пустая — НЕ перезаписываем news.json,
    // иначе на сайте пропадут все видео. Оставляем прежний файл.
    if (!videos.length) {
        process.stderr.write('Лента пустая — news.json оставлен без изменений.\n');
        process.exitCode = 0;
        return;
    }

    // Для сайта поле isShorts не нужно — оно было только для фильтра здесь.
    const payload = {
        updated: new Date().toISOString(),
        channel: CHANNEL_ID,
        videos: videos.map(({ isShorts, ...rest }) => rest) // eslint-disable-line no-unused-vars
    };

    const json = JSON.stringify(payload, null, 2) + '\n';
    await writeFile(outPath, json, 'utf8');

    process.stdout.write(`Записано ${payload.videos.length} видео в news.json\n`);
}

main().catch((error) => {
    process.stderr.write(`Ошибка: ${error.message}\n`);
    // Ненулевой код нужен, чтобы GitHub Actions показал падение шага.
    process.exitCode = 1;
});
