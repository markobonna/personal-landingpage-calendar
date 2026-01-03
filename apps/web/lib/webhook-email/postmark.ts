import process from "node:process";
type PostmarkAttachment = {
  Name: string;
  Content: string;
  ContentType: string;
};

type SendEmailParams = {
  from: string;
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  icsContent?: string;
  icsMethod?: "REQUEST" | "CANCEL";
};

type PostmarkResponse = {
  MessageID?: string;
  ErrorCode?: number;
  Message?: string;
};

export async function sendPostmarkEmail(params: SendEmailParams): Promise<PostmarkResponse> {
  const token = process.env.POSTMARK_SERVER_API_TOKEN;
  if (!token) {
    throw new Error("Missing POSTMARK_SERVER_API_TOKEN environment variable");
  }

  const attachments: PostmarkAttachment[] = [];

  if (params.icsContent) {
    const method = params.icsMethod || "REQUEST";
    attachments.push({
      Name: "invite.ics",
      Content: Buffer.from(params.icsContent, "utf8").toString("base64"),
      ContentType: `text/calendar; method=${method}; charset="utf-8"`,
    });
  }

  const message: Record<string, unknown> = {
    From: params.from,
    To: params.to,
    Subject: params.subject,
    HtmlBody: params.htmlBody,
    MessageStream: "outbound",
  };

  if (params.textBody) {
    message.TextBody = params.textBody;
  }

  if (attachments.length > 0) {
    message.Attachments = attachments;
  }

  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(message),
  });

  const data = (await response.json().catch(() => ({}))) as PostmarkResponse;

  if (!response.ok) {
    throw new Error(`Postmark send failed: ${response.status} - ${data.Message || JSON.stringify(data)}`);
  }

  return data;
}
