import {
  waitWithTimeout,
  WaitTimeoutError,
} from "./shared/wait-with-timeout.js";
/** Remote sandbox tools. commands.run uses literal arguments; run_shell explicitly uses sh -c. Stop VMs with kill(). See https://docs.getsolari.com/sandboxes. */
import { mkdir, writeFile, rm } from "node:fs/promises";
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

function result(ok: boolean, data: Record<string, unknown> = {}) {
  return { ok, ...data };
}

export function buildSandboxTools(ctx: SandboxToolContext) {
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
          ctx.sandbox.kill(),
          5_000,
          "tool-timeout cleanup",
        ).catch(() => {});
      }
      ctx.hooks?.onToolDone?.(name, false, target);
      throw err;
    }
  }

  return {
    run_command: tool({
      description:
        "Run a binary with arguments WITHOUT shell interpretation. " +
        "Use run_shell for shell syntax. For persistent servers use background=true; never shell &.",
      inputSchema: z.object({
        command: z
          .string()
          .describe("Binary name, such as 'python3' or 'pip'"),
        background: z
          .boolean()
          .default(false)
          .describe(
            "Start a persistent server without waiting for exit; verify it with expose_port.",
          ),
        args: z
          .array(z.string())
          .default([])
          .describe("Argument array, such as ['install', 'requests']"),
      }),
      execute: async ({ command, args, background }) =>
        run(
          "run_command",
          async () => {
            if (background) {
              const process = await ctx.sandbox.commands.start(command, {
                args,
              });
              void process.wait().catch(() => {});
              return {
                ok: true,
                cmdId: process.cmdId,
                status: "started",
                note: "Process started; use expose_port to verify readiness.",
              };
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
        "Run a shell command (pipes, &&, and globbing allowed). " +
        "Uses 'sh -c <command>' inside the sandbox.",
      inputSchema: z.object({
        command: z.string().describe("Complete shell command string"),
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
        "Write a text file inside the sandbox, replacing existing contents.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Absolute or relative sandbox path"),
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
      description: "Read a sandbox file.",
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
      description: "List a sandbox directory.",
      inputSchema: z.object({ path: z.string().default(".") }),
      execute: async ({ path }) =>
        run(
          "list_dir",
          async () => {
            const proc = await ctx.sandbox.commands.run("ls", {
              args: ["-la", "--", path],
            });
            return {
              ok: proc.exitCode === 0,
              stdout: proc.stdout,
              stderr: proc.stderr,
              exitCode: proc.exitCode,
            };
          },
          path,
        ).catch((err) => result(false, { error: String(err) })),
    }),

    install_package: tool({
      description:
        "Install a pip or npm package using the selected manager. Do this " +
        "BEFORE running code that imports external packages.",
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
      description:
        "Download a finished file to the user’s Mac BEFORE ending the sandbox. Use for every requested deliverable. Return the download link in your answer.",
      inputSchema: z.object({ path: z.string().min(1) }),
      execute: async ({ path }) =>
        run(
          "export_file",
          async () => {
            const data = await ctx.sandbox.files.download(path);
            if (expired) throw new Error("Session expired");
            const name =
              basename(path).replace(/[^a-zA-Z0-9._-]/g, "_") || "download";
            const id = randomUUID() + "-" + name;
            const directory = join(homedir(), "Downloads", "Cue");
            await mkdir(directory, { recursive: true });
            await writeFile(join(directory, id), data, { flag: "wx" });
            if (expired) {
              await rm(join(directory, id), { force: true });
              throw new Error("Session expired");
            }
            const url = "cue-file:" + id;
            ctx.onExport?.(name, url);
            return { ok: true, name, url };
          },
          path,
        ).catch((err) => result(false, { error: String(err) })),
    }),

    expose_port: tool({
      description:
        "Expose a running server (for example on port 3000) using a public " +
        "preview URL. Use after starting the server.",
      inputSchema: z.object({ port: z.number().int().min(1).max(65535) }),
      execute: async ({ port }) =>
        run(
          "expose_port",
          async () => {
            const ready = await ctx.sandbox.commands.run("python3", {
              args: [
                "-c",
                "import socket,time,sys\nfor _ in range(40):\n try:\n  socket.create_connection(('127.0.0.1'," +
                  port +
                  "),timeout=0.25).close(); sys.exit(0)\n except OSError: time.sleep(0.25)\nsys.exit(1)",
              ],
            });
            if (ready.exitCode !== 0)
              return {
                ok: false,
                error: "Server is not listening on port " + port,
              };
            const preview = await ctx.sandbox.previewUrl(port);
            const { expiresAt } = await ctx.sandbox.setTimeout(10 * 60_000);
            if (expired) throw new Error("Session expired");
            ctx.onPreview?.(preview.url, expiresAt);
            return {
              ok: true,
              previewUrl: preview.url,
              token: preview.token,
              expiresAt,
            };
          },
          `:${port}`,
        ).catch((err) => result(false, { error: String(err) })),
    }),
  };
}
