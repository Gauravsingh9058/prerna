# Prerna Canteen

Prerna Canteen is a Flask + SQLite food ordering app with:

- responsive menu and cart
- ward/room and phone checkout
- live GPS location tracking
- Google Maps preview
- WhatsApp order handoff
- UPI QR payment display
- admin dashboard with live refresh
- printable bill download
- Android WebView wrapper in `android-wrapper/`

## Run locally

```bash
python app.py
```

Then open:

```text
http://127.0.0.1:5000
```

## Main files

- `app.py`
- `templates/`
- `static/`
- `android-wrapper/`

## Deploy on Render

This repo is prepared for Render deployment with `render.yaml`.

Steps:

1. Sign in to Render.
2. Click `New` -> `Blueprint`.
3. Connect the GitHub repo `Gauravsingh9058/prerna`.
4. Select the `main` branch.
5. Render should detect `render.yaml` automatically.
6. Click `Deploy Blueprint`.

Render will use:

- build command: `pip install -r requirements.txt`
- start command: `gunicorn app:app`
- health check: `/healthz`
