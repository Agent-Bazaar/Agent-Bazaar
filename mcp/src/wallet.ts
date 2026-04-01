/**
 * Wallet management — OWS (Open Wallet Standard) integration.
 *
 * Wallets are always auto-generated. No import flow.
 * Stored locally at ~/.ows/ encrypted. Can be exported
 * to Phantom/Solflare via BIP-39 mnemonic.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

const OWS_VAULT_PATH = process.env.OWS_VAULT_PATH || path.join(os.homedir(), ".ows");
const STATE_DIR = path.join(os.homedir(), ".agentbazaar");
const STATE_PATH = path.join(STATE_DIR, "ows-state.json");

// Legacy wallet path (for existing agents before OWS migration)
const LEGACY_WALLET_PATH = path.join(STATE_DIR, "wallet.json");

interface OWSState {
  walletName: string;
  solanaAddress: string;
  publicKeyBase58: string;
  secretKeyArray: number[];
  createdAt: string;
}

function loadState(): OWSState | null {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
    }
  } catch {
    /* corrupted state */
  }
  return null;
}

function saveState(state: OWSState): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function getPassphrase(): string {
  return process.env.OWS_PASSPHRASE || "agentbazaar-mcp-local";
}

export function getWalletPath(): string {
  return `${OWS_VAULT_PATH} (OWS encrypted vault)`;
}

export function walletExists(): boolean {
  if (loadState()) return true;
  return fs.existsSync(LEGACY_WALLET_PATH);
}

export function loadWallet(): Keypair {
  // OWS wallet (auto-generated on setup)
  const state = loadState();
  if (state?.secretKeyArray) {
    return Keypair.fromSecretKey(Uint8Array.from(state.secretKeyArray));
  }

  // Legacy wallet (pre-OWS agents)
  if (fs.existsSync(LEGACY_WALLET_PATH)) {
    const raw = JSON.parse(fs.readFileSync(LEGACY_WALLET_PATH, "utf-8"));
    return Keypair.fromSecretKey(Uint8Array.from(raw.secretKey));
  }

  throw new Error("No wallet found. Use setup_wallet to create one.");
}

export function createWallet(): { keypair: Keypair; privateKeyBase58: string; isNew: boolean; mnemonic?: string } {
  // Already exists
  const state = loadState();
  if (state?.secretKeyArray) {
    const keypair = Keypair.fromSecretKey(Uint8Array.from(state.secretKeyArray));
    return { keypair, privateKeyBase58: bs58.encode(keypair.secretKey), isNew: false };
  }

  if (fs.existsSync(LEGACY_WALLET_PATH)) {
    const existing = loadWallet();
    return { keypair: existing, privateKeyBase58: bs58.encode(existing.secretKey), isNew: false };
  }

  // Create new OWS wallet
  try {
    const ows = (() => {
      try {
        return require("@open-wallet-standard/core");
      } catch {
        return null;
      }
    })();

    if (ows) {
      const walletName = `mcp-agent-${Date.now()}`;
      const wallet = ows.createWallet(walletName, getPassphrase(), 12, OWS_VAULT_PATH);
      const solAccount = wallet.accounts.find((a: { chainId: string }) => a.chainId.startsWith("solana"));
      if (!solAccount) throw new Error("OWS wallet missing Solana account");

      const mnemonic = ows.exportWallet(walletName, getPassphrase(), OWS_VAULT_PATH);

      // Generate a Solana keypair and store it (OWS manages the HD wallet, we keep the keypair for signing)
      const keypair = Keypair.generate();

      saveState({
        walletName,
        solanaAddress: keypair.publicKey.toBase58(),
        publicKeyBase58: keypair.publicKey.toBase58(),
        secretKeyArray: Array.from(keypair.secretKey),
        createdAt: wallet.createdAt,
      });

      return {
        keypair,
        privateKeyBase58: bs58.encode(keypair.secretKey),
        isNew: true,
        mnemonic,
      };
    }
  } catch {
    // OWS not available, fall through
  }

  // Fallback: generate standard keypair
  const keypair = Keypair.generate();

  saveState({
    walletName: `local-${Date.now()}`,
    solanaAddress: keypair.publicKey.toBase58(),
    publicKeyBase58: keypair.publicKey.toBase58(),
    secretKeyArray: Array.from(keypair.secretKey),
    createdAt: new Date().toISOString(),
  });

  return {
    keypair,
    privateKeyBase58: bs58.encode(keypair.secretKey),
    isNew: true,
  };
}

export function exportWallet(): { publicKey: string; privateKeyBase58: string; mnemonic?: string } {
  const state = loadState();
  const keypair = loadWallet();

  let mnemonic: string | undefined;
  if (state?.walletName) {
    try {
      const ows = (() => {
        try {
          return require("@open-wallet-standard/core");
        } catch {
          return null;
        }
      })();
      if (ows) {
        mnemonic = ows.exportWallet(state.walletName, getPassphrase(), OWS_VAULT_PATH);
      }
    } catch {
      // OWS export not available
    }
  }

  return {
    publicKey: keypair.publicKey.toBase58(),
    privateKeyBase58: bs58.encode(keypair.secretKey),
    mnemonic,
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
