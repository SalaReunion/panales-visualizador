import os
import sys
import sqlite3
import datetime
import csv
import io
import json
import gzip
from functools import wraps
from flask import (
    Flask, request, jsonify, render_template_string,
    send_from_directory, redirect, url_for, session, Response
)
from werkzeug.security import generate_password_hash, check_password_hash

# Inicialización de Flask
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
app.secret_key = os.environ.get("SECRET_KEY", "panales-secret-key-2026-production-super-secure")
app.config['PERMANENT_SESSION_LIFETIME'] = datetime.timedelta(days=7)

DB_PATH = os.path.join(BASE_DIR, "auth.db")

# Zona Horaria de Buenos Aires (UTC-3)
TZ_AR = datetime.timezone(datetime.timedelta(hours=-3))

def get_now_ar():
    """Retorna la fecha y hora actual en zona horaria de Buenos Aires (UTC-3)."""
    return datetime.datetime.now(TZ_AR).strftime("%Y-%m-%d %H:%M:%S")

# ==============================================================================
# CONEXIÓN A BASE DE DATOS (POSTGRESQL EN RENDER O SQLITE EN LOCAL)
# ==============================================================================
DATABASE_URL = os.environ.get("DATABASE_URL")
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

def is_postgres():
    return bool(DATABASE_URL)

def get_db():
    if is_postgres():
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn

def execute_query(conn, query, params=None):
    """Ejecuta una consulta SQL adaptando el placeholder (?, %s) y devuelve cursor."""
    if is_postgres():
        import psycopg2.extras
        query_sql = query.replace('?', '%s')
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    else:
        query_sql = query
        cursor = conn.cursor()
    
    if params:
        cursor.execute(query_sql, params)
    else:
        cursor.execute(query_sql)
    return cursor

def get_scalar(cursor):
    """Extrae el primer valor de una consulta de conteo o agregado."""
    row = cursor.fetchone()
    if not row:
        return 0
    if isinstance(row, dict):
        return list(row.values())[0]
    return row[0]

def init_db():
    with get_db() as conn:
        if is_postgres():
            print("Conectado a PostgreSQL persistente en la nube...")
            execute_query(conn, """
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(100) UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    role VARCHAR(50) NOT NULL DEFAULT 'user',
                    created_at VARCHAR(50) NOT NULL
                )
            """)
            execute_query(conn, """
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(100) NOT NULL,
                    role VARCHAR(50),
                    login_time VARCHAR(50) NOT NULL,
                    ip_address VARCHAR(100),
                    user_agent TEXT,
                    status VARCHAR(50) NOT NULL,
                    details TEXT
                )
            """)
        else:
            execute_query(conn, """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user',
                    created_at TEXT NOT NULL
                )
            """)
            execute_query(conn, """
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    role TEXT,
                    login_time TEXT NOT NULL,
                    ip_address TEXT,
                    user_agent TEXT,
                    status TEXT NOT NULL,
                    details TEXT
                )
            """)

        cur = execute_query(conn, "SELECT COUNT(*) FROM users")
        if get_scalar(cur) == 0:
            now_str = get_now_ar()
            default_users = [
                ("admin", generate_password_hash("admin2026"), "Administrador del Sistema", "admin", now_str)
            ]
            for u in default_users:
                execute_query(
                    conn,
                    "INSERT INTO users (username, password_hash, full_name, role, created_at) VALUES (?, ?, ?, ?, ?)",
                    u
                )
            print("Usuario inicial creado: admin (admin2026) con hora de Buenos Aires")
        conn.commit()

init_db()

# Decoradores de autorización
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            if request.path.startswith('/api/'):
                return jsonify({"error": "No autorizado. Inicie sesión."}), 401
            return redirect('/login.html')
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            return jsonify({"error": "No autorizado. Inicie sesión."}), 401
        if session.get('role') != 'admin':
            return jsonify({"error": "Acceso restringido solo para administradores."}), 403
        return f(*args, **kwargs)
    return decorated_function

