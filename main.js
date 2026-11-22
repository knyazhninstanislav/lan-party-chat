// ============================================================
// APP STATE
// ============================================================
let username = '';
let user_id = '';
let authToken = localStorage.getItem('authToken') || '';
let updateInterval = null;
let editingMessageId = null;
let replyingTo = null;
let messagesCache = [];
let usersCache = [];
let isLoggedIn = false;
let pendingAttachments = [];
let lastMessagesEtag = '';
let activeChat = { type: 'public', peerId: null, peerName: '' };
let dmThreads = [];
let dmThreadsInitialized = false;
let usersSignature = '';

// ============================================================
// DOM
// ============================================================
const messagesContainer = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const usernameInput = document.getElementById('usernameInput');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const usernameContainer = document.getElementById('usernameContainer');
const usersList = document.getElementById('usersList');
const onlineCount = document.getElementById('onlineCount');
const chatInfo = document.getElementById('chatInfo');
const chatInput = document.getElementById('chatInput');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const logoutBtn = document.getElementById('logoutBtn');
const emojiBtn = document.getElementById('emojiBtn');
const emojiPicker = document.getElementById('emojiPicker');
const emojiGrid = document.getElementById('emojiGrid');
const replyIndicator = document.getElementById('replyIndicator');
const replyAuthor = document.getElementById('replyAuthor');
const replyText = document.getElementById('replyText');
const replyCancelBtn = document.getElementById('replyCancelBtn');
const charCount = document.getElementById('charCount');
const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const fileBtn = document.getElementById('fileBtn');
const fileInput = document.getElementById('fileInput');
const attachmentPreviewContainer = document.getElementById('attachmentPreviewContainer');
const notificationContainer = document.getElementById('notificationContainer');
const roomName = document.getElementById('roomName');
const publicChatBtn = document.getElementById('publicChatBtn');
const dmListEl = document.getElementById('dmList');
const currentUserBadge = document.getElementById('currentUserBadge');
const currentUserAvatar = document.getElementById('currentUserAvatar');
const currentUserName = document.getElementById('currentUserName');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

const MAX_MESSAGE_LENGTH = 2000;
const MAX_ATTACHMENTS = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// ============================================================
// ЦВЕТА АВАТАРОК (зависимость от имени)
// ============================================================
const AVATAR_GRADIENTS = [
    ['#667eea', '#764ba2'],
    ['#f093fb', '#f5576c'],
    ['#4facfe', '#00f2fe'],
    ['#43e97b', '#38f9d7'],
    ['#fa709a', '#fee140'],
    ['#30cfd0', '#330867'],
    ['#a8edea', '#fed6e3'],
    ['#ff9a9e', '#fecfef'],
    ['#ffecd2', '#fcb69f'],
    ['#ff8177', '#b12a5b'],
    ['#f6d365', '#fda085'],
    ['#5ee7df', '#b490ca'],
    ['#c471f5', '#fa71cd'],
    ['#48c6ef', '#6f86d6'],
    ['#0ba360', '#3cba92'],
    ['#f43b47', '#453a94'],
    ['#c79081', '#dfa579'],
    ['#8e2de2', '#4a00e0'],
    ['#00c6fb', '#005bea'],
    ['#f77062', '#fe5196'],
];

function getUserAvatarGradient(name) {
    if (!name) return AVATAR_GRADIENTS[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
    }
    const index = Math.abs(hash) % AVATAR_GRADIENTS.length;
    return AVATAR_GRADIENTS[index];
}

function applyAvatarStyle(el, name) {
    const [c1, c2] = getUserAvatarGradient(name);
    el.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
    el.style.boxShadow = `0 2px 8px ${c1}55`;
}

// ============================================================
// EMOJI
// ============================================================
const emojis = ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗','😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','😡','😠','🤬','😷','🤒','🤕','🤢','🤮','🥴','😇','🤠','🤡','🥳','🥺','🤥','🤫','🤭','🧐','🤓','😈','👿','👹','👺','💀','☠️','👻','👽','👾','🤖','💩','😺','😸','😹','😻','😼','😽','🙀','😿','😾','🙌','👏','👍','👎','👊','✊','🤛','🤜','👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','🫶','💪','🦾','🦵','🦿','🦶','👣','👀','👁️','🧠','🫀'];
emojis.forEach(emoji => {
    const item = document.createElement('div');
    item.className = 'emoji-item';
    item.textContent = emoji;
    item.onclick = () => { insertEmoji(emoji); emojiPicker.classList.remove('show'); };
    emojiGrid.appendChild(item);
});
emojiBtn.addEventListener('click', (e) => { e.stopPropagation(); emojiPicker.classList.toggle('show'); });
document.addEventListener('click', () => emojiPicker.classList.remove('show'));
emojiPicker.addEventListener('click', (e) => e.stopPropagation());

function insertEmoji(emoji) {
    const ta = messageInput;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.substring(0, s) + emoji + ta.value.substring(e);
    ta.focus();
    ta.setSelectionRange(s + emoji.length, s + emoji.length);
    updateCharCount(); autoResizeTextarea();
}

