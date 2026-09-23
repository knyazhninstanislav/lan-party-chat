// ============================================================
// APP STATE
// ============================================================
let username = '';
let user_id = '';
let updateInterval = null;
let editingMessageId = null;
let replyingTo = null;
let messagesCache = [];
let usersCache = [];
let isLoggedIn = false;
let pendingAttachments = []; // Теперь храним все файлы

// ============================================================
// DOM ELEMENTS
// ============================================================
const messagesContainer = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const usernameInput = document.getElementById('usernameInput');
const setUsernameBtn = document.getElementById('setUsernameBtn');
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
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ============================================================
// EMOJI DATA
// ============================================================
const emojis = [
    '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆', '😉', '😊',
    '😋', '😎', '😍', '🥰', '😘', '😗', '😙', '😚', '🙂', '🤗',
    '🤩', '🤔', '🤨', '😐', '😑', '😶', '🙄', '😏', '😣', '😥',
    '😮', '🤐', '😯', '😪', '😫', '😴', '😌', '😛', '😜', '😝',
    '🤤', '😒', '😓', '😔', '😕', '🙃', '🤑', '😲', '☹️', '🙁',
    '😖', '😞', '😟', '😤', '😢', '😭', '😦', '😧', '😨', '😩',
    '🤯', '😬', '😰', '😱', '🥵', '🥶', '😳', '🤪', '😵', '😡',
    '😠', '🤬', '😷', '🤒', '🤕', '🤢', '🤮', '🥴', '😇', '🤠',
    '🤡', '🥳', '🥺', '🤥', '🤫', '🤭', '🧐', '🤓', '😈', '👿',
    '👹', '👺', '💀', '☠️', '👻', '👽', '👾', '🤖', '💩', '😺',
    '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🙌', '👏',
    '👍', '👎', '👊', '✊', '🤛', '🤜', '👋', '🤚', '🖐️', '✋',
    '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '🫶',
    '💪', '🦾', '🦵', '🦿', '🦶', '👣', '👀', '👁️', '🧠', '🫀'
];

// ============================================================
// BUILD EMOJI GRID
// ============================================================
emojis.forEach(emoji => {
    const item = document.createElement('div');
    item.className = 'emoji-item';
    item.textContent = emoji;
    item.onclick = () => {
        insertEmoji(emoji);
        emojiPicker.classList.remove('show');
    };
    emojiGrid.appendChild(item);
});

// ============================================================
// EMOJI PICKER
// ============================================================
emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle('show');
});

document.addEventListener('click', () => {
    emojiPicker.classList.remove('show');
});

emojiPicker.addEventListener('click', (e) => {
    e.stopPropagation();
});

function insertEmoji(emoji) {
    const textarea = messageInput;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    textarea.value = text.substring(0, start) + emoji + text.substring(end);
    textarea.focus();
    const newPos = start + emoji.length;
    textarea.setSelectionRange(newPos, newPos);
    updateCharCount();
    autoResizeTextarea();
}

// ============================================================
// FILE HANDLING
// ============================================================
fileBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
        if (pendingAttachments.length < MAX_ATTACHMENTS) {
            // Проверяем размер
            if (file.size > MAX_FILE_SIZE) {
                showNotification('❌ Ошибка', `Файл ${file.name} слишком большой (макс. 10MB)`, '⚠️');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target.result;
                pendingAttachments.push({
                    data: dataUrl,
                    filename: file.name,
                    type: file.type,
                    size: file.size
                });
                updateAttachmentPreview();
            };
            reader.readAsDataURL(file);
        } else {
            showNotification('❌ Ошибка', 'Максимум 5 файлов за раз', '⚠️');
        }
    });
    fileInput.value = '';
});

// ============================================================
// TOGGLE COMPLETED
// ============================================================
window.toggleCompleted = function(messageId) {
    if (!isLoggedIn) return;

    fetch('/api/toggle_completed', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            message_id: messageId,
            username: username
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Обновляем кэш
            const msg = messagesCache.find(m => m.id === messageId);
            if (msg) msg.completed = data.completed;

            // Обновляем DOM
            const el = document.querySelector(`[data-message-id="${messageId}"]`);
            if (el) {
                el.classList.toggle('completed', data.completed === 1);
                const btn = el.querySelector('.complete-btn');
                if (btn) {
                    btn.classList.toggle('active', data.completed === 1);
                    btn.innerHTML = data.completed === 1
                        ? '✅ Выполнено'
                        : '✓ Выполнено';
                }
            }

            showNotification(
                data.completed === 1 ? '✅ Тикет выполнен' : '↩️ Тикет возвращен',
                data.completed === 1 ? 'Отмечено как выполненное' : 'Статус сброшен',
                data.completed === 1 ? '✅' : '🔄'
            );
        }
    });
};

