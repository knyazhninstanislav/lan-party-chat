import http.server
import json
import time
from datetime import datetime
import threading
import uuid
import sqlite3
import os
import base64
from urllib.parse import urlparse

# Инициализация базы данных
DB_PATH = 'chat.db'

def init_db():
    """Создание таблиц в базе данных"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Таблица пользователей
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            last_seen REAL NOT NULL,
            created_at REAL DEFAULT (strftime('%s', 'now'))
        )
    ''')
    
    # Таблица сообщений
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            user_id TEXT NOT NULL,
            message TEXT,
            timestamp TEXT NOT NULL,
            edited INTEGER DEFAULT 0,
            edit_time TEXT,
            reply_to TEXT,
            created_at REAL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
    ''')
    
    # Таблица вложений (файлов)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            file_data TEXT NOT NULL,
            file_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            created_at REAL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )
    ''')
    
    # Таблица прочитанных сообщений
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS read_receipts (
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            read_at REAL DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY (message_id, user_id),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
    ''')

    # В функции init_db() completed в таблицу messages:
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            user_id TEXT NOT NULL,
            message TEXT,
            timestamp TEXT NOT NULL,
            edited INTEGER DEFAULT 0,
            edit_time TEXT,
            reply_to TEXT,
            completed INTEGER DEFAULT 0,          -- НОВОЕ
            created_at REAL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
    ''')

    # Миграция для существующих БД (добавить колонку, если её нет)
    try:
        cursor.execute('ALTER TABLE messages ADD COLUMN completed INTEGER DEFAULT 0')
    except sqlite3.OperationalError:
        pass  # Колонка уже существует
    
    conn.commit()
    conn.close()

# Инициализация при первом импорте
init_db()

# Кэш для быстрого доступа
messages_cache = []
users_cache = {}
message_lock = threading.Lock()
user_lock = threading.Lock()
last_db_sync = 0
SYNC_INTERVAL = 2  # секунды

def sync_from_db():
    """Синхронизация кэша с базой данных"""
    global messages_cache, users_cache, last_db_sync
    
    current_time = time.time()
    if current_time - last_db_sync < SYNC_INTERVAL:
        return
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Загрузка пользователей
    cursor.execute('SELECT user_id, username, last_seen FROM users')
    users_cache = {row['user_id']: dict(row) for row in cursor.fetchall()}
    
    # Загрузка сообщений с вложениями
    cursor.execute('''
        SELECT m.*, GROUP_CONCAT(a.id) as attachment_ids
        FROM messages m
        LEFT JOIN attachments a ON m.id = a.message_id
        GROUP BY m.id
        ORDER BY m.created_at DESC
        LIMIT 100
    ''')
    
    messages_cache = []
    for row in cursor.fetchall():
        msg = dict(row)
        msg['attachments'] = []
        if msg['attachment_ids']:
            # Загружаем вложения для этого сообщения
            cursor.execute('''
                SELECT id, filename, file_data, file_type, file_size
                FROM attachments
                WHERE message_id = ?
            ''', (msg['id'],))
            attachments = cursor.fetchall()
            msg['attachments'] = [dict(a) for a in attachments]
        
        messages_cache.append(msg)
    
    conn.close()
    last_db_sync = current_time

def generate_id():
    return str(uuid.uuid4())[:8]

def get_active_users(timeout=15):
    current_time = time.time()
    active_users = []
    with user_lock:
        for user_id, data in users_cache.items():
            if current_time - data['last_seen'] < timeout:
                active_users.append({
                    'username': data['username'],
                    'user_id': user_id
                })
    return active_users

def get_message_read_count(message_id):
    """Получить количество прочитавших сообщение"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT COUNT(DISTINCT user_id) as read_count
        FROM read_receipts
        WHERE message_id = ?
    ''', (message_id,))
    result = cursor.fetchone()
    conn.close()
    return result[0] if result else 0

def mark_message_read(message_id, user_id):
    """Отметить сообщение как прочитанное"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT OR IGNORE INTO read_receipts (message_id, user_id)
        VALUES (?, ?)
    ''', (message_id, user_id))
    conn.commit()
    conn.close()

