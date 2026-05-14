# Telegram Learning Bot — Cloudflare Workers Setup

Bot belajar bahasa interaktif yang berjalan di Cloudflare Workers (gratis) dengan Google Gemini API (gratis). Total biaya operasional: **$0/bulan**.

## Yang kamu butuhkan

- Akun Cloudflare (gratis): https://dash.cloudflare.com/sign-up
- Akun Google AI Studio (gratis): https://aistudio.google.com
- Telegram + akses ke @BotFather
- Node.js 18+ di laptop (untuk wrangler CLI)

## Step 1 — Buat Telegram Bot

1. Chat ke **@BotFather** di Telegram
2. Kirim `/newbot`
3. Kasih nama bot + username (harus berakhir `bot`)
4. Salin **bot token** (format: `123456789:AAH...`)

## Step 2 — Dapat Gemini API Key

1. Buka https://aistudio.google.com
2. Login dengan Google account
3. Klik **"Get API key"** → **"Create API key"**
4. Salin API key (format: `AIza...`)
5. Free tier kamu: **1.500 request/hari di Gemini 2.5 Flash** — nggak butuh credit card

## Step 3 — Install Wrangler & Login

```bash
cd telegram-bot
npm install
npx wrangler login
```

Browser akan terbuka, login ke Cloudflare, authorize.

## Step 4 — Buat KV Namespace

```bash
npx wrangler kv namespace create STATE
```

Output akan kasih ID seperti ini:
```
🌀 Creating namespace with title "telegram-learning-bot-STATE"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
[[kv_namespaces]]
binding = "STATE"
id = "abc123def456..."
```

**Copy ID-nya** dan ganti `GANTI_DENGAN_KV_ID_HASIL_PERINTAH_WRANGLER` di `wrangler.toml`.

## Step 5 — Set Secrets

Jalankan 3 perintah berikut, masukkan value-nya saat diminta:

```bash
npx wrangler secret put TELEGRAM_TOKEN
# Paste bot token dari Step 1

npx wrangler secret put GEMINI_API_KEY
# Paste API key dari Step 2

npx wrangler secret put WEBHOOK_SECRET
# Bikin random string, misal: openssl rand -hex 16
# Atau cukup ketik password random apa aja, misal: mysecret123abc
```

## Step 6 — Deploy

```bash
npx wrangler deploy
```

Output akan kasih URL Worker kamu, misal:
```
https://telegram-learning-bot.<your-subdomain>.workers.dev
```

**Salin URL ini.**

## Step 7 — Daftarkan Webhook ke Telegram

Ganti placeholder dan jalankan di terminal (atau buka di browser):

```bash
TELEGRAM_TOKEN="123456789:AAH..."
WORKER_URL="https://telegram-learning-bot.xxx.workers.dev"
WEBHOOK_SECRET="mysecret123abc"

curl "https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${WORKER_URL}&secret_token=${WEBHOOK_SECRET}"
```

Jawaban yang benar:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

## Step 8 — Test

Buka Telegram, cari bot kamu, kirim `/start`. Harusnya langsung dapat balasan dengan menu.

Coba juga:
- `/topic japanese` → ganti ke Jepang
- Tulis "halo, ajari aku kata salam basic" → Gemini bakal jawab
- `/stats` → cek streak

## Debugging

**Bot nggak balas?**
```bash
npx wrangler tail
```
Ini stream log real-time. Kirim pesan ke bot, lihat error apa yang muncul.

**Cek status webhook:**
```bash
curl "https://api.telegram.org/bot${TELEGRAM_TOKEN}/getWebhookInfo"
```
Field `last_error_message` kalau ada masalah.

**Reset webhook (kalau perlu):**
```bash
curl "https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteWebhook"
```

## Quota & Biaya

| Resource | Free tier | Pemakaian estimasi |
|---|---|---|
| Cloudflare Workers requests | 100.000/hari | ~200/hari |
| Cloudflare KV reads | 100.000/hari | ~200/hari |
| Cloudflare KV writes | 1.000/hari | ~200/hari |
| Gemini API requests | 1.500/hari | ~200/hari |

Aman jauh di bawah limit.

## Update Code

Setelah edit `src/index.js`:
```bash
npx wrangler deploy
```
Itu doang — auto-deploy ulang.

## Next Steps

- **Scheduled push** (kirim notifikasi pagi otomatis): tambah Cron Trigger di `wrangler.toml`, bikin handler `scheduled()` baru — Workers free tier support cron
- **Multi-user**: kode sudah siap multi-user (state per `userId`), tinggal share bot ke teman
- **Backup state**: export KV ke JSON rutin (`wrangler kv key list`)
- **Inline keyboard buttons** buat pilihan ABCD di quiz mode: tambah `reply_markup` di `sendMessage`
