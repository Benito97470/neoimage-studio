"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";

type Provider = "openai" | "google";
type AspectRatio = "1:1" | "4:3" | "3:2" | "16:9" | "21:9" | "9:16" | "3:4" | "2:3" | "4:5" | "5:4";
type Resolution = "1K" | "2K" | "4K";
type Quality = "low" | "medium" | "high";

type ModelOption = {
  id: string;
  name: string;
  note: string;
  tier: string;
};

type View = "create" | "history";

type AccountProfile = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

type AccountState =
  | { status: "loading" }
  | { status: "signedOut"; authMode: "local" | "social"; signInUrl: string }
  | { status: "needsProfile"; identity: { email: string; displayName: string }; signOutUrl: string }
  | { status: "ready"; profile: AccountProfile; signOutUrl: string }
  | { status: "error"; message: string };

type HistoryItem = {
  id: string;
  thumbnail: string;
  downloadUrl: string;
  prompt: string;
  provider: Provider;
  model: string;
  modelName: string;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  quality: Quality;
  createdAt: string;
};

type LegacyHistoryItem = Omit<HistoryItem, "downloadUrl" | "quality"> & { quality?: Quality };

type ViewerImage = {
  src: string;
  alt: string;
  label: string;
};

type GenerationErrorCode = "PROVIDER_SAFETY_BLOCK";

type ApiKeys = Record<Provider, string>;

type VaultRecord = {
  ciphertext: string;
  salt: string;
  iv: string;
  kdfIterations: number;
  version: number;
  updatedAt: string;
};

const PROVIDERS = {
  openai: { name: "OpenAI", family: "GPT Image", placeholder: "sk-proj-…", accent: "#7c9cff" },
  google: { name: "Google", family: "Nano Banana", placeholder: "AIza…", accent: "#ff8c69" },
} as const;

const MODEL_OPTIONS: Record<Provider, readonly ModelOption[]> = {
  openai: [
    { id: "gpt-image-2", name: "GPT Image 2", note: "Qualité maximale, formats libres et 4K", tier: "Recommandé" },
    { id: "gpt-image-1.5", name: "GPT Image 1.5", note: "Bonne fidélité aux prompts, génération classique", tier: "Classique" },
    { id: "gpt-image-1", name: "GPT Image 1", note: "Ancienne génération polyvalente", tier: "Legacy" },
    { id: "gpt-image-1-mini", name: "GPT Image 1 mini", note: "Option économique et rapide", tier: "Éco" },
  ],
  google: [
    { id: "gemini-3.1-flash-image", name: "Nano Banana 2", note: "Rapide, polyvalent et jusqu’au 4K", tier: "Recommandé" },
    { id: "gemini-3-pro-image", name: "Nano Banana Pro", note: "Créations complexes et rendu studio 4K", tier: "Pro" },
    { id: "gemini-3.1-flash-lite-image", name: "Nano Banana 2 Lite", note: "Très rapide et économique, sortie 1K", tier: "Lite" },
    { id: "gemini-2.5-flash-image", name: "Nano Banana", note: "Modèle historique pour les flux rapides", tier: "Legacy" },
  ],
};

const FORMAT_OPTIONS: ReadonlyArray<{ id: AspectRatio; label: string; shape: string }> = [
  { id: "1:1", label: "Carré", shape: "□" },
  { id: "4:3", label: "Standard", shape: "▭" },
  { id: "3:2", label: "Photo", shape: "▭" },
  { id: "16:9", label: "Cinéma", shape: "▱" },
  { id: "21:9", label: "Ultra-large", shape: "▱" },
  { id: "9:16", label: "Story", shape: "▯" },
  { id: "3:4", label: "Portrait", shape: "▯" },
  { id: "2:3", label: "Affiche", shape: "▯" },
  { id: "4:5", label: "Social", shape: "▯" },
  { id: "5:4", label: "Paysage", shape: "▭" },
];

const RESOLUTION_OPTIONS: ReadonlyArray<{ id: Resolution; label: string }> = [
  { id: "1K", label: "Rapide" },
  { id: "2K", label: "Détaillé" },
  { id: "4K", label: "Ultra" },
];

const PROMPT_IDEAS = [
  "Portrait éditorial cinématographique",
  "Affiche rétro-futuriste minimaliste",
  "Photo produit en lumière naturelle",
];

const SOCIAL_LOGIN_OPTIONS = [
  { id: "google", label: "Google", mark: "G" },
  { id: "microsoft", label: "Microsoft", mark: "M" },
  { id: "apple", label: "Apple", mark: "A" },
  { id: "sso", label: "SSO", mark: "S" },
] as const;

const VIEWER_MAX_ZOOM = 5;
const VAULT_KDF_ITERATIONS = 310_000;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function vaultAdditionalData(profileId: string) {
  return new TextEncoder().encode(`neoimage-api-vault:${profileId}:v1`);
}

async function deriveVaultKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptApiKeys(key: CryptoKey, keys: ApiKeys, profileId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(keys));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: vaultAdditionalData(profileId) },
    key,
    plaintext,
  );
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

async function decryptApiKeys(key: CryptoKey, vault: VaultRecord, profileId: string): Promise<ApiKeys> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(vault.iv),
      additionalData: vaultAdditionalData(profileId),
    },
    key,
    base64ToBytes(vault.ciphertext),
  );
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<ApiKeys>;
  if (typeof parsed.openai !== "string" || typeof parsed.google !== "string") throw new Error("Coffre invalide.");
  return { openai: parsed.openai, google: parsed.google };
}

function supportedResolutions(provider: Provider, model: string): Resolution[] {
  if (provider === "openai") return model === "gpt-image-2" ? ["1K", "2K", "4K"] : ["1K"];
  return model === "gemini-3.1-flash-image" || model === "gemini-3-pro-image"
    ? ["1K", "2K", "4K"]
    : ["1K"];
}

function supportedFormats(provider: Provider, model: string): AspectRatio[] {
  if (provider === "openai" && model !== "gpt-image-2") return ["1:1", "3:2", "2:3"];
  return FORMAT_OPTIONS.map((format) => format.id);
}

