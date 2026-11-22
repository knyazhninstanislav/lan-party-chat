import os
import sys
import socketserver
import socket
import threading
import time
from message_handler import ChatHandler, cleanup_expired_sessions, MAX_CONCURRENT_REQUESTS

# На Windows консоль/служба может быть в cp1251 — эмодзи в логах не должны
# ронять сервер при старте.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass


def find_free_port(start_port=5555, max_port=5555):
    for port in range(start_port, max_port):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('', port))
                return port
        except OSError:
            continue
    return start_port


class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # ограничиваем число одновременных соединений (защита от исчерпания потоков)
        self._slots = threading.BoundedSemaphore(MAX_CONCURRENT_REQUESTS)

    def process_request(self, request, client_address):
        self._slots.acquire()
        try:
            super().process_request(request, client_address)
        except Exception:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()


def cleanup_loop():
    while True:
        time.sleep(3600)
        try:
            cleanup_expired_sessions()
        except Exception:
            pass


PORT = int(os.environ.get('PORT', 0))
if not PORT:
    PORT = find_free_port()

# По умолчанию слушаем только localhost: снаружи доступ — через nginx.
# В Docker задайте HOST=0.0.0.0.
HOST = os.environ.get('HOST', '127.0.0.1')

print(f"🔍 Используется порт: {PORT}")


def run_server():
    print("=" * 50)
    print("🚀 Тикет-система запущена!")
    print(f"📱 http://{HOST}:{PORT}")
    print("=" * 50)
    print("🔒 Вход по паролю (регистрация + логин)")
    print("🛡️ Rate limit, сессии, WAL, индексы, CSP, лимиты")
    print("⚡ Кэширование сообщений/юзеров/read-counts")
    print("=" * 50)

    threading.Thread(target=cleanup_loop, daemon=True).start()

    try:
        with ThreadingHTTPServer((HOST, PORT), ChatHandler) as httpd:
            httpd.serve_forever()
    except OSError as e:
        if "10048" in str(e) or "Address already in use" in str(e):
            new_port = find_free_port(PORT + 1)
            print(f"🔄 Порт {PORT} занят, используем {new_port}")
            with ThreadingHTTPServer((HOST, new_port), ChatHandler) as httpd:
                print(f"✅ http://{HOST}:{new_port}")
                httpd.serve_forever()
        else:
            raise


if __name__ == '__main__':
    run_server()