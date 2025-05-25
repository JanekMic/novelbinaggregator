// ==UserScript==
// @name         NovelBin.me Chapter Aggregator Simplified
// @namespace    http://tampermonkey.net/
// @version      2.4.0
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

        getLogs() {
            return this.logs.map(log =>
                `[${log.timestamp}] [${log.level}] ${log.message}${log.data ? '\n' + log.data : ''}`
            ).join('\n');
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
        }

        async fetchWithRetry(url, retries = 0) {
            if (this.isCancelled) {
                throw new Error('Download cancelled by user');
            }

            return new Promise((resolve, reject) => {
                logger.info(`Fetching chapter: ${url} (attempt ${retries + 1})`);

                const request = GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 30000,
                    onload: (response) => {
                        this.activeRequests.delete(request);
                        if (this.isCancelled) {
                            reject(new Error('Download cancelled by user'));
                            return;
                        }

                        if (response.status === 200) {
                            resolve(response.responseText);
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
            }).catch(async (error) => {
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
            });
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

            this.init();
        }

        init() {
            this.handle.style.cursor = 'move';
            this.handle.addEventListener('mousedown', this.onMouseDown.bind(this));
            document.addEventListener('mousemove', this.onMouseMove.bind(this));
            document.addEventListener('mouseup', this.onMouseUp.bind(this));
        }

        onMouseDown(e) {
            this.isDragging = true;
            const rect = this.element.getBoundingClientRect();
            this.offset.x = e.clientX - rect.left;
            this.offset.y = e.clientY - rect.top;
            this.element.style.transition = 'none';
        }

        onMouseMove(e) {
            if (!this.isDragging) return;

            const x = e.clientX - this.offset.x;
            const y = e.clientY - this.offset.y;

            const maxX = window.innerWidth - this.element.offsetWidth;
            const maxY = window.innerHeight - this.element.offsetHeight;

            const boundedX = Math.max(0, Math.min(x, maxX));
            const boundedY = Math.max(0, Math.min(y, maxY));

            this.element.style.left = boundedX + 'px';
            this.element.style.top = boundedY + 'px';
            this.element.style.right = 'auto';
        }

        onMouseUp() {
            this.isDragging = false;
            this.element.style.transition = '';
        }

        destroy() {
            document.removeEventListener('mousemove', this.onMouseMove);
            document.removeEventListener('mouseup', this.onMouseUp);
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
        }

        init() {
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

        createToggleButton() {
            const toggleBtn = createElementFromHTML(`
                <button id="novelbin-toggle" style="
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 10001;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    border-radius: 50%;
                    width: 60px;
                    height: 60px;
                    cursor: pointer;
                    box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
                    font-size: 24px;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                " title="Toggle Chapter Aggregator">
                    📚
                </button>
            `);

            toggleBtn.addEventListener('mouseenter', () => {
                toggleBtn.style.transform = 'scale(1.1)';
                toggleBtn.style.boxShadow = '0 6px 25px rgba(102, 126, 234, 0.6)';
            });

            toggleBtn.addEventListener('mouseleave', () => {
                toggleBtn.style.transform = 'scale(1)';
                toggleBtn.style.boxShadow = '0 4px 20px rgba(102, 126, 234, 0.4)';
            });

            toggleBtn.addEventListener('click', () => {
                this.toggleUI();
            });

            document.body.appendChild(toggleBtn);
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
                }
            } else if (this.isValidPage()) {
                this.createUI();
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
                this.showNotification(`📱 Found ${newCount} chapters (${newCount > oldCount ? '+' + (newCount - oldCount) : newCount - oldCount} from before)`, 'success');
            } else {
                this.showNotification('📋 Chapter count unchanged', 'info');
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
            this.showNotification(`📋 Selected chapters ${fromValue} to ${toValue} (${count} chapters)`, 'success');
        }

        selectAll() {
            this.selectedRange = null;
            
            // Clear range inputs
            const fromInput = document.getElementById('range-from');
            const toInput = document.getElementById('range-to');
            if (fromInput) fromInput.value = '';
            if (toInput) toInput.value = '';
            
            this.updateUI();
            this.showNotification('📚 Selected all chapters', 'success');
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
                success: 'linear-gradient(135deg, #4CAF50, #45a049)',
                info: 'linear-gradient(135deg, #FF9800, #F57400)',
                error: 'linear-gradient(135deg, #f44336, #d32f2f)'
            };

            const notification = createElementFromHTML(`
                <div style="
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: ${colors[type]};
                    color: white;
                    padding: 15px 25px;
                    border-radius: 10px;
                    box-shadow: 0 5px 20px rgba(0,0,0,0.3);
                    z-index: 10002;
                    font-weight: 600;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                ">
                    ${message}
                </div>
            `);
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), type === 'error' ? 4000 : 2500);
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
            return `
                <div id="settings-content" style="padding: 20px;">
                    <h3 style="margin: 0 0 20px 0; color: #e94560; font-size: 18px;">⚙️ Settings</h3>
                    
                    <div style="display: grid; gap: 15px;">
                        <div style="background: rgba(102, 126, 234, 0.1); padding: 15px; border-radius: 8px; border: 1px solid rgba(102, 126, 234, 0.3);">
                            <label style="display: block; color: #e0e0e0; margin-bottom: 8px; font-weight: 600;">
                                📦 Batch Size (simultaneous downloads)
                            </label>
                            <input type="number" id="setting-batch-size" min="1" max="20" value="${settingsManager.get('batchSize')}" style="
                                width: 100%; padding: 8px; background: rgba(0,0,0,0.3); border: 1px solid #0f3460;
                                border-radius: 4px; color: #e0e0e0; font-size: 14px;
                            ">
                            <small style="color: #b0b0b0; font-size: 12px;">Lower values are gentler on servers</small>
                        </div>

                        <div style="background: rgba(102, 126, 234, 0.1); padding: 15px; border-radius: 8px; border: 1px solid rgba(102, 126, 234, 0.3);">
                            <label style="display: block; color: #e0e0e0; margin-bottom: 8px; font-weight: 600;">
                                ⏱️ Delay Between Requests (ms)
                            </label>
                            <input type="number" id="setting-base-delay" min="500" max="10000" step="500" value="${settingsManager.get('baseDelay')}" style="
                                width: 100%; padding: 8px; background: rgba(0,0,0,0.3); border: 1px solid #0f3460;
                                border-radius: 4px; color: #e0e0e0; font-size: 14px;
                            ">
                        </div>

                        <div style="background: rgba(102, 126, 234, 0.1); padding: 15px; border-radius: 8px; border: 1px solid rgba(102, 126, 234, 0.3);">
                            <label style="display: block; color: #e0e0e0; margin-bottom: 8px; font-weight: 600;">
                                🔄 Max Retry Attempts
                            </label>
                            <input type="number" id="setting-max-retries" min="1" max="10" value="${settingsManager.get('maxRetries')}" style="
                                width: 100%; padding: 8px; background: rgba(0,0,0,0.3); border: 1px solid #0f3460;
                                border-radius: 4px; color: #e0e0e0; font-size: 14px;
                            ">
                        </div>

                        <div style="background: rgba(102, 126, 234, 0.1); padding: 15px; border-radius: 8px; border: 1px solid rgba(102, 126, 234, 0.3);">
                            <label style="display: flex; align-items: center; color: #e0e0e0; font-weight: 600; cursor: pointer;">
                                <input type="checkbox" id="setting-enable-logging" ${settingsManager.get('enableLogging') ? 'checked' : ''} style="
                                    margin-right: 10px; transform: scale(1.2); accent-color: #667eea;
                                ">
                                📝 Enable Detailed Logging
                            </label>
                        </div>

                        <div style="background: rgba(102, 126, 234, 0.1); padding: 15px; border-radius: 8px; border: 1px solid rgba(102, 126, 234, 0.3);">
                            <label style="display: flex; align-items: center; color: #e0e0e0; font-weight: 600; cursor: pointer;">
                                <input type="checkbox" id="setting-compact-mode" ${settingsManager.get('compactMode') ? 'checked' : ''} style="
                                    margin-right: 10px; transform: scale(1.2); accent-color: #667eea;
                                ">
                                📱 Compact Interface Mode
                            </label>
                        </div>
                    </div>

                    <div style="display: flex; gap: 10px; margin-top: 20px;">
                        <button id="save-settings" style="
                            flex: 1; padding: 12px; background: linear-gradient(45deg, #4CAF50, #45a049);
                            color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;
                        ">💾 Save Settings</button>
                        <button id="reset-settings" style="
                            flex: 1; padding: 12px; background: linear-gradient(45deg, #f44336, #d32f2f);
                            color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;
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
            const maxHeight = Math.min(window.innerHeight * 0.8, 600);

            const ui = createElementFromHTML(`
                <div id="novelbin-aggregator" style="
                    position: fixed;
                    top: 50px;
                    right: 20px;
                    width: ${isCompact ? '320px' : '380px'};
                    max-height: ${maxHeight}px;
                    background: linear-gradient(145deg, #1a1a2e, #16213e);
                    border: 1px solid #0f3460;
                    border-radius: 15px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.6);
                    z-index: 10000;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    font-size: ${isCompact ? '13px' : '14px'};
                    color: #e94560;
                    overflow: hidden;
                    transition: all 0.3s ease;
                    display: flex;
                    flex-direction: column;
                ">
                    <div id="aggregator-header" style="
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        padding: ${isCompact ? '12px 15px' : '15px 20px'};
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        cursor: move;
                        user-select: none;
                        flex-shrink: 0;
                    ">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-size: ${isCompact ? '18px' : '20px'};">📚</span>
                            <h3 style="margin: 0; font-size: ${isCompact ? '14px' : '16px'}; font-weight: 600;">Chapter Aggregator v2.4</h3>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button id="settings-btn" style="
                                background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer;
                                font-size: 14px; width: 28px; height: 28px; border-radius: 50%;
                                display: flex; align-items: center; justify-content: center; transition: background 0.2s;
                            " title="Settings">⚙️</button>
                            <button id="refresh-chapters" style="
                                background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer;
                                font-size: 14px; width: 28px; height: 28px; border-radius: 50%;
                                display: flex; align-items: center; justify-content: center; transition: background 0.2s;
                            " title="Refresh chapter list">🔄</button>
                            <button id="minimize-aggregator" style="
                                background: rgba(255,255,255,0.2); border: none; color: white; cursor: pointer;
                                font-size: 16px; width: 28px; height: 28px; border-radius: 50%;
                                display: flex; align-items: center; justify-content: center; transition: background 0.2s;
                            " title="Minimize">−</button>
                        </div>
                    </div>

                    <div id="main-content" style="
                        padding: ${isCompact ? '15px' : '20px'};
                        overflow-y: auto;
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        gap: ${isCompact ? '12px' : '15px'};
                    ">
                        <div id="main-view">
                            <!-- Chapter Count Display -->
                            <div style="
                                font-weight: 600; color: #e94560; text-align: center;
                                background: rgba(233, 69, 96, 0.1); padding: ${isCompact ? '12px' : '15px'};
                                border-radius: 10px; border: 1px solid rgba(233, 69, 96, 0.3);
                                margin-bottom: 20px; font-size: ${isCompact ? '16px' : '18px'};
                            ">
                                <div style="font-size: 24px; margin-bottom: 8px;">📖</div>
                                <div id="chapter-count">${this.chapters.length} Chapters Detected</div>
                                <div style="font-size: ${isCompact ? '11px' : '12px'}; color: #b0b0b0; margin-top: 8px;" id="selection-info">
                                    All chapters will be downloaded
                                </div>
                            </div>

                            <!-- Range Selection -->
                            <div style="
                                background: rgba(102, 126, 234, 0.1); border: 1px solid rgba(102, 126, 234, 0.3);
                                border-radius: 8px; padding: ${isCompact ? '12px' : '15px'}; margin-bottom: 20px;
                            ">
                                <div style="color: #e0e0e0; font-weight: 600; margin-bottom: 10px; font-size: ${isCompact ? '13px' : '14px'};">
                                    📍 Range Selection (Optional)
                                </div>
                                <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;">
                                    <input type="number" id="range-from" placeholder="From" min="1" max="${this.chapters.length}" style="
                                        flex: 1; padding: 8px; background: rgba(0,0,0,0.3); border: 1px solid #0f3460;
                                        border-radius: 4px; color: #e0e0e0; font-size: ${isCompact ? '12px' : '13px'};
                                    ">
                                    <span style="color: #b0b0b0; font-size: ${isCompact ? '12px' : '13px'};">to</span>
                                    <input type="number" id="range-to" placeholder="To" min="1" max="${this.chapters.length}" style="
                                        flex: 1; padding: 8px; background: rgba(0,0,0,0.3); border: 1px solid #0f3460;
                                        border-radius: 4px; color: #e0e0e0; font-size: ${isCompact ? '12px' : '13px'};
                                    ">
                                </div>
                                <div style="display: flex; gap: 8px;">
                                    <button id="select-range" style="
                                        flex: 1; padding: 8px 12px; background: linear-gradient(45deg, #9C27B0, #7B1FA2); color: white;
                                        border: none; border-radius: 6px; cursor: pointer; font-size: ${isCompact ? '12px' : '13px'}; font-weight: 500;
                                    ">📋 Select Range</button>
                                    <button id="select-all" style="
                                        flex: 1; padding: 8px 12px; background: linear-gradient(45deg, #4CAF50, #45a049); color: white;
                                        border: none; border-radius: 6px; cursor: pointer; font-size: ${isCompact ? '12px' : '13px'}; font-weight: 500;
                                    ">📚 Select All</button>
                                </div>
                            </div>

                            <!-- Progress -->
                            <div style="margin-bottom: 20px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                    <span id="progress-text" style="color: #e0e0e0; font-weight: 500; font-size: ${isCompact ? '12px' : '13px'};">Ready to download</span>
                                    <span id="status-badge" style="
                                        background: linear-gradient(45deg, #667eea, #764ba2); color: white;
                                        padding: 4px 10px; border-radius: 12px; font-size: ${isCompact ? '11px' : '12px'}; font-weight: 600;
                                    ">Ready</span>
                                </div>
                                <div style="width: 100%; height: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; overflow: hidden;">
                                    <div id="progress-bar" style="
                                        width: 0%; height: 100%; background: linear-gradient(90deg, #4CAF50, #45a049);
                                        transition: width 0.3s ease; border-radius: 4px;
                                    "></div>
                                </div>
                            </div>

                            <!-- Action Buttons -->
                            <div style="display: flex; gap: 12px; margin-bottom: 15px;">
                                <button id="download-chapters" style="
                                    flex: 1; padding: ${isCompact ? '12px' : '15px'};
                                    background: linear-gradient(45deg, #2196F3, #1976D2); color: white; border: none;
                                    border-radius: 10px; cursor: pointer; font-weight: 600; font-size: ${isCompact ? '14px' : '16px'};
                                    transition: all 0.2s; box-shadow: 0 4px 15px rgba(33, 150, 243, 0.3);
                                ">📥 Download All Chapters</button>
                                <button id="cancel-download" style="
                                    padding: ${isCompact ? '12px' : '15px'}; background: linear-gradient(45deg, #f44336, #d32f2f);
                                    color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: 600;
                                    font-size: ${isCompact ? '14px' : '16px'}; transition: all 0.2s; display: none;
                                ">❌ Cancel</button>
                            </div>

                            <!-- Utility Buttons -->
                            <div style="display: flex; gap: 8px;">
                                <button id="export-logs" style="
                                    flex: 1; padding: ${isCompact ? '8px' : '10px'}; background: linear-gradient(45deg, #FF9800, #F57400);
                                    color: white; border: none; border-radius: 8px; cursor: pointer;
                                    font-size: ${isCompact ? '12px' : '13px'}; font-weight: 500;
                                ">📄 Export Logs</button>
                                <button id="toggle-logs" style="
                                    flex: 1; padding: ${isCompact ? '8px' : '10px'}; background: linear-gradient(45deg, #9C27B0, #7B1FA2);
                                    color: white; border: none; border-radius: 8px; cursor: pointer;
                                    font-size: ${isCompact ? '12px' : '13px'}; font-weight: 500;
                                ">📋 Toggle Logs</button>
                            </div>

                            <!-- Log Container -->
                            <div id="log-container" style="
                                margin-top: 15px; height: 120px; overflow-y: auto; background: rgba(0,0,0,0.4);
                                border: 1px solid #0f3460; border-radius: 8px; padding: 10px;
                                font-family: 'Consolas', 'Monaco', monospace; font-size: ${isCompact ? '10px' : '11px'};
                                white-space: pre-wrap; color: #b0b0b0; display: none;
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

            this.bindUIEvents();
            this.updateUI();
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
                logger.exportLogs();
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
            this.showNotification('✅ Settings saved!', 'success');

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
            this.showNotification('🔄 Settings reset', 'info');
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
                downloadBtn.textContent = `📥 Download Selected (${count})`;
                logger.info(`UI updated for range selection: ${from}-${to} (${count} chapters)`);
            } else {
                selectionInfo.textContent = 'All chapters will be downloaded';
                downloadBtn.textContent = `📥 Download All Chapters`;
                logger.info('UI updated for all chapters selection');
            }

            downloadBtn.disabled = this.chapters.length === 0 || this.isProcessing;

            if (this.isProcessing) {
                downloadBtn.style.display = 'none';
                cancelBtn.style.display = 'block';
                statusBadge.textContent = 'Processing';
                statusBadge.style.background = 'linear-gradient(45deg, #FF9800, #F57400)';
            } else {
                downloadBtn.style.display = 'block';
                cancelBtn.style.display = 'none';
                statusBadge.textContent = 'Ready';
                statusBadge.style.background = 'linear-gradient(45deg, #667eea, #764ba2)';

                if (this.chapters.length > 0) {
                    downloadBtn.style.background = 'linear-gradient(45deg, #2196F3, #1976D2)';
                    downloadBtn.style.cursor = 'pointer';
                } else {
                    downloadBtn.style.background = 'linear-gradient(45deg, #666, #555)';
                    downloadBtn.style.cursor = 'not-allowed';
                }
            }
        }

        updateProgress(progress) {
            const progressBar = document.getElementById('progress-bar');
            const progressText = document.getElementById('progress-text');
            const statusBadge = document.getElementById('status-badge');

            if (!progressBar || !progressText || !statusBadge) return;

            progressBar.style.width = `${progress.percentage}%`;

            if (progress.cancelled) {
                progressText.textContent = 'Download cancelled';
                statusBadge.textContent = 'Cancelled';
                progressBar.style.background = 'linear-gradient(90deg, #f44336, #d32f2f)';
                statusBadge.style.background = 'linear-gradient(45deg, #f44336, #d32f2f)';
            } else {
                progressText.textContent = `Processing ${progress.current}/${progress.total} (${progress.percentage}%)`;
                statusBadge.textContent = `${progress.current}/${progress.total}`;

                if (progress.success) {
                    progressBar.style.background = 'linear-gradient(90deg, #4CAF50, #45a049)';
                } else {
                    progressBar.style.background = 'linear-gradient(90deg, #f44336, #d32f2f)';
                }

                if (progress.current === progress.total) {
                    progressText.textContent = 'Processing complete!';
                    statusBadge.textContent = 'Complete';
                    statusBadge.style.background = 'linear-gradient(45deg, #4CAF50, #45a049)';
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
            left: -300px;
            width: 300px;
            height: calc(100vh - var(--navbar-height));
            background: var(--secondary-bg);
            border-right: 1px solid var(--border);
            overflow-y: auto;
            transition: left 0.3s ease;
            z-index: 999;
            box-shadow: 2px 0 10px var(--shadow);
        }

        .sidebar.open {
            left: 0;
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
            transition: margin-left 0.3s ease;
        }

        .main-content.sidebar-open {
            margin-left: 300px;
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
        @media (max-width: 1100px) {
            .main-content.sidebar-open {
                margin-left: 0;
            }
        }

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
        <div class="nav-stats">${chapters.length} chapters</div>
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
            if (window.innerWidth > 1100) {
                mainContent.classList.toggle('sidebar-open');
            }
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

            if (logContainer.style.display === 'none') {
                logContainer.style.display = 'block';
                logContainer.textContent = logger.getLogs();
                toggleBtn.textContent = '📋 Hide Logs';
                logContainer.scrollTop = logContainer.scrollHeight;
            } else {
                logContainer.style.display = 'none';
                toggleBtn.textContent = '📋 Toggle Logs';
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
