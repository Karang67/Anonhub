// frontend/js/chat.js

function getCookie(name) {
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    const cookie = cookies[i].trim();
    if (cookie.startsWith(name + '=')) {
      return decodeURIComponent(cookie.substring(name.length + 1));
    }
  }
  return null;
}

const savedUsername = getCookie('anonhub-username') || sessionStorage.getItem('anonhub-username');
const socket = io({
  auth: {
    username: savedUsername
  }
});
const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const typingIndicator = document.getElementById('typing-indicator');
const roomInfo = document.getElementById('room-info');
const userList = document.getElementById('user-list');
let username = '';

const path = window.location.pathname.split('/');
const currentRoom = (path.length > 2 && path[1] === 'chat') ? decodeURIComponent(path[2]) : 'general';
roomInfo.textContent = `Room: ${currentRoom}`;
socket.emit('join room', currentRoom);

function getAvatarColor(name) {
  if (!name) name = 'Anonymous';
  const colors = [
    '#A93F55', // Primary modern
    '#2E4052', // Dark slate
    '#3B7A57', // Amazon green
    '#8F6BBF', // Violet
    '#D97A53', // Terracotta
    '#4A7C59', // Sage green
    '#61A5C2', // Blue
    '#D9A05B'  // Ochre
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

function formatTime(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  let hours = date.getHours();
  let minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  minutes = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutes} ${ampm}`;
}

function appendMessage(data) {
  const isSystem = data.username === 'System';
  const item = document.createElement('li');

  if (isSystem) {
    item.className = 'system-bubble-wrapper';
    const bubble = document.createElement('div');
    bubble.className = 'system-bubble';
    bubble.textContent = data.msg;
    item.appendChild(bubble);
  } else {
    const isOutgoing = data.username === username;
    item.className = `message-bubble-wrapper ${isOutgoing ? 'outgoing' : 'incoming'}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    const sender = document.createElement('span');
    sender.className = 'bubble-sender';
    sender.textContent = data.username;
    
    const content = document.createElement('span');
    content.className = 'bubble-content';
    content.textContent = data.msg;
    
    const time = document.createElement('span');
    time.className = 'bubble-time';
    time.textContent = formatTime(data.timestamp);
    
    bubble.appendChild(sender);
    bubble.appendChild(content);
    bubble.appendChild(time);
    item.appendChild(bubble);
  }
  
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
}

socket.on('set username', (name) => {
  username = name;
  document.cookie = `anonhub-username=${encodeURIComponent(name)}; path=/; SameSite=Lax`;
  sessionStorage.setItem('anonhub-username', name);
});

socket.on('load messages', (messagesArray) => {
  messages.innerHTML = '';
  if (Array.isArray(messagesArray)) {
    messagesArray.forEach((data) => appendMessage(data));
  }
});

socket.on('chat message', (data) => {
  typingIndicator.textContent = '';
  appendMessage(data);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = input.value.trim();
  if (msg) {
    socket.emit('room message', { room: currentRoom, msg: msg });
    input.value = '';
  }
});

let typingTimeout;
input.addEventListener('input', () => {
  if (input.value) {
    socket.emit('typing', { room: currentRoom });
  }
});

let typingClearTimeout;
socket.on('typing', (msg) => {
  typingIndicator.textContent = msg;
  clearTimeout(typingClearTimeout);
  typingClearTimeout = setTimeout(() => {
    typingIndicator.textContent = '';
  }, 4000);
});

socket.on('room users', (usersArray) => {
  userList.innerHTML = '';
  if (Array.isArray(usersArray)) {
    usersArray.forEach((user) => {
      const item = document.createElement('li');
      item.className = 'user-contact-card';

      const avatar = document.createElement('div');
      avatar.className = 'contact-avatar';
      avatar.style.backgroundColor = getAvatarColor(user.username);
      avatar.textContent = user.username ? user.username.charAt(0).toUpperCase() : '?';

      const info = document.createElement('div');
      info.className = 'contact-info';

      const nameRow = document.createElement('div');
      nameRow.className = 'contact-name-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'contact-name';
      nameSpan.textContent = user.username;
      if (user.username === username) {
        nameSpan.textContent += ' (You)';
      }

      const indicator = document.createElement('span');
      indicator.className = 'online-indicator';

      nameRow.appendChild(nameSpan);
      nameRow.appendChild(indicator);

      const statusRow = document.createElement('div');
      statusRow.className = 'contact-status-row';

      const statusSpan = document.createElement('span');
      statusSpan.className = 'contact-status';
      statusSpan.textContent = 'online';

      statusRow.appendChild(statusSpan);

      info.appendChild(nameRow);
      info.appendChild(statusRow);

      item.appendChild(avatar);
      item.appendChild(info);

      userList.appendChild(item);
    });
  }
});

socket.on('connect_error', () => {
  appendMessage({ username: 'System', msg: '⚠️ Connection lost. Attempting to reconnect...' });
});

socket.on('connect', () => {
  appendMessage({ username: 'System', msg: '✅ Reconnected successfully.' });
});

// Mobile Sidebar Toggle
document.addEventListener('DOMContentLoaded', () => {
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const chatSidebar = document.querySelector('.chat-sidebar');
  
  if (sidebarToggle && chatSidebar) {
    sidebarToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      chatSidebar.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (!chatSidebar.contains(e.target) && e.target !== sidebarToggle) {
        chatSidebar.classList.remove('active');
      }
    });
  }
});
