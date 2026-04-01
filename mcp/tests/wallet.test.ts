import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

// Mock fs before importing wallet module
const mockFs = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
};

vi.mock("fs", () => mockFs);

// Import after mocks are set up
const { walletExists, loadWallet, createWallet, exportWallet, signMessage, getWalletPath } =
  await import("../src/wallet.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getWalletPath", () => {
  it("returns OWS vault path", () => {
    const p = getWalletPath();
    expect(p).toContain(".ows");
  });
});

describe("walletExists", () => {
  it("returns true when OWS state file exists", () => {
    const kp = Keypair.generate();
    mockFs.existsSync.mockImplementation((path: string) => {
      if (path.includes("ows-state.json")) return true;
      return false;
    });
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        walletName: "test-wallet",
        solanaAddress: kp.publicKey.toBase58(),
        publicKeyBase58: kp.publicKey.toBase58(),
        secretKeyArray: Array.from(kp.secretKey),
        createdAt: new Date().toISOString(),
      }),
    );
    expect(walletExists()).toBe(true);
  });

  it("returns true when legacy wallet file exists", () => {
    mockFs.existsSync.mockImplementation((path: string) => {
      if (path.includes("wallet.json")) return true;
      return false;
    });
    expect(walletExists()).toBe(true);
  });

  it("returns false when no state and no legacy file", () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(walletExists()).toBe(false);
  });
});

describe("loadWallet", () => {
  it("loads from OWS state file", () => {
    const kp = Keypair.generate();
    mockFs.existsSync.mockImplementation((path: string) => {
      if (path.includes("ows-state.json")) return true;
      return false;
    });
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        walletName: "test-wallet",
        solanaAddress: kp.publicKey.toBase58(),
        publicKeyBase58: kp.publicKey.toBase58(),
        secretKeyArray: Array.from(kp.secretKey),
        createdAt: new Date().toISOString(),
      }),
    );

    const loaded = loadWallet();
    expect(loaded.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it("loads from legacy wallet file", () => {
    const kp = Keypair.generate();
    mockFs.existsSync.mockImplementation((path: string) => {
      if (path.includes("ows-state.json")) return false;
      if (path.includes("wallet.json")) return true;
      return false;
    });
    mockFs.readFileSync.mockImplementation((path: string) => {
      if (typeof path === "string" && path.includes("wallet.json")) {
        return JSON.stringify({
          publicKey: kp.publicKey.toBase58(),
          secretKey: Array.from(kp.secretKey),
          createdAt: new Date().toISOString(),
        });
      }
      throw new Error("File not found");
    });

    const loaded = loadWallet();
    expect(loaded.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it("throws when no wallet found", () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => loadWallet()).toThrow("No wallet found");
  });
});

describe("createWallet", () => {
  it("returns existing wallet from OWS state", () => {
    const kp = Keypair.generate();
    mockFs.existsSync.mockImplementation((path: string) => {
      if (path.includes("ows-state.json")) return true;
      return false;
    });
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        walletName: "existing-wallet",
        solanaAddress: kp.publicKey.toBase58(),
        publicKeyBase58: kp.publicKey.toBase58(),
        secretKeyArray: Array.from(kp.secretKey),
        createdAt: new Date().toISOString(),
      }),
    );

    const result = createWallet();
    expect(result.isNew).toBe(false);
    expect(result.keypair.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it("generates new wallet when none exists", () => {
    mockFs.existsSync.mockReturnValue(false);

    const result = createWallet();
    expect(result.isNew).toBe(true);
    expect(result.keypair).toBeDefined();
    expect(result.privateKeyBase58).toBeTruthy();

    // Check state was written
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("ows-state.json"), expect.any(String), {
      mode: 0o600,
    });

    // Verify stored data structure
    const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
    expect(writtenData.publicKeyBase58).toBe(result.keypair.publicKey.toBase58());
    expect(writtenData.secretKeyArray).toHaveLength(64);
    expect(writtenData.createdAt).toBeTruthy();
    expect(writtenData.walletName).toBeTruthy();
  });

  it("creates directory if it doesn't exist", () => {
    mockFs.existsSync.mockReturnValue(false);

    createWallet();

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining(".agentbazaar"), {
      recursive: true,
      mode: 0o700,
    });
  });
});

describe("exportWallet", () => {
  it("returns public and private key", () => {
    const kp = Keypair.generate();
    mockFs.existsSync.mockImplementation((path: string) => {
      if (path.includes("ows-state.json")) return true;
      return false;
    });
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        walletName: "test-wallet",
        solanaAddress: kp.publicKey.toBase58(),
        publicKeyBase58: kp.publicKey.toBase58(),
        secretKeyArray: Array.from(kp.secretKey),
        createdAt: new Date().toISOString(),
      }),
    );

    const result = exportWallet();
    expect(result.publicKey).toBe(kp.publicKey.toBase58());
    expect(result.privateKeyBase58).toBeTruthy();
  });
});

describe("signMessage", () => {
  it("produces valid Ed25519 signature", () => {
    const kp = Keypair.generate();
    const { address, signature, message } = signMessage(kp, "register");

    expect(address).toBe(kp.publicKey.toBase58());
    expect(message).toMatch(/^agentbazaar:register:\d+$/);

    // Verify the signature
    const sigBytes = Buffer.from(signature, "base64");
    const msgBytes = new TextEncoder().encode(message);
    const valid = nacl.sign.detached.verify(msgBytes, sigBytes, kp.publicKey.toBytes());
    expect(valid).toBe(true);
  });

  it("includes timestamp in message", () => {
    const kp = Keypair.generate();
    const before = Date.now();
    const { message } = signMessage(kp, "test-action");
    const after = Date.now();

    const timestamp = Number(message.split(":")[2]);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it("uses action in message", () => {
    const kp = Keypair.generate();
    const { message } = signMessage(kp, "upload");
    expect(message).toContain(":upload:");
  });
});
