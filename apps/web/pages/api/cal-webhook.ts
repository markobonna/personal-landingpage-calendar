import * as crypto from "node:crypto";
import process from "node:process";
import type { NextApiRequest, NextApiResponse } from "next";

import { buildIcsString } from "@lib/webhook-email/ics-builder";
import { sendPostmarkEmail } from "@lib/webhook-email/postmark";

type WebhookPayload = {
  triggerEvent?: string;
  event?: string;
  type?: string;
  payload?: BookingPayload;
} & BookingPayload;

type BookingPayload = {
  title?: string;
  startTime?: string;
  endTime?: string;
  attendees?: Array<{ name?: string; email: string }>;
  attendeesList?: Array<{ name?: string; email: string }>;
  organizer?: { name?: string; email: string };
  hostEmail?: string;
  hostName?: string;
  organizerName?: string;
  location?: string;
  meetingUrl?: string;
  videoCallUrl?: string;
  conferenceUrl?: string;
  bookingUid?: string;
  uid?: string;
  bookingId?: string | number;
  description?: string;
  bookingUrl?: string;
  rescheduleUrl?: string;
  cancelUrl?: string;
  iCalSequence?: number;
  iCalUID?: string;
};

type TriggerType = "BOOKING_CREATED" | "BOOKING_RESCHEDULED" | "BOOKING_CANCELLED" | "unknown";

// Disable body parsing to get raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function readRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function formatDateTime(date: Date, timezone: string = "UTC"): string {
  return date.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  });
}

function normalizeTrigger(trigger: string | undefined): TriggerType {
  if (!trigger) return "unknown";
  const t = trigger.toUpperCase().replace(/\s+/g, "_");
  if (t.includes("CREATED") || t === "BOOKING_CREATED") return "BOOKING_CREATED";
  if (t.includes("RESCHEDULED") || t === "BOOKING_RESCHEDULED") return "BOOKING_RESCHEDULED";
  if (t.includes("CANCEL") || t === "BOOKING_CANCELLED") return "BOOKING_CANCELLED";
  return "unknown";
}

function buildLocationHtml(location: string | undefined): string {
  if (!location) return "";
  return `<p style="margin: 8px 0; color: #4b5563;"><strong>Where:</strong> <a href="${location}" style="color: #2563eb;">${location}</a></p>`;
}

function buildCancelLinkHtml(cancelUrl: string | undefined): string {
  if (!cancelUrl) return "";
  return `<p style="margin-top: 24px;"><a href="${cancelUrl}" style="color: #dc2626; font-size: 14px;">Need to cancel?</a></p>`;
}

function buildRescheduleLinkHtml(rescheduleUrl: string | undefined): string {
  if (!rescheduleUrl) return "";
  return `<p style="margin-top: 24px;"><a href="${rescheduleUrl}" style="color: #2563eb;">Book a new time</a></p>`;
}

async function handleBookingCreated(
  payload: BookingPayload,
  startTime: Date,
  endTime: Date,
  attendee: { name?: string; email: string },
  hostEmail: string,
  hostName: string | undefined,
  location: string,
  bookingUid: string,
  sequence: number,
  from: string
): Promise<void> {
  const icsContent = buildIcsString({
    uid: bookingUid,
    title: payload.title || "Meeting",
    description: payload.description,
    start: startTime,
    end: endTime,
    organizer: { name: hostName, email: hostEmail },
    attendee: { name: attendee.name, email: attendee.email },
    location,
    sequence,
    status: "CONFIRMED",
    method: "REQUEST",
  });

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #111827;">Your meeting is confirmed</h2>
      <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 16px 0; color: #111827;">${payload.title || "Meeting"}</h3>
        <p style="margin: 8px 0; color: #4b5563;">
          <strong>When:</strong> ${formatDateTime(startTime)}
        </p>
        ${buildLocationHtml(location)}
        <p style="margin: 8px 0; color: #4b5563;">
          <strong>With:</strong> ${hostName || hostEmail}
        </p>
      </div>
      <p style="color: #6b7280; font-size: 14px;">
        A calendar invite is attached to this email. Add it to your calendar to receive reminders.
      </p>
      ${buildCancelLinkHtml(payload.cancelUrl)}
    </div>
  `;

  await sendPostmarkEmail({
    from,
    to: attendee.email,
    subject: `Confirmed: ${payload.title || "Meeting"}`,
    htmlBody,
    icsContent,
    icsMethod: "REQUEST",
  });

  console.log(`Sent booking confirmation to ${attendee.email} for ${bookingUid}`);
}

async function handleBookingRescheduled(
  payload: BookingPayload,
  startTime: Date,
  endTime: Date,
  attendee: { name?: string; email: string },
  hostEmail: string,
  hostName: string | undefined,
  location: string,
  bookingUid: string,
  sequence: number,
  from: string
): Promise<void> {
  const icsContent = buildIcsString({
    uid: bookingUid,
    title: payload.title || "Meeting",
    description: payload.description,
    start: startTime,
    end: endTime,
    organizer: { name: hostName, email: hostEmail },
    attendee: { name: attendee.name, email: attendee.email },
    location,
    sequence: sequence + 1,
    status: "CONFIRMED",
    method: "REQUEST",
  });

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #111827;">Your meeting has been rescheduled</h2>
      <div style="background: #fef3c7; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 16px 0; color: #111827;">${payload.title || "Meeting"}</h3>
        <p style="margin: 8px 0; color: #4b5563;">
          <strong>New time:</strong> ${formatDateTime(startTime)}
        </p>
        ${buildLocationHtml(location)}
        <p style="margin: 8px 0; color: #4b5563;">
          <strong>With:</strong> ${hostName || hostEmail}
        </p>
      </div>
      <p style="color: #6b7280; font-size: 14px;">
        An updated calendar invite is attached. Please update your calendar.
      </p>
      ${buildCancelLinkHtml(payload.cancelUrl)}
    </div>
  `;

  await sendPostmarkEmail({
    from,
    to: attendee.email,
    subject: `Rescheduled: ${payload.title || "Meeting"}`,
    htmlBody,
    icsContent,
    icsMethod: "REQUEST",
  });

  console.log(`Sent reschedule notification to ${attendee.email} for ${bookingUid}`);
}

