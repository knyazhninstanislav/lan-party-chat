# ============================================================
# LAN Party — локальный чат-тикетница
# Образ на базе python:3.12-slim
# ============================================================

FROM python:3.12-slim

# Метаданные
LABEL maintainer="LAN Party" \
      description="Локальный чат-тикетница без внешних зависимостей"

# Рабочая директория внутри контейнера
WORKDIR /app

# Копируем только код (без chat.db, без мусора)
COPY server.py message_handler.py ./
COPY template.html style.css main.js ./

# Папка для БД (том будет монтироваться сюда)
RUN mkdir -p /app/data

# Переменные окружения
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=5000 \
    DB_PATH=/app/data/chat.db

# Порт, который слушает приложение
EXPOSE 5000

# Healthcheck — проверяем, что сервер отвечает
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/').read()" || exit 1

# Запуск
CMD ["python", "server.py"]