import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

type CodexRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  lastMessage: string;
};

const PROMPT_FILE_REL = "ai/prompts/03-analysis.md";
const INPUT_JSON_REL = "output/03-enriched-site-data.json";
const OUTPUT_MD_REL = "output/04-ai-analysis.md";
const OUTPUT_RAW_REL = "output/04-ai-analysis.raw.txt";
const LAST_MESSAGE_TMP_REL = "output/.tmp-04-ai-analysis-last-message.txt";
const CODEX_BIN = process.env.CODEX_BIN?.trim() || "codex";
const STREAM_CLI_OUTPUT = process.env.STAGE3_STREAM_CLI_OUTPUT !== "0";
const HEARTBEAT_MS = Number(process.env.STAGE3_HEARTBEAT_MS || 15000);

function logStep(message: string): void {
  console.log(`[stage3] ${message}`);
}

function logCli(channel: "stdout" | "stderr", chunk: string): void {
  if (!STREAM_CLI_OUTPUT) return;

  const lines = chunk.replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;
    console.log(`[stage3][codex:${channel}] ${cleanLine}`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDurationMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  return `${mins}m ${remSec}s`;
}

function fail(message: string): never {
  throw new Error(message);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertFileExists(filePath: string, label: string): Promise<void> {
  if (!(await fileExists(filePath))) {
    fail(`Brak pliku ${label}: ${filePath}`);
  }
}

async function readTextFile(filePath: string, label: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    fail(`Nie mozna odczytac ${label}: ${filePath}\nSzczegoly: ${message}`);
  }
}

function buildFinalPrompt(basePrompt: string, inputJson: string): string {
  const trimmedBasePrompt = basePrompt.trim();

  return `${trimmedBasePrompt}

# INPUT JSON
\`\`\`json
${inputJson}
\`\`\`
`;
}

async function writeTextFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

function buildRawLog(result: CodexRunResult): string {
  return [
    `generatedAt: ${new Date().toISOString()}`,
    `command: ${result.command}`,
    `exitCode: ${result.exitCode}`,
    "",
    "===== STDOUT =====",
    result.stdout || "(empty)",
    "",
    "===== STDERR =====",
    result.stderr || "(empty)",
    "",
  ].join("\n");
}

async function runCodexCli(
  finalPrompt: string,
  workdir: string,
  lastMessagePath: string,
): Promise<CodexRunResult> {
  const args = [
    "exec",
    "--color",
    "never",
    "--sandbox",
    "read-only",
    "--output-last-message",
    lastMessagePath,
    "-",
  ];
  const command = `${CODEX_BIN} ${args.join(" ")}`;

  await fs.mkdir(path.dirname(lastMessagePath), { recursive: true });
  await fs.rm(lastMessagePath, { force: true });

  logStep(`Komenda: ${command}`);
  logStep(`Tryb stream logow CLI: ${STREAM_CLI_OUTPUT ? "ON" : "OFF"}`);

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(CODEX_BIN, args, {
      cwd: workdir,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      windowsHide: true,
    });
    logStep(`Uruchomiono proces Codex (pid=${child.pid ?? "unknown"}).`);

    let stdout = "";
    let stderr = "";
    let finished = false;
    let stdoutChunks = 0;
    let stderrChunks = 0;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let heartbeat: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (finished) return;
      const elapsed = formatDurationMs(Date.now() - startedAt);
      logStep(
        `Analiza w toku (${elapsed}). stdout=${formatBytes(stdoutBytes)} (${stdoutChunks} chunk), stderr=${formatBytes(stderrBytes)} (${stderrChunks} chunk).`,
      );
    }, HEARTBEAT_MS);

    const clearHeartbeat = (): void => {
      if (!heartbeat) return;
      clearInterval(heartbeat);
      heartbeat = null;
    };

    const rejectOnce = (error: Error): void => {
      if (finished) return;
      finished = true;
      clearHeartbeat();
      reject(error);
    };

    child.stdout.on("data", chunk => {
      const value = chunk.toString();
      stdout += value;
      stdoutChunks += 1;
      stdoutBytes += Buffer.byteLength(value, "utf-8");
      logCli("stdout", value);
    });

    child.stderr.on("data", chunk => {
      const value = chunk.toString();
      stderr += value;
      stderrChunks += 1;
      stderrBytes += Buffer.byteLength(value, "utf-8");
      logCli("stderr", value);
    });

    child.on("error", error => {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        rejectOnce(
          new Error(
            "Nie znaleziono komendy `codex`. Upewnij sie, ze Codex CLI jest zainstalowany i dostepny w PATH.\nMozesz tez ustawic zmienna srodowiskowa CODEX_BIN na pelna sciezke do binarki, np. codex.exe albo codex.CMD.",
          ),
        );
        return;
      }

      rejectOnce(
        new Error(`Blad uruchamiania procesu Codex CLI: ${error.message}`),
      );
    });

    child.on("close", code => {
      void (async () => {
        if (finished) return;
        clearHeartbeat();

        const exitCode = code ?? -1;
        const elapsed = formatDurationMs(Date.now() - startedAt);
        logStep(
          `Proces Codex zakonczony (code=${exitCode}, czas=${elapsed}, stdout=${formatBytes(stdoutBytes)}, stderr=${formatBytes(stderrBytes)}).`,
        );

        if (exitCode !== 0) {
          rejectOnce(
            new Error(
              `Codex CLI zakonczyl sie kodem ${exitCode}.\nSTDERR:\n${stderr || "(empty)"}`,
            ),
          );
          return;
        }

        const lastMessage = (await readTextFile(lastMessagePath, "last message"))
          .trim();

        if (!lastMessage) {
          rejectOnce(
            new Error(
              "Codex CLI zwrocil pusty wynik. Sprawdz output/04-ai-analysis.raw.txt.",
            ),
          );
          return;
        }

        finished = true;
        clearHeartbeat();
        resolve({
          stdout,
          stderr,
          exitCode,
          command,
          lastMessage,
        });
      })().catch(error => {
        const message = error instanceof Error ? error.message : "unknown error";
        rejectOnce(new Error(`Blad przetwarzania wyniku Codexa: ${message}`));
      });
    });

    child.stdin.on("error", error => {
      rejectOnce(new Error(`Blad stdin dla Codex CLI: ${error.message}`));
    });

    logStep(`Przekazuje prompt do Codexa przez stdin (dlugosc=${formatBytes(Buffer.byteLength(finalPrompt, "utf-8"))}).`);
    child.stdin.write(finalPrompt);
    child.stdin.end();
    logStep("Prompt wyslany, stdin zamkniete.");
  });
}

