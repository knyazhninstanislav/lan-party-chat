import http.server
import json
import time
import os
import sqlite3
import base64
import hashlib
import hmac
import secrets
import threading
import re
import gzip
from datetime import datetime
from urllib.parse import urlparse, parse_qs, quote
from collections import defaultdict, deque

# ============================================================
# CONFIG
# ============================================================
DB_PATH = os.environ.get('DB_PATH', 'chat.db')
SECRET_KEY = os.environ.get('SECRET_KEY', secrets.token_hex(32))
SESSION_TTL = 24 * 3600
MAX_BODY_SIZE = 25 * 1024 * 1024
MAX_MESSAGE_LEN = 2000
MAX_USERNAME_LEN = 20
MAX_ATTACHMENTS = 5
MAX_FILE_SIZE = 10 * 1024 * 1024
MESSAGES_LIMIT = 100

# Вложения хранятся файлами на диске (по умолчанию — папка uploads рядом с БД)
UPLOAD_DIR = os.environ.get('UPLOAD_DIR') or os.path.join(
    os.path.dirname(os.path.abspath(DB_PATH)) or '.', 'uploads')

# Типы, которые безопасно отдавать inline (просмотр в браузере)
INLINE_SAFE_TYPES = {
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
    'image/x-icon', 'image/avif',
    'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav',
    'audio/x-wav', 'audio/webm',
}

LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW = 15 * 60

# ============================================================
# DB
# ============================================================
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def _table_columns(cur, table):
    cur.execute(f'PRAGMA table_info({table})')
    return {r[1] for r in cur.fetchall()}


# ------------------------------------------------------------
# ФАЙЛЫ ВЛОЖЕНИЙ
# ------------------------------------------------------------
def generate_storage_name(filename: str) -> str:
    """Случайное имя файла на диске; расширение сохраняем, если оно безопасное."""
    ext = os.path.splitext(filename or '')[1].lower()
    if not re.fullmatch(r'\.[a-z0-9]{1,10}', ext):
        ext = ''
    return secrets.token_hex(16) + ext


def attachment_disk_path(storage_name: str) -> str:
    # storage_name генерируем сами (hex+ext), но на всякий случай режем путь
    return os.path.join(UPLOAD_DIR, os.path.basename(storage_name or ''))


def unlink_attachment(storage_name: str):
    if not storage_name:
        return
    try:
        os.remove(attachment_disk_path(storage_name))
    except OSError:
        pass


def content_disposition(filename: str, disposition: str) -> str:
    """RFC 6266/5987: ASCII-фолбэк + filename* в UTF-8 (кириллица и т.п.)."""
    filename = filename or 'file'
    ascii_name = re.sub(r'[^A-Za-z0-9._ -]', '_', filename).strip()[:150] or 'file'
    return (f'{disposition}; filename="{ascii_name}"; '
            f"filename*=UTF-8''{quote(filename, safe='')}")


def safe_attachment_type(file_type: str) -> str:
    file_type = (file_type or '').lower().strip()
    return file_type if file_type in INLINE_SAFE_TYPES else 'application/octet-stream'


