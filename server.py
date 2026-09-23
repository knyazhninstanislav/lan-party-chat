import os
import socketserver
import socket
from message_handler import ChatHandler


# Автоматический поиск свободного порта
def find_free_port(start_port=5000, max_port=5100):
    """Находит свободный порт в диапазоне"""
    for port in range(start_port, max_port):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('', port))
                return port
        except OSError:
            continue
    return start_port


# В Docker — PORT из окружения, локально — автопоиск
PORT = int(os.environ.get('PORT', 0))
if not PORT:
    PORT = find_free_port()
print(f"🔍 Используется порт: {PORT}")


def run_server():
    """Запуск сервера"""
    print("=" * 50)
    print("🚀 Тикет-система запущена!")
    print(f"📱 Откройте в браузере: http://localhost:{PORT}")
    print("=" * 50)
    print("🎨 Дизайн: Карточки заявок")
    print("💡 Особенности:")
    print("  📝 Многострочный текст (Shift+Enter)")
    print("  🖼️ Вставка скриншотов (Ctrl+V или 📎)")
    print("  📋 Каждое сообщение - отдельная заявка")
    print("  🔔 Всплывающие уведомления")
    print("  ✏️ Редактирование заявок")
    print("  🗑️ Удаление заявок")
    print("  ↩️ Ответы на заявки")
    print("  😊 Смайлы")
    print("=" * 50)
    print("Нажмите Ctrl+C для остановки")
    print("=" * 50)

    try:
        with socketserver.TCPServer(("", PORT), ChatHandler) as httpd:
            httpd.serve_forever()
    except OSError as e:
        if "10048" in str(e):
            print(f"\n❌ Порт {PORT} занят. Ищем другой порт...")
            new_port = find_free_port(PORT + 1)
            print(f"🔄 Используем порт {new_port}")
            with socketserver.TCPServer(("", new_port), ChatHandler) as httpd:
                print(f"✅ Сервер запущен на http://localhost:{new_port}")
                httpd.serve_forever()
        else:
            raise


if __name__ == '__main__':
    run_server()
