/**
 * Interactive Telegram Learning Bot — Cloudflare Worker
 * Stack: Cloudflare Workers + Workers KV + Google Gemini API
 *
 * Entry: POST /  (Telegram webhook)
 * Env vars needed (set via `wrangler secret put`):
 *   - TELEGRAM_TOKEN     : bot token dari @BotFather
 *   - GEMINI_API_KEY     : dari aistudio.google.com
 *   - WEBHOOK_SECRET     : random string buat verifikasi webhook
 * KV binding (di wrangler.toml):
 *   - STATE              : namespace untuk per-user state
 */

// ─── System Prompts per Topik ──────────────────────────
const SYSTEM_PROMPTS = {
  ielts: `You are Ananta's personal IELTS coach. Current band: 5.0, target: 6.5. Weakest skill: Speaking (4.0).

Rules:
- ALWAYS respond in English (it IS the practice)
- When correcting grammar/structure mistakes, explain the correction IN INDONESIAN
- He especially struggles with: article usage (a/an/the), sentence structure, conjunctions, prepositions, parts of speech
- Push him toward Band 7 vocabulary gradually
- Keep feedback specific, never generic ("good job" without reason)
- If he produces a paragraph or spoken answer, score it: Task Achievement, Coherence, Lexical Resource, Grammar
- Current mode: {mode}`,

  japanese: `You are Ananta's Japanese tutor. He's around N5 level and has traveled solo to Tokyo, Nagoya, Osaka, Kyoto.

Rules:
- Show: hiragana/katakana + romaji + Indonesian translation
- Introduce kanji gradually with furigana
- Connect new vocab to travel/daily-life situations when possible
- Keep responses bite-sized (this is on mobile)
- Current mode: {mode}`,

  mandarin: `You are Ananta's Mandarin tutor. Complete beginner.

Rules:
- Always show: 汉字 + pinyin (with tone marks) + Indonesian translation
- Start from HSK 1 vocabulary
- Explain tone differences when relevant — beginners struggle with this most
- Current mode: {mode}`,

  german: `You are Ananta's German tutor. Complete beginner.

Rules:
- Show: German + Indonesian translation
- ALWAYS state grammatical gender explicitly (der/die/das)
- Start from A1 vocabulary
- Note false friends with English when relevant (he's also studying IELTS)
- Current mode: {mode}`,
};

const MODE_HINTS = {
  vocab:    "Focus on vocabulary. Give a word + example + quick usage question.",
  grammar:  "Focus on grammar rules and pattern drills.",
  speaking: "Conversational mode. Ask open questions, react naturally, correct gently after his answers.",
  writing:  "Have him write short paragraphs. Critique structure, word choice, cohesion.",
  quiz:     "Quiz mode: give ONE question, wait for answer, then evaluate before next.",
};

const GEMINI_MODEL = "gemini-2.5-flash"; // 1.500 req/hari gratis
const MAX_HISTORY = 20; // simpan ~10 turn terakhir

// ─── State Management (Workers KV) ─────────────────────
async function getUser(env, userId) {
  const raw = await env.STATE.get(`user:${userId}`, "json");
  if (raw) return raw;
  return {
    topic: "ielts",
    mode: "vocab",
    history: [],
    streak: 0,
    lastActive: null,
    totalMessages: 0,
  };
}

async function saveUser(env, userId, user) {
  await env.STATE.put(`user:${userId}`, JSON.stringify(user));
}

function updateStreak(user) {
  const today = new Date().toISOString().slice(0, 10);
  if (user.lastActive === today) return;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  user.streak = user.lastActive === yesterday ? user.streak + 1 : 1;
  user.lastActive = today;
}

// ─── Gemini API Call ───────────────────────────────────
async function callGemini(env, systemPrompt, history) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

  // Convert {role: "user"|"assistant", content: "..."} → Gemini format
  const contents = history.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      maxOutputTokens: 800,
      temperature: 0.7,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reply) throw new Error("Gemini returned no text");
  return reply;
}

// ─── Telegram API Helpers ──────────────────────────────
async function tg(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const sendMessage = (env, chatId, text, parseMode) =>
  tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: parseMode });

const sendTyping = (env, chatId) =>
  tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });

