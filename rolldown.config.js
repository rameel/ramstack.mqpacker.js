import { isAbsolute } from "node:path";
import { dts } from "rolldown-plugin-dts";

export default [{
    input: "src/mqpacker.ts",
    platform: "node",
    external(id) {
        // Besides import specifiers, rolldown passes the resolved paths of bundled
        // modules, which are absolute paths of the current platform (C:\... on Windows).
        const is_internal = id.startsWith("@/")
            || id.startsWith(".")
            || isAbsolute(id);
        return !is_internal;
    },
    resolve: {
        alias: {
            "@": "./src"
        }
    },
    output: [{
        dir: "dist",
        format: "esm",
        cleanDir: true
    }],
    plugins: [
        dts()
    ]
}];