// ============================================================
// API HELPER
// ============================================================
function apiFetch(url, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(url, Object.assign({}, options, { headers, credentials: 'same-origin' }))
        .then(r => {
            if (r.status === 401) {
                handleLogoutLocal(true);
                throw new Error('unauthorized');
            }
            return r;
        });
}

// ============================================================
// FILE HANDLING
// ============================================================
fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    Array.from(e.target.files).forEach(addFile);
    fileInput.value = '';
});

function addFile(file) {
    if (pendingAttachments.length >= MAX_ATTACHMENTS) {
        showNotification('❌ Ошибка', 'Максимум 5 файлов', '⚠️'); return;
    }
    if (file.size > MAX_FILE_SIZE) {
        showNotification('❌ Ошибка', `Файл ${file.name} слишком большой (макс. 10MB)`, '⚠️'); return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
        pendingAttachments.push({
            data: ev.target.result, filename: file.name, type: file.type, size: file.size
        });
        updateAttachmentPreview();
    };
    reader.readAsDataURL(file);
}

document.addEventListener('paste', (e) => {
    for (const item of e.clipboardData.items) {
        if (pendingAttachments.length >= MAX_ATTACHMENTS) return;
        const file = item.getAsFile();
        if (file) addFile(file);
    }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
    e.preventDefault();
    for (const file of e.dataTransfer.files) addFile(file);
});

function updateAttachmentPreview() {
    attachmentPreviewContainer.innerHTML = '';
    if (pendingAttachments.length === 0) {
        attachmentPreviewContainer.classList.remove('show'); return;
    }
    attachmentPreviewContainer.classList.add('show');
    pendingAttachments.forEach((att, index) => {
        const item = document.createElement('div');
        item.className = 'preview-item';
        let icon = '📄';
        if (att.type.startsWith('image/')) icon = '';
        else if (att.type.startsWith('video/')) icon = '🎬';
        else if (att.type.startsWith('audio/')) icon = '🎵';
        else if (att.type.includes('pdf')) icon = '📕';
        else if (att.filename.endsWith('.docx')) icon = '📝';
        else if (att.filename.endsWith('.xlsx')) icon = '📊';
        else if (/\.(zip|rar|7z)$/.test(att.filename)) icon = '📦';

        let content;
        if (att.type.startsWith('image/')) {
            content = `<img src="${att.data}" alt="${escapeHtml(att.filename)}">`;
        } else {
            content = `<div class="file-preview">
                <div class="file-icon">${icon}</div>
                <div class="file-info">
                    <div class="file-name">${escapeHtml(att.filename)}</div>
                    <div class="file-size">${formatFileSize(att.size)}</div>
                </div>
            </div>`;
        }
        item.innerHTML = `${content}<button class="remove-attachment" data-index="${index}">×</button>`;
        item.querySelector('.remove-attachment').addEventListener('click', (e) => {
            e.stopPropagation();
            pendingAttachments.splice(index, 1);
            updateAttachmentPreview();
        });
        attachmentPreviewContainer.appendChild(item);
    });
}

// ============================================================
// AUTH — ТОЛЬКО ВХОД. Регистрация через admin_tool.py
// ============================================================
loginBtn.addEventListener('click', doLogin);
usernameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') doLogin(); });
passwordInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') doLogin(); });

function doLogin() {
    const name = usernameInput.value.trim();
    const pass = passwordInput.value;
    if (!name || !pass) { showNotification('Ошибка', 'Введите имя и пароль', '⚠️'); return; }

    loginBtn.disabled = true;
    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, password: pass }),
    }).then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Ошибка входа');
        return data;
    }).then(data => {
        authToken = data.token;
        username = data.username;
        user_id = data.user_id;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('chatUsername', username);
        isLoggedIn = true;
        usernameContainer.style.display = 'none';
        logoutBtn.style.display = 'flex';
        messageInput.disabled = false;
        sendBtn.disabled = false;
        passwordInput.value = '';
        messageInput.focus();
        chatInfo.textContent = 'Онлайн';
        updateCurrentUserBadge();
        clearHistoryBtn.style.display = 'flex';
        loadMessages(); updateUsersList(); updateDmThreads();
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = setInterval(() => {
            if (isLoggedIn) {
                loadMessages(); updateUsersList(); updateDmThreads(); sendHeartbeat();
            }
        }, 3000);
        requestNotificationPermission();
        showNotification('Успех', `Вы вошли как ${username}`, '👋');
    }).catch(err => {
        showNotification('Ошибка входа', err.message, '⛔');
        passwordInput.select();
    }).finally(() => { loginBtn.disabled = false; });
}

