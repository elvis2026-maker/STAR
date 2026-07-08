// api/interpret.js
// 如果你想用 Vercel 部署（不用自己管伺服器），把這個檔案放在專案的 /api 資料夾，
// Vercel 會自動把它變成一支 API：https://你的網域/api/interpret
//
// 這支改用 Google Gemini API（有免費額度、不用綁信用卡）。
// 記得到 Vercel 專案設定 → Environment Variables 加入 GEMINI_API_KEY
// 金鑰申請網址：https://aistudio.google.com/apikey
//
// 免費額度模型用 gemini-2.5-flash 當主力（品質較好）。
// 如果撞到限額（429／模型不存在等錯誤），會自動改用下面 FALLBACK_MODELS 清單中的模型依序繼續嘗試，
// 因為 Google AI Studio 免費額度是「每個模型各自獨立計算」，
// 一個模型的額度用完，換另一個模型通常還有剩餘額度可以用，等於把免費額度加總起來用。
//
// 【2026/07 更新】Google 在 2026 年陸續調整了免費層可用的模型：
//   - gemini-2.0-flash / gemini-2.0-flash-lite 已在 2026/6/1 停用，不要再加進清單（一定會 404）
//   - gemini-2.5-pro 已改為付費限定（免費層不再提供）
//   - gemini-3.1-flash-lite、gemini-flash-latest（目前指向 Gemini 3.5 Flash）是 2026 年中新增的免費層模型，
//     額度是「獨立計算」，所以先加進備援清單，多一個可以分攤流量的免費額度
// 每個 Google Cloud 專案實際額度可能不同（同一個模型不同專案的每日上限不一定一樣），
// 建議直接到 https://aistudio.google.com/rate-limit 看自己專案「目前」的即時額度，比任何文章上的數字都準。
// 之後想再加開別的免費模型當備援，直接把模型名稱加進這個陣列即可（會依序嘗試，任何一個失敗都會自動換下一個）。
const MODEL = "gemini-2.5-flash";
const FALLBACK_MODELS = ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"];

// ---------------------------------------------------------
// V17 新增：來源網域白名單（防止有人複製前端頁面後，直接打你的 /api/interpret 端點盜用你的 Gemini 額度）
// 到 Vercel → Environment Variables 新增 ALLOWED_ORIGIN，值設為你正式網站網址，
// 例如 https://star-seven-tan.vercel.app（有自訂網域就填自訂網域，不要有結尾斜線）。
// 沒設定這個環境變數時，這道檢查會自動跳過（不會擋到你自己），但強烈建議設定。
// ---------------------------------------------------------
function isAllowedOrigin(req) {
  const allowed = (process.env.ALLOWED_ORIGIN || "").trim().replace(/\/$/, "");
  if (!allowed) return true; // 尚未設定白名單，先不擋（避免自己被鎖住）
  const origin = (req.headers.origin || "").replace(/\/$/, "");
  const referer = (req.headers.referer || "");
  if (origin && origin === allowed) return true;
  if (!origin && referer.startsWith(allowed)) return true; // 少數瀏覽器情境不帶 origin，退而求其次比對 referer
  return false;
}

// ---------------------------------------------------------
// V17 新增：簡易頻率限制（同一個 IP 在時間窗口內的請求數上限）
// 註：Vercel 的 Serverless Function 每個執行環境是獨立的，記憶體不會跨執行個體共享，
// 高流量時效果會打折扣；這只能擋掉單機腳本猛刷的狀況，不是完整的防護方案。
// 若之後流量變大、想要更可靠的限制，建議改接 Vercel KV 或 Upstash Redis 做跨執行個體計數。
// ---------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 分鐘
const RATE_LIMIT_MAX = 20; // 同一 IP 10 分鐘內最多 20 次請求
const rateLimitStore = globalThis.__miliRateLimitStore || (globalThis.__miliRateLimitStore = new Map());
function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip);
  if (!record || now > record.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  record.count += 1;
  if (record.count > RATE_LIMIT_MAX) return false;
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "只接受 POST 請求" });
  }

  if (!isAllowedOrigin(req)) {
    console.warn("被拒絕的來源請求：", req.headers.origin || req.headers.referer);
    return res.status(403).json({ error: "不允許的來源" });
  }

  const clientIp = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ error: "請求太頻繁，請稍後再試。" });
  }

  const { system, prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "缺少 prompt 參數" });
  }
  if (prompt.length > 2000 || (system && system.length > 2000)) {
    return res.status(400).json({ error: "輸入內容過長" });
  }

  const rawKey = process.env.GEMINI_API_KEY || "";
  if (!rawKey) {
    console.error("GEMINI_API_KEY 尚未設定");
    return res.status(500).json({ error: "伺服器尚未設定金鑰，請聯絡網站管理員" });
  }

  // 把「呼叫某一個 Gemini 模型」包成一個函式，方便待會依序嘗試多個模型
  async function callGeminiModel(model) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: {
            maxOutputTokens: 1500,
            temperature: 0.9,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    );
    return response;
  }

  try {
    const modelsToTry = [MODEL, ...FALLBACK_MODELS];
    let response = null;
    let lastStatus = null;

    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];
      response = await callGeminiModel(model);

      if (response.ok) {
        if (i > 0) console.warn(`「${modelsToTry[0]}」額度已滿，已自動改用備援模型「${model}」`);
        break;
      }

      lastStatus = response.status;
      const errBody = await response.json().catch(() => ({}));
      console.error(`Gemini API 錯誤（模型：${model}）：`, response.status, errBody);

      // 只要清單裡還有下一個模型可以試，不管這次是什麼錯誤（額度已滿 429、
      // 這個專案未開通該模型 403/404、模型名稱打錯或已停用 400...）都直接換下一個繼續嘗試，
      // 這樣之後在 FALLBACK_MODELS 陣列裡新增任何模型名稱都很安全，
      // 就算那個模型在你的專案上其實不存在／沒開通，也只是很快失敗、自動跳到下一個，不會卡住。
      if (i < modelsToTry.length - 1) {
        continue;
      }
      break;
    }

    if (!response.ok) {
      // 所有模型都試過了、都還是額度已滿
      if (lastStatus === 429) {
        return res
          .status(429)
          .json({ error: "目前 AI 解讀請求太多（已達免費額度上限），請稍等一下再試一次。" });
      }
      return res.status(502).json({ error: "AI 服務暫時無法回應，請稍後再試" });
    }

    const data = await response.json();

    // Gemini 有時會因為安全過濾器擋下回應，這裡順便處理一下，訊息比較好懂
    const candidate = data?.candidates?.[0];
    if (!candidate) {
      console.error("Gemini 回應沒有 candidates：", JSON.stringify(data));
      return res.status(200).json({ text: "（沒有取得回應，請稍後再試）" });
    }
    if (candidate.finishReason === "SAFETY") {
      return res.status(200).json({ text: "這個問題的內容無法生成解讀，請換個方式描述看看。" });
    }

    const text = (candidate.content?.parts || [])
      .map(part => part.text || "")
      .join("\n")
      .trim();

    res.status(200).json({ text: text || "（沒有取得回應，請稍後再試）" });
  } catch (err) {
    console.error("伺服器錯誤：", err);
    res.status(500).json({ error: "伺服器發生錯誤，請稍後再試" });
  }
}