function updateAttachmentPreview() {
    attachmentPreviewContainer.innerHTML = '';
    if (pendingAttachments.length === 0) {
        attachmentPreviewContainer.classList.remove('show');
        return;
    }
    attachmentPreviewContainer.classList.add('show');
    
    pendingAttachments.forEach((att, index) => {
        const item = document.createElement('div');
        item.className = 'preview-item';
        
        // Определяем иконку по типу файла
        let icon = '📄';
        if (att.type.startsWith('image/')) {
            icon = '';
        } else if (att.type.startsWith('video/')) {
            icon = '🎬';
        } else if (att.type.startsWith('audio/')) {
            icon = '🎵';
        } else if (att.type.includes('pdf')) {
            icon = '📕';
        } else if (att.type.includes('word') || att.filename.endsWith('.docx')) {
            icon = '📝';
        } else if (att.type.includes('excel') || att.filename.endsWith('.xlsx')) {
            icon = '📊';
        } else if (att.type.includes('zip') || att.filename.endsWith('.zip') || att.filename.endsWith('.rar')) {
            icon = '📦';
        }
        
        let content = '';
        if (att.type.startsWith('image/')) {
            content = `<img src="${att.data}" alt="${att.filename}">`;
        } else {
            const fileSize = (att.size / 1024).toFixed(1);
            const sizeUnit = fileSize > 1024 ? 'MB' : 'KB';
            const displaySize = fileSize > 1024 ? (fileSize / 1024).toFixed(1) : fileSize;
            content = `
                <div class="file-preview">
                    <div class="file-icon">${icon}</div>
                    <div class="file-info">
                        <div class="file-name">${escapeHtml(att.filename)}</div>
                        <div class="file-size">${displaySize} ${sizeUnit}</div>
                    </div>
                </div>
            `;
        }
        
        item.innerHTML = `
            ${content}
            <button class="remove-attachment" data-index="${index}">×</button>
        `;
        
        item.querySelector('.remove-attachment').addEventListener('click', (e) => {
            e.stopPropagation();
            pendingAttachments.splice(index, 1);
            updateAttachmentPreview();
        });
        
        attachmentPreviewContainer.appendChild(item);
    });
}

// Paste files
document.addEventListener('paste', (e) => {
    const items = e.clipboardData.items;
    for (const item of items) {
        if (pendingAttachments.length < MAX_ATTACHMENTS) {
            // Обрабатываем как файл
            const file = item.getAsFile();
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    pendingAttachments.push({
                        data: event.target.result,
                        filename: `paste_${Date.now()}.${file.type.split('/')[1] || 'file'}`,
                        type: file.type,
                        size: file.size
                    });
                    updateAttachmentPreview();
                };
                reader.readAsDataURL(file);
                break;
            }
        }
    }
});

// Drag and drop
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    for (const file of files) {
        if (pendingAttachments.length < MAX_ATTACHMENTS) {
            const reader = new FileReader();
            reader.onload = (event) => {
                pendingAttachments.push({
                    data: event.target.result,
                    filename: file.name,
                    type: file.type,
                    size: file.size
                });
                updateAttachmentPreview();
            };
            reader.readAsDataURL(file);
        }
    }
});

// ============================================================
// IMAGE MODAL
// ============================================================
function openImageModal(src) {
    modalImage.src = src;
    imageModal.classList.add('show');
}

function closeImageModal() {
    imageModal.classList.remove('show');
}

// ============================================================
// NOTIFICATIONS
// ============================================================
function showNotification(title, text, icon = '🔔') {
    const container = notificationContainer;
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.innerHTML = `
        <span class="notif-icon">${icon}</span>
        <div class="notif-content">
            <div class="notif-title">${escapeHtml(title)}</div>
            <div class="notif-text">${escapeHtml(text)}</div>
        </div>
        <button class="notif-close">×</button>
    `;
    notif.querySelector('.notif-close').addEventListener('click', () => {
        notif.remove();
    });
    container.appendChild(notif);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notif.parentNode) {
            notif.style.opacity = '0';
            notif.style.transition = 'opacity 0.3s';
            setTimeout(() => notif.remove(), 300);
        }
    }, 5000);
}

