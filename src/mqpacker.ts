import type { AtRule, ChildNode, Comment, Container, Helpers, Node, PluginCreator, Root, Rule } from "postcss";
import { LayerTracker } from "@/layers";
import { normalize_query, resolve_comparer } from "@/queries";
import type { QueryComparer, SortOrder } from "@/queries";

export type { QueryComparer, SortOrder };

/**
 * Represents the options of the plugin.
 */
export interface Options {
    /**
     * Specifies the order of packed media queries.
     *
     * - `true` (default), `null` or `"mobile-first"` sorts queries by the lower width bound in ascending order.
     * - `false` keeps the order in which the queries first appear.
     * - `"desktop-first"` sorts queries by the upper width bound in descending order.
     * - A function compares two media query lists, like the `Array.prototype.sort` compare function.
     */
    sort?: boolean | SortOrder | QueryComparer | null;
}

const PLUGIN_NAME = "@ramstack/mqpacker";

/**
 * At-rules that only restrict where their content applies. A `@media` rule nested in them
 * can be moved out of them by swapping the nesting: `@supports (x) { @media (y) { ... } }`
 * is equivalent to `@media (y) { @supports (x) { ... } }`. The same applies to style rules.
 */
const TRANSPARENT_AT_RULES = new Set(["container", "scope", "starting-style", "supports"]);
const SOURCE_MAP_ANNOTATION = /^[#@]\s*sourceMappingURL=/;
const EMPTY_LINE = /\n\s*\n/;

/**
 * A container where media queries are packed: the stylesheet root, a `@layer` block,
 * or a `@media` rule for the media queries nested in it.
 */
type Context = Root | AtRule;

/**
 * A container a media query can be moved out of.
 */
type Wrapper = Rule | AtRule;

/**
 * A media query and the information collected about it before packing.
 */
interface Candidate {
    /**
     * The media query.
     */
    media: AtRule;

    /**
     * The query list as written in the stylesheet, used in warnings.
     */
    query: string;

    /**
     * The normalized query list that identifies the group of the media query.
     */
    key: string;

    /**
     * The reason the media query must stay in place to preserve the order of cascade layers, if any.
     */
    reason: string | undefined;

    /**
     * The comments that describe the media query, moved along with its content.
     */
    comments: Comment[];
}

/**
 * Creates the plugin that packs identical media queries into one `@media` rule
 * placed at the end of the enclosing context.
 *
 * @param options - The plugin options.
 * @returns The PostCSS plugin.
 */
const mqpacker: PluginCreator<Options> = (options?: Options) => {
    const compare = resolve_comparer(options?.sort);

    return {
        postcssPlugin: PLUGIN_NAME,
        OnceExit(root, helpers) {
            new Packer(root, helpers, compare).pack(root);
        }
    };
};

mqpacker.postcss = true;

export default mqpacker;

// Makes require() return the plugin itself instead of the module namespace
// (supported since Node.js 22.12).
export { mqpacker as "module.exports" };

/**
 * Represents a packer that groups identical media queries within each context
 * while preserving cascade layer order.
 */
class Packer {
    readonly #helpers: Helpers;
    readonly #compare: QueryComparer | undefined;
    readonly #layers: LayerTracker | undefined;

    /**
     * Maps the wrappers created by the packer to the original nodes they were cloned from.
     */
    readonly #origins = new WeakMap<Node, Node>();

    /**
     * Maps the media queries left in place to the reasons why they cannot be moved.
     */
    readonly #reasons = new WeakMap<Node, string>();

    /**
     * Initializes a packer and inspects cascade layer declarations before packing.
     *
     * @param root - The stylesheet root to inspect for cascade layer declarations.
     * @param helpers - The PostCSS helpers used to create nodes and report warnings.
     * @param compare - The comparer for packed media queries, or `undefined` to keep their order of first appearance.
     */
    constructor(root: Root, helpers: Helpers, compare: QueryComparer | undefined) {
        this.#helpers = helpers;
        this.#compare = compare;
        this.#layers = LayerTracker.create(root);
    }

    /**
     * Packs the media queries of the specified context, then of the nested contexts.
     *
     * @param context - The context to pack.
     */
    pack(context: Context): void {
        const candidates: Candidate[] = [];

        // Moving a media query brings the nodes before it next to the following one,
        // so the candidates are collected, with their comments, before any media query is moved.
        visit(context, media => {
            if (!is_media(media)) {
                return;
            }

            // Unlike the parser, PostCSS leaves the params of created at-rules undefined.
            const query = media.params ?? "";
            candidates.push({
                media,
                query,
                key: normalize_query(query),
                reason: this.#layers?.why_move_is_blocked(media),
                comments: get_leading_comments(media)
            });
        });

        // A media query that stays in place also holds the preceding ones with the same
        // query list in place: moving them past it would change the order of their rules.
        const last_blocked_at = new Map<string, number>();
        for (const [index, { key, reason }] of candidates.entries()) {
            if (reason) {
                last_blocked_at.set(key, index);
            }
        }

        const groups = new Map<string, AtRule>();
        const held = new Map<string, number>();

        for (const [index, candidate] of candidates.entries()) {
            const key = candidate.key;

            if (candidate.reason) {
                this.#leave_in_place(context, candidate, held.get(key) ?? 0);
                held.delete(key);
            }
            else if (index < (last_blocked_at.get(key) ?? -1)) {
                held.set(key, (held.get(key) ?? 0) + 1);
            }
            else {
                this.#add_to_group(context, groups, candidate);
            }
        }

        const list = [...groups.values()];
        const compare = this.#compare;

        if (compare) {
            // #create_at_rule gives each group an empty string for missing params.
            list.sort((a, b) => compare(a.params, b.params));
        }

        insert_packed_queries(context, list);
        visit(context, node => this.pack(node));
    }

    /**
     * Records why the media query stays in place and reports it.
     *
     * @param context - The context the media query belongs to.
     * @param candidate - The media query that cannot be moved.
     * @param held - The number of preceding media queries it holds in place.
     */
    #leave_in_place(context: Context, { media, query, reason }: Candidate, held: number): void {
        // A media query nested in the one left in place for the same reason
        // is not reported again: the warning for the outer one covers it.
        if (this.#reasons.get(context) !== reason) {
            media.warn(this.#helpers.result, `@media ${query} was left in place because ${reason}.${describe_held(held)}`);
        }

        this.#reasons.set(media, reason!);
    }

    /**
     * Moves the candidate into the group for its query list, creating the group on first use.
     */
    #add_to_group(context: Context, groups: Map<string, AtRule>, candidate: Candidate): void {
        const { media, key, comments } = candidate;
        let group = groups.get(key);
        if (!group) {
            group = this.#create_at_rule(media);

            // The group is placed at the nesting depth of the outermost wrapper
            // of the media query, so it takes the closing whitespace of that node.
            let top: Wrapper = media;
            while (top.parent !== context) {
                top = top.parent as Wrapper;
            }

            group.raws.after = top.raws.after;
            groups.set(key, group);
        }

        this.#move_into_group(media, comments, context, group);
    }

    /**
     * Moves the content of a media query into the group, preserving the wrappers
     * between the media query and the context: the media query in
     * `.a { @supports (x) { @media (y) { ... } } }` becomes
     * `@media (y) { .a { @supports (x) { ... } } }`.
     *
     * @param media - The media query to move.
     * @param comments - The comments that describe the media query, moved before its content.
     * @param context - The context the media query belongs to.
     * @param group - The `@media` rule that collects all media queries with the same query list.
     */
    #move_into_group(media: AtRule, comments: Comment[], context: Context, group: AtRule): void {
        const wrappers: Wrapper[] = [];

        // The wrappers of an empty media query are not copied, since the copies would stay empty.
        if (media.nodes?.length) {
            for (let node = media.parent as Container; node !== context; node = node.parent as Container) {
                wrappers.push(node as Wrapper);
            }
        }

        let target: Container = group;

        for (let i = wrappers.length - 1; i >= 0; i--) {
            const original = this.#origins.get(wrappers[i]) ?? wrappers[i];
            const last = target.last;

            // Adjacent pieces of the same original wrapper are merged back into one.
            if (last && this.#origins.get(last) === original) {
                target = last as Container;
            }
            else {
                // The copy is placed at the nesting depth of the next node in the chain,
                // so it takes the indentation of that node.
                const shell = this.#create_shell(wrappers[i]);
                copy_whitespace(shell, i > 0 ? wrappers[i - 1] : media, last === undefined);

                this.#origins.set(shell, original);
                target.append(shell);
                target = shell;
            }
        }

        const parent = media.parent as Container;

        if (media.nodes?.length) {
            // The comments take the indentation of the content they are placed before.
            const before = media.nodes[0].raws.before;
            for (const comment of comments) {
                comment.raws.before = before;
            }

            target.append([...comments, ...media.nodes]);
            target.raws.semicolon = media.raws.semicolon;
        }

        detach(media);
        prune(parent, context);
    }

    /**
     * Creates an empty copy of the specified wrapper.
     */
    #create_shell(node: Wrapper): Wrapper {
        if (node.type === "rule") {
            return new this.#helpers.Rule({
                selector: node.selector,
                source: node.source,
                raws: pick_raws(node, ["between", "selector"])
            });
        }

        return this.#create_at_rule(node);
    }

    /**
     * Creates an empty copy of the specified at-rule.
     */
    #create_at_rule(node: AtRule): AtRule {
        return new this.#helpers.AtRule({
            name: node.name,
            // The packed media queries are compared by params, so they must be strings.
            params: node.params ?? "",
            source: node.source,
            raws: pick_raws(node, ["afterName", "between", "params"]),
            nodes: []
        });
    }
}