def get_client_ip():
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    return request.remote_addr or '127.0.0.1'

# ==============================================================================
# RUTAS DE AUTENTICACIÓN
# ==============================================================================
@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip().lower()
    password = data.get('password') or ''
    ip = get_client_ip()
    ua = request.headers.get('User-Agent', '')[:250]
    now_ar = get_now_ar()

    if not username or not password:
        return jsonify({"success": False, "message": "Por favor complete usuario y contraseña."}), 400

    with get_db() as conn:
        cursor = execute_query(conn, "SELECT * FROM users WHERE LOWER(username) = ?", (username,))
        user = cursor.fetchone()

        if user and check_password_hash(user['password_hash'], password):
            session.permanent = True
            session['username'] = user['username']
            session['full_name'] = user['full_name']
            session['role'] = user['role']
            session['user_id'] = user['id']

            # Registrar log de auditoría EXITOSO
            execute_query(conn, """
                INSERT INTO audit_logs (username, role, login_time, ip_address, user_agent, status, details)
                VALUES (?, ?, ?, ?, ?, 'EXITOSO', 'Ingreso correcto al sistema')
            """, (user['username'], user['role'], now_ar, ip, ua))
            conn.commit()

            return jsonify({
                "success": True,
                "message": "Ingreso exitoso",
                "user": {
                    "username": user['username'],
                    "full_name": user['full_name'],
                    "role": user['role']
                }
            })
        else:
            # Registrar intento FALLIDO
            execute_query(conn, """
                INSERT INTO audit_logs (username, role, login_time, ip_address, user_agent, status, details)
                VALUES (?, ?, ?, ?, ?, 'FALLIDO', 'Contraseña incorrecta o usuario inexistente')
            """, (username, 'desconocido', now_ar, ip, ua))
            conn.commit()

            return jsonify({"success": False, "message": "Usuario o contraseña incorrectos."}), 401

@app.route('/api/register', methods=['POST'])
def api_register():
    data = request.get_json() or {}
    full_name = (data.get('full_name') or '').strip()
    username = (data.get('username') or '').strip().lower()
    password = data.get('password') or ''
    ip = get_client_ip()
    ua = request.headers.get('User-Agent', '')[:250]
    now_ar = get_now_ar()

    if not full_name or not username or not password:
        return jsonify({"success": False, "message": "Por favor complete todos los campos requeridos."}), 400

    if len(username) < 3:
        return jsonify({"success": False, "message": "El nombre de usuario debe tener al menos 3 caracteres."}), 400

    if len(password) < 4:
        return jsonify({"success": False, "message": "La contraseña debe tener al menos 4 caracteres."}), 400

    with get_db() as conn:
        cursor = execute_query(conn, "SELECT id FROM users WHERE LOWER(username) = ?", (username,))
        if cursor.fetchone():
            return jsonify({"success": False, "message": f"El usuario '{username}' ya existe. Elija otro nombre."}), 400

        # Crear nuevo usuario con rol 'user'
        password_hash = generate_password_hash(password)
        execute_query(
            conn,
            "INSERT INTO users (username, password_hash, full_name, role, created_at) VALUES (?, ?, ?, 'user', ?)",
            (username, password_hash, full_name, now_ar)
        )

        # Iniciar sesión automáticamente
        session.permanent = True
        session['username'] = username
        session['full_name'] = full_name
        session['role'] = 'user'

        # Registrar auditoría
        execute_query(conn, """
            INSERT INTO audit_logs (username, role, login_time, ip_address, user_agent, status, details)
            VALUES (?, 'user', ?, ?, ?, 'EXITOSO', 'Registro inicial y primer ingreso')
        """, (username, now_ar, ip, ua))
        conn.commit()

        return jsonify({
            "success": True,
            "message": "Registro exitoso",
            "user": {
                "username": username,
                "full_name": full_name,
                "role": "user"
            }
        })

@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({"success": True, "message": "Sesión finalizada correctamente."})

