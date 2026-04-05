from __future__ import annotations

import math
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

import qrcode
from PIL import Image, ImageDraw
from flask import (
    Flask,
    abort,
    g,
    jsonify,
    redirect,
    render_template,
    render_template_string,
    request,
    send_from_directory,
    url_for,
)

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = BASE_DIR / "prerna_canteen_store.sqlite3"
STATIC_DIR = BASE_DIR / "static"
QR_PATH = STATIC_DIR / "qr.png"
ICON_192_PATH = STATIC_DIR / "icon-192.png"
ICON_512_PATH = STATIC_DIR / "icon-512.png"
APPLE_TOUCH_ICON_PATH = STATIC_DIR / "apple-touch-icon.png"

UPI_ID = "7500510588@sbi"
WHATSAPP_NUMBER = "917500510588"
MAX_DELIVERY_DISTANCE_KM = 5

# Update these coordinates to the exact canteen location when needed.
CANTEEN_LOCATION = {
    "name": "Prerna Canteen",
    "latitude": 28.6139,
    "longitude": 77.2090,
}

STATUS_OPTIONS = ["Pending", "Preparing", "Out for Delivery", "Delivered", "Cancelled"]

MENU_ITEMS = [
    {"name": "Tea", "price": 10, "category": "Beverages"},
    {"name": "Aalu Paratha", "price": 20, "category": "Meals"},
    {"name": "Full Thali", "price": 60, "category": "Meals"},
    {"name": "Half Thali", "price": 30, "category": "Meals"},
    {"name": "Kurkure", "price": 10, "category": "Snacks"},
    {"name": "Chips", "price": 10, "category": "Snacks"},
    {"name": "Biscuits", "price": 10, "category": "Snacks"},
    {"name": "Water Bottle", "price": 20, "category": "Beverages"},
    {"name": "Sandwich", "price": 10, "category": "Snacks"},
    {"name": "Samosa", "price": 15, "category": "Snacks"},
    {"name": "Thumbs Up", "price": 50, "category": "Beverages"},
    {"name": "Nimbu Jeera", "price": 10, "category": "Beverages"},
    {"name": "Mountain Dew", "price": 40, "category": "Beverages"},
    {"name": "Campa", "price": 20, "category": "Beverages"},
    {"name": "Maggi Half", "price": 20, "category": "Instant Specials"},
    {"name": "Maggi Full", "price": 35, "category": "Instant Specials"},
]

MENU_LOOKUP = {item["name"]: item for item in MENU_ITEMS}
CATEGORY_MAP: dict[str, list[dict[str, Any]]] = {}
for item in MENU_ITEMS:
    CATEGORY_MAP.setdefault(item["category"], []).append(item)

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        connection = sqlite3.connect(DATABASE_PATH)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=MEMORY;")
        connection.execute("PRAGMA temp_store=MEMORY;")
        g.db = connection
    return g.db


@app.teardown_appcontext
def close_db(_: Any) -> None:
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def init_db() -> None:
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ward TEXT NOT NULL,
            phone TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            distance_km REAL NOT NULL,
            map_url TEXT NOT NULL,
            total_amount INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'Pending',
            payment_status TEXT NOT NULL DEFAULT 'Awaiting UPI Payment',
            whatsapp_message TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            item_name TEXT NOT NULL,
            unit_price INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            subtotal INTEGER NOT NULL,
            FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


def generate_qr_if_missing() -> None:
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
    if QR_PATH.exists():
        return

    upi_payload = urlencode({"pa": UPI_ID, "pn": "Prerna Canteen", "cu": "INR"})
    qr_image = qrcode.make(f"upi://pay?{upi_payload}")
    qr_image.save(QR_PATH)


