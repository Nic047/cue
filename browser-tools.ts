import {
  waitWithTimeout,
  WaitTimeoutError,
} from "./shared/wait-with-timeout.js";
/** Remote Playwright tools. See https://docs.getsolari.com/browser-api. */
import { tool } from "ai";
import { type BrowserSession } from "@solarisdk/browser";
import { z } from "zod";
import type { Page } from "patchright-core";

export interface ToolContext {
  browser: BrowserSession;
  /** Active page; new_tab updates it. */
  page: Page;
  /** Optional UI progress callback. */
  hooks?: {
    onToolDone?: (tool: string, ok: boolean, target?: string) => void;
  };
}

const TOOL_TIMEOUT_MS = 90_000;

function validateNavigationUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP(S) URL without embedded credentials.');
  }
}

function result(ok: boolean, data: Record<string, unknown> = {}) {
  return { ok, ...data };
}

export function buildBrowserTools(ctx: ToolContext) {
  let expired = false;

  async function run<T extends { ok: boolean }>(
    name: string,
    fn: () => Promise<T>,
    target?: string,
  ): Promise<T> {
    if (expired) throw new Error("Session stopped after a tool timeout");
    try {
      const value = await waitWithTimeout(fn(), TOOL_TIMEOUT_MS, name);
      ctx.hooks?.onToolDone?.(name, value.ok, target);
      return value;
    } catch (err) {
      if (err instanceof WaitTimeoutError) {
        expired = true;
        // End the session so timed-out operations cannot overlap subsequent tools.
        await waitWithTimeout(
          ctx.browser.close(),
          5_000,
          "tool-timeout cleanup",
        ).catch(() => {});
      }
      ctx.hooks?.onToolDone?.(name, false, target);
      throw err;
    }
  }

  return {
    navigate: tool({
      description:
        "Navigate the active page to a URL. Use for the first " +
        "step of each task and subsequent page navigation.",
      inputSchema: z.object({
        url: z.string().describe("Full URL including https://"),
        waitUntil: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .default("domcontentloaded")
          .describe(
            "domcontentloaded is usually sufficient and faster. " +
              "Use networkidle only for single-page apps.",
          ),
      }),
      execute: async ({ url, waitUntil }) =>
        run(
          "navigate",
          async () => {
            validateNavigationUrl(url);
            // Retry the same source with a longer timeout before reporting failure.
            try {
              await ctx.page.goto(url, { waitUntil, timeout: 20_000 });
            } catch {
              await ctx.page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 30_000,
              });
            }
            return {
              ok: true,
              url: ctx.page.url(),
              title: await ctx.page.title(),
            };
          },
          url,
        ).catch((err) => {
          // Return structured errors so the model can recover.
          return {
            ok: false,
            error: String(err),
            note:
              "URL unavailable after two attempts. Report " +
              "this source as unavailable; do NOT substitute a value from " +
              "another website.",
          };
        }),
    }),

    scroll: tool({
      description:
        "Scroll to content farther down the page before " +
        "calling read_page again.",
      inputSchema: z.object({
        direction: z.enum(["down", "up", "top", "bottom"]).default("down"),
        amount: z
          .number()
          .default(800)
          .describe("Pixels per down/up scroll."),
      }),
      execute: async ({ direction, amount }) =>
        run(
          "scroll",
          async () => {
            if (direction === "top") {
              await ctx.page.evaluate(() => window.scrollTo(0, 0));
            } else if (direction === "bottom") {
              await ctx.page.evaluate(() =>
                window.scrollTo(0, document.body.scrollHeight),
              );
            } else {
              const delta = direction === "down" ? amount : -amount;
              await ctx.page.mouse.wheel(0, delta);
            }
            await ctx.page.waitForTimeout(300);
            const scrollY = await ctx.page.evaluate(() => window.scrollY);
            return { ok: true, scrollY };
          },
          direction,
        ).catch((err) => result(false, { error: String(err) })),
    }),

    wait: tool({
      description:
        "Wait briefly for " +
        "browser challenges (CAPTCHA/PerimeterX/Cloudflare) that may " +
        "resolve automatically, or dynamically loading pages. ALWAYS " +
        "call read_page afterward.",
      inputSchema: z.object({
        ms: z.number().int().min(0).max(30_000).default(5000).describe("Wait duration in milliseconds."),
      }),
      execute: async ({ ms }) => {
        await ctx.page.waitForTimeout(Math.min(ms, 30_000));
        return { ok: true, waitedMs: ms, url: ctx.page.url() };
      },
    }),

    read_page: tool({
      description:
        "Read the active page's visible text and links. " +
        "ALWAYS call after navigate(), before clicking or typing. If " +
        "truncated=true and requested information is missing, scroll and read again.",
      inputSchema: z.object({
        maxChars: z.number().int().min(1).max(50_000).default(8000).describe("Max characters."),
        offset: z.number().int().min(0).default(0).describe("Character offset."),
        waitForNetworkIdle: z
          .boolean()
          .default(true)
          .describe(
            "Briefly wait for network idle; use false on constantly active pages.",
          ),
      }),
      execute: async ({ maxChars, offset, waitForNetworkIdle }) =>
        run(
          "read_page",
          async () => {
            if (waitForNetworkIdle) {
              try {
                await ctx.page.waitForLoadState("networkidle", {
                  timeout: 2500,
                });
              } catch {
                // Read available content even if network idle times out.
              }
            }
            const fullText = await ctx.page.locator("body").innerText();
            const links = await ctx.page
              .locator("a")
              .evaluateAll((els: HTMLElement[]) =>
                els
                  .map((a) => ({
                    text: a.textContent?.trim() ?? "",
                    href: (a as HTMLAnchorElement).href,
                  }))
                  .filter((l) => l.text.length > 0),
              );
            const slice = fullText.slice(offset, offset + maxChars);
            return {
              ok: true,
              url: ctx.page.url(),
              text: slice,
              totalLength: fullText.length,
              offset,
              truncated: offset + maxChars < fullText.length,
              links: links.slice(0, 100),
            };
          },
          await ctx.page.title().catch(() => ""),
        ).catch((err) =>
          result(false, { error: String(err), url: ctx.page.url() }),
        ),
    }),

    click: tool({
      description:
        "Click an element. Prefer role or text selectors " +
        "(for example 'text=Next') over generic CSS classes.",
      inputSchema: z.object({
        selector: z.string().describe("Playwright selector string"),
        timeoutMs: z.number().int().min(1).max(30_000).default(5000),
      }),
      execute: async ({ selector, timeoutMs }) =>
        run(
          "click",
          async () => {
            await ctx.page
              .locator(selector)
              .first()
              .click({ timeout: timeoutMs });
            return { ok: true, url: ctx.page.url() };
          },
          selector,
        ).catch((err) => result(false, { error: String(err) })),
    }),

    type_text: tool({
      description:
        "Fill an input field, replacing its existing value.",
      inputSchema: z.object({
        selector: z.string(),
        text: z.string(),
        pressEnter: z
          .boolean()
          .default(false)
          .describe("Press Enter afterward, for example to submit a public search."),
      }),
      execute: async ({ selector, text, pressEnter }) =>
        run(
          "type_text",
          async () => {
            const locator = ctx.page.locator(selector).first();
            await locator.fill(text);
            if (pressEnter) await locator.press("Enter");
            return { ok: true };
          },
          selector,
        ).catch((err) => result(false, { error: String(err) })),
    }),

    screenshot: tool({
      description:
        "Capture the page as a base64 JPEG. Use only when " +
        "read_page is insufficient (canvas interfaces, maps). Uses more tokens.",
      inputSchema: z.object({ fullPage: z.boolean().default(false) }),
      execute: async ({ fullPage }) =>
        run(
          "screenshot",
          async () => {
            const buf = await ctx.page.screenshot({
              fullPage,
              type: "jpeg",
              quality: 70,
            });
            return {
              ok: true,
              image: buf.toString("base64"),
              mediaType: "image/jpeg",
            };
          },
          fullPage ? "fullPage" : "viewport",
        ).catch((err) => result(false, { error: String(err) })),
    }),

    evaluate_js: tool({
      description:
        "Evaluate JavaScript inside the remote page and return " +
        "the result for structured extraction beyond " +
        "simple reading.",
      inputSchema: z.object({
        expression: z
          .string()
          .describe(
            "JavaScript function body, for example 'return document.title'",
          ),
      }),
      execute: async ({ expression }) =>
        run(
          "evaluate_js",
          async () => {
            const value = await ctx.page.evaluate(
              new Function(expression) as any,
            );
            return { ok: true, result: value };
          },
          expression.slice(0, 60),
        ).catch((err) => result(false, { error: String(err) })),
    }),

    new_tab: tool({
      description:
        "Open a new active tab to keep multiple " +
        "websites open at once.",
      inputSchema: z.object({ url: z.string().optional() }),
      execute: async ({ url }) =>
        run(
          "new_tab",
          async () => {
            if (url !== undefined) validateNavigationUrl(url);
            const context = ctx.browser.contexts()[0];
            const newPage = await waitWithTimeout(
              context.newPage(),
              TOOL_TIMEOUT_MS,
              "new_tab",
              (page) => page.close(),
            );
            if (expired) {
              await newPage.close();
              throw new Error("Session expired");
            }
            if (url) await newPage.goto(url, { waitUntil: "domcontentloaded" });
            if (expired) {
              await newPage.close();
              throw new Error("Session expired");
            }
            ctx.page = newPage;
            return {
              ok: true,
              url: newPage.url(),
              openTabs: context.pages().length,
            };
          },
          url,
        ).catch((err) => result(false, { error: String(err) })),
    }),
  };
}
