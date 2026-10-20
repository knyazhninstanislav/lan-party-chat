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
        chatInfo.textContent = `Вы вошли как ${username}`;
        loadMessages(); updateUsersList();
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = setInterval(() => {
            if (isLoggedIn) { loadMessages(); updateUsersList(); sendHeartbeat(); }
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
    messageInput.disabled = true;
    sendBtn.disabled = true;
    chatInfo.textContent = silent ? 'Сессия истекла, войдите заново' : 'Вы вышли';
    messagesCache = []; usersCache = []; pendingAttachments = [];
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
        messageInput.disabled = false;
        sendBtn.disabled = false;
        loadMessages(); updateUsersList();
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = setInterval(() => {
            if (isLoggedIn) { loadMessages(); updateUsersList(); sendHeartbeat(); }
        }, 3000);
    }).catch(() => handleLogoutLocal(true));
} else {
    setTimeout(() => usernameInput.focus(), 500);
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

    apiFetch('/api/send', { method: 'POST', body: JSON.stringify(payload) })
        .then(() => {
            messageInput.value = '';
            pendingAttachments = [];
            updateAttachmentPreview();
            updateCharCount(); autoResizeTextarea(); messageInput.focus();
            cancelReply();
            setTimeout(loadMessages, 100);
            showNotification('✅', 'Тикет создан', '📋');
        })
        .catch(() => showNotification('Ошибка', 'Не удалось отправить', '⛔'));
}

function resetEditor() {
    editingMessageId = null;
    chatInput.classList.remove('editing');
    sendBtn.textContent = '🚀 Отправить';
    messageInput.placeholder = 'Опишите ваш вопрос или проблему...';
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
    const headers = { 'Authorization': 'Bearer ' + authToken };
    if (lastMessagesEtag) headers['If-None-Match'] = lastMessagesEtag;
    fetch('/api/messages', { headers, credentials: 'same-origin' })
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
    const today = formatCurrentDate();
    let sep = messagesContainer.querySelector('.date-separator');
    if (!sep || sep.textContent !== today) {
        if (sep) sep.remove();
        const s = document.createElement('div');
        s.className = 'date-separator';
        s.textContent = today;
        messagesContainer.insertBefore(s, messagesContainer.firstChild);
    }
    const existing = messagesContainer.querySelectorAll('.ticket');
    const existingIds = Array.from(existing).map(el => el.dataset.messageId);
    const newIds = messages.map(m => m.id);
    if (existingIds.length === newIds.length && existingIds.every((id, i) => id === newIds[i])) {
        existing.forEach((el, i) => updateTicketElement(el, messages[i]));
    } else {
        const frag = document.createDocumentFragment();
        messages.forEach(msg => frag.appendChild(createTicketElement(msg)));
        messagesContainer.innerHTML = '';
        const s = document.createElement('div');
        s.className = 'date-separator';
        s.textContent = today;
        messagesContainer.appendChild(s);
        messagesContainer.appendChild(frag);
    }
    scrollToBottom();
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
        <span class="ticket-time" title="${formatFullDate(msg.timestamp)}">${formatFullDate(msg.timestamp)}</span>
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
    const isImage = att.file_type && att.file_type.startsWith('image/');
    if (isImage) {
        const img = document.createElement('img');
        img.className = 'ticket-image';
        img.src = `data:${att.file_type};base64,${att.file_data}`;
        img.alt = att.filename;
        img.loading = 'lazy';
        img.onclick = () => openImageModal(img.src);
        el.appendChild(img);
    } else {
        const icon = getFileIcon(att.filename, att.file_type);
        el.innerHTML = `<div class="file-attachment">
            <span class="file-icon">${icon}</span>
            <span class="file-name">${escapeHtml(att.filename)}</span>
            <span class="file-size">${formatFileSize(att.file_size)}</span>
        </div>`;
        el.onclick = () => {
            apiFetch(`/api/attachment/${att.id}`).then(r => r.blob()).then(blob => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url; link.download = att.filename; link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            });
        };
    }
    return el;
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
            <span class="ticket-time">${formatFullDate(msg.timestamp)}</span>
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
// USERS
// ============================================================
function updateUsersList() {
    fetch('/api/users', { credentials: 'same-origin' })
        .then(r => r.json())
        .then(data => {
            const cur = usersCache.map(u => u.user_id).join(',');
            const neu = data.users.map(u => u.user_id).join(',');
            if (cur !== neu) {
                usersCache = data.users;
                updateUsers(data.users);
            }
        }).catch(() => {});
}

function updateUsers(users) {
    usersList.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        const initial = (user.username || '?').charAt(0).toUpperCase();
        const isMe = user.user_id === user_id && isLoggedIn;
        div.innerHTML = `
            <div class="avatar">${escapeHtml(initial)}</div>
            <span class="username">${escapeHtml(user.username)}${isMe ? ' <span class="me-badge">(вы)</span>' : ''}</span>
            <div class="status-dot"></div>`;
        const avatarEl = div.querySelector('.avatar');
        if (avatarEl) applyAvatarStyle(avatarEl, user.username);
        usersList.appendChild(div);
    });
    onlineCount.textContent = `${users.length} пользователей онлайн`;
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
function formatFullDate(timestamp) {
    if (!timestamp) return '';
    if (/^\d{2}:\d{2}:\d{2}$/.test(timestamp)) {
        const now = new Date();
        const d = String(now.getDate()).padStart(2,'0');
        const m = String(now.getMonth()+1).padStart(2,'0');
        const y = now.getFullYear();
        return `${d}.${m}.${y} ${timestamp}`;
    }
    return timestamp;
}
function formatCurrentDate() {
    const now = new Date();
    const days = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    return `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
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