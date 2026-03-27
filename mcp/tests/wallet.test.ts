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
const { walletExists, loadWallet, createWallet, importWallet, exportWallet, signMessage, getWalletPath } =
  await import("../src/wallet.js");

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SOLANA_PRIVATE_KEY;
});

afterEach(() => {
  delete process.env.SOLANA_PRIVATE_KEY;
});

describe("getWalletPath", () => {
  it("returns path under ~/.agentbazaar", () => {
    const p = getWalletPath();
    expect(p).toContain(".agentbazaar");
    expect(p).toContain("wallet.json");
  });
});

describe("walletExists", () => {
  it("returns true when SOLANA_PRIVATE_KEY is set", () => {
    process.env.SOLANA_PRIVATE_KEY = "fake";
    expect(walletExists()).toBe(true);
  });

  it("returns true when wallet file exists", () => {
    mockFs.existsSync.mockReturnValue(true);
    expect(walletExists()).toBe(true);
  });

  it("returns false when no env var and no file", () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(walletExists()).toBe(false);
  });
});

describe("loadWallet", () => {
  it("loads from SOLANA_PRIVATE_KEY env var (JSON array)", () => {
    const kp = Keypair.generate();
    process.env.SOLANA_PRIVATE_KEY = JSON.stringify(Array.from(kp.secretKey));

    const loaded = loadWallet();
    expect(loaded.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it("loads from wallet file", () => {
    const kp = Keypair.generate();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        publicKey: kp.publicKey.toBase58(),
        secretKey: Array.from(kp.secretKey),
        createdAt: new Date().toISOString(),
      }),
    );

    const loaded = loadWallet();
    expect(loaded.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it("throws when no wallet found", () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(() => loadWallet()).toThrow("No wallet found");
  });

  it("env var takes priority over file", () => {
    const envKp = Keypair.generate();
    const fileKp = Keypair.generate();

    process.env.SOLANA_PRIVATE_KEY = JSON.stringify(Array.from(envKp.secretKey));
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        publicKey: fileKp.publicKey.toBase58(),
        secretKey: Array.from(fileKp.secretKey),
        createdAt: new Date().toISOString(),
      }),
    );

    const loaded = loadWallet();
    expect(loaded.publicKey.toBase58()).toBe(envKp.publicKey.toBase58());
  });
});

describe("createWallet", () => {
  it("returns existing wallet if file already exists", () => {
    const kp = Keypair.generate();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        publicKey: kp.publicKey.toBase58(),
        secretKey: Array.from(kp.secretKey),
        createdAt: new Date().toISOString(),
      }),
    );

    const result = createWallet();
    expect(result.isNew).toBe(false);
    expect(result.keypair.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("generates new wallet when none exists", () => {
    mockFs.existsSync.mockReturnValue(false);

    const result = createWallet();
    expect(result.isNew).toBe(true);
    expect(result.keypair).toBeDefined();
    expect(result.privateKeyBase58).toBeTruthy();

    // Check directory was created with 0o700
    expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining(".agentbazaar"), {
      recursive: true,
      mode: 0o700,
    });

    // Check file was written with 0o600
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("wallet.json"), expect.any(String), {
      mode: 0o600,
    });

    // Verify stored data structure
    const writtenData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
    expect(writtenData.publicKey).toBe(result.keypair.publicKey.toBase58());
    expect(writtenData.secretKey).toHaveLength(64);
    expect(writtenData.createdAt).toBeTruthy();
  });
});

describe("importWallet", () => {
  it("imports from JSON array private key", () => {
    const kp = Keypair.generate();
    mockFs.existsSync.mockReturnValue(false);

    const imported = importWallet(JSON.stringify(Array.from(kp.secretKey)));
    expect(imported.publicKey.toBase58()).toBe(kp.publicKey.toBase58());

    // Verify file was written
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining("wallet.json"), expect.any(String), {
      mode: 0o600,
    });
  });

  it("creates directory if it doesn't exist", () => {
    const kp = Keypair.generate();
    mockFs.existsSync.mockReturnValue(false);

    importWallet(JSON.stringify(Array.from(kp.secretKey)));

    expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining(".agentbazaar"), {
      recursive: true,
      mode: 0o700,
    });
  });
});

describe("exportWallet", () => {
  it("returns public and private key", () => {
    const kp = Keypair.generate();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        publicKey: kp.publicKey.toBase58(),
        secretKey: Array.from(kp.secretKey),
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
