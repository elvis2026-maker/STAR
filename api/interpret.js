// api/interpret.js
// 如果你想用 Vercel 部署（不用自己管伺服器），把這個檔案放在專案的 /api 資料夾，
// Vercel 會自動把它變成一支 API：https://你的網域/api/interpret
//
// 這支改用 Google Gemini API（有免費額度、不用綁信用卡）。
// 記得到 Vercel 專案設定 → Environment Variables 加入 GEMINI_API_KEY
// （選用：也可以再加一把 MI_GEMINI_API_KEY 當備援金鑰，詳見下方「V36 新增：多組 Gemini 金鑰依序輪替」說明）
// 金鑰申請網址：https://aistudio.google.com/apikey
//
// 免費額度模型用 gemini-3.6-flash 當主力（品質最好、目前 Google 最新一代 Flash 主力機型）。
// 如果撞到限額（429／模型不存在等錯誤），會自動改用下面 FALLBACK_MODELS 清單中的模型依序繼續嘗試，
// 因為 Google AI Studio 免費額度是「每個模型各自獨立計算」，
// 一個模型的額度用完，換另一個模型通常還有剩餘額度可以用，等於把免費額度加總起來用。
//
// 【2026/07 更新】Google 在 2026/7/21 發布了 Gemini 3.6 Flash 與 Gemini 3.5 Flash-Lite（GA 正式版），
// 3.6 Flash 效能優於前代 3.5 Flash、輸出 token 用量更省，3.5 Flash-Lite 則是同代最快最省成本的版本；
// 這次照你的指定，把清單換成這三個模型依序嘗試：
//   1. gemini-3.6-flash（主力，品質最好）
//   2. gemini-3.5-flash（備援，上一代主力機型）
//   3. gemini-3.5-flash-lite（備援，最快最省，額度通常也最寬）
// 之後想再調整順序或加開別的免費模型當備援，直接改這兩行常數即可（會依序嘗試，任何一個失敗都會自動換下一個）。
const MODEL = "gemini-3.6-flash";
const FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite"];
const GEMINI_MODELS = [MODEL, ...FALLBACK_MODELS];

// ---------------------------------------------------------
// V36 新增：多組 Gemini 金鑰依序輪替
// 如果你有兩個 Google 帳號（兩個獨立的 Google AI Studio 專案），各自申請一把 API 金鑰，
// 額度是「各自獨立計算」的，等於多一份免費額度可以用：
//   1. GEMINI_API_KEY     ← 主要金鑰，三個模型都會先用這把試過一輪
//   2. MI_GEMINI_API_KEY  ← 第二把金鑰（例如另一個 Google 帳號申請的），
//                           上面那把的三個模型全部失敗（額滿／出錯）才會換這把，一樣三個模型依序試過
//   3. Groq（見下方 callGroq）← 兩把 Gemini 金鑰都試過仍失敗，最後才輪到 Groq 當保底
// 只設定 GEMINI_API_KEY、沒設定 MI_GEMINI_API_KEY 也完全沒問題，程式會自動跳過沒設定的金鑰。
// ---------------------------------------------------------
const GEMINI_KEY_ENV_NAMES = ["GEMINI_API_KEY", "MI_GEMINI_API_KEY"];

// ---------------------------------------------------------
// V23 新增：Groq 免費備援（選用，不設定也完全不影響原本功能）
// V36 更新：現在是排在兩把 Gemini 金鑰（GEMINI_API_KEY、MI_GEMINI_API_KEY）都各自試過三個模型、
// 仍然全部失敗之後，才會輪到的「第三層」保底方案；Groq 是完全不同的公司、不同的免費額度計算，
// 等於是另外多一組「備用油箱」，不用付費、不用綁信用卡。
// 申請免費金鑰：https://console.groq.com/keys（註冊帳號→ API Keys → Create API Key）
// 申請好之後，一樣到 Vercel 專案設定 → Environment Variables 加入 GROQ_API_KEY 即可自動啟用；
// 沒有設定這個環境變數時，這段程式會直接跳過，不影響原本 Gemini 的行為。
// 免費額度大約每天 14,400 次請求（依 Groq 官方公告為準，可能調整），
// 用來當「兩把 Gemini 金鑰、全部模型都額滿」時的最後一道備援，品質略遜於 Gemini 但足以應急。
// ---------------------------------------------------------
const GROQ_MODEL = "llama-3.1-8b-instant";
async function callGroq(system, prompt) {
  const key = process.env.GROQ_API_KEY || "";
  if (!key) return null; // 沒設定金鑰就直接跳過，交回給原本的錯誤處理
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: prompt }
        ],
        max_tokens: 1500,
        temperature: 0.9
      })
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error("Groq API 錯誤：", response.status, errBody);
      return null;
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    console.error("Groq 呼叫失敗：", err);
    return null;
  }
}

