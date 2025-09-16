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

    const THEME = Object.freeze({
        panel: '#151a23',
        panelElevated: '#1f2736',
        highlight: '#222c3d',
        border: '#2d3648',
        borderAccent: 'rgba(233, 69, 96, 0.45)',
        accent: '#e94560',
        accentHover: '#ff6b81',
        accentSoft: 'rgba(233, 69, 96, 0.12)',
        accentGradient: 'linear-gradient(135deg, #e94560 0%, #ff6b81 100%)',
        headerGradient: 'linear-gradient(120deg, rgba(233, 69, 96, 0.35) 0%, rgba(120, 129, 198, 0.25) 100%)',
        textPrimary: '#f4f6fb',
        textSecondary: '#bac3d4',
        textMuted: '#8d96a7',
        shadow: '0 30px 60px rgba(8, 12, 24, 0.55)',
        successGradient: 'linear-gradient(135deg, #4CAF50, #3f9d4a)',
        warningGradient: 'linear-gradient(135deg, #ffa000, #f57c00)',
        dangerGradient: 'linear-gradient(135deg, #f44336, #d32f2f)',
        infoGradient: 'linear-gradient(135deg, #29b6f6, #4285f4)',
        neutralGradient: 'linear-gradient(135deg, #2b3243, #232a39)',
        inputBackground: 'rgba(16, 21, 32, 0.85)',
        inputBorder: '#323b4d',
        logBackground: 'rgba(13, 18, 27, 0.85)'
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
        debug(message, data) { this.log('DEBUG', message, data); }

        setEnabled(enabled) {
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
            this.challengeHandler = null;
            this.cloudflareBypassMode = false;
            this.cloudflareNotified = false;
        }

        updateSettings() {
            this.baseDelay = settingsManager.get('baseDelay');
            this.maxRetries = settingsManager.get('maxRetries');
            this.batchSize = settingsManager.get('batchSize');
        }

        setChallengeHandler(handler) {
            this.challengeHandler = handler;
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
        }

        notifyChallenge() {
            if (this.challengeHandler && !this.cloudflareNotified) {
                try {
                    this.challengeHandler();
                } catch (error) {
                    console.warn('Cloudflare challenge handler error', error);
                }
                this.cloudflareNotified = true;
            }
        }

        detectCloudflare(html) {
            if (!html) return false;
            const lower = html.toLowerCase();
            return lower.includes('cf-browser-verification') ||
                lower.includes('cf-chl-bypass') ||
                lower.includes('/cdn-cgi/challenge-platform/') ||
                lower.includes('checking if the site connection is secure') ||
                lower.includes('attention required') ||
                lower.includes('just a moment...');
        }

        shouldFallbackToBrowser(error) {
            if (!error) return false;
            if (error.isCloudflare) return true;
            if (error.status && [403, 429, 503].includes(error.status)) return true;
            const message = (error.message || '').toLowerCase();
            return message.includes('cloudflare') || message.includes('clearance') || message.includes('/cdn-cgi/');
        }

        async performGMRequest(url) {
            return new Promise((resolve, reject) => {
                const request = GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    timeout: 30000,
                    headers: {
                        'User-Agent': navigator.userAgent,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': navigator.language || 'en-US,en;q=0.9',
                        'Referer': window.location.href
                    },
                    overrideMimeType: 'text/html; charset=utf-8',
                    anonymous: false,
                    onload: (response) => {
                        this.activeRequests.delete(request);
                        if (response.status === 200) {
                            resolve(response.responseText);
                        } else {
                            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                            error.status = response.status;
                            reject(error);
                        }
                    },
                    onerror: (error) => {
                        this.activeRequests.delete(request);
                        const err = new Error(`Network error: ${error?.error || 'unknown'}`);
                        reject(err);
                    },
                    ontimeout: () => {
                        this.activeRequests.delete(request);
                        const err = new Error('Request timeout');
                        err.status = 408;
                        reject(err);
                    }
                });

                this.activeRequests.add(request);
            });
        }

        async performBrowserFetch(url) {
            const controller = new AbortController();
            this.activeRequests.add(controller);
            try {
                const response = await fetch(url, {
                    credentials: 'include',
                    mode: 'cors',
                    signal: controller.signal,
                    headers: {
                        'User-Agent': navigator.userAgent,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': navigator.language || 'en-US,en;q=0.9',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    },
                    referrer: window.location.href,
                    referrerPolicy: 'strict-origin-when-cross-origin'
                });

                this.activeRequests.delete(controller);

                if (!response.ok) {
                    const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                    error.status = response.status;
                    throw error;
                }

                return await response.text();
            } catch (error) {
                this.activeRequests.delete(controller);
                if (error.name === 'AbortError') {
                    const abortError = new Error('Request cancelled');
                    abortError.isCancelled = true;
                    throw abortError;
                }
                throw error;
            }
        }

        async fetchWithRetry(url, retries = 0, useFallback = this.cloudflareBypassMode) {
            if (this.isCancelled) {
                throw new Error('Download cancelled by user');
            }

            try {
                logger.info(`Fetching chapter: ${url} (attempt ${retries + 1}${useFallback ? ' • fallback' : ''})`);
                const html = useFallback ? await this.performBrowserFetch(url) : await this.performGMRequest(url);

                if (this.detectCloudflare(html)) {
                    const challengeError = new Error('Cloudflare challenge detected');
                    challengeError.isCloudflare = true;
                    challengeError.status = 403;
                    challengeError.usedFallback = useFallback;
                    throw challengeError;
                }

                return html;
            } catch (error) {
                if (error?.isCancelled || this.isCancelled) {
                    throw error;
                }

                logger.error(`Failed to fetch ${url}`, {
                    error: error.message,
                    attempt: retries + 1,
                    fallback: useFallback
                });

                if (!useFallback && this.shouldFallbackToBrowser(error)) {
                    logger.warn('Cloudflare protection detected, switching to compatibility mode', { url });
                    this.cloudflareBypassMode = true;
                    this.notifyChallenge();
                    return this.fetchWithRetry(url, retries, true);
                }

                if (useFallback && error.isCloudflare) {
                    error.code = 'CLOUDFLARE_BLOCKED';
                }

                if (retries < this.maxRetries) {
                    const delay = this.baseDelay * Math.pow(1.5, retries);
                    logger.info(`Retrying in ${delay}ms...`);
                    await sleep(delay);
                    return this.fetchWithRetry(url, retries + 1, useFallback);
                }

                throw error;
            }
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

            return { results, failed, cancelled: this.isCancelled };
        }
    }

    // ================== DRAG HANDLER ==================
    class DragHandler {
        constructor(element, handleElement) {
            this.element = element;
            this.handle = handleElement;
            this.isDragging = false;
            this.offset = { x: 0, y: 0 };
            this.margin = 16;
            this.needsEnsureVisible = false;

            this.onMouseDownHandler = this.onMouseDown.bind(this);
            this.onMouseMoveHandler = this.onMouseMove.bind(this);
            this.onMouseUpHandler = this.onMouseUp.bind(this);
            this.onResizeHandler = this.onResize.bind(this);

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
            window.addEventListener('resize', this.onResizeHandler, { passive: true });
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

            const maxX = Math.max(this.margin, window.innerWidth - this.element.offsetWidth - this.margin);
            const maxY = Math.max(this.margin, window.innerHeight - this.element.offsetHeight - this.margin);

            const boundedX = Math.min(Math.max(x, this.margin), maxX);
            const boundedY = Math.min(Math.max(y, this.margin), maxY);

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
            this.keepInViewport();
        }

        onResize() {
            if (!this.element) {
                return;
            }

            if (this.element.offsetParent) {
                this.keepInViewport();
            } else {
                this.needsEnsureVisible = true;
            }
        }

        keepInViewport() {
            if (!this.element) {
                return;
            }

            const rect = this.element.getBoundingClientRect();
            const width = rect.width || this.element.offsetWidth;
            const height = rect.height || this.element.offsetHeight;

            let left = rect.left;
            let top = rect.top;

            if (this.element.style.left) {
                const parsedLeft = parseFloat(this.element.style.left);
                if (!Number.isNaN(parsedLeft)) {
                    left = parsedLeft;
                }
            } else if (this.element.style.right && this.element.style.right !== 'auto') {
                const parsedRight = parseFloat(this.element.style.right);
                if (!Number.isNaN(parsedRight)) {
                    left = window.innerWidth - width - parsedRight;
                }
            }

            if (this.element.style.top) {
                const parsedTop = parseFloat(this.element.style.top);
                if (!Number.isNaN(parsedTop)) {
                    top = parsedTop;
                }
            }

            const maxLeft = Math.max(this.margin, window.innerWidth - width - this.margin);
            const maxTop = Math.max(this.margin, window.innerHeight - height - this.margin);

            const clampedLeft = Math.min(Math.max(left, this.margin), maxLeft);
            const clampedTop = Math.min(Math.max(top, this.margin), maxTop);

            this.element.style.left = `${clampedLeft}px`;
            this.element.style.top = `${clampedTop}px`;
            this.element.style.right = 'auto';
            this.needsEnsureVisible = false;
        }

        ensureVisible(force = false) {
            if (force) {
                this.keepInViewport();
                return;
            }

            if (this.needsEnsureVisible) {
                this.keepInViewport();
            }
        }

        destroy() {
            if (!this.handle) {
                return;
            }

            this.handle.removeEventListener('mousedown', this.onMouseDownHandler);
            document.removeEventListener('mousemove', this.onMouseMoveHandler);
            document.removeEventListener('mouseup', this.onMouseUpHandler);
            window.removeEventListener('resize', this.onResizeHandler);
            this.isDragging = false;
        }
    }



    // ================== UI CONTROLLER ==================
    class UIController {
        constructor() {
            this.chapters = [];
            this.extractor = new ChapterExtractor();
            this.extractor.setChallengeHandler(() => this.handleCloudflareChallenge());
            this.isProcessing = false;
            this.isVisible = false;
            this.dragHandler = null;
            this.currentView = 'main';
            this.selectedRange = null; // {from: number, to: number} or null for all
            this.hasShownCloudflareNotice = false;
        }

        init() {
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

        createToggleButton() {
            const defaultShadow = '0 24px 48px rgba(233, 69, 96, 0.42)';
            const hoverShadow = '0 28px 56px rgba(233, 69, 96, 0.55)';
            const activeShadow = '0 30px 60px rgba(233, 69, 96, 0.62)';

            const toggleBtn = createElementFromHTML(`
                <button id="novelbin-toggle" style="
                    position: fixed;
                    top: 24px;
                    right: 24px;
                    z-index: 10001;
                    background: ${THEME.accentGradient};
                    color: ${THEME.textPrimary};
                    border: 1px solid ${THEME.border};
                    border-radius: 20px;
                    width: 64px;
                    height: 64px;
                    cursor: pointer;
                    box-shadow: ${defaultShadow};
                    font-size: 26px;
                    transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    backdrop-filter: blur(12px);
                " title="Toggle Chapter Aggregator" aria-label="Toggle chapter aggregator" aria-pressed="false">
                    <span aria-hidden="true">${ICONS.aggregator}</span>
                </button>
            `);

            toggleBtn.dataset.defaultShadow = defaultShadow;
            toggleBtn.dataset.activeShadow = activeShadow;

            toggleBtn.addEventListener('mouseenter', () => {
                toggleBtn.style.transform = 'translateY(-2px) scale(1.05)';
                toggleBtn.style.boxShadow = hoverShadow;
            });

            toggleBtn.addEventListener('mouseleave', () => {
                toggleBtn.style.transform = this.isVisible ? 'scale(1.03)' : 'scale(1)';
                toggleBtn.style.boxShadow = this.isVisible ? activeShadow : defaultShadow;
            });

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
                    ui.style.display = 'block';
                    this.isVisible = true;
                    if (this.dragHandler) {
                        this.dragHandler.ensureVisible(true);
                    }
                }

                this.updateToggleButtonState();
            } else if (this.isValidPage()) {
                this.createUI();
            } else {
                this.isVisible = false;
                this.updateToggleButtonState();
            }
        }



        updateToggleButtonState() {

            const toggleBtn = document.getElementById('novelbin-toggle');



            if (!toggleBtn) {

                return;

            }



            toggleBtn.setAttribute('aria-pressed', this.isVisible ? 'true' : 'false');

            toggleBtn.classList.toggle('active', this.isVisible);

            const defaultShadow = toggleBtn.dataset.defaultShadow || '0 24px 48px rgba(233, 69, 96, 0.42)';
            const activeShadow = toggleBtn.dataset.activeShadow || '0 30px 60px rgba(233, 69, 96, 0.62)';

            if (this.isVisible) {
                toggleBtn.style.transform = 'scale(1.03)';
                toggleBtn.style.boxShadow = activeShadow;
                toggleBtn.style.filter = 'saturate(1.1)';
            } else {
                toggleBtn.style.transform = 'scale(1)';
                toggleBtn.style.boxShadow = defaultShadow;
                toggleBtn.style.filter = 'saturate(1)';
            }

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

        handleCloudflareChallenge() {
            if (this.hasShownCloudflareNotice) {
                return;
            }

            this.hasShownCloudflareNotice = true;
            logger.warn('Cloudflare compatibility mode enabled');
            this.showNotification(`${ICONS.info} Cloudflare protection detected. Switched to compatibility mode. Downloads may take slightly longer.`, 'info');
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
            const theme = THEME;
            const colors = {
                success: theme.successGradient,
                info: theme.infoGradient,
                error: theme.dangerGradient
            };

            const notification = createElementFromHTML(`
                <div style="
                    position: fixed;
                    top: 110px;
                    right: 96px;
                    background: ${colors[type]};
                    color: ${theme.textPrimary};
                    padding: 14px 22px;
                    border-radius: 14px;
                    border: 1px solid ${theme.border};
                    box-shadow: 0 24px 50px rgba(8, 12, 24, 0.45);
                    z-index: 10002;
                    font-weight: 600;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    letter-spacing: 0.3px;
                    min-width: 240px;
                ">
                    ${message}
                </div>
            `);
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), type === 'error' ? 4000 : 2600);
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

        createSettingsModal() {
            const theme = THEME;
            return `
                <div id="settings-content" style="padding: 22px; background: ${theme.panel}; color: ${theme.textPrimary}; border-radius: 18px;">
                    <h3 style="margin: 0 0 20px 0; color: ${theme.accent}; font-size: 18px; letter-spacing: 0.5px;">⚙️ Settings</h3>

                    <div style="display: grid; gap: 15px;">
                        <div style="background: ${theme.panelElevated}; padding: 16px; border-radius: 12px; border: 1px solid ${theme.border}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);">
                            <label style="display: block; color: ${theme.textSecondary}; margin-bottom: 8px; font-weight: 600;">
                                📦 Batch Size (simultaneous downloads)
                            </label>
                            <input type="number" id="setting-batch-size" min="1" max="20" value="${settingsManager.get('batchSize')}" style="
                                width: 100%; padding: 10px; background: ${theme.inputBackground}; border: 1px solid ${theme.inputBorder};
                                border-radius: 10px; color: ${theme.textPrimary}; font-size: 14px; outline: none;
                            ">
                            <small style="color: ${theme.textMuted}; font-size: 12px;">Lower values are gentler on servers</small>
                        </div>

                        <div style="background: ${theme.panelElevated}; padding: 16px; border-radius: 12px; border: 1px solid ${theme.border}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);">
                            <label style="display: block; color: ${theme.textSecondary}; margin-bottom: 8px; font-weight: 600;">
                                ⏱️ Delay Between Requests (ms)
                            </label>
                            <input type="number" id="setting-base-delay" min="500" max="10000" step="500" value="${settingsManager.get('baseDelay')}" style="
                                width: 100%; padding: 10px; background: ${theme.inputBackground}; border: 1px solid ${theme.inputBorder};
                                border-radius: 10px; color: ${theme.textPrimary}; font-size: 14px; outline: none;
                            ">
                        </div>

                        <div style="background: ${theme.panelElevated}; padding: 16px; border-radius: 12px; border: 1px solid ${theme.border}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);">
                            <label style="display: block; color: ${theme.textSecondary}; margin-bottom: 8px; font-weight: 600;">
                                🔄 Max Retry Attempts
                            </label>
                            <input type="number" id="setting-max-retries" min="1" max="10" value="${settingsManager.get('maxRetries')}" style="
                                width: 100%; padding: 10px; background: ${theme.inputBackground}; border: 1px solid ${theme.inputBorder};
                                border-radius: 10px; color: ${theme.textPrimary}; font-size: 14px; outline: none;
                            ">
                        </div>

                        <div style="background: ${theme.panelElevated}; padding: 16px; border-radius: 12px; border: 1px solid ${theme.border}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);">
                            <label style="display: flex; align-items: center; color: ${theme.textSecondary}; font-weight: 600; cursor: pointer;">
                                <input type="checkbox" id="setting-enable-logging" ${settingsManager.get('enableLogging') ? 'checked' : ''} style="
                                    margin-right: 10px; transform: scale(1.2); accent-color: ${theme.accent};
                                ">
                                📝 Enable Detailed Logging
                            </label>
                        </div>

                        <div style="background: ${theme.panelElevated}; padding: 16px; border-radius: 12px; border: 1px solid ${theme.border}; box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);">
                            <label style="display: flex; align-items: center; color: ${theme.textSecondary}; font-weight: 600; cursor: pointer;">
                                <input type="checkbox" id="setting-compact-mode" ${settingsManager.get('compactMode') ? 'checked' : ''} style="
                                    margin-right: 10px; transform: scale(1.2); accent-color: ${theme.accent};
                                ">
                                📱 Compact Interface Mode
                            </label>
                        </div>
                    </div>

                    <div style="display: flex; gap: 12px; margin-top: 24px;">
                        <button id="save-settings" style="
                            flex: 1; padding: 12px; background: ${THEME.successGradient};
                            color: ${theme.textPrimary}; border: 1px solid rgba(76, 175, 80, 0.35); border-radius: 12px; cursor: pointer; font-weight: 600;
                            transition: transform 0.2s ease, box-shadow 0.2s ease;
                        ">💾 Save Settings</button>
                        <button id="reset-settings" style="
                            flex: 1; padding: 12px; background: ${THEME.dangerGradient};
                            color: ${theme.textPrimary}; border: 1px solid rgba(244, 67, 54, 0.45); border-radius: 12px; cursor: pointer; font-weight: 600;
                            transition: transform 0.2s ease, box-shadow 0.2s ease;
                        ">🔄 Reset Defaults</button>
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

            const isCompact = settingsManager.get('compactMode');
            const theme = THEME;
            const maxHeight = Math.min(window.innerHeight * 0.82, isCompact ? 540 : 640);

            const ui = createElementFromHTML(`
                <div id="novelbin-aggregator" style="
                    position: fixed;
                    top: 72px;
                    right: 30px;
                    width: ${isCompact ? '320px' : '390px'};
                    max-height: ${maxHeight}px;
                    background: linear-gradient(160deg, rgba(21, 26, 36, 0.97) 0%, rgba(16, 21, 30, 0.97) 100%);
                    border: 1px solid ${theme.border};
                    border-radius: 22px;
                    box-shadow: ${theme.shadow};
                    z-index: 10000;
                    font-family: 'Segoe UI', 'Roboto', system-ui, sans-serif;
                    font-size: ${isCompact ? '13px' : '14px'};
                    color: ${theme.textPrimary};
                    overflow: hidden;
                    transition: transform 0.25s ease, opacity 0.25s ease;
                    display: flex;
                    flex-direction: column;
                    backdrop-filter: blur(18px);
                ">
                    <div id="aggregator-header" style="
                        background: ${theme.headerGradient};
                        color: ${theme.textPrimary};
                        padding: ${isCompact ? '14px 18px' : '18px 24px'};
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        cursor: move;
                        user-select: none;
                        flex-shrink: 0;
                        border-bottom: 1px solid ${theme.border};
                        gap: 12px;
                    ">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span style="font-size: ${isCompact ? '20px' : '22px'};">📚</span>
                            <div>
                                <h3 style="margin: 0; font-size: ${isCompact ? '15px' : '17px'}; font-weight: 600; letter-spacing: 0.4px;">Chapter Aggregator v2.5</h3>
                                <small style="color: ${theme.textMuted}; font-size: ${isCompact ? '11px' : '12px'};">Streamlined for NovelBin</small>
                            </div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button id="settings-btn" style="
                                background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12); color: ${theme.textPrimary}; cursor: pointer;
                                font-size: 15px; width: 32px; height: 32px; border-radius: 10px;
                                display: flex; align-items: center; justify-content: center; transition: transform 0.2s ease, background 0.2s ease;
                                backdrop-filter: blur(8px);
                            " title="Settings">⚙️</button>
                            <button id="refresh-chapters" style="
                                background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12); color: ${theme.textPrimary}; cursor: pointer;
                                font-size: 15px; width: 32px; height: 32px; border-radius: 10px;
                                display: flex; align-items: center; justify-content: center; transition: transform 0.2s ease, background 0.2s ease;
                                backdrop-filter: blur(8px);
                            " title="Refresh chapter list">🔄</button>
                            <button id="minimize-aggregator" style="
                                background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12); color: ${theme.textPrimary}; cursor: pointer;
                                font-size: 18px; width: 32px; height: 32px; border-radius: 10px;
                                display: flex; align-items: center; justify-content: center; transition: transform 0.2s ease, background 0.2s ease;
                                backdrop-filter: blur(8px);
                            " title="Minimize">−</button>
                        </div>
                    </div>

                    <div id="main-content" style="
                        padding: ${isCompact ? '16px' : '22px'};
                        overflow-y: auto;
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        gap: ${isCompact ? '12px' : '18px'};
                    ">
                        <div id="main-view">
                            <!-- Chapter Count Display -->
                            <div style="
                                font-weight: 600; color: ${theme.textPrimary}; text-align: center;
                                background: ${theme.accentSoft}; padding: ${isCompact ? '14px' : '18px'};
                                border-radius: 16px; border: 1px solid ${theme.borderAccent};
                                margin-bottom: ${isCompact ? '14px' : '18px'}; font-size: ${isCompact ? '16px' : '18px'};
                                box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
                            ">
                                <div style="font-size: 26px; margin-bottom: 8px;">📖</div>
                                <div id="chapter-count">${this.chapters.length} Chapters Detected</div>
                                <div style="font-size: ${isCompact ? '11px' : '12px'}; color: ${theme.textMuted}; margin-top: 8px;" id="selection-info">
                                    All chapters will be downloaded
                                </div>
                            </div>

                            <!-- Range Selection -->
                            <div style="
                                background: ${theme.panelElevated}; border: 1px solid ${theme.border};
                                border-radius: 16px; padding: ${isCompact ? '14px' : '18px'}; margin-bottom: ${isCompact ? '14px' : '18px'};
                                box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);
                            ">
                                <div style="color: ${theme.textSecondary}; font-weight: 600; margin-bottom: 12px; font-size: ${isCompact ? '13px' : '14px'};">
                                    📍 Range Selection (Optional)
                                </div>
                                <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 12px;">
                                    <input type="number" id="range-from" placeholder="From" min="1" max="${this.chapters.length}" style="
                                        flex: 1; padding: 10px; background: ${theme.inputBackground}; border: 1px solid ${theme.inputBorder};
                                        border-radius: 10px; color: ${theme.textPrimary}; font-size: ${isCompact ? '12px' : '13px'};
                                        outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;
                                    ">
                                    <span style="color: ${theme.textMuted}; font-size: ${isCompact ? '12px' : '13px'};">to</span>
                                    <input type="number" id="range-to" placeholder="To" min="1" max="${this.chapters.length}" style="
                                        flex: 1; padding: 10px; background: ${theme.inputBackground}; border: 1px solid ${theme.inputBorder};
                                        border-radius: 10px; color: ${theme.textPrimary}; font-size: ${isCompact ? '12px' : '13px'};
                                        outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;
                                    ">
                                </div>
                                <div style="display: flex; gap: 10px;">
                                    <button id="select-range" style="
                                        flex: 1; padding: 10px 14px; background: ${THEME.infoGradient}; color: ${theme.textPrimary};
                                        border: 1px solid rgba(41, 182, 246, 0.35); border-radius: 12px; cursor: pointer; font-size: ${isCompact ? '12px' : '13px'}; font-weight: 600;
                                        transition: transform 0.2s ease, box-shadow 0.2s ease;
                                    ">📋 Select Range</button>
                                    <button id="select-all" style="
                                        flex: 1; padding: 10px 14px; background: ${THEME.successGradient}; color: ${theme.textPrimary};
                                        border: 1px solid rgba(76, 175, 80, 0.35); border-radius: 12px; cursor: pointer; font-size: ${isCompact ? '12px' : '13px'}; font-weight: 600;
                                        transition: transform 0.2s ease, box-shadow 0.2s ease;
                                    ">📚 Select All</button>
                                </div>
                            </div>

                            <!-- Progress -->
                            <div style="
                                background: ${theme.panelElevated}; border: 1px solid ${theme.border};
                                border-radius: 16px; padding: ${isCompact ? '14px' : '18px'}; margin-bottom: ${isCompact ? '14px' : '18px'};
                                box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);
                            ">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                    <span id="progress-text" style="color: ${theme.textSecondary}; font-weight: 500; font-size: ${isCompact ? '12px' : '13px'};">Ready to download</span>
                                    <span id="status-badge" style="
                                        background: ${THEME.infoGradient}; color: ${theme.textPrimary};
                                        padding: 4px 12px; border-radius: 999px; font-size: ${isCompact ? '11px' : '12px'}; font-weight: 600; letter-spacing: 0.4px;
                                    ">Ready</span>
                                </div>
                                <div style="width: 100%; height: 10px; background: ${theme.highlight}; border: 1px solid ${theme.border}; border-radius: 999px; overflow: hidden;">
                                    <div id="progress-bar" style="
                                        width: 0%; height: 100%; background: ${THEME.successGradient};
                                        transition: width 0.35s ease; border-radius: 999px;
                                    "></div>
                                </div>
                            </div>

                            <!-- Action Buttons -->
                            <div style="display: flex; gap: 12px; margin-bottom: ${isCompact ? '12px' : '16px'};">
                                <button id="download-chapters" style="
                                    flex: 1; padding: ${isCompact ? '12px' : '16px'};
                                    background: ${theme.accentGradient}; color: ${theme.textPrimary}; border: 1px solid ${theme.borderAccent};
                                    border-radius: 14px; cursor: pointer; font-weight: 600; font-size: ${isCompact ? '14px' : '16px'};
                                    transition: transform 0.2s ease, box-shadow 0.2s ease; box-shadow: 0 24px 48px rgba(233, 69, 96, 0.25);
                                ">${ICONS.download} Download All Chapters</button>
                                <button id="cancel-download" style="
                                    padding: ${isCompact ? '12px' : '16px'}; background: ${THEME.dangerGradient}; color: ${theme.textPrimary};
                                    border: 1px solid rgba(244, 67, 54, 0.45); border-radius: 14px; cursor: pointer; font-weight: 600;
                                    font-size: ${isCompact ? '14px' : '16px'}; display: none; transition: transform 0.2s ease, box-shadow 0.2s ease;
                                    box-shadow: 0 18px 40px rgba(244, 67, 54, 0.25);
                                ">${ICONS.cancel} Cancel</button>
                            </div>

                            <!-- Utility Buttons -->
                            <div style="display: flex; gap: 10px;">
                                <button id="export-logs" style="
                                    flex: 1; padding: ${isCompact ? '10px' : '12px'}; background: ${THEME.warningGradient};
                                    color: ${theme.textPrimary}; border: 1px solid rgba(255, 152, 0, 0.4); border-radius: 12px; cursor: pointer;
                                    font-size: ${isCompact ? '12px' : '13px'}; font-weight: 600;
                                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                                ">${ICONS.export} Export Logs</button>
                                <button id="toggle-logs" style="
                                    flex: 1; padding: ${isCompact ? '10px' : '12px'}; background: ${THEME.neutralGradient};
                                    color: ${theme.textPrimary}; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; cursor: pointer;
                                    font-size: ${isCompact ? '12px' : '13px'}; font-weight: 600;
                                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                                " aria-expanded="false">${ICONS.select} Show Logs</button>
                            </div>

                            <!-- Log Container -->
                            <div id="log-container" style="
                                margin-top: 16px; height: 130px; overflow-y: auto; background: ${theme.logBackground};
                                border: 1px solid ${theme.border}; border-radius: 12px; padding: 12px;
                                font-family: 'Fira Code', 'Consolas', 'Monaco', monospace; font-size: ${isCompact ? '10px' : '11px'};
                                white-space: pre-wrap; color: ${theme.textSecondary}; display: none;
                                box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);
                            "></div>
                        </div>

                        <!-- Settings View -->
                        <div id="settings-view" style="display: none;">
                            ${this.createSettingsModal()}
                        </div>
                    </div>
                </div>
            `);

            document.body.appendChild(ui);
            this.isVisible = true;

            const header = ui.querySelector('#aggregator-header');
            this.dragHandler = new DragHandler(ui, header);
            this.dragHandler.ensureVisible(true);

            this.bindUIEvents();
            this.updateUI();
            this.updateToggleButtonState();
        }

        bindUIEvents() {
            // Header buttons
            document.getElementById('minimize-aggregator').addEventListener('click', () => {
                this.toggleUI();
            });

            document.getElementById('settings-btn').addEventListener('click', (e) => {
                e.target.style.transform = 'scale(0.9)';
                setTimeout(() => e.target.style.transform = 'scale(1)', 100);
                this.switchView(this.currentView === 'settings' ? 'main' : 'settings');
            });

            document.getElementById('refresh-chapters').addEventListener('click', (e) => {
                e.target.style.transform = 'rotate(360deg)';
                setTimeout(() => e.target.style.transform = 'rotate(0deg)', 500);
                this.refreshChapterList();
            });

            // Settings events
            const saveBtn = document.getElementById('save-settings');
            const resetBtn = document.getElementById('reset-settings');

            if (saveBtn) {
                saveBtn.addEventListener('click', (e) => {
                    e.target.style.transform = 'scale(0.95)';
                    setTimeout(() => e.target.style.transform = 'scale(1)', 100);
                    this.saveSettings();
                });
            }

            if (resetBtn) {
                resetBtn.addEventListener('click', (e) => {
                    e.target.style.transform = 'scale(0.95)';
                    setTimeout(() => e.target.style.transform = 'scale(1)', 100);
                    if (confirm('Reset all settings to defaults?')) {
                        this.resetSettings();
                    }
                });
            }

            // Range selection events
            document.getElementById('select-range').addEventListener('click', (e) => {
                e.target.style.transform = 'scale(0.95)';
                setTimeout(() => e.target.style.transform = 'scale(1)', 100);
                this.handleRangeSelection();
            });

            document.getElementById('select-all').addEventListener('click', (e) => {
                e.target.style.transform = 'scale(0.95)';
                setTimeout(() => e.target.style.transform = 'scale(1)', 100);
                this.selectAll();
            });

            // Range inputs enter key support
            document.getElementById('range-from').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleRangeSelection();
            });

            document.getElementById('range-to').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.handleRangeSelection();
            });

            // Download controls
            document.getElementById('download-chapters').addEventListener('click', (e) => {
                e.target.style.transform = 'scale(0.95)';
                setTimeout(() => e.target.style.transform = 'scale(1)', 100);
                this.startDownload();
            });

            document.getElementById('cancel-download').addEventListener('click', (e) => {
                e.target.style.transform = 'scale(0.95)';
                setTimeout(() => e.target.style.transform = 'scale(1)', 100);
                this.cancelDownload();
            });

            // Utility buttons
            document.getElementById('export-logs').addEventListener('click', (e) => {

                e.target.style.transform = 'scale(0.95)';

                setTimeout(() => e.target.style.transform = 'scale(1)', 100);



                if (!logger.hasLogs()) {

                    this.showNotification(`${NOTIFICATION_ICONS.info} No logs to export yet.`, 'info');

                    return;

                }



                logger.exportLogs();

                this.showNotification(`${ICONS.export} Logs exported`, 'success');

            });



            document.getElementById('toggle-logs').addEventListener('click', (e) => {
                e.target.style.transform = 'scale(0.95)';
                setTimeout(() => e.target.style.transform = 'scale(1)', 100);
                this.toggleLogs();
            });
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

            if (view === 'settings') {
                mainView.style.display = 'none';
                settingsView.style.display = 'block';
                this.currentView = 'settings';
            } else {
                mainView.style.display = 'block';
                settingsView.style.display = 'none';
                this.currentView = 'main';
            }
        }

        updateUI() {
            const downloadBtn = document.getElementById('download-chapters');
            const cancelBtn = document.getElementById('cancel-download');
            const statusBadge = document.getElementById('status-badge');
            const chapterCount = document.getElementById('chapter-count');
            const selectionInfo = document.getElementById('selection-info');
            const theme = THEME;
            const rangeFrom = document.getElementById('range-from');
            const rangeTo = document.getElementById('range-to');

            if (!downloadBtn || !cancelBtn || !statusBadge || !chapterCount || !selectionInfo) return;

            chapterCount.textContent = `${this.chapters.length} Chapters Detected`;

            // Update range input max values
            if (rangeFrom && rangeTo) {
                rangeFrom.max = this.chapters.length;
                rangeTo.max = this.chapters.length;
                rangeFrom.placeholder = `1-${this.chapters.length}`;
                rangeTo.placeholder = `1-${this.chapters.length}`;
            }

            // Update selection info and button text
            if (this.selectedRange) {
                const { from, to } = this.selectedRange;
                const count = to - from + 1;
                selectionInfo.textContent = `Selected: chapters ${from} to ${to} (${count} chapters)`;
                downloadBtn.textContent = `${ICONS.download} Download Selected (${count})`;
                logger.info(`UI updated for range selection: ${from}-${to} (${count} chapters)`);
            } else {
                selectionInfo.textContent = 'All chapters will be downloaded';
                downloadBtn.textContent = `${ICONS.download} Download All Chapters`;
                logger.info('UI updated for all chapters selection');
            }

            downloadBtn.disabled = this.chapters.length === 0 || this.isProcessing;

            if (this.isProcessing) {
                downloadBtn.style.display = 'none';
                cancelBtn.style.display = 'block';
                statusBadge.textContent = 'Processing';
                statusBadge.style.background = theme.warningGradient;
            } else {
                downloadBtn.style.display = 'block';
                cancelBtn.style.display = 'none';
                statusBadge.textContent = 'Ready';
                statusBadge.style.background = theme.infoGradient;

                if (this.chapters.length > 0) {
                    downloadBtn.style.background = theme.accentGradient;
                    downloadBtn.style.border = `1px solid ${theme.borderAccent}`;
                    downloadBtn.style.cursor = 'pointer';
                } else {
                    downloadBtn.style.background = theme.neutralGradient;
                    downloadBtn.style.border = `1px solid ${theme.border}`;
                    downloadBtn.style.cursor = 'not-allowed';
                }
            }
        }

        updateProgress(progress) {
            const progressBar = document.getElementById('progress-bar');
            const progressText = document.getElementById('progress-text');
            const statusBadge = document.getElementById('status-badge');
            const theme = THEME;

            if (!progressBar || !progressText || !statusBadge) return;

            progressBar.style.width = `${progress.percentage}%`;

            if (progress.cancelled) {
                progressText.textContent = 'Download cancelled';
                statusBadge.textContent = 'Cancelled';
                progressBar.style.background = theme.dangerGradient;
                statusBadge.style.background = theme.dangerGradient;
            } else {
                progressText.textContent = `Processing ${progress.current}/${progress.total} (${progress.percentage}%)`;
                statusBadge.textContent = `${progress.current}/${progress.total}`;

                if (progress.success) {
                    progressBar.style.background = theme.successGradient;
                } else {
                    progressBar.style.background = theme.dangerGradient;
                }

                if (progress.current === progress.total) {
                    progressText.textContent = 'Processing complete!';
                    statusBadge.textContent = 'Complete';
                    statusBadge.style.background = theme.successGradient;
                }
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
                const { results, failed, cancelled } = await this.extractor.processChapters(
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
                }

            } catch (error) {
                logger.error('Download failed', { error: error.message });
                if (error && error.code === 'CLOUDFLARE_BLOCKED') {
                    this.showNotification('Cloudflare challenge is blocking downloads. Please open a chapter manually and retry.', 'error');
                } else {
                    this.showNotification('Download failed. Check logs.', 'error');
                }
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
            📊 ${chapters.length} chapters • 🚀 NovelBin Aggregator v2.5<br>
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
            <small>Generated by NovelBin Chapter Aggregator v2.5</small>
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



            const isHidden = logContainer.style.display === 'none';



            if (isHidden) {

                logContainer.style.display = 'block';

                const message = !logger.enabled && !logger.hasLogs()
                    ? 'Logging is currently disabled.'
                    : logger.getLogs();
                logContainer.textContent = message;

                logContainer.classList.toggle('empty', !logger.hasLogs());

                toggleBtn.textContent = `${ICONS.select} Hide Logs`;

                toggleBtn.setAttribute('aria-expanded', 'true');

                logContainer.scrollTop = logContainer.scrollHeight;

            } else {

                logContainer.style.display = 'none';

                toggleBtn.textContent = `${ICONS.select} Show Logs`;

                toggleBtn.setAttribute('aria-expanded', 'false');

            }

        }



        destroy() {
            if (this.dragHandler) {
                this.dragHandler.destroy();
            }

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