function handleLogoutLocal(silent = false) {
    isLoggedIn = false;
    if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }
    localStorage.removeItem('authToken');
    localStorage.removeItem('chatUsername');
    authToken = ''; username = ''; user_id = '';
    usernameContainer.style.display = 'flex';
    logoutBtn.style.display = 'none';
    clearHistoryBtn.style.display = 'none';
    updateCurrentUserBadge();
    messageInput.disabled = true;
    sendBtn.disabled = true;
    chatInfo.textContent = silent ? 'Сессия истекла, войдите заново' : 'Вы вышли';
    messagesCache = []; usersCache = []; pendingAttachments = [];
    markedReadIds.clear();
    resetChatState();
    updateAttachmentPreview(); cancelReply();
    messagesContainer.innerHTML = '';
    if (!silent) showNotification('Выход', 'Вы вышли из чата', '🚪');
    usernameInput.focus();
}

logoutBtn.addEventListener('click', () => {
    if (!confirm('Выйти?')) return;
    apiFetch('/api/logout', { method: 'POST' }).finally(() => handleLogoutLocal());
});

// Авто-вход по сохранённому токену
if (authToken) {
    fetch('/api/heartbeat', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + authToken },
        credentials: 'same-origin',
    }).then(r => {
        if (!r.ok) { handleLogoutLocal(true); return; }
        isLoggedIn = true;
        username = localStorage.getItem('chatUsername') || '';
        usernameContainer.style.display = 'none';
        logoutBtn.style.display = 'flex';
        clearHistoryBtn.style.display = 'flex';
        updateCurrentUserBadge();
        messageInput.disabled = false;
        sendBtn.disabled = false;
        loadMessages(); updateUsersList(); updateDmThreads();
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = setInterval(() => {
            if (isLoggedIn) {
                loadMessages(); updateUsersList(); updateDmThreads(); sendHeartbeat();
            }
        }, 3000);
    }).catch(() => handleLogoutLocal(true));
} else {
    setTimeout(() => usernameInput.focus(), 500);
}

function updateCurrentUserBadge() {
    if (!isLoggedIn || !username) {
        currentUserBadge.style.display = 'none';
        return;
    }
    currentUserBadge.style.display = 'flex';
    currentUserBadge.title = `Вы вошли как ${username}`;
    currentUserName.textContent = username;
    currentUserAvatar.textContent = username.charAt(0).toUpperCase();
    applyAvatarStyle(currentUserAvatar, username);
}

clearHistoryBtn.addEventListener('click', clearChatHistory);
function clearChatHistory() {
    if (!isLoggedIn) return;
    const isDm = activeChat.type === 'dm';
    const target = isDm
        ? `переписку с ${activeChat.peerName} (у обоих участников)`
        : 'общий чат (у всех участников)';
    if (!confirm(`Очистить ${target}? Все сообщения и вложения будут удалены безвозвратно.`)) return;

    const scope = isDm ? activeChat.peerId : 'public';
    clearHistoryBtn.disabled = true;
    apiFetch('/api/clear_history', { method: 'POST', body: JSON.stringify({ scope }) })
        .then(r => r.json())
        .then(data => {
            if (!data.success) throw new Error(data.error || 'Не удалось очистить');
            messagesCache = [];
            lastMessagesEtag = '';
            messagesContainer.innerHTML = '';
            markedReadIds.clear();
            loadMessages();
            updateDmThreads();
            showNotification('🧹', `История очищена (удалено: ${data.deleted})`, '🧹');
        })
        .catch(err => showNotification('Ошибка', err.message || 'Не удалось очистить', '⛔'))
        .finally(() => { clearHistoryBtn.disabled = false; });
}

function sendHeartbeat() {
    if (!isLoggedIn) return;
    apiFetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
}

// ============================================================
// REPLY
// ============================================================
function cancelReply() {
    replyingTo = null;
    replyIndicator.classList.remove('show');
    replyIndicator.style.display = 'none';
    messageInput.focus();
}
replyCancelBtn.addEventListener('click', cancelReply);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && replyingTo) cancelReply(); });

