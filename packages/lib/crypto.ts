import crypto from "node:crypto";

const ALGORITHM = "aes256";
const INPUT_ENCODING = "utf8";
const OUTPUT_ENCODING = "hex";
const IV_LENGTH = 16; // AES blocksize

/**
 *
 * @param text Value to be encrypted
 * @param key Key used to encrypt value must be 32 bytes for AES256 encryption algorithm
 *
 * @returns Encrypted value using key
 */
export const symmetricEncrypt = (text: string, key: string): string => {
  console.log("[Crypto] symmetricEncrypt called");
  console.log("[Crypto] Key length (string):", key.length);

  // Decode base64 key to get 32 bytes
  const _key = Buffer.from(key, "base64");
  console.log("[Crypto] Key buffer length:", _key.length);

  if (_key.length !== 32) {
    console.error("[Crypto] ERROR: Key must be 32 bytes for AES256, got:", _key.length);
    throw new Error(`Invalid key length: expected 32 bytes, got ${_key.length}`);
  }

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    console.log("[Crypto] IV generated, length:", iv.length);

    const cipher = crypto.createCipheriv(ALGORITHM, _key, iv);
    console.log("[Crypto] Cipher created");

    let ciphered = cipher.update(text, INPUT_ENCODING, OUTPUT_ENCODING);
    ciphered += cipher.final(OUTPUT_ENCODING);
    const ciphertext = `${iv.toString(OUTPUT_ENCODING)}:${ciphered}`;

    console.log("[Crypto] Encryption successful");
    return ciphertext;
  } catch (error) {
    console.error("[Crypto] Encryption failed:", error);
    throw error;
  }
};

/**
 *
 * @param text Value to decrypt
 * @param key Key used to decrypt value must be 32 bytes for AES256 encryption algorithm
 */
export const symmetricDecrypt = (text: string, key: string): string => {
  console.log("[Crypto] symmetricDecrypt called");
  console.log("[Crypto] Key length (string):", key.length);

  // Decode base64 key to get 32 bytes
  const _key = Buffer.from(key, "base64");
  console.log("[Crypto] Key buffer length:", _key.length);

  if (_key.length !== 32) {
    console.error("[Crypto] ERROR: Key must be 32 bytes for AES256, got:", _key.length);
    throw new Error(`Invalid key length: expected 32 bytes, got ${_key.length}`);
  }

  try {
    const components = text.split(":");
    const iv_from_ciphertext = Buffer.from(components.shift() || "", OUTPUT_ENCODING);
    console.log("[Crypto] IV extracted, length:", iv_from_ciphertext.length);

    const decipher = crypto.createDecipheriv(ALGORITHM, _key, iv_from_ciphertext);
    console.log("[Crypto] Decipher created");

    let deciphered = decipher.update(components.join(":"), OUTPUT_ENCODING, INPUT_ENCODING);
    deciphered += decipher.final(INPUT_ENCODING);

    console.log("[Crypto] Decryption successful");
    return deciphered;
  } catch (error) {
    console.error("[Crypto] Decryption failed:", error);
    throw error;
  }
};
