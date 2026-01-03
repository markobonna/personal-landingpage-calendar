# Cal.com self-hosted: Invitee (requester) does not receive emails — webhook + Postmark solution (Vercel)

## 1) The problem (what you’re seeing) and why it happens

### Symptom
When someone books a meeting on your self-hosted Cal.com instance:

- The **host/organizer** gets the calendar event/invite.
- The **invitee/requester** (the person who booked) **does not receive any email** and therefore the meeting **does not appear on their calendar**.

### Why
In newer Cal.com versions, attendee-facing notifications are handled through **Workflows**. On self-hosted installs, **Workflows can be a paid/commercial feature**, so the UI will show “Workflows is a commercial feature” and you cannot use them to send attendee emails/reminders.

So:
- The booking and host calendar event creation can still work (e.g., Google Calendar integration).
- But **attendee emails are never generated** unless you have Workflows **or** you implement your own notification path.

### The fix
Use **Cal.com Webhooks** (free) to capture booking lifecycle events (created/rescheduled/cancelled) and send your own emails via **Postmark** — including a proper **.ics** calendar invite attachment.

Cal.com’s Webhooks docs list the available triggers and how to configure a subscriber URL. citeturn0search0turn0search15  
Cal.com’s Help docs describe how to validate webhook signatures using `X-Cal-Signature-256`. citeturn0search4  
Postmark’s guide explains best practices for sending calendar invites (ICS) using Postmark. citeturn0search2

---

## 2) Where to implement this: repo vs “on the self-hosted instance”
Because your Cal.com self-hosted instance at `calendar.markobonna.com` is deployed from code (Vercel), you implement this **in your repository**, commit, and push to GitHub. Vercel then redeploys your site. 

Even though the webhook receiver endpoint will be reachable at:
- `https://calendar.markobonna.com/api/cal-webhook`

…it still lives in your repo as an API route.

✅ Answer: **Do it in your repository**, deploy via Vercel.

---

## 3) Exact steps (tedious on purpose)

### Step 0 — Prereqs checklist  - completed
- Your self-hosted Cal.com is deployed on Vercel and working - completed
- Postmark is set up and can send host emails already - completed
- You have access to Cal.com UI to add webhooks (Developer settings) - completed
- You can deploy code changes (GitHub → Vercel) - completed

---

## Step 1 — Create the webhook subscription in Cal.com  - completed

1. Log into **your Cal.com instance** (self-hosted). 
2. Go to:  
   **Settings → Developer → Webhooks**  
   Cal.com docs: webhook subscriptions are created in `/settings/developer/webhooks`. citeturn0search0  - completed
3. Click **New Webhook** (or similar).
4. Set:

   - **Subscriber URL**:  
     `https://calendar.markobonna.com/api/cal-webhook`

   - **Enable Webhook**: ON

   - **Event triggers** (choose all you want to support):
     - Booking Created
     - Booking Rescheduled
     - Booking Cancelled  
     These triggers are listed in Cal.com’s webhook docs. citeturn0search0

   - **Secret**: generate a strong secret (you’ll also store it in Vercel).  
     You will use this secret to validate `X-Cal-Signature-256`. citeturn0search4

5. Save the webhook.

---

## Step 2 — Add environment variables in Vercel   - completed

In **Vercel → Project → Settings → Environment Variables** add:

- `CAL_WEBHOOK_SECRET`  
  = the exact secret you entered when creating the webhook

- `POSTMARK_SERVER_API_TOKEN`  
  = your Postmark server token (keep private)

- `POSTMARK_FROM_EMAIL`  
  = verified sender in Postmark (e.g. `Calendar <[email protected]>`)

- `NEXT_PUBLIC_WEBAPP_URL`  
  = `https://calendar.markobonna.com` (you likely already have this)

Deploy/redeploy after setting env vars.

---

## Step 3 — Add the webhook receiver endpoint (Next.js API route)

In your Cal.com repo (the one deployed to Vercel), add a new API route.

> Note: the exact folder depends on whether your Cal.com build uses the **Pages Router** (`pages/api`) or the **App Router** (`app/api`).  
> Cal.com’s repo historically uses Next.js. If you already have API routes, follow the existing pattern.

### Option A: Pages Router
Create:
- `pages/api/cal-webhook.ts`

### Option B: App Router
Create:
- `app/api/cal-webhook/route.ts`

Below are complete examples for both. Pick **one**.

---

## Step 4 — Implement signature verification (required)

Cal.com webhook help docs say to compute an HMAC SHA-256 over the request body using your secret and compare it to the `X-Cal-Signature-256` header. citeturn0search4

This is important because otherwise anyone can hit your endpoint and spam people.

---

## Step 5 — Implement booking-created email to attendee + ICS attachment

### What we send
When we receive `BOOKING_CREATED` (or “Booking Created”), we email the attendee:

- Subject: “Confirmed: <event name>”
- Body: include date/time, location link, etc.
- Attach an `.ics` invite so it lands on their calendar.

