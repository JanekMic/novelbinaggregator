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

            logger.info('Initializing NovelBin Chapter Aggregator Simplified v2.4');
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
    <style>
        :root {
            --primary-bg: #ffffff;
            --secondary-bg: #f8f9fa;
            --text-primary: #2c3e50;
            --text-secondary: #6c757d;
            --accent: #007bff;
            --accent-hover: #0056b3;
            --border: #dee2e6;
            --shadow: rgba(0,0,0,0.1);
            --navbar-height: 60px;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --primary-bg: #1a1a1a;
                --secondary-bg: #2d2d2d;
                --text-primary: #e9ecef;
                --text-secondary: #adb5bd;
                --accent: #0d6efd;
                --accent-hover: #0b5ed7;
                --border: #495057;
                --shadow: rgba(0,0,0,0.3);
            }
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.7;
            color: var(--text-primary);
            background: var(--primary-bg);
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

        /* Modern Navigation */
        .navbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: var(--navbar-height);
            background: var(--secondary-bg);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid var(--border);
            z-index: 1000;
            display: flex;
            align-items: center;
            padding: 0 20px;
            box-shadow: 0 2px 10px var(--shadow);
        }

        .nav-brand {
            font-weight: 700;
            font-size: 18px;
            color: var(--accent);
            margin-right: auto;
        }

        .nav-stats {
            font-size: 14px;
            color: var(--text-secondary);
            margin-right: 20px;
        }

        .menu-toggle {
            background: var(--accent);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
        }

        .menu-toggle:hover {
            background: var(--accent-hover);
            transform: translateY(-1px);
        }

        /* Sidebar */
        .sidebar {
            position: fixed;
            top: var(--navbar-height);
            right: -300px; left: auto;
            width: 300px;
            height: calc(100vh - var(--navbar-height));
            background: var(--secondary-bg);
            border-right: 1px solid var(--border);
            overflow-y: auto;
            /* transition: left 0.3s ease; */
            z-index: 999;
            box-shadow: 2px 0 10px var(--shadow);
        }

        .sidebar.open {
            right: 0; left: auto;
        }

        .sidebar-header {
            padding: 20px;
            border-bottom: 1px solid var(--border);
            background: linear-gradient(135deg, var(--accent), var(--accent-hover));
            color: white;
        }

        .sidebar-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 5px;
        }

        .sidebar-meta {
            font-size: 12px;
            opacity: 0.9;
        }

        .chapter-list {
            padding: 10px 0;
        }

        .chapter-item {
            display: block;
            padding: 12px 20px;
            color: var(--text-secondary);
            text-decoration: none;
            border-left: 3px solid transparent;
            transition: all 0.2s ease;
            font-size: 14px;
        }

        .chapter-item:hover,
        .chapter-item.active {
            background: rgba(0, 123, 255, 0.1);
            border-left-color: var(--accent);
            color: var(--accent);
            transform: translateX(5px);
        }

        .chapter-item.active {
            font-weight: 600;
        }

        /* Main Content */
        .main-content {
            margin-top: var(--navbar-height);
            max-width: 800px;
            margin-left: auto;
            margin-right: auto;
            padding: 40px 30px;
            /* transition: margin-left 0.3s ease; */
        }

        .main-content.sidebar-open {
            /* margin-left: 300px; */
        }

        /* Typography */
        .book-title {
            font-size: 2.5rem;
            font-weight: 700;
            color: var(--accent);
            text-align: center;
            margin-bottom: 30px;
            letter-spacing: -0.02em;
        }

        .chapter-title {
            font-size: 1.8rem;
            font-weight: 600;
            color: var(--text-primary);
            margin: 60px 0 30px 0;
            padding-bottom: 15px;
            border-bottom: 2px solid var(--border);
            scroll-margin-top: calc(var(--navbar-height) + 20px);
        }

        .chapter-content {
            margin-bottom: 60px;
            font-size: 16px;
            line-height: 1.8;
        }

        .chapter-content p {
            margin-bottom: 20px;
            text-align: justify;
        }

        .chapter-content p:first-child::first-letter {
            font-size: 3em;
            line-height: 1;
            float: left;
            margin: 5px 10px 0 0;
            color: var(--accent);
            font-weight: 700;
        }

        /* Metadata */
        .metadata {
            background: var(--secondary-bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 30px;
            text-align: center;
            color: var(--text-secondary);
            margin: 40px 0;
            box-shadow: 0 4px 20px var(--shadow);
        }

        /* Progress Indicator */
        .progress-bar {
            position: fixed;
            top: var(--navbar-height);
            left: 0;
            height: 3px;
            background: var(--accent);
            z-index: 998;
            transition: width 0.1s ease;
        }

        /* Navigation Controls */
        .nav-controls {
            position: fixed;
            bottom: 30px;
            right: 30px;
            display: flex;
            gap: 10px;
            z-index: 997;
        }

        .nav-btn {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: var(--accent);
            color: white;
            border: none;
            cursor: pointer;
            font-size: 18px;
            transition: all 0.2s ease;
            box-shadow: 0 4px 15px var(--shadow);
        }

        .nav-btn:hover {
            background: var(--accent-hover);
            transform: translateY(-2px);
            box-shadow: 0 6px 20px var(--shadow);
        }

        .nav-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .navbar {
                padding: 0 15px;
            }

            .nav-stats {
                display: none;
            }

            .main-content {
                padding: 30px 20px;
            }

            .book-title {
                font-size: 2rem;
            }

            .chapter-title {
                font-size: 1.5rem;
            }

            .nav-controls {
                bottom: 20px;
                right: 20px;
            }

            .nav-btn {
                width: 45px;
                height: 45px;
                font-size: 16px;
            }
        }

        @media (max-width: 480px) {
            .sidebar {
                width: 280px;
                left: -280px;
            }

            .main-content {
                padding: 20px 15px;
            }

            .book-title {
                font-size: 1.6rem;
            }

            .chapter-title {
                font-size: 1.3rem;
            }
        }

        /* Print Styles */
        @media print {
            .navbar, .sidebar, .nav-controls, .progress-bar {
                display: none !important;
            }

            .main-content {
                margin: 0;
                max-width: none;
                padding: 0;
            }

            .chapter-title {
                page-break-before: always;
                margin-top: 0;
            }
        }
    </style>