function Icon({ name }: { name: "sparkles" | "key" | "eye" | "eyeOff" | "download" | "copy" | "image" | "shield" | "history" | "user" | "trash" | "arrow" | "zoomIn" | "zoomOut" | "reset" | "close" }) {
  const paths = {
    sparkles: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z"/><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M15 8l2 2M17 6l2 2"/></>,
    eye: <><path d="M2.5 12s3.2-5 9.5-5 9.5 5 9.5 5-3.2 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.3"/></>,
    eyeOff: <><path d="m3 3 18 18"/><path d="M10.6 7.2A9.9 9.9 0 0 1 12 7c6.3 0 9.5 5 9.5 5a16 16 0 0 1-2.3 2.8M6.5 6.5C3.9 8.2 2.5 12 2.5 12s3.2 5 9.5 5c1 0 1.9-.1 2.7-.4"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 19h16"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m4 17 4.5-4.5 3.5 3 2.5-2.5 5.5 5"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.9 8 7 10 4.1-2 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    history: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6M12 8v4l2.7 1.6"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
    zoomIn: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6"/></>,
    zoomOut: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M7.5 10.5h6"/></>,
    reset: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/></>,
    close: <><path d="m5 5 14 14M19 5 5 19"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function SocialLoginOptions() {
  return (
    <div className="social-login-options" aria-label="Méthodes de connexion compatibles">
      {SOCIAL_LOGIN_OPTIONS.map((option) => (
        <span className="social-login-option" key={option.id}>
          <i className={`social-login-mark ${option.id}`} aria-hidden="true">{option.mark}</i>
          {option.label}
        </span>
      ))}
    </div>
  );
}

function historyStorageKey(profileId: string) {
  return `neoimage-studio:history:${profileId}`;
}

function readLegacyLocalHistory(profileId: string): LegacyHistoryItem[] {
  try {
    const saved = localStorage.getItem(historyStorageKey(profileId));
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed.slice(0, 30) as LegacyHistoryItem[] : [];
  } catch {
    localStorage.removeItem(historyStorageKey(profileId));
    return [];
  }
}

function formatHistoryDate(value: string) {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "Récemment";
  }
}

export default function Home() {
  const [activeView, setActiveView] = useState<View>("create");
  const [account, setAccount] = useState<AccountState>({ status: "loading" });
  const [accountName, setAccountName] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>("openai");
  const [models, setModels] = useState<Record<Provider, string>>({
    openai: "gpt-image-2",
    google: "gemini-3.1-flash-image",
  });
  const [keys, setKeys] = useState<Record<Provider, string>>({ openai: "", google: "" });
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [vaultRecord, setVaultRecord] = useState<VaultRecord | null | undefined>(undefined);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [vaultConfirmation, setVaultConfirmation] = useState("");
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultNotice, setVaultNotice] = useState<string | null>(null);
  const vaultKeyRef = useRef<CryptoKey | null>(null);
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [resolution, setResolution] = useState<Resolution>("2K");
  const [quality, setQuality] = useState<Quality>("medium");
  const [image, setImage] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<{ model: string; aspectRatio: AspectRatio; resolution: Resolution } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<GenerationErrorCode | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewer, setViewer] = useState<ViewerImage | null>(null);
  const [viewerZoom, setViewerZoom] = useState(1);
  const viewerZoomOutputRef = useRef<HTMLOutputElement>(null);
  const viewerScaleRef = useRef(1);
  const viewerTransformApiRef = useRef<ReactZoomPanPinchRef | null>(null);

  const active = PROVIDERS[provider];
  const selectedModelId = models[provider];
  const selectedModel = MODEL_OPTIONS[provider].find((model) => model.id === selectedModelId) ?? MODEL_OPTIONS[provider][0];
  const availableResolutions = supportedResolutions(provider, selectedModelId);
  const availableFormats = supportedFormats(provider, selectedModelId);
  const currentFormat = FORMAT_OPTIONS.find((format) => format.id === aspectRatio) ?? FORMAT_OPTIONS[0];
  const canGenerate = prompt.trim().length > 0 && keys[provider].trim().length > 0 && !isLoading;
  const keyLabel = useMemo(() => `Clé API ${active.name}`, [active.name]);

  const loadSyncedHistory = useCallback(async (profileId: string) => {
    setHistoryLoading(true);
    setHistoryError(null);
    let migrationWarning: string | null = null;
    try {
      const legacy = readLegacyLocalHistory(profileId);
      if (legacy.length > 0) {
        const importResponse = await fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: legacy }),
        });
        if (importResponse.ok) {
          localStorage.removeItem(historyStorageKey(profileId));
        } else {
          migrationWarning = "Votre ancien historique local n’a pas encore pu être importé.";
        }
      }

      const response = await fetch("/api/history", { headers: { Accept: "application/json" } });
      const payload = await response.json() as { history?: HistoryItem[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Impossible de synchroniser l’historique.");
      setHistory(Array.isArray(payload.history) ? payload.history : []);
      if (migrationWarning) setHistoryError(migrationWarning);
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : "Synchronisation indisponible.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadAccount = useCallback(async () => {
    setAccountError(null);
    try {
      const response = await fetch("/api/account", { headers: { Accept: "application/json" } });
      const payload = await response.json() as {
        authenticated?: boolean;
        identity?: { email: string; displayName: string };
        profile?: AccountProfile | null;
        signInUrl?: string;
        signOutUrl?: string;
        authMode?: "local" | "social";
        error?: string;
      };

      if (response.status === 401) {
        setAccount({
          status: "signedOut",
          authMode: payload.authMode ?? "social",
          signInUrl: payload.signInUrl || "/signin-with-chatgpt?return_to=%2F%3Ftab%3Dhistory",
        });
        setHistory([]);
        setHistoryLoading(false);
        return;
      }
      if (!response.ok) throw new Error(payload.error || "Impossible de charger le compte NeoImage.");

      if (payload.profile) {
        setAccount({ status: "ready", profile: payload.profile, signOutUrl: payload.signOutUrl || "/signout-with-chatgpt?return_to=%2F" });
        setAccountName(payload.profile.displayName);
        await loadSyncedHistory(payload.profile.id);
      } else if (payload.identity) {
        setAccount({ status: "needsProfile", identity: payload.identity, signOutUrl: payload.signOutUrl || "/signout-with-chatgpt?return_to=%2F" });
        setAccountName(payload.identity.displayName);
        setHistory([]);
        setHistoryLoading(false);
      } else {
        throw new Error("Identité indisponible.");
      }
    } catch (cause) {
      setAccount({ status: "error", message: cause instanceof Error ? cause.message : "Compte indisponible." });
    }
  }, [loadSyncedHistory]);

  const loadVault = useCallback(async () => {
    vaultKeyRef.current = null;
    setVaultUnlocked(false);
    setVaultPassphrase("");
    setVaultConfirmation("");
    setVaultError(null);
    setVaultNotice(null);

    if (account.status !== "ready") {
      setVaultRecord(undefined);
      if (account.status !== "loading") setKeys({ openai: "", google: "" });
      return;
    }

    setVaultRecord(undefined);
    try {
      const response = await fetch("/api/vault", { headers: { Accept: "application/json" } });
      const payload = await response.json() as { vault?: VaultRecord | null; error?: string };
      if (!response.ok) throw new Error(payload.error || "Impossible de charger le coffre.");
      const remoteVault = payload.vault ?? null;
      setVaultRecord(remoteVault);
      if (remoteVault) setKeys({ openai: "", google: "" });
    } catch (cause) {
      setVaultRecord(null);
      setVaultError(cause instanceof Error ? cause.message : "Coffre indisponible.");
    }
  }, [account]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("tab") === "history") setActiveView("history");
      void loadAccount();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAccount]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = sessionStorage.getItem("neoimage-studio:api-keys");
        if (saved) setKeys({ openai: "", google: "", ...JSON.parse(saved) });
      } catch {
        sessionStorage.removeItem("neoimage-studio:api-keys");
      }
      setKeysLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (keysLoaded) sessionStorage.setItem("neoimage-studio:api-keys", JSON.stringify(keys));
  }, [keys, keysLoaded]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadVault(), 0);
    return () => window.clearTimeout(timer);
  }, [loadVault]);

  function openViewer(nextImage: ViewerImage) {
    viewerScaleRef.current = 1;
    setViewerZoom(1);
    setViewer(nextImage);
  }

  const syncViewerScale = useCallback((scale: number, wrapper?: HTMLDivElement | null) => {
    viewerScaleRef.current = scale;
    if (viewerZoomOutputRef.current) {
      viewerZoomOutputRef.current.textContent = `${Math.round(scale * 100)}%`;
    }
    wrapper?.classList.toggle("can-pan", scale > 1.005);
  }, []);

  const commitViewerScale = useCallback((ref: ReactZoomPanPinchRef) => {
    syncViewerScale(ref.state.scale, ref.instance.wrapperComponent);
    setViewerZoom(ref.state.scale);
  }, [syncViewerScale]);

  useEffect(() => {
    if (!viewer) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewer(null);
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        viewerTransformApiRef.current?.zoomIn(Math.log(1.25), 180, "easeOut");
      }
      if (event.key === "-") {
        event.preventDefault();
        viewerTransformApiRef.current?.zoomOut(Math.log(1.25), 180, "easeOut");
      }
      if (event.key === "0") {
        event.preventDefault();
        viewerTransformApiRef.current?.resetTransform(180, "easeOut");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [viewer]);

  function keepCompatible(nextProvider: Provider, nextModel: string) {
    const resolutions = supportedResolutions(nextProvider, nextModel);
    const formats = supportedFormats(nextProvider, nextModel);
    if (!resolutions.includes(resolution)) setResolution(resolutions[0]);
    if (!formats.includes(aspectRatio)) setAspectRatio("1:1");
  }

  function changeProvider(nextProvider: Provider) {
    setProvider(nextProvider);
    setShowKey(false);
    setError(null);
    setErrorCode(null);
    keepCompatible(nextProvider, models[nextProvider]);
  }

  function changeModel(nextModel: string) {
    setModels((current) => ({ ...current, [provider]: nextModel }));
    keepCompatible(provider, nextModel);
    setError(null);
    setErrorCode(null);
  }

  function updateKey(value: string) {
    setKeys((current) => ({ ...current, [provider]: value }));
    if (vaultUnlocked) setVaultNotice("Clés modifiées — synchronisez le coffre.");
  }

  async function sendVault(payload: Omit<VaultRecord, "updatedAt">) {
    const response = await fetch("/api/vault", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json() as { vault?: VaultRecord; error?: string };
    if (!response.ok || !body.vault) throw new Error(body.error || "Impossible de synchroniser le coffre.");
    return body.vault;
  }

  async function createVault() {
    if (account.status !== "ready" || vaultBusy) return;
    if (!keys.openai.trim() && !keys.google.trim()) {
      setVaultError("Ajoutez au moins une clé API avant de créer le coffre.");
      return;
    }
    if (vaultPassphrase.length < 12) {
      setVaultError("La phrase secrète doit contenir au moins 12 caractères.");
      return;
    }
    if (vaultPassphrase !== vaultConfirmation) {
      setVaultError("Les deux phrases secrètes ne correspondent pas.");
      return;
    }

    setVaultBusy(true);
    setVaultError(null);
    setVaultNotice(null);
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveVaultKey(vaultPassphrase, salt, VAULT_KDF_ITERATIONS);
      const encrypted = await encryptApiKeys(key, keys, account.profile.id);
      const saved = await sendVault({
        ...encrypted,
        salt: bytesToBase64(salt),
        kdfIterations: VAULT_KDF_ITERATIONS,
        version: 1,
      });
      vaultKeyRef.current = key;
      setVaultRecord(saved);
      setVaultUnlocked(true);
      setVaultPassphrase("");
      setVaultConfirmation("");
      setVaultNotice("Coffre créé et synchronisé sur votre compte.");
    } catch (cause) {
      setVaultError(cause instanceof Error ? cause.message : "Création du coffre impossible.");
    } finally {
      setVaultBusy(false);
    }
  }

  async function unlockVault() {
    if (account.status !== "ready" || !vaultRecord || vaultBusy) return;
    if (!vaultPassphrase) {
      setVaultError("Saisissez votre phrase secrète.");
      return;
    }

    setVaultBusy(true);
    setVaultError(null);
    setVaultNotice(null);
    try {
      const key = await deriveVaultKey(
        vaultPassphrase,
        base64ToBytes(vaultRecord.salt),
        vaultRecord.kdfIterations,
      );
      const decrypted = await decryptApiKeys(key, vaultRecord, account.profile.id);
      vaultKeyRef.current = key;
      setKeys(decrypted);
      setVaultUnlocked(true);
      setVaultPassphrase("");
      setVaultNotice("Coffre déverrouillé sur cet appareil.");
    } catch {
      vaultKeyRef.current = null;
      setVaultError("Phrase secrète incorrecte ou coffre endommagé.");
    } finally {
      setVaultBusy(false);
    }
  }

  async function syncVault() {
    if (account.status !== "ready" || !vaultRecord || !vaultKeyRef.current || vaultBusy) return;
    setVaultBusy(true);
    setVaultError(null);
    setVaultNotice(null);
    try {
      const encrypted = await encryptApiKeys(vaultKeyRef.current, keys, account.profile.id);
      const saved = await sendVault({
        ...encrypted,
        salt: vaultRecord.salt,
        kdfIterations: vaultRecord.kdfIterations,
        version: vaultRecord.version,
      });
      setVaultRecord(saved);
      setVaultNotice("Clés chiffrées et synchronisées.");
    } catch (cause) {
      setVaultError(cause instanceof Error ? cause.message : "Synchronisation impossible.");
    } finally {
      setVaultBusy(false);
    }
  }

  function lockVault() {
    vaultKeyRef.current = null;
    setVaultUnlocked(false);
    setKeys({ openai: "", google: "" });
    setShowKey(false);
    setVaultNotice("Coffre verrouillé sur cet appareil.");
  }

  async function resetVault() {
    if (vaultBusy || !window.confirm("Réinitialiser le coffre synchronisé ? Les clés enregistrées seront définitivement supprimées.")) return;
    setVaultBusy(true);
    setVaultError(null);
    try {
      const response = await fetch("/api/vault", { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Réinitialisation impossible.");
      vaultKeyRef.current = null;
      setVaultRecord(null);
      setVaultUnlocked(false);
      setKeys({ openai: "", google: "" });
      setVaultPassphrase("");
      setVaultConfirmation("");
      setVaultNotice("Coffre réinitialisé. Vous pouvez en créer un nouveau.");
    } catch (cause) {
      setVaultError(cause instanceof Error ? cause.message : "Réinitialisation impossible.");
    } finally {
      setVaultBusy(false);
    }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    if (accountBusy) return;
    setAccountBusy(true);
    setAccountError(null);
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: accountName }),
      });
      const payload = await response.json() as {
        profile?: AccountProfile;
        signOutUrl?: string;
        signInUrl?: string;
        authMode?: "local" | "social";
        error?: string;
      };
      if (response.status === 401) {
        setAccount({
          status: "signedOut",
          authMode: payload.authMode ?? "social",
          signInUrl: payload.signInUrl || "/signin-with-chatgpt?return_to=%2F%3Ftab%3Dhistory",
        });
        return;
      }
      if (!response.ok || !payload.profile) throw new Error(payload.error || "Impossible de créer le compte.");
      setAccount({
        status: "ready",
        profile: payload.profile,
        signOutUrl: payload.signOutUrl || "/signout-with-chatgpt?return_to=%2F",
      });
      await loadSyncedHistory(payload.profile.id);
    } catch (cause) {
      setAccountError(cause instanceof Error ? cause.message : "Impossible de créer le compte.");
    } finally {
      setAccountBusy(false);
    }
  }

  function openHistoryItem(item: HistoryItem) {
    const modelExists = MODEL_OPTIONS[item.provider].some((model) => model.id === item.model);
    const fallbackModel = MODEL_OPTIONS[item.provider][0].id;
    const nextModel = modelExists ? item.model : fallbackModel;
    const nextResolutions = supportedResolutions(item.provider, nextModel);
    const nextFormats = supportedFormats(item.provider, nextModel);
    const nextResolution = nextResolutions.includes(item.resolution) ? item.resolution : nextResolutions[0];
    const nextRatio = nextFormats.includes(item.aspectRatio) ? item.aspectRatio : "1:1";

    setProvider(item.provider);
    setModels((current) => ({ ...current, [item.provider]: nextModel }));
    setPrompt(item.prompt);
    setAspectRatio(nextRatio);
    setResolution(nextResolution);
    setQuality(item.quality);
    setImage(item.thumbnail);
    setResultInfo({ model: nextModel, aspectRatio: nextRatio, resolution: nextResolution });
    setActiveView("create");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteHistoryItem(itemId: string) {
    if (account.status !== "ready" || historyBusy) return;
    setHistoryBusy(true);
    setHistoryError(null);
    try {
      const response = await fetch("/api/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Suppression impossible.");
      setHistory((current) => current.filter((item) => item.id !== itemId));
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : "Suppression impossible.");
    } finally {
      setHistoryBusy(false);
    }
  }

  async function clearHistory() {
    if (account.status !== "ready" || history.length === 0 || historyBusy) return;
    if (!window.confirm("Effacer l’historique synchronisé sur tous vos appareils ?")) return;
    setHistoryBusy(true);
    setHistoryError(null);
    try {
      const response = await fetch("/api/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Suppression impossible.");
      setHistory([]);
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : "Suppression impossible.");
    } finally {
      setHistoryBusy(false);
    }
  }

  async function generate(event?: FormEvent) {
    event?.preventDefault();
    if (!canGenerate) return;
    setIsLoading(true);
    setError(null);
    setErrorCode(null);
    setCopied(false);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model: selectedModelId,
          apiKey: keys[provider].trim(),
          prompt: prompt.trim(),
          aspectRatio,
          resolution,
          quality,
        }),
      });
      const payload = await response.json() as {
        image?: string;
        model?: string;
        aspectRatio?: AspectRatio;
        resolution?: Resolution;
        historyItem?: HistoryItem;
        historyWarning?: string;
        error?: string;
        code?: GenerationErrorCode;
      };
      if (!response.ok || !payload.image) {
        setErrorCode(payload.code ?? null);
        throw new Error(payload.error || "La génération a échoué.");
      }
      const info = {
        model: payload.model || selectedModelId,
        modelName: selectedModel.name,
        aspectRatio: payload.aspectRatio || aspectRatio,
        resolution: payload.resolution || resolution,
      };
      setImage(payload.image);
      setResultInfo(info);
      if (payload.historyItem) {
        setHistory((current) => [payload.historyItem as HistoryItem, ...current.filter((item) => item.id !== payload.historyItem?.id)].slice(0, 100));
      }
      if (payload.historyWarning) setHistoryError(payload.historyWarning);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La génération a échoué. Réessayez.");
    } finally {
      setIsLoading(false);
    }
  }

  function downloadImage() {
    if (!image) return;
    const link = document.createElement("a");
    link.href = image;
    link.download = `neoimage-${provider}-${Date.now()}.png`;
    link.click();
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const displayRatio = resultInfo?.aspectRatio ?? aspectRatio;
  const displayResolution = resultInfo?.resolution ?? resolution;
  const accountDisplayName = account.status === "ready"
    ? account.profile.displayName
    : account.status === "needsProfile"
      ? account.identity.displayName
      : "Compte NeoImage";
  const accountInitial = accountDisplayName.trim().charAt(0).toUpperCase() || "N";

  return (
    <main className="app-shell" style={{ "--provider-accent": active.accent } as React.CSSProperties}>
      <header className="topbar">
        <a className="brand" href="#studio" aria-label="NeoImage Studio — accueil" onClick={() => setActiveView("create")}>
          <span className="brand-mark"><span /></span>
          <span>NeoImage <b>Studio</b></span>
        </a>
        <nav className="app-tabs" role="tablist" aria-label="Navigation principale">
          <button type="button" role="tab" aria-selected={activeView === "create"} className={activeView === "create" ? "active" : ""} onClick={() => setActiveView("create")}>
            <Icon name="sparkles" /> Créer
          </button>
          <button type="button" role="tab" aria-selected={activeView === "history"} className={activeView === "history" ? "active" : ""} onClick={() => setActiveView("history")}>
            <Icon name="history" /> Historique <span className="new-badge">Nouveau</span>
          </button>
        </nav>
        <div className="top-actions">
          <div className="privacy-chip"><Icon name="shield" /> Clés protégées</div>
          <button type="button" className={`account-pill ${account.status === "ready" ? "connected" : ""}`} onClick={() => setActiveView("history")}>
            <span className="account-avatar">{account.status === "ready" ? accountInitial : <Icon name="user" />}</span>
            <span><b>{account.status === "loading" ? "Chargement…" : accountDisplayName}</b><small>{account.status === "ready" ? "Compte actif" : "Accès historique"}</small></span>
          </button>
        </div>
      </header>

      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      {activeView === "create" ? (<>
      <section className="intro create-intro">
        <p className="eyebrow"><span /> Studio de création IA</p>
        <h1>Une idée. Deux moteurs.<br /><em>Tous les formats.</em></h1>
        <p>Choisissez votre modèle, votre ratio et une définition jusqu’au 4K pour donner à chaque image sa forme idéale.</p>
      </section>

      <section className="studio" id="studio">
        <form className="control-panel" onSubmit={generate}>
          <div className="panel-heading">
            <div><span className="step">01</span><h2>Moteur & accès</h2></div>
            <span className="status-dot">Prêt</span>
          </div>

          <div className="provider-tabs" role="tablist" aria-label="Choisir le fournisseur d’images">
            {(["openai", "google"] as Provider[]).map((item) => (
              <button key={item} type="button" role="tab" aria-selected={provider === item} className={provider === item ? "active" : ""} onClick={() => changeProvider(item)}>
                <span className={`provider-logo ${item}`}>{item === "openai" ? "◌" : "✦"}</span>
                <span><b>{PROVIDERS[item].name}</b><small>{PROVIDERS[item].family} · 4 modèles</small></span>
              </button>
            ))}
          </div>

          <div className="field-group">
            <label htmlFor="api-key">{keyLabel}</label>
            <div className="input-shell key-input">
              <Icon name="key" />
              <input id="api-key" type={showKey ? "text" : "password"} value={keys[provider]} onChange={(event) => updateKey(event.target.value)} placeholder={active.placeholder} autoComplete="off" spellCheck={false} aria-describedby="key-help" />
              <button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? "Masquer la clé" : "Afficher la clé"}><Icon name={showKey ? "eyeOff" : "eye"} /></button>
            </div>
            <p className="field-help" id="key-help">Jamais enregistrée en clair · chiffrement et déchiffrement sur cet appareil</p>
          </div>

          <section className={`api-vault ${vaultUnlocked ? "unlocked" : ""}`} aria-label="Coffre de clés synchronisé">
            <div className="vault-heading">
              <span className="vault-icon"><Icon name="shield" /></span>
              <div><b>Coffre synchronisé</b><small>Mobile + PC · chiffrement AES‑GCM</small></div>
              <span className="vault-state">{account.status !== "ready" ? "Compte requis" : vaultRecord === undefined ? "Chargement" : vaultUnlocked ? "Déverrouillé" : vaultRecord ? "Verrouillé" : "À créer"}</span>
            </div>

            {account.status !== "ready" ? (
              <div className="vault-gate">
                <p>Un compte NeoImage est nécessaire pour synchroniser le coffre.</p>
                {account.status === "signedOut" && <a href={account.signInUrl}>{account.authMode === "local" ? "Utiliser le compte de test local" : "Google, Microsoft, Apple ou SSO"}</a>}
                {account.status === "needsProfile" && <button type="button" onClick={() => setActiveView("history")}>Créer le compte NeoImage</button>}
              </div>
            ) : vaultRecord === undefined ? (
              <div className="vault-loading"><span /> Chargement du coffre…</div>
            ) : vaultRecord === null ? (
              <div className="vault-form">
                <p>Créez une phrase secrète identique sur tous vos appareils. Elle ne pourra pas être récupérée.</p>
                <div className="vault-passphrases">
                  <input
                    type="password"
                    value={vaultPassphrase}
                    onChange={(event) => setVaultPassphrase(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createVault(); } }}
                    placeholder="Phrase secrète · 12 caractères minimum"
                    autoComplete="off"
                    aria-label="Créer une phrase secrète"
                  />
                  <input
                    type="password"
                    value={vaultConfirmation}
                    onChange={(event) => setVaultConfirmation(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createVault(); } }}
                    placeholder="Confirmer la phrase"
                    autoComplete="off"
                    aria-label="Confirmer la phrase secrète"
                  />
                </div>
                <button className="vault-primary" type="button" disabled={vaultBusy} onClick={() => void createVault()}>{vaultBusy ? "Chiffrement…" : "Créer et synchroniser"}</button>
              </div>
            ) : !vaultUnlocked ? (
              <div className="vault-form">
                <p>Saisissez votre phrase secrète pour récupérer les clés sur cet appareil.</p>
                <div className="vault-unlock-row">
                  <input
                    type="password"
                    value={vaultPassphrase}
                    onChange={(event) => setVaultPassphrase(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void unlockVault(); } }}
                    placeholder="Votre phrase secrète"
                    autoComplete="off"
                    aria-label="Phrase secrète du coffre"
                  />
                  <button className="vault-primary" type="button" disabled={vaultBusy} onClick={() => void unlockVault()}>{vaultBusy ? "Ouverture…" : "Déverrouiller"}</button>
                </div>
                <button className="vault-reset" type="button" disabled={vaultBusy} onClick={() => void resetVault()}>Phrase perdue ? Réinitialiser le coffre</button>
              </div>
            ) : (
              <div className="vault-open">
                <div className="vault-providers"><span className={keys.openai ? "ready" : ""}>OpenAI {keys.openai ? "prête" : "vide"}</span><span className={keys.google ? "ready" : ""}>Google {keys.google ? "prête" : "vide"}</span></div>
                <p>Modifiez les clés ci-dessus, puis synchronisez. La phrase reste uniquement en mémoire pendant cette session.</p>
                <div className="vault-actions">
                  <button className="vault-primary" type="button" disabled={vaultBusy} onClick={() => void syncVault()}>{vaultBusy ? "Synchronisation…" : "Synchroniser maintenant"}</button>
                  <button type="button" onClick={lockVault}>Verrouiller</button>
                </div>
              </div>
            )}

            {vaultError && <p className="vault-feedback error" role="alert">{vaultError}</p>}
            {vaultNotice && <p className="vault-feedback" role="status">{vaultNotice}</p>}
          </section>

          <div className="divider" />

          <div className="panel-heading compact">
            <div><span className="step">02</span><h2>Votre création</h2></div>
            <span className="model-tag">{selectedModel.tier}</span>
          </div>

          <div className="field-group model-field">
            <label htmlFor="model">Modèle {active.name}</label>
            <select id="model" value={selectedModelId} onChange={(event) => changeModel(event.target.value)}>
              {MODEL_OPTIONS[provider].map((model) => <option value={model.id} key={model.id}>{model.name} — {model.tier}</option>)}
            </select>
            <p className="model-note"><b>{selectedModel.id}</b><span>{selectedModel.note}</span></p>
          </div>

          <div className="field-group prompt-group">
            <div className="label-row"><label htmlFor="prompt">Décrivez votre image</label><span>{prompt.length}/4000</span></div>
            <textarea id="prompt" value={prompt} maxLength={4000} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") generate(); }} placeholder="Une maison moderniste isolée au bord d’un lac alpin, brume matinale, photographie architecturale…" />
            <div className="prompt-ideas">{PROMPT_IDEAS.map((idea) => <button type="button" key={idea} onClick={() => setPrompt(idea)}>{idea}</button>)}</div>
          </div>

          <div className={`settings-grid ${provider === "google" ? "google-settings" : ""}`}>
            <div className="field-group">
              <label htmlFor="format">Format</label>
              <select id="format" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}>
                {FORMAT_OPTIONS.filter((format) => availableFormats.includes(format.id)).map((format) => <option value={format.id} key={format.id}>{format.shape} {format.label} · {format.id}</option>)}
              </select>
            </div>
            {provider === "openai" && (
              <div className="field-group">
                <label htmlFor="quality">Finition</label>
                <select id="quality" value={quality} onChange={(event) => setQuality(event.target.value as Quality)}>
                  <option value="low">Rapide</option><option value="medium">Studio</option><option value="high">Haute</option>
                </select>
              </div>
            )}
          </div>

          <div className="field-group resolution-field">
            <div className="label-row"><label>Qualité de sortie</label><span>Définition maximale</span></div>
            <div className="resolution-picker" role="group" aria-label="Choisir la résolution">
              {RESOLUTION_OPTIONS.map((item) => {
                const isAvailable = availableResolutions.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={resolution === item.id ? "active" : ""}
                    disabled={!isAvailable}
                    onClick={() => setResolution(item.id)}
                    aria-pressed={resolution === item.id}
                    title={isAvailable ? `${item.id} — ${item.label}` : `${item.id} indisponible avec ce modèle`}
                  >
                    <b>{item.id}</b><small>{isAvailable ? item.label : "Non pris en charge"}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="selection-summary">
            <span>{currentFormat.label} {aspectRatio}</span><span>{resolution}</span><span>{selectedModel.name}</span>
          </div>

          {error && (
            <div className={`error-message ${errorCode === "PROVIDER_SAFETY_BLOCK" ? "safety-message" : ""}`} role="alert">
              {errorCode === "PROVIDER_SAFETY_BLOCK" && <strong>Décision du fournisseur</strong>}
              <span>{error}</span>
              {errorCode === "PROVIDER_SAFETY_BLOCK" && (
                <div className="safety-actions">
                  <button type="button" onClick={() => document.getElementById("prompt")?.focus()}>Modifier le prompt</button>
                  <button type="button" onClick={() => changeProvider(provider === "openai" ? "google" : "openai")}>Essayer {provider === "openai" ? "Google" : "OpenAI"}</button>
                </div>
              )}
            </div>
          )}

          <button className="generate-button" type="submit" disabled={!canGenerate}>
            <Icon name="sparkles" /><span>{isLoading ? "Création en cours…" : "Générer l’image"}</span><small>⌘ ↵</small>
          </button>
          <p className="billing-note">La génération est facturée directement par {active.name} selon votre compte.</p>
          <button className={`history-save-cta ${account.status === "ready" ? "enabled" : ""}`} type="button" onClick={() => setActiveView("history")}>
            <Icon name="history" />
            <span>{account.status === "ready" ? "Historique synchronisé activé" : "Compte NeoImage requis pour l’historique"}</span>
            <Icon name="arrow" />
          </button>
        </form>

        <section className="result-panel" aria-live="polite">
          <div className="result-heading">
            <div><span className="step">03</span><h2>Aperçu</h2></div>
            {image && <span className="result-model">{resultInfo?.model}</span>}
          </div>

          <div className={`canvas ratio-${aspectRatio.replace(":", "-")} ${isLoading ? "loading" : ""}`}>
            {isLoading ? (
              <div className="loading-state"><span className="orbit"><i /><i /><i /></span><strong>{selectedModel.name} imagine en {resolution}…</strong><p>Composition, lumière et détails prennent forme.</p></div>
            ) : image ? (
              <button
                className="canvas-zoom-trigger"
                type="button"
                onClick={() => openViewer({
                  src: image,
                  alt: `Image générée avec ${active.name} à partir du prompt : ${prompt}`,
                  label: `${active.name} · ${resultInfo?.model || selectedModel.name}`,
                })}
                aria-label="Agrandir l’image pour examiner les détails"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt={`Image générée avec ${active.name} à partir du prompt : ${prompt}`} />
                <span className="canvas-zoom-hint"><Icon name="zoomIn" /> Cliquer pour zoomer</span>
              </button>
            ) : (
              <div className="empty-state"><div className="empty-art"><span className="art-orb orb-a" /><span className="art-orb orb-b" /><span className="art-grid" /><Icon name="image" /></div><strong>Votre image apparaîtra ici</strong><p>Ajoutez une clé API et un prompt pour commencer.</p></div>
            )}
          </div>

          <div className="result-footer">
            <div className="result-meta"><span>{displayRatio}</span><span>{displayResolution}</span></div>
            <div className="result-actions"><button type="button" disabled={!image} onClick={copyPrompt}><Icon name="copy" /> {copied ? "Copié" : "Prompt"}</button><button type="button" disabled={!image} onClick={downloadImage}><Icon name="download" /> Télécharger</button></div>
          </div>
        </section>
      </section>
      </>) : (<>
        <section className="history-hero">
          <p className="eyebrow"><span /> Nouveau · synchronisation cloud</p>
          <h1>Votre <em>Historique</em></h1>
          <p>Retrouvez automatiquement vos créations sur mobile et PC dès que vous utilisez le même compte NeoImage.</p>
          <div className="history-privacy"><Icon name="shield" /><span><b>Privé et synchronisé</b> — seules les créations de votre compte sont accessibles.</span></div>
        </section>

        <section className="history-shell" id="history">
          <div className="history-heading">
            <div>
              <span className="step">HISTORIQUE</span>
              <h2>Créations synchronisées</h2>
            </div>
            {account.status === "ready" && <span className="device-count">{history.length} création{history.length > 1 ? "s" : ""}</span>}
          </div>

          {account.status === "loading" && (
            <div className="account-gate loading-account">
              <span className="account-loader" />
              <h3>Vérification de votre compte…</h3>
              <p>NeoImage prépare votre espace personnel.</p>
            </div>
          )}

          {account.status === "signedOut" && (
            <div className="account-gate">
              <div className="gate-icon"><Icon name="user" /></div>
              {account.authMode === "local" ? (
                <>
                  <span className="gate-kicker">Développement local</span>
                  <h3>Ouvrez un compte de test local</h3>
                  <p>La connexion Google, Microsoft, Apple et SSO est fournie par le site publié. Sur localhost, utilisez ce compte temporaire pour tester NeoImage sans page introuvable.</p>
                  <a className="account-primary social-login-primary" href={account.signInUrl}>Continuer en mode local <Icon name="arrow" /></a>
                  <small><Icon name="shield" /> Réservé à cet ordinateur · aucune connexion tierce simulée.</small>
                </>
              ) : (
                <>
                  <span className="gate-kicker">Compte requis</span>
                  <h3>Connectez votre compte NeoImage</h3>
                  <p>Utilisez Google, Microsoft, Apple ou le SSO de votre organisation. À l’étape suivante, ChatGPT vérifie votre identité sans transmettre votre mot de passe à NeoImage.</p>
                  <SocialLoginOptions />
                  <a className="account-primary social-login-primary" href={account.signInUrl}>Choisir mon mode de connexion <Icon name="arrow" /></a>
                  <small><Icon name="shield" /> Connexion sécurisée par ChatGPT · historique synchronisé sur mobile et PC.</small>
                </>
              )}
            </div>
          )}

          {account.status === "needsProfile" && (
            <form className="account-gate account-form" onSubmit={createAccount}>
              <div className="gate-icon"><Icon name="sparkles" /></div>
              <span className="gate-kicker">Dernière étape</span>
              <h3>Créez votre compte NeoImage</h3>
              <p>Il sera associé à <b>{account.identity.email}</b> et reconnu lorsque vous utiliserez la même connexion Google, Microsoft, Apple ou SSO sur un autre appareil.</p>
              <label htmlFor="account-name">Nom affiché</label>
              <input id="account-name" value={accountName} maxLength={80} onChange={(event) => setAccountName(event.target.value)} placeholder="Votre nom" required />
              {accountError && <div className="account-error" role="alert">{accountError}</div>}
              <button className="account-primary" type="submit" disabled={accountBusy || !accountName.trim()}>
                {accountBusy ? "Création…" : "Créer mon compte NeoImage"} <Icon name="arrow" />
              </button>
              <a className="account-signout-link" href={account.signOutUrl}>Utiliser un autre compte</a>
            </form>
          )}

          {account.status === "error" && (
            <div className="account-gate">
              <div className="gate-icon warning">!</div>
              <h3>Compte momentanément indisponible</h3>
              <p>{account.message}</p>
              <button className="account-primary" type="button" onClick={() => void loadAccount()}>Réessayer <Icon name="arrow" /></button>
            </div>
          )}

          {account.status === "ready" && (
            <>
              <div className="account-banner">
                <div className="account-banner-avatar">{accountInitial}</div>
                <div><span>Compte NeoImage</span><b>{account.profile.displayName}</b><small>{account.profile.email}</small></div>
                <div className="account-sync-copy"><Icon name="shield" /><span><b>Synchronisation active</b><small>Mobile, PC et autres appareils</small></span></div>
                <a href={account.signOutUrl}>Se déconnecter</a>
              </div>

              <div className="history-toolbar">
                <p><span className="local-dot" /> Synchronisé avec votre compte · maximum 100 créations</p>
                {history.length > 0 && <button type="button" disabled={historyBusy} onClick={() => void clearHistory()}><Icon name="trash" /> Tout effacer</button>}
              </div>

              {historyError && (
                <div className="history-sync-error" role="alert">
                  <span>{historyError}</span>
                  <button type="button" onClick={() => void loadSyncedHistory(account.profile.id)}>Réessayer</button>
                </div>
              )}

              {historyLoading ? (
                <div className="history-empty history-syncing">
                  <span className="account-loader" />
                  <h3>Synchronisation de vos créations…</h3>
                  <p>NeoImage récupère votre historique personnel.</p>
                </div>
              ) : history.length === 0 ? (
                <div className="history-empty">
                  <div className="empty-art"><span className="art-orb orb-a" /><span className="art-orb orb-b" /><span className="art-grid" /><Icon name="history" /></div>
                  <h3>Aucune création synchronisée</h3>
                  <p>Les prochaines images générées seront ajoutées ici et disponibles sur tous vos appareils.</p>
                  <button type="button" className="account-primary" onClick={() => setActiveView("create")}>Créer une image <Icon name="sparkles" /></button>
                </div>
              ) : (
                <div className="history-grid">
                  {history.map((item) => (
                    <article className="history-card" key={item.id}>
                      <button
                        className="history-preview"
                        type="button"
                        onClick={() => openViewer({ src: item.thumbnail, alt: item.prompt, label: `${item.modelName} · ${item.resolution}` })}
                        aria-label="Agrandir cette création pour examiner les détails"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.thumbnail} alt="" />
                        <span className="history-provider">{item.provider === "openai" ? "OpenAI" : "Google"}</span>
                        <span className="history-open">Zoomer <Icon name="zoomIn" /></span>
                      </button>
                      <div className="history-card-body">
                        <div className="history-card-meta"><span>{item.aspectRatio}</span><span>{item.resolution}</span><time>{formatHistoryDate(item.createdAt)}</time></div>
                        <p>{item.prompt}</p>
                        <small>{item.modelName}</small>
                        <div className="history-card-actions">
                          <button type="button" onClick={() => openHistoryItem(item)}>Réutiliser</button>
                          <a href={item.downloadUrl} aria-label="Télécharger l’image originale"><Icon name="download" /> Original</a>
                          <button type="button" disabled={historyBusy} onClick={() => void deleteHistoryItem(item.id)} aria-label="Supprimer de l’historique"><Icon name="trash" /></button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <p className="history-original-note">Les images originales et leurs réglages sont conservés dans votre espace NeoImage privé.</p>
            </>
          )}
        </section>
      </>)}

      {viewer && (
        <TransformWrapper
          ref={viewerTransformApiRef}
          initialScale={1}
          minScale={1}
          maxScale={VIEWER_MAX_ZOOM}
          limitToBounds
          centerOnInit
          centerZoomedOut
          disablePadding
          smooth
          wheel={{ step: 0.0018 }}
          trackPadPanning={{ disabled: true }}
          panning={{
            velocityDisabled: false,
            allowLeftClickPan: true,
            allowMiddleClickPan: false,
            allowRightClickPan: false,
          }}
          pinch={{ step: 5, allowPanning: true }}
          doubleClick={{ mode: "toggle", step: Math.log(1.5), animationTime: 180, animationType: "easeOut" }}
          zoomAnimation={{ disabled: false, size: 0, animationTime: 180, animationType: "easeOut" }}
          autoAlignment={{ disabled: false, animationTime: 180, velocityAlignmentTime: 260, animationType: "easeOut" }}
          velocityAnimation={{
            disabled: false,
            sensitivityMouse: 1,
            sensitivityTouch: 1.15,
            maxStrengthMouse: 18,
            maxStrengthTouch: 32,
            inertia: 1,
            animationTime: 260,
            maxAnimationTime: 520,
            animationType: "easeOut",
          }}
          onInit={(ref) => {
            syncViewerScale(ref.state.scale, ref.instance.wrapperComponent);
            setViewerZoom(ref.state.scale);
          }}
          onTransform={(ref, state) => syncViewerScale(state.scale, ref.instance.wrapperComponent)}
          onZoomStop={commitViewerScale}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <div className="image-viewer" role="dialog" aria-modal="true" aria-label="Visionneuse de détails">
              <div className="viewer-toolbar">
                <div className="viewer-title"><small>Visionneuse</small><b>{viewer.label}</b></div>
                <div className="viewer-controls" aria-label="Contrôles du zoom">
                  <button type="button" onClick={() => zoomOut(Math.log(1.25), 180, "easeOut")} disabled={viewerZoom <= 1.001} aria-label="Réduire le zoom"><Icon name="zoomOut" /></button>
                  <output ref={viewerZoomOutputRef} aria-live="polite">{Math.round(viewerZoom * 100)}%</output>
                  <button type="button" onClick={() => zoomIn(Math.log(1.25), 180, "easeOut")} disabled={viewerZoom >= VIEWER_MAX_ZOOM} aria-label="Augmenter le zoom"><Icon name="zoomIn" /></button>
                  <button type="button" onClick={() => resetTransform(180, "easeOut")} disabled={viewerZoom <= 1.001} aria-label="Réinitialiser le zoom"><Icon name="reset" /></button>
                  <span className="viewer-control-divider" />
                  <button className="viewer-close" type="button" onClick={() => setViewer(null)} aria-label="Fermer la visionneuse" autoFocus><Icon name="close" /></button>
                </div>
              </div>
              <TransformComponent
                wrapperClass={`viewer-scroll ${viewerZoom > 1.001 ? "can-pan" : ""}`}
                contentClass="viewer-stage"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={viewer.src} alt={viewer.alt} draggable={false} />
              </TransformComponent>
              <div className="viewer-help"><span>Zoom tiers · max 500%</span><span>Mobile : pincer et glisser</span><span>PC : molette et glisser</span><span>Échap : fermer</span></div>
            </div>
          )}
        </TransformWrapper>
      )}

      <footer><span>NeoImage Studio</span><p>Compte multi-appareils · historique synchronisé et privé</p><span>OpenAI · Google</span></footer>
    </main>
  );
}
