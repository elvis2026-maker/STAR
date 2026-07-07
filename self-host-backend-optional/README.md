# 自架後端（Express）—— 只有在你「不」用 Vercel 時才需要這個資料夾

如果你已經照 `mingli-website/README.md` 用 Vercel 部署了，**這整個資料夾可以忽略、不用理它**。

這裡是給你們公司如果想用自己的主機/VPS 架後端時的替代方案。

## 用法
```bash
cd self-host-backend-optional
npm install
cp .env.example .env        # 打開 .env，把金鑰換成你真正的 GEMINI_API_KEY
npm start                    # 啟動後端，預設監聽 http://localhost:3000
```

啟動後，瀏覽器打開 `http://localhost:3000/health`，看到 `{"ok":true}` 表示正常。

## 要搭配前端使用
把 `mingli-website/index.html` 裡 `askClaude()` 函式中的
```js
const BACKEND_URL = "/api/interpret";
```
改成你這台後端的網址，例如：
```js
const BACKEND_URL = "https://api.你的網域.com/api/interpret";
```

## 安全性提醒
`server.js` 裡的 `cors()` 目前是全部開放，方便測試。正式上線前，建議改成只允許你自己的網站網域呼叫，避免其他網站盜用你的後端資源。

## 金鑰申請
https://aistudio.google.com/apikey
