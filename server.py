import json
import mimetypes
import os
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import sqlite3


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "applications.db"
# BUG_FIX_CONTEXT: раньше HOST=0.0.0.0 — бэкенд слушал все интерфейсы, и при
# падении ufw порт 8090 оказался бы доступен из интернета в обход nginx (TLS,
# лимит тела, заголовки). Теперь по умолчанию только localhost; nginx проксирует.
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
ADMIN_LOGIN = os.environ.get("ADMIN_LOGIN", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "change-me-please")
SESSION_TTL_HOURS = 24
SESSION_COOKIE_NAME = "leaders_admin_session"

# Лимиты ввода (защита от мусора и oversized-payload; nginx тоже режет тело 1 МБ).
MAX_BODY_BYTES = 64 * 1024
MAX_LEN = {"full_name": 120, "email": 254, "phone": 32, "organization": 200}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Анти-спам по IP за окно RL_WINDOW_SECONDS. Лимит заявок мягкий — чтобы группа
# людей за одним NAT (вузовский/венью Wi-Fi) не блокировала друг друга; логин
# жёстче — это защита от перебора пароля.
RL_WINDOW_SECONDS = 60
RL_MAX_APPLICATIONS = 30
RL_MAX_LOGIN = 8

# Состояние процесса (ThreadingHTTPServer -> доступ из многих потоков, нужен Lock).
sessions = {}
_sessions_lock = threading.Lock()
_rate_state = {}
_rate_lock = threading.Lock()


def db_connect():
    return sqlite3.connect(DB_PATH, timeout=15)


def init_db():
    DATA_DIR.mkdir(exist_ok=True)
    with db_connect() as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone TEXT NOT NULL,
                organization TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'new',
                admin_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )
        # Идемпотентные миграции: согласия (152-ФЗ) + аудит согласия (момент и IP).
        migrations = (
            "ALTER TABLE applications ADD COLUMN consent_pdn INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE applications ADD COLUMN consent_terms INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE applications ADD COLUMN consent_marketing INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE applications ADD COLUMN consent_at TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE applications ADD COLUMN source_ip TEXT NOT NULL DEFAULT ''",
        )
        for ddl in migrations:
            try:
                connection.execute(ddl)
            except sqlite3.OperationalError:
                pass
        # Индекс под сортировку админ-списка по дате (масштабируемость).
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications(created_at)"
        )
        connection.commit()


def json_response(handler, status_code, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler):
    content_length = int(handler.headers.get("Content-Length", "0") or "0")
    if content_length > MAX_BODY_BYTES:
        # BUG_FIX_CONTEXT: без верхней границы Content-Length тело читалось целиком
        # в память — вектор DoS при прямом обращении в обход nginx.
        raise ValueError("payload too large")
    raw_body = handler.rfile.read(content_length) if content_length else b"{}"
    if not raw_body:
        return {}
    return json.loads(raw_body.decode("utf-8"))


def client_ip(handler):
    real_ip = handler.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()[:64]
    forwarded = handler.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return handler.client_address[0]


def is_rate_limited(ip, scope, max_requests):
    key = f"{scope}:{ip}"
    now = time.time()
    with _rate_lock:
        recent = [t for t in _rate_state.get(key, []) if now - t < RL_WINDOW_SECONDS]
        if len(recent) >= max_requests:
            _rate_state[key] = recent
            return True
        recent.append(now)
        _rate_state[key] = recent
        return False


def get_cookie(handler, name):
    raw_cookie = handler.headers.get("Cookie")
    if not raw_cookie:
        return None
    parsed = cookies.SimpleCookie()
    parsed.load(raw_cookie)
    item = parsed.get(name)
    return item.value if item else None


def create_session():
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    with _sessions_lock:
        # Очистка протухших токенов, чтобы dict не рос бесконечно.
        for stale in [t for t, exp in sessions.items() if exp < now]:
            sessions.pop(stale, None)
        sessions[token] = now + timedelta(hours=SESSION_TTL_HOURS)
    return token


def is_authenticated(handler):
    token = get_cookie(handler, SESSION_COOKIE_NAME)
    if not token:
        return False
    now = datetime.now(timezone.utc)
    with _sessions_lock:
        expires_at = sessions.get(token)
        if not expires_at:
            return False
        if expires_at < now:
            sessions.pop(token, None)
            return False
    return True


def set_session_cookie(handler, token):
    cookie = cookies.SimpleCookie()
    cookie[SESSION_COOKIE_NAME] = token
    cookie[SESSION_COOKIE_NAME]["path"] = "/"
    cookie[SESSION_COOKIE_NAME]["httponly"] = True
    cookie[SESSION_COOKIE_NAME]["samesite"] = "Lax"
    handler.send_header("Set-Cookie", cookie.output(header="").strip())