@app.route('/api/me', methods=['GET'])
def api_me():
    if 'username' in session:
        return jsonify({
            "authenticated": True,
            "username": session.get('username'),
            "full_name": session.get('full_name'),
            "role": session.get('role')
        })
    return jsonify({"authenticated": False}), 401

# ==============================================================================
# AUDITORÍA DE INGRESOS (SOLO ADMINISTRADOR)
# ==============================================================================
@app.route('/api/admin/audit-logs', methods=['GET'])
@admin_required
def api_audit_logs():
    limit = request.args.get('limit', 200, type=int)
    search = (request.args.get('search') or '').strip().lower()
    status = (request.args.get('status') or '').strip().upper()

    query = "SELECT * FROM audit_logs WHERE 1=1"
    params = []

    if search:
        query += " AND (LOWER(username) LIKE ? OR LOWER(ip_address) LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    if status and status != 'TODOS':
        query += " AND status = ?"
        params.append(status)

    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)

    with get_db() as conn:
        cursor = execute_query(conn, query, params)
        rows = cursor.fetchall()

        logs = []
        for r in rows:
            logs.append({
                "id": r["id"],
                "username": r["username"],
                "role": r["role"],
                "login_time": r["login_time"],
                "ip_address": r["ip_address"],
                "user_agent": r["user_agent"],
                "status": r["status"],
                "details": r["details"]
            })

        # Estadísticas generales
        c1 = execute_query(conn, "SELECT COUNT(*) FROM audit_logs WHERE status = 'EXITOSO'")
        total_exitosos = get_scalar(c1)
        c2 = execute_query(conn, "SELECT COUNT(*) FROM audit_logs WHERE status = 'FALLIDO'")
        total_fallidos = get_scalar(c2)
        c3 = execute_query(conn, "SELECT COUNT(DISTINCT username) FROM audit_logs WHERE status = 'EXITOSO'")
        usuarios_unicos = get_scalar(c3)

        return jsonify({
            "success": True,
            "logs": logs,
            "stats": {
                "total_exitosos": total_exitosos,
                "total_fallidos": total_fallidos,
                "usuarios_unicos": usuarios_unicos
            }
        })

@app.route('/api/admin/export-logs', methods=['GET'])
@admin_required
def api_export_logs():
    with get_db() as conn:
        cursor = execute_query(conn, "SELECT id, username, role, login_time, ip_address, user_agent, status, details FROM audit_logs ORDER BY id DESC")
        rows = cursor.fetchall()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Usuario", "Rol", "Fecha y Hora", "IP", "Navegador", "Estado", "Detalle"])
    for r in rows:
        writer.writerow([r["id"], r["username"], r["role"], r["login_time"], r["ip_address"], r["user_agent"], r["status"], r["details"]])

    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=auditoria_ingresos.csv"}
    )

# ==============================================================================
# GESTIÓN DE USUARIOS (ADMINISTRADOR)
# ==============================================================================
@app.route('/api/admin/users', methods=['GET', 'POST'])
@admin_required
def api_users():
    if request.method == 'GET':
        with get_db() as conn:
            cursor = execute_query(conn, "SELECT id, username, full_name, role, created_at FROM users ORDER BY username ASC")
            users = [dict(r) for r in cursor.fetchall()]
            return jsonify({"success": True, "users": users})
    else:
        data = request.get_json() or {}
        username = (data.get('username') or '').strip().lower()
        password = data.get('password') or ''
        full_name = (data.get('full_name') or '').strip()
        role = (data.get('role') or 'user').strip().lower()

        if not username or not password or not full_name:
            return jsonify({"success": False, "message": "Faltan campos obligatorios."}), 400

        with get_db() as conn:
            cursor = execute_query(conn, "SELECT id FROM users WHERE LOWER(username) = ?", (username,))
            if cursor.fetchone():
                return jsonify({"success": False, "message": "El usuario ya existe."}), 400
            
            execute_query(
                conn,
                "INSERT INTO users (username, password_hash, full_name, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (username, generate_password_hash(password), full_name, role, get_now_ar())
            )
            conn.commit()
            return jsonify({"success": True, "message": f"Usuario {username} creado con éxito."})

