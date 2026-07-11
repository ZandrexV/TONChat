# Nightline — realtime chat with Supabase + Cloudflare Pages

A chat app with real login, profile pictures, and live messages, built on:
- **Supabase**: Auth, Postgres, Storage (avatars), Realtime
- **Cloudflare Pages**: hosting for the built frontend
- **Vite + React**: frontend

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** → paste the contents of `supabase/schema.sql` → run it.
   - This creates the `profiles` and `messages` tables, RLS policies,
     an `avatars` storage bucket, and enables Realtime on `messages`.
   - If the storage bucket or `alter publication` lines error because they
     already exist, that's fine — everything else still applies.
3. Go to **Authentication > Providers** and make sure **Email** is enabled.
   (Optional: add Google/GitHub OAuth here too.)
4. Go to **Settings > API** and copy your **Project URL** and **anon public key**.

## 2. Run locally

```bash
npm install
cp .env.example .env
# paste your Supabase URL and anon key into .env
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`).

## 3. Deploy to Cloudflare Pages

1. Push this project to a GitHub repo.
2. In the Cloudflare dashboard: **Workers & Pages > Create > Pages > Connect to Git**.
3. Select your repo. Build settings:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Under **Settings > Environment variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy. Cloudflare will give you a `*.pages.dev` URL (you can add a custom domain later).

## How it works

- **Sign up / log in** — handled by Supabase Auth (`src/components/Auth.jsx`).
- **First-time profile setup** — pick a username and upload an avatar, which
  goes to the `avatars` Storage bucket (`src/components/ProfileSetup.jsx`).
- **Chat room** — loads recent messages, then subscribes to Supabase Realtime
  so new messages from anyone appear instantly (`src/components/Chat.jsx`).

## Notes on security

- Row Level Security (RLS) is on for every table, so a user can only edit
  their own profile and messages — even though everyone can read the shared chat.
- The `anon` key is safe to expose in frontend code; RLS is what actually
  protects your data, not keeping the key secret.