// ============================================================
// TEXTAREA FUNCTIONS
// ============================================================
function autoResizeTextarea() {
    const textarea = messageInput;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function updateCharCount() {
    const len = messageInput.value.length;
    charCount.textContent = len > 0 ? len : '0';
    charCount.style.color = len > MAX_MESSAGE_LENGTH ? '#f87171' : 'var(--text-muted)';
}

messageInput.addEventListener('input', () => {
    updateCharCount();
    autoResizeTextarea();
    updateSendButton();
});

function updateSendButton() {
    const hasText = messageInput.value.trim().length > 0;
    const hasAttachments = pendingAttachments.length > 0;
    sendBtn.disabled = !(hasText || hasAttachments) || !isLoggedIn;
}

// ============================================================
// AUTH FUNCTIONS
// ============================================================
const savedUsername = localStorage.getItem('chatUsername');
const savedUserId = localStorage.getItem('chatUserId');

if (savedUsername && savedUserId) {
    usernameInput.value = savedUsername;
    user_id = savedUserId;
    checkUserStatus();
}

function checkUserStatus() {
    fetch('/api/users')
        .then(response => response.json())
        .then(data => {
            const userExists = data.users.some(u => u.user_id === user_id);
            if (userExists) {
                setUsername();
            } else {
                localStorage.removeItem('chatUsername');
                localStorage.removeItem('chatUserId');
                usernameContainer.style.display = 'flex';
                logoutBtn.style.display = 'none';
                messageInput.disabled = true;
                sendBtn.disabled = true;
                chatInfo.textContent = 'Сессия истекла, войдите заново';
            }
        });
}

function setUsername() {
    const name = usernameInput.value.trim();
    if (!name) { alert('Пожалуйста, введите имя'); return; }
    
    username = name;
    localStorage.setItem('chatUsername', username);
    
    fetch('/api/users', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: name, user_id: user_id})
    })
    .then(response => response.json())
    .then(data => {
        username = data.username;
        user_id = data.user_id;
        localStorage.setItem('chatUserId', user_id);
        isLoggedIn = true;
        
        usernameContainer.style.display = 'none';
        logoutBtn.style.display = 'flex';
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.focus();
        
        usersCache = data.users;
        updateUsers(data.users);
        loadMessages();
        
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = setInterval(() => {
            if (isLoggedIn) {
                loadMessages();
                updateUsersList();
                sendHeartbeat();
            }
        }, 3000);
        
        chatInfo.textContent = `Вы вошли как ${username}`;
        addSystemMessage(`👋 ${username} присоединился к чату`);
        requestNotificationPermission()
        showNotification('Привет :)', `Вы вошли как ${username}`, '👋');
    });
}

setUsernameBtn.addEventListener('click', setUsername);
usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') setUsername();
});

function logout() {
    if (!confirm(`Точно хочешь выйти, ${username}?`)) return;
    
    isLoggedIn = false;
    
    fetch('/api/logout', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ user_id: user_id, username: username })
    }).catch(() => {});
    
    localStorage.removeItem('chatUsername');
    localStorage.removeItem('chatUserId');
    
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    
    usernameContainer.style.display = 'flex';
    logoutBtn.style.display = 'none';
    messageInput.disabled = true;
    sendBtn.disabled = true;
    messageInput.value = '';
    chatInfo.textContent = 'Вы вышли из чата';
    
    messagesCache = [];
    usersCache = [];
    pendingAttachments = [];
    updateAttachmentPreview();
    cancelReply();
    
    addSystemMessage(`👋 ${username} ливнул из чата`);
    updateUsersList();
    
    username = '';
    user_id = '';
    
    usernameInput.focus();
}

logoutBtn.addEventListener('click', logout);

// ============================================================
// REPLY FUNCTIONS
// ============================================================
function cancelReply() {
    replyingTo = null;
    replyIndicator.classList.remove('show');
    replyIndicator.style.display = 'none';
    messageInput.focus();
}

function startReply(messageId) {
    if (!isLoggedIn) return;
    const msg = messagesCache.find(m => m.id === messageId);
    if (!msg) return;
    
    replyingTo = messageId;
    replyAuthor.textContent = msg.username;
    let content = '';
    if (msg.attachments && msg.attachments.length > 0) {
        content = `[${msg.attachments.length} файл(ов)]`;
    } else {
        content = msg.message || '';
    }
    replyText.textContent = content.length > 60 ? content.substring(0, 60) + '...' : content;
    replyIndicator.classList.add('show');
    replyIndicator.style.display = 'flex';
    messageInput.focus();
    
    replyIndicator.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

replyCancelBtn.addEventListener('click', cancelReply);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && replyingTo) {
        cancelReply();
    }
});

