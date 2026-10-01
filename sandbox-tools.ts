/**
 * Generische Sandbox-Tools für den Agenten.
 * Läuft auf @solarisdk/sandbox (microVM, snapshot-basiert).
 *
 * WICHTIG (Doku: https://docs.getsolari.com/sandboxes):
 * - commands.run(cmd, { args }) ist NICHT shell-interpretiert.
 *   Für Shell-Syntax (Pipes, &&, Globbing) explizit run_shell (sh -c) nutzen.
 * - kill(), nicht close(), beendet die VM.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Sandbox } from "@solarisdk/core";

export interface SandboxToolContext {
  sandbox: Sandbox;
  hooks?: {
    onToolDone?: (tool: string, ok: boolean, target?: string) => void;
  };
}

const TOOL_TIMEOUT_MS = 60_000;

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(label + " timeout " + TOOL_TIMEOUT_MS + "ms")),
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

export function buildSandboxTools(ctx: SandboxToolContext) {
  async function run<T>(
    name: string,
    fn: () => Promise<T>,
    target?: string,
  ): Promise<T> {
    try {
      const value = await withTimeout(fn(), name);
      ctx.hooks?.onToolDone?.(name, true, target);
      return value;
    } catch (err) {
      ctx.hooks?.onToolDone?.(name, false, target);
      throw err;
    }
  }

  return {
    run_command: tool({
      description:
        "Führe eine einzelne Binary mit Argumenten aus (NICHT shell-interpretiert). " +
        "Für Shell-Syntax (Pipes, &&, Globbing, Env-Expansion) nutze run_shell.",
      inputSchema: z.object({
        command: z.string().describe("Name der Binary, z.B. 'python3' oder 'pip'"),
        args: z
          .array(z.string())
          .default([])
          .describe("Argumente als Array, z.B. ['install', 'requests']"),
      }),
      execute: async ({ command, args }) =>
        run(
          "run_command",
          async () => {
            const proc = await ctx.sandbox.commands.run(command, { args });
            return {
              ok: true,
              stdout: proc.stdout,
              stderr: proc.stderr,
              exitCode: proc.exitCode,
            };
          },
          [command, ...args].join(" "),
        ).catch((err) => result(false, { error: String(err) })),
    }),

    run_shell: tool({
      description:
        "Führe einen Shell-Befehl aus (Pipes, &&, Globbing erlaubt). " +
        "Läuft intern über 'sh -c <command>'.",
      inputSchema: z.object({
        command: z.string().describe("Vollständiger Shell-Befehl als String"),
      }),
      execute: async ({ command }) =>
        run(
          "run_shell",
          async () => {
            const proc = await ctx.sandbox.commands.run("sh", {
              args: ["-c", command],
            });
            return {
              ok: true,
              stdout: proc.stdout,
              stderr: proc.stderr,
              exitCode: proc.exitCode,
            };
          },
          command.slice(0, 80),
        ).catch((err) => result(false, { error: String(err) })),
    }),

    write_file: tool({
      description:
        "Schreibe Text in eine Datei in der Sandbox (überschreibt, falls sie existiert).",
      inputSchema: z.object({
        path: z.string().describe("Absoluter oder relativer Pfad in der Sandbox"),
        content: z.string(),
      }),
      execute: async ({ path, content }) =>
        run(
          "write_file",
          async () => {
            await ctx.sandbox.files.write(path, content);
            return { ok: true, path };
          },
          path,
        ).catch((err) => result(false, { error: String(err) })),
    }),

    read_file: tool({
      description: "Lies den Inhalt einer Datei aus der Sandbox.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) =>
        run(
          "read_file",
          async () => {
            const content = await ctx.sandbox.files.readText(path);
            return { ok: true, path, content };
          },
          path,
        ).catch((err) => result(false, { error: String(err) })),
    }),

    list_dir: tool({
      description: "Liste Dateien/Ordner in einem Verzeichnis der Sandbox auf.",
      inputSchema: z.object({ path: z.string().default(".") }),
      execute: async ({ path }) =>
        run(
          "list_dir",
          async () => {
            const proc = await ctx.sandbox.commands.run("sh", {
              args: ["-c", "ls -la " + path],
            });
            return { ok: true, stdout: proc.stdout, stderr: proc.stderr };
          },
          path,
        ).catch((err) => result(false, { error: String(err) })),
    }),

    install_package: tool({
      description:
        "Installiere ein Paket (pip oder npm, je nach 'manager'). Nutze das " +
        "VOR dem ersten Ausführen von Code, der externe Pakete importiert.",
      inputSchema: z.object({
        manager: z.enum(["pip", "npm"]),
        packageName: z.string(),
      }),
      execute: async ({ manager, packageName }) =>
        run(
          "install_package",
          async () => {
            const cmd = manager === "pip" ? "pip" : "npm";
            const args =
              manager === "pip"
                ? ["install", packageName]
                : ["install", "-g", packageName];
            const proc = await ctx.sandbox.commands.run(cmd, { args });
            return {
              ok: proc.exitCode === 0,
              stdout: proc.stdout,
              stderr: proc.stderr,
              exitCode: proc.exitCode,
            };
          },
          `${manager} install ${packageName}`,
        ).catch((err) => result(false, { error: String(err) })),
    }),

    expose_port: tool({
      description:
        "Mache einen laufenden Server (z.B. auf Port 3000) über eine öffentliche " +
        "Preview-URL erreichbar. Nutze das, nachdem du einen Server/Dienst gestartet hast.",
      inputSchema: z.object({ port: z.number() }),
      execute: async ({ port }) =>
        run(
          "expose_port",
          async () => {
            const preview = await ctx.sandbox.previewUrl(port);
            return { ok: true, previewUrl: preview.url, token: preview.token };
          },
          `:${port}`,
        ).catch((err) => result(false, { error: String(err) })),
    }),
  };
}
