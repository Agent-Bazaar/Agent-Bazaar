import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const WALLET_DIR = path.join(os.homedir(), ".agentbazaar");
const WALLET_PATH = path.join(WALLET_DIR, "wallet.json");

interface WalletFile {
  publicKey: string;
  secretKey: number[];
  createdAt: string;
}

export function getWalletPath(): string {
  return WALLET_PATH;
}

export function walletExists(): boolean {
  if (process.env.SOLANA_PRIVATE_KEY) return true;
  return fs.existsSync(WALLET_PATH);
}

export function loadWallet(): Keypair {
  // Environment variable takes priority
  const envKey = process.env.SOLANA_PRIVATE_KEY;
  if (envKey) {
    return parsePrivateKey(envKey);
  }

  if (!fs.existsSync(WALLET_PATH)) {
    throw new Error("No wallet found. Use setup_wallet to create one.");
  }

  const raw: WalletFile = JSON.parse(fs.readFileSync(WALLET_PATH, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw.secretKey));
}

export function createWallet(): { keypair: Keypair; privateKeyBase58: string; isNew: boolean } {
  if (fs.existsSync(WALLET_PATH)) {
    const existing = loadWallet();
    return {
      keypair: existing,
      privateKeyBase58: bs58.encode(existing.secretKey),
      isNew: false,
    };
  }

  const keypair = Keypair.generate();

  // Create directory with restricted permissions
  if (!fs.existsSync(WALLET_DIR)) {
    fs.mkdirSync(WALLET_DIR, { recursive: true, mode: 0o700 });
  }

  const walletData: WalletFile = {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: Array.from(keypair.secretKey),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(WALLET_PATH, JSON.stringify(walletData, null, 2), { mode: 0o600 });

  return {
    keypair,
    privateKeyBase58: bs58.encode(keypair.secretKey),
    isNew: true,
  };
}

export function importWallet(privateKey: string): Keypair {
  const keypair = parsePrivateKey(privateKey);

  if (!fs.existsSync(WALLET_DIR)) {
    fs.mkdirSync(WALLET_DIR, { recursive: true, mode: 0o700 });
  }

  const walletData: WalletFile = {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: Array.from(keypair.secretKey),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(WALLET_PATH, JSON.stringify(walletData, null, 2), { mode: 0o600 });

  return keypair;
}

export function exportWallet(): { publicKey: string; privateKeyBase58: string } {
  const keypair = loadWallet();
  return {
    publicKey: keypair.publicKey.toBase58(),
    privateKeyBase58: bs58.encode(keypair.secretKey),
  };
}

export function signMessage(keypair: Keypair, action: string): { address: string; signature: string; message: string } {
  const timestamp = Date.now();
  const message = `agentbazaar:${action}:${timestamp}`;
  const messageBytes = new TextEncoder().encode(message);
  const sig = nacl.sign.detached(messageBytes, keypair.secretKey);

  return {
    address: keypair.publicKey.toBase58(),
    signature: Buffer.from(sig).toString("base64"),
    message,
  };
}

function parsePrivateKey(input: string): Keypair {
  const trimmed = input.trim();

  // Try JSON array format: [1,2,3,...]
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }

  // Try base58
  const decoded = bs58.decode(trimmed);
  return Keypair.fromSecretKey(decoded);
}
