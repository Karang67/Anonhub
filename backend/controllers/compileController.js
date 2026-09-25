/**
 * @file controllers/compileController.js
 * @description Coordinates sandboxed code execution and real-time collaboration broadcasting.
 * Supports Piston (Self-Hosted), Judge0, and Local sandboxes with WebSocket broadcast
 * so all connected peers in the workspace see the execution status and output simultaneously.
 */

const { executeCode } = require('../services/sandboxService');
const { handleValidation } = require('../utils/helpers');
const { log } = require('../utils/logger');

/**
 * POST /api/compile
 * Compiles and runs code, broadcasting progress and output to room peers in real time.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('socket.io').Server} [io]
 */
async function compile(req, res, io) {
    if (!handleValidation(req, res)) return;
    const { code, language, stdin, room, fileName, runBy } = req.body;

    const safeRoom = room ? String(room).trim().slice(0, 100) : null;
    const safeUser = runBy ? String(runBy).trim().slice(0, 50) : 'Collaborator';
    const safeFileName = fileName ? String(fileName).trim().slice(0, 100) : 'script';

    // Broadcast execution start to all peers in the shared workspace
    if (safeRoom && io) {
        io.to(safeRoom).emit('code execution started', {
            room: safeRoom,
            fileName: safeFileName,
            language,
            runBy: safeUser,
            timestamp: Date.now()
        });
    }

    try {
        const result = await executeCode({
            code,
            language,
            stdin: stdin || '',
            fileName: safeFileName
        });

        // Broadcast output simultaneously to all peers in the shared workspace
        if (safeRoom && io) {
            io.to(safeRoom).emit('code execution result', {
                room: safeRoom,
                fileName: safeFileName,
                language,
                runBy: safeUser,
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                timeout: result.timeout,
                time: result.time,
                memory: result.memory,
                engine: result.engine,
                timestamp: Date.now()
            });
        }

        res.json(result);
    } catch (err) {
        log('error', 'Compilation execution error:', err);

        const errorPayload = {
            stdout: '',
            stderr: `Execution error: ${err.message}`,
            exitCode: 1,
            timeout: false,
            time: '0.0s',
            memory: 'N/A',
            engine: 'Error'
        };

        if (safeRoom && io) {
            io.to(safeRoom).emit('code execution result', {
                room: safeRoom,
                fileName: safeFileName,
                language,
                runBy: safeUser,
                ...errorPayload,
                timestamp: Date.now()
            });
        }

        res.status(500).json(errorPayload);
    }
}

module.exports = { compile };
