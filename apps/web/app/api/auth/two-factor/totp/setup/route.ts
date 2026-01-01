import { defaultResponderForAppDir } from "app/api/defaultResponderForAppDir";
import { parseRequestData } from "app/api/parseRequestData";
import crypto from "node:crypto";
import process from "node:process";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authenticator } from "otplib";
import qrcode from "qrcode";

import { ErrorCode } from "@calcom/features/auth/lib/ErrorCode";
import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { verifyPassword } from "@calcom/features/auth/lib/verifyPassword";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { symmetricEncrypt } from "@calcom/lib/crypto";
import prisma from "@calcom/prisma";
import { IdentityProvider } from "@calcom/prisma/enums";

import { buildLegacyRequest } from "@lib/buildLegacyCtx";

async function postHandler(req: NextRequest) {
  console.log("[2FA Setup] Starting 2FA setup handler");

  try {
    const body = await parseRequestData(req);
    console.log("[2FA Setup] Body parsed successfully");

    const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
    const sessionStatus = session ? "exists" : "null";
    console.log("[2FA Setup] Session retrieved:", sessionStatus);

    if (!session) {
      console.log("[2FA Setup] No session found");
      return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
    }

    if (!session.user?.id) {
      console.error("[2FA Setup] Session is missing a user id.");
      return NextResponse.json({ error: ErrorCode.InternalServerError }, { status: 500 });
    }
    console.log("[2FA Setup] User ID:", session.user.id);

    await checkRateLimitAndThrowError({
      rateLimitingType: "core",
      identifier: `api:totp-setup:${session.user.id}`,
    });
    console.log("[2FA Setup] Rate limit check passed");

    const user = await prisma.user.findUnique({ where: { id: session.user.id }, include: { password: true } });
    const userStatus = user ? "yes" : "no";
    console.log("[2FA Setup] User found:", userStatus);

    if (!user) {
      console.error("[2FA Setup] Session references user that no longer exists.");
      return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
    }

    console.log("[2FA Setup] Identity provider:", user.identityProvider);
    console.log("[2FA Setup] Has password hash:", !!user.password?.hash);

    if (user.identityProvider !== IdentityProvider.CAL && !user.password?.hash) {
      console.log("[2FA Setup] ThirdPartyIdentityProviderEnabled error");
      return NextResponse.json({ error: ErrorCode.ThirdPartyIdentityProviderEnabled }, { status: 400 });
    }

    if (!user.password?.hash) {
      console.log("[2FA Setup] UserMissingPassword error");
      return NextResponse.json({ error: ErrorCode.UserMissingPassword }, { status: 400 });
    }

    if (user.twoFactorEnabled) {
      console.log("[2FA Setup] TwoFactorAlreadyEnabled error");
      return NextResponse.json({ error: ErrorCode.TwoFactorAlreadyEnabled }, { status: 400 });
    }

    const encryptionKey = process.env.CALENDSO_ENCRYPTION_KEY;
    console.log("[2FA Setup] Encryption key exists:", !!encryptionKey);
    console.log("[2FA Setup] Encryption key length:", encryptionKey?.length);

    if (!encryptionKey) {
      console.error("[2FA Setup] Missing encryption key; cannot proceed with two factor setup.");
      return NextResponse.json({ error: ErrorCode.InternalServerError }, { status: 500 });
    }

    console.log("[2FA Setup] Verifying password...");
    const isCorrectPassword = await verifyPassword(body.password, user.password.hash);
    console.log("[2FA Setup] Password correct:", isCorrectPassword);

    if (!isCorrectPassword) {
      return NextResponse.json({ error: ErrorCode.IncorrectPassword }, { status: 400 });
    }

    // This generates a secret 32 characters in length. Do not modify the number of
    // bytes without updating the sanity checks in the enable and login endpoints.
    console.log("[2FA Setup] Generating secret...");
    const secret = authenticator.generateSecret(20);
    console.log("[2FA Setup] Secret generated, length:", secret.length);

    // Generate backup codes with 10 character length
    console.log("[2FA Setup] Generating backup codes...");
    const backupCodes = Array.from(Array(10), () => crypto.randomBytes(5).toString("hex"));
    console.log("[2FA Setup] Backup codes generated");

    console.log("[2FA Setup] Encrypting and saving to database...");
    try {
      const encryptedBackupCodes = symmetricEncrypt(JSON.stringify(backupCodes), encryptionKey);
      console.log("[2FA Setup] Backup codes encrypted successfully");

      const encryptedSecret = symmetricEncrypt(secret, encryptionKey);
      console.log("[2FA Setup] Secret encrypted successfully");

      await prisma.user.update({
        where: {
          id: session.user.id,
        },
        data: {
          backupCodes: encryptedBackupCodes,
          twoFactorEnabled: false,
          twoFactorSecret: encryptedSecret,
        },
      });
      console.log("[2FA Setup] Database updated successfully");
    } catch (encryptError) {
      console.error("[2FA Setup] Encryption or DB update failed:", encryptError);
      throw encryptError;
    }

    const name = user.email || user.username || user.id.toString();
    const keyUri = authenticator.keyuri(name, "Cal", secret);
    console.log("[2FA Setup] Key URI generated");

    const dataUri = await qrcode.toDataURL(keyUri);
    console.log("[2FA Setup] QR code generated");

    console.log("[2FA Setup] Success! Returning response");
    return NextResponse.json({ secret, keyUri, dataUri, backupCodes });
  } catch (error) {
    console.error("[2FA Setup] Unhandled error:", error);
    const errorStack = error instanceof Error ? error.stack : "No stack";
    console.error("[2FA Setup] Error stack:", errorStack);
    throw error;
  }
}

export const POST = defaultResponderForAppDir(postHandler);