Postmark’s calendar invite guide recommends including an attachment (and also inline in some cases) for compatibility. citeturn0search2

---

# 4) Code (copy/paste)

## 4.1 Shared helper: create an ICS (Node)

Install a small ICS library:

```bash
npm i ical-generator
```

Create `lib/ics.ts`:

```ts
import ical, { ICalCalendarMethod } from "ical-generator";

type IcsParams = {
  uid: string;
  title: string;
  description?: string;
  start: Date;
  end: Date;
  organizer: { name?: string; email: string };
  attendee: { name?: string; email: string };
  location?: string; // meeting URL is fine here
  url?: string;      // booking URL (optional)
};

export function buildIcsInvite(p: IcsParams): string {
  const cal = ical({ name: p.title, method: ICalCalendarMethod.REQUEST });

  cal.createEvent({
    id: p.uid,
    start: p.start,
    end: p.end,
    summary: p.title,
    description: p.description,
    location: p.location,
    url: p.url,
    organizer: { name: p.organizer.name, email: p.organizer.email },
    attendees: [
      { name: p.attendee.name, email: p.attendee.email, rsvp: true, role: "REQ-PARTICIPANT" },
    ],
  });

  return cal.toString();
}
```

---

## 4.2 Postmark sender helper

Create `lib/postmark.ts`:

```ts
import fetch from "node-fetch";

type SendEmailParams = {
  from: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  icsContentBase64?: string;
};

export async function sendPostmarkEmail(p: SendEmailParams) {
  const token = process.env.POSTMARK_SERVER_API_TOKEN;
  if (!token) throw new Error("Missing POSTMARK_SERVER_API_TOKEN");

  const message: any = {
    From: p.from,
    To: p.to,
    Subject: p.subject,
    HtmlBody: p.htmlBody,
  };
  if (p.textBody) message.TextBody = p.textBody;

  if (p.icsContentBase64) {
    message.Attachments = [
      {
        Name: "invite.ics",
        Content: p.icsContentBase64,
        // Postmark’s calendar invite guidance emphasizes correct calendar attachment handling. citeturn0search2
        ContentType: 'text/calendar; method=REQUEST; charset="utf-8"',
      },
    ];
  }

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(message),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Postmark send failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}
```

Postmark’s Email API docs describe the `/email` endpoint approach. citeturn0search10turn0search17

---

## 4.3 Webhook handler — Pages Router version

Create: `pages/api/cal-webhook.ts`

```ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { buildIcsInvite } from "../../lib/ics";
import { sendPostmarkEmail } from "../../lib/postmark";

function timingSafeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// IMPORTANT: Next.js will parse JSON by default and you’ll lose the raw body.
// We need the raw body to compute the HMAC exactly.
// Add this config export:
export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const secret = process.env.CAL_WEBHOOK_SECRET;
  if (!secret) return res.status(500).send("Missing CAL_WEBHOOK_SECRET");

  const rawBody = await readRawBody(req);

  // Verify signature per Cal.com guidance (X-Cal-Signature-256). citeturn0search4
  const receivedSig = (req.headers["x-cal-signature-256"] as string) || "";
  const computedSig = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!receivedSig || !timingSafeEqual(receivedSig, computedSig)) {
    return res.status(401).send("Invalid signature");
  }

  const event = JSON.parse(rawBody);
  const trigger = event?.triggerEvent || event?.event || event?.type; // be defensive

  // Only handle booking created for now; add more cases later.
  if (trigger !== "BOOKING_CREATED" && trigger !== "Booking Created") {
    return res.status(200).json({ ok: true, ignored: trigger });
  }

  // Payload shape varies; Cal docs show "payload" wrapper in examples. citeturn0search25
  const payload = event.payload || event;

  const title = payload.title || "Meeting";
  const startTime = new Date(payload.startTime);
  const endTime = new Date(payload.endTime);

  const attendees = payload.attendees || payload.attendeesList || [];
  const attendee = attendees[0];
  if (!attendee?.email) return res.status(200).json({ ok: true, skipped: "no attendee email" });

  const hostEmail = payload.hostEmail || payload.organizer?.email;
  if (!hostEmail) return res.status(200).json({ ok: true, skipped: "no host email" });

  const location =
    payload.location ||
    payload.meetingUrl ||
    payload.videoCallUrl ||
    payload.conferenceUrl ||
    "";

  const bookingUid = payload.bookingUid || payload.uid || payload.bookingId || crypto.randomUUID();

  const ics = buildIcsInvite({
    uid: String(bookingUid),
    title,
    description: payload.description || "",
    start: startTime,
    end: endTime,
    organizer: { email: hostEmail, name: payload.organizerName || payload.hostName },
    attendee: { email: attendee.email, name: attendee.name },
    location,
    url: payload.bookingUrl || payload.rescheduleUrl || "",
  });

  const from = process.env.POSTMARK_FROM_EMAIL;
  if (!from) return res.status(500).send("Missing POSTMARK_FROM_EMAIL");

  const htmlBody = `
    <p>Your meeting is confirmed.</p>
    <p><strong>${title}</strong></p>
    <p>${startTime.toISOString()} → ${endTime.toISOString()}</p>
    ${location ? `<p>Location: <a href="${location}">${location}</a></p>` : ""}
  `;

  await sendPostmarkEmail({
    from,
    to: attendee.email,
    subject: `Confirmed: ${title}`,
    htmlBody,
    icsContentBase64: Buffer.from(ics, "utf8").toString("base64"),
  });

  return res.status(200).json({ ok: true });
}
```

