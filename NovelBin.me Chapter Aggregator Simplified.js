// ==UserScript==
// @name         NovelBin.me Chapter Aggregator Simplified
// @namespace    http://tampermonkey.net/
// @version      2.5.0
// @description  Simplified novel chapter aggregator with modern HTML output
// @author       Assistant
// @match        https://novelbin.me/*
// @match        https://novelbin.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    // ================== PERFORMANCE OPTIMIZATIONS ==================
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function sanitizeFileName(name) {
        return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').trim();
    }

    function createElementFromHTML(html) {
        const div = document.createElement('div');
        div.innerHTML = html.trim();
        return div.firstChild;
    }

    function generateHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    const ICONS = Object.freeze({
        aggregator: String.fromCodePoint(0x1F4DA),
        header: String.fromCodePoint(0x1F4DA),
        settings: String.fromCodePoint(0x2699, 0xFE0F),
        refresh: String.fromCodePoint(0x1F504),
        minimize: String.fromCodePoint(0x2212),
        chapter: String.fromCodePoint(0x1F4D6),
        range: String.fromCodePoint(0x1F4CD),
        select: String.fromCodePoint(0x1F4CB),
        selectAll: String.fromCodePoint(0x1F4DA),
        download: String.fromCodePoint(0x1F4E5),
        cancel: String.fromCodePoint(0x274C),
        export: String.fromCodePoint(0x1F4C4),
        batch: String.fromCodePoint(0x1F4E6),
        delay: String.fromCodePoint(0x23F1),
        retries: String.fromCodePoint(0x1F504),
        logging: String.fromCodePoint(0x1F4DD),
        compact: String.fromCodePoint(0x1F4F1),
        save: String.fromCodePoint(0x1F4BE),
        stats: String.fromCodePoint(0x1F4CA),
        rocket: String.fromCodePoint(0x1F680),
        target: String.fromCodePoint(0x1F3AF),
        info: String.fromCodePoint(0x2139, 0xFE0F),
        success: String.fromCodePoint(0x2705),
        bullet: String.fromCodePoint(0x2022),
        navPrev: String.fromCodePoint(0x2039),
        navNext: String.fromCodePoint(0x203A)
    });

    const NOTIFICATION_ICONS = Object.freeze({
        success: ICONS.success,
        info: ICONS.info,
        error: ICONS.cancel
    });

    // ================== SETTINGS MANAGEMENT ==================
    class SettingsManager {
        constructor() {
            this.defaultSettings = {
                batchSize: 5,
                baseDelay: 2000,
                maxRetries: 3,
                enableLogging: true,
                compactMode: false
            };
            this.settings = this.loadSettings();
        }

        loadSettings() {
            try {
                const saved = GM_getValue('novelbin_settings', '{}');
                const parsed = JSON.parse(saved);
                return { ...this.defaultSettings, ...parsed };
            } catch (error) {
                console.warn('Failed to load settings, using defaults:', error);
                return { ...this.defaultSettings };
            }
        }

        saveSettings() {
            try {
                GM_setValue('novelbin_settings', JSON.stringify(this.settings));
                console.log('Settings saved successfully');
            } catch (error) {
                console.error('Failed to save settings', error);
            }
        }

        get(key) {
            return this.settings[key];
        }

        set(key, value) {
            this.settings[key] = value;
            this.saveSettings();
        }

        reset() {
            this.settings = { ...this.defaultSettings };
            this.saveSettings();
        }
    }

    const settingsManager = new SettingsManager();

    // ================== LOGGING SYSTEM ==================
    class Logger {
        constructor() {
            this.logs = [];
            this.maxLogs = 1000;
            this.enabled = settingsManager.get('enableLogging');
        }

        log(level, message, data = null) {
            if (!this.enabled) return;

            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                level,
                message,
                data: data ? JSON.stringify(data, null, 2) : null
            };

            this.logs.push(logEntry);
            if (this.logs.length > this.maxLogs) {
                this.logs = this.logs.slice(-this.maxLogs);
            }

            const consoleMsg = `[${timestamp}] [${level}] ${message}`;
            if (data) {
                console[level.toLowerCase()](consoleMsg, data);
            } else {
                console[level.toLowerCase()](consoleMsg);
            }
        }

        info(message, data) { this.log('INFO', message, data); }
        warn(message, data) { this.log('WARN', message, data); }
        error(message, data) { this.log('ERROR', message, data); }
        debug(message, data) { this.log('DEBUG', message, data); }        setEnabled(enabled) {

            this.enabled = enabled;

        }



        hasLogs() {

            return this.logs.length > 0;

        }



        getLogs() {

            if (!this.hasLogs()) {

                return "No logs recorded yet.";

            }



            const newline = '\n';



            return this.logs.map(log =>

                `[${log.timestamp}] [${log.level}] ${log.message}${log.data ? `${newline}${log.data}` : ''}`

            ).join(newline);

        }



        exportLogs() {
            const blob = new Blob([this.getLogs()], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `novelbin-aggregator-logs-${new Date().toISOString().slice(0, 19)}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        }
    }

    const logger = new Logger();

    // ================== CHAPTER EXTRACTOR ==================
    class ChapterExtractor {
        constructor() {
            this.baseDelay = settingsManager.get('baseDelay');
            this.maxRetries = settingsManager.get('maxRetries');
            this.batchSize = settingsManager.get('batchSize');
            this.isCancelled = false;
            this.activeRequests = new Set();
            this.detectedCloudflareBlock = false;
        }

        updateSettings() {
            this.baseDelay = settingsManager.get('baseDelay');
            this.maxRetries = settingsManager.get('maxRetries');
            this.batchSize = settingsManager.get('batchSize');
        }

        cancel() {
            logger.info('Download cancellation requested');
            this.isCancelled = true;

            this.activeRequests.forEach(request => {
                if (request && request.abort) {
                    request.abort();
                }
            });
            this.activeRequests.clear();
        }

        reset() {
            this.isCancelled = false;
            this.activeRequests.clear();
            this.updateSettings();
            this.detectedCloudflareBlock = false;
        }

        async fetchWithRetry(url, retries = 0) {
            if (this.isCancelled) {
                throw new Error('Download cancelled by user');
            }

            try {
                logger.info(`Fetching chapter: ${url} (attempt ${retries + 1})`);
                const responseText = await this.performRequest(url);
                return responseText;
            } catch (error) {
                if (error.code === 'CLOUDFLARE') {
                    this.detectedCloudflareBlock = true;
                    logger.warn(`Cloudflare challenged ${url}`, { attempt: retries + 1 });
                    throw error;
                }

                logger.error(`Failed to fetch ${url}`, { error: error.message, attempt: retries + 1 });

                if (this.isCancelled) {
                    throw error;
                }

                if (retries < this.maxRetries) {
                    const delay = this.baseDelay * Math.pow(1.5, retries);
                    logger.info(`Retrying in ${delay}ms...`);
                    await sleep(delay);
                    return this.fetchWithRetry(url, retries + 1);
                }

                throw error;
            }
        }

        async performRequest(url) {
            try {
                return await this.fetchViaWindow(url);
            } catch (error) {
                if (error.code === 'CLOUDFLARE') {
                    throw error;
                }
                logger.warn('Window fetch failed, falling back to GM_xmlhttpRequest', { url, error: error.message });
                return await this.fetchViaGM(url);
            }
        }

        async fetchViaWindow(url) {
            const controller = new AbortController();
            this.activeRequests.add(controller);

            try {
                const response = await fetch(url, { credentials: 'include', signal: controller.signal });
                const text = await response.text();

                if (!response.ok) {
                    if (this.isCloudflareResponse(text, response.status)) {
                        const cfError = new Error('Cloudflare challenge detected. Open the chapter in your browser to clear the check, then retry.');
                        cfError.code = 'CLOUDFLARE';
                        throw cfError;
                    }
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                if (this.isCloudflareResponse(text, response.status)) {
                    const cfError = new Error('Cloudflare challenge detected. Open the chapter in your browser to clear the check, then retry.');
                    cfError.code = 'CLOUDFLARE';
                    throw cfError;
                }

                return text;
            } finally {
                this.activeRequests.delete(controller);
            }
        }

        fetchViaGM(url) {
            return new Promise((resolve, reject) => {
                const request = GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    timeout: 30000,
                    responseType: 'text',
                    withCredentials: true,
                    onload: (response) => {
                        this.activeRequests.delete(request);
                        if (this.isCancelled) {
                            reject(new Error('Download cancelled by user'));
                            return;
                        }

                        const text = response.responseText || '';

                        if (response.status === 200) {
                            if (this.isCloudflareResponse(text, response.status)) {
                                const cfError = new Error('Cloudflare challenge detected. Open the chapter in your browser to clear the check, then retry.');
                                cfError.code = 'CLOUDFLARE';
                                reject(cfError);
                                return;
                            }
                            resolve(text);
                        } else {
                            reject(new Error(`HTTP ${response.status}: ${response.statusText}`));
                        }
                    },
                    onerror: (error) => {
                        this.activeRequests.delete(request);
                        reject(new Error(`Network error: ${error}`));
                    },
                    ontimeout: () => {
                        this.activeRequests.delete(request);
                        reject(new Error('Request timeout'));
                    }
                });

                this.activeRequests.add(request);
            });
        }

        isCloudflareResponse(text, status) {
            const body = (text || '').toLowerCase();
            if (status === 403 || status === 503) {
                return true;
            }
            return body.includes('cf-browser-verification') ||
                body.includes('cf_chl') ||
                (body.includes('cloudflare') && (body.includes('just a moment') || body.includes('attention required') || body.includes('one more step')));
        }

        extractChapterContent(html, chapterUrl) {
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                const novelTitleSelectors = [
                    '#chapter > div > div > a.novel-title',
                    '.novel-title',
                    'a[class*="novel"]',
                    '.breadcrumb a:last-child',
                    'h1',
                    '.book-title'
                ];

                const chapterTitleSelectors = [
                    '#chapter > div > div > h2 > a > span',
                    '.chr-title span',
                    '.chapter-title',
                    'h2 span',
                    'h1',
                    '.chr-text'
                ];

                const contentSelectors = [
                    '#chr-content',
                    '.chapter-content',
                    '.content',
                    '#content',
                    '.post-content',
                    '.reading-content'
                ];

                let novelTitle = 'Unknown Novel';
                let chapterTitle = 'Unknown Chapter';
                let contentEl = null;

                for (const selector of novelTitleSelectors) {
                    const el = doc.querySelector(selector);
                    if (el && el.textContent.trim()) {
                        novelTitle = el.textContent.trim();
                        break;
                    }
                }

                for (const selector of chapterTitleSelectors) {
                    const el = doc.querySelector(selector);
                    if (el && el.textContent.trim()) {
                        chapterTitle = el.textContent.trim();
                        break;
                    }
                }

                for (const selector of contentSelectors) {
                    const el = doc.querySelector(selector);
                    if (el) {
                        contentEl = el;
                        break;
                    }
                }

                if (!contentEl) {
                    throw new Error('Chapter content not found with any selector');
                }

                const unwantedSelectors = [
                    '.unlock-buttons',
                    '.text-center',
                    '.ad',
                    '.advertisement',
                    '.banner',
                    'script',
                    'style',
                    '.social-share',
                    '.comments',
                    '.navigation',
                    '.chapter-nav'
                ];

                unwantedSelectors.forEach(selector => {
                    const elements = contentEl.querySelectorAll(selector);
                    elements.forEach(el => el.remove());
                });

                const content = this.cleanContent(contentEl.innerHTML);

                return {
                    novelTitle,
                    chapterTitle,
                    content,
                    url: chapterUrl
                };
            } catch (error) {
                logger.error(`Failed to extract content from ${chapterUrl}`, { error: error.message });
                throw error;
            }
        }

        cleanContent(html) {
            const cleanPatterns = [
                /<div[^>]*class="[^"]*ad[^"]*"[^>]*>.*?<\/div>/gis,
                /<div[^>]*class="[^"]*banner[^"]*"[^>]*>.*?<\/div>/gis,
                /<div[^>]*class="[^"]*unlock[^"]*"[^>]*>.*?<\/div>/gis,
                /<script[^>]*>.*?<\/script>/gis,
                /<style[^>]*>.*?<\/style>/gis,
                /<!--.*?-->/gs,
                /<div[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>.*?<\/div>/gis
            ];

            let cleaned = html;
            cleanPatterns.forEach(pattern => {
                cleaned = cleaned.replace(pattern, '');
            });

            return cleaned.trim();
        }

        async processChapters(chapters, onProgress) {
            this.reset();
            const results = [];
            const failed = [];

            logger.info(`Starting to process ${chapters.length} chapters in batches of ${this.batchSize}`);

            for (let i = 0; i < chapters.length; i += this.batchSize) {
                if (this.isCancelled) {
                    logger.info('Download cancelled during batch processing');
                    break;
                }

                const batch = chapters.slice(i, i + this.batchSize);
                logger.info(`Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(chapters.length / this.batchSize)}`);

                const batchPromises = batch.map(async (chapter, batchIndex) => {
                    try {
                        if (this.isCancelled) {
                            throw new Error('Download cancelled by user');
                        }

                        await sleep(this.baseDelay * batchIndex * 0.5);
                        const html = await this.fetchWithRetry(chapter.url);

                        if (this.isCancelled) {
                            throw new Error('Download cancelled by user');
                        }

                        const extracted = this.extractChapterContent(html, chapter.url);
                        return { success: true, data: extracted, original: chapter };
                    } catch (error) {
                        logger.error(`Failed to process chapter: ${chapter.title}`, {
                            url: chapter.url,
                            error: error.message
                        });
                        return { success: false, error: error.message, original: chapter };
                    }
                });

                const batchResults = await Promise.all(batchPromises);

                batchResults.forEach((result, batchIndex) => {
                    const globalIndex = i + batchIndex;
                    if (result.success) {
                        results.push(result.data);
                    } else {
                        failed.push(result);
                    }

                    const progress = {
                        current: globalIndex + 1,
                        total: chapters.length,
                        percentage: Math.round(((globalIndex + 1) / chapters.length) * 100),
                        success: result.success,
                        cancelled: this.isCancelled
                    };

                    onProgress(progress);
                });

                if (i + this.batchSize < chapters.length && !this.isCancelled) {
                    await sleep(this.baseDelay);
                }
            }

            logger.info(`Processing ${this.isCancelled ? 'cancelled' : 'complete'}`, {
                successful: results.length,
                failed: failed.length,
                total: chapters.length,
                cancelled: this.isCancelled
            });

            return { results, failed, cancelled: this.isCancelled, cloudflare: this.detectedCloudflareBlock };
        }
    }

    // ================== DRAG HANDLER ==================
        class DragHandler {

        constructor(element, handleElement) {

            this.element = element;

            this.handle = handleElement;

            this.isDragging = false;

            this.offset = { x: 0, y: 0 };



            this.onMouseDownHandler = this.onMouseDown.bind(this);

            this.onMouseMoveHandler = this.onMouseMove.bind(this);

            this.onMouseUpHandler = this.onMouseUp.bind(this);



            this.init();

        }



        init() {

            if (!this.handle) {

                return;

            }



            this.handle.style.cursor = 'move';

            this.handle.addEventListener('mousedown', this.onMouseDownHandler);

            document.addEventListener('mousemove', this.onMouseMoveHandler);

            document.addEventListener('mouseup', this.onMouseUpHandler);

        }



        onMouseDown(event) {

            event.preventDefault();

            this.isDragging = true;

            const rect = this.element.getBoundingClientRect();

            this.offset.x = event.clientX - rect.left;

            this.offset.y = event.clientY - rect.top;

            this.element.style.transition = 'none';

        }



        onMouseMove(event) {

            if (!this.isDragging) {

                return;

            }



            const x = event.clientX - this.offset.x;

            const y = event.clientY - this.offset.y;



            const maxX = window.innerWidth - this.element.offsetWidth;

            const maxY = window.innerHeight - this.element.offsetHeight;



            const boundedX = Math.max(0, Math.min(x, maxX));

            const boundedY = Math.max(0, Math.min(y, maxY));



            this.element.style.left = `${boundedX}px`;

            this.element.style.top = `${boundedY}px`;

            this.element.style.right = 'auto';

        }



        onMouseUp() {

            if (!this.isDragging) {

                return;

            }



            this.isDragging = false;

            this.element.style.transition = '';

        }



        destroy() {

            if (!this.handle) {

                return;

            }



            this.handle.removeEventListener('mousedown', this.onMouseDownHandler);

            document.removeEventListener('mousemove', this.onMouseMoveHandler);

            document.removeEventListener('mouseup', this.onMouseUpHandler);

            this.isDragging = false;

        }

    }



    // ================== UI CONTROLLER ==================
    class UIController {
        constructor() {
            this.chapters = [];
            this.extractor = new ChapterExtractor();
            this.isProcessing = false;
            this.isVisible = false;
            this.dragHandler = null;
            this.currentView = 'main';
            this.selectedRange = null; // {from: number, to: number} or null for all
            this.stylesInjected = false;
            this.handleResize = this.handleWindowResize.bind(this);
        }

        init() {
            this.injectStyles();
            if (!this.isValidPage()) {
                logger.info('Not on a valid NovelBin chapter list page');
                this.createToggleButton();
                return;
            }

            logger.info('Initializing NovelBin Chapter Aggregator Simplified v2.5');
            this.extractChapterList();
            this.createToggleButton();
            this.createUI();
        }

        isValidPage() {
            const url = window.location.href;
            const hasChapterList = document.querySelector('.list-chapter') !== null;
            const validUrl = url.includes('novelbin.me') || url.includes('novelbin.com');

            return validUrl && hasChapterList;
        }

        injectStyles() {
            if (this.stylesInjected) {
                return;
            }

            if (document.getElementById('novelbin-aggregator-styles')) {
                this.stylesInjected = true;
                return;
            }

            const style = document.createElement('style');
            style.id = 'novelbin-aggregator-styles';
            style.textContent = `
    #novelbin-toggle {
        position: fixed;
        top: 24px;
        right: 24px;
        width: 58px;
        height: 58px;
        border-radius: 50%;
        border: 1px solid rgba(233, 69, 96, 0.4);
        background: radial-gradient(circle at 30% 30%, rgba(233, 69, 96, 0.95), rgba(120, 42, 70, 0.92));
        color: #f8f9ff;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 22px 55px rgba(233, 69, 96, 0.35);
        font-size: 24px;
        transition: transform 0.2s ease, box-shadow 0.25s ease, border-color 0.25s ease;
        z-index: 10001;
    }
    #novelbin-toggle:hover,
    #novelbin-toggle:focus-visible {
        transform: translateY(-2px) scale(1.05);
        box-shadow: 0 28px 65px rgba(233, 69, 96, 0.5);
        outline: none;
    }
    #novelbin-toggle.active {
        border-color: rgba(255, 255, 255, 0.7);
        box-shadow: 0 28px 65px rgba(33, 150, 243, 0.45);
    }
    #novelbin-toggle span {
        pointer-events: none;
    }

    #novelbin-aggregator {
        position: fixed;
        top: 110px;
        right: 32px;
        width: clamp(320px, 26vw, 400px);
        max-width: 92vw;
        background: #151a2d;
        color: #f3f5ff;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        box-shadow: 0 30px 80px rgba(5, 8, 16, 0.65);
        z-index: 10000;
        font-family: 'Segoe UI', 'Nunito', 'Roboto', sans-serif;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        backdrop-filter: blur(6px);
        --nb-surface: #151a2d;
        --nb-surface-alt: #1b2233;
        --nb-surface-soft: rgba(255, 255, 255, 0.05);
        --nb-border: rgba(255, 255, 255, 0.08);
        --nb-text: #f3f5ff;
        --nb-muted: #9aa3c1;
        --nb-accent: #e94560;
        --nb-accent-strong: #ff5c7a;
        --nb-blue: #2196f3;
        --nb-blue-soft: rgba(33, 150, 243, 0.22);
        --nb-green: #2ecc71;
        --nb-yellow: #f6ad55;
        --nb-danger: #f55b6b;
        --nb-radius: 16px;
    }
    #novelbin-aggregator.nb-panel--compact {
        width: clamp(300px, 30vw, 340px);
    }
    #novelbin-aggregator * {
        box-sizing: border-box;
    }
    #novelbin-aggregator ::-webkit-scrollbar {
        width: 8px;
    }
    #novelbin-aggregator ::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 999px;
    }
    #novelbin-aggregator ::-webkit-scrollbar-track {
        background: rgba(10, 12, 20, 0.6);
    }

    #novelbin-aggregator .nb-header {
        background: linear-gradient(135deg, rgba(28, 35, 58, 0.95), rgba(16, 20, 34, 0.95));
        padding: 18px 22px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        cursor: move;
        user-select: none;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    #novelbin-aggregator.nb-panel--compact .nb-header {
        padding: 16px 18px;
    }
    #novelbin-aggregator .nb-title {
        display: flex;
        align-items: center;
        gap: 14px;
    }
    #novelbin-aggregator .nb-title-icon {
        width: 40px;
        height: 40px;
        border-radius: 12px;
        background: radial-gradient(circle at 20% 20%, rgba(233, 69, 96, 0.95), rgba(122, 54, 83, 0.85));
        display: grid;
        place-items: center;
        font-size: 20px;
        color: #ffffff;
        box-shadow: 0 12px 30px rgba(233, 69, 96, 0.35);
    }
    #novelbin-aggregator .nb-title-text {
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0.02em;
    }
    #novelbin-aggregator .nb-subtitle {
        font-size: 12px;
        color: var(--nb-muted);
    }
    #novelbin-aggregator .nb-header-actions {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    #novelbin-aggregator .nb-icon-btn {
        width: 34px;
        height: 34px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.06);
        color: #eef1ff;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
    }
    #novelbin-aggregator .nb-icon-btn:hover,
    #novelbin-aggregator .nb-icon-btn:focus-visible {
        transform: translateY(-1px);
        background: rgba(233, 69, 96, 0.2);
        border-color: rgba(233, 69, 96, 0.5);
        outline: none;
    }

    #novelbin-aggregator .nb-body {
        flex: 1;
        padding: 20px 22px;
        display: flex;
        flex-direction: column;
        gap: 18px;
        background: linear-gradient(180deg, rgba(19, 24, 39, 0.95), rgba(10, 14, 24, 0.98));
        overflow-y: auto;
    }
    #novelbin-aggregator.nb-panel--compact .nb-body {
        padding: 16px 18px;
        gap: 14px;
    }
    #novelbin-aggregator .nb-view {
        display: none;
        flex-direction: column;
        gap: 18px;
    }
    #novelbin-aggregator .nb-view.nb-view--active {
        display: flex;
    }

    #novelbin-aggregator .nb-card {
        background: var(--nb-surface-alt);
        border: 1px solid var(--nb-border);
        border-radius: 16px;
        padding: 18px;
        box-shadow: 0 20px 45px rgba(5, 8, 16, 0.55);
    }
    #novelbin-aggregator .nb-card--hero {
        text-align: center;
        background: linear-gradient(140deg, rgba(233, 69, 96, 0.18), rgba(27, 34, 51, 0.85));
        border: 1px solid rgba(233, 69, 96, 0.35);
        position: relative;
        overflow: hidden;
    }
    #novelbin-aggregator .nb-card--hero::after {
        content: '';
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at top right, rgba(33, 150, 243, 0.15), transparent 55%);
        pointer-events: none;
    }
    #novelbin-aggregator .nb-card--hero .nb-count {
        font-size: 28px;
        font-weight: 700;
        color: #ffffff;
        margin-bottom: 6px;
        text-shadow: 0 12px 30px rgba(233, 69, 96, 0.35);
    }
    #novelbin-aggregator .nb-card--hero .nb-helper {
        font-size: 13px;
        color: rgba(255, 255, 255, 0.75);
    }

    #novelbin-aggregator .nb-section-title {
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--nb-muted);
        margin-bottom: 12px;
    }

    #novelbin-aggregator .nb-range-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
        margin-bottom: 12px;
    }
    #novelbin-aggregator .nb-range-grid span {
        align-self: center;
        justify-self: center;
        color: var(--nb-muted);
        font-size: 12px;
    }

    #novelbin-aggregator .nb-input {
        width: 100%;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(10, 14, 24, 0.9);
        color: var(--nb-text);
        font-size: 14px;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    #novelbin-aggregator .nb-input:focus-visible {
        outline: none;
        border-color: rgba(33, 150, 243, 0.6);
        box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.25);
    }

    #novelbin-aggregator .nb-btn {
        border: none;
        border-radius: 12px;
        padding: 12px 14px;
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
        color: #fdfdff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        box-shadow: 0 16px 35px rgba(0, 0, 0, 0.35);
    }
    #novelbin-aggregator.nb-panel--compact .nb-btn {
        padding: 10px 12px;
        font-size: 13px;
    }
    #novelbin-aggregator .nb-btn:hover,
    #novelbin-aggregator .nb-btn:focus-visible {
        transform: translateY(-1px);
        filter: brightness(1.05);
        outline: none;
    }
    #novelbin-aggregator .nb-btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
        transform: none;
        box-shadow: none;
        filter: none;
    }
    #novelbin-aggregator .nb-btn--primary {
        background: linear-gradient(135deg, var(--nb-accent), var(--nb-accent-strong));
    }
    #novelbin-aggregator .nb-btn--secondary {
        background: linear-gradient(135deg, var(--nb-blue-soft), rgba(27, 122, 198, 0.55));
        color: #d9ecff;
    }
    #novelbin-aggregator .nb-btn--ghost {
        background: rgba(255, 255, 255, 0.05);
        color: var(--nb-muted);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: none;
    }
    #novelbin-aggregator .nb-btn--danger {
        background: linear-gradient(135deg, var(--nb-danger), #b83244);
    }

    #novelbin-aggregator .nb-actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
    }
    #novelbin-aggregator .nb-actions .nb-btn {
        flex: 1 1 auto;
    }

    #novelbin-aggregator .nb-status-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-bottom: 12px;
        color: var(--nb-muted);
        font-size: 13px;
    }
    #novelbin-aggregator .nb-status-chip {
        padding: 6px 14px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(33, 150, 243, 0.3), rgba(33, 150, 243, 0.18));
        border: 1px solid rgba(33, 150, 243, 0.4);
        color: #d8ebff;
        font-weight: 600;
        font-size: 12px;
        transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
    }
    #novelbin-aggregator .nb-status-chip[data-state='processing'] {
        background: linear-gradient(135deg, rgba(246, 173, 85, 0.3), rgba(246, 173, 85, 0.18));
        border-color: rgba(246, 173, 85, 0.45);
        color: #fbd38d;
    }
    #novelbin-aggregator .nb-status-chip[data-state='cancelled'] {
        background: linear-gradient(135deg, rgba(245, 91, 107, 0.3), rgba(245, 91, 107, 0.18));
        border-color: rgba(245, 91, 107, 0.45);
        color: #f7b1b9;
    }
    #novelbin-aggregator .nb-status-chip[data-state='complete'] {
        background: linear-gradient(135deg, rgba(46, 204, 113, 0.3), rgba(46, 204, 113, 0.18));
        border-color: rgba(46, 204, 113, 0.45);
        color: #c6f6d5;
    }

    #novelbin-aggregator .nb-progress {
        width: 100%;
        height: 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        overflow: hidden;
    }
    #novelbin-aggregator .nb-progress__bar {
        height: 100%;
        width: 0%;
        border-radius: inherit;
        background: linear-gradient(135deg, var(--nb-blue), #64b5f6);
        transition: width 0.3s ease;
    }
    #novelbin-aggregator .nb-progress__bar[data-state='error'] {
        background: linear-gradient(135deg, var(--nb-danger), #b83244);
    }
    #novelbin-aggregator .nb-progress__bar[data-state='success'] {
        background: linear-gradient(135deg, var(--nb-green), #52c796);
    }

    #novelbin-aggregator .nb-utility {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
    }

    #novelbin-aggregator #log-container {
        display: none;
        background: rgba(9, 12, 21, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        padding: 14px;
        font-size: 12px;
        line-height: 1.5;
        color: var(--nb-muted);
        max-height: 160px;
        overflow-y: auto;
        white-space: pre-wrap;
        box-shadow: inset 0 0 20px rgba(5, 8, 16, 0.45);
    }
    #novelbin-aggregator #log-container.is-open {
        display: block;
    }
    #novelbin-aggregator #log-container.empty {
        opacity: 0.75;
        font-style: italic;
    }

    #novelbin-aggregator .nb-settings {
        display: flex;
        flex-direction: column;
        gap: 18px;
    }
    #novelbin-aggregator .nb-settings__grid {
        display: grid;
        gap: 16px;
    }
    #novelbin-aggregator .nb-settings__card {
        background: var(--nb-surface-alt);
        border-radius: 14px;
        border: 1px solid var(--nb-border);
        padding: 16px;
    }
    #novelbin-aggregator .nb-settings__card label {
        display: block;
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 10px;
        color: #ffffff;
    }
    #novelbin-aggregator .nb-settings__hint {
        font-size: 12px;
        color: var(--nb-muted);
        margin-top: 6px;
    }
    #novelbin-aggregator .nb-checkbox {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #ffffff;
        font-weight: 600;
    }
    #novelbin-aggregator .nb-checkbox input[type='checkbox'] {
        width: 18px;
        height: 18px;
        accent-color: var(--nb-accent);
    }

    #novelbin-aggregator .nb-settings__actions {
        display: flex;
        gap: 12px;
    }

    #novelbin-aggregator .is-hidden {
        display: none !important;
    }