def generate_app_icons_if_missing() -> None:
    STATIC_DIR.mkdir(parents=True, exist_ok=True)

    def create_icon(path: Path, size: int) -> None:
        if path.exists():
            return

        icon = Image.new("RGBA", (size, size), "#fff7ef")
        draw = ImageDraw.Draw(icon)
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=size // 5, fill="#fff7ef")
        draw.ellipse((size * 0.08, size * 0.06, size * 0.92, size * 0.9), fill="#ffeddc")
        draw.rounded_rectangle(
            (size * 0.18, size * 0.24, size * 0.82, size * 0.78),
            radius=size * 0.14,
            fill="#ef6c2f",
        )
        draw.rounded_rectangle(
            (size * 0.28, size * 0.16, size * 0.72, size * 0.24),
            radius=size * 0.04,
            fill="#1f9d73",
        )
        draw.ellipse((size * 0.32, size * 0.34, size * 0.68, size * 0.7), fill="#fffaf5")
        draw.arc(
            (size * 0.5, size * 0.34, size * 0.84, size * 0.68),
            start=285,
            end=70,
            fill="#fffaf5",
            width=max(4, size // 32),
        )
        draw.rounded_rectangle(
            (size * 0.34, size * 0.58, size * 0.66, size * 0.64),
            radius=size * 0.02,
            fill="#1f9d73",
        )
        draw.rounded_rectangle(
            (size * 0.25, size * 0.68, size * 0.75, size * 0.73),
            radius=size * 0.02,
            fill="#cc4d13",
        )
        icon.save(path)

    create_icon(ICON_192_PATH, 192)
    create_icon(ICON_512_PATH, 512)
    create_icon(APPLE_TOUCH_ICON_PATH, 180)


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_km * c


def build_whatsapp_message(items: list[dict[str, Any]], ward: str, phone: str, lat: float, lng: float) -> str:
    item_lines = "\n".join(
        f"- {item['item_name']} x{item['quantity']} (Rs. {item['subtotal']})" for item in items
    )
    return (
        "New Order - Prerna Canteen\n"
        f"Items:\n{item_lines}\n"
        f"Ward: {ward}\n"
        f"Phone: {phone}\n"
        f"Location: https://maps.google.com/?q={lat},{lng}"
    )


def build_whatsapp_url(message: str) -> str:
    return f"https://wa.me/{WHATSAPP_NUMBER}?text={quote(message)}"


def serialize_order(order_id: int) -> dict[str, Any] | None:
    db = get_db()
    order = db.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if order is None:
        return None

    items = db.execute(
        "SELECT item_name, unit_price, quantity, subtotal FROM order_items WHERE order_id = ? ORDER BY id ASC",
        (order_id,),
    ).fetchall()
    item_list = [dict(item) for item in items]

    serialized = dict(order)
    serialized["items"] = item_list
    serialized["line_items"] = item_list
    serialized["items_label"] = ", ".join(f"{item['item_name']} x{item['quantity']}" for item in item_list)
    serialized["whatsapp_url"] = build_whatsapp_url(serialized["whatsapp_message"])
    serialized["bill_url"] = url_for("bill", order_id=order_id)
    return serialized


def get_all_orders() -> list[dict[str, Any]]:
    db = get_db()
    rows = db.execute("SELECT id FROM orders ORDER BY id DESC").fetchall()
    serialized_orders = []
    for row in rows:
        order = serialize_order(row["id"])
        if order is not None:
            serialized_orders.append(order)
    return serialized_orders


def admin_metrics(orders: list[dict[str, Any]]) -> dict[str, int]:
    pending = sum(1 for order in orders if order["status"] == "Pending")
    active = sum(
        1 for order in orders if order["status"] in {"Pending", "Preparing", "Out for Delivery"}
    )
    return {"total": len(orders), "pending": pending, "active": active}


@app.route("/")
def index() -> str:
    frontend_config = {
        "orderEndpoint": url_for("create_order"),
        "maxDistanceKm": MAX_DELIVERY_DISTANCE_KM,
        "canteen": CANTEEN_LOCATION,
        "installPromptEnabled": True,
    }
    return render_template(
        "index.html",
        categories=CATEGORY_MAP,
        qr_url=url_for("static", filename="qr.png"),
        upi_id=UPI_ID,
        canteen=CANTEEN_LOCATION,
        max_distance=MAX_DELIVERY_DISTANCE_KM,
        frontend_config=frontend_config,
    )


@app.route("/manifest.webmanifest")
def manifest() -> Any:
    return send_from_directory(STATIC_DIR, "manifest.webmanifest", mimetype="application/manifest+json")


@app.route("/service-worker.js")
def service_worker() -> Any:
    return send_from_directory(STATIC_DIR, "service-worker.js", mimetype="application/javascript")


@app.post("/order")
def create_order():
    data = request.get_json(silent=True) or {}

    ward = str(data.get("ward", "")).strip()
    phone = str(data.get("phone", "")).strip()
    raw_items = data.get("items") or []

    if not ward:
        return jsonify({"ok": False, "error": "Ward / room is required."}), 400

    digits = "".join(character for character in phone if character.isdigit())
    if len(digits) < 10:
        return jsonify({"ok": False, "error": "Please enter a valid phone number."}), 400

    try:
        latitude = float(data.get("latitude"))
        longitude = float(data.get("longitude"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Live GPS location is required to place an order."}), 400

    validated_items: list[dict[str, Any]] = []
    total_amount = 0

    for item in raw_items:
        item_name = str(item.get("name", "")).strip()
        if item_name not in MENU_LOOKUP:
            return jsonify({"ok": False, "error": f"Unknown menu item: {item_name}"}), 400

        try:
            quantity = int(item.get("quantity", 0))
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": f"Invalid quantity for {item_name}."}), 400

        if quantity < 1 or quantity > 20:
            return jsonify({"ok": False, "error": f"Quantity for {item_name} must be between 1 and 20."}), 400

        unit_price = MENU_LOOKUP[item_name]["price"]
        subtotal = unit_price * quantity
        total_amount += subtotal
        validated_items.append(
            {
                "item_name": item_name,
                "unit_price": unit_price,
                "quantity": quantity,
                "subtotal": subtotal,
            }
        )

    if not validated_items:
        return jsonify({"ok": False, "error": "Your cart is empty."}), 400

    distance_km = haversine_distance(
        CANTEEN_LOCATION["latitude"],
        CANTEEN_LOCATION["longitude"],
        latitude,
        longitude,
    )
    if distance_km > MAX_DELIVERY_DISTANCE_KM:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": f"Delivery is available only within {MAX_DELIVERY_DISTANCE_KM} km of the canteen.",
                }
            ),
            400,
        )

    map_url = f"https://maps.google.com/?q={latitude},{longitude}"
    whatsapp_message = build_whatsapp_message(validated_items, ward, phone, latitude, longitude)
    created_at = datetime.now().strftime("%d %b %Y, %I:%M %p")

    db = get_db()
    cursor = db.execute(
        """
        INSERT INTO orders (
            ward,
            phone,
            latitude,
            longitude,
            distance_km,
            map_url,
            total_amount,
            status,
            payment_status,
            whatsapp_message,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', 'Awaiting UPI Payment', ?, ?)
        """,
        (ward, phone, latitude, longitude, round(distance_km, 2), map_url, total_amount, whatsapp_message, created_at),
    )
    order_id = cursor.lastrowid

    for item in validated_items:
        db.execute(
            """
            INSERT INTO order_items (order_id, item_name, unit_price, quantity, subtotal)
            VALUES (?, ?, ?, ?, ?)
            """,
            (order_id, item["item_name"], item["unit_price"], item["quantity"], item["subtotal"]),
        )

    db.commit()

    return jsonify(
        {
            "ok": True,
            "orderId": order_id,
            "redirectUrl": url_for("success", order_id=order_id),
        }
    )


