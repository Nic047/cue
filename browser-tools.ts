/**
 * Generische Playwright-Tools für den Browser-Agenten.
 * Jedes Tool bildet genau eine Browser-Aktion ab; das Modell entscheidet pro
 * Aufgabe, welche Seite/Selektor/Reihenfolge. Quelle:
 * https://docs.getsolari.com/browser-api
 */
import { tool } from "ai";
import { type BrowserSession } from "@solarisdk/browser";
import { z } from "zod";
import type { Page } from "patchright-core";

export interface ToolContext {
  browser: BrowserSession;
  /** Aktuell aktive Seite. Tools mutieren dies bei new_tab. */
  page: Page;
  /** Setzt der Agent, um Tool-Aktivitäten sichtbar zu machen. */
  hooks?: {
    onToolDone?: (tool: string, ok: boolean, target?: string) => void;
  };
}

const TOOL_TIMEOUT_MS = 90_000;

/** Ein Browser-Aufruf, der nach TOOL_TIMEOUT_MS hart abbricht (falls möglich). */
async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(label + " timeout")),
          TOOL_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function result(ok: boolean, data: Record<string, unknown> = {}) {
  return { ok, ...data };
}

export function buildBrowserTools(ctx: ToolContext) {
  async function run<T extends { ok: boolean }>(
    name: string,
    fn: () => Promise<T>,
    target?: string,
  ): Promise<T> {
    try {
      const value = await withTimeout(fn(), name);
      ctx.hooks?.onToolDone?.(name, value.ok, target);
      return value;
    } catch (err) {
      ctx.hooks?.onToolDone?.(name, false, target);
      throw err;
    }
  }

  return {
    navigate: tool({
      description:
        "Navigiere die aktuelle Seite zu einer URL. Nutze das für den ersten " +
        "Schritt jeder Aufgabe und für jeden weiteren Seitenwechsel.",
      inputSchema: z.object({
        url: z.string().describe("Vollständige URL inkl. https://"),
        waitUntil: z
          .enum(["load", "domcontentloaded", "networkidle"])
          .default("domcontentloaded")
          .describe(
            "domcontentloaded reicht für die meisten Fälle und ist schneller. " +
              "networkidle nur bei SPAs verwenden.",
          ),
      }),
      execute: async ({ url, waitUntil }) =>
        run("navigate", async () => {
          // Erstversuch wie angefragt, danach ein Retry mit großzügigerem
          // Timeout, BEVOR das Modell auf eine andere Quelle ausweicht.
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
        }, url).catch((err) => {
          // Fehler NICHT werfen: als strukturiertes Ergebnis ans Modell
          // melden, damit der Loop weiterlaufen kann.
          return {
            ok: false,
            error: String(err),
            note:
              "URL nach zwei Versuchen nicht erreichbar. Melde das als " +
              "'nicht abrufbar' für diese Quelle — nutze KEINEN Wert von " +
              "einer anderen Seite als Ersatz.",
          };
        }),
    }),

    scroll: tool({
      description:
        "Scrollt die Seite, um zu Inhalten weiter unten zu gelangen, bevor " +
        "du read_page erneut aufrufst.",
      inputSchema: z.object({
        direction: z.enum(["down", "up", "top", "bottom"]).default("down"),
        amount: z
          .number()
          .default(800)
          .describe("Pixel pro Scroll-Schritt bei down/up."),
      }),
      execute: async ({ direction, amount }) =>
        run("scroll", async () => {
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
        }, direction)
          .catch((err) => result(false, { error: String(err) })),
    }),

    wait: tool({
      description:
        "Warte eine kurze Zeit (nicht schlafen, sondern Geduld). Nutze das bei " +
        "Bot-Checks (CAPTCHA/PerimeterX/Cloudflare), die sich von selbst " +
        "aufloesen, oder bei Seiten, die per JS nachladen. Danach IMMER " +
        "read_page erneut aufrufen.",
      inputSchema: z.object({
        ms: z.number().default(5000).describe("Wartezeit in Millisekunden."),
      }),
      execute: async ({ ms }) => {
        await ctx.page.waitForTimeout(Math.min(ms, 30_000));
        return { ok: true, waitedMs: ms, url: ctx.page.url() };
      },
    }),

    read_page: tool({
      description:
        "Lies die aktuelle Seite: sichtbaren Text und alle Links. Rufe das " +
        "IMMER nach navigate() auf, bevor du klickst oder tippst. Wenn " +
        "'truncated: true' kommt und das Gesuchte fehlt: scroll + erneut lesen.",
      inputSchema: z.object({
        maxChars: z.number().default(8000).describe("Max Zeichen."),
        offset: z.number().default(0).describe("Zeichen-Index."),
        waitForNetworkIdle: z
          .boolean()
          .default(true)
          .describe(
            "Kurz auf Netzwerk-Ruhe warten. Bei chatty Seiten auf false.",
          ),
      }),
      execute: async ({ maxChars, offset, waitForNetworkIdle }) =>
        run("read_page", async () => {
          if (waitForNetworkIdle) {
            try {
              await ctx.page.waitForLoadState("networkidle", {
                timeout: 2500,
              });
            } catch {
              // Timeout ist hier kein Fehler — einfach lesen, was da ist.
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
        }, await ctx.page.title().catch(() => ""))
          .catch((err) =>
            result(false, { error: String(err), url: ctx.page.url() }),
          ),
    }),

    click: tool({
      description:
        "Klicke ein Element. Bevorzuge role-basierte oder Text-Selektoren " +
        "(z.B. 'text=Weiter') gegenüber generischen CSS-Klassen.",
      inputSchema: z.object({
        selector: z.string().describe("Playwright-Selector-String"),
        timeoutMs: z.number().default(5000),
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
        "Schreibe Text in ein Eingabefeld (ersetzt vorhandenen Inhalt).",
      inputSchema: z.object({
        selector: z.string(),
        text: z.string(),
        pressEnter: z
          .boolean()
          .default(false)
          .describe("Enter danach drücken, z.B. um eine Suche abzuschicken."),
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
        "Screenshot der sichtbaren Seite als Base64-JPEG. Nur nutzen, wenn " +
        "read_page nicht reicht (Canvas-UIs, Karten). Kostet mehr Tokens.",
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
            return { ok: true, image: buf.toString("base64"), mediaType: "image/jpeg" };
          },
          fullPage ? "fullPage" : "viewport",
        ).catch((err) => result(false, { error: String(err) })),
    }),

    evaluate_js: tool({
      description:
        "Führe einen JS-Ausdruck in der Seite aus und gib das Ergebnis " +
        "zurück. Für strukturierte Extraktion, die über einfaches Lesen " +
        "hinausgeht.",
      inputSchema: z.object({
        expression: z
          .string()
          .describe(
            "JS-Funktionskörper als String, z.B. 'return document.title'",
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
        "Öffne einen neuen Tab und wechsle zu ihm. Nützlich, um mehrere " +
        "Websites parallel offen zu halten.",
      inputSchema: z.object({ url: z.string().optional() }),
      execute: async ({ url }) =>
        run(
          "new_tab",
          async () => {
            const context = ctx.browser.contexts()[0];
            const newPage = await context.newPage();
            if (url)
              await newPage.goto(url, { waitUntil: "domcontentloaded" });
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