async function handleBookingCancelled(
  payload: BookingPayload,
  startTime: Date,
  endTime: Date,
  attendee: { name?: string; email: string },
  hostEmail: string,
  hostName: string | undefined,
  location: string,
  bookingUid: string,
  sequence: number,
  from: string
): Promise<void> {
  const icsContent = buildIcsString({
    uid: bookingUid,
    title: payload.title || "Meeting",
    description: payload.description,
    start: startTime,
    end: endTime,
    organizer: { name: hostName, email: hostEmail },
    attendee: { name: attendee.name, email: attendee.email },
    location,
    sequence: sequence + 1,
    status: "CANCELLED",
    method: "CANCEL",
  });

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #dc2626;">Your meeting has been cancelled</h2>
      <div style="background: #fee2e2; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin: 0 0 16px 0; color: #111827; text-decoration: line-through;">${payload.title || "Meeting"}</h3>
        <p style="margin: 8px 0; color: #4b5563;">
          <strong>Was scheduled for:</strong> ${formatDateTime(startTime)}
        </p>
        <p style="margin: 8px 0; color: #4b5563;">
          <strong>With:</strong> ${hostName || hostEmail}
        </p>
      </div>
      <p style="color: #6b7280; font-size: 14px;">
        A cancellation notice is attached. The event should be automatically removed from your calendar.
      </p>
      ${buildRescheduleLinkHtml(payload.rescheduleUrl)}
    </div>
  `;

  await sendPostmarkEmail({
    from,
    to: attendee.email,
    subject: `Cancelled: ${payload.title || "Meeting"}`,
    htmlBody,
    icsContent,
    icsMethod: "CANCEL",
  });

  console.log(`Sent cancellation notification to ${attendee.email} for ${bookingUid}`);
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const secret = process.env.CAL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("CAL_WEBHOOK_SECRET not configured");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  const rawBody = await readRawBody(req);

  // Verify signature (X-Cal-Signature-256)
  const receivedSig = (req.headers["x-cal-signature-256"] as string) || "";
  const computedSig = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  if (!receivedSig || !timingSafeEqual(receivedSig, computedSig)) {
    console.error("Invalid webhook signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let event: WebhookPayload;
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const trigger = normalizeTrigger(event.triggerEvent || event.event || event.type);

  if (trigger === "unknown") {
    res.status(200).json({ ok: true, ignored: event.triggerEvent || event.event || event.type });
    return;
  }

  const payload = event.payload || event;

  // Extract booking details
  const title = payload.title || "Meeting";
  let startTime: Date | null = null;
  let endTime: Date | null = null;

  if (payload.startTime) {
    startTime = new Date(payload.startTime);
  }
  if (payload.endTime) {
    endTime = new Date(payload.endTime);
  }

  if (!startTime || !endTime) {
    res.status(200).json({ ok: true, skipped: "missing start/end time" });
    return;
  }

  const attendees = payload.attendees || payload.attendeesList || [];
  const attendee = attendees[0];
  if (!attendee?.email) {
    res.status(200).json({ ok: true, skipped: "no attendee email" });
    return;
  }

  const hostEmail = payload.hostEmail || payload.organizer?.email;
  const hostName = payload.organizerName || payload.hostName || payload.organizer?.name;
  if (!hostEmail) {
    res.status(200).json({ ok: true, skipped: "no host email" });
    return;
  }

  const location =
    payload.location || payload.meetingUrl || payload.videoCallUrl || payload.conferenceUrl || "";
  const bookingUid =
    payload.iCalUID || payload.bookingUid || payload.uid || String(payload.bookingId) || crypto.randomUUID();
  const sequence = payload.iCalSequence || 0;

  const from = process.env.POSTMARK_FROM_EMAIL;
  if (!from) {
    console.error("POSTMARK_FROM_EMAIL not configured");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  try {
    if (trigger === "BOOKING_CREATED") {
      await handleBookingCreated(
        payload,
        startTime,
        endTime,
        attendee,
        hostEmail,
        hostName,
        location,
        bookingUid,
        sequence,
        from
      );
    } else if (trigger === "BOOKING_RESCHEDULED") {
      await handleBookingRescheduled(
        payload,
        startTime,
        endTime,
        attendee,
        hostEmail,
        hostName,
        location,
        bookingUid,
        sequence,
        from
      );
    } else if (trigger === "BOOKING_CANCELLED") {
      await handleBookingCancelled(
        payload,
        startTime,
        endTime,
        attendee,
        hostEmail,
        hostName,
        location,
        bookingUid,
        sequence,
        from
      );
    }

    res.status(200).json({ ok: true, trigger });
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).json({ error: "Failed to process webhook" });
  }
}

export default handler;
