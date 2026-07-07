// server.js
// 玄象所 命理網站 - AI 解讀後端代理伺服器
//
// 用途：前端網頁不會直接呼叫 Google Gemini API（那樣金鑰會外流），
// 而是呼叫這支後端的 /api/interpret，由後端用存在伺服器上的金鑰
// 去跟 Gemini API 溝通，再把解讀文字回傳給前端。

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // 正式上線後建議改成只允許自己網站的網域，見下方說明
app.use(express.json());

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// 免費額度模型；流量大常撞限額的話可改成 "gemini-2.5-flash-lite"
const GEMINI_MODEL = "gemini-2.5-flash";

if (!GEMINI_API_KEY) {
  console.warn("⚠️  尚未設定 GEMINI_API_KEY，請參考 .env.example 建立 .env 檔案");
}

// 簡易頻率限制，避免被惡意灌爆（每個 IP 每分鐘最多 20 次）
const rateLimitMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 20;
  const record = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - record.start > windowMs) {
    record.count = 0;
    record.start = now;
  }
  record.count += 1;
  rateLimitMap.set(ip, record);
  return record.count > maxRequests;
}

app.post("/api/interpret", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "請求太頻繁，請稍後再試" });
  }

  const { system, prompt } = req.body;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "缺少 prompt 參數" });
  }
  // 避免使用者亂塞過長內容浪費額度
  if (prompt.length > 2000 || (system && system.length > 2000)) {
    return res.status(400).json({ error: "輸入內容過長" });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.9
          }
        })
      }
    );

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error("Gemini API 錯誤：", response.status, errBody);
      if (response.status === 429) {
        return res
          .status(429)
          .json({ error: "目前 AI 解讀請求太多（已達免費額度上限），請稍等一下再試一次。" });
      }
      return res.status(502).json({ error: "AI 服務暫時無法回應，請稍後再試" });
    }

    const data = await response.json();
    const candidate = data?.candidates?.[0];
    if (!candidate) {
      console.error("Gemini 回應沒有 candidates：", JSON.stringify(data));
      return res.json({ text: "（沒有取得回應，請稍後再試）" });
    }
    if (candidate.finishReason === "SAFETY") {
      return res.json({ text: "這個問題的內容無法生成解讀，請換個方式描述看看。" });
    }

    const text = (candidate.content?.parts || [])
      .map(part => part.text || "")
      .join("\n")
      .trim();

    res.json({ text: text || "（沒有取得回應，請稍後再試）" });
  } catch (err) {
    console.error("伺服器錯誤：", err);
    res.status(500).json({ error: "伺服器發生錯誤，請稍後再試" });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`✅ 後端伺服器啟動，監聽埠號 ${PORT}`);
});