// ============================================================
// SEND / EDIT MESSAGE
// ============================================================
function sendMessage() {
    const message = messageInput.value.trim();
    if (!message && pendingAttachments.length === 0 && !editingMessageId) return;
    if (!username || !isLoggedIn) return;
    
    if (editingMessageId) {
        const newMessage = messageInput.value.trim();
        if (!newMessage) {
            alert('Сообщение не может быть пустым');
            return;
        }
        fetch('/api/edit', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                message_id: editingMessageId,
                message: newMessage,
                username: username
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                editingMessageId = null;
                chatInput.classList.remove('editing');
                sendBtn.innerHTML = '🚀 Создать';
                messageInput.placeholder = 'Пиши чего-нибудь...';
                messageInput.value = '';
                pendingAttachments = [];
                updateAttachmentPreview();
                updateCharCount();
                autoResizeTextarea();
                cancelReply();
                loadMessages();
                showNotification('✅ Сообщение обновлено', 'Вы успешно отредактировали сообщение', '✏️');
            } else {
                alert(data.error || 'Ошибка редактирования');
            }
        });
        return;
    }
    
    const payload = {
        username: username,
        message: message || '',
        user_id: user_id,
        attachments: pendingAttachments
    };
    
    if (replyingTo) {
        payload.reply_to = replyingTo;
    }
    
    fetch('/api/send', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    })
    .then(() => {
        messageInput.value = '';
        pendingAttachments = [];
        updateAttachmentPreview();
        updateCharCount();
        autoResizeTextarea();
        messageInput.focus();
        cancelReply();
        setTimeout(loadMessages, 100);
        showNotification('✅ Тикет создан', 'Ваше сообщение ушло', '📋');
    });
}

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// ============================================================
// EDIT / DELETE
// ============================================================
cancelEditBtn.addEventListener('click', () => {
    editingMessageId = null;
    chatInput.classList.remove('editing');
    sendBtn.innerHTML = '🚀';
    messageInput.placeholder = 'Пиши сюда';
    messageInput.value = '';
    pendingAttachments = [];
    updateAttachmentPreview();
    updateCharCount();
    autoResizeTextarea();
    messageInput.focus();
});

window.editMessage = function(messageId) {
    if (!isLoggedIn) return;
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageElement) return;
    
    const bodyElement = messageElement.querySelector('.ticket-body');
    let text = bodyElement.textContent;
    text = text.replace('(ред.)', '').trim();
    
    editingMessageId = messageId;
    messageInput.value = text;
    pendingAttachments = [];
    updateAttachmentPreview();
    updateCharCount();
    autoResizeTextarea();
    messageInput.focus();
    chatInput.classList.add('editing');
    sendBtn.innerHTML = '💾';
    messageInput.placeholder = 'Редактирование сообщения...';
    
    chatInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

window.deleteMessage = function(messageId) {
    if (!isLoggedIn) return;
    if (!confirm('Удалить этот тикет?')) return;
    
    fetch('/api/delete', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            message_id: messageId,
            username: username
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadMessages();
            showNotification('🗑️ Тикет удален', 'Сообщение было удалено', '🗑️');
        } else {
            alert(data.error || 'Ошибка удаления');
        }
    });
};

// ============================================================
// READ RECEIPTS
// ============================================================
function markMessageAsRead(messageId) {
    if (!isLoggedIn || !user_id) return;
    fetch('/api/mark_read', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            message_id: messageId,
            user_id: user_id
        })
    });
}

// ============================================================
// LOAD & RENDER MESSAGES (ОПТИМИЗИРОВАННАЯ ВЕРСИЯ - БЕЗ МОРГАНИЯ)
// ============================================================
function loadMessages() {
    if (!isLoggedIn) return;
    fetch('/api/messages')
        .then(response => response.json())
        .then(messages => {
            // Проверяем, изменились ли данные
            const currentIds = messagesCache.map(m => m.id).join(',');
            const newIds = messages.map(m => m.id).join(',');
            
            // Если изменился состав сообщений - полный ререндер
            if (currentIds !== newIds) {
                // Проверяем новые сообщения для уведомлений
                if (messagesCache.length > 0) {
                     const newMessages = messages.filter(m => !messagesCache.some(c => c.id === m.id));
          newMessages.forEach(msg => {
        if (msg.username !== username) {
            let content = '';
            if (msg.attachments && msg.attachments.length > 0) {
                content = `[${msg.attachments.length} файл(ов)]`;
            } else {
                content = msg.message || '';
            }

            // Всплывашка внутри приложения
            showNotification(
                `📩 ${msg.username}`,
                content.length > 50 ? content.substring(0, 50) + '...' : content,
                '💬'
            );

            // Browser notification + title, если вкладка неактивна
            notifyIfHidden(msg);
        }
      });
}
                
                messagesCache = messages;
                renderMessages(messages);
                return;
            }
            
            // Если состав не изменился, проверяем изменения в существующих сообщениях
            let needsUpdate = false;
            for (let i = 0; i < messages.length; i++) {
                const oldMsg = messagesCache[i];
                const newMsg = messages[i];
                
                // Проверяем изменения в тексте, редактировании, ответах, вложениях и прочтениях
                if (oldMsg.message !== newMsg.message ||
                    oldMsg.edited !== newMsg.edited ||
                    oldMsg.reply_to !== newMsg.reply_to ||
                    oldMsg.read_count !== newMsg.read_count ||
                    (oldMsg.attachments && oldMsg.attachments.length !== newMsg.attachments?.length)) {
                    needsUpdate = true;
                    break;
                }
            }
            
            if (needsUpdate) {
                messagesCache = messages;
                renderMessages(messages);
            }
        })
        .catch(err => console.error('Ошибка загрузки сообщений:', err));
}

