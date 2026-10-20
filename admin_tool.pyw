"""
Админ-скрипт для управления пользователями и историей чата (Tkinter).

Запуск:
    python admin_tool.py

Требования: стандартный Python + tkinter.
Работает напрямую с chat.db (тот же файл, что использует сервер).

Все эмодзи из UI убраны намеренно: Tcl/Tk в Python 3.7 (и ряде сборок 3.8/3.9)
не поддерживает символы вне BMP (U+0000..U+FFFF), из-за чего возникала
ошибка "character U+1f7e2 is above the range ... allowed by Tcl".
"""
import os
import sys
import re
import time
import sqlite3
import secrets
import hashlib
import hmac
import tkinter as tk
from tkinter import ttk, messagebox, simpledialog
from datetime import datetime

DB_PATH = os.environ.get('DB_PATH', 'chat.db')


# ============================================================
# TCL-SAFE STRINGS
# ============================================================
def sanitize_for_tcl(text):
    """Заменяет символы вне BMP на '?', чтобы Tkinter не падал на эмодзи."""
    if text is None:
        return ''
    return re.sub(r'[^\u0000-\uFFFF]', '?', str(text))


# ============================================================
# DB HELPERS
# ============================================================
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def ensure_schema():
    """На случай, если админ-скрипт запущен раньше сервера."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            last_seen REAL NOT NULL,
            created_at REAL DEFAULT (strftime('%s','now'))
        )
    ''')
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
    cur.execute('''
        CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            file_data TEXT NOT NULL,
            file_type TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            created_at REAL DEFAULT (strftime('%s','now')),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS read_receipts (
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            read_at REAL DEFAULT (strftime('%s','now')),
            PRIMARY KEY (message_id, user_id),
            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            expires_at REAL NOT NULL,
            ip TEXT,
            created_at REAL DEFAULT (strftime('%s','now'))
        )
    ''')
    conn.commit()
    conn.close()


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


# ============================================================
# GUI
# ============================================================
class AdminApp:
    def __init__(self, root):
        self.root = root
        self.root.title(f'Управление чатом - {os.path.abspath(DB_PATH)}')
        self.root.geometry('920x560')
        self.root.minsize(780, 460)

        self._build_menu()
        self._build_toolbar()
        self._build_tree()
        self._build_status()
        self.refresh()

    # ---------- UI ----------
    def _build_menu(self):
        menubar = tk.Menu(self.root)

        m_users = tk.Menu(menubar, tearoff=0)
        m_users.add_command(label='Добавить пользователя', command=self.add_user)
        m_users.add_command(label='Сменить пароль', command=self.change_password)
        m_users.add_command(label='Переименовать', command=self.rename_user)
        m_users.add_command(label='Удалить пользователя', command=self.delete_user)
        m_users.add_separator()
        m_users.add_command(label='Сбросить сессии (разлогинить)',
                            command=self.kick_sessions)
        menubar.add_cascade(label='Пользователи', menu=m_users)

        m_hist = tk.Menu(menubar, tearoff=0)
        m_hist.add_command(label='Очистить ВСЮ историю сообщений',
                           command=self.clear_all_messages)
        m_hist.add_command(label='Очистить сообщения выбранного пользователя',
                           command=self.clear_messages_of_user)
        m_hist.add_command(label='Очистить сообщения старше N дней...',
                           command=self.clear_messages_older_than)
        menubar.add_cascade(label='История', menu=m_hist)

        m_view = tk.Menu(menubar, tearoff=0)
        m_view.add_command(label='Обновить', command=self.refresh)
        menubar.add_cascade(label='Вид', menu=m_view)

        self.root.config(menu=menubar)

    def _build_toolbar(self):
        bar = ttk.Frame(self.root, padding=(8, 8, 8, 0))
        bar.pack(fill=tk.X)

        ttk.Button(bar, text='Добавить', command=self.add_user).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(bar, text='Сменить пароль', command=self.change_password).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(bar, text='Переименовать', command=self.rename_user).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(bar, text='Удалить', command=self.delete_user).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(bar, text='Разлогинить', command=self.kick_sessions).pack(side=tk.LEFT, padx=(0, 6))

        ttk.Separator(bar, orient=tk.VERTICAL).pack(side=tk.LEFT, fill=tk.Y, padx=6)

        ttk.Button(bar, text='Очистить всю историю',
                   command=self.clear_all_messages).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(bar, text='Очистить историю юзера',
                   command=self.clear_messages_of_user).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(bar, text='Очистить старше N дней',
                   command=self.clear_messages_older_than).pack(side=tk.LEFT, padx=(0, 6))

        ttk.Button(bar, text='Обновить', command=self.refresh).pack(side=tk.RIGHT)

        self.search_var = tk.StringVar()
        self.search_var.trace_add('write', lambda *_: self.refresh())
        search_frame = ttk.Frame(self.root, padding=(8, 6, 8, 0))
        search_frame.pack(fill=tk.X)
        ttk.Label(search_frame, text='Поиск:').pack(side=tk.LEFT)
        ttk.Entry(search_frame, textvariable=self.search_var).pack(
            side=tk.LEFT, fill=tk.X, expand=True, padx=(6, 0))

    def _build_tree(self):
        frame = ttk.Frame(self.root, padding=8)
        frame.pack(fill=tk.BOTH, expand=True)

        cols = ('username', 'user_id', 'online', 'created', 'has_password', 'msg_count')
        self.tree = ttk.Treeview(frame, columns=cols, show='headings', selectmode='extended')
        headings = {
            'username': 'Имя',
            'user_id': 'user_id',
            'online': 'В сети',
            'created': 'Создан',
            'has_password': 'Пароль',
            'msg_count': 'Сообщений',
        }
        widths = {'username': 180, 'user_id': 150, 'online': 70,
                  'created': 150, 'has_password': 80, 'msg_count': 90}
        for c in cols:
            self.tree.heading(c, text=headings[c])
            self.tree.column(c, width=widths[c], anchor=tk.W)

        vsb = ttk.Scrollbar(frame, orient='vertical', command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vsb.pack(side=tk.RIGHT, fill=tk.Y)

        self.tree.bind('<Double-1>', lambda e: self.change_password())

    def _build_status(self):
        self.status = tk.StringVar()
        ttk.Label(self.root, textvariable=self.status, anchor=tk.W,
                  padding=(10, 4)).pack(fill=tk.X, side=tk.BOTTOM)

    # ---------- DATA ----------
    def selected_username(self):
        sel = self.tree.selection()
        if not sel:
            messagebox.showinfo('Ничего не выбрано', 'Выберите пользователя в списке.')
            return None
        return self.tree.item(sel[0], 'values')[0]

    def refresh(self):
        conn = get_db()
        q = self.search_var.get().strip().lower()
        rows = conn.execute('''
            SELECT u.user_id, u.username, u.last_seen, u.created_at,
                   u.password_hash, u.salt,
                   (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.user_id) AS msg_count
            FROM users u
            ORDER BY u.username COLLATE NOCASE
        ''').fetchall()
        total_msgs = conn.execute('SELECT COUNT(*) FROM messages').fetchone()[0]
        conn.close()

        now = time.time()
        self.tree.delete(*self.tree.get_children())
        shown = 0
        for r in rows:
            name = sanitize_for_tcl(r['username'])
            if q and q not in name.lower():
                continue
            online = 'да' if now - r['last_seen'] < 15 else '-'
            created = datetime.fromtimestamp(r['created_at'] or 0).strftime('%d.%m.%Y %H:%M')
            has_pwd = 'есть' if (r['password_hash'] and r['salt']) else 'НЕТ'
            self.tree.insert('', tk.END, values=(
                name, r['user_id'], online, created, has_pwd, r['msg_count']))
            shown += 1

        self.status.set(
            f'Пользователей: {len(rows)} (показано {shown}) | '
            f'сообщений в БД: {total_msgs} | файл: {os.path.abspath(DB_PATH)}'
        )

    # ---------- USERS ----------
    def add_user(self):
        dlg = UserDialog(self.root, title='Добавить пользователя')
        self.root.wait_window(dlg.top)
        if not dlg.result:
            return
        username, password = dlg.result
        username = username.strip()
        if len(username) < 2:
            messagebox.showerror('Ошибка', 'Имя должно быть не короче 2 символов.')
            return
        if len(password) < 6:
            messagebox.showerror('Ошибка', 'Пароль должен быть не короче 6 символов.')
            return

        conn = get_db()
        exists = conn.execute('SELECT 1 FROM users WHERE username = ?', (username,)).fetchone()
        if exists:
            conn.close()
            messagebox.showerror('Ошибка', f'Пользователь "{username}" уже существует.')
            return
        pwd_hash, salt = hash_password(password)
        user_id = secrets.token_hex(8)
        conn.execute('''
            INSERT INTO users (user_id, username, password_hash, salt, last_seen)
            VALUES (?, ?, ?, ?, ?)
        ''', (user_id, username, pwd_hash, salt, 0))
        conn.commit()
        conn.close()
        messagebox.showinfo('Готово', f'Пользователь "{username}" создан.')
        self.refresh()

    def change_password(self):
        username = self.selected_username()
        if not username:
            return
        dlg = UserDialog(self.root, title=f'Новый пароль для "{username}"', only_password=True)
        self.root.wait_window(dlg.top)
        if not dlg.result:
            return
        _, password = dlg.result
        if len(password) < 6:
            messagebox.showerror('Ошибка', 'Пароль должен быть не короче 6 символов.')
            return
        pwd_hash, salt = hash_password(password)
        conn = get_db()
        conn.execute('UPDATE users SET password_hash = ?, salt = ? WHERE username = ?',
                     (pwd_hash, salt, username))
        conn.execute('DELETE FROM sessions WHERE user_id = '
                     '(SELECT user_id FROM users WHERE username = ?)', (username,))
        conn.commit()
        conn.close()
        messagebox.showinfo('Готово',
                            f'Пароль для "{username}" изменён.\nВсе его сессии сброшены.')
        self.refresh()

    def rename_user(self):
        username = self.selected_username()
        if not username:
            return
        new_name = simpledialog.askstring('Переименовать',
                                          f'Новое имя для "{username}":',
                                          initialvalue=username, parent=self.root)
        if not new_name:
            return
        new_name = new_name.strip()
        if len(new_name) < 2:
            messagebox.showerror('Ошибка', 'Имя должно быть не короче 2 символов.')
            return
        conn = get_db()
        try:
            conn.execute('UPDATE users SET username = ? WHERE username = ?',
                         (new_name, username))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            messagebox.showerror('Ошибка', f'Имя "{new_name}" уже занято.')
            return
        conn.close()
        messagebox.showinfo('Готово', f'"{username}" -> "{new_name}".')
        self.refresh()

    def delete_user(self):
        sel = self.tree.selection()
        if not sel:
            messagebox.showinfo('Ничего не выбрано', 'Выберите пользователя.')
            return
        usernames = [self.tree.item(i, 'values')[0] for i in sel]
        if not messagebox.askyesno(
                'Удалить пользователей',
                'Удалить:\n  ' + '\n  '.join(usernames) + '\n\n'
                'Это также удалит сессии, сообщения, вложения и прочтения.'):
            return
        conn = get_db()
        removed_msgs = 0
        for u in usernames:
            row = conn.execute('SELECT user_id FROM users WHERE username = ?',
                               (u,)).fetchone()
            if not row:
                continue
            uid = row['user_id']
            cur = conn.execute('DELETE FROM messages WHERE user_id = ?', (uid,))
            removed_msgs += cur.rowcount
            conn.execute('DELETE FROM users WHERE user_id = ?', (uid,))
        conn.commit()
        conn.close()
        messagebox.showinfo('Готово',
                            f'Удалено пользователей: {len(usernames)}\n'
                            f'Удалено сообщений: {removed_msgs}')
        self.refresh()

    def kick_sessions(self):
        sel = self.tree.selection()
        if not sel:
            messagebox.showinfo('Ничего не выбрано', 'Выберите пользователя.')
            return
        usernames = [self.tree.item(i, 'values')[0] for i in sel]
        conn = get_db()
        count = 0
        for u in usernames:
            row = conn.execute('SELECT user_id FROM users WHERE username = ?',
                               (u,)).fetchone()
            if not row:
                continue
            cur = conn.execute('DELETE FROM sessions WHERE user_id = ?', (row['user_id'],))
            count += cur.rowcount
        conn.commit()
        conn.close()
        messagebox.showinfo('Готово', f'Сброшено сессий: {count}')
        self.refresh()

    # ---------- HISTORY CLEANUP ----------
    def clear_all_messages(self):
        conn = get_db()
        total = conn.execute('SELECT COUNT(*) FROM messages').fetchone()[0]
        conn.close()
        if total == 0:
            messagebox.showinfo('Пусто', 'Сообщений в базе нет.')
            return
        if not messagebox.askyesno(
                'Очистить всю историю',
                f'Будет безвозвратно удалено сообщений: {total}\n'
                'Вместе с вложениями и отметками о прочтении.\n\n'
                'Продолжить?'):
            return
        conn = get_db()
        conn.execute('DELETE FROM messages')
        conn.commit()
        conn.close()
        messagebox.showinfo('Готово', f'Удалено сообщений: {total}')
        self.refresh()

    def clear_messages_of_user(self):
        username = self.selected_username()
        if not username:
            return
        conn = get_db()
        total = conn.execute('SELECT COUNT(*) FROM messages WHERE username = ?',
                             (username,)).fetchone()[0]
        conn.close()
        if total == 0:
            messagebox.showinfo('Пусто', f'У пользователя "{username}" нет сообщений.')
            return
        if not messagebox.askyesno(
                'Очистить историю пользователя',
                f'Удалить все сообщения пользователя "{username}"?\n'
                f'Количество: {total}\n\n'
                'Вместе с вложениями и отметками о прочтении. '
                'Сам аккаунт останется.'):
            return
        conn = get_db()
        conn.execute('DELETE FROM messages WHERE username = ?', (username,))
        conn.commit()
        conn.close()
        messagebox.showinfo('Готово', f'Удалено сообщений: {total}')
        self.refresh()

    def clear_messages_older_than(self):
        days = simpledialog.askinteger(
            'Очистить старые сообщения',
            'Удалить сообщения старше N дней.\nВведите N (целое число >= 1):',
            minvalue=1, maxvalue=36500, parent=self.root)
        if not days:
            return
        cutoff = time.time() - days * 86400
        conn = get_db()
        total = conn.execute(
            'SELECT COUNT(*) FROM messages WHERE created_at < ?', (cutoff,)).fetchone()[0]
        conn.close()
        if total == 0:
            messagebox.showinfo('Пусто', f'Нет сообщений старше {days} дн.')
            return
        if not messagebox.askyesno(
                'Очистить старые сообщения',
                f'Удалить сообщения старше {days} дн.?\n'
                f'Количество: {total}\n\n'
                'Вместе с вложениями и отметками о прочтении.'):
            return
        conn = get_db()
        conn.execute('DELETE FROM messages WHERE created_at < ?', (cutoff,))
        conn.commit()
        conn.close()
        messagebox.showinfo('Готово', f'Удалено сообщений: {total}')
        self.refresh()


class UserDialog:
    """Диалог создания пользователя / смены пароля."""
    def __init__(self, parent, title, only_password=False):
        self.result = None
        self.top = tk.Toplevel(parent)
        self.top.title(title)
        self.top.resizable(False, False)
        self.top.transient(parent)
        self.top.grab_set()

        frame = ttk.Frame(self.top, padding=12)
        frame.pack(fill=tk.BOTH, expand=True)

        self.username_var = tk.StringVar()
        self.password_var = tk.StringVar()

        if not only_password:
            ttk.Label(frame, text='Имя:').grid(row=0, column=0, sticky='w', pady=4)
            self.name_entry = ttk.Entry(frame, textvariable=self.username_var, width=32)
            self.name_entry.grid(row=0, column=1, padx=(8, 0), pady=4)

        ttk.Label(frame, text='Пароль:').grid(row=1, column=0, sticky='w', pady=4)
        self.pwd_entry = ttk.Entry(frame, textvariable=self.password_var, width=32, show='*')
        self.pwd_entry.grid(row=1, column=1, padx=(8, 0), pady=4)

        self.show_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(frame, text='Показать пароль', variable=self.show_var,
                        command=self._toggle_show).grid(
            row=2, column=1, sticky='w', padx=(8, 0), pady=(0, 6))

        btns = ttk.Frame(frame)
        btns.grid(row=3, column=0, columnspan=2, pady=(8, 0), sticky='e')
        ttk.Button(btns, text='Отмена', command=self._cancel).pack(side=tk.RIGHT)
        ttk.Button(btns, text='ОК', command=self._ok).pack(side=tk.RIGHT, padx=(0, 6))

        self._only_password = only_password
        self.top.bind('<Return>', lambda e: self._ok())
        self.top.bind('<Escape>', lambda e: self._cancel())
        if only_password:
            self.pwd_entry.focus_set()
        else:
            self.top.after(50, self.name_entry.focus_set)

    def _toggle_show(self):
        self.pwd_entry.configure(show='' if self.show_var.get() else '*')

    def _ok(self):
        username = self.username_var.get().strip()
        password = self.password_var.get()
        if not self._only_password and not username:
            messagebox.showerror('Ошибка', 'Введите имя.', parent=self.top)
            return
        if not password:
            messagebox.showerror('Ошибка', 'Введите пароль.', parent=self.top)
            return
        self.result = (username, password)
        self.top.destroy()

    def _cancel(self):
        self.result = None
        self.top.destroy()


def main():
    ensure_schema()
    root = tk.Tk()
    try:
        style = ttk.Style()
        if 'vista' in style.theme_names():
            style.theme_use('vista')
        elif 'clam' in style.theme_names():
            style.theme_use('clam')
    except Exception:
        pass
    AdminApp(root)
    root.mainloop()


if __name__ == '__main__':
    try:
        import tkinter  # noqa: F401
    except ImportError:
        print('tkinter не найден. Установите: sudo apt install python3-tk (Linux) '
              'или переустановите Python с tcl/tk (Windows).')
        sys.exit(1)
    main()