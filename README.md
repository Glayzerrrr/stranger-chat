# StrangerChat

Anonymous 1-on-1 text chat with random strangers — built with **Next.js 14**, **Supabase**, and **Tailwind CSS**. Deployable on **Vercel** for free.

## Features

- 🔐 **Google OAuth login** — kills bots, enables account-level bans
- ⚡ **Instant matchmaking** — race-condition-safe Postgres function with `FOR UPDATE SKIP LOCKED`
- 💬 **Real-time chat** — Supabase Broadcast (WebSocket), zero messages stored on the server
- 🚩 **Report system** — chat log frozen & saved on report, auto-ban after 5 reports
- 🔒 **Privacy first** — identities never revealed; chat history deleted when session ends
- 🛡️ **Word filter** — strips URLs and common spam patterns on the client side

---

## Setup

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com) → **New Project**.

### 2. Enable Google OAuth

1. In your Supabase dashboard: **Authentication → Providers → Google**
2. Toggle it **on**
3. Get your OAuth client ID & secret from [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
   - Create an OAuth 2.0 Client ID (Web application)
   - Authorized redirect URI: `https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback`
4. Paste the Client ID and Secret into Supabase

### 3. Run the database migration

Go to **SQL Editor** in your Supabase dashboard and run the contents of:

```
supabase/migrations/001_initial_schema.sql
```

This creates:
- `profiles` table (auto-populated on signup)
- `queue` table (matchmaking, with Realtime enabled)
- `reports` table
- `find_match()` RPC (atomic matchmaking)
- `submit_report()` RPC (report + auto-ban)

### 4. Configure environment variables

```bash
cp .env.local.example .env.local
```

Fill in your Supabase project URL and anon key (found in **Settings → API**).

### 5. Install & run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploy to Vercel

1. Push to GitHub
2. Import the repo on [vercel.com](https://vercel.com)
3. Add environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
4. Deploy 🚀

> **Important:** In Supabase → Authentication → URL Configuration, add your Vercel deployment URL to the **Redirect URLs** list (e.g., `https://your-app.vercel.app/auth/callback`).

---

## Architecture

```
Browser                          Supabase
  │                                 │
  ├─── POST /rpc/find_match ───────►│  Postgres function (atomic)
  │◄── room_id + partner_id ────────│
  │                                 │
  │  (or subscribe to queue row     │
  │   via Realtime if no match)     │
  │                                 │
  ├─── Join Broadcast channel ─────►│  room:{room_id}
  │◄── Messages / typing / disc ────│
  │                                 │
  ├─── POST /rpc/submit_report ────►│  Stores chat log, bumps count
  │                                 │
```

- **Matchmaking**: Serverless-safe via a Postgres function with row-level locking.
- **Chat**: Supabase Realtime Broadcast — messages are relayed in-memory on Supabase's edge, never written to the database.
- **Reports**: Only persisted when a user explicitly reports. Chat logs are otherwise ephemeral (React state only).

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Landing page (login)
│   ├── globals.css             # Tailwind + custom animations
│   ├── chat/
│   │   └── page.tsx            # Chat page (protected)
│   └── auth/
│       └── callback/
│           └── route.ts        # OAuth callback handler
├── components/
│   ├── ChatWindow.tsx          # Core chat engine (client component)
│   └── LoginButton.tsx         # Google sign-in button
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser Supabase client
│   │   └── server.ts           # Server Supabase client
│   ├── wordFilter.ts           # Spam / URL filter
│   └── types.ts                # Shared TypeScript types
└── middleware.ts               # Auth guard for /chat
```

---

## License

MIT — do whatever you want with it.