def clear_session_cookie(handler):
    token = get_cookie(handler, SESSION_COOKIE_NAME)
    if token:
        with _sessions_lock:
            sessions.pop(token, None)
    cookie = cookies.SimpleCookie()
    cookie[SESSION_COOKIE_NAME] = ""
    cookie[SESSION_COOKIE_NAME]["path"] = "/"
    cookie[SESSION_COOKIE_NAME]["expires"] = "Thu, 01 Jan 1970 00:00:00 GMT"
    handler.send_header("Set-Cookie", cookie.output(header="").strip())


def validate_application(payload):
    fields = {
        "full_name": "ФИО",
        "email": "Email",
        "phone": "Телефон",
        "organization": "ВУЗ / место работы",
    }
    cleaned = {}
    for key, label in fields.items():
        value = str(payload.get(key, "")).strip()
        if not value:
            return None, f"Поле «{label}» обязательно для заполнения."
        if len(value) > MAX_LEN[key]:
            return None, f"Поле «{label}» слишком длинное."
        cleaned[key] = value
    # BUG_FIX_CONTEXT: раньше проверялось только «не пусто» — в БД могли попасть
    # битые e-mail/телефоны. Добавлена проверка формата.
    if not EMAIL_RE.match(cleaned["email"]):
        return None, "Укажите корректный адрес электронной почты."
    phone_digits = re.sub(r"\D", "", cleaned["phone"])
    if len(phone_digits) < 10 or len(phone_digits) > 15:
        return None, "Укажите корректный номер телефона."
    return cleaned, None