// ─── Command Handlers ──────────────────────────────────
async function handleCommand(env, cmd, args, chatId, userId) {
  const user = await getUser(env, userId);

  switch (cmd) {
    case "/start":
      return sendMessage(env, chatId,
        "👋 Halo Ananta! Aku tutor bahasa kamu.\n\n" +
        "📚 /topic ielts | japanese | mandarin | german\n" +
        "🎯 /mode  vocab | grammar | speaking | writing | quiz\n" +
        "📊 /stats — lihat streak\n" +
        "♻️ /reset — bersihkan history percakapan\n\n" +
        "Default: IELTS + vocab. Tulis apapun untuk mulai."
      );

    case "/topic": {
      const t = args[0];
      if (!t || !SYSTEM_PROMPTS[t]) {
        return sendMessage(env, chatId,
          `Topik sekarang: *${user.topic}*\nPilihan: ielts, japanese, mandarin, german`,
          "Markdown"
        );
      }
      user.topic = t;
      user.history = []; // clear context tiap ganti topik
      await saveUser(env, userId, user);
      return sendMessage(env, chatId, `✅ Switched to *${t}*. History dibersihkan.`, "Markdown");
    }

    case "/mode": {
      const m = args[0];
      if (!m || !MODE_HINTS[m]) {
        return sendMessage(env, chatId,
          `Mode sekarang: *${user.mode}*\nPilihan: ${Object.keys(MODE_HINTS).join(", ")}`,
          "Markdown"
        );
      }
      user.mode = m;
      await saveUser(env, userId, user);
      return sendMessage(env, chatId, `🎯 Mode: *${m}*`, "Markdown");
    }

    case "/stats":
      return sendMessage(env, chatId,
        `📊 *Stats kamu*\n\n` +
        `🔥 Streak: ${user.streak} hari\n` +
        `💬 Total pesan: ${user.totalMessages}\n` +
        `📚 Topik aktif: ${user.topic}\n` +
        `🎯 Mode aktif: ${user.mode}`,
        "Markdown"
      );

    case "/reset":
      user.history = [];
      await saveUser(env, userId, user);
      return sendMessage(env, chatId, "♻️ History dibersihkan. Mulai topik baru!");

    default:
      return sendMessage(env, chatId, "❓ Command nggak dikenal. Pakai /start.");
  }
}

// ─── Main Message Handler ──────────────────────────────
async function handleMessage(env, text, chatId, userId) {
  const user = await getUser(env, userId);

  const systemPrompt =
    SYSTEM_PROMPTS[user.topic].replace("{mode}", user.mode) +
    `\n\nMode behavior: ${MODE_HINTS[user.mode]}`;

  user.history.push({ role: "user", content: text });
  if (user.history.length > MAX_HISTORY) {
    user.history = user.history.slice(-MAX_HISTORY);
  }

  await sendTyping(env, chatId);

  let reply;
  try {
    reply = await callGemini(env, systemPrompt, user.history);
  } catch (e) {
    user.history.pop(); // rollback message kalau Gemini error
    return sendMessage(env, chatId, `⚠️ Error: ${e.message}`);
  }

  user.history.push({ role: "assistant", content: reply });
  user.totalMessages += 1;
  updateStreak(user);
  await saveUser(env, userId, user);

  // Kirim tanpa parse_mode biar nggak crash kalau Gemini pakai karakter spesial
  return sendMessage(env, chatId, reply);
}

// ─── Webhook Entry Point ───────────────────────────────
export default {
  async fetch(request, env) {
    // Telegram cuma POST. GET buat health check.
    if (request.method === "GET") {
      return new Response("Bot is alive 🤖", { status: 200 });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Verifikasi secret token (security)
    if (env.WEBHOOK_SECRET) {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secret !== env.WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const message = update.message;
    if (!message?.text) {
      return new Response("OK"); // skip non-text (foto, sticker, dll)
    }

    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text.trim();

    try {
      if (text.startsWith("/")) {
        const [cmd, ...args] = text.split(/\s+/);
        await handleCommand(env, cmd, args, chatId, userId);
      } else {
        await handleMessage(env, text, chatId, userId);
      }
    } catch (e) {
      console.error("Handler error:", e);
      await sendMessage(env, chatId, `⚠️ Internal error: ${e.message}`).catch(() => {});
    }

    // Selalu balas 200 ke Telegram biar nggak retry
    return new Response("OK");
  },
};