// ============================================================
// RENDER MESSAGES (ОПТИМИЗИРОВАННАЯ ВЕРСИЯ - БЕЗ МОРГАНИЯ)
// ============================================================
function renderMessages(messages) {
    // Если сообщений нет, очищаем контейнер
    if (!messages || messages.length === 0) {
        messagesContainer.innerHTML = '';
        return;
    }

    const today = formatCurrentDate();
    const existingSeparator = messagesContainer.querySelector('.date-separator');

    if (!existingSeparator || existingSeparator.textContent !== today) {
        // Удаляем старый разделитель, если есть
        if (existingSeparator) existingSeparator.remove();

        // Вставляем новый в начало
        const separator = document.createElement('div');
        separator.className = 'date-separator';
        separator.textContent = today;
        messagesContainer.insertBefore(separator, messagesContainer.firstChild);
        lastRenderedDate = today;
    }

    // Проверяем, нужно ли обновлять существующие элементы или создавать новые
    const existingElements = messagesContainer.querySelectorAll('.ticket');
    const existingIds = Array.from(existingElements).map(el => el.dataset.messageId);
    const newIds = messages.map(m => m.id);
    
    // Если количество элементов совпадает и все ID совпадают - обновляем содержимое
    if (existingIds.length === newIds.length && existingIds.every((id, i) => id === newIds[i])) {
        // Обновляем существующие элементы
        existingElements.forEach((el, index) => {
            const msg = messages[index];
            updateTicketElement(el, msg);
        });
    } else {
        // Полная перерисовка
        messagesContainer.innerHTML = '';
        messages.forEach((msg) => {
            const ticket = createTicketElement(msg);
            messagesContainer.appendChild(ticket);
        });
    }
    
    scrollToBottom();
}

// ============================================================
// CREATE TICKET ELEMENT (новый элемент)
// ============================================================
function createTicketElement(msg) {
    const ticket = document.createElement('div');
    ticket.className = 'ticket';
    ticket.dataset.messageId = msg.id;
    
    const isOwn = msg.username === username && isLoggedIn;
    if (isOwn) ticket.classList.add('own');
    if (msg.completed === 1) ticket.classList.add('completed');
    
    const card = document.createElement('div');
    card.className = 'ticket-card';
    
    // Header

    const header = document.createElement('div');
    header.className = 'ticket-header';
    const initial = msg.username.charAt(0).toUpperCase();
    header.innerHTML = `
        <div class="ticket-avatar">${escapeHtml(initial)}</div>
        <span class="ticket-author">${escapeHtml(msg.username)}</span>
        <span class="ticket-time" title="${formatFullDate(msg.timestamp)}">
            ${formatFullDate(msg.timestamp)}
        </span>
        <span class="ticket-badge">${isOwn ? 'Мой' : 'Тикет'}</span>
        ${msg.read_count !== undefined ? `
            <span class="read-status ${msg.read_count > 0 ? 'read' : 'unread'}" 
                  title="Прочитано ${msg.read_count} раз">
                ${msg.read_count > 0 ? '✅' : '⏳'}
                ${msg.read_count > 0 ? msg.read_count : ''}
            </span>
        ` : ''}
    `;
    
    // Reply preview
    if (msg.reply_to) {
        const replyMsg = messagesCache.find(m => m.id === msg.reply_to);
        if (replyMsg) {
            const reply = document.createElement('div');
            reply.className = 'ticket-reply';
            let content = '';
            if (replyMsg.attachments && replyMsg.attachments.length > 0) {
                content = `[${replyMsg.attachments.length} файл(ов)]`;
            } else {
                content = replyMsg.message || '';
            }
            reply.innerHTML = `
                <span class="reply-author">${escapeHtml(replyMsg.username)}</span>
                <span class="reply-text">${escapeHtml(content.length > 60 ? content.substring(0, 60) + '...' : content)}</span>
            `;
            reply.onclick = () => {
                const el = document.querySelector(`[data-message-id="${msg.reply_to}"]`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.querySelector('.ticket-card').style.borderColor = 'var(--accent-primary)';
                    setTimeout(() => {
                        el.querySelector('.ticket-card').style.borderColor = '';
                    }, 2000);
                }
            };
            card.appendChild(reply);
        }
    }
    
    // Body
    const body = document.createElement('div');
    body.className = 'ticket-body';
    body.textContent = msg.message || '';
    if (msg.edited) {
        body.innerHTML += ' <span class="edit-indicator">(ред.)</span>';
    }
    
    // Attachments
    if (msg.attachments && msg.attachments.length > 0) {
        const attachmentsContainer = document.createElement('div');
        attachmentsContainer.className = 'ticket-attachments';
        
        msg.attachments.forEach(att => {
            const attElement = document.createElement('div');
            attElement.className = 'attachment-item';
            
            const isImage = att.file_type && att.file_type.startsWith('image/');
            
            if (isImage) {
                const img = document.createElement('img');
                img.className = 'ticket-image';
                img.src = `data:${att.file_type};base64,${att.file_data}`;
                img.alt = att.filename;
                img.onclick = () => openImageModal(img.src);
                attElement.appendChild(img);
            } else {
                const icon = getFileIcon(att.filename, att.file_type);
                attElement.innerHTML = `
                    <div class="file-attachment">
                        <span class="file-icon">${icon}</span>
                        <span class="file-name">${escapeHtml(att.filename)}</span>
                        <span class="file-size">${formatFileSize(att.file_size)}</span>
                    </div>
                `;
                attElement.onclick = () => {
                    const link = document.createElement('a');
                    link.href = `/api/attachment/${att.id}`;
                    link.download = att.filename;
                    link.click();
                };
            }
            
            attachmentsContainer.appendChild(attElement);
        });
        
        card.appendChild(attachmentsContainer);
    }
    
    // Actions
    const actions = document.createElement('div');
    actions.className = 'ticket-actions';
    actions.innerHTML = `
        <button class="reply-btn" onclick="startReply('${msg.id}')" title="Ответить">
            	↩️ Ответить
        </button>

     <button class="complete-btn ${msg.completed === 1 ? 'active' : ''}"
                onclick="toggleCompleted('${msg.id}')"
                title="${msg.completed === 1 ? 'Снять отметку' : 'Отметить как выполненное'}">
            <i class="${msg.completed === 1 ? '✅' : '✓'}"></i>
            ${msg.completed === 1 ? '✅ Выполнено' : '✓ Выполнено'}
        </button>
    `;

    if (isOwn) {
        actions.innerHTML += `
            <button class="edit-btn" onclick="editMessage('${msg.id}')" title="Редактировать">
                ✏️ Редактировать
            </button>
            <button class="delete-btn" onclick="deleteMessage('${msg.id}')" title="Удалить">
                🗑️ Удалить
            </button>
        `;
    }
    
    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(actions);
    ticket.appendChild(card);
    
    // Отмечаем сообщение как прочитанное
    if (!isOwn && msg.id) {
        markMessageAsRead(msg.id);
    }
    
    return ticket;
}

