// index.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const path = require('path');

// --- Basic Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// --- Database Connection ---

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/anonhub-db';

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log(' Connected to MongoDB...'))
    .catch(err => console.error(' Could not connect to MongoDB...', err));

// --- Database Schemas ---
const projectSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    content: { type: String, default: '' },
    whiteboard: { type: String, default: '{}' }
});

const messageSchema = new mongoose.Schema({
    room: String,
    username: String,
    msg: String,
    timestamp: { type: Date, default: Date.now }
});

const Project = mongoose.model('Project', projectSchema);
const Message = mongoose.model('Message', messageSchema);

// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- In-memory User Tracking ---
const activeUsers = new Map(); // { socket.id -> { username, rooms: Set } }

function generateRandomName() {
    const adjectives = ['Silent', 'Brave', 'Clever', 'Witty', 'Cosmic'];
    const nouns = ['Fox', 'Dragon', 'Alchemist', 'Explorer', 'Voyager'];
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
}

// --- Routes ---

app.post('/create-project', async (req, res) => {
    try {
        const projectName = req.body.name?.trim();
        if (!projectName) {
            return res.status(400).json({ error: 'Project name is required.' });
        }

        // 1. Check if the project already exists
        const existingProject = await Project.findOne({ name: projectName });

        // 2. If it exists, just return the URL to open it
        if (existingProject) {
            return res.status(200).json({ redirectUrl: `/projects/${encodeURIComponent(projectName)}` });
        }

        // 3. If it doesn't exist, create it and then return the URL
        const newProject = new Project({ name: projectName });
        await newProject.save();
        res.status(201).json({ redirectUrl: `/projects/${encodeURIComponent(projectName)}` });

    } catch (err) {
        console.error('Project creation/opening error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

app.get('/projects/:name', async (req, res) => {
    try {
        const project = await Project.findOne({ name: req.params.name });
        if (!project) {
            return res.status(404).send('Project not found. <a href="/">Go back home</a>');
        }
        res.sendFile(path.join(__dirname, 'public', 'project.html'));
    } catch (err) {
        res.status(500).send('Server error.');
    }
});

app.get('/chat/:room', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});


// --- Socket.IO Logic ---
io.on('connection', (socket) => {
    console.log(`🔌 User connected: ${socket.id}`);
    const username = generateRandomName();
    activeUsers.set(socket.id, { username, rooms: new Set() });
    socket.emit('set username', username);

    const updateRoomUsers = (room) => {
        const usersInRoom = [];
        for (const [id, userData] of activeUsers.entries()) {
            if (userData.rooms.has(room)) {
                usersInRoom.push({ id, username: userData.username });
            }
        }
        io.to(room).emit('room users', usersInRoom);
    };

    const joinRoom = async (room) => {
        socket.join(room);
        const userData = activeUsers.get(socket.id);
        if(userData) {
            userData.rooms.add(room);
        }
        
        console.log(`[${room}] ${username} joined`);

        // Send recent messages to the joining user
        const messages = await Message.find({ room }).sort({ timestamp: -1 }).limit(50).exec();
        socket.emit('load messages', messages.reverse());

        // Announce new user and update user list for everyone in the room
        socket.to(room).emit('chat message', { username: 'System', msg: `${username} has joined.` });
        updateRoomUsers(room);
    };

    socket.on('join room', joinRoom);

    socket.on('join project', async (projectName) => {
        await joinRoom(projectName); // Use the same join logic
        const project = await Project.findOne({ name: projectName });
        if (project) {
            socket.emit('project content', project.content);
            socket.emit('whiteboard content', project.whiteboard);
        }
    });

    socket.on('room message', async (data) => {
        const { room, msg } = data;
        const userData = activeUsers.get(socket.id);
        if (userData && msg && msg.trim() !== '') {
            const newMessage = new Message({ room, username: userData.username, msg: msg.trim() });
            await newMessage.save();
            io.to(room).emit('chat message', { username: userData.username, msg: msg.trim() });
        }
    });

    socket.on('typing', (data) => {
        const userData = activeUsers.get(socket.id);
        if (userData) {
            socket.to(data.room).emit('typing', `${userData.username} is typing...`);
        }
    });

    socket.on('project update', async ({ projectName, content }) => {
        await Project.updateOne({ name: projectName }, { content });
        socket.to(projectName).emit('project content', content);
    });

    socket.on('whiteboard update', async ({ projectName, content }) => {
        await Project.updateOne({ name: projectName }, { whiteboard: content });
        socket.to(projectName).emit('whiteboard content', content);
    });

    socket.on('disconnect', () => {
        const userData = activeUsers.get(socket.id);
        if (userData) {
            console.log(`🔌 User disconnected: ${userData.username}`);
            // Announce departure in all rooms the user was in
            userData.rooms.forEach(room => {
                io.to(room).emit('chat message', { username: 'System', msg: `${userData.username} has left.` });
                updateRoomUsers(room);
            });
            activeUsers.delete(socket.id);
        }
    });
});

// --- Server Start ---
server.listen(PORT, () => {
    console.log(`🚀 Server is live at http://localhost:${PORT}`);
});