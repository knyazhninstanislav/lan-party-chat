import os
import socketserver
import socket
import threading
import time
from message_handler import ChatHandler, cleanup_expired_sessions


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

print(f"🔍 Используется порт: {PORT}")


def run_server():
    print("=" * 50)
    print("🚀 Тикет-система запущена!")
    print(f"📱 http://localhost:{PORT}")
    print("=" * 50)
    print("🔒 Вход по паролю (регистрация + логин)")
    print("🛡️ Rate limit, сессии, WAL, индексы")
    print("⚡ Кэширование сообщений/юзеров/read-counts")
    print("=" * 50)

    threading.Thread(target=cleanup_loop, daemon=True).start()

    try:
        with ThreadingHTTPServer(("127.0.0.1", PORT), ChatHandler) as httpd:
            httpd.serve_forever()
    except OSError as e:
        if "10048" in str(e) or "Address already in use" in str(e):
            new_port = find_free_port(PORT + 1)
            print(f"🔄 Порт {PORT} занят, используем {new_port}")
            with ThreadingHTTPServer(("", new_port), ChatHandler) as httpd:
                print(f"✅ http://localhost:{new_port}")
                httpd.serve_forever()
        else:
            raise


if __name__ == '__main__':
    run_server()