def init_db():
    """Создаём таблицы и приводим старую схему users к новой (UNIQUE username, password_hash, salt)."""
    conn = get_db()
    cur = conn.cursor()

    # ---- users: проверяем и при необходимости мигрируем ----
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    has_users = cur.fetchone() is not None

    need_migration = False
    if has_users:
        cols = _table_columns(cur, 'users')
        if 'password_hash' not in cols or 'salt' not in cols:
            need_migration = True
        else:
            # проверим, есть ли UNIQUE-индекс на username
            cur.execute("PRAGMA index_list(users)")
            idx_rows = cur.fetchall()
            has_unique_username = False
            for idx in idx_rows:
                if idx[2] == 1:  # unique
                    cur.execute(f"PRAGMA index_info({idx[1]})")
                    cols_idx = [r[2] for r in cur.fetchall()]
                    if cols_idx == ['username']:
                        has_unique_username = True
                        break
            if not has_unique_username:
                need_migration = True

    if not has_users or need_migration:
        if has_users:
            # Переносим в новую схему (может быть потеря паролей у старых юзеров — это ок,
            # они всё равно не могли войти; пароли выдаст админ-скрипт)
            cur.execute('ALTER TABLE users RENAME TO users_old')
        cur.execute('''
            CREATE TABLE users (
                user_id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                last_seen REAL NOT NULL,
                created_at REAL DEFAULT (strftime('%s','now'))
            )
        ''')
        if has_users:
            # Пробуем перенести старых юзеров (без пароля — пустой хэш, вход запрещён до смены пароля админом)
            old_cols = _table_columns(cur, 'users_old')
            ph_expr = 'password_hash' if 'password_hash' in old_cols else "''"
            salt_expr = 'salt' if 'salt' in old_cols else "''"
            cur.execute(f'''
                INSERT OR IGNORE INTO users (user_id, username, password_hash, salt, last_seen, created_at)
                SELECT user_id, username, {ph_expr}, {salt_expr}, last_seen, created_at FROM users_old
            ''')
            cur.execute('DROP TABLE users_old')

    # ---- sessions ----
    cur.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            expires_at REAL NOT NULL,
            ip TEXT,
            created_at REAL DEFAULT (strftime('%s','now')),
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        )
    ''')

    # ---- messages ----
    cur.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            user_id TEXT NOT NULL,
            message TEXT,
            timestamp TEXT NOT NULL,
            edited INTEGER DEFAULT 0,
            edit_time TEXT,
            reply_to TEXT,
            completed INTEGER DEFAULT 0,
            created_at REAL DEFAULT (strftime('%s','now'))
        )
    ''')
    try:
        cur.execute("SELECT completed FROM messages LIMIT 1")
    except sqlite3.OperationalError:
        try:
            cur.execute("ALTER TABLE messages ADD COLUMN completed INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass

    # ---- recipient_id (личные сообщения) ----
    try:
        cur.execute("SELECT recipient_id FROM messages LIMIT 1")
    except sqlite3.OperationalError:
        try:
            cur.execute("ALTER TABLE messages ADD COLUMN recipient_id TEXT")
        except sqlite3.OperationalError:
            pass

    # ---- attachments (файлы на диске, в БД только метаданные) ----
    cur.execute('''
        CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            storage_name TEXT NOT NULL,
            file_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            created_at REAL DEFAULT (strftime('%s','now')),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )
    ''')

    # миграция старой схемы: base64 в колонке file_data → файлы в UPLOAD_DIR
    if 'file_data' in _table_columns(cur, 'attachments'):
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        cur.execute('ALTER TABLE attachments RENAME TO attachments_legacy')
        cur.execute('''
            CREATE TABLE attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                storage_name TEXT NOT NULL,
                file_type TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                created_at REAL DEFAULT (strftime('%s','now')),
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
            )
        ''')
        legacy = cur.execute(
            'SELECT id, message_id, filename, file_data, file_type, created_at '
            'FROM attachments_legacy').fetchall()
        for r in legacy:
            try:
                data = base64.b64decode(r['file_data'] or '', validate=False)
            except Exception:
                data = b''
            if not data:
                continue
            storage = generate_storage_name(r['filename'])
            try:
                with open(attachment_disk_path(storage), 'wb') as fh:
                    fh.write(data)
            except OSError:
                continue
            cur.execute('''
                INSERT INTO attachments
                    (id, message_id, filename, storage_name, file_type, file_size, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (r['id'], r['message_id'], r['filename'], storage,
                  r['file_type'] or 'application/octet-stream',
                  len(data), r['created_at']))
        cur.execute('DROP TABLE attachments_legacy')
    else:
        os.makedirs(UPLOAD_DIR, exist_ok=True)

    # ---- read_receipts ----
    cur.execute('''
        CREATE TABLE IF NOT EXISTS read_receipts (
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            read_at REAL DEFAULT (strftime('%s','now')),
            PRIMARY KEY (message_id, user_id),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )
    ''')

    # ---- login_attempts (аудит) ----
    cur.execute('''
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            username TEXT,
            success INTEGER NOT NULL,
            attempted_at REAL DEFAULT (strftime('%s','now'))
        )
    ''')

    # ---- индексы ----
    cur.execute('CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_read_receipts_msg ON read_receipts(message_id)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen DESC)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, attempted_at)')

    conn.commit()
    conn.close()


init_db()

# ============================================================
# CACHES
# ============================================================
_users_cache = {}
_users_cache_lock = threading.Lock()
_users_cache_time = 0
USERS_CACHE_TTL = 2.0

_read_counts_cache = {}
_read_counts_cache_time = 0
_read_counts_lock = threading.Lock()
READ_COUNTS_CACHE_TTL = 1.5

_login_attempts_mem = defaultdict(deque)
_login_attempts_lock = threading.Lock()

# кэш сообщений по диалогам: 'public' или 'dm:<id1>:<id2>'
_messages_cache = {}
_messages_cache_time = {}
_messages_cache_lock = threading.Lock()
MESSAGES_CACHE_TTL = 1.0

# ============================================================
# HELPERS
# ============================================================
def generate_id():
    return secrets.token_hex(8)


def hash_password(password: str, salt: str = None) -> tuple:
    if salt is None:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'),
                             salt.encode('utf-8'), 200_000)
    return dk.hex(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    if not password_hash or not salt:
        return False
    calc, _ = hash_password(password, salt)
    return hmac.compare_digest(calc, password_hash)


def sanitize_username(name: str) -> str:
    name = (name or '').strip()
    name = re.sub(r'[\x00-\x1f\x7f<>]', '', name)
    return name[:MAX_USERNAME_LEN]


def get_client_ip(handler) -> str:
    xff = handler.headers.get('X-Forwarded-For')
    if xff:
        return xff.split(',')[0].strip()
    return handler.client_address[0]


# ============================================================
# RATE LIMIT
# ============================================================
def is_rate_limited(ip: str) -> bool:
    now = time.time()
    with _login_attempts_lock:
        q = _login_attempts_mem[ip]
        while q and now - q[0] > LOGIN_WINDOW:
            q.popleft()
        return len(q) >= LOGIN_MAX_ATTEMPTS


def register_failed_attempt(ip: str):
    now = time.time()
    with _login_attempts_lock:
        _login_attempts_mem[ip].append(now)
    try:
        conn = get_db()
        conn.execute('INSERT INTO login_attempts (ip, success) VALUES (?, 0)', (ip,))
        conn.commit()
        conn.close()
    except Exception:
        pass


def clear_attempts(ip: str):
    with _login_attempts_lock:
        _login_attempts_mem.pop(ip, None)


# ============================================================
# SESSION
# ============================================================
def create_session(user_id: str, ip: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = time.time() + SESSION_TTL
    conn = get_db()
    conn.execute(
        'INSERT INTO sessions (token, user_id, expires_at, ip) VALUES (?, ?, ?, ?)',
        (token, user_id, expires, ip))
    conn.commit()
    conn.close()
    return token


def get_session_user(token: str):
    if not token:
        return None
    conn = get_db()
    row = conn.execute('''
        SELECT s.user_id, s.expires_at, u.username
        FROM sessions s JOIN users u ON u.user_id = s.user_id
        WHERE s.token = ?
    ''', (token,)).fetchone()
    conn.close()
    if not row or row['expires_at'] < time.time():
        return None
    return {'user_id': row['user_id'], 'username': row['username']}


def extract_token(handler) -> str:
    auth = handler.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        return auth[7:].strip()
    for part in handler.headers.get('Cookie', '').split(';'):
        part = part.strip()
        if part.startswith('session='):
            return part[8:]
    return ''


def delete_session(token: str):
    if not token:
        return
    conn = get_db()
    conn.execute('DELETE FROM sessions WHERE token = ?', (token,))
    conn.commit()
    conn.close()


def cleanup_expired_sessions():
    try:
        conn = get_db()
        conn.execute('DELETE FROM sessions WHERE expires_at < ?', (time.time(),))
        conn.commit()
        conn.close()
    except Exception:
        pass


# ============================================================
# CACHE READERS
# ============================================================
def get_users_view(timeout: int = 15) -> dict:
    """Все пользователи + признак «онлайн» и время последнего визита."""
    global _users_cache, _users_cache_time
    now = time.time()
    with _users_cache_lock:
        if now - _users_cache_time >= USERS_CACHE_TTL:
            conn = get_db()
            rows = conn.execute('''
                SELECT u.user_id, u.username, u.last_seen,
                       EXISTS(SELECT 1 FROM sessions s
                              WHERE s.user_id = u.user_id AND s.expires_at > ?) AS has_session
                FROM users u
            ''', (now,)).fetchall()
            conn.close()
            _users_cache = {r['user_id']: dict(r) for r in rows}
            _users_cache_time = now
        users = [dict(u) for u in _users_cache.values()]

    result = []
    for u in users:
        last_seen = u.get('last_seen') or 0
        result.append({
            'user_id': u['user_id'],
            'username': u['username'],
            'online': bool(u.get('has_session')) and (now - last_seen) < timeout,
            'last_seen': last_seen,
        })
    result.sort(key=lambda x: (not x['online'], -(x['last_seen'] or 0),
                               x['username'].lower()))
    return {'users': result,
            'online': sum(1 for u in result if u['online'])}


def invalidate_users_cache():
    global _users_cache_time
    with _users_cache_lock:
        _users_cache_time = 0


def get_read_counts() -> dict:
    global _read_counts_cache, _read_counts_cache_time
    now = time.time()
    with _read_counts_lock:
        if now - _read_counts_cache_time < READ_COUNTS_CACHE_TTL:
            return _read_counts_cache
        conn = get_db()
        rows = conn.execute('''
            SELECT message_id, COUNT(DISTINCT user_id) as cnt
            FROM read_receipts GROUP BY message_id
        ''').fetchall()
        conn.close()
        _read_counts_cache = {r['message_id']: r['cnt'] for r in rows}
        _read_counts_cache_time = now
        return _read_counts_cache


def invalidate_read_counts():
    global _read_counts_cache_time
    with _read_counts_lock:
        _read_counts_cache_time = 0


def load_messages(convo: str = 'public', user_id: str = None,
                  peer_id: str = None, force: bool = False) -> list:
    """Сообщения одного диалога. convo — ключ кэша ('public' или 'dm:a:b')."""
    global _messages_cache, _messages_cache_time
    now = time.time()
    with _messages_cache_lock:
        if not force and now - _messages_cache_time.get(convo, 0) < MESSAGES_CACHE_TTL:
            return _messages_cache.get(convo, [])

        conn = get_db()
        if peer_id:
            where = ('((user_id = ? AND recipient_id = ?) '
                     'OR (user_id = ? AND recipient_id = ?))')
            args = (user_id, peer_id, peer_id, user_id)
        else:
            where = 'recipient_id IS NULL'
            args = ()

        rows = conn.execute(f'''
            SELECT m.*,
                   (SELECT COUNT(DISTINCT rr.user_id) FROM read_receipts rr
                    WHERE rr.message_id = m.id) AS read_count,
                   a.id AS att_id, a.filename, a.file_type, a.file_size
            FROM (SELECT *, rowid AS rid FROM messages WHERE {where}
                  ORDER BY created_at DESC, rowid DESC LIMIT ?) m
            LEFT JOIN attachments a ON a.message_id = m.id
            ORDER BY m.created_at ASC, m.rid ASC, a.id ASC
        ''', args + (MESSAGES_LIMIT,)).fetchall()
        conn.close()

        messages = {}
        order = []
        for r in rows:
            mid = r['id']
            if mid not in messages:
                messages[mid] = {
                    'id': r['id'], 'username': r['username'], 'user_id': r['user_id'],
                    'recipient_id': r['recipient_id'],
                    'message': r['message'], 'timestamp': r['timestamp'],
                    'created_at': r['created_at'],
                    'edited': r['edited'], 'edit_time': r['edit_time'],
                    'reply_to': r['reply_to'], 'completed': r['completed'],
                    'read_count': r['read_count'], 'attachments': [],
                }
                order.append(mid)
            if r['att_id'] is not None:
                messages[mid]['attachments'].append({
                    'id': r['att_id'], 'filename': r['filename'],
                    'file_type': r['file_type'], 'file_size': r['file_size'],
                })
        _messages_cache[convo] = [messages[mid] for mid in order]
        _messages_cache_time[convo] = now
        return _messages_cache[convo]


def invalidate_messages():
    global _messages_cache_time
    with _messages_cache_lock:
        _messages_cache_time = {}


# ============================================================
# HTTP HANDLER
# ============================================================
class ChatHandler(http.server.BaseHTTPRequestHandler):
    server_version = "LANParty/2.1"
    sys_version = ""

    def _send(self, status, body, content_type='application/json',
              extra_headers=None, compress=False):
        if isinstance(body, str):
            body = body.encode('utf-8')
        accept_enc = self.headers.get('Accept-Encoding', '')
        use_gzip = compress and 'gzip' in accept_enc and len(body) > 1024
        if use_gzip:
            body = gzip.compress(body, 5)
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cache-Control', 'no-store')
        if use_gzip:
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Vary', 'Accept-Encoding')
        self.send_header('Content-Length', str(len(body)))
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, status, obj, extra_headers=None, compress=True):
        self._send(status, json.dumps(obj, ensure_ascii=False),
                   'application/json; charset=utf-8', extra_headers, compress)

    def _read_json(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
        except ValueError:
            return {}
        if length <= 0 or length > MAX_BODY_SIZE:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception:
            return {}

    def _require_auth(self):
        user = get_session_user(extract_token(self))
        if not user:
            self._json(401, {'error': 'Не авторизован'})
            return None
        return user

    def log_message(self, format, *args):
        pass

    def _serve_static(self, filename, content_type):
        try:
            with open(filename, 'r', encoding='utf-8') as f:
                content = f.read()
        except FileNotFoundError:
            self._send(404, 'Not found', 'text/plain')
            return
        self._send(200, content, content_type, compress=True)

    # ---------- GET ----------
    def do_GET(self):
        path = urlparse(self.path).path

        if path == '/':
            try:
                with open('template.html', 'r', encoding='utf-8') as f:
                    html = f.read()
            except FileNotFoundError:
                self._send(404, 'Not found', 'text/plain')
                return
            self._send(200, html, 'text/html; charset=utf-8')

        elif path == '/style.css':
            self._serve_static('style.css', 'text/css; charset=utf-8')

        elif path == '/main.js':
            self._serve_static('main.js', 'application/javascript; charset=utf-8')

        elif path == '/font-awesome-6.0.0-all-min.css':
            self._serve_static('font-awesome-6.0.0-all-min.css', 'text/css; charset=utf-8')

        elif path == '/api/messages':
            user = self._require_auth()
            if not user:
                return
            qs = parse_qs(urlparse(self.path).query)
            peer_id = (qs.get('with') or [''])[0] or None
            if peer_id == user['user_id']:
                self._json(400, {'error': 'Нельзя писать самому себе'})
                return
            if peer_id:
                convo = 'dm:' + ':'.join(sorted([user['user_id'], peer_id]))
                messages = load_messages(convo, user['user_id'], peer_id)
            else:
                messages = load_messages('public')
            sig = ','.join(f"{m['id']}:{m['read_count']}:{m['completed']}:{m['edited']}"
                           for m in messages)
            etag = '"' + hashlib.md5(sig.encode()).hexdigest() + '"'
            if self.headers.get('If-None-Match') == etag:
                self.send_response(304)
                self.send_header('ETag', etag)
                self.end_headers()
                return
            self._json(200, messages, {'ETag': etag})

        elif path == '/api/users':
            user = self._require_auth()
            if not user:
                return
            self._json(200, get_users_view())

        elif path == '/api/dm_threads':
            user = self._require_auth()
            if not user:
                return
            uid = user['user_id']
            now = time.time()
            conn = get_db()
            rows = conn.execute('''
                WITH dm AS (
                    SELECT m.id, m.user_id, m.recipient_id, m.message, m.created_at,
                           CASE WHEN m.user_id = ? THEN m.recipient_id ELSE m.user_id END AS peer_id
                    FROM messages m
                    WHERE m.recipient_id IS NOT NULL AND (m.user_id = ? OR m.recipient_id = ?)
                ),
                latest AS (
                    SELECT *, ROW_NUMBER() OVER (
                        PARTITION BY peer_id ORDER BY created_at DESC, id DESC) AS rn
                    FROM dm
                )
                SELECT l.peer_id, l.user_id AS last_sender_id, l.message, l.created_at,
                       u.username AS peer_username, u.last_seen AS peer_last_seen,
                       EXISTS(SELECT 1 FROM attachments a WHERE a.message_id = l.id) AS has_attachment,
                       (SELECT COUNT(*) FROM messages m2
                        LEFT JOIN read_receipts rr
                               ON rr.message_id = m2.id AND rr.user_id = ?
                        WHERE m2.user_id = l.peer_id AND m2.recipient_id = ?
                          AND rr.message_id IS NULL) AS unread
                FROM latest l
                LEFT JOIN users u ON u.user_id = l.peer_id
                WHERE l.rn = 1
                ORDER BY l.created_at DESC
            ''', (uid, uid, uid, uid, uid)).fetchall()
            conn.close()
            threads = []
            for r in rows:
                if r['peer_id'] is None:
                    continue
                last_seen = r['peer_last_seen'] or 0
                threads.append({
                    'peer_id': r['peer_id'],
                    'peer_username': r['peer_username'] or 'Неизвестный',
                    'peer_online': (now - last_seen) < 15,
                    'last_sender_id': r['last_sender_id'],
                    'message': r['message'] or '',
                    'has_attachment': bool(r['has_attachment']),
                    'last_at': r['created_at'] or 0,
                    'unread': r['unread'] or 0,
                })
            self._json(200, {'threads': threads})

        elif path.startswith('/api/attachment/'):
            # токен можно передать в query — это нужно для <img src> и прямых ссылок
            qs = parse_qs(urlparse(self.path).query)
            qtoken = (qs.get('token') or [''])[0]
            user = get_session_user(qtoken) if qtoken else get_session_user(extract_token(self))
            if not user:
                self._json(401, {'error': 'Не авторизован'})
                return
            try:
                file_id = int(path.rsplit('/', 1)[-1])
            except ValueError:
                self._json(400, {'error': 'Неверный ID'})
                return
            conn = get_db()
            row = conn.execute('''
                SELECT a.filename, a.storage_name, a.file_type,
                       m.user_id AS sender_id, m.recipient_id
                FROM attachments a
                LEFT JOIN messages m ON m.id = a.message_id
                WHERE a.id = ?
            ''', (file_id,)).fetchone()
            conn.close()
            if not row:
                self._json(404, {'error': 'Файл не найден'})
                return
            # файл из личной переписки доступен только её участникам
            if row['recipient_id'] and user['user_id'] not in (row['sender_id'],
                                                               row['recipient_id']):
                self._json(403, {'error': 'Нет доступа'})
                return
            try:
                with open(attachment_disk_path(row['storage_name']), 'rb') as f:
                    data = f.read()
            except OSError:
                self._json(404, {'error': 'Файл не найден на диске'})
                return
            ctype = safe_attachment_type(row['file_type'])
            want_download = (qs.get('download') or [''])[0] not in ('', '0')
            disposition = 'attachment' if (want_download or ctype == 'application/octet-stream') \
                else 'inline'
            self._send(200, data, ctype, {
                'Content-Disposition': content_disposition(row['filename'], disposition),
            })
        else:
            self._json(404, {'error': 'Not found'})

    # ---------- POST ----------
    def do_POST(self):
        path = urlparse(self.path).path
        ip = get_client_ip(self)

        # ---- LOGIN (единственный способ войти) ----
        if path == '/api/login':
            if is_rate_limited(ip):
                self._json(429, {'error': 'Слишком много попыток. Подождите 15 минут.'})
                return
            data = self._read_json()
            username = sanitize_username(data.get('username', ''))
            password = (data.get('password') or '')[:128]
            if not username or not password:
                self._json(400, {'error': 'Введите имя и пароль'})
                return

            conn = get_db()
            row = conn.execute(
                'SELECT user_id, password_hash, salt FROM users WHERE username = ?',
                (username,)).fetchone()
            conn.close()

            if not row or not verify_password(password, row['password_hash'], row['salt']):
                register_failed_attempt(ip)
                self._json(401, {'error': 'Неверное имя или пароль'})
                return

            clear_attempts(ip)
            user_id = row['user_id']
            conn = get_db()
            conn.execute('UPDATE users SET last_seen = ? WHERE user_id = ?',
                         (time.time(), user_id))
            conn.commit()
            conn.close()
            invalidate_users_cache()

            token = create_session(user_id, ip)
            self._json(200, {
                'success': True, 'username': username, 'user_id': user_id, 'token': token,
            }, {'Set-Cookie': f'session={token}; HttpOnly; Path=/; SameSite=Strict; Max-Age={SESSION_TTL}'})
            return

        # ---- LOGOUT ----
        if path == '/api/logout':
            token = extract_token(self)
            if token:
                user = get_session_user(token)
                delete_session(token)
                if user:
                    # Помечаем время выхода — офлайн, но «был(а) в сети» показывает этот момент
                    conn = get_db()
                    conn.execute('UPDATE users SET last_seen = ? WHERE user_id = ?',
                                (time.time(), user['user_id']))
                    conn.commit()
                    conn.close()
                    invalidate_users_cache()
            self._json(200, {'success': True},
                    {'Set-Cookie': 'session=; Max-Age=0; Path=/'})
            return
        # ---- SEND ----
        if path == '/api/send':
            user = self._require_auth()
            if not user:
                return
            data = self._read_json()
            message = (data.get('message') or '').strip()[:MAX_MESSAGE_LEN]
            reply_to = data.get('reply_to')
            recipient_id = data.get('recipient_id') or None
            attachments = data.get('attachments') or []
            if not isinstance(attachments, list):
                attachments = []
            attachments = attachments[:MAX_ATTACHMENTS]

            if not message and not attachments:
                self._json(400, {'error': 'Пустое сообщение'})
                return

            if recipient_id:
                if recipient_id == user['user_id']:
                    self._json(400, {'error': 'Нельзя писать самому себе'})
                    return
                conn = get_db()
                exists = conn.execute('SELECT 1 FROM users WHERE user_id = ?',
                                      (recipient_id,)).fetchone()
                conn.close()
                if not exists:
                    self._json(404, {'error': 'Получатель не найден'})
                    return
            else:
                recipient_id = None

            msg_id = generate_id()
            ts = datetime.now().strftime('%H:%M:%S')
            conn = get_db()
            written = []
            try:
                conn.execute('''
                    INSERT INTO messages (id, username, user_id, message, timestamp, reply_to, recipient_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (msg_id, user['username'], user['user_id'], message, ts,
                      reply_to if reply_to else None, recipient_id))
                for att in attachments:
                    if not isinstance(att, dict):
                        continue
                    raw = att.get('data') or ''
                    if not raw:
                        continue
                    if raw.startswith('data:'):
                        raw = raw.split(',', 1)[-1]
                    try:
                        decoded = base64.b64decode(raw, validate=False)
                    except Exception:
                        continue
                    if not decoded or len(decoded) > MAX_FILE_SIZE:
                        continue
                    filename = re.sub(r'[^\w.\-]', '_',
                                      (att.get('filename') or 'file'))[:200] or 'file'
                    file_type = (att.get('type') or 'application/octet-stream')[:100]
                    storage = generate_storage_name(filename)
                    try:
                        with open(attachment_disk_path(storage), 'wb') as fh:
                            fh.write(decoded)
                    except OSError:
                        continue
                    written.append(storage)
                    conn.execute('''
                        INSERT INTO attachments
                            (message_id, filename, storage_name, file_type, file_size)
                        VALUES (?, ?, ?, ?, ?)
                    ''', (msg_id, filename, storage, file_type, len(decoded)))
                conn.commit()
            except Exception:
                conn.rollback()
                for storage in written:
                    unlink_attachment(storage)
                raise
            finally:
                conn.close()
            invalidate_messages()
            self._json(200, {'success': True, 'id': msg_id})
            return

        # ---- TOGGLE COMPLETED ----
        if path == '/api/toggle_completed':
            user = self._require_auth()
            if not user:
                return
            data = self._read_json()
            message_id = data.get('message_id')
            if not message_id:
                self._json(400, {'error': 'Нет ID'}); return
            conn = get_db()
            row = conn.execute(
                'SELECT user_id, recipient_id, completed FROM messages WHERE id = ?',
                (message_id,)).fetchone()
            if not row:
                conn.close(); self._json(404, {'error': 'Не найдено'}); return
            # «Выполнено» может ставить любой пользователь; в личке — только участники
            if row['recipient_id'] and user['user_id'] not in (row['user_id'], row['recipient_id']):
                conn.close(); self._json(403, {'error': 'Нет доступа'}); return
            new_status = 0 if row['completed'] else 1
            conn.execute('UPDATE messages SET completed = ? WHERE id = ?',
                         (new_status, message_id))
            conn.commit(); conn.close()
            invalidate_messages()
            self._json(200, {'success': True, 'completed': new_status})
            return

        # ---- EDIT ----
        if path == '/api/edit':
            user = self._require_auth()
            if not user:
                return
            data = self._read_json()
            message_id = data.get('message_id')
            new_message = (data.get('message') or '').strip()[:MAX_MESSAGE_LEN]
            if not message_id or not new_message:
                self._json(400, {'error': 'Неверные данные'}); return
            conn = get_db()
            row = conn.execute('SELECT username FROM messages WHERE id = ?',
                               (message_id,)).fetchone()
            if not row:
                conn.close(); self._json(404, {'error': 'Не найдено'}); return
            if row['username'] != user['username']:
                conn.close(); self._json(403, {'error': 'Нет доступа'}); return
            conn.execute('UPDATE messages SET message = ?, edited = 1, edit_time = ? WHERE id = ?',
                         (new_message, datetime.now().strftime('%H:%M:%S'), message_id))
            conn.commit(); conn.close()
            invalidate_messages()
            self._json(200, {'success': True})
            return

        # ---- DELETE ----
        if path == '/api/delete':
            user = self._require_auth()
            if not user:
                return
            data = self._read_json()
            message_id = data.get('message_id')
            if not message_id:
                self._json(400, {'error': 'Нет ID'}); return
            conn = get_db()
            row = conn.execute('SELECT username FROM messages WHERE id = ?',
                               (message_id,)).fetchone()
            if not row:
                conn.close(); self._json(404, {'error': 'Не найдено'}); return
            if row['username'] != user['username']:
                conn.close(); self._json(403, {'error': 'Нет доступа'}); return
            files = [r['storage_name'] for r in conn.execute(
                'SELECT storage_name FROM attachments WHERE message_id = ?',
                (message_id,)).fetchall()]
            conn.execute('DELETE FROM messages WHERE id = ?', (message_id,))
            conn.commit(); conn.close()
            for storage in files:
                unlink_attachment(storage)
            invalidate_messages()
            self._json(200, {'success': True})
            return

        # ---- CLEAR HISTORY ----
        if path == '/api/clear_history':
            user = self._require_auth()
            if not user:
                return
            data = self._read_json()
            scope = data.get('scope') or 'public'
            conn = get_db()
            if scope == 'public':
                where = 'recipient_id IS NULL'
                args = ()
            else:
                peer = str(scope)
                exists = conn.execute('SELECT 1 FROM users WHERE user_id = ?',
                                      (peer,)).fetchone()
                if not exists:
                    conn.close(); self._json(404, {'error': 'Получатель не найден'}); return
                where = ('((user_id = ? AND recipient_id = ?) '
                         'OR (user_id = ? AND recipient_id = ?))')
                args = (user['user_id'], peer, peer, user['user_id'])
            files = [r['storage_name'] for r in conn.execute(
                f'SELECT storage_name FROM attachments WHERE message_id IN '
                f'(SELECT id FROM messages WHERE {where})', args).fetchall()]
            deleted = conn.execute(f'DELETE FROM messages WHERE {where}', args).rowcount
            conn.execute(f'DELETE FROM attachments WHERE message_id NOT IN '
                         f'(SELECT id FROM messages)')
            conn.commit(); conn.close()
            for storage in files:
                unlink_attachment(storage)
            invalidate_messages()
            invalidate_read_counts()
            self._json(200, {'success': True, 'deleted': deleted})
            return

        # ---- MARK READ ----
        if path == '/api/mark_read':
            user = self._require_auth()
            if not user:
                return
            data = self._read_json()
            message_id = data.get('message_id')
            if not message_id:
                self._json(400, {'error': 'Нет ID'}); return
            conn = get_db()
            row = conn.execute(
                'SELECT user_id, recipient_id FROM messages WHERE id = ?',
                (message_id,)).fetchone()
            if not row:
                conn.close(); self._json(404, {'error': 'Не найдено'}); return
            if row['recipient_id'] and user['user_id'] not in (row['user_id'], row['recipient_id']):
                conn.close(); self._json(403, {'error': 'Нет доступа'}); return
            conn.execute('INSERT OR IGNORE INTO read_receipts (message_id, user_id) VALUES (?, ?)',
                         (message_id, user['user_id']))
            conn.commit(); conn.close()
            invalidate_read_counts()
            self._json(200, {'success': True})
            return

        # ---- HEARTBEAT ----
        if path == '/api/heartbeat':
            user = self._require_auth()
            if not user:
                return
            conn = get_db()
            conn.execute('UPDATE users SET last_seen = ? WHERE user_id = ?',
                         (time.time(), user['user_id']))
            conn.commit(); conn.close()
            invalidate_users_cache()
            self._json(200, {'success': True})
            return

        self._json(404, {'error': 'Not found'})