class ChatHandler(http.server.BaseHTTPRequestHandler):
    """Обработчик HTTP запросов"""
    
    def read_template(self):
        with open('template.html', 'r', encoding='utf-8') as file:
            html_content = file.read()
        return html_content
    
    def do_GET(self):
        parsed_path = urlparse(self.path)
        
        if parsed_path.path == '/':
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(self.read_template().encode('utf-8'))
            
        elif parsed_path.path == '/style.css':
            try:
                with open('style.css', 'r', encoding='utf-8') as file:
                    css_content = file.read()
                self.send_response(200)
                self.send_header('Content-type', 'text/css; charset=utf-8')
                self.end_headers()
                self.wfile.write(css_content.encode('utf-8'))
            except FileNotFoundError:
                self.send_error(404, 'File not found')

        elif parsed_path.path == '/font-awesome-6.0.0-all-min.css':
            try:
                with open('font-awesome-6.0.0-all-min.css', 'r', encoding='utf-8') as file:
                    css_content = file.read()
                self.send_response(200)
                self.send_header('Content-type', 'text/css; charset=utf-8')
                self.end_headers()
                self.wfile.write(css_content.encode('utf-8'))
            except FileNotFoundError:
                self.send_error(404, 'File not found')
                
        elif parsed_path.path == '/main.js':
            try:
                with open('main.js', 'r', encoding='utf-8') as file:
                    js_content = file.read()
                self.send_response(200)
                self.send_header('Content-type', 'application/javascript; charset=utf-8')
                self.end_headers()
                self.wfile.write(js_content.encode('utf-8'))
            except FileNotFoundError:
                self.send_error(404, 'File not found')
            
        elif parsed_path.path == '/api/messages':
            sync_from_db()
            messages_to_send = []
            for msg in messages_cache:
                msg_copy = msg.copy()
                if 'attachment_ids' in msg_copy:
                    del msg_copy['attachment_ids']
                # Добавляем количество прочитавших
                msg_copy['read_count'] = get_message_read_count(msg['id'])
                msg_copy['completed'] = msg.get('completed', 0)
                messages_to_send.append(msg_copy)
            
            response = json.dumps(messages_to_send[::-1])  # В правильном порядке
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(response.encode())
            
        elif parsed_path.path == '/api/users':
            active_users = get_active_users()
            response = json.dumps({'users': active_users})
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(response.encode())
            
        elif parsed_path.path.startswith('/api/attachment/'):
            # Отдаем файл по ID
            file_id = parsed_path.path.split('/')[-1]
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute('''
                SELECT filename, file_data, file_type
                FROM attachments
                WHERE id = ?
            ''', (file_id,))
            result = cursor.fetchone()
            conn.close()
            
            if result:
                filename, file_data, file_type = result
                self.send_response(200)
                self.send_header('Content-type', file_type)
                self.send_header('Content-Disposition', f'inline; filename="{filename}"')
                self.end_headers()
                self.wfile.write(base64.b64decode(file_data))
            else:
                self.send_error(404, 'File not found')
            
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8')
        
        try:
            data = json.loads(post_data)
        except:
            data = {}
        
        if self.path == '/api/send':
            username = data.get('username', 'Аноним')
            message = data.get('message', '').strip()
            user_id = data.get('user_id', '')
            reply_to = data.get('reply_to', None)
            attachments = data.get('attachments', [])  # Теперь могут быть любые файлы
            images = data.get('images', [])  # Для обратной совместимости
            
            # Объединяем изображения и файлы
            all_attachments = attachments + [{'data': img, 'filename': f'image_{i}.png', 'type': 'image/png'} 
                                            for i, img in enumerate(images)]
            
            if message or all_attachments:
                msg_id = generate_id()
                timestamp = datetime.now().strftime('%H:%M:%S')
                
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                
                # Сохраняем сообщение
                cursor.execute('''
                    INSERT INTO messages (id, username, user_id, message, timestamp, reply_to)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (msg_id, username, user_id, message, timestamp, reply_to))
                
                # Сохраняем вложения
                for att in all_attachments:
                    if att.get('data'):
                        file_data = att['data']
                        # Если данные уже в base64, убираем префикс
                        if file_data.startswith('data:'):
                            file_data = file_data.split(',')[1]
                        
                        filename = att.get('filename', 'file')
                        file_type = att.get('type', 'application/octet-stream')
                        file_size = len(file_data)
                        
                        cursor.execute('''
                            INSERT INTO attachments (message_id, filename, file_data, file_type, file_size)
                            VALUES (?, ?, ?, ?, ?)
                        ''', (msg_id, filename, file_data, file_type, file_size))
                
                conn.commit()
                conn.close()
                
                # Обновляем кэш
                sync_from_db()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())

        elif self.path == '/api/toggle_completed':
            message_id = data.get('message_id')
            username = data.get('username', '')

            if not message_id:
                self.send_response(400)
                self.end_headers()
                return

            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()

            # Проверяем владельца
            cursor.execute('SELECT username, completed FROM messages WHERE id = ?', (message_id,))
            result = cursor.fetchone()

            if not result:
                conn.close()
                self.send_response(404)
                self.end_headers()
                return

            if result[0] != username:
                conn.close()
                self.send_response(403)
                self.end_headers()
                return

            # Переключаем статус
            new_status = 0 if result[1] else 1
            cursor.execute('UPDATE messages SET completed = ? WHERE id = ?', (new_status, message_id))
            conn.commit()
            conn.close()

            sync_from_db()

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True, 'completed': new_status}).encode())
            
        elif self.path == '/api/edit':
            message_id = data.get('message_id')
            new_message = data.get('message', '').strip()
            username = data.get('username', '')
            
            if not message_id or not new_message:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Неверные данные'}).encode())
                return
            
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            # Проверяем владельца
            cursor.execute('SELECT username FROM messages WHERE id = ?', (message_id,))
            result = cursor.fetchone()
            
            if not result:
                conn.close()
                self.send_response(404)
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Сообщение не найдено'}).encode())
                return
            
            if result[0] != username:
                conn.close()
                self.send_response(403)
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Вы не можете редактировать это сообщение'}).encode())
                return
            
            # Обновляем сообщение
            edit_time = datetime.now().strftime('%H:%M:%S')
            cursor.execute('''
                UPDATE messages 
                SET message = ?, edited = 1, edit_time = ?
                WHERE id = ?
            ''', (new_message, edit_time, message_id))
            
            conn.commit()
            conn.close()
            
            sync_from_db()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
            
        elif self.path == '/api/delete':
            message_id = data.get('message_id')
            username = data.get('username', '')
            
            if not message_id:
                self.send_response(400)
                self.end_headers()
                return
            
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            # Проверяем владельца
            cursor.execute('SELECT username FROM messages WHERE id = ?', (message_id,))
            result = cursor.fetchone()
            
            if not result:
                conn.close()
                self.send_response(404)
                self.end_headers()
                return
            
            if result[0] != username:
                conn.close()
                self.send_response(403)
                self.end_headers()
                return
            
            # Удаляем (вложения удалятся каскадно)
            cursor.execute('DELETE FROM messages WHERE id = ?', (message_id,))
            conn.commit()
            conn.close()
            
            sync_from_db()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
            
        elif self.path == '/api/mark_read':
            message_id = data.get('message_id')
            user_id = data.get('user_id')
            
            if message_id and user_id:
                mark_message_read(message_id, user_id)
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True}).encode())
            else:
                self.send_response(400)
                self.end_headers()
            
        elif self.path == '/api/users':
            username = data.get('username', 'Аноним').strip()
            if not username:
                username = 'Аноним'
            
            user_id = data.get('user_id', '')
            if not user_id:
                user_id = generate_id()
            
            current_time = time.time()
            
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            # Обновляем или создаем пользователя
            cursor.execute('''
                INSERT OR REPLACE INTO users (user_id, username, last_seen)
                VALUES (?, ?, ?)
            ''', (user_id, username, current_time))
            
            conn.commit()
            conn.close()
            
            sync_from_db()
            
            active_users = get_active_users()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'username': username,
                'user_id': user_id,
                'users': active_users
            }).encode())
            
        elif self.path == '/api/heartbeat':
            user_id = data.get('user_id')
            
            if user_id:
                current_time = time.time()
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute('''
                    UPDATE users SET last_seen = ?
                    WHERE user_id = ?
                ''', (current_time, user_id))
                conn.commit()
                conn.close()
                
                sync_from_db()
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True}).encode())
            else:
                self.send_response(404)
                self.end_headers()
        
        elif self.path == '/api/logout':
            user_id = data.get('user_id')
            username = data.get('username', '')
            
            if user_id:
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute('DELETE FROM users WHERE user_id = ?', (user_id,))
                conn.commit()
                conn.close()
                
                sync_from_db()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
                
        else:
            self.send_response(404)
            self.end_headers()