`;

            document.head.appendChild(style);
            this.stylesInjected = true;
        }

        createToggleButton() {
            const existingToggle = document.getElementById('novelbin-toggle');
            if (existingToggle) {
                existingToggle.remove();
            }

            const toggleBtn = createElementFromHTML(`
                <button id="novelbin-toggle" class="nb-toggle" type="button"
                    title="Toggle Chapter Aggregator" aria-label="Toggle chapter aggregator" aria-pressed="false">
                    <span aria-hidden="true">${ICONS.aggregator}</span>
                </button>
            `);

            toggleBtn.addEventListener('click', () => {
                this.toggleUI();
            });

            document.body.appendChild(toggleBtn);

            this.updateToggleButtonState();
        }



        toggleUI() {

            const ui = document.getElementById('novelbin-aggregator');



            if (ui) {

                if (this.isVisible) {

                    ui.style.display = 'none';

                    this.isVisible = false;

                } else {

                    ui.style.display = 'flex';

                    this.isVisible = true;

                    this.ensurePanelInViewport();

                }



            } else if (this.isValidPage()) {

                this.createUI();

            } else {

                this.isVisible = false;

            }

            this.updateToggleButtonState();

        }



        updateToggleButtonState() {

            const toggleBtn = document.getElementById('novelbin-toggle');



            if (!toggleBtn) {

                return;

            }



            toggleBtn.setAttribute('aria-pressed', this.isVisible ? 'true' : 'false');

            toggleBtn.classList.toggle('active', this.isVisible);

        }

        ensurePanelInViewport() {
            const ui = document.getElementById('novelbin-aggregator');
            if (!ui) {
                return;
            }

            const displayStyle = window.getComputedStyle(ui).display;
            if (displayStyle === 'none') {
                return;
            }

            const rect = ui.getBoundingClientRect();
            const margin = 16;
            const maxLeft = Math.max(margin, window.innerWidth - ui.offsetWidth - margin);
            const maxTop = Math.max(margin, window.innerHeight - ui.offsetHeight - margin);

            let left = rect.left;
            let top = rect.top;

            if (left < margin) {
                left = margin;
            }
            if (top < margin) {
                top = margin;
            }
            if (left > maxLeft) {
                left = maxLeft;
            }
            if (top > maxTop) {
                top = maxTop;
            }

            ui.style.left = `${left}px`;
            ui.style.top = `${top}px`;
            ui.style.right = 'auto';
        }

        handleWindowResize() {
            this.ensurePanelInViewport();
        }



        refreshChapterList() {
            logger.info('Refreshing chapter list...');
            const oldCount = this.chapters.length;
            this.extractChapterList();
            const newCount = this.chapters.length;

            // Reset selection when chapter list changes
            this.selectedRange = null;
            this.updateUI();

            if (newCount !== oldCount) {
                this.showNotification(`${ICONS.success} Found ${newCount} chapters (${newCount > oldCount ? '+' + (newCount - oldCount) : newCount - oldCount} from before)`, 'success');
            } else {
                this.showNotification('${NOTIFICATION_ICONS.info} Chapter count unchanged', 'info');
            }
        }

        handleRangeSelection() {
            const fromInput = document.getElementById('range-from');
            const toInput = document.getElementById('range-to');

            const fromValue = parseInt(fromInput.value);
            const toValue = parseInt(toInput.value);

            logger.info(`Range selection attempt: from=${fromValue}, to=${toValue}`);

            if (isNaN(fromValue) || isNaN(toValue)) {
                this.showNotification('Please enter valid chapter numbers', 'error');
                return;
            }

            if (fromValue < 1 || toValue < 1 || fromValue > this.chapters.length || toValue > this.chapters.length) {
                this.showNotification(`Please enter chapter numbers between 1 and ${this.chapters.length}`, 'error');
                return;
            }

            if (fromValue > toValue) {
                this.showNotification('From chapter must be less than or equal to To chapter', 'error');
                return;
            }

            this.selectedRange = { from: fromValue, to: toValue };
            logger.info(`Range selection set:`, this.selectedRange);
            this.updateUI();

            const count = toValue - fromValue + 1;
            this.showNotification(`${ICONS.target} Selected chapters ${fromValue} to ${toValue} (${count} chapters)`, 'success');
        }

        selectAll() {
            this.selectedRange = null;

            // Clear range inputs
            const fromInput = document.getElementById('range-from');
            const toInput = document.getElementById('range-to');
            if (fromInput) fromInput.value = '';
            if (toInput) toInput.value = '';

            this.updateUI();
            this.showNotification('${ICONS.selectAll} Selected all chapters', 'success');
        }

        getSelectedChapters() {
            if (this.selectedRange) {
                const { from, to } = this.selectedRange;
                // slice(start, end) is exclusive of end, so we need to add 1 to include the 'to' chapter
                return this.chapters.slice(from - 1, to);
            }
            return this.chapters;
        }

        showNotification(message, type = 'info') {
            const colors = {
                success: 'linear-gradient(135deg, rgba(46, 204, 113, 0.95), rgba(72, 219, 151, 0.9))',
                info: 'linear-gradient(135deg, rgba(33, 150, 243, 0.95), rgba(66, 165, 245, 0.9))',
                error: 'linear-gradient(135deg, rgba(233, 69, 96, 0.95), rgba(190, 40, 70, 0.9))'
            };

            const notification = createElementFromHTML(`
                <div style="
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    min-width: 260px;
                    background: ${colors[type]};
                    color: #fff;
                    padding: 14px 20px;
                    border-radius: 14px;
                    box-shadow: 0 18px 45px rgba(5, 8, 16, 0.5);
                    z-index: 10002;
                    font-weight: 600;
                    font-family: 'Segoe UI', 'Nunito', 'Roboto', sans-serif;
                    letter-spacing: 0.01em;
                ">
                    ${message}
                </div>
            `);
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), type === 'error' ? 4500 : 2800);
        }

        extractChapterList() {
            try {
                const chapterElements = document.querySelectorAll('.list-chapter li a, .chapter-item a, .chapter-list a');
                logger.info(`Found ${chapterElements.length} chapter elements`);

                this.chapters = Array.from(chapterElements).map((el, index) => {
                    const titleEl = el.querySelector('.chapter-title, span, .title') || el;
                    const title = titleEl.textContent.trim() || `Chapter ${index + 1}`;
                    const url = el.href;

                    return { title, url, index };
                }).filter(chapter => chapter.url && !chapter.url.includes('#'));

                logger.info(`Extracted ${this.chapters.length} valid chapters`);

            } catch (error) {
                logger.error('Failed to extract chapter list', { error: error.message });
                this.chapters = [];
            }
        }

        createSettingsModal(isCompact = settingsManager.get('compactMode')) {
            return `
                <div class="nb-settings">
                    <div class="nb-card nb-card--hero">
                        <div class="nb-section-title">Settings</div>
                        <div class="nb-helper">Tune downloader behaviour to stay friendly with NovelBin and dodge Cloudflare prompts.</div>
                    </div>
                    <div class="nb-settings__grid">
                        <div class="nb-settings__card">
                            <label for="setting-batch-size">Batch size (simultaneous downloads)</label>
                            <input type="number" id="setting-batch-size" class="nb-input" min="1" max="20" value="${settingsManager.get('batchSize')}">
                            <div class="nb-settings__hint">Lower values reduce load on the site when Cloudflare is strict.</div>
                        </div>
                        <div class="nb-settings__card">
                            <label for="setting-base-delay">Delay between requests (ms)</label>
                            <input type="number" id="setting-base-delay" class="nb-input" min="500" max="10000" step="500" value="${settingsManager.get('baseDelay')}">
                            <div class="nb-settings__hint">Increase if requests begin to fail or slow down.</div>
                        </div>
                        <div class="nb-settings__card">
                            <label for="setting-max-retries">Max retry attempts</label>
                            <input type="number" id="setting-max-retries" class="nb-input" min="1" max="10" value="${settingsManager.get('maxRetries')}">
                        </div>
                        <div class="nb-settings__card">
                            <label class="nb-checkbox" for="setting-enable-logging">
                                <input type="checkbox" id="setting-enable-logging" ${settingsManager.get('enableLogging') ? 'checked' : ''}>
                                <span>Enable detailed logging</span>
                            </label>
                            <div class="nb-settings__hint">Provides extra context when sharing bug reports.</div>
                        </div>
                        <div class="nb-settings__card">
                            <label class="nb-checkbox" for="setting-compact-mode">
                                <input type="checkbox" id="setting-compact-mode" ${settingsManager.get('compactMode') ? 'checked' : ''}>
                                <span>Compact interface mode</span>
                            </label>
                            <div class="nb-settings__hint">Ideal for narrow screens or when the dev tools are open.</div>
                        </div>
                    </div>
                    <div class="nb-settings__actions">
                        <button id="save-settings" class="nb-btn nb-btn--primary" type="button">${ICONS.save} Save Settings</button>
                        <button id="reset-settings" class="nb-btn nb-btn--danger" type="button">${ICONS.refresh} Reset Defaults</button>
                    </div>
                </div>
            `;
        }

        createUI() {
            const existingUI = document.getElementById('novelbin-aggregator');
            if (existingUI) {
                if (this.dragHandler) {
                    this.dragHandler.destroy();
                }
                existingUI.remove();
            }

            window.removeEventListener('resize', this.handleResize);

            const isCompact = settingsManager.get('compactMode');
            const maxHeight = Math.min(window.innerHeight * 0.8, 620);
            const panelClasses = ['nb-panel'];
            if (isCompact) {
                panelClasses.push('nb-panel--compact');
            }

            const ui = createElementFromHTML(`
                <div id="novelbin-aggregator" class="${panelClasses.join(' ')}" style="max-height: ${maxHeight}px;">
                    <div id="aggregator-header" class="nb-header">
                        <div class="nb-title">
                            <span class="nb-title-icon">${ICONS.header}</span>
                            <div>
                                <div class="nb-title-text">NovelBin Aggregator</div>
                                <div class="nb-subtitle">Cloudflare-aware chapter fetcher</div>
                            </div>
                        </div>
                        <div class="nb-header-actions">
                            <button id="refresh-chapters" class="nb-icon-btn" type="button" title="Refresh chapter list" aria-label="Refresh chapter list">${ICONS.refresh}</button>
                            <button id="settings-btn" class="nb-icon-btn" type="button" title="Settings" aria-label="Open settings">${ICONS.settings}</button>
                            <button id="minimize-aggregator" class="nb-icon-btn" type="button" title="Hide panel" aria-label="Hide panel">${ICONS.minimize}</button>
                        </div>
                    </div>

                    <div id="main-content" class="nb-body">
                        <div id="main-view" class="nb-view nb-view--active">
                            <div class="nb-card nb-card--hero">
                                <div class="nb-section-title">Detected chapters</div>
                                <div class="nb-count" id="chapter-count">${this.chapters.length} Chapters Detected</div>
                                <div class="nb-helper" id="selection-info">All chapters will be downloaded</div>
                            </div>

                            <div class="nb-card">
                                <div class="nb-section-title">Range selection</div>
                                <div class="nb-range-grid">
                                    <input type="number" id="range-from" class="nb-input" placeholder="From" min="1" max="${this.chapters.length}">
                                    <input type="number" id="range-to" class="nb-input" placeholder="To" min="1" max="${this.chapters.length}">
                                </div>
                                <div class="nb-actions">
                                    <button id="select-range" class="nb-btn nb-btn--secondary" type="button">${ICONS.range} Select Range</button>
                                    <button id="select-all" class="nb-btn nb-btn--ghost" type="button">${ICONS.selectAll} Select All</button>
                                </div>
                            </div>

                            <div class="nb-card">
                                <div class="nb-status-row">
                                    <span id="progress-text">Ready to download</span>
                                    <span id="status-badge" class="nb-status-chip" data-state="ready">Ready</span>
                                </div>
                                <div class="nb-progress">
                                    <div id="progress-bar" class="nb-progress__bar" data-state="idle"></div>
                                </div>
                            </div>

                            <div class="nb-actions">
                                <button id="download-chapters" class="nb-btn nb-btn--primary" type="button">${ICONS.download} Download All Chapters</button>
                                <button id="cancel-download" class="nb-btn nb-btn--danger is-hidden" type="button">${ICONS.cancel} Cancel</button>
                            </div>

                            <div class="nb-utility">
                                <button id="export-logs" class="nb-btn nb-btn--ghost" type="button">${ICONS.export} Export Logs</button>
                                <button id="toggle-logs" class="nb-btn nb-btn--ghost" type="button" aria-expanded="false">${ICONS.select} Show Logs</button>
                            </div>

                            <div id="log-container"></div>
                        </div>

                        <div id="settings-view" class="nb-view">
                            ${this.createSettingsModal(isCompact)}
                        </div>
                    </div>
                </div>
            `);

            document.body.appendChild(ui);
            ui.style.display = 'flex';
            this.isVisible = true;

            const header = ui.querySelector('#aggregator-header');
            this.dragHandler = new DragHandler(ui, header);

            this.bindUIEvents();
            this.updateUI();
            this.ensurePanelInViewport();
            window.addEventListener('resize', this.handleResize);
            this.updateToggleButtonState();
        }

        bindUIEvents() {
            const minimizeBtn = document.getElementById('minimize-aggregator');
            if (minimizeBtn) {
                minimizeBtn.addEventListener('click', () => this.toggleUI());
            }

            const settingsBtn = document.getElementById('settings-btn');
            if (settingsBtn) {
                settingsBtn.setAttribute('aria-expanded', this.currentView === 'settings' ? 'true' : 'false');
                settingsBtn.addEventListener('click', () => {
                    this.switchView(this.currentView === 'settings' ? 'main' : 'settings');
                    settingsBtn.setAttribute('aria-expanded', this.currentView === 'settings' ? 'true' : 'false');
                });
            }

            const refreshBtn = document.getElementById('refresh-chapters');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => {
                    this.refreshChapterList();
                });
            }

            const saveBtn = document.getElementById('save-settings');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => this.saveSettings());
            }

            const resetBtn = document.getElementById('reset-settings');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    if (confirm('Reset all settings to defaults?')) {
                        this.resetSettings();
                    }
                });
            }

            const selectRangeBtn = document.getElementById('select-range');
            if (selectRangeBtn) {
                selectRangeBtn.addEventListener('click', () => this.handleRangeSelection());
            }

            const selectAllBtn = document.getElementById('select-all');
            if (selectAllBtn) {
                selectAllBtn.addEventListener('click', () => this.selectAll());
            }

            const rangeFrom = document.getElementById('range-from');
            if (rangeFrom) {
                rangeFrom.addEventListener('keypress', (event) => {
                    if (event.key === 'Enter') {
                        this.handleRangeSelection();
                    }
                });
            }

            const rangeTo = document.getElementById('range-to');
            if (rangeTo) {
                rangeTo.addEventListener('keypress', (event) => {
                    if (event.key === 'Enter') {
                        this.handleRangeSelection();
                    }
                });
            }

            const downloadBtn = document.getElementById('download-chapters');
            if (downloadBtn) {
                downloadBtn.addEventListener('click', () => this.startDownload());
            }

            const cancelBtn = document.getElementById('cancel-download');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => this.cancelDownload());
            }

            const exportBtn = document.getElementById('export-logs');
            if (exportBtn) {
                exportBtn.addEventListener('click', () => {
                    if (!logger.hasLogs()) {
                        this.showNotification(`${NOTIFICATION_ICONS.info} No logs to export yet.`, 'info');
                        return;
                    }
                    logger.exportLogs();
                    this.showNotification(`${ICONS.export} Logs exported`, 'success');
                });
            }

            const toggleLogsBtn = document.getElementById('toggle-logs');
            if (toggleLogsBtn) {
                toggleLogsBtn.addEventListener('click', () => this.toggleLogs());
            }
        }

        saveSettings() {
            const batchSize = parseInt(document.getElementById('setting-batch-size').value);
            const baseDelay = parseInt(document.getElementById('setting-base-delay').value);
            const maxRetries = parseInt(document.getElementById('setting-max-retries').value);
            const enableLogging = document.getElementById('setting-enable-logging').checked;
            const compactMode = document.getElementById('setting-compact-mode').checked;

            if (batchSize < 1 || batchSize > 20) {
                this.showNotification('Batch size must be between 1 and 20', 'error');
                return;
            }

            if (baseDelay < 500 || baseDelay > 10000) {
                this.showNotification('Delay must be between 500 and 10000ms', 'error');
                return;
            }

            settingsManager.set('batchSize', batchSize);
            settingsManager.set('baseDelay', baseDelay);
            settingsManager.set('maxRetries', maxRetries);
            settingsManager.set('enableLogging', enableLogging);

            const oldCompactMode = settingsManager.get('compactMode');
            settingsManager.set('compactMode', compactMode);

            logger.setEnabled(enableLogging);
            this.showNotification('${ICONS.success} Settings saved!', 'success');

            if (oldCompactMode !== compactMode) {
                setTimeout(() => {
                    this.createUI();
                    this.switchView('main');
                }, 1000);
            }
        }

        resetSettings() {
            settingsManager.reset();

            document.getElementById('setting-batch-size').value = settingsManager.get('batchSize');
            document.getElementById('setting-base-delay').value = settingsManager.get('baseDelay');
            document.getElementById('setting-max-retries').value = settingsManager.get('maxRetries');
            document.getElementById('setting-enable-logging').checked = settingsManager.get('enableLogging');
            document.getElementById('setting-compact-mode').checked = settingsManager.get('compactMode');

            logger.setEnabled(settingsManager.get('enableLogging'));
            this.showNotification('${ICONS.refresh} Settings reset', 'info');
        }

        switchView(view) {
            const mainView = document.getElementById('main-view');
            const settingsView = document.getElementById('settings-view');

            if (!mainView || !settingsView) {
                return;
            }

            if (view === 'settings') {
                mainView.classList.remove('nb-view--active');
                settingsView.classList.add('nb-view--active');
                this.currentView = 'settings';
            } else {
                mainView.classList.add('nb-view--active');
                settingsView.classList.remove('nb-view--active');
                this.currentView = 'main';
            }

            const settingsBtn = document.getElementById('settings-btn');
            if (settingsBtn) {
                settingsBtn.setAttribute('aria-expanded', this.currentView === 'settings' ? 'true' : 'false');
            }
        }

        updateUI() {
            const downloadBtn = document.getElementById('download-chapters');
            const cancelBtn = document.getElementById('cancel-download');
            const statusBadge = document.getElementById('status-badge');
            const chapterCount = document.getElementById('chapter-count');
            const selectionInfo = document.getElementById('selection-info');
            const rangeFrom = document.getElementById('range-from');
            const rangeTo = document.getElementById('range-to');
            const progressBar = document.getElementById('progress-bar');

            if (!downloadBtn || !cancelBtn || !statusBadge || !chapterCount || !selectionInfo) {
                return;
            }

            chapterCount.textContent = `${this.chapters.length} Chapters Detected`;

            if (rangeFrom && rangeTo) {
                rangeFrom.max = this.chapters.length;
                rangeTo.max = this.chapters.length;
                rangeFrom.placeholder = `1-${this.chapters.length}`;
                rangeTo.placeholder = `1-${this.chapters.length}`;
            }

            if (this.selectedRange) {
                const { from, to } = this.selectedRange;
                const count = to - from + 1;
                selectionInfo.textContent = `Selected: chapters ${from} to ${to} (${count} chapters)`;
                downloadBtn.textContent = `${ICONS.download} Download Selected (${count})`;
            } else {
                selectionInfo.textContent = 'All chapters will be downloaded';
                downloadBtn.textContent = `${ICONS.download} Download All Chapters`;
            }

            downloadBtn.disabled = this.chapters.length === 0 || this.isProcessing;
            downloadBtn.classList.toggle('is-hidden', this.isProcessing);
            cancelBtn.classList.toggle('is-hidden', !this.isProcessing);

            if (this.isProcessing) {
                statusBadge.textContent = 'Processing';
                statusBadge.setAttribute('data-state', 'processing');
            } else {
                statusBadge.textContent = this.chapters.length === 0 ? 'No chapters' : 'Ready';
                statusBadge.setAttribute('data-state', this.chapters.length === 0 ? 'idle' : 'ready');
                if (progressBar) {
                    progressBar.style.width = '0%';
                    progressBar.setAttribute('data-state', 'idle');
                }
            }
        }

        updateProgress(progress) {
            const progressBar = document.getElementById('progress-bar');
            const progressText = document.getElementById('progress-text');
            const statusBadge = document.getElementById('status-badge');

            if (!progressBar || !progressText || !statusBadge) {
                return;
            }

            progressBar.style.width = `${progress.percentage}%`;

            if (progress.cancelled) {
                progressText.textContent = 'Download cancelled';
                statusBadge.textContent = 'Cancelled';
                statusBadge.setAttribute('data-state', 'cancelled');
                progressBar.setAttribute('data-state', 'error');
                return;
            }

            progressText.textContent = `Processing ${progress.current}/${progress.total} (${progress.percentage}%)`;
            statusBadge.textContent = `${progress.current}/${progress.total}`;
            statusBadge.setAttribute('data-state', 'processing');

            if (progress.success) {
                progressBar.setAttribute('data-state', 'success');
            } else {
                progressBar.setAttribute('data-state', 'error');
            }

            if (progress.current === progress.total) {
                progressText.textContent = 'Processing complete!';
                statusBadge.textContent = 'Complete';
                statusBadge.setAttribute('data-state', 'complete');
                progressBar.setAttribute('data-state', 'success');
            }
        }

        cancelDownload() {
            this.extractor.cancel();
            this.isProcessing = false;
            this.updateUI();
        }

        async startDownload() {
            if (this.chapters.length === 0) {
                this.showNotification('No chapters detected', 'error');
                return;
            }

            const selectedChapters = this.getSelectedChapters();
            if (selectedChapters.length === 0) {
                this.showNotification('No chapters in selected range', 'error');
                return;
            }

            this.isProcessing = true;
            this.updateUI();

            try {
                const { results, failed, cancelled, cloudflare } = await this.extractor.processChapters(
                    selectedChapters,
                    (progress) => this.updateProgress(progress)
                );

                if (cancelled) {
                    this.showNotification('Download cancelled', 'info');
                } else {
                    if (results.length > 0) {
                        this.generateAndDownloadHTML(results);
                    }

                    if (failed.length > 0) {
                        this.showNotification(`Downloaded ${results.length}/${selectedChapters.length} chapters. ${failed.length} failed.`, 'error');
                    } else {
                        const rangeText = this.selectedRange ?
                            `chapters ${this.selectedRange.from}-${this.selectedRange.to}` :
                            'all chapters';
                        this.showNotification(`Successfully downloaded ${rangeText} (${results.length} chapters)!`, 'success');
                    }

                    if (cloudflare) {
                        this.showNotification('Cloudflare challenged one or more requests. Open a chapter in this tab to clear the check and retry missed chapters.', 'error');
                    }
                }

            } catch (error) {
                logger.error('Download failed', { error: error.message });
                this.showNotification('Download failed. Check logs.', 'error');
            } finally {
                this.isProcessing = false;
                this.updateUI();
            }
        }

        generateFileName(chapters) {
            const novelTitle = chapters[0]?.novelTitle || 'Unknown_Novel';
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
            const contentHash = generateHash(chapters.map(ch => ch.chapterTitle).join('')).slice(0, 6);

            return `${sanitizeFileName(novelTitle)}_${chapters.length}ch_${timestamp}_${contentHash}.html`;
        }

        generateAndDownloadHTML(chapters) {
            try {
                const novelTitle = chapters[0]?.novelTitle || 'Unknown Novel';
                const filename = this.generateFileName(chapters);

                const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${novelTitle}</title>
    <meta name="color-scheme" content="dark light">
    <style>
        :root {
            color-scheme: dark;
        }

        * {
            box-sizing: border-box;
        }

        html {
            scroll-behavior: smooth;
        }

        body {
            --nb-surface: #101529;
            --nb-surface-elevated: #151c33;
            --nb-surface-soft: rgba(255, 255, 255, 0.05);
            --nb-border: rgba(255, 255, 255, 0.08);
            --nb-text: #f5f7ff;
            --nb-muted: #9aa3c1;
            --nb-accent: #e94560;
            --nb-accent-strong: #ff5c7a;
            --nb-blue: #2196f3;
            --nb-green: #2ecc71;
            --nb-yellow: #f6ad55;
            --nb-radius: 16px;
            --reader-font-scale: 1;
            --reader-line-height: 1.7;
            --reader-width: 760px;
            --nb-header-height: 86px;
            margin: 0;
            min-height: 100vh;
            background: radial-gradient(circle at top, rgba(35, 46, 75, 0.88) 0%, #0b1120 60%, #060a16 100%);
            color: var(--nb-text);
            line-height: var(--reader-line-height);
            font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
            transition: background 0.35s ease, color 0.35s ease;
        }

        body[data-theme='light'] {
            color-scheme: light;
            --nb-surface: #ffffff;
            --nb-surface-elevated: #f5f6ff;
            --nb-surface-soft: rgba(16, 21, 41, 0.05);
            --nb-border: rgba(16, 21, 41, 0.08);
            --nb-text: #1d263b;
            --nb-muted: #5b6784;
            --nb-accent: #c4284a;
            --nb-accent-strong: #f25576;
            --nb-blue: #2563eb;
            --nb-green: #16a34a;
            --nb-yellow: #f59e0b;
            background: linear-gradient(180deg, #f8f9ff 0%, #eef1ff 100%);
        }

        body[data-width='narrow'] {
            --reader-width: 640px;
        }

        body[data-width='medium'] {
            --reader-width: 760px;
        }

        body[data-width='wide'] {
            --reader-width: 920px;
        }

        body, button, input, textarea {
            font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        }

        button, input {
            color: inherit;
        }

        ::selection {
            background: rgba(233, 69, 96, 0.4);
            color: #ffffff;
        }

        a {
            color: var(--nb-accent);
            text-decoration: none;
        }

        a:hover {
            color: var(--nb-accent-strong);
        }

        .nb-reader {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            padding-bottom: 80px;
        }

        .nb-header {
            position: sticky;
            top: 0;
            z-index: 50;
            display: flex;
            flex-direction: column;
            gap: 16px;
            padding: 18px clamp(16px, 4vw, 32px) 12px;
            background: rgba(10, 13, 25, 0.85);
            border-bottom: 1px solid var(--nb-border);
            box-shadow: 0 24px 40px rgba(6, 10, 22, 0.35);
            backdrop-filter: blur(18px);
        }

        body[data-theme='light'] .nb-header {
            background: rgba(247, 249, 255, 0.92);
            box-shadow: 0 18px 32px rgba(14, 23, 55, 0.12);
        }

        .nb-header__top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 24px;
        }

        .nb-header__brand {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .nb-header__title {
            font-size: clamp(1.6rem, 1.2rem + 1vw, 2.2rem);
            font-weight: 700;
            letter-spacing: 0.01em;
        }

        .nb-header__meta {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            font-size: 0.95rem;
            color: var(--nb-muted);
        }

        .nb-header__meta span {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        .nb-header__actions {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 8px;
        }

        .nb-quick-stats {
            font-size: 0.95rem;
            color: var(--nb-muted);
        }

        .nb-action-group {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .nb-progress {
            height: 5px;
            width: 100%;
            background: var(--nb-surface-soft);
            border-radius: 999px;
            overflow: hidden;
        }

        .nb-progress__bar {
            height: 100%;
            width: 0;
            background: linear-gradient(135deg, var(--nb-blue), var(--nb-accent));
            border-radius: inherit;
            transition: width 0.2s ease;
        }

        .nb-toolbar {
            position: sticky;
            top: calc(var(--nb-header-height));
            z-index: 40;
            display: flex;
            gap: 18px;
            padding: 12px clamp(16px, 4vw, 32px);
            background: rgba(12, 16, 32, 0.8);
            border-bottom: 1px solid var(--nb-border);
            backdrop-filter: blur(16px);
            overflow-x: auto;
        }

        body[data-theme='light'] .nb-toolbar {
            background: rgba(248, 250, 255, 0.94);
            box-shadow: inset 0 -1px 0 rgba(14, 23, 55, 0.06);
        }

        .nb-toolbar::-webkit-scrollbar {
            display: none;
        }

        .nb-toolbar__group {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 16px;
            background: var(--nb-surface-elevated);
            border: 1px solid var(--nb-border);
            border-radius: var(--nb-radius);
            box-shadow: 0 12px 24px rgba(6, 10, 22, 0.25);
        }

        body[data-theme='light'] .nb-toolbar__group {
            box-shadow: 0 12px 24px rgba(14, 23, 55, 0.08);
        }

        .nb-toolbar__label {
            font-size: 0.9rem;
            color: var(--nb-muted);
            white-space: nowrap;
        }

        .nb-toolbar__value {
            min-width: 48px;
            text-align: center;
            font-weight: 600;
        }

        .nb-btn, .nb-icon-btn {
            border: none;
            border-radius: 999px;
            padding: 10px 18px;
            font-weight: 600;
            font-size: 0.95rem;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, color 0.2s ease;
        }

        .nb-btn:disabled, .nb-icon-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            box-shadow: none;
            transform: none;
        }

        .nb-btn--primary {
            background: linear-gradient(135deg, var(--nb-accent), var(--nb-accent-strong));
            color: #ffffff;
            box-shadow: 0 18px 32px rgba(233, 69, 96, 0.35);
        }

        .nb-btn--primary:hover, .nb-btn--primary:focus-visible {
            transform: translateY(-2px);
            box-shadow: 0 20px 36px rgba(233, 69, 96, 0.45);
        }

        .nb-btn--ghost {
            background: transparent;
            color: var(--nb-muted);
            border: 1px solid var(--nb-border);
            padding-inline: 16px;
        }

        .nb-btn--ghost:hover, .nb-btn--ghost:focus-visible {
            color: var(--nb-text);
            border-color: var(--nb-accent);
        }

        .nb-btn--small {
            padding: 8px 14px;
            font-size: 0.85rem;
        }

        .nb-icon-btn {
            width: 42px;
            height: 42px;
            border-radius: 50%;
            background: var(--nb-surface-elevated);
            border: 1px solid var(--nb-border);
            color: inherit;
            box-shadow: 0 12px 24px rgba(6, 10, 22, 0.22);
        }

        .nb-icon-btn:hover, .nb-icon-btn:focus-visible {
            border-color: var(--nb-accent);
            transform: translateY(-2px);
        }

        .nb-icon-btn.is-active {
            background: linear-gradient(135deg, var(--nb-accent), var(--nb-blue));
            color: #ffffff;
        }

        .nb-layout {
            display: grid;
            grid-template-columns: 320px minmax(0, 1fr);
            gap: 28px;
            padding: 32px clamp(16px, 5vw, 48px) 48px;
        }

        .nb-sidebar {
            position: sticky;
            top: calc(var(--nb-header-height) + 76px);
            align-self: start;
            display: flex;
            flex-direction: column;
            gap: 18px;
            padding: 24px;
            background: var(--nb-surface-elevated);
            border: 1px solid var(--nb-border);
            border-radius: var(--nb-radius);
            box-shadow: 0 32px 48px rgba(6, 10, 22, 0.38);
            max-height: calc(100vh - 140px);
            overflow: hidden;
        }

        .nb-sidebar__header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
        }

        .nb-sidebar__title {
            font-weight: 600;
            font-size: 1.05rem;
        }

        .nb-sidebar__meta {
            display: flex;
            flex-direction: column;
            gap: 6px;
            font-size: 0.9rem;
            color: var(--nb-muted);
        }

        .nb-sidebar__search input {
            width: 100%;
            padding: 10px 14px;
            border-radius: 12px;
            border: 1px solid var(--nb-border);
            background: var(--nb-surface);
            color: inherit;
        }

        .nb-sidebar__list {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding-right: 6px;
        }

        .nb-sidebar__item {
            display: grid;
            grid-template-columns: auto 1fr auto;
            gap: 12px;
            align-items: center;
            padding: 12px 14px;
            background: transparent;
            color: inherit;
            border-radius: 12px;
            border: 1px solid transparent;
            cursor: pointer;
            text-align: left;
            transition: transform 0.18s ease, border 0.18s ease, background 0.18s ease;
        }

        .nb-sidebar__item:hover, .nb-sidebar__item:focus-visible {
            border-color: var(--nb-border);
            background: var(--nb-surface);
            transform: translateX(4px);
        }

        .nb-sidebar__item.is-active {
            background: linear-gradient(135deg, rgba(233, 69, 96, 0.22), rgba(33, 150, 243, 0.22));
            border-color: rgba(233, 69, 96, 0.45);
        }

        .nb-sidebar__index {
            font-weight: 600;
            color: var(--nb-muted);
        }

        .nb-sidebar__title-text {
            font-weight: 600;
            line-height: 1.3;
        }

        .nb-sidebar__meta span {
            font-size: 0.8rem;
            color: var(--nb-muted);
        }

        .nb-sidebar__empty {
            text-align: center;
            color: var(--nb-muted);
            padding: 16px 0;
            font-size: 0.9rem;
        }

        .nb-content {
            max-width: var(--reader-width);
            width: 100%;
            margin: 0 auto;
            display: flex;
            flex-direction: column;
            gap: 28px;
        }

        .nb-card, .nb-chapter, .nb-intro-card, .nb-outro-card {
            background: var(--nb-surface-elevated);
            border: 1px solid var(--nb-border);
            border-radius: calc(var(--nb-radius) + 4px);
            padding: clamp(24px, 4vw, 40px);
            box-shadow: 0 32px 48px rgba(6, 10, 22, 0.32);
        }

        body[data-theme='light'] .nb-card,
        body[data-theme='light'] .nb-chapter,
        body[data-theme='light'] .nb-intro-card,
        body[data-theme='light'] .nb-outro-card {
            box-shadow: 0 24px 36px rgba(14, 23, 55, 0.12);
        }

        .nb-intro-card h1 {
            margin-bottom: 12px;
            font-size: clamp(2.1rem, 1.6rem + 1vw, 2.8rem);
        }

        .nb-intro-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 12px 18px;
            color: var(--nb-muted);
            font-size: 0.95rem;
            margin-bottom: 18px;
        }

        .nb-intro-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
        }

        .nb-chapter {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .nb-chapter__header {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .nb-chapter__eyebrow {
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.18em;
            color: var(--nb-muted);
        }

        .nb-chapter__title {
            font-size: clamp(1.6rem, 1.3rem + 0.8vw, 2.2rem);
            font-weight: 700;
            line-height: 1.3;
            scroll-margin-top: calc(var(--nb-header-height) + 120px);
        }

        .nb-chapter__meta {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            font-size: 0.9rem;
            color: var(--nb-muted);
        }

        .nb-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 999px;
            background: var(--nb-surface);
            border: 1px solid var(--nb-border);
        }

        .nb-chip--accent {
            background: rgba(233, 69, 96, 0.16);
            border-color: rgba(233, 69, 96, 0.38);
            color: var(--nb-text);
        }

        .nb-chapter__content {
            font-size: calc(1rem * var(--reader-font-scale));
            line-height: var(--reader-line-height);
            display: grid;
            gap: 1em;
        }

        .nb-chapter__content p {
            margin: 0;
        }

        .nb-chapter__content p + p {
            margin-top: 0.5em;
        }

        .nb-chapter__content img {
            max-width: 100%;
            height: auto;
            border-radius: 12px;
            box-shadow: 0 18px 32px rgba(6, 10, 22, 0.4);
        }

        .nb-chapter__content hr {
            border: none;
            height: 1px;
            background: var(--nb-border);
            margin: 1.5em 0;
        }

        .nb-chapter__content blockquote {
            border-left: 4px solid var(--nb-accent);
            margin: 0;
            padding-left: 16px;
            color: var(--nb-muted);
            font-style: italic;
        }

        .nb-chapter__content ul, .nb-chapter__content ol {
            padding-left: 1.4em;
        }

        .nb-chapter__content table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.95rem;
        }

        .nb-chapter__content table th,
        .nb-chapter__content table td {
            border: 1px solid var(--nb-border);
            padding: 8px 10px;
        }

        .nb-chapter__footer {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            justify-content: space-between;
            margin-top: 8px;
        }

        .nb-outro-card {
            text-align: center;
            color: var(--nb-muted);
        }

        .nb-floating {
            position: fixed;
            bottom: 28px;
            right: 28px;
            display: flex;
            gap: 12px;
            z-index: 60;
        }

        .nb-floating .nb-icon-btn {
            width: 48px;
            height: 48px;
            box-shadow: 0 24px 40px rgba(6, 10, 22, 0.35);
        }

        .nb-floating .nb-icon-btn:hover {
            transform: translateY(-3px);
        }

        .nb-sidebar__overlay {
            display: none;
        }

        body.is-sidebar-open .nb-sidebar__overlay {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(4, 8, 16, 0.6);
            backdrop-filter: blur(3px);
            z-index: 45;
        }

        @media (max-width: 1200px) {
            .nb-layout {
                grid-template-columns: 280px minmax(0, 1fr);
            }
        }

        @media (max-width: 1024px) {
            body {
                --nb-header-height: 108px;
            }

            .nb-layout {
                grid-template-columns: 1fr;
            }

            .nb-sidebar {
                position: fixed;
                top: 0;
                left: 0;
                bottom: 0;
                width: min(360px, 86vw);
                border-radius: 0;
                max-height: none;
                transform: translateX(-110%);
                transition: transform 0.28s ease;
                z-index: 55;
                box-shadow: 0 32px 60px rgba(6, 10, 22, 0.55);
            }

            body.is-sidebar-open .nb-sidebar {
                transform: translateX(0);
            }

            .nb-sidebar__close {
                display: inline-flex;
            }

            .nb-toolbar {
                top: calc(var(--nb-header-height) + 8px);
            }
        }

        @media (max-width: 768px) {
            .nb-header__top {
                flex-direction: column;
                align-items: flex-start;
            }

            .nb-header__actions {
                align-items: flex-start;
            }

            .nb-floating {
                right: 16px;
                bottom: 16px;
            }

            .nb-toolbar__group {
                padding: 10px 12px;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
                scroll-behavior: auto !important;
            }
        }

        @media print {
            body {
                background: #ffffff !important;
                color: #000000 !important;
            }

            .nb-header,
            .nb-toolbar,
            .nb-sidebar,
            .nb-floating,
            .nb-sidebar__overlay {
                display: none !important;
            }

            .nb-layout {
                padding: 0;
            }

            .nb-card,
            .nb-chapter,
            .nb-intro-card,
            .nb-outro-card {
                box-shadow: none;
                border: none;
                padding: 0;
            }

            .nb-chapter__title {
                page-break-before: always;
            }
        }
    </style>
</head>
<body data-theme="dark" data-width="medium">
    <div class="nb-reader">
        <header class="nb-header">
            <div class="nb-header__top">
                <div class="nb-header__brand">
                    <div class="nb-header__title">${novelTitle}</div>
                    <div class="nb-header__meta">
                        <span id="chapter-counter">${chapters.length > 0 ? `Chapter 1 of ${chapters.length}` : 'No chapters detected'}</span>
                        <span>•</span>
                        <span id="current-chapter-title">${chapters[0] ? chapters[0].chapterTitle : ''}</span>
                        <span>•</span>
                        <span>Generated ${new Date().toLocaleString()}</span>
                    </div>
                </div>
                <div class="nb-header__actions">
                    <div class="nb-quick-stats">
                        <span id="total-words">–</span> words • <span id="reading-time">–</span> min read
                    </div>
                    <div class="nb-action-group">
                        <button class="nb-icon-btn" id="toc-toggle" title="Toggle chapter list" aria-label="Toggle chapter list">📚</button>
                        <button class="nb-icon-btn" id="search-toggle" title="Search chapters" aria-label="Search chapters">🔍</button>
                        <button class="nb-icon-btn" id="theme-toggle" title="Toggle theme" aria-label="Toggle theme">🌙</button>
                    </div>
                </div>
            </div>
            <div class="nb-progress" aria-hidden="true">
                <div class="nb-progress__bar" id="progress-bar"></div>
            </div>
        </header>

        <section class="nb-toolbar" aria-label="Reading preferences">
            <div class="nb-toolbar__group">
                <span class="nb-toolbar__label">Font size</span>
                <button class="nb-btn nb-btn--ghost nb-btn--small" id="font-decrease" aria-label="Decrease font size">A−</button>
                <span class="nb-toolbar__value" id="font-label">100%</span>
                <button class="nb-btn nb-btn--ghost nb-btn--small" id="font-increase" aria-label="Increase font size">A+</button>
            </div>
            <div class="nb-toolbar__group">
                <span class="nb-toolbar__label">Line height</span>
                <button class="nb-btn nb-btn--ghost nb-btn--small" id="line-decrease" aria-label="Decrease line height">−</button>
                <span class="nb-toolbar__value" id="line-label">1.70×</span>
                <button class="nb-btn nb-btn--ghost nb-btn--small" id="line-increase" aria-label="Increase line height">＋</button>
            </div>
            <div class="nb-toolbar__group">
                <span class="nb-toolbar__label">Page width</span>
                <button class="nb-btn nb-btn--ghost nb-btn--small" data-width-option="narrow">Narrow</button>
                <button class="nb-btn nb-btn--ghost nb-btn--small" data-width-option="medium">Comfort</button>
                <button class="nb-btn nb-btn--ghost nb-btn--small" data-width-option="wide">Wide</button>
            </div>
            <div class="nb-toolbar__group">
                <span class="nb-toolbar__label">Preferences</span>
                <button class="nb-btn nb-btn--ghost nb-btn--small" id="reset-preferences">Reset</button>
            </div>
        </section>

        <div class="nb-layout">
            <aside class="nb-sidebar" id="sidebar" data-state="closed" aria-label="Chapter list">
                <div class="nb-sidebar__header">
                    <div>
                        <div class="nb-sidebar__title">Table of contents</div>
                        <div class="nb-sidebar__meta">
                            <span>${chapters.length} chapters total</span>
                            <span id="sidebar-words">– words</span>
                        </div>
                    </div>
                    <button class="nb-icon-btn nb-sidebar__close" id="sidebar-close" aria-label="Close chapter list" title="Close">✕</button>
                </div>
                <div class="nb-sidebar__search">
                    <input type="search" id="sidebar-search" placeholder="Filter chapters..." autocomplete="off">
                </div>
                <nav class="nb-sidebar__list" id="toc" aria-label="Chapters">
                    ${chapters.map((chapter, index) => `
                        <button class="nb-sidebar__item${index === 0 ? ' is-active' : ''}" data-target="chapter-${index + 1}" data-index="${index + 1}">
                            <span class="nb-sidebar__index">${index + 1}</span>
                            <span class="nb-sidebar__title-text">${chapter.chapterTitle}</span>
                            <span class="nb-sidebar__meta" data-chapter-meta="${index + 1}">—</span>
                        </button>
                    `).join('')}
                    ${chapters.length === 0 ? '<div class="nb-sidebar__empty">No chapters available.</div>' : ''}
                </nav>
            </aside>
            <div class="nb-sidebar__overlay" id="sidebar-overlay"></div>

            <main class="nb-content" id="main-content">
                <article class="nb-intro-card">
                    <h1>${novelTitle}</h1>
                    <div class="nb-intro-meta">
                        <span>${chapters.length} chapters</span>
                        <span id="intro-words">– words</span>
                        <span id="intro-reading-time">– min read</span>
                    </div>
                    <p class="nb-intro-description">Enjoy a focused, distraction-free reading experience that mirrors the in-page NovelBin Aggregator design. Customize the typography, toggle between light and dark themes, and keep track of your progress as you move between chapters.</p>
                    <div class="nb-intro-actions">
                        <button class="nb-btn nb-btn--primary" id="start-reading">Start reading</button>
                        <button class="nb-btn nb-btn--ghost" id="jump-latest">Jump to latest</button>
                    </div>
                </article>

                ${chapters.map((chapter, index) => `
                    <article class="nb-chapter" id="chapter-${index + 1}" data-index="${index + 1}">
                        <header class="nb-chapter__header">
                            <div class="nb-chapter__eyebrow">Chapter ${index + 1}</div>
                            <h2 class="nb-chapter__title">${chapter.chapterTitle}</h2>
                            <div class="nb-chapter__meta">
                                <span class="nb-chip nb-chip--accent" data-meta-words="${index + 1}">— words</span>
                                <span class="nb-chip" data-meta-reading="${index + 1}">— min read</span>
                            </div>
                        </header>
                        <section class="nb-chapter__content">
                            ${chapter.content}
                        </section>
                        <footer class="nb-chapter__footer">
                            <button class="nb-btn nb-btn--ghost nb-btn--small" data-action="prev" ${index === 0 ? 'disabled' : ''}>‹ Previous</button>
                            <button class="nb-btn nb-btn--ghost nb-btn--small" data-action="top">Back to top</button>
                            <button class="nb-btn nb-btn--ghost nb-btn--small" data-action="next" ${index === chapters.length - 1 ? 'disabled' : ''}>Next ›</button>
                        </footer>
                    </article>
                `).join('')}

                <article class="nb-outro-card">
                    <h2>All chapters complete ✅</h2>
                    <p>Thanks for reading <strong>${novelTitle}</strong> with the NovelBin Aggregator Simplified reader.</p>
                    <p>Generated by NovelBin Aggregator Simplified v2.5.0 · ${new Date().toLocaleString()}</p>
                </article>
            </main>
        </div>

        <div class="nb-floating" aria-label="Quick navigation">
            <button class="nb-icon-btn" id="float-prev" title="Previous chapter (Ctrl + ←)">‹</button>
            <button class="nb-icon-btn" id="float-toc" title="Toggle chapter list">☰</button>
            <button class="nb-icon-btn" id="float-next" title="Next chapter (Ctrl + →)">›</button>
        </div>
    </div>

    <script>
        (function() {
            const novelTitle = ${JSON.stringify(novelTitle)};
            const totalChapters = ${chapters.length};
            const storageKeys = {
                theme: 'nbReaderTheme',
                font: 'nbReaderFontScale',
                line: 'nbReaderLineHeight',
                width: 'nbReaderWidth'
            };

            const body = document.body;
            const chapters = Array.from(document.querySelectorAll('.nb-chapter'));
            const tocItems = Array.from(document.querySelectorAll('.nb-sidebar__item'));
            const progressBar = document.getElementById('progress-bar');
            const chapterCounter = document.getElementById('chapter-counter');
            const currentChapterTitle = document.getElementById('current-chapter-title');
            const floatPrev = document.getElementById('float-prev');
            const floatNext = document.getElementById('float-next');
            const floatToc = document.getElementById('float-toc');
            const sidebar = document.getElementById('sidebar');
            const sidebarOverlay = document.getElementById('sidebar-overlay');
            const sidebarSearch = document.getElementById('sidebar-search');
            const themeToggle = document.getElementById('theme-toggle');
            const fontIncrease = document.getElementById('font-increase');
            const fontDecrease = document.getElementById('font-decrease');
            const lineIncrease = document.getElementById('line-increase');
            const lineDecrease = document.getElementById('line-decrease');
            const resetPreferences = document.getElementById('reset-preferences');
            const widthButtons = Array.from(document.querySelectorAll('[data-width-option]'));
            const fontLabel = document.getElementById('font-label');
            const lineLabel = document.getElementById('line-label');
            const startReading = document.getElementById('start-reading');
            const jumpLatest = document.getElementById('jump-latest');
            const searchToggle = document.getElementById('search-toggle');
            const tocToggle = document.getElementById('toc-toggle');
            const sidebarClose = document.getElementById('sidebar-close');

            let currentIndex = 0;
            let fontScale = parseFloat(localStorage.getItem(storageKeys.font) || '1');
            let lineHeight = parseFloat(localStorage.getItem(storageKeys.line) || '1.7');
            let contentWidth = localStorage.getItem(storageKeys.width) || 'medium';

            const numberFormatter = new Intl.NumberFormat();

            function clamp(value, min, max) {
                return Math.min(Math.max(value, min), max);
            }

            function applyFontScale(value) {
                fontScale = clamp(value, 0.85, 1.4);
                body.style.setProperty('--reader-font-scale', fontScale);
                fontLabel.textContent = Math.round(fontScale * 100) + '%';
                localStorage.setItem(storageKeys.font, fontScale.toFixed(2));
            }

            function applyLineHeight(value) {
                lineHeight = clamp(value, 1.45, 2.05);
                body.style.setProperty('--reader-line-height', lineHeight);
                lineLabel.textContent = lineHeight.toFixed(2) + '×';
                localStorage.setItem(storageKeys.line, lineHeight.toFixed(2));
            }

            function applyWidth(value) {
                const allowed = ['narrow', 'medium', 'wide'];
                if (!allowed.includes(value)) {
                    value = 'medium';
                }
                contentWidth = value;
                body.dataset.width = contentWidth;
                widthButtons.forEach(btn => {
                    const isActive = btn.dataset.widthOption === contentWidth;
                    btn.classList.toggle('nb-btn--primary', isActive);
                    btn.classList.toggle('nb-btn--ghost', !isActive);
                    btn.setAttribute('aria-pressed', String(isActive));
                });
                localStorage.setItem(storageKeys.width, contentWidth);
            }

            function applyTheme(theme) {
                const resolvedTheme = theme === 'light' ? 'light' : 'dark';
                body.dataset.theme = resolvedTheme;
                themeToggle.textContent = resolvedTheme === 'dark' ? '☀️' : '🌙';
                themeToggle.setAttribute('title', resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
                localStorage.setItem(storageKeys.theme, resolvedTheme);
            }

            function updateDocumentTitle() {
                if (!chapters.length) {
                    document.title = novelTitle;
                    return;
                }
                const activeChapter = chapters[currentIndex];
                const title = activeChapter ? activeChapter.querySelector('.nb-chapter__title') : null;
                if (title) {
                    document.title = title.textContent + ' • ' + novelTitle;
                } else {
                    document.title = novelTitle;
                }
            }

            function updateCurrentChapterDisplay() {
                if (!chapters.length) return;
                const total = chapters.length;
                chapterCounter.textContent = 'Chapter ' + (currentIndex + 1) + ' of ' + total;
                const activeChapter = chapters[currentIndex];
                if (activeChapter) {
                    const title = activeChapter.querySelector('.nb-chapter__title');
                    if (title) {
                        currentChapterTitle.textContent = title.textContent;
                    }
                }
                floatPrev.disabled = currentIndex === 0;
                floatNext.disabled = currentIndex >= chapters.length - 1;
                updateDocumentTitle();
            }

            function setActiveChapter(index) {
                if (index < 0 || index >= chapters.length) return;
                currentIndex = index;
                tocItems.forEach((item, idx) => {
                    item.classList.toggle('is-active', idx === currentIndex);
                });
                updateCurrentChapterDisplay();
            }

            function navigateToChapter(index) {
                if (index < 0 || index >= chapters.length) return;
                const chapter = chapters[index];
                chapter.scrollIntoView({ behavior: 'smooth', block: 'start' });
                if (window.innerWidth <= 1024) {
                    closeSidebar();
                }
            }

            function updateProgress() {
                const scrollable = document.documentElement.scrollHeight - window.innerHeight;
                const progress = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
                progressBar.style.width = Math.min(100, Math.max(0, progress)) + '%';
            }

            function openSidebar() {
                body.classList.add('is-sidebar-open');
                sidebar.setAttribute('data-state', 'open');
                sidebarOverlay.removeAttribute('hidden');
            }

            function closeSidebar(force) {
                if (!force && window.innerWidth > 1024) return;
                body.classList.remove('is-sidebar-open');
                sidebar.setAttribute('data-state', 'closed');
                sidebarOverlay.setAttribute('hidden', '');
            }

            function toggleSidebar() {
                if (sidebar.getAttribute('data-state') === 'open') {
                    closeSidebar(true);
                } else {
                    openSidebar();
                }
            }

            function filterChapters(query) {
                const value = query.trim().toLowerCase();
                let anyVisible = false;
                tocItems.forEach(item => {
                    const text = item.textContent.toLowerCase();
                    const match = !value || text.includes(value);
                    item.style.display = match ? 'grid' : 'none';
                    if (match) anyVisible = true;
                });
                if (!anyVisible) {
                    if (!sidebar.querySelector('.nb-sidebar__empty')) {
                        const empty = document.createElement('div');
                        empty.className = 'nb-sidebar__empty';
                        empty.textContent = 'No chapters match your search.';
                        empty.setAttribute('data-empty', 'true');
                        sidebar.querySelector('.nb-sidebar__list').appendChild(empty);
                    }
                } else {
                    sidebar.querySelectorAll('[data-empty="true"]').forEach(el => el.remove());
                }
            }

            function computeStatistics() {
                if (!chapters.length) return;
                let totalWords = 0;
                let totalMinutes = 0;

                chapters.forEach((chapter, index) => {
                    const content = chapter.querySelector('.nb-chapter__content');
                    const text = content ? content.textContent : '';
                    const words = text.trim().split(/\s+/).filter(Boolean);
                    const wordCount = words.length;
                    const minutes = Math.max(1, Math.round(wordCount / 230));
                    totalWords += wordCount;
                    totalMinutes += minutes;

                    const wordLabel = chapter.querySelector('[data-meta-words="' + (index + 1) + '"]');
                    const minuteLabel = chapter.querySelector('[data-meta-reading="' + (index + 1) + '"]');
                    const tocMeta = document.querySelector('[data-chapter-meta="' + (index + 1) + '"]');

                    if (wordLabel) {
                        wordLabel.textContent = numberFormatter.format(wordCount) + ' words';
                    }
                    if (minuteLabel) {
                        minuteLabel.textContent = minutes + ' min read';
                    }
                    if (tocMeta) {
                        tocMeta.textContent = minutes + ' min';
                    }
                });

                const formattedWords = numberFormatter.format(totalWords);
                const introWords = document.getElementById('intro-words');
                const introMinutes = document.getElementById('intro-reading-time');
                const sidebarWords = document.getElementById('sidebar-words');

                document.getElementById('total-words').textContent = formattedWords;
                document.getElementById('reading-time').textContent = totalMinutes;
                if (introWords) introWords.textContent = formattedWords + ' words';
                if (introMinutes) introMinutes.textContent = totalMinutes + ' min read';
                if (sidebarWords) sidebarWords.textContent = formattedWords + ' words';
            }

            function attachChapterFooterActions() {
                document.querySelectorAll('.nb-chapter__footer button').forEach(button => {
                    button.addEventListener('click', event => {
                        const action = button.dataset.action;
                        const chapter = button.closest('.nb-chapter');
                        const index = chapters.indexOf(chapter);
                        if (action === 'prev') {
                            navigateToChapter(index - 1);
                        } else if (action === 'next') {
                            navigateToChapter(index + 1);
                        } else if (action === 'top') {
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                    });
                });
            }

            const storedTheme = localStorage.getItem(storageKeys.theme);
            if (storedTheme) {
                applyTheme(storedTheme);
            } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                applyTheme('light');
            } else {
                applyTheme('dark');
            }

            applyFontScale(fontScale);
            applyLineHeight(lineHeight);
            applyWidth(contentWidth);

            themeToggle.addEventListener('click', () => {
                applyTheme(body.dataset.theme === 'dark' ? 'light' : 'dark');
            });

            fontIncrease.addEventListener('click', () => {
                applyFontScale(fontScale + 0.05);
            });

            fontDecrease.addEventListener('click', () => {
                applyFontScale(fontScale - 0.05);
            });

            lineIncrease.addEventListener('click', () => {
                applyLineHeight(lineHeight + 0.05);
            });

            lineDecrease.addEventListener('click', () => {
                applyLineHeight(lineHeight - 0.05);
            });

            widthButtons.forEach(button => {
                button.addEventListener('click', () => applyWidth(button.dataset.widthOption));
            });

            resetPreferences.addEventListener('click', () => {
                applyFontScale(1);
                applyLineHeight(1.7);
                applyWidth('medium');
                applyTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
            });

            tocItems.forEach((item, index) => {
                item.addEventListener('click', () => {
                    navigateToChapter(index);
                });
            });

            if (startReading) {
                startReading.addEventListener('click', () => navigateToChapter(0));
            }

            if (jumpLatest) {
                jumpLatest.addEventListener('click', () => navigateToChapter(chapters.length - 1));
            }

            if (searchToggle) {
                searchToggle.addEventListener('click', () => {
                    openSidebar();
                    setTimeout(() => {
                        sidebarSearch.focus();
                        sidebarSearch.select();
                    }, 160);
                });
            }

            if (tocToggle) {
                tocToggle.addEventListener('click', toggleSidebar);
            }

            if (sidebarClose) {
                sidebarClose.addEventListener('click', () => closeSidebar(true));
            }

            if (sidebarOverlay) {
                sidebarOverlay.addEventListener('click', () => closeSidebar(true));
            }

            if (sidebarSearch) {
                sidebarSearch.addEventListener('input', event => filterChapters(event.target.value));
            }

            floatPrev.addEventListener('click', () => navigateToChapter(currentIndex - 1));
            floatNext.addEventListener('click', () => navigateToChapter(currentIndex + 1));
            floatToc.addEventListener('click', toggleSidebar);

            window.addEventListener('keydown', event => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowRight') {
                    event.preventDefault();
                    navigateToChapter(currentIndex + 1);
                } else if ((event.ctrlKey || event.metaKey) && event.key === 'ArrowLeft') {
                    event.preventDefault();
                    navigateToChapter(currentIndex - 1);
                } else if (event.key === 'Escape') {
                    closeSidebar(true);
                } else if (event.key === 'Home') {
                    navigateToChapter(0);
                } else if (event.key === 'End') {
                    navigateToChapter(chapters.length - 1);
                }
            });

            let ticking = false;
            window.addEventListener('scroll', () => {
                if (!ticking) {
                    window.requestAnimationFrame(() => {
                        updateProgress();
                        ticking = false;
                    });
                    ticking = true;
                }
            }, { passive: true });

            const observer = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const index = parseInt(entry.target.dataset.index, 10) - 1;
                        if (!Number.isNaN(index)) {
                            setActiveChapter(index);
                        }
                    }
                });
            }, {
                root: null,
                threshold: 0.35
            });

            chapters.forEach(chapter => observer.observe(chapter));

            window.addEventListener('resize', () => {
                if (window.innerWidth > 1024) {
                    closeSidebar(true);
                }
            });

            attachChapterFooterActions();
            computeStatistics();
            updateProgress();
            updateCurrentChapterDisplay();
            updateDocumentTitle();
        })();
    </script>
</body>
</html>`;

                const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);

                logger.info(`Modern HTML generated and downloaded`, {
                    filename,
                    fileSize: blob.size,
                    chapterCount: chapters.length
                });

            } catch (error) {
                logger.error('Failed to generate HTML', { error: error.message });
                throw error;
            }
        }

        toggleLogs() {

            const logContainer = document.getElementById('log-container');

            const toggleBtn = document.getElementById('toggle-logs');

            if (!logContainer || !toggleBtn) {

                return;

            }

            const isOpen = logContainer.classList.toggle('is-open');

            if (isOpen) {

                const message = !logger.enabled && !logger.hasLogs()

                    ? 'Logging is currently disabled.'

                    : logger.getLogs();

                logContainer.textContent = message;

                logContainer.classList.toggle('empty', !logger.hasLogs());

                toggleBtn.textContent = `${ICONS.select} Hide Logs`;

                toggleBtn.setAttribute('aria-expanded', 'true');

                logContainer.scrollTop = logContainer.scrollHeight;

            } else {

                toggleBtn.textContent = `${ICONS.select} Show Logs`;

                toggleBtn.setAttribute('aria-expanded', 'false');

            }

        }

        destroy() {
            if (this.dragHandler) {
                this.dragHandler.destroy();
            }

            window.removeEventListener('resize', this.handleResize);

            const ui = document.getElementById('novelbin-aggregator');
            if (ui) {
                ui.remove();
            }

            const toggleBtn = document.getElementById('novelbin-toggle');
            if (toggleBtn) {
                toggleBtn.remove();
            }
        }
    }

    // ================== INITIALIZATION ==================
    function init() {
        logger.info('NovelBin Chapter Aggregator Simplified v2.5 loaded');

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => new UIController().init(), 1500);
            });
        } else {
            setTimeout(() => new UIController().init(), 1500);
        }
    }

    init();

})();