/**
 * Visits the `@media` and `@layer` blocks of the container, descending only into
 * style rules and transparent at-rules. Other at-rules are left untouched since
 * their semantics is unknown.
 *
 * @param container - The container to visit.
 * @param callback - The function to call for each found block.
 */
function visit(container: Container, callback: (node: AtRule) => void): void {
    container.each(node => {
        if (node.type === "rule") {
            visit(node, callback);
        }
        else if (node.type === "atrule" && node.nodes) {
            let name = node.name.toLowerCase();
            if (name === "media" || name === "layer") {
                callback(node);
            }
            else if (TRANSPARENT_AT_RULES.has(name)) {
                visit(node, callback);
            }
        }
    });
}

/**
 * Appends the packed media queries to the end of the context, keeping
 * the source map annotation at the very end of the stylesheet.
 */
function insert_packed_queries(context: Context, nodes: AtRule[]): void {
    if (nodes.length === 0) {
        return;
    }

    const last = context.last;

    if (context.type === "root" && last?.type === "comment" && SOURCE_MAP_ANNOTATION.test(last.text)) {
        context.insertBefore(last, nodes);
    }
    else {
        context.append(nodes);
    }
}

/**
 * Removes the wrappers that became empty after their media queries were moved.
 */
function prune(node: Container, context: Context): void {
    while (node !== context && node.nodes?.length === 0) {
        const parent = node.parent as Container;
        detach(node as Wrapper);
        node = parent;
    }
}

