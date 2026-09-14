# Giao vi?c TT SPM — Cloudflare Pages + Worker

Tài kho?n thí ?i?m: **qm.rriv@gmail.com** (??ng nh?p Cloudflare b?ng GitHub).

Giao di?n t?nh trên CDN. API Worker ghi th?ng Supabase/Postgres. Hub RRIV v?n ? Render (`https://rriv-erp.onrender.com`).

Khi **ch?a** set `SPM_GV_PAGES_URL` trên Render, app v?n ch?y nhanh trên Render nh? `GET /api/spm-gv/boot`.

## Vi?c c?n làm trên Cloudflare (1 l?n)

1. Vào [dash.cloudflare.com](https://dash.cloudflare.com) b?ng GitHub / `qm.rriv@gmail.com`.
2. Máy dev (PowerShell), trong th? m?c này:

```powershell
cd C:\project\RRIV-ERP\cloudflare\spmgv
npm install
npx wrangler login
```

Trình duy?t s? h?i quy?n tài kho?n v?a t?o. Sau khi login xong:

```powershell
npx wrangler kv namespace create SESSIONS
```

Dán `id` vào `wrangler.toml` (b? comment kh?i `[[kv_namespaces]]`). Có th? b? qua b??c KV: session HMAC v?n ch?y.

3. Secrets — **cùng** `SPM_GV_TICKET_SECRET` v?i Render:

```powershell
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put SPM_GV_TICKET_SECRET
```

`SUPABASE_URL` / `SUPABASE_SERVICE_KEY` l?y t? Supabase (service role, không ??a ra trình duy?t).

4. Deploy:

```powershell
npm run deploy
```

Wrangler in ra URL d?ng `https://rriv-spmgv.<account>.workers.dev` ho?c Pages. Ghi URL ?ó vào Render:

- `SPM_GV_PAGES_URL=https://...`
- `SPM_GV_TICKET_SECRET=` (trùng Worker)

R?i deploy/restart Render. T? hub b?m **Giao vi?c TT SPM** s? m? domain Cloudflare kèm ticket 90 giây. Nút **V? trang ch?** v? hub Render.

Bookmark `/app/spmgv` c?: Render redirect sang Pages.

## Realtime (tu? ch?n)

Ch?y `supabase/patch-spm-gv-v5-realtime.sql` trên Supabase SQL Editor. App ?ã poll 20 giây n?u ch?a b?t Realtime.

## Không deploy Cloudflare ngay?

?? tr?ng `SPM_GV_PAGES_URL`. User v?n dùng app trên Render, m? nhanh h?n tr??c (1 API `/boot`, không sync nhân s? m?i l?n F5).
