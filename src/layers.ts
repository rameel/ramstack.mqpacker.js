import type { AtRule, Node, Root } from "postcss";

const COMMENTS = /\/\*[\s\S]*?\*\//g;
const IMPORT_LAYER = /\blayer\(([^)]*)\)([\s\S]*)$/i;

// The tracker generates anonymous layer IDs with a NUL prefix
// to distinguish them from CSS layer names.
const ANONYMOUS_SEGMENT = /\0\d+/g;

/**
 * Represents the cascade layer declarations of a stylesheet.
 *
 * Cascade layers are ordered by their first declaration, so moving a media query
 * that declares a layer can change the layer order. The tracker allows moving such
 * a media query only if all the layers it declares have already been declared
 * unconditionally before it, for example with an `@layer a, b, c;` statement.
 */
export class LayerTracker {
    readonly #positions = new Map<Node, number>();
    readonly #declarations = new Map<string, number>();
    readonly #anonymous = new Map<Node, string>();

    private constructor(root: Root) {
        let position = 0;

        root.walk(node => {
            position++;

            if (node.type !== "atrule") {
                return;
            }

            let name = node.name.toLowerCase();
            if (name === "media") {
                this.#positions.set(node, position);
            }
            else if ((name === "layer" || name === "import") && is_unconditional(node)) {
                for (let layer of this.#get_names(node)?.flat() ?? []) {
                    if (!this.#declarations.has(layer)) {
                        this.#declarations.set(layer, position);
                    }
                }
            }
        });
    }

    /**
     * Creates a tracker for the specified stylesheet.
     *
     * @param root - The stylesheet root.
     * @returns The tracker, or `undefined` if the stylesheet has no cascade layers.
     */
    static create(root: Root): LayerTracker | undefined {
        let found = false;

        // The constructor may visit these nodes again. Benchmarks showed that even a full
        // preliminary scan adds little overhead compared with parsing.
        root.walkAtRules(node => {
            if (node.name.toLowerCase() === "layer") {
                found = true;
                return false;
            }
        });

        return found ? new LayerTracker(root) : undefined;
    }

    /**
     * Explains why the specified media query must stay in place
     * to preserve the order of cascade layers.
     *
     * @param media - The `@media` rule from the original stylesheet.
     * @returns A reason suitable for a warning, or `undefined` if the media query can be moved.
     */
    why_move_is_blocked(media: AtRule): string | undefined {
        const position = this.#positions.get(media) ?? 0;
        let reason: string | undefined;

        media.walkAtRules(node => {
            if (node.name.toLowerCase() !== "layer") {
                return;
            }

            const names = this.#get_names(node);
            if (!names) {
                reason = "it contains an anonymous cascade layer";
                return false;
            }

            for (const layers of names) {
                const undeclared = layers.some(layer => {
                    let declared = this.#declarations.get(layer);
                    return declared === undefined || declared > position;
                });

                if (undeclared) {
                    // The full name is reported, since declaring it also declares the enclosing layers.
                    const name = layers[layers.length - 1];
                    const display = name.replace(ANONYMOUS_SEGMENT, "<anonymous>");

                    reason = `it declares the cascade layer "${display}", which is not declared before it. ` +
                             `Declare the layer order upfront ${suggest_declaration(name)} to allow packing`;

                    return false;
                }
            }
        });

        return reason;
    }

    /**
     * Returns the fully qualified names of the layers declared by the specified node,
     * grouped by the declared name: `@layer a, b.c;` returns `[["a"], ["b", "b.c"]]`.
     *
     * @param node - The `@layer` or `@import` rule.
     * @returns The layer names, or `undefined` for an anonymous layer block.
     */
    #get_names(node: AtRule): string[][] | undefined {
        if (node.name.toLowerCase() === "import") {
            // A conditional import declares the layer only if its conditions match.
            let match = IMPORT_LAYER.exec(node.params);
            return match && !match[2].trim() ? [expand_layer_name([], match[1])] : [];
        }

        const params = get_params(node);
        if (node.nodes && !params) {
            return undefined;
        }

        const prefix = this.#get_prefix(node);
        return params.split(",").map(name => expand_layer_name(prefix, name));
    }

    /**
     * Returns the name segments of the layers that enclose the specified node.
     */
    #get_prefix(node: Node): string[] {
        const prefix: string[] = [];

        for (let parent = node.parent; parent; parent = parent.parent) {
            if (parent.type === "atrule" && is_layer_block(parent as AtRule)) {
                const params = get_params(parent as AtRule);
                prefix.unshift(...(params ? split_name(params) : [this.#get_anonymous_id(parent)]));
            }
        }

        return prefix;
    }

    /**
     * Returns the ID of an anonymous layer node, assigning one on first use.
     */
    #get_anonymous_id(node: Node): string {
        let id = this.#anonymous.get(node);
        if (!id) {
            id = `\0${this.#anonymous.size}`;
            this.#anonymous.set(node, id);
        }

        return id;
    }
}

/**
 * Suggests a declaration of the layer that allows packing. A layer nested in an anonymous
 * layer can be declared only inside it, by the name relative to it.
 *
 * @param name - The fully qualified name of the layer.
 */
function suggest_declaration(name: string): string {
    let anonymous = name.lastIndexOf("\0");
    if (anonymous < 0) {
        return `(e.g. "@layer ${name};")`;
    }

    let relative = name.slice(name.indexOf(".", anonymous) + 1);
    return `in the nearest enclosing anonymous layer (e.g. "@layer ${relative};")`;
}

/**
 * Determines whether the layer declaration takes effect regardless of any condition,
 * i.e. it is not nested in conditional rules such as `@media` or `@supports`.
 */
function is_unconditional(node: Node): boolean {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (parent.type === "root"
            || parent.type === "document"
            || parent.type === "rule") {
            continue;
        }

        if (parent.type !== "atrule"
            || !is_layer_block(parent as AtRule)) {
            return false;
        }
    }

    return true;
}

/**
 * Returns the params of the at-rule without comments.
 */
function get_params(node: AtRule): string {
    // Unlike the parser, PostCSS leaves the params of created at-rules undefined.
    return (node.params ?? "").replace(COMMENTS, "").trim();
}

/**
 * Determines whether the at-rule is the block form of `@layer`.
 */
function is_layer_block(node: AtRule): boolean {
    return node.nodes !== undefined && node.name.toLowerCase() === "layer";
}

/**
 * Expands a dotted layer name into the names of all the layers it declares:
 * `a.b` declares both `a` and `a.b`.
 */
function expand_layer_name(prefix: string[], name: string): string[] {
    const segments = split_name(name);
    const names: string[] = [];

    for (let i = 1; i <= segments.length; i++) {
        names.push([...prefix, ...segments.slice(0, i)].join("."));
    }

    return names;
}

/**
 * Removes comments and splits a dotted layer name into trimmed, nonempty segments.
 */
function split_name(name: string): string[] {
    return name
        .replace(COMMENTS, "")
        .split(".")
        .map(segment => segment.trim())
        .filter(segment => segment.length > 0);
}
