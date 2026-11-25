# Glued App (app.getglued.co)

Internal Glued web app. Next.js on Vercel, Google sign-in via Auth.js.

## Who can sign in
Two locks:
1. Google Auth Platform is set to **Internal**, so only getglued.co Google accounts can attempt sign-in.
2. `ALLOWED_EMAILS` (Vercel env var) lists the exact people allowed. Everyone else gets "no access".

To add or remove someone: edit `ALLOWED_EMAILS` in Vercel → Settings → Environment Variables, then redeploy.

## Environment variables
See `.env.example`. Real values live in Vercel.

## Local dev
```
cp .env.example .env.local   # fill in values
npm install
npm run dev
```