/**
 * Removes the node from its parent, keeping the trailing semicolon
 * of the declaration that becomes the last one.
 */
function detach(node: ChildNode): void {
    const parent = node.parent as Container;
    const last = find_last(parent) === node;

    node.remove();

    // A declaration followed by another node always ends with a semicolon,
    // so keep it when the declaration becomes the last one.
    if (last && find_last(parent)?.type === "decl") {
        parent.raws.semicolon = true;
    }
}

/**
 * Returns the last child of the container, ignoring the trailing comments,
 * as PostCSS does when deciding whether to add the trailing semicolon.
 */
function find_last(container: Container): ChildNode | undefined {
    const nodes = container.nodes ?? [];

    for (let i = nodes.length - 1; i >= 0; i--) {
        if (nodes[i].type !== "comment") {
            return nodes[i];
        }
    }

    return undefined;
}

/**
 * Returns the comments right before the media query, which usually describe it.
 *
 * The search stops at a comment that is left in place:
 * - a comment followed by an empty line, which is likely a heading for more than the media query;
 * - a comment on the same line as the preceding node, which belongs to that node;
 * - a preserved comment (`/*! ... *\/`) or a source map annotation;
 * - an inline comment of SCSS or Less (`// ...`), since the content it would be placed before
 *   may start on the same line and become part of the comment.
 */
function get_leading_comments(media: AtRule): Comment[] {
    const comments: Comment[] = [];
    let next: ChildNode = media;
    let node = next.prev();

    while (node?.type === "comment" && !EMPTY_LINE.test(next.raws.before ?? "")) {
        const same_line = node.prev() !== undefined && !node.raws.before?.includes("\n");
        const inline = (node.raws as { inline?: boolean }).inline;

        if (same_line || inline || node.text.startsWith("!") || SOURCE_MAP_ANNOTATION.test(node.text)) {
            break;
        }

        comments.unshift(node);
        next = node;
        node = next.prev();
    }

    return comments;
}

/**
 * Copies the whitespace around the node to the wrapper copy.
 *
 * @param shell - The wrapper copy.
 * @param node - The node whose whitespace to copy.
 * @param first - Whether the copy is the first child of its parent,
 *   in which case leading empty lines are dropped.
 */
function copy_whitespace(shell: Wrapper, node: Wrapper, first: boolean): void {
    let before = node.raws.before;

    if (before !== undefined && first) {
        let index = before.lastIndexOf("\n");

        // Keep the whole line break when the CSS uses CRLF line endings.
        if (before[index - 1] === "\r") {
            index--;
        }

        if (index > 0) {
            before = before.slice(index);
        }
    }

    shell.raws.before = before;
    shell.raws.after = node.raws.after;
}

/**
 * Describes the media queries held in place by a media query that cannot be moved.
 *
 * @param count - The number of the held media queries.
 */
function describe_held(count: number): string {
    if (count === 0) {
        return "";
    }

    return count === 1
        ? " The preceding @media rule with the same query was also left in place to preserve the rule order."
        : ` The ${count} preceding @media rules with the same query were also left in place to preserve the rule order.`;
}

function is_media(node: AtRule): boolean {
    return node.name.toLowerCase() === "media";
}

function pick_raws(node: ChildNode, keys: string[]): Record<string, unknown> {
    const source = node.raws as Record<string, unknown>;
    const raws: Record<string, unknown> = {};

    for (const key of keys) {
        if (source[key] !== undefined) {
            raws[key] = source[key];
        }
    }

    return raws;
}