async function main(): Promise<void> {
  const cwd = process.cwd();

  const promptPath = path.resolve(cwd, PROMPT_FILE_REL);
  const inputJsonPath = path.resolve(cwd, INPUT_JSON_REL);
  const outputMdPath = path.resolve(cwd, OUTPUT_MD_REL);
  const outputRawPath = path.resolve(cwd, OUTPUT_RAW_REL);
  const lastMessagePath = path.resolve(cwd, LAST_MESSAGE_TMP_REL);

  logStep("Start ETAP 3 analizy AI.");

  logStep(`Sprawdzam plik promptu: ${promptPath}`);
  await assertFileExists(promptPath, "ai/prompts/03-analysis.md");

  logStep(`Sprawdzam plik danych: ${inputJsonPath}`);
  await assertFileExists(inputJsonPath, "output/03-enriched-site-data.json");

  logStep("Odczyt promptu.");
  const promptTemplate = await readTextFile(promptPath, "prompt");
  logStep(`Prompt odczytany (dlugosc=${formatBytes(Buffer.byteLength(promptTemplate, "utf-8"))}).`);

  logStep("Odczyt danych wejsciowych JSON.");
  const rawInputJson = await readTextFile(inputJsonPath, "input json");
  logStep(`JSON odczytany (dlugosc=${formatBytes(Buffer.byteLength(rawInputJson, "utf-8"))}).`);
  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(rawInputJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    fail(`Nieprawidlowy JSON w ${inputJsonPath}: ${message}`);
  }

  const pagesTotal =
    typeof parsedInput === "object" &&
    parsedInput !== null &&
    "pages" in parsedInput &&
    Array.isArray((parsedInput as { pages?: unknown[] }).pages)
      ? (parsedInput as { pages: unknown[] }).pages.length
      : null;
  if (pagesTotal !== null) {
    logStep(`Wejscie zawiera pages=${pagesTotal}.`);
  }

  const inputJson = JSON.stringify(parsedInput, null, 2);
  const finalPrompt = buildFinalPrompt(promptTemplate, inputJson);
  logStep(`Finalny prompt zbudowany (dlugosc=${formatBytes(Buffer.byteLength(finalPrompt, "utf-8"))}).`);

  logStep("Uruchamiam lokalny Codex CLI (non-interactive).");
  const result = await runCodexCli(finalPrompt, cwd, lastMessagePath);
  logStep(
    `Odebrano wynik Codexa (stdout=${formatBytes(Buffer.byteLength(result.stdout, "utf-8"))}, stderr=${formatBytes(Buffer.byteLength(result.stderr, "utf-8"))}, lastMessage=${formatBytes(Buffer.byteLength(result.lastMessage, "utf-8"))}).`,
  );

  logStep(`Zapisuje wynik analizy: ${outputMdPath}`);
  await writeTextFile(outputMdPath, result.lastMessage);
  logStep(`Zapisano plik markdown (${formatBytes(Buffer.byteLength(result.lastMessage, "utf-8"))}).`);

  logStep(`Zapisuje raw log: ${outputRawPath}`);
  const rawLog = buildRawLog(result);
  await writeTextFile(outputRawPath, rawLog);
  logStep(`Zapisano raw log (${formatBytes(Buffer.byteLength(rawLog, "utf-8"))}).`);

  await fs.rm(lastMessagePath, { force: true });
  logStep("Usunieto plik tymczasowy last-message.");

  logStep("ETAP 3 zakonczony sukcesem.");
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`[stage3] BLAD: ${message}`);
  process.exit(1);
});