@app.route("/admin")
def admin() -> str:
    admin_config = {
        "ordersApi": url_for("orders_api"),
        "statusApiBase": "/admin/status",
        "refreshMs": 5000,
        "statuses": STATUS_OPTIONS,
    }
    return render_template("admin.html", admin_config=admin_config)


@app.get("/api/orders")
def orders_api():
    orders = get_all_orders()
    metrics = admin_metrics(orders)
    return jsonify({"orders": orders, "metrics": metrics})


@app.post("/admin/status/<int:order_id>")
def update_order_status(order_id: int):
    payload = request.get_json(silent=True) or {}
    status = str(payload.get("status", "")).strip()
    if status not in STATUS_OPTIONS:
        return jsonify({"ok": False, "error": "Invalid order status."}), 400

    db = get_db()
    updated = db.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
    db.commit()

    if updated.rowcount == 0:
        return jsonify({"ok": False, "error": "Order not found."}), 404

    return jsonify({"ok": True, "status": status})


@app.route("/success")
def success() -> str:
    order_id = request.args.get("order_id", type=int)
    if not order_id:
        return redirect(url_for("index"))

    order = serialize_order(order_id)
    if order is None:
        abort(404)

    return render_template("success.html", order=order)


BILL_TEMPLATE = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bill #{{ order.id }} | Prerna Canteen</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #16213d;
      --muted: #61708a;
      --line: rgba(22, 33, 61, 0.12);
      --card: #ffffff;
      --accent: #e96f2e;
      --accent-soft: rgba(233, 111, 46, 0.12);
      --bg: linear-gradient(180deg, #fffaf5 0%, #f4f7fb 100%);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      color: var(--ink);
      background: var(--bg);
      padding: 24px;
    }
    .bill-shell {
      max-width: 860px;
      margin: 0 auto;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 28px;
      box-shadow: 0 20px 45px rgba(20, 29, 55, 0.08);
    }
    .bill-head, .bill-total, .bill-meta { display: flex; justify-content: space-between; gap: 16px; }
    .bill-head { align-items: flex-start; margin-bottom: 24px; }
    .bill-meta { flex-wrap: wrap; margin-bottom: 24px; }
    .meta-card {
      flex: 1 1 220px;
      background: var(--accent-soft);
      border-radius: 18px;
      padding: 16px;
    }
    h1, h2, p { margin: 0; }
    h1 { font-size: 2rem; margin-bottom: 6px; }
    p { color: var(--muted); }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 24px 0;
    }
    th, td {
      text-align: left;
      padding: 14px 10px;
      border-bottom: 1px solid var(--line);
    }
    th { color: var(--muted); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.08em; }
    .bill-total {
      margin-top: 10px;
      padding-top: 20px;
      border-top: 2px dashed var(--line);
      font-size: 1.2rem;
      font-weight: 700;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 28px;
      flex-wrap: wrap;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 46px;
      padding: 0 18px;
      border-radius: 999px;
      text-decoration: none;
      font-weight: 700;
      border: 0;
      cursor: pointer;
    }
    .btn-primary { background: var(--accent); color: white; }
    .btn-secondary { background: white; color: var(--ink); border: 1px solid var(--line); }
    @media print {
      body { background: white; padding: 0; }
      .bill-shell { box-shadow: none; border: 0; padding: 0; }
      .actions { display: none; }
    }
  </style>