window.startReply = function(messageId) {
    if (!isLoggedIn) return;
    const msg = messagesCache.find(m => m.id === messageId);
    if (!msg) return;
    replyingTo = messageId;
    replyAuthor.textContent = msg.username;
    let content = (msg.attachments && msg.attachments.length > 0)
        ? `[${msg.attachments.length} файл(ов)]` : (msg.message || '');
    replyText.textContent = content.length > 60 ? content.substring(0, 60) + '...' : content;
    replyIndicator.classList.add('show');
    replyIndicator.style.display = 'flex';
    messageInput.focus();
    replyIndicator.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

// ============================================================
// SEND / EDIT
// ============================================================
function sendMessage() {
    const message = messageInput.value.trim();
    if (!message && pendingAttachments.length === 0 && !editingMessageId) return;
    if (!isLoggedIn) return;

    if (editingMessageId) {
        if (!message) { alert('Сообщение не может быть пустым'); return; }
        apiFetch('/api/edit', {
            method: 'POST',
            body: JSON.stringify({ message_id: editingMessageId, message })
        }).then(r => r.json()).then(data => {
            if (data.success) {
                resetEditor(); loadMessages();
                showNotification('✅', 'Сообщение обновлено', '✏️');
            }
        });
        return;
    }

    const payload = { message: message || '', attachments: pendingAttachments };
    if (replyingTo) payload.reply_to = replyingTo;
    if (activeChat.type === 'dm' && activeChat.peerId) payload.recipient_id = activeChat.peerId;

    apiFetch('/api/send', { method: 'POST', body: JSON.stringify(payload) })
        .then(() => {
            messageInput.value = '';
            pendingAttachments = [];
            updateAttachmentPreview();
            updateCharCount(); autoResizeTextarea(); messageInput.focus();
            cancelReply();
            setTimeout(() => { loadMessages(); updateDmThreads(); }, 100);
            showNotification('✅', activeChat.type === 'dm' ? 'Личное сообщение отправлено' : 'Тикет создан', '📋');
        })
        .catch(() => showNotification('Ошибка', 'Не удалось отправить', '⛔'));
}

function resetEditor() {
    editingMessageId = null;
    chatInput.classList.remove('editing');
    sendBtn.textContent = '🚀 Отправить';
    messageInput.placeholder = activeChat.type === 'dm'
        ? `Сообщение для ${activeChat.peerName}...` : 'Опишите ваш вопрос или проблему...';
    messageInput.value = '';
    pendingAttachments = [];
    updateAttachmentPreview();
    updateCharCount(); autoResizeTextarea();
    cancelReply();
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
cancelEditBtn.addEventListener('click', resetEditor);

window.editMessage = function(messageId) {
    if (!isLoggedIn) return;
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!el) return;
    let text = el.querySelector('.ticket-body').textContent.replace('(ред.)', '').trim();
    editingMessageId = messageId;
    messageInput.value = text;
    pendingAttachments = [];
    updateAttachmentPreview();
    updateCharCount(); autoResizeTextarea();
    messageInput.focus();
    chatInput.classList.add('editing');
    sendBtn.textContent = '💾 Сохранить';
    messageInput.placeholder = 'Редактирование...';
    chatInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.deleteMessage = function(messageId) {
    if (!isLoggedIn) return;
    if (!confirm('Удалить этот тикет?')) return;
    apiFetch('/api/delete', {
        method: 'POST',
        body: JSON.stringify({ message_id: messageId })
    }).then(r => r.json()).then(data => {
        if (data.success) {
            loadMessages();
            showNotification('🗑️', 'Тикет удалён', '🗑️');
        }
    });
};

window.toggleCompleted = function(messageId) {
    if (!isLoggedIn) return;
    apiFetch('/api/toggle_completed', {
        method: 'POST',
        body: JSON.stringify({ message_id: messageId })
    }).then(r => r.json()).then(data => {
        if (data.success) {
            const msg = messagesCache.find(m => m.id === messageId);
            if (msg) msg.completed = data.completed;
            const el = document.querySelector(`[data-message-id="${messageId}"]`);
            if (el) {
                el.classList.toggle('completed', data.completed === 1);
                const btn = el.querySelector('.complete-btn');
                if (btn) {
                    btn.classList.toggle('active', data.completed === 1);
                    btn.innerHTML = data.completed === 1 ? '✅ Выполнено' : '✓ Выполнено';
                }
            }
            showNotification(
                data.completed === 1 ? '✅ Тикет выполнен' : '↩️ Тикет возвращён',
                data.completed === 1 ? 'Отмечено как выполненное' : 'Статус сброшен',
                data.completed === 1 ? '✅' : '🔄');
        }
    });
};

// ============================================================
// MARK READ (с дедупликацией)
// ============================================================
const markedReadIds = new Set();
function markMessageAsRead(messageId) {
    if (!isLoggedIn || !user_id || markedReadIds.has(messageId)) return;
    markedReadIds.add(messageId);
    apiFetch('/api/mark_read', {
        method: 'POST',
        body: JSON.stringify({ message_id: messageId })
    }).catch(() => {});
}

// ============================================================
// LOAD MESSAGES (ETag)
// ============================================================
function loadMessages() {
    if (!isLoggedIn) return;
    const url = activeChat.type === 'dm'
        ? `/api/messages?with=${encodeURIComponent(activeChat.peerId)}`
        : '/api/messages';
    const headers = { 'Authorization': 'Bearer ' + authToken };
    if (lastMessagesEtag) headers['If-None-Match'] = lastMessagesEtag;
    fetch(url, { headers, credentials: 'same-origin' })
        .then(r => {
            if (r.status === 304) return null;
            if (r.status === 401) { handleLogoutLocal(true); return null; }
            lastMessagesEtag = r.headers.get('ETag') || lastMessagesEtag;
            return r.json();
        }).then(messages => {
            if (!messages) return;
            if (messagesCache.length > 0) {
                const oldIds = new Set(messagesCache.map(m => m.id));
                messages.forEach(msg => {
                    if (!oldIds.has(msg.id) && msg.username !== username) {
                        const content = (msg.attachments && msg.attachments.length > 0)
                            ? `[${msg.attachments.length} файл(ов)]` : (msg.message || '');
                        showNotification(`📩 ${msg.username}`,
                            content.length > 50 ? content.substring(0, 50) + '...' : content,
                            '💬');
                        notifyIfHidden(msg);
                    }
                });
            }
            messagesCache = messages;
            renderMessages(messages);
        }).catch(err => {
            if (err.message !== 'unauthorized') console.error(err);
        });
}

// ============================================================
// RENDER
// ============================================================
function renderMessages(messages) {
    if (!messages || messages.length === 0) {
        messagesContainer.innerHTML = ''; return;
    }
    const existing = messagesContainer.querySelectorAll('.ticket');
    const existingIds = Array.from(existing).map(el => el.dataset.messageId);
    const newIds = messages.map(m => m.id);
    if (existingIds.length === newIds.length && existingIds.every((id, i) => id === newIds[i])) {
        existing.forEach((el, i) => updateTicketElement(el, messages[i]));
    } else {
        const frag = document.createDocumentFragment();
        let prevDay = null;
        messages.forEach(msg => {
            const day = messageDayKey(msg);
            if (day !== prevDay) {
                frag.appendChild(createDateSeparator(msg));
                prevDay = day;
            }
            frag.appendChild(createTicketElement(msg));
        });
        messagesContainer.innerHTML = '';
        messagesContainer.appendChild(frag);
    }
    scrollToBottom();
}

function createDateSeparator(msg) {
    const sep = document.createElement('div');
    sep.className = 'date-separator';
    sep.dataset.day = messageDayKey(msg);
    sep.textContent = formatDayLabel(messageDate(msg));
    return sep;
}

function createTicketElement(msg) {
    const ticket = document.createElement('div');
    ticket.className = 'ticket';
    ticket.dataset.messageId = msg.id;
    const isOwn = msg.username === username && isLoggedIn;
    if (isOwn) ticket.classList.add('own');
    if (msg.completed === 1) ticket.classList.add('completed');

    const card = document.createElement('div');
    card.className = 'ticket-card';

    const header = document.createElement('div');
    header.className = 'ticket-header';
    const initial = (msg.username || '?').charAt(0).toUpperCase();
    header.innerHTML = `
        <div class="ticket-avatar">${escapeHtml(initial)}</div>
        <span class="ticket-author">${escapeHtml(msg.username)}</span>
        <span class="ticket-time" title="${formatFullDate(msg)}">${formatFullDate(msg)}</span>
        <span class="ticket-badge">${isOwn ? 'Мой' : 'Тикет'}</span>
        ${msg.completed === 1 ? '<span class="completed-badge">✅</span>' : ''}
        ${msg.read_count !== undefined ? `
            <span class="read-status ${msg.read_count > 0 ? 'read' : 'unread'}" title="Прочитано ${msg.read_count} раз">
                ${msg.read_count > 0 ? '✅' : '⏳'} ${msg.read_count > 0 ? msg.read_count : ''}
            </span>` : ''}
    `;
    const avatarEl = header.querySelector('.ticket-avatar');
    if (avatarEl) applyAvatarStyle(avatarEl, msg.username);

    if (msg.reply_to) {
        const replyMsg = messagesCache.find(m => m.id === msg.reply_to);
        if (replyMsg) {
            const reply = document.createElement('div');
            reply.className = 'ticket-reply';
            let content = (replyMsg.attachments && replyMsg.attachments.length > 0)
                ? `[${replyMsg.attachments.length} файл(ов)]` : (replyMsg.message || '');
            reply.innerHTML = `<span class="reply-author">${escapeHtml(replyMsg.username)}</span>
                <span class="reply-text">${escapeHtml(content.length > 60 ? content.substring(0, 60) + '...' : content)}</span>`;
            reply.onclick = () => scrollToMessage(msg.reply_to);
            card.appendChild(reply);
        }
    }

    const body = document.createElement('div');
    body.className = 'ticket-body';
    body.textContent = msg.message || '';
    if (msg.edited) body.innerHTML += ' <span class="edit-indicator">(ред.)</span>';

    if (msg.attachments && msg.attachments.length > 0) {
        const c = document.createElement('div');
        c.className = 'ticket-attachments';
        msg.attachments.forEach(att => c.appendChild(createAttachmentEl(att)));
        card.appendChild(c);
    }

    const actions = document.createElement('div');
    actions.className = 'ticket-actions';
    actions.innerHTML = `
        <button class="reply-btn" onclick="startReply('${msg.id}')">↩️ Ответить</button>
        <button class="complete-btn ${msg.completed === 1 ? 'active' : ''}" onclick="toggleCompleted('${msg.id}')">
            ${msg.completed === 1 ? '✅ Выполнено' : '✓ Выполнено'}
        </button>`;
    if (isOwn) {
        actions.innerHTML += `
            <button class="edit-btn" onclick="editMessage('${msg.id}')">✏️ Редактировать</button>
            <button class="delete-btn" onclick="deleteMessage('${msg.id}')">🗑️ Удалить</button>`;
    }
    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(actions);
    ticket.appendChild(card);
    if (!isOwn && msg.id) markMessageAsRead(msg.id);
    return ticket;
}

function createAttachmentEl(att) {
    const el = document.createElement('div');
    el.className = 'attachment-item';
    const isImage = att.file_type && att.file_type.startsWith('image/')
        && att.file_type !== 'image/svg+xml';
    if (isImage) {
        const img = document.createElement('img');
        img.className = 'ticket-image';
        img.src = attachmentUrl(att, false);
        img.alt = att.filename;
        img.loading = 'lazy';
        img.onclick = () => openImageModal(img.src);
        el.appendChild(img);
    } else {
        const icon = getFileIcon(att.filename, att.file_type);
        el.innerHTML = `<a class="file-attachment" href="${attachmentUrl(att, true)}"
            download="${escapeHtml(att.filename)}">
            <span class="file-icon">${icon}</span>
            <span class="file-name">${escapeHtml(att.filename)}</span>
            <span class="file-size">${formatFileSize(att.file_size)}</span>
        </a>`;
    }
    return el;
}

function attachmentUrl(att, download) {
    const token = encodeURIComponent(authToken);
    return `/api/attachment/${att.id}?token=${token}` + (download ? '&download=1' : '');
}

function updateTicketElement(el, msg) {
    const card = el.querySelector('.ticket-card');
    if (!card) return;
    const isOwn = msg.username === username && isLoggedIn;
    el.className = `ticket${isOwn ? ' own' : ''}${msg.completed === 1 ? ' completed' : ''}`;

    const header = card.querySelector('.ticket-header');
    if (header) {
        const initial = (msg.username || '?').charAt(0).toUpperCase();
        const readHtml = msg.read_count !== undefined ? `
            <span class="read-status ${msg.read_count > 0 ? 'read' : 'unread'}" title="Прочитано ${msg.read_count} раз">
                ${msg.read_count > 0 ? '✅' : '⏳'} ${msg.read_count > 0 ? msg.read_count : ''}
            </span>` : '';
        header.innerHTML = `
            <div class="ticket-avatar">${escapeHtml(initial)}</div>
            <span class="ticket-author">${escapeHtml(msg.username)}</span>
            <span class="ticket-time">${formatFullDate(msg)}</span>
            <span class="ticket-badge">${isOwn ? 'Мой' : 'Тикет'}</span>
            ${msg.completed === 1 ? '<span class="completed-badge">✅</span>' : ''}
            ${readHtml}`;
        const avatarEl = header.querySelector('.ticket-avatar');
        if (avatarEl) applyAvatarStyle(avatarEl, msg.username);
    }
    const body = card.querySelector('.ticket-body');
    if (body) {
        body.textContent = msg.message || '';
        if (msg.edited) body.innerHTML += ' <span class="edit-indicator">(ред.)</span>';
    }
    const actions = card.querySelector('.ticket-actions');
    if (actions) {
        actions.innerHTML = `
            <button class="reply-btn" onclick="startReply('${msg.id}')">↩️ Ответить</button>
            <button class="complete-btn ${msg.completed === 1 ? 'active' : ''}" onclick="toggleCompleted('${msg.id}')">
                ${msg.completed === 1 ? '✅ Выполнено' : '✓ Выполнено'}
            </button>`;
        if (isOwn) {
            actions.innerHTML += `
                <button class="edit-btn" onclick="editMessage('${msg.id}')">✏️ Редактировать</button>
                <button class="delete-btn" onclick="deleteMessage('${msg.id}')">🗑️ Удалить</button>`;
        }
    }
    if (!isOwn && msg.id) markMessageAsRead(msg.id);
}

function scrollToMessage(id) {
    const el = document.querySelector(`[data-message-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const card = el.querySelector('.ticket-card');
    if (card) {
        card.style.borderColor = 'var(--accent-primary)';
        setTimeout(() => { card.style.borderColor = ''; }, 2000);
    }
}

// ============================================================
// ЧАТЫ (общий / личные)
// ============================================================
publicChatBtn.addEventListener('click', () => switchChat('public', null, ''));

function switchChat(type, peerId, peerName) {
    if (type === 'dm' && (!peerId || peerId === user_id)) return;
    activeChat = { type, peerId: peerId || null, peerName: peerName || '' };
    lastMessagesEtag = '';
    messagesCache = [];
    messagesContainer.innerHTML = '';
    publicChatBtn.classList.toggle('active', type === 'public');
    roomName.textContent = type === 'dm' ? `💬 ${peerName}` : '📢 Дискорд для бедных';
    messageInput.placeholder = type === 'dm'
        ? `Сообщение для ${peerName}...` : 'Опишите ваш вопрос или проблему...';
    cancelReply();
    renderDmList();
    messageInput.focus();
    loadMessages();
}

window.openDm = function(peerId, peerName) {
    if (!isLoggedIn || peerId === user_id) return;
    switchChat('dm', peerId, peerName);
};

function resetChatState() {
    activeChat = { type: 'public', peerId: null, peerName: '' };
    dmThreads = [];
    dmThreadsInitialized = false;
    usersSignature = '';
    lastMessagesEtag = '';
    publicChatBtn.classList.add('active');
    roomName.textContent = '📢 Дискорд для бедных';
    dmListEl.innerHTML = '';
}

// ============================================================
// USERS
// ============================================================
function updateUsersList() {
    apiFetch('/api/users')
        .then(r => r.json())
        .then(data => {
            const users = data.users || [];
            const sig = users.map(u =>
                `${u.user_id}:${u.online ? 1 : 0}:${Math.floor((u.last_seen || 0) / 60)}`
            ).join(',');
            if (sig !== usersSignature) {
                usersSignature = sig;
                usersCache = users;
                updateUsers(users);
            }
        }).catch(() => {});
}

function lastSeenText(ts) {
    if (!ts) return 'давно';
    const d = new Date(ts * 1000);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60) return 'только что';
    if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const pad = n => String(n).padStart(2, '0');
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (sameDay(d, now)) return `сегодня в ${hm}`;
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (sameDay(d, yesterday)) return `вчера в ${hm}`;
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} в ${hm}`;
}

function updateUsers(users) {
    usersList.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        const isMe = user.user_id === user_id && isLoggedIn;
        div.className = 'user-item' + (user.online ? ' online' : ' offline')
            + (isMe ? ' is-me' : '');
        div.title = user.online ? 'В сети' : `Был(а) в сети: ${lastSeenText(user.last_seen)}`;
        const initial = (user.username || '?').charAt(0).toUpperCase();
        div.innerHTML = `
            <div class="avatar">${escapeHtml(initial)}</div>
            <div class="user-meta">
                <span class="username">${escapeHtml(user.username)}${isMe ? ' <span class="me-badge">(вы)</span>' : ''}</span>
                <span class="user-status">${user.online ? 'в сети' : 'был(а) ' + lastSeenText(user.last_seen)}</span>
            </div>
            <div class="status-dot ${user.online ? 'online' : 'offline'}"></div>`;
        const avatarEl = div.querySelector('.avatar');
        if (avatarEl) applyAvatarStyle(avatarEl, user.username);
        if (!isMe) {
            div.style.cursor = 'pointer';
            div.addEventListener('click', () => openDm(user.user_id, user.username));
        }
        usersList.appendChild(div);
    });
    const online = users.filter(u => u.online).length;
    onlineCount.textContent = `${online} пользователей онлайн`;
}

// ============================================================
// ЛИЧНЫЕ СООБЩЕНИЯ (список диалогов)
// ============================================================
function updateDmThreads() {
    if (!isLoggedIn) return;
    apiFetch('/api/dm_threads')
        .then(r => r.json())
        .then(data => {
            const threads = data.threads || [];
            if (dmThreadsInitialized) {
                threads.forEach(t => {
                    const prev = dmThreads.find(x => x.peer_id === t.peer_id);
                    const prevUnread = prev ? prev.unread : 0;
                    const isActive = activeChat.type === 'dm' && activeChat.peerId === t.peer_id;
                    if (t.unread > prevUnread && !isActive && t.last_sender_id !== user_id) {
                        const snippet = t.message
                            ? (t.message.length > 50 ? t.message.substring(0, 50) + '...' : t.message)
                            : '📎 Вложение';
                        showNotification(`💬 ${t.peer_username}`, snippet, '💬');
                        if (document.hidden && 'Notification' in window
                            && Notification.permission === 'granted') {
                            const notif = new Notification(`💬 ${t.peer_username}`, {
                                body: snippet, icon: '/favicon.ico', tag: 'dm-' + t.peer_id
                            });
                            notif.onclick = () => {
                                window.focus(); notif.close();
                                openDm(t.peer_id, t.peer_username);
                            };
                        }
                    }
                });
            }
            dmThreads = threads;
            dmThreadsInitialized = true;
            renderDmList();
        }).catch(() => {});
}

function formatShortTime(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const now = new Date();
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const pad = n => String(n).padStart(2, '0');
    if (sameDay(d, now)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}

function renderDmList() {
    dmListEl.innerHTML = '';
    if (dmThreads.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'dm-empty';
        empty.textContent = 'Нажмите на пользователя, чтобы написать в личку';
        dmListEl.appendChild(empty);
        return;
    }
    dmThreads.forEach(t => {
        const div = document.createElement('div');
        const active = activeChat.type === 'dm' && activeChat.peerId === t.peer_id;
        div.className = 'dm-item' + (active ? ' active' : '');
        const initial = (t.peer_username || '?').charAt(0).toUpperCase();
        const snippet = t.message || (t.has_attachment ? '📎 Вложение' : '');
        const prefix = t.last_sender_id === user_id ? 'Вы: ' : '';
        div.innerHTML = `
            <div class="avatar">${escapeHtml(initial)}</div>
            <div class="dm-meta">
                <div class="dm-top">
                    <span class="dm-name">${escapeHtml(t.peer_username)}</span>
                    <span class="dm-time">${formatShortTime(t.last_at)}</span>
                </div>
                <div class="dm-bottom">
                    <span class="dm-preview">${escapeHtml(prefix + (snippet.length > 34 ? snippet.substring(0, 34) + '...' : snippet))}</span>
                    ${t.unread > 0 ? `<span class="unread-badge">${t.unread > 99 ? '99+' : t.unread}</span>` : ''}
                </div>
            </div>
            <div class="status-dot ${t.peer_online ? 'online' : 'offline'}"></div>`;
        const avatarEl = div.querySelector('.avatar');
        if (avatarEl) applyAvatarStyle(avatarEl, t.peer_username);
        div.addEventListener('click', () => openDm(t.peer_id, t.peer_username));
        dmListEl.appendChild(div);
    });
}

// ============================================================
// NOTIFICATIONS
// ============================================================
function showNotification(title, text, icon = '🔔') {
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.innerHTML = `
        <span class="notif-icon">${icon}</span>
        <div class="notif-content">
            <div class="notif-title">${escapeHtml(title)}</div>
            <div class="notif-text">${escapeHtml(text)}</div>
        </div>
        <button class="notif-close">×</button>`;
    notif.querySelector('.notif-close').addEventListener('click', () => notif.remove());
    notificationContainer.appendChild(notif);
    setTimeout(() => {
        if (notif.parentNode) {
            notif.style.opacity = '0';
            notif.style.transition = 'opacity 0.3s';
            setTimeout(() => notif.remove(), 300);
        }
    }, 5000);
}

let unreadNotifications = 0;
const originalTitle = document.title;
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { unreadNotifications = 0; document.title = originalTitle; }
});