// ============================================================
// UPDATE TICKET ELEMENT (обновление существующего)
// ============================================================
function updateTicketElement(ticketElement, msg) {
    const card = ticketElement.querySelector('.ticket-card');
    if (!card) return;
    
    const isOwn = msg.username === username && isLoggedIn;
    ticketElement.className = `ticket${isOwn ? ' own' : ''}`;
    
    // Обновляем header
    const header = card.querySelector('.ticket-header');
    if (header) {
        const initial = msg.username.charAt(0).toUpperCase();
        let readStatusHtml = '';
        if (msg.read_count !== undefined) {
            readStatusHtml = `
                <span class="read-status ${msg.read_count > 0 ? 'read' : 'unread'}" 
                      title="Прочитано ${msg.read_count} раз">
                    ${msg.read_count > 0 ? '✅' : '⏳'}
                    ${msg.read_count > 0 ? msg.read_count : ''}
                </span>
            `;
        }
        header.innerHTML = `
            <div class="ticket-avatar">${escapeHtml(initial)}</div>
            <span class="ticket-author">${escapeHtml(msg.username)}</span>
            <span class="ticket-time">${msg.timestamp}</span>
            <span class="ticket-badge">${isOwn ? 'Мой' : 'Тикет'}</span>
              ${msg.completed === 1 ? '<span class="completed-badge">✅</span>' : ''}
            ${readStatusHtml}
        `;
    }
    
    // Обновляем reply (если есть)
    const existingReply = card.querySelector('.ticket-reply');
    if (msg.reply_to) {
        const replyMsg = messagesCache.find(m => m.id === msg.reply_to);
        if (replyMsg) {
            if (existingReply) {
                // Обновляем существующий
                let content = '';
                if (replyMsg.attachments && replyMsg.attachments.length > 0) {
                    content = `[${replyMsg.attachments.length} файл(ов)]`;
                } else {
                    content = replyMsg.message || '';
                }
                existingReply.innerHTML = `
                    <span class="reply-author">${escapeHtml(replyMsg.username)}</span>
                    <span class="reply-text">${escapeHtml(content.length > 60 ? content.substring(0, 60) + '...' : content)}</span>
                `;
            } else {
                // Создаем новый
                const reply = document.createElement('div');
                reply.className = 'ticket-reply';
                let content = '';
                if (replyMsg.attachments && replyMsg.attachments.length > 0) {
                    content = `[${replyMsg.attachments.length} файл(ов)]`;
                } else {
                    content = replyMsg.message || '';
                }
                reply.innerHTML = `
                    <span class="reply-author">${escapeHtml(replyMsg.username)}</span>
                    <span class="reply-text">${escapeHtml(content.length > 60 ? content.substring(0, 60) + '...' : content)}</span>
                `;
                reply.onclick = () => {
                    const el = document.querySelector(`[data-message-id="${msg.reply_to}"]`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.querySelector('.ticket-card').style.borderColor = 'var(--accent-primary)';
                        setTimeout(() => {
                            el.querySelector('.ticket-card').style.borderColor = '';
                        }, 2000);
                    }
                };
                card.insertBefore(reply, card.querySelector('.ticket-body'));
            }
        }
    } else {
        if (existingReply) {
            existingReply.remove();
        }
    }
    
    // Обновляем body
    const body = card.querySelector('.ticket-body');
    if (body) {
        body.textContent = msg.message || '';
        if (msg.edited) {
            body.innerHTML += ' <span class="edit-indicator">(ред.)</span>';
        }
    }
    
    // Обновляем attachments
    const existingAttachments = card.querySelector('.ticket-attachments');
    if (msg.attachments && msg.attachments.length > 0) {
        if (existingAttachments) {
            // Обновляем существующий контейнер
            existingAttachments.innerHTML = '';
            msg.attachments.forEach(att => {
                const attElement = document.createElement('div');
                attElement.className = 'attachment-item';
                
                const isImage = att.file_type && att.file_type.startsWith('image/');
                
                if (isImage) {
                    const img = document.createElement('img');
                    img.className = 'ticket-image';
                    img.src = `data:${att.file_type};base64,${att.file_data}`;
                    img.alt = att.filename;
                    img.onclick = () => openImageModal(img.src);
                    attElement.appendChild(img);
                } else {
                    const icon = getFileIcon(att.filename, att.file_type);
                    attElement.innerHTML = `
                        <div class="file-attachment">
                            <span class="file-icon">${icon}</span>
                            <span class="file-name">${escapeHtml(att.filename)}</span>
                            <span class="file-size">${formatFileSize(att.file_size)}</span>
                        </div>
                    `;
                    attElement.onclick = () => {
                        const link = document.createElement('a');
                        link.href = `/api/attachment/${att.id}`;
                        link.download = att.filename;
                        link.click();
                    };
                }
                
                existingAttachments.appendChild(attElement);
            });
        } else {
            // Создаем новый контейнер
            const attachmentsContainer = document.createElement('div');
            attachmentsContainer.className = 'ticket-attachments';
            
            msg.attachments.forEach(att => {
                const attElement = document.createElement('div');
                attElement.className = 'attachment-item';
                
                const isImage = att.file_type && att.file_type.startsWith('image/');
                
                if (isImage) {
                    const img = document.createElement('img');
                    img.className = 'ticket-image';
                    img.src = `data:${att.file_type};base64,${att.file_data}`;
                    img.alt = att.filename;
                    img.onclick = () => openImageModal(img.src);
                    attElement.appendChild(img);
                } else {
                    const icon = getFileIcon(att.filename, att.file_type);
                    attElement.innerHTML = `
                        <div class="file-attachment">
                            <span class="file-icon">${icon}</span>
                            <span class="file-name">${escapeHtml(att.filename)}</span>
                            <span class="file-size">${formatFileSize(att.file_size)}</span>
                        </div>
                    `;
                    attElement.onclick = () => {
                        const link = document.createElement('a');
                        link.href = `/api/attachment/${att.id}`;
                        link.download = att.filename;
                        link.click();
                    };
                }
                
                attachmentsContainer.appendChild(attElement);
            });
            
            card.insertBefore(attachmentsContainer, card.querySelector('.ticket-actions'));
        }
    } else {
        if (existingAttachments) {
            existingAttachments.remove();
        }
    }
    
    // Обновляем actions
    const actions = card.querySelector('.ticket-actions');
    if (actions) {
        actions.innerHTML = `
            <button class="reply-btn" onclick="startReply('${msg.id}')" title="Ответить">
                	↩️ Ответить
            </button>
            <button class="complete-btn ${msg.completed === 1 ? 'active' : ''}"
                    onclick="toggleCompleted('${msg.id}')"
                    title="${msg.completed === 1 ? 'Снять отметку' : 'Отметить как выполненное'}">
                <i class=" ${msg.completed === 1 ? '✅' : '✓'}"></i>
                ${msg.completed === 1 ? 'Выполнено' : 'Выполнено'}
            </button>
        `;
        if (isOwn) {
            actions.innerHTML += `
                <button class="edit-btn" onclick="editMessage('${msg.id}')" title="Редактировать">
                    ✏️ Редактировать
                </button>
                <button class="delete-btn" onclick="deleteMessage('${msg.id}')" title="Удалить">
                    🗑️ Удалить
                </button>
            `;
        }
    }
    
    // Отмечаем сообщение как прочитанное
    if (!isOwn && msg.id) {
        markMessageAsRead(msg.id);
    }
}

