/**
 * @file sockets/projectSocket.js
 * @description Socket.IO handlers for project room events:
 * joining, document/code/whiteboard updates, version management,
 * notes, attachments, polls, snippets, ownership, and WebRTC signaling.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Project = require('../models/Project');
const ChatRoom = require('../models/ChatRoom');
const Attachment = require('../models/Attachment');
const ProjectVersion = require('../models/ProjectVersion');
const { verifyAccessKey } = require('../middleware/auth');
const { saveProjectVersion } = require('../controllers/versionController');
const { isValidObjectId } = require('../utils/helpers');
const { MAX_NAME_LEN, MAX_KEY_LEN, MAX_CODE_LEN, MIN_KEY_LEN, BCRYPT_ROUNDS, WHITEBOARD_MAX_PAYLOAD_BYTES, WHITEBOARD_MAX_OBJECTS } = require('../config/db');
const { log } = require('../utils/logger');

// ─── Throttled activity tracking (max 1 DB write per 30s per room) ────────────
const lastActivityUpdate = new Map();
function touchActivity(Model, roomName) {
    const now = Date.now();
    const last = lastActivityUpdate.get(roomName) || 0;
    if (now - last > 30_000) {
        lastActivityUpdate.set(roomName, now);
        Model.updateOne({ name: roomName }, { lastActivityAt: new Date() }).catch(() => {});
    }
}

module.exports = function registerProjectSocketHandlers(socket, io, activeUsers, checkSocketRateLimit, joinRoom) {

    // ─── join project ─────────────────────────────────────────────────────────

    socket.on('join project', async (data) => {
        let projectName = '', accessKey = '', clientOwnerToken = '';
        if (typeof data === 'string') {
            projectName = data;
        } else if (data && typeof data === 'object') {
            projectName = String(data.projectName || '').trim().slice(0, MAX_NAME_LEN);
            accessKey = String(data.accessKey || '').trim().slice(0, MAX_KEY_LEN);
            clientOwnerToken = String(data.ownerToken || '').trim();
        }
        if (!projectName) return;

        if (!checkSocketRateLimit(socket.id, 'join project', 5, 30_000)) {
            socket.emit('error', 'Too many join attempts. Please wait.');
            return;
        }

        try {
            let project = await Project.findOne({ name: projectName });
            if (!project) {
                if (accessKey && accessKey.length >= MIN_KEY_LEN) {
                    const ownerToken = crypto.randomBytes(32).toString('hex');
                    const hashedKey = await bcrypt.hash(accessKey, BCRYPT_ROUNDS);
                    try {
                        project = new Project({ name: projectName, accessKey: hashedKey, ownerToken });
                        await project.save();
                        socket.emit('set owner token', ownerToken);
                    } catch (saveErr) {
                        if (saveErr.code === 11000) {
                            project = await Project.findOne({ name: projectName });
                        } else throw saveErr;
                    }
                } else {
                    socket.emit('access denied', { room: projectName, type: 'project', message: 'Access key required' });
                    return;
                }
            } else {
                if (project.status === 'inactive') {
                    socket.emit('access denied', {
                        room: projectName,
                        type: 'project',
                        message: 'This room has expired due to 15 days of inactivity and is no longer accessible.'
                    });
                    return;
                }
                const match = await verifyAccessKey(
                    accessKey, project.accessKey,
                    (newHash) => Project.updateOne({ name: projectName }, { accessKey: newHash })
                );
                if (!match) {
                    socket.emit('access denied', { room: projectName, type: 'project', message: 'Incorrect access key' });
                    return;
                }
            }

            await joinRoom(projectName);
            const activeProject = project;
            if (activeProject) {
                let currentOwnerToken = activeProject.ownerToken;
                let isOwner = false;

                if (!currentOwnerToken) {
                    currentOwnerToken = crypto.randomBytes(32).toString('hex');
                    await Project.updateOne({ name: projectName }, { ownerToken: currentOwnerToken });
                    socket.emit('set owner token', currentOwnerToken);
                    isOwner = true;
                } else {
                    isOwner = clientOwnerToken.length > 0 &&
                        crypto.timingSafeEqual(
                            Buffer.from(clientOwnerToken.padEnd(64, '0').slice(0, 64)),
                            Buffer.from(currentOwnerToken.padEnd(64, '0').slice(0, 64))
                        ) && clientOwnerToken === currentOwnerToken;
                    if (isOwner) socket.emit('set owner token', currentOwnerToken);
                }

                if (!socket.ownedRooms) socket.ownedRooms = new Set();
                if (isOwner) {
                    socket.ownedRooms.add(projectName);
                }

                socket.isOwner = isOwner;
                socket.emit('is owner', isOwner);
                const projectPerms = activeProject.permissions || {};
                socket.emit('project permissions', {
                    allowDraw:      projectPerms.allowDraw !== false,
                    allowDocWrite:  projectPerms.allowDocWrite !== false,
                    allowCodeWrite: projectPerms.allowCodeWrite !== false
                });
                socket.emit('project content', activeProject.content || '');
                socket.emit('whiteboard content', activeProject.whiteboard || '{}');
                socket.emit('code content', {
                    code: activeProject.code || '// Start coding in VS Code style here...\n',
                    language: activeProject.codeLanguage || 'javascript'
                });
                socket.emit('attachments content', activeProject.attachments || '[]');
                socket.emit('notes content', activeProject.notes || '[]');
                socket.emit('polls content', activeProject.polls || '[]');
                socket.emit('snippets content', activeProject.snippets || '[]');
            }
            socket.emit('join success', { room: projectName });
        } catch (err) {
            log('error', 'Socket join project error:', err);
            socket.emit('error', 'Server validation error');
        }
    });

    // ─── join-call-room ───────────────────────────────────────────────────────

    socket.on('join-call-room', async ({ room, accessKey }, callback) => {
        const name = String(room || '').trim().slice(0, MAX_NAME_LEN);
        const key = String(accessKey || '').trim().slice(0, MAX_KEY_LEN);
        if (!name) {
            if (typeof callback === 'function') callback({ error: 'Invalid room name' });
            return;
        }
        if (!checkSocketRateLimit(socket.id, 'join-call-room', 5, 30_000)) {
            if (typeof callback === 'function') callback({ error: 'Too many join attempts' });
            return;
        }
        try {
            const existingProject = await Project.findOne({ name }).exec();
            const existingChat = await ChatRoom.findOne({ name }).exec();
            if (existingProject) {
                const match = await verifyAccessKey(key, existingProject.accessKey,
                    (newHash) => Project.updateOne({ name }, { accessKey: newHash }));
                if (!match) { if (typeof callback === 'function') callback({ error: 'Incorrect access key' }); return; }
            } else if (existingChat) {
                const match = await verifyAccessKey(key, existingChat.accessKey,
                    (newHash) => ChatRoom.updateOne({ name }, { accessKey: newHash }));
                if (!match) { if (typeof callback === 'function') callback({ error: 'Incorrect access key' }); return; }
            }
            await joinRoom(name);
            if (typeof callback === 'function') callback({ success: true });
        } catch (err) {
            log('error', 'Socket join-call-room error:', err);
            if (typeof callback === 'function') callback({ error: 'Server error' });
        }
    });

    // ─── project update (document) ────────────────────────────────────────────

    let docUpdateCount = 0;
    socket.on('project update', async ({ projectName, content }) => {
        if (!checkSocketRateLimit(socket.id, 'project update', 20, 5_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        const isOwner = socket.ownedRooms && socket.ownedRooms.has(name);
        if (!isOwner) {
            const project = await Project.findOne({ name }).select('permissions status').lean();
            if (project?.status === 'inactive') { socket.emit('room deleted', { room: name, message: 'This room has expired.' }); return; }
            if (project?.permissions?.allowDocWrite === false) return;
        }
        await Project.updateOne({ name }, { content });
        touchActivity(Project, name);
        socket.to(name).emit('project content', content);
        docUpdateCount++;
        if (docUpdateCount % 5 === 0) saveProjectVersion(name, 'document', content);
    });

    // ─── whiteboard update ────────────────────────────────────────────────────

    socket.on('whiteboard update', async ({ projectName, content }) => {
        if (!checkSocketRateLimit(socket.id, 'whiteboard update', 20, 5_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        // Payload size validation
        const payloadSize = Buffer.byteLength(String(content || ''), 'utf8');
        if (payloadSize > WHITEBOARD_MAX_PAYLOAD_BYTES) {
            socket.emit('error', `Whiteboard payload too large (max ${WHITEBOARD_MAX_PAYLOAD_BYTES / 1024}KB).`);
            return;
        }
        // Object count validation
        try {
            const parsed = JSON.parse(content || '{}');
            const objCount = Array.isArray(parsed.objects) ? parsed.objects.length : 0;
            if (objCount > WHITEBOARD_MAX_OBJECTS) {
                socket.emit('error', `Whiteboard has too many objects (max ${WHITEBOARD_MAX_OBJECTS}).`);
                return;
            }
        } catch (_) {}
        const isOwner = socket.ownedRooms && socket.ownedRooms.has(name);
        if (!isOwner) {
            const project = await Project.findOne({ name }).select('permissions status').lean();
            if (project?.status === 'inactive') { socket.emit('room deleted', { room: name, message: 'This room has expired.' }); return; }
            if (project?.permissions?.allowDraw === false) return;
        }
        await Project.updateOne({ name }, { whiteboard: content });
        touchActivity(Project, name);
        socket.to(name).emit('whiteboard content', content);
    });

    // ─── code update ──────────────────────────────────────────────────────────

    let codeUpdateCount = 0;
    socket.on('code update', async ({ projectName, code, language }) => {
        if (!checkSocketRateLimit(socket.id, 'code update', 20, 5_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        const safeCode = String(code || '').slice(0, MAX_CODE_LEN);
        if (!name) return;
        const ud = activeUsers.get(socket.id);
        if (!ud || !ud.rooms.has(name)) return;
        const isOwner = socket.ownedRooms && socket.ownedRooms.has(name);
        if (!isOwner) {
            const project = await Project.findOne({ name }).select('permissions status').lean();
            if (project?.status === 'inactive') { socket.emit('room deleted', { room: name, message: 'This room has expired.' }); return; }
            if (project?.permissions?.allowCodeWrite === false) return;
        }
        await Project.updateOne({ name }, { code: safeCode, codeLanguage: language });
        touchActivity(Project, name);
        socket.to(name).emit('code content', { code: safeCode, language });
        codeUpdateCount++;
        if (codeUpdateCount % 5 === 0) saveProjectVersion(name, 'code', safeCode, language || 'javascript');
    });

    // ─── update project permissions ───────────────────────────────────────────

    socket.on('update project permissions', async (data) => {
        const projectName = String(data?.projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!projectName) return;
        if (!socket.ownedRooms || !socket.ownedRooms.has(projectName)) {
            socket.emit('error', 'Only the project owner can change permissions.');
            return;
        }
        const allowDraw      = data?.allowDraw !== false;
        const allowDocWrite  = data?.allowDocWrite !== false;
        const allowCodeWrite = data?.allowCodeWrite !== false;
        try {
            await Project.updateOne({ name: projectName }, {
                'permissions.allowDraw':      allowDraw,
                'permissions.allowDocWrite':  allowDocWrite,
                'permissions.allowCodeWrite': allowCodeWrite
            });
            io.to(projectName).emit('project permissions', { allowDraw, allowDocWrite, allowCodeWrite });
            log('info', `[PERMISSIONS] Project "${projectName}" permissions updated.`);
        } catch (err) {
            log('error', 'Error updating project permissions:', err);
        }
    });

    // ─── claim project ownership ──────────────────────────────────────────────

    socket.on('claim project ownership', async (data) => {
        const projectName = String(data?.projectName || '').trim().slice(0, MAX_NAME_LEN);
        const accessKey = String(data?.accessKey || data?.ownerKey || '').trim().slice(0, MAX_KEY_LEN);
        if (!projectName || !accessKey) {
            socket.emit('claim project ownership result', { success: false, message: 'Project name and Owner Key are required.' });
            return;
        }
        if (!checkSocketRateLimit(socket.id, 'claim project ownership', 5, 60_000)) {
            socket.emit('claim project ownership result', { success: false, message: 'Too many attempts. Please wait.' });
            return;
        }
        try {
            const project = await Project.findOne({ name: projectName });
            if (!project) {
                socket.emit('claim project ownership result', { success: false, message: 'Project not found.' });
                return;
            }
            const targetHash = project.ownerKey || project.accessKey;
            const match = await verifyAccessKey(accessKey, targetHash,
                (newHash) => Project.updateOne({ name: projectName }, { ownerKey: newHash }));
            if (!match) {
                socket.emit('claim project ownership result', { success: false, message: 'Incorrect Owner Key.' });
                return;
            }
            if (!socket.ownedRooms) socket.ownedRooms = new Set();
            socket.ownedRooms.add(projectName);
            socket.isOwner = true;
            socket.emit('is owner', true);
            if (project.ownerToken) socket.emit('set owner token', project.ownerToken);
            socket.emit('claim project ownership result', { success: true, message: 'Ownership claimed! You now have owner privileges.' });
            log('info', `[CLAIM-OWNERSHIP] Socket ${socket.id} claimed ownership of project "${projectName}".`);
        } catch (err) {
            log('error', 'Error claiming project ownership:', err);
            socket.emit('claim project ownership result', { success: false, message: 'Server error.' });
        }
    });

    // ─── set owner key ────────────────────────────────────────────────────────

    socket.on('set owner key', async (data) => {
        const roomName = String(data?.room || data?.projectName || '').trim().slice(0, MAX_NAME_LEN);
        const newOwnerKey = String(data?.newOwnerKey || '').trim().slice(0, MAX_KEY_LEN);
        const currentOwnerKey = String(data?.currentOwnerKey || '').trim().slice(0, MAX_KEY_LEN);
        if (!roomName || !newOwnerKey || newOwnerKey.length < 3) {
            socket.emit('set owner key result', { success: false, message: 'Owner Key must be at least 3 characters long.' });
            return;
        }
        try {
            const project = await Project.findOne({ name: roomName });
            const chatRoom = await ChatRoom.findOne({ name: roomName });
            const targetDoc = project || chatRoom;
            if (!targetDoc) {
                socket.emit('set owner key result', { success: false, message: 'Room/Project not found.' });
                return;
            }
            let authorized = socket.ownedRooms && socket.ownedRooms.has(roomName);
            if (!authorized && currentOwnerKey) {
                authorized = await verifyAccessKey(currentOwnerKey, targetDoc.ownerKey || targetDoc.accessKey, () => {});
            }
            if (!authorized) {
                socket.emit('set owner key result', { success: false, message: 'Unauthorized. Only the room owner can set a secret owner key.' });
                return;
            }
            const hashedOwnerKey = await bcrypt.hash(newOwnerKey, BCRYPT_ROUNDS);
            await Project.updateOne({ name: roomName }, { ownerKey: hashedOwnerKey });
            await ChatRoom.updateOne({ name: roomName }, { ownerKey: hashedOwnerKey });
            if (!socket.ownedRooms) socket.ownedRooms = new Set();
            socket.ownedRooms.add(roomName);
            socket.isOwner = true;
            socket.emit('is owner', true);
            socket.emit('set owner key result', { success: true, message: 'Secret Owner Key set successfully!' });
            log('info', `[SET-OWNER-KEY] Dedicated Owner Key updated for "${roomName}".`);
        } catch (err) {
            log('error', 'Error setting owner key:', err);
            socket.emit('set owner key result', { success: false, message: 'Server error setting owner key.' });
        }
    });

    // ─── version events ───────────────────────────────────────────────────────

    socket.on('restore version', async ({ projectName, versionId }) => {
        if (!isValidObjectId(versionId)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        const { default: ProjectVersion } = await import('../models/ProjectVersion.js').catch(() => ({ default: require('../models/ProjectVersion') }));
        try {
            const version = await ProjectVersion.findById(versionId);
            if (!version || version.projectName !== name) return;
            const isOwner = socket.ownedRooms && socket.ownedRooms.has(name);
            if (!isOwner) { socket.emit('error', 'Only the project owner can restore document versions.'); return; }
            if (version.type === 'document') {
                await Project.updateOne({ name }, { content: version.content });
                io.to(name).emit('project content', version.content);
            } else {
                await Project.updateOne({ name }, { code: version.content, codeLanguage: version.language });
                io.to(name).emit('code content', { code: version.content, language: version.language });
            }
            socket.emit('version restored', { type: version.type, savedAt: version.savedAt });
            io.to(name).emit('version list updated', { type: version.type });
        } catch (err) {
            log('error', 'Restore version error:', err);
        }
    });

    socket.on('save version', async ({ projectName, type, content, language, comment }) => {
        if (!checkSocketRateLimit(socket.id, 'save version', 15, 30_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        // Cap content length to prevent DB bloat
        const safeContent = String(content || '').slice(0, MAX_CODE_LEN);
        const safeType = type === 'code' ? 'code' : 'document';
        try {
            await saveProjectVersion(name, safeType, safeContent, String(language || 'javascript'), String(comment || '').trim().slice(0, 100));
            socket.emit('version saved', { type: safeType, savedAt: new Date() });
            io.to(name).emit('version list updated', { type: safeType });
        } catch (err) {
            log('error', 'Manual save version error:', err);
        }
    });

    // ─── notes update ─────────────────────────────────────────────────────────

    socket.on('notes update', async ({ projectName, notes }) => {
        if (!checkSocketRateLimit(socket.id, 'notes update', 30, 5_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        // Permission check: owner always allowed; non-owners respect allowDocWrite
        const isOwner = socket.ownedRooms && socket.ownedRooms.has(name);
        if (!isOwner) {
            const project = await Project.findOne({ name }).select('permissions status').lean();
            if (project?.status === 'inactive') { socket.emit('room deleted', { room: name, message: 'This room has expired.' }); return; }
            if (project?.permissions?.allowDocWrite === false) return;
        }
        try {
            await Project.updateOne({ name }, { notes });
            socket.to(name).emit('notes content', notes);
        } catch (err) {
            log('error', 'Notes update error:', err);
        }
    });

    // ─── polls update ─────────────────────────────────────────────────────────

    socket.on('update polls', async ({ projectName, polls }) => {
        if (!checkSocketRateLimit(socket.id, 'update polls', 30, 5_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        // Permission check: owner always allowed; non-owners respect allowDocWrite
        const isOwner = socket.ownedRooms && socket.ownedRooms.has(name);
        if (!isOwner) {
            const project = await Project.findOne({ name }).select('permissions status').lean();
            if (project?.status === 'inactive') { socket.emit('room deleted', { room: name, message: 'This room has expired.' }); return; }
            if (project?.permissions?.allowDocWrite === false) return;
        }
        try {
            await Project.updateOne({ name }, { polls });
            socket.to(name).emit('polls content', polls);
        } catch (err) {
            log('error', 'Polls update error:', err);
        }
    });

    // ─── snippets update ──────────────────────────────────────────────────────

    socket.on('update snippets', async ({ projectName, snippets }) => {
        if (!checkSocketRateLimit(socket.id, 'update snippets', 30, 5_000)) return;
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        // Permission check: owner always allowed; non-owners respect allowDocWrite
        const isOwner = socket.ownedRooms && socket.ownedRooms.has(name);
        if (!isOwner) {
            const project = await Project.findOne({ name }).select('permissions status').lean();
            if (project?.status === 'inactive') { socket.emit('room deleted', { room: name, message: 'This room has expired.' }); return; }
            if (project?.permissions?.allowDocWrite === false) return;
        }
        try {
            await Project.updateOne({ name }, { snippets });
            socket.to(name).emit('snippets content', snippets);
        } catch (err) {
            log('error', 'Snippets update error:', err);
        }
    });

    // ─── attachments ──────────────────────────────────────────────────────────

    socket.on('add attachment', async ({ projectName, file }) => {
        if (!checkSocketRateLimit(socket.id, 'add attachment', 5, 60_000)) {
            socket.emit('error', 'Attachment rate limit exceeded.');
            return;
        }
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        // Security: verify sender has joined this project room
        const ud = activeUsers.get(socket.id);
        if (!ud || !ud.rooms.has(name)) {
            socket.emit('error', 'You must join the project room before adding attachments.');
            return;
        }
        try {
            const project = await Project.findOne({ name });
            if (project) {
                // Validate and sanitize the file object — only allow known safe string fields
                if (!file || typeof file !== 'object') return;
                const safeFile = {
                    url:      typeof file.url === 'string'      ? file.url.slice(0, 512)      : '',
                    name:     typeof file.name === 'string'     ? file.name.slice(0, 255)     : 'Unnamed',
                    type:     typeof file.type === 'string'     ? file.type.slice(0, 128)     : '',
                    size:     typeof file.size === 'number'     ? Math.max(0, file.size)      : 0,
                    uploader: typeof file.uploader === 'string' ? file.uploader.slice(0, 60)  : 'Unknown',
                };
                if (!safeFile.url) { socket.emit('error', 'Attachment must have a valid URL.'); return; }
                const list = JSON.parse(project.attachments || '[]');
                list.push(safeFile);
                const updated = JSON.stringify(list);
                await Project.updateOne({ name }, { attachments: updated });
                io.to(name).emit('attachments content', updated);
            }
        } catch (e) {
            log('error', 'Error adding attachment:', e);
        }
    });

    socket.on('remove attachment', async ({ projectName, fileUrl }) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) {
            socket.emit('error', 'You must be joined in this project to delete attachments.');
            return;
        }
        try {
            const project = await Project.findOne({ name });
            if (project) {
                const list = JSON.parse(project.attachments || '[]');
                const fileToDelete = list.find(f => f.url === fileUrl);
                if (!fileToDelete) return;
                if (!socket.isOwner && fileToDelete.uploader !== userData.username) {
                    socket.emit('error', 'Only the project creator or the uploader can delete attachments.');
                    return;
                }
                const filteredList = list.filter(f => f.url !== fileUrl);
                const updated = JSON.stringify(filteredList);
                await Project.updateOne({ name }, { attachments: updated });
                io.to(name).emit('attachments content', updated);
                if (fileUrl && fileUrl.includes('/api/attachments/')) {
                    const parts = fileUrl.split('/');
                    const id = parts[parts.length - 1];
                    if (isValidObjectId(id)) await Attachment.findByIdAndDelete(id);
                }
            }
        } catch (e) {
            log('error', 'Error removing attachment:', e);
        }
    });

    // ─── WebRTC signaling ─────────────────────────────────────────────────────

    socket.on('webrtc-join-call', ({ projectName }, callback) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) { if (typeof callback === 'function') callback({ error: 'Invalid room name' }); return; }
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) {
            if (typeof callback === 'function') callback({ error: 'Unauthorized: You must join the project room first.' });
            return;
        }
        const roomName = `${name}-webrtc`;
        const roomClients = io.sockets.adapter.rooms.get(roomName);
        const existingPeers = [];
        if (roomClients) {
            roomClients.forEach(clientId => {
                if (clientId !== socket.id) {
                    existingPeers.push({ socketId: clientId, username: activeUsers.get(clientId)?.username || 'Participant' });
                }
            });
        }
        socket.join(roomName);
        socket.to(roomName).emit('webrtc-user-joined', { socketId: socket.id, username: activeUsers.get(socket.id)?.username || 'Participant' });
        if (typeof callback === 'function') callback({ success: true, existingPeers });
    });

    socket.on('webrtc-leave-call', ({ projectName }) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        socket.leave(`${name}-webrtc`);
        socket.to(`${name}-webrtc`).emit('webrtc-user-left', { socketId: socket.id });
    });

    socket.on('webrtc-signal', ({ targetId, signal }) => {
        if (!targetId || !signal) return;
        // Cap signal payload size (32KB max — SDP/ICE candidates are typically <8KB)
        try {
            if (JSON.stringify(signal).length > 32 * 1024) {
                socket.emit('error', 'WebRTC signal payload too large.');
                return;
            }
        } catch (_) { return; }
        const senderData = activeUsers.get(socket.id);
        const targetData = activeUsers.get(targetId);
        if (!senderData || !targetData) return;
        let sharesRoom = false;
        for (const r of senderData.rooms) {
            if (targetData.rooms.has(r)) {
                sharesRoom = true;
                break;
            }
        }
        if (!sharesRoom) return;
        io.to(targetId).emit('webrtc-signal', {
            senderId: socket.id,
            senderUsername: senderData.username || 'Participant',
            signal
        });
    });

    // ─── MoQ signaling ────────────────────────────────────────────────────────

    socket.on('moq-join-room', ({ projectName, username }, callback) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) { if (typeof callback === 'function') callback({ error: 'Invalid room name' }); return; }
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) {
            if (typeof callback === 'function') callback({ error: 'Unauthorized: You must join the project room first.' });
            return;
        }
        const roomName = `${name}-moq`;
        const roomClients = io.sockets.adapter.rooms.get(roomName);
        const existingPeers = [];
        if (roomClients) {
            roomClients.forEach(clientId => {
                if (clientId !== socket.id) {
                    existingPeers.push({ socketId: clientId, username: activeUsers.get(clientId)?.username || 'Participant' });
                }
            });
        }
        socket.join(roomName);
        socket.to(roomName).emit('moq-user-joined', { socketId: socket.id, username: username || activeUsers.get(socket.id)?.username || 'Participant' });
        if (typeof callback === 'function') callback({ success: true, existingPeers });
    });

    socket.on('moq-leave-room', ({ projectName }) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        socket.leave(`${name}-moq`);
        socket.to(`${name}-moq`).emit('moq-user-left', { socketId: socket.id });
    });

    socket.on('moq-packet', ({ projectName, packet }) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        // Cap payload size to prevent flooding peers (64KB limit)
        try {
            if (typeof packet !== 'undefined' && JSON.stringify(packet).length > 64 * 1024) {
                socket.emit('error', 'MoQ packet payload exceeds the 64KB limit.');
                return;
            }
        } catch (_) { return; }
        socket.to(`${name}-moq`).emit('moq-packet', { senderId: socket.id, packet });
    });

    socket.on('mic-status', ({ projectName, muted }) => {
        const name = String(projectName || '').trim().slice(0, MAX_NAME_LEN);
        if (!name) return;
        const userData = activeUsers.get(socket.id);
        if (!userData || !userData.rooms.has(name)) return;
        socket.to(`${name}-webrtc`).to(`${name}-moq`).emit('peer-mic-status', { socketId: socket.id, muted: !!muted });
    });
};
