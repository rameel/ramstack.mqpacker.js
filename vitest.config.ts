import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"]
    },
    resolve: {
        alias: {
            "@": join(dirname(fileURLToPath(import.meta.url)), "src")
        }
    }
});