let lastRenderedDate = '';

function ensureDateSeparator() {
    const today = formatCurrentDate();
    if (lastRenderedDate !== today) {
        const separator = document.createElement('div');
        separator.className = 'date-separator';
        separator.textContent = today;
        messagesContainer.appendChild(separator);
        lastRenderedDate = today;
    }
}


// ============================================================
// USERS
// ============================================================
function updateUsersList() {
    if (!isLoggedIn) {
        fetch('/api/users')
            .then(response => response.json())
            .then(data => {
                usersCache = data.users;
                updateUsers(data.users);
            });
        return;
    }
    fetch('/api/users')
        .then(response => response.json())
        .then(data => {
            const currentUsers = usersCache.map(u => u.user_id).join(',');
            const newUsers = data.users.map(u => u.user_id).join(',');
            
            if (currentUsers !== newUsers) {
                usersCache = data.users;
                updateUsers(data.users);
            }
        });
}

function updateUsers(users) {
    usersList.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        const initial = user.username.charAt(0).toUpperCase();
        const isCurrentUser = user.user_id === user_id && isLoggedIn;
        div.innerHTML = `
            <div class="avatar">${escapeHtml(initial)}</div>
            <span class="username">${escapeHtml(user.username)}${isCurrentUser ? ' <span class="me-badge">(вы)</span>' : ''}</span>
            <div class="status-dot"></div>
        `;
        usersList.appendChild(div);
    });
    
    onlineCount.textContent = `${users.length} пользователей онлайн`;
}