function notifyIfHidden(msg) {
    if (!document.hidden) return;
    unreadNotifications++;
    document.title = `(${unreadNotifications}) ${originalTitle}`;
    if ('Notification' in window && Notification.permission === 'granted') {
        const content = (msg.attachments && msg.attachments.length > 0)
            ? `[${msg.attachments.length} файл(ов)]` : (msg.message || '');
        const notif = new Notification(`📩 ${msg.username}`, {
            body: content.length > 100 ? content.substring(0, 100) + '...' : content,
            icon: '/favicon.ico', tag: msg.id
        });
        notif.onclick = () => { window.focus(); notif.close(); scrollToMessage(msg.id); };
    }
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// ============================================================
// IMAGE MODAL
// ============================================================
function openImageModal(src) { modalImage.src = src; imageModal.classList.add('show'); }
function closeImageModal() { imageModal.classList.remove('show'); }
window.closeImageModal = closeImageModal;

// ============================================================
// HELPERS
// ============================================================
function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}
function updateCharCount() {
    const len = messageInput.value.length;
    charCount.textContent = len > 0 ? len : '0';
    charCount.style.color = len > MAX_MESSAGE_LENGTH ? '#f87171' : 'var(--text-muted)';
}
function updateSendButton() {
    const hasText = messageInput.value.trim().length > 0;
    sendBtn.disabled = !(hasText || pendingAttachments.length > 0) || !isLoggedIn;
}
messageInput.addEventListener('input', () => {
    updateCharCount(); autoResizeTextarea(); updateSendButton();
});