---

## 4.4 Webhook handler — App Router version

Create: `app/api/cal-webhook/route.ts`

```ts
import crypto from "crypto";
import { NextResponse } from "next/server";
import { buildIcsInvite } from "../../../lib/ics";
import { sendPostmarkEmail } from "../../../lib/postmark";

function timingSafeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export async function POST(req: Request) {
  const secret = process.env.CAL_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Missing CAL_WEBHOOK_SECRET" }, { status: 500 });

  const rawBody = await req.text();

  const receivedSig = req.headers.get("X-Cal-Signature-256") || "";
  const computedSig = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!receivedSig || !timingSafeEqual(receivedSig, computedSig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const trigger = event?.triggerEvent || event?.event || event?.type;

  if (trigger !== "BOOKING_CREATED" && trigger !== "Booking Created") {
    return NextResponse.json({ ok: true, ignored: trigger });
  }

  const payload = event.payload || event;

  const title = payload.title || "Meeting";
  const startTime = new Date(payload.startTime);
  const endTime = new Date(payload.endTime);

  const attendees = payload.attendees || [];
  const attendee = attendees[0];
  if (!attendee?.email) return NextResponse.json({ ok: true, skipped: "no attendee email" });

  const hostEmail = payload.hostEmail || payload.organizer?.email;
  if (!hostEmail) return NextResponse.json({ ok: true, skipped: "no host email" });

  const location =
    payload.location ||
    payload.meetingUrl ||
    payload.videoCallUrl ||
    payload.conferenceUrl ||
    "";

  const bookingUid = payload.bookingUid || payload.uid || payload.bookingId || crypto.randomUUID();

  const ics = buildIcsInvite({
    uid: String(bookingUid),
    title,
    description: payload.description || "",
    start: startTime,
    end: endTime,
    organizer: { email: hostEmail, name: payload.organizerName || payload.hostName },
    attendee: { email: attendee.email, name: attendee.name },
    location,
    url: payload.bookingUrl || payload.rescheduleUrl || "",
  });

  const from = process.env.POSTMARK_FROM_EMAIL;
  if (!from) return NextResponse.json({ error: "Missing POSTMARK_FROM_EMAIL" }, { status: 500 });

  const htmlBody = `
    <p>Your meeting is confirmed.</p>
    <p><strong>${title}</strong></p>
    <p>${startTime.toISOString()} → ${endTime.toISOString()}</p>
    ${location ? `<p>Location: <a href="${location}">${location}</a></p>` : ""}
  `;

  await sendPostmarkEmail({
    from,
    to: attendee.email,
    subject: `Confirmed: ${title}`,
    htmlBody,
    icsContentBase64: Buffer.from(ics, "utf8").toString("base64"),
  });

  return NextResponse.json({ ok: true });
}
```

---

## Step 6 — Deploy

1. Commit changes:
   - `lib/ics.ts`
   - `lib/postmark.ts`
   - `pages/api/cal-webhook.ts` **or** `app/api/cal-webhook/route.ts`
   - `package.json` (adds `ical-generator`)
2. Push to GitHub.
3. Vercel will redeploy automatically.

---

## Step 7 — Verify end-to-end

1. Create a test booking.
2. In Cal.com, open the webhook subscription and view delivery logs (or check your endpoint logs in Vercel).
3. In Postmark:
   - Confirm an outbound message to the attendee exists
   - Confirm the email has an `invite.ics` attachment
4. In the attendee’s email:
   - Confirm an “Add to calendar” experience appears
   - Confirm the event shows up in their calendar

---

# 5) Extend to reschedule/cancel (recommended)

Repeat the same pattern for additional triggers:

- `BOOKING_RESCHEDULED` → send updated ICS (same UID, new times)
- `BOOKING_CANCELLED` → send ICS with `METHOD:CANCEL`

You’ll likely want the UID to remain stable per booking so calendar updates match the original event.

The Cal.com webhook docs list available triggers you can subscribe to. citeturn0search0

---

# 6) Security and reliability notes
- **Always verify signatures** (`X-Cal-Signature-256`) before sending emails. citeturn0search4
- Consider rate limiting the endpoint (basic abuse protection).
- Consider storing a “sent state” keyed by booking UID to avoid duplicates if Cal retries delivery.

---

If you want, I can tailor the payload parsing to the exact structure your Cal.com version sends — just paste one sample webhook payload (with emails redacted).