class LeadersHandler(BaseHTTPRequestHandler):
    def send_json_error(self, status_code, message):
        try:
            json_response(self, status_code, {"error": message})
        except BrokenPipeError:
            pass

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path

            if path == "/api/applications":
                return self.handle_applications_list()
            if path == "/api/session":
                return json_response(self, 200, {"authenticated": is_authenticated(self)})
            if path == "/admin":
                return self.serve_file("admin.html")
            if path == "/":
                return self.serve_file("index.html")
            return self.serve_static(path)
        except Exception:
            return self.send_json_error(500, "Внутренняя ошибка сервера.")

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path

            if path == "/api/applications":
                return self.handle_application_create()
            if path == "/api/login":
                return self.handle_login()
            if path == "/api/logout":
                return self.handle_logout()

            return json_response(self, 404, {"error": "Маршрут не найден."})
        except Exception:
            return self.send_json_error(500, "Внутренняя ошибка сервера.")

    def do_PATCH(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path

            if path.startswith("/api/applications/"):
                return self.handle_application_update(path)

            return json_response(self, 404, {"error": "Маршрут не найден."})
        except Exception:
            return self.send_json_error(500, "Внутренняя ошибка сервера.")

    def log_message(self, format_, *args):
        return

    def serve_file(self, relative_path):
        file_path = BASE_DIR / relative_path
        if not file_path.exists():
            return self.send_error(404)

        content = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def serve_static(self, request_path):
        safe_path = request_path.lstrip("/")
        file_path = (BASE_DIR / safe_path).resolve()
        if not str(file_path).startswith(str(BASE_DIR)) or not file_path.is_file():
            return self.send_error(404)

        content = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def handle_application_create(self):
        ip = client_ip(self)
        if is_rate_limited(ip, "app", RL_MAX_APPLICATIONS):
            return json_response(self, 429, {"error": "Слишком много заявок. Попробуйте через минуту."})

        try:
            payload = read_json(self)
        except ValueError:
            return json_response(self, 413, {"error": "Слишком большой запрос."})
        except json.JSONDecodeError:
            return json_response(self, 400, {"error": "Некорректный JSON."})

        cleaned, error = validate_application(payload)
        if error:
            return json_response(self, 400, {"error": error})

        consent_pdn = bool(payload.get("consent_pdn"))
        consent_terms = bool(payload.get("consent_terms"))
        consent_marketing = bool(payload.get("consent_marketing"))
        if not consent_pdn or not consent_terms:
            return json_response(
                self,
                400,
                {"error": "Необходимо согласие на обработку персональных данных и принятие пользовательского соглашения."},
            )

        created_at = datetime.now().astimezone().isoformat(timespec="seconds")
        try:
            with db_connect() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO applications
                        (full_name, email, phone, organization, created_at,
                         consent_pdn, consent_terms, consent_marketing, consent_at, source_ip)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        cleaned["full_name"],
                        cleaned["email"],
                        cleaned["phone"],
                        cleaned["organization"],
                        created_at,
                        int(consent_pdn),
                        int(consent_terms),
                        int(consent_marketing),
                        created_at,
                        ip,
                    ),
                )
                connection.commit()
        except sqlite3.Error:
            return json_response(self, 500, {"error": "Не удалось сохранить заявку. Попробуйте еще раз."})

        return json_response(
            self,
            201,
            {
                "message": "Заявка успешно отправлена.",
                "application_id": cursor.lastrowid,
            },
        )

    def handle_applications_list(self):
        if not is_authenticated(self):
            return json_response(self, 401, {"error": "Требуется авторизация."})

        try:
            with db_connect() as connection:
                connection.row_factory = sqlite3.Row
                rows = connection.execute(
                    """
                    SELECT id, full_name, email, phone, organization, status, admin_notes,
                           created_at, consent_pdn, consent_terms, consent_marketing,
                           consent_at, source_ip
                    FROM applications
                    ORDER BY datetime(created_at) DESC, id DESC
                    """
                ).fetchall()
        except sqlite3.Error:
            return json_response(self, 500, {"error": "Не удалось получить заявки."})

        applications = [dict(row) for row in rows]
        return json_response(self, 200, {"applications": applications})

    def handle_application_update(self, path):
        if not is_authenticated(self):
            return json_response(self, 401, {"error": "Требуется авторизация."})

        application_id = path.rsplit("/", 1)[-1]
        if not application_id.isdigit():
            return json_response(self, 400, {"error": "Некорректный идентификатор заявки."})

        try:
            payload = read_json(self)
        except ValueError:
            return json_response(self, 413, {"error": "Слишком большой запрос."})
        except json.JSONDecodeError:
            return json_response(self, 400, {"error": "Некорректный JSON."})

        status = str(payload.get("status", "new")).strip()
        admin_notes = str(payload.get("admin_notes", "")).strip()[:2000]
        if status not in {"new", "in_progress", "processed"}:
            return json_response(self, 400, {"error": "Недопустимый статус."})

        try:
            with db_connect() as connection:
                cursor = connection.execute(
                    """
                    UPDATE applications
                    SET status = ?, admin_notes = ?
                    WHERE id = ?
                    """,
                    (status, admin_notes, int(application_id)),
                )
                connection.commit()
        except sqlite3.Error:
            return json_response(self, 500, {"error": "Не удалось обновить заявку."})

        if cursor.rowcount == 0:
            return json_response(self, 404, {"error": "Заявка не найдена."})

        return json_response(self, 200, {"message": "Заявка обновлена."})

    def handle_login(self):
        ip = client_ip(self)
        if is_rate_limited(ip, "login", RL_MAX_LOGIN):
            return json_response(self, 429, {"error": "Слишком много попыток. Попробуйте через минуту."})

        try:
            payload = read_json(self)
        except ValueError:
            return json_response(self, 413, {"error": "Слишком большой запрос."})
        except json.JSONDecodeError:
            return json_response(self, 400, {"error": "Некорректный JSON."})

        login = str(payload.get("login", "")).strip()
        password = str(payload.get("password", "")).strip()

        # BUG_FIX_CONTEXT: обычное сравнение строк уязвимо к timing-атаке —
        # перешли на constant-time secrets.compare_digest.
        login_ok = secrets.compare_digest(login, ADMIN_LOGIN)
        password_ok = secrets.compare_digest(password, ADMIN_PASSWORD)
        if not (login_ok and password_ok):
            return json_response(self, 401, {"error": "Неверный логин или пароль."})

        token = create_session()
        self.send_response(200)
        set_session_cookie(self, token)
        body = json.dumps({"message": "Вход выполнен."}, ensure_ascii=False).encode("utf-8")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_logout(self):
        self.send_response(200)
        clear_session_cookie(self)
        body = json.dumps({"message": "Вы вышли из админ-панели."}, ensure_ascii=False).encode("utf-8")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class LeadersServer(ThreadingHTTPServer):
    # BUG_FIX_CONTEXT: дефолтный backlog accept-очереди = 5 — при всплеске ~300
    # одновременных соединений лишние отбивались бы ОС. Поднят до 128.
    # daemon_threads — чтобы зависший воркер не держал процесс при остановке.
    daemon_threads = True
    request_queue_size = 128
    allow_reuse_address = True


def main():
    init_db()
    server = LeadersServer((HOST, PORT), LeadersHandler)
    print(f"Сервер запущен: http://{HOST}:{PORT}")
    print(f"Админ-панель: http://{HOST}:{PORT}/admin")
    print(f"Логин: {ADMIN_LOGIN}")
    if ADMIN_PASSWORD == "change-me-please":
        print("Пароль по умолчанию: change-me-please")
        print("Для безопасности задайте свой пароль: ADMIN_PASSWORD=ваш_пароль python3 server.py")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
