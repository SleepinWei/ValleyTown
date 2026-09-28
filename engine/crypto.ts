import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
export const randomUUID = () => globalThis.crypto.randomUUID();
export const hash = (text: string) => bytesToHex(sha256(new TextEncoder().encode(text)));