// ============================================================
// HEARTBEAT
// ============================================================
function sendHeartbeat() {
    if (!user_id || !isLoggedIn) return;
    fetch('/api/heartbeat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ user_id: user_id })
    }).catch(() => {});
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function getFileIcon(filename, fileType) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'pdf': '📕',
        'doc': '📝',
        'docx': '📝',
        'xls': '📊',
        'xlsx': '📊',
        'ppt': '📽️',
        'pptx': '📽️',
        'zip': '📦',
        'rar': '📦',
        '7z': '📦',
        'txt': '📄',
        'mp3': '🎵',
        'wav': '🎵',
        'mp4': '🎬',
        'avi': '🎬',
        'mkv': '🎬',
        'exe': '⚙️',
        'dmg': '💿',
        'iso': '💿'
    };
    if (fileType && fileType.startsWith('image/')) return '🖼️';
    if (fileType && fileType.startsWith('video/')) return '🎬';
    if (fileType && fileType.startsWith('audio/')) return '🎵';
    return icons[ext] || '📄';
}


// ============================================================
// DATE HELPERS
// ============================================================
function formatFullDate(timestamp) {
    // timestamp вида "14:30:25" или полная дата
    if (!timestamp) return '';

    // Если это только время (HH:MM:SS) — добавляем текущую дату
    if (/^\d{2}:\d{2}:\d{2}$/.test(timestamp)) {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        return `${day}.${month}.${year} ${timestamp}`;
    }

    return timestamp;
}

function formatCurrentDate() {
    const now = new Date();
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда',
                  'четверг', 'пятница', 'суббота'];
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}


function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ============================================================
// ADD SYSTEM MESSAGE
// ============================================================
function addSystemMessage(text) {
    const ticket = document.createElement('div');
    ticket.className = 'ticket system';
    const card = document.createElement('div');
    card.className = 'ticket-card';
    const body = document.createElement('div');
    body.className = 'ticket-body';
    body.textContent = text;
    card.appendChild(body);
    ticket.appendChild(card);
    messagesContainer.appendChild(ticket);
    scrollToBottom();
}

// ============================================================
// PAGE VISIBILITY & TITLE NOTIFICATION
// ============================================================
let unreadNotifications = 0;
const originalTitle = document.title;

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // Пользователь вернулся — сбрасываем счётчик
        unreadNotifications = 0;
        document.title = originalTitle;
    }
});

function notifyIfHidden(msg) {
    if (document.hidden) {
        unreadNotifications++;
        document.title = `(${unreadNotifications}) ${originalTitle}`;

        // Browser Notification API (если разрешено)
        if ('Notification' in window && Notification.permission === 'granted') {
            let content = '';
            if (msg.attachments && msg.attachments.length > 0) {
                content = `[${msg.attachments.length} файл(ов)]`;
            } else {
                content = msg.message || '';
            }

            const notif = new Notification(`📩 ${msg.username}`, {
                body: content.length > 100 ? content.substring(0, 100) + '...' : content,
                icon: '/favicon.ico',
                tag: msg.id
            });

            notif.onclick = () => {
                window.focus();
                notif.close();
                // Прокрутка к сообщению
                const el = document.querySelector(`[data-message-id="${msg.id}"]`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            };
        }
    }
}

// Запрос разрешения на уведомления при входе
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// ============================================================
// INIT
// ============================================================
if (!savedUsername) {
    setTimeout(() => usernameInput.focus(), 500);
}

setInterval(sendHeartbeat, 10000);
setInterval(updateUsersList, 5000);

// Initial update
updateSendButton();