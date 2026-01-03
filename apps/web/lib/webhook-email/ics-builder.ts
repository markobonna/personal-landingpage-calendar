import type { DateArray, EventStatus } from "ics";
import { createEvent } from "ics";

const toDateArray = (date: Date): DateArray => {
  return [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
  ];
};

function buildIcsString(params: WebhookIcsParams): string {
  const partstat = params.status === "CANCELLED" ? "DECLINED" : "ACCEPTED";
  const busyStatus = params.status === "CANCELLED" ? "FREE" : "BUSY";

  const { error, value } = createEvent({
    uid: params.uid,
    sequence: params.sequence ?? 0,
    start: toDateArray(params.start),
    end: toDateArray(params.end),
    startInputType: "utc",
    productId: "calcom/webhook-ics",
    title: params.title,
    description: params.description,
    organizer: {
      name: params.organizer.name || "Organizer",
      email: params.organizer.email,
    },
    attendees: [
      {
        name: params.attendee.name || "Attendee",
        email: params.attendee.email,
        partstat,
        role: "REQ-PARTICIPANT",
        rsvp: true,
      },
    ],
    location: params.location,
    method: params.method,
    status: params.status,
    busyStatus,
  });

  if (error) {
    throw error;
  }

  return value || "";
}

export type WebhookIcsParams = {
  uid: string;
  title: string;
  description?: string;
  start: Date;
  end: Date;
  organizer: { name?: string; email: string };
  attendee: { name?: string; email: string };
  location?: string;
  sequence?: number;
  status: EventStatus;
  method: "REQUEST" | "CANCEL";
};

export { buildIcsString };