</head>
<body>
    <!-- Navigation Bar -->
    <nav class="navbar">
        <div class="nav-brand">${novelTitle}</div>
        <div class="nav-stats" id="chapter-stats">${chapters[0] ? chapters[0].chapterTitle : ''}</div>
        <button class="menu-toggle" onclick="toggleSidebar()">📚 Chapters</button>
    </nav>

    <!-- Progress Bar -->
    <div class="progress-bar" id="progress-bar"></div>

    <!-- Sidebar -->
    <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
            <div class="sidebar-title">${novelTitle}</div>
            <div class="sidebar-meta">${chapters.length} chapters • Generated ${new Date().toLocaleDateString()}</div>
        </div>
        <nav class="chapter-list">
            ${chapters.map((chapter, index) => `
                <a href="#chapter-${index + 1}" class="chapter-item" onclick="navigateToChapter(${index + 1})">
                    ${index + 1}. ${chapter.chapterTitle}
                </a>
            `).join('')}
        </nav>
    </aside>

    <!-- Main Content -->
    <main class="main-content" id="main-content">
        <h1 class="book-title">${novelTitle}</h1>

        <div class="metadata">
            📖 Generated on ${new Date().toLocaleString()}<br>
            📊 ${chapters.length} chapters • 🚀 NovelBin Aggregator v2.4<br>
            🎯 Optimized reading experience
        </div>

        ${chapters.map((chapter, index) => `
            <h2 class="chapter-title" id="chapter-${index + 1}">${chapter.chapterTitle}</h2>
            <div class="chapter-content">
                ${chapter.content}
            </div>
        `).join('')}

        <div class="metadata">
            ✅ End of ${novelTitle}<br>
            📖 ${chapters.length} chapters completed<br>
            <small>Generated by NovelBin Chapter Aggregator v2.4</small>
        </div>
    </main>

    <!-- Navigation Controls -->
    <div class="nav-controls">
        <button class="nav-btn" id="prev-btn" onclick="navigatePrev()" title="Previous chapter">‹</button>
        <button class="nav-btn" id="next-btn" onclick="navigateNext()" title="Next chapter">›</button>
    </div>

    <script>
        let currentChapter = 1;
        const totalChapters = ${chapters.length};
        const chapterTitles = ${JSON.stringify(chapters.map(c => c.chapterTitle))};
        let sidebarOpen = false;

        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            updateProgress();
            updateNavButtons();
            updateActiveChapter();

            // Scroll handler
            let scrollTimeout;
            window.addEventListener('scroll', function() {
                if (scrollTimeout) clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    updateProgress();
                    updateCurrentChapter();
                }, 16);
            });

            // Keyboard shortcuts
            document.addEventListener('keydown', function(e) {
                if (e.key === 'ArrowLeft' && e.ctrlKey) {
                    e.preventDefault();
                    navigatePrev();
                } else if (e.key === 'ArrowRight' && e.ctrlKey) {
                    e.preventDefault();
                    navigateNext();
                } else if (e.key === 'Escape' && sidebarOpen) {
                    toggleSidebar();
                }
            });

            // Close sidebar on outside click (mobile)
            document.addEventListener('click', function(e) {
                if (sidebarOpen && !e.target.closest('.sidebar') && !e.target.closest('.menu-toggle')) {
                    if (window.innerWidth <= 1100) {
                        toggleSidebar();
                    }
                }
            });
        });

        function toggleSidebar() {
            sidebarOpen = !sidebarOpen;
            const sidebar = document.getElementById('sidebar');
            const mainContent = document.getElementById('main-content');

            sidebar.classList.toggle('open');
            // if (window.innerWidth > 1100) { // This condition might need adjustment based on new sidebar logic
            //     mainContent.classList.toggle('sidebar-open');
            // }
            // For a right-side sidebar, you might not need to adjust main content margin,
            // or you might adjust margin-right if the sidebar pushes content.
            // The original instruction was to remove margin adjustments, so we'll stick to that.
            // If the sidebar is an overlay, main content doesn't need to move.
            // If it's meant to push content, then margin-right would be adjusted.
            // Based on the CSS changes, the sidebar is likely an overlay now.
        }

        function navigateToChapter(chapterNum) {
            currentChapter = chapterNum;
            const element = document.getElementById('chapter-' + chapterNum);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                updateNavButtons();
                updateActiveChapter();

                if (window.innerWidth <= 1100 && sidebarOpen) {
                    setTimeout(() => toggleSidebar(), 300);
                }
            }
        }

        function navigatePrev() {
            if (currentChapter > 1) {
                navigateToChapter(currentChapter - 1);
            }
        }

        function navigateNext() {
            if (currentChapter < totalChapters) {
                navigateToChapter(currentChapter + 1);
            }
        }

        function updateProgress() {
            const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
            const progress = totalHeight > 0 ? (window.pageYOffset / totalHeight) * 100 : 0;
            document.getElementById('progress-bar').style.width = Math.min(100, Math.max(0, progress)) + '%';
        }

        function updateCurrentChapter() {
            const chapters = document.querySelectorAll('.chapter-title');
            const scrollPos = window.pageYOffset + 100;

            for (let i = chapters.length - 1; i >= 0; i--) {
                if (chapters[i].offsetTop <= scrollPos) {
                    const newChapter = i + 1;
                    if (newChapter !== currentChapter) {
                        currentChapter = newChapter;
                        updateNavButtons();
                        updateActiveChapter();
                    }
                    break;
                }
            }
        }

        function updateNavButtons() {
            document.getElementById('prev-btn').disabled = currentChapter <= 1;
            document.getElementById('next-btn').disabled = currentChapter >= totalChapters;
        }

        function updateActiveChapter() {
            document.querySelectorAll('.chapter-item').forEach((item, index) => {
                item.classList.toggle('active', index + 1 === currentChapter);
            });

            updateChapterStats();
        }

        function updateChapterStats() {
            const chapterStats = document.getElementById('chapter-stats');
            if (chapterStats) {
                chapterStats.textContent = chapterTitles[currentChapter - 1] || '';
            }
        }
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
        logger.info('NovelBin Chapter Aggregator Simplified v2.4 loaded');

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