function getFileIcon(filename, fileType) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (fileType && fileType.startsWith('image/')) return '🖼️';
    if (fileType && fileType.startsWith('video/')) return '🎬';
    if (fileType && fileType.startsWith('audio/')) return '🎵';
    const icons = {pdf:'📕', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', ppt:'📽️', pptx:'📽️',
        zip:'📦', rar:'📦', '7z':'📦', txt:'📄', mp3:'🎵', wav:'🎵', mp4:'🎬', avi:'🎬',
        mkv:'🎬', exe:'⚙️', dmg:'💿', iso:'💿'};
    return icons[ext] || '📄';
}
function messageDate(msg) {
    if (!msg) return null;
    if (msg.created_at) {
        const d = new Date(msg.created_at * 1000);
        if (!isNaN(d.getTime())) return d;
    }
    if (msg.timestamp) {
        // Полная дата, если сервер когда-нибудь начнёт отдавать timestamp с датой
        const d = new Date(String(msg.timestamp).replace(' ', 'T'));
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}

function messageDayKey(msg) {
    const d = messageDate(msg);
    if (!d) return '';
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatFullDate(msg) {
    const d = messageDate(msg);
    if (!d) return (msg && msg.timestamp) || '';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} `
        + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDayLabel(date) {
    if (!date) return '';
    const days = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const now = new Date();
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    let prefix = '';
    if (sameDay(date, now)) prefix = 'Сегодня, ';
    else if (sameDay(date, yesterday)) prefix = 'Вчера, ';
    return `${prefix}${days[date.getDay()]}, ${date.getDate()} `
        + `${months[date.getMonth()]} ${date.getFullYear()}`;
}
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ============================================================
// INIT
// ============================================================
updateSendButton();