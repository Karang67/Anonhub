/**
 * @file services/sandboxService.js
 * @description Unified Sandboxed Code Execution Service.
 * Supports:
 *  1. Self-Hosted Piston (Docker: ghcr.io/engineer-man/piston) - primary recommended engine
 *  2. Self-Hosted or Cloud Judge0 API
 *  3. Local Sandboxed Child Process Runner (built-in fallback)
 *
 * Provides high-speed, zero-API-limit, secure isolated execution.
 */

const { compileAndRun } = require('../compiler');
const { log } = require('../utils/logger');

// Configurable Sandbox Endpoints
const PISTON_URL = (process.env.PISTON_URL || 'http://localhost:2000').replace(/\/+$/, '');
const JUDGE0_URL = (process.env.JUDGE0_URL || 'http://localhost:2358').replace(/\/+$/, '');
const PREFERRED_PROVIDER = (process.env.SANDBOX_PROVIDER || 'auto').toLowerCase(); // 'auto' | 'piston' | 'judge0' | 'local'
const EXECUTION_TIMEOUT_MS = parseInt(process.env.CODE_EXECUTION_TIMEOUT_MS || '8000', 10);

/**
 * Normalized language mapping for Piston
 */
const PISTON_LANGUAGE_MAP = {
    javascript: { language: 'javascript', version: '*' },
    js:         { language: 'javascript', version: '*' },
    node:       { language: 'javascript', version: '*' },
    typescript: { language: 'typescript', version: '*' },
    ts:         { language: 'typescript', version: '*' },
    python:     { language: 'python', version: '*' },
    python3:    { language: 'python', version: '*' },
    py:         { language: 'python', version: '*' },
    cpp:        { language: 'c++', version: '*' },
    'c++':      { language: 'c++', version: '*' },
    c:          { language: 'c', version: '*' },
    java:       { language: 'java', version: '*' },
    rust:       { language: 'rust', version: '*' },
    rs:         { language: 'rust', version: '*' },
    go:         { language: 'go', version: '*' },
    golang:     { language: 'go', version: '*' },
    bash:       { language: 'bash', version: '*' },
    sh:         { language: 'bash', version: '*' },
    php:        { language: 'php', version: '*' },
    ruby:       { language: 'ruby', version: '*' },
    rb:         { language: 'ruby', version: '*' },
    csharp:     { language: 'csharp', version: '*' },
    'c#':       { language: 'csharp', version: '*' },
    kotlin:     { language: 'kotlin', version: '*' },
    swift:      { language: 'swift', version: '*' },
    sql:        { language: 'sqlite3', version: '*' },
    sqlite:     { language: 'sqlite3', version: '*' },
};

/**
 * Normalized language IDs for Judge0 (Common CE / Standard mappings)
 */
const JUDGE0_LANGUAGE_MAP = {
    javascript: 63, // JavaScript (Node.js 12.14.0) or 93 (Node.js 18.15.0)
    js:         63,
    typescript: 74, // TypeScript (3.7.4) or 94
    ts:         74,
    python:     71, // Python (3.8.1) or 92 (Python 3.11.2)
    py:         71,
    cpp:        54, // C++ (GCC 9.2.0) or 76
    'c++':      54,
    c:          50, // C (GCC 9.2.0)
    java:       62, // Java (OpenJDK 13.0.1) or 91
    rust:       73, // Rust (1.40.0)
    go:         60, // Go (1.13.5)
    bash:       46, // Bash (5.0.0)
    php:        68, // PHP (7.4.1)
    ruby:       72, // Ruby (2.7.0)
    csharp:     51, // C# (Mono 6.6.0.161)
};

/**
 * Cache engine health status for 30 seconds to avoid unnecessary round-trips
 */
let pistonHealthy = null;
let lastPistonCheck = 0;

async function checkPistonHealth() {
    const now = Date.now();
    if (pistonHealthy !== null && (now - lastPistonCheck < 30_000)) {
        return pistonHealthy;
    }
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(`${PISTON_URL}/api/v2/runtimes`, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });
        clearTimeout(timeout);
        pistonHealthy = res.ok;
        lastPistonCheck = now;
        return pistonHealthy;
    } catch (_) {
        pistonHealthy = false;
        lastPistonCheck = now;
        return false;
    }
}