// ---------------------------------------------------------
// V23 新增：伺服器端簡易回應快取（省下重複問答會消耗的免費額度）
// 很多使用者輸入的組合其實會重複（例如星座＋同一個關注面向、同一個姓名筆畫組合、
// 使用者連續點兩次同一個按鈕等），一模一樣的 system+prompt 不需要每次都重新呼叫 AI，
// 直接把上一次的解讀文字回傳就好，使用者體驗還更快（不用等 AI 生成）。
// 註：這是「同一個執行環境內」的記憶體快取，Vercel Serverless Function 冷啟動時會清空，
// 不是跨全球節點共享的快取，但在流量尖峰、同一批人短時間內問類似問題時仍然很有幫助；
// 之後如果想要更持久、跨執行個體共享的快取，可以改接 Vercel KV 或 Upstash Redis。
// ---------------------------------------------------------
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 快取 4 小時
const CACHE_MAX_ENTRIES = 300; // 超過上限時，把最早放進去的資料丟掉（簡易 FIFO），避免記憶體一直長大
const responseCache = globalThis.__miliResponseCache || (globalThis.__miliResponseCache = new Map());
function getCached(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return hit.text;
}
function setCached(key, text) {
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey !== undefined) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { text, expiresAt: Date.now() + CACHE_TTL_MS });
}

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

  // 先查快取：一模一樣的 system+prompt 之前問過的話，直接回傳，完全不消耗 AI 額度
  const cacheKey = `${system || ""}\u0000${prompt}`;
  const cachedText = getCached(cacheKey);
  if (cachedText) {
    return res.status(200).json({ text: cachedText, cached: true });
  }

  // V36：改成多把金鑰輪替，這裡先不急著檢查，等下面統一判斷「有沒有任何一種金鑰可用」

  // 把「用某把金鑰呼叫某一個 Gemini 模型」包成一個函式，方便待會依序嘗試多把金鑰 × 多個模型
  async function callGeminiModel(model, apiKey) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
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
    // 只留下「有實際設定值」的金鑰，依 GEMINI_KEY_ENV_NAMES 的順序（GEMINI_API_KEY → MI_GEMINI_API_KEY）
    const geminiKeys = GEMINI_KEY_ENV_NAMES
      .map(envName => ({ envName, apiKey: process.env[envName] || "" }))
      .filter(k => k.apiKey);

    let response = null;
    let lastStatus = null;
    let succeeded = false;

    // 外層跑「哪一把金鑰」，內層跑「哪一個模型」：
    // 第一把金鑰的三個模型都試過還是不行，才會換下一把金鑰、一樣三個模型依序再試一輪。
    keyLoop:
    for (let k = 0; k < geminiKeys.length; k++) {
      const { envName, apiKey } = geminiKeys[k];
      for (let i = 0; i < GEMINI_MODELS.length; i++) {
        const model = GEMINI_MODELS[i];
        response = await callGeminiModel(model, apiKey);

        if (response.ok) {
          succeeded = true;
          if (k > 0 || i > 0) {
            console.warn(`已自動改用「${envName}」金鑰 + 模型「${model}」`);
          }
          break keyLoop;
        }

        lastStatus = response.status;
        const errBody = await response.json().catch(() => ({}));
        console.error(`Gemini API 錯誤（金鑰：${envName}，模型：${model}）：`, response.status, errBody);
        // 不管這次是什麼錯誤（額度已滿 429、這把金鑰沒開通該模型 403/404、
        // 模型名稱打錯或已停用 400...）都直接換下一個模型／下一把金鑰繼續嘗試，
        // 就算某個模型在某把金鑰上其實不存在／沒開通，也只是很快失敗、自動跳到下一個，不會卡住。
      }
    }

    if (!succeeded) {
      // 兩把 Gemini 金鑰、每把三個模型全部試過了、都還是失敗 —— 最後再試一次 Groq（如果有設定金鑰的話）
      const groqText = await callGroq(system, prompt);
      if (groqText) {
        setCached(cacheKey, groqText);
        return res.status(200).json({ text: groqText, provider: "groq" });
      }

      // 一把 Gemini 金鑰都沒設定、Groq 也沒設定或也失敗了
      if (geminiKeys.length === 0) {
        console.error("GEMINI_API_KEY / MI_GEMINI_API_KEY 都尚未設定，且 Groq 也無法使用");
        return res.status(500).json({ error: "伺服器尚未設定金鑰，請聯絡網站管理員" });
      }
      if (lastStatus === 429) {
        return res
          .status(429)
          .json({ error: "目前 AI 解讀請求太多（已達免費額度上限），請稍等一下再試一次。" });
      }
      return res.status(502).json({ error: "AI 服務暫時無法回應，請稍後再試" });
    }

    const data = await response.json();

    // 注意：這裡（以及下面兩處）回傳的 text 會直接被前端當成「解讀內容」顯示出來，
    // 所以措辭要順著命理網站的調性走，不要出現「AI」「生成」「伺服器」這類技術字眼，
    // 讓使用者覺得是卦象／天機暫時不明朗，而不是網站故障。
    // 至於上面 res.status(...).json({ error: ... }) 那些技術性錯誤訊息不受影響，
    // 那些是給開發者看 log／debug 用的，前端 askClaude() 也不會把它們直接顯示給使用者。

    // Gemini 有時會因為安全過濾器擋下回應，這裡順便處理一下，訊息比較好懂
    const candidate = data?.candidates?.[0];
    if (!candidate) {
      console.error("Gemini 回應沒有 candidates：", JSON.stringify(data));
      return res.status(200).json({ text: "天機此刻運行受阻，暫時無法為您解讀，請稍後再試一次。" });
    }
    if (candidate.finishReason === "SAFETY") {
      return res.status(200).json({ text: "這個提問暫時無法窺得卦象，請換個方式再問一次看看。" });
    }

    const text = (candidate.content?.parts || [])
      .map(part => part.text || "")
      .join("\n")
      .trim();

    const finalText = text || "天機此刻運行受阻，暫時無法為您解讀，請稍後再試一次。";
    if (text) setCached(cacheKey, finalText); // 只快取「有實際內容」的回應，避免把空白或錯誤訊息也快取住
    res.status(200).json({ text: finalText });
  } catch (err) {
    console.error("伺服器錯誤：", err);
    res.status(500).json({ error: "伺服器發生錯誤，請稍後再試" });
  }
}
