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


# Фиксированный адрес: снаружи доступ только через nginx.
# Меняется через переменные окружения (например, для Docker: HOST=0.0.0.0).
HOST = os.environ.get('HOST', '127.0.0.1')
PORT = int(os.environ.get('PORT', 5555))


def run_server():
    print("=" * 50)
    print("🚀 Тикет-система запущена!")
    print(f"📱 http://{HOST}:{PORT}  (доступ — через nginx)")
    print("=" * 50)
    print("🔒 Вход по паролю (регистрация + логин)")
    print("🛡️ Rate limit, сессии, WAL, индексы, CSP, лимиты")
    print("⚡ Кэширование сообщений/юзеров/read-counts")
    print("=" * 50)

    threading.Thread(target=cleanup_loop, daemon=True).start()

    # Без автопоиска свободного порта: nginx ходит строго на HOST:PORT.
    # Если порт занят — это ошибка конфигурации, сервер должен упасть,
    # а не тихо переехать на другой порт, куда nginx не обращается.
    with ThreadingHTTPServer((HOST, PORT), ChatHandler) as httpd:
        httpd.serve_forever()


if __name__ == '__main__':
    run_server()