/**
 * Executes code via Piston API
 * @param {Object} opts
 * @param {string} opts.code
 * @param {string} opts.language
 * @param {string} [opts.stdin]
 * @param {string} [opts.fileName]
 * @returns {Promise<Object>}
 */
async function executeViaPiston({ code, language, stdin = '', fileName = '' }) {
    const langKey = String(language || '').toLowerCase().trim();
    const pistonConfig = PISTON_LANGUAGE_MAP[langKey];

    if (!pistonConfig) {
        throw new Error(`Language "${language}" is not supported by Piston.`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXECUTION_TIMEOUT_MS);
    const startTime = Date.now();

    try {
        const payload = {
            language: pistonConfig.language,
            version: pistonConfig.version,
            files: [
                {
                    name: fileName || `main.${getFileExtension(langKey)}`,
                    content: code
                }
            ],
            stdin: stdin || '',
            run_timeout: Math.min(EXECUTION_TIMEOUT_MS, 10000),
            compile_timeout: 10000
        };

        const res = await fetch(`${PISTON_URL}/api/v2/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeout);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`Piston HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }

        const data = await res.json();

        // Check if public Piston whitelist warning returned
        if (data.message && data.message.includes('whitelist only')) {
            throw new Error(`Piston API whitelist requirement: Host self-hosted instance at ${PISTON_URL}`);
        }

        // Piston compile phase output
        const compileOut = data.compile || {};
        const runOut = data.run || {};

        if (compileOut.code && compileOut.code !== 0) {
            return {
                stdout: compileOut.stdout || '',
                stderr: compileOut.stderr || compileOut.output || 'Compilation failed.',
                exitCode: compileOut.code,
                timeout: false,
                time: `${duration}s`,
                memory: 'Sandboxed',
                engine: PISTON_URL.includes('localhost') || PISTON_URL.includes('127.0.0.1') || PISTON_URL.includes('piston')
                    ? 'Piston (Self-Hosted)'
                    : 'Piston Engine'
            };
        }

        const stdout = runOut.stdout || '';
        const stderr = runOut.stderr || '';
        const exitCode = typeof runOut.code === 'number' ? runOut.code : 0;
        const timedOut = runOut.signal === 'SIGKILL' || runOut.signal === 'SIGTERM';

        return {
            stdout,
            stderr: timedOut ? `⏱️ Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s.` : stderr,
            exitCode: timedOut ? 124 : exitCode,
            timeout: timedOut,
            time: `${duration}s`,
            memory: 'Sandboxed',
            engine: PISTON_URL.includes('localhost') || PISTON_URL.includes('127.0.0.1') || PISTON_URL.includes('piston')
                ? 'Piston (Self-Hosted)'
                : 'Piston Engine'
        };
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

/**
 * Executes code via Judge0 API
 * @param {Object} opts
 * @returns {Promise<Object>}
 */
async function executeViaJudge0({ code, language, stdin = '' }) {
    const langKey = String(language || '').toLowerCase().trim();
    const langId = JUDGE0_LANGUAGE_MAP[langKey];

    if (!langId) {
        throw new Error(`Language "${language}" is not supported by Judge0 mapping.`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXECUTION_TIMEOUT_MS);
    const startTime = Date.now();

    try {
        const endpoint = `${JUDGE0_URL}/submissions?wait=true`;
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                source_code: code,
                language_id: langId,
                stdin: stdin || ''
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`Judge0 HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }

        const data = await res.json();
        const stdout = data.stdout || '';
        const stderr = data.compile_output || data.stderr || '';
        const exitCode = data.status?.id === 3 ? 0 : (data.exit_code || 1);
        const memoryMb = data.memory ? `${(data.memory / 1024).toFixed(2)}MB` : 'Sandboxed';
        const executionTime = data.time ? `${data.time}s` : `${duration}s`;

        return {
            stdout,
            stderr,
            exitCode,
            timeout: data.status?.id === 5, // 5 = Time Limit Exceeded
            time: executionTime,
            memory: memoryMb,
            engine: JUDGE0_URL.includes('localhost') || JUDGE0_URL.includes('127.0.0.1')
                ? 'Judge0 (Self-Hosted)'
                : 'Judge0 Cloud'
        };
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

/**
 * Unified execution entrypoint with automatic provider selection & resilient fallback.
 *
 * Selection Order:
 * 1. Piston (if configured or running self-hosted via Docker)
 * 2. Judge0 (if configured or running self-hosted via Docker)
 * 3. Local Sandboxed Child Process Runner (built-in zero-dependency fallback)
 *
 * @param {Object} params
 * @param {string} params.code
 * @param {string} params.language
 * @param {string} [params.stdin]
 * @param {string} [params.fileName]
 * @returns {Promise<Object>}
 */
async function executeCode({ code, language, stdin = '', fileName = '' }) {
    const langKey = String(language || '').toLowerCase().trim();

    // Client-rendered web code
    if (langKey === 'html' || langKey === 'css') {
        return {
            stdout: 'Rendered successfully in Live Preview.',
            stderr: '',
            exitCode: 0,
            timeout: false,
            time: '0.01s',
            memory: 'DOM',
            engine: 'Browser Preview'
        };
    }

    if (langKey === 'json') {
        try {
            const parsed = JSON.parse(code);
            return {
                stdout: `JSON is valid.\n\n${JSON.stringify(parsed, null, 2)}`,
                stderr: '',
                exitCode: 0,
                timeout: false,
                time: '0.01s',
                memory: 'N/A',
                engine: 'JSON Validator'
            };
        } catch (err) {
            return {
                stdout: '',
                stderr: `Invalid JSON: ${err.message}`,
                exitCode: 1,
                timeout: false,
                time: '0.01s',
                memory: 'N/A',
                engine: 'JSON Validator'
            };
        }
    }

    // Force specific provider if requested by environment
    if (PREFERRED_PROVIDER === 'piston') {
        return executeViaPiston({ code, language: langKey, stdin, fileName });
    }
    if (PREFERRED_PROVIDER === 'judge0') {
        return executeViaJudge0({ code, language: langKey, stdin });
    }
    if (PREFERRED_PROVIDER === 'local') {
        const localRes = await compileAndRun(code, langKey);
        return {
            ...localRes,
            time: 'Sub-50ms',
            memory: 'Sandboxed',
            engine: 'Local Sandbox'
        };
    }

    // AUTO Mode: 1. Try Piston
    const isPistonAvailable = await checkPistonHealth();
    if (isPistonAvailable) {
        try {
            return await executeViaPiston({ code, language: langKey, stdin, fileName });
        } catch (pistonErr) {
            log('warn', `Piston execution failed, attempting fallback: ${pistonErr.message}`);
        }
    }

    // AUTO Mode: 2. Try Judge0
    if (JUDGE0_LANGUAGE_MAP[langKey]) {
        try {
            return await executeViaJudge0({ code, language: langKey, stdin });
        } catch (judge0Err) {
            log('warn', `Judge0 execution failed, attempting local fallback: ${judge0Err.message}`);
        }
    }

    // AUTO Mode: 3. Resilient Local Sandbox Fallback
    log('info', `Executing code via internal local sandbox runner for "${langKey}"`);
    const localRes = await compileAndRun(code, langKey);
    return {
        ...localRes,
        time: localRes.timeout ? 'Timed out' : 'Sub-50ms',
        memory: 'Sandboxed',
        engine: 'Local Sandbox'
    };
}

/**
 * File extension resolver for Piston runner
 */
function getFileExtension(lang) {
    switch (lang) {
        case 'javascript': return 'js';
        case 'typescript': return 'ts';
        case 'python':     return 'py';
        case 'cpp':        return 'cpp';
        case 'c':          return 'c';
        case 'java':       return 'java';
        case 'rust':       return 'rs';
        case 'go':         return 'go';
        case 'bash':       return 'sh';
        case 'php':        return 'php';
        case 'ruby':       return 'rb';
        case 'csharp':     return 'cs';
        default:           return 'txt';
    }
}

module.exports = {
    executeCode,
    executeViaPiston,
    executeViaJudge0,
    checkPistonHealth,
    PISTON_URL,
    JUDGE0_URL,
    PREFERRED_PROVIDER
};