</head>
<body>
  <section class="bill-shell">
    <div class="bill-head">
      <div>
        <h1>Prerna Canteen</h1>
        <p>Fresh meals, quick snacks, and easy campus delivery.</p>
      </div>
      <div>
        <p><strong>Bill No.</strong> #{{ order.id }}</p>
        <p><strong>Date</strong> {{ order.created_at }}</p>
      </div>
    </div>

    <div class="bill-meta">
      <div class="meta-card">
        <h2>Delivery Details</h2>
        <p>Ward / Room: {{ order.ward }}</p>
        <p>Phone: {{ order.phone }}</p>
      </div>
      <div class="meta-card">
        <h2>Order Status</h2>
        <p>{{ order.status }}</p>
        <p>Distance: {{ order.distance_km }} km</p>
      </div>
      <div class="meta-card">
        <h2>Payment</h2>
        <p>{{ order.payment_status }}</p>
        <p>UPI: {{ upi_id }}</p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Rate</th>
          <th>Qty</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        {% for item in order.line_items %}
        <tr>
          <td>{{ item.item_name }}</td>
          <td>Rs. {{ item.unit_price }}</td>
          <td>{{ item.quantity }}</td>
          <td>Rs. {{ item.subtotal }}</td>
        </tr>
        {% endfor %}
      </tbody>
    </table>

    <div class="bill-total">
      <span>Total</span>
      <span>Rs. {{ order.total_amount }}</span>
    </div>

    <div class="actions">
      <button class="btn btn-primary" onclick="window.print()">Download / Print Bill</button>
      <a class="btn btn-secondary" href="{{ url_for('success', order_id=order.id) }}">Back to order status</a>
    </div>
  </section>
</body>
</html>
"""


@app.route("/bill/<int:order_id>")
def bill(order_id: int) -> str:
    order = serialize_order(order_id)
    if order is None:
        abort(404)
    return render_template_string(BILL_TEMPLATE, order=order, upi_id=UPI_ID)


with app.app_context():
    init_db()
    generate_qr_if_missing()
    generate_app_icons_if_missing()


if __name__ == "__main__":
    app.run(debug=True)
