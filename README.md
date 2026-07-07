# 玄象所 命理整合網站

一個整合星座、塔羅、八字、姓名學、紫微斗數的命理原型網站，前端輸入資料後會呼叫 AI 生成個人化解讀。

## 這個資料夾要部署到 GitHub + Vercel（推薦方式）

```
mingli-website/
├── index.html          ← 前端網頁（星座/塔羅/八字/姓名學/紫微斗數）
├── api/
│   └── interpret.js    ← Vercel 無伺服器函式，負責安全呼叫 Google Gemini API（金鑰放這裡，不會外流）
├── .gitignore           ← 防止金鑰被誤傳到 GitHub
├── .env.example         ← 環境變數範例（本機測試用，正式金鑰不要放這裡）
└── README.md            ← 就是你現在看的這份
```

如果你不想用 Vercel、想自己架後端伺服器，另外還有一個 `self-host-backend-optional/` 資料夾（跟這個資料夾平行放在一起），裡面有 Express 版本的後端，一樣已改用 Gemini API，用法寫在該資料夾自己的 README 裡。**兩者擇一即可，不要同時用。**

---

## AI 解讀用的是哪個服務？（V2 更新）
V2 開始改用 **Google Gemini API**（`gemini-2.5-flash` 模型），原因是它有免費額度、不用綁信用卡，適合這種小流量的原型網站。

- 免費額度大約每分鐘 10-15 次請求、每天數百到 1500 次不等（Google 會不定期調整，正式上線前建議到 Google AI Studio 確認當下實際額度）
- 免費額度的輸入內容 Google 可能會用於改善模型，如果之後有隱私顧慮，可以在 Google Cloud 專案開啟計費來關閉這項條款
- 如果流量常常撞到限額，把 `api/interpret.js` 裡的 `MODEL` 常數改成 `"gemini-2.5-flash-lite"` 即可拿到更高的免費額度（品質略陽春）
- 金鑰申請：https://aistudio.google.com/apikey


## 版本紀錄
- **V3（目前版本）**：修正 AI 解讀後端呼叫 Gemini API 的金鑰傳遞方式——改用官方建議的 `x-goog-api-key` Header（原本是網址參數 `?key=`），解決新版 `AQ.` 開頭金鑰可能出現的 400「API key not valid」錯誤；新增 `package.json` 解決部署時的 ESM 轉換警告訊息。
- V2：① 配色調整——頭尾（header／hero／footer）維持深色星空風格，中間的輸入／解讀面板改為宣紙淺色系，長時間閱讀更不傷眼，同時保留玄機氛圍。② AI 解讀後端改用 Google Gemini API（原本是 Anthropic），改用免費額度、不用綁信用卡，細節見下方「AI 解讀用的是哪個服務」。
- V1：全站深色星空風格 + Anthropic API（初版）。

## 目前已完成的功能
- ⭐ 星座：輸入生日自動判斷星座 + AI 生成運勢
- 🔮 塔羅：抽「過去／現在／未來」三張牌 + AI 綜合解讀
- 🗓 八字：輸入生日時間，排出簡化版四柱干支 + AI 解讀
- ✍️ 姓名學：輸入姓名，計算天格/人格/地格/外格/總格五格數理 + AI 解讀
- ✨ 紫微斗數：輸入農曆月份與時辰，估算命宮落點 + AI 解讀
- 手機版排版、金屬質感銘牌、動態星空背景、日期版次自動產生

## 已知限制（之後可以再優化）
- 八字：以國曆月份近似節氣月、日柱以公式估算，未逐一核對萬年曆
- 紫微斗數：只估算命宮位置，尚未排出十四主星完整命盤
- 姓名學：筆畫字典只收錄常見字，生僻字會跳出手動輸入欄位讓使用者自己修正
- 目前沒有 SVG 插圖與圖表視覺化（塔羅卡牌美術、命盤圖表等），這塊之後可以再加強

---

## 部署到 GitHub + Vercel 的完整步驟

### 1. 建立 GitHub Repository
到 https://github.com/new 建立一個新的 repository（可以設為 Private，只有你自己看得到程式碼）。

### 2. 把這個資料夾推上 GitHub

**電腦操作（推薦，最快）：**
```bash
cd mingli-website
git init
git add .
git commit -m "初版命理網站"
git branch -M main
git remote add origin https://github.com/你的帳號/你的repo名稱.git
git push -u origin main
```
> 不熟指令的話，下載「GitHub Desktop」（https://desktop.github.com/），用拖拉介面把整個資料夾發布上去，效果一樣。

**只有手機的話：**
1. 用手機瀏覽器（不是 GitHub App）打開你的 repo 網頁
2. `index.html`：點 **Add file → Upload files**，從手機裡選這個檔案上傳
3. `api/interpret.js`：手機沒辦法直接上傳整個資料夾，改用 **Add file → Create new file**，檔名欄位直接打 `api/interpret.js`（帶斜線），GitHub 會自動建立 `api` 資料夾，再把檔案內容複製貼上存檔
4. `.gitignore`、`.env.example`：同樣用 Create new file 建立，貼上內容即可

**重要：`.env` 檔案已經被 `.gitignore` 排除，金鑰不會被上傳，這是故意的、也是必須的——金鑰只能存在 Vercel 的環境變數設定裡，絕對不要把金鑰貼進程式碼或上傳到 GitHub。**

### 3. 連接 Vercel
1. 到 https://vercel.com 用 GitHub 帳號登入
2. 點「Add New Project」→ 選擇你剛剛推上去的 repository
3. Framework Preset 選 "Other"（純 HTML，不是 React/Next.js）
4. 展開 "Environment Variables"，新增一筆：
   - Key: `GEMINI_API_KEY`
   - Value: 你的金鑰（AIza開頭那一串，申請網址在最下面）
5. 點 Deploy

幾十秒後 Vercel 會給你一個網址，例如 `https://mingli-website.vercel.app`，打開就能直接用，AI 解讀功能也會正常運作（因為 `/api/interpret` 跟前端在同一個網域下，不用另外設定網址）。

### 4. 之後要更新網站怎麼做？
以後只要修改檔案、`git push` 上去（或用手機重新上傳/編輯該檔案），Vercel 會自動偵測並重新部署，不用手動操作。

### 5. 想換成自己的網域？
Vercel 專案設定裡有「Domains」，把你的網域（例如 mingli.elvis-mis.com）填進去，照指示到你網域註冊商那邊加一筆 DNS 紀錄即可，Vercel 會自動處理 HTTPS 憑證。

---

## 疑難排解

**部署後點按鈕沒反應/一直顯示「生成中」？**
- 打開瀏覽器開發者工具（電腦版）看 Console 有沒有錯誤訊息
- 確認 Vercel 專案的 Environment Variables 裡有正確設定 `GEMINI_API_KEY`
- 確認金鑰本身有效、免費額度沒有當下被撞滿（到 https://aistudio.google.com 檢查，或看 Vercel 的 Function Logs 有沒有錯誤訊息）

**手機瀏覽器打開網址列顯示 content://download 而不是網址？**
- 這代表你打開的是「下載到手機的本機檔案」，不是真正上線的網站。等部署到 Vercel 後，要用 Vercel 給你的網址（https://xxx.vercel.app）打開才是正式運作的版本，本機檔案沒辦法呼叫後端 API。

## 金鑰申請
https://aistudio.google.com/apikey

