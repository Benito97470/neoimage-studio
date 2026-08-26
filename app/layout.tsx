import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NeoImage Studio — Création d’images IA",
  description: "Créez des images jusqu’au 4K avec OpenAI et Google. Connexion sécurisée par ChatGPT avec Google, Microsoft, Apple ou SSO, puis historique NeoImage synchronisé sur tous vos appareils.",
  openGraph: {
    title: "NeoImage Studio",
    description: "8 modèles, 10 formats, jusqu’au 4K et un historique synchronisé privé.",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "NeoImage Studio — Créez avec OpenAI ou Google" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "NeoImage Studio",
    description: "8 modèles, 10 formats, jusqu’au 4K et un historique synchronisé privé.",
    images: ["/og.png"],
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