@app.route('/api/admin/reset-password', methods=['POST'])
@admin_required
def api_reset_password():
    data = request.get_json() or {}
    user_id = data.get('user_id')
    username = (data.get('username') or '').strip().lower()
    new_password = data.get('new_password') or ''

    if not new_password or (not user_id and not username):
        return jsonify({"success": False, "message": "Datos incompletos. Ingrese usuario y nueva contraseña."}), 400

    with get_db() as conn:
        if user_id:
            cursor = execute_query(conn, "SELECT * FROM users WHERE id = ?", (user_id,))
        else:
            cursor = execute_query(conn, "SELECT * FROM users WHERE LOWER(username) = ?", (username,))
        user = cursor.fetchone()

        if not user:
            return jsonify({"success": False, "message": "Usuario no encontrado."}), 404

        new_hash = generate_password_hash(new_password)
        execute_query(conn, "UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user['id']))

        # Registrar en la auditoría la acción del admin
        now_ar = get_now_ar()
        ip = get_client_ip()
        admin_user = session.get('username', 'admin')
        execute_query(conn, """
            INSERT INTO audit_logs (username, role, login_time, ip_address, user_agent, status, details)
            VALUES (?, 'admin', ?, ?, 'Admin Action', 'EXITOSO', ?)
        """, (admin_user, now_ar, ip, f"Blanqueó contraseña de usuario '{user['username']}'"))

        conn.commit()

        return jsonify({
            "success": True,
            "message": f"Contraseña de '{user['username']}' actualizada exitosamente."
        })

# ==============================================================================
# RUTAS ESTÁTICAS Y DASHBOARD
# ==============================================================================
def ensure_gzip_data():
    json_path = os.path.join(BASE_DIR, 'data.json')
    gz_path = os.path.join(BASE_DIR, 'data.json.gz')
    if os.path.exists(json_path):
        if not os.path.exists(gz_path) or os.path.getmtime(json_path) > os.path.getmtime(gz_path):
            try:
                with open(json_path, 'rb') as f_in:
                    with gzip.open(gz_path, 'wb', compresslevel=6) as f_out:
                        f_out.write(f_in.read())
            except Exception as e:
                print("Aviso al comprimir data.json:", e)

@app.route('/')
@login_required
def index():
    return send_from_directory(BASE_DIR, 'index.html')

@app.route('/login')
@app.route('/login.html')
def login_page():
    if 'username' in session:
        return redirect('/')
    return send_from_directory(BASE_DIR, 'login.html')

@app.route('/data.json')
@login_required
def get_data_json():
    ensure_gzip_data()
    accept_encoding = request.headers.get('Accept-Encoding', '')
    gz_path = os.path.join(BASE_DIR, 'data.json.gz')
    if 'gzip' in accept_encoding and os.path.exists(gz_path):
        response = send_from_directory(BASE_DIR, 'data.json.gz', mimetype='application/json')
        response.headers['Content-Encoding'] = 'gzip'
        response.headers['Vary'] = 'Accept-Encoding'
        return response
    return send_from_directory(BASE_DIR, 'data.json', mimetype='application/json')

@app.route('/metadata.json')
@login_required
def get_metadata_json():
    return send_from_directory(BASE_DIR, 'metadata.json', mimetype='application/json')

@app.route('/<path:filename>')
def serve_static(filename):
    if filename in ['index.html', 'data.json'] and 'username' not in session:
        return redirect('/login.html')
    return send_from_directory(BASE_DIR, filename)

# ==============================================================================
# INICIO DE LA APLICACIÓN
# ==============================================================================
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"============================================================")
    print(f"  Iniciando Servidor Web Pañales en puerto {port}")
    print(f"  Acceso Local: http://localhost:{port}")
    print(f"============================================================")
    app.run(host='0.0.0.0', port=port, debug=False)
