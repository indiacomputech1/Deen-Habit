import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Optional: use vite-plugin-pwa for auto manifest/SW generation
// import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // Uncomment below and install vite-plugin-pwa for automatic PWA generation:
    // VitePWA({
    //   registerType: "autoUpdate",
    //   includeAssets: ["favicon.ico", "icons/*.png"],
    //   manifest: {
    //     name: "DeenHabit – Islamic Habit Tracker",
    //     short_name: "DeenHabit",
    //     theme_color: "#10b981",
    //     background_color: "#0a0f0d",
    //     display: "standalone",
    //     icons: [
    //       { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    //       { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    //     ],
    //   },
    // }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
