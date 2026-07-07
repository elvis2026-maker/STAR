// api/interpret.js
// 如果你想用 Vercel 部署（不用自己管伺服器），把這個檔案放在專案的 /api 資料夾，
// Vercel 會自動把它變成一支 API：https://你的網域/api/interpret
//
// 這支改用 Google Gemini API（有免費額度、不用綁信用卡）。
// 記得到 Vercel 專案設定 → Environment Variables 加入 GEMINI_API_KEY
// 金鑰申請網址：https://aistudio.google.com/apikey
//
// 免費額度模型用 gemini-2.5-flash，如果流量比較大常常撞到限額，
// 可以把下面 MODEL 改成 "gemini-2.5-flash-lite"（免費額度上限更高，但品質略陽春）。
const MODEL = "gemini-2.5-flash";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "只接受 POST 請求" });
  }

  const { system, prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "缺少 prompt 參數" });
  }
  if (prompt.length > 2000 || (system && system.length > 2000)) {
    return res.status(400).json({ error: "輸入內容過長" });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.ELVIS_API_Key
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

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error("Gemini API 錯誤：", response.status, errBody);

      // 免費額度最常見的狀況就是撞到速率限制，給使用者看得懂的訊息
      if (response.status === 429) {
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
