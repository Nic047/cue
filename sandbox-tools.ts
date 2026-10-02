/**
 * Generische Sandbox-Tools für den Agenten.
 * Läuft auf @solarisdk/sandbox (microVM, snapshot-basiert).
 *
 * WICHTIG (Doku: https://docs.getsolari.com/sandboxes):
 * - commands.run(cmd, { args }) ist NICHT shell-interpretiert.
 *   Für Shell-Syntax (Pipes, &&, Globbing) explizit run_shell (sh -c) nutzen.
 * - kill(), nicht close(), beendet die VM.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import type { Sandbox } from "@solarisdk/core";

export interface SandboxToolContext {
  sandbox: Sandbox;
  onExport?: (name: string, url: string) => void;
  onPreview?: (url: string, expiresAt: string) => void;
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
    run_command: tool({
      description:
        "Führe eine einzelne Binary mit Argumenten aus (NICHT shell-interpretiert). " +
        "Für Shell-Syntax nutze run_shell. For persistent servers use background=true; never shell &.",
      inputSchema: z.object({
        command: z.string().describe("Name der Binary, z.B. 'python3' oder 'pip'"),
        background: z.boolean().default(false).describe("Start a persistent server without waiting for exit; verify it with expose_port."),
        args: z
          .array(z.string())
          .default([])
          .describe("Argumente als Array, z.B. ['install', 'requests']"),
      }),
      execute: async ({ command, args, background }) =>
        run(
          "run_command",
          async () => {
            if (background) {
              const process = await ctx.sandbox.commands.start(command, { args });
              void process.wait().catch(() => {});
              return { ok: true, cmdId: process.cmdId, status: "started", note: "Process started; use expose_port to verify readiness." };
            }
            const proc = await ctx.sandbox.commands.run(command, { args });
            return {
              ok: proc.exitCode === 0,
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
              ok: proc.exitCode === 0,
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
            const proc = await ctx.sandbox.commands.run("ls", {
              args: ["-la", "--", path],
            });
            return { ok: proc.exitCode === 0, stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
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

    export_file: tool({
      description: "Download a finished file to the user’s Mac BEFORE ending the sandbox. Use for every requested deliverable. Return the download link in your answer.",
      inputSchema: z.object({ path: z.string().min(1) }),
      execute: async ({ path }) => run("export_file", async () => {
        const data = await ctx.sandbox.files.download(path);
        const name = basename(path).replace(/[^a-zA-Z0-9._-]/g, "_") || "download";
        const id = randomUUID() + "-" + name;
        const directory = join(homedir(), "Downloads", "Cue");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, id), data, { flag: "wx" });
        const url = "cue-file:" + id;
        ctx.onExport?.(name, url);
        return { ok: true, name, url };
      }, path).catch((err) => result(false, { error: String(err) })),
    }),

    expose_port: tool({
      description:
        "Mache einen laufenden Server (z.B. auf Port 3000) über eine öffentliche " +
        "Preview-URL erreichbar. Nutze das, nachdem du einen Server/Dienst gestartet hast.",
      inputSchema: z.object({ port: z.number().int().min(1).max(65535) }),
      execute: async ({ port }) =>
        run(
          "expose_port",
          async () => {
            const ready = await ctx.sandbox.commands.run("python3", { args: ["-c",
              "import socket,time,sys\nfor _ in range(40):\n try:\n  socket.create_connection(('127.0.0.1'," + port + "),timeout=0.25).close(); sys.exit(0)\n except OSError: time.sleep(0.25)\nsys.exit(1)"
            ] });
            if (ready.exitCode !== 0) return { ok: false, error: "Server is not listening on port " + port };
            const preview = await ctx.sandbox.previewUrl(port);
            const { expiresAt } = await ctx.sandbox.setTimeout(10 * 60_000);
            ctx.onPreview?.(preview.url, expiresAt);
            return { ok: true, previewUrl: preview.url, token: preview.token, expiresAt };
          },
          `:${port}`,
        ).catch((err) => result(false, { error: String(err) })),
    }),
  